import {
  effectiveness,
  move as moveById,
  species as speciesById,
  type Boosts,
  type MoveEntry,
  type StageStat,
} from "./dex";
import { effortYield, gainEffort } from "./effort";
import { awardExp, expYield } from "./progression";
import { abilitiesOf, type AbilityEffect } from "./abilities";
import { hasVariableDamage, variableDamage, type DamageContext } from "./moves";
import { anyPp, hasPp, ppLeft, spendPp, STRUGGLE, STRUGGLE_RECOIL } from "./pp";
import { intBelow, rngFor } from "./rng";
import { computeStats } from "./stats";
import { STAT_IDS, type Individual, type StatId, type StatusId } from "./types";

/**
 * Battles, with two symmetric sides.
 *
 * Side 0 is always the local player. Side 1 is a wild creature driven by the
 * AI, or another person over the wire — and the rules do not know which. That
 * symmetry is not tidiness: a duel is checked independently by both peers, and
 * a second implementation of the rules for "versus" would drift from the one
 * used against wild creatures until the two disagreed mid-tournament. One
 * engine, two drivers.
 *
 * Every roll is named — `rngFor(seed, tag, turn, "0-crit")` — so a battle is a
 * pure function of its seed and how many turns have passed. For a wild battle
 * the seed is the world's, which is what makes encounters unrerollable. For a
 * duel it is derived from both players' nonces, so neither can bias a critical
 * hit.
 *
 * Integer arithmetic throughout. Type effectiveness travels in quarters and
 * stage multipliers as numerator/denominator pairs, so no step ever produces a
 * float that could round differently on another machine.
 */

export type SideIndex = 0 | 1;
export type Stages = Record<StageStat, number>;

export type BattleOutcome =
  | { t: "win"; side: SideIndex }
  | { t: "caught" }
  | { t: "fled" }
  | { t: "draw" };

export type BattleAction =
  | { t: "fight"; moveIndex: number }
  /**
   * Everything spent, and still standing.
   *
   * Its own action rather than a magic move index, because it is a different
   * decision: `fight` names a slot, and a creature reduced to Struggle has no
   * slots left to name. Legal only when nothing else is.
   */
  | { t: "struggle" }
  | { t: "switch"; partyIndex: number }
  /** Wild battles only. */
  /** Which ball. Omitted means an ordinary one. */
  | { t: "ball"; item?: string }
  | { t: "flee" }
  /** Nothing to do — a side with a fainted active that owes no replacement. */
  | { t: "pass" };

export type BattleEvent =
  | { t: "use"; side: SideIndex; moveId: string }
  /** Nothing left to use it with. */
  | { t: "struggling"; side: SideIndex }
  /** Something a creature can do that its species cannot. */
  | { t: "ability"; side: SideIndex; abilityId: string }
  /**
   * A move whose damage depends on the battle, in a battle where it comes to
   * nothing. Endeavor against something weaker, Counter with nothing to
   * counter. Its own event, because "it failed" and "it hit for zero" are
   * different things and a log that says the second is lying.
   */
  | { t: "fizzled"; side: SideIndex; moveId: string }
  | { t: "miss"; side: SideIndex }
  | { t: "immune"; side: SideIndex }
  | { t: "damage"; side: SideIndex; amount: number; quarters: number; crit: boolean }
  | { t: "status"; side: SideIndex; status: StatusId }
  | { t: "boost"; side: SideIndex; stat: StageStat; delta: number }
  | { t: "heal"; side: SideIndex; amount: number }
  | { t: "recoil"; side: SideIndex; amount: number }
  | { t: "blocked"; side: SideIndex; reason: StatusId }
  | { t: "woke"; side: SideIndex }
  | { t: "thawed"; side: SideIndex }
  | { t: "residual"; side: SideIndex; status: StatusId; amount: number }
  | { t: "faint"; side: SideIndex }
  | { t: "switch"; side: SideIndex; partyIndex: number }
  | {
      t: "exp";
      amount: number;
      levels: number;
      /** Who earned it. Without this an offer that arrives in the log has no
       * way to say which creature it is about. */
      uid: number;
      learned: string[];
      /** Grew into it, had no room for it. The player is asked later. */
      offered: string[];
      /** What it became, if it became anything. */
      evolved: string | null;
      /** And what it was — carried because the creature has already changed by
       * the time anything reads this, and a screen that wants to show the
       * change needs both halves of it. */
      evolvedFrom: string | null;
    }
  | { t: "effort"; stats: StatId[]; amount: number }
  | { t: "catchFailed" }
  | { t: "caught" }
  | { t: "fleeFailed" }
  | { t: "fled" }
  | { t: "noBalls" }
  | { t: "timeout" };

export interface Combatant {
  /** Everything this side can send out. A wild creature is a team of one. */
  team: Individual[];
  /** Which of them is out. */
  active: number;
  stages: Stages;
}

export interface BattleState {
  /** Names every roll, together with `tag`. */
  seed: string;
  /** Distinguishes this battle from every other one under the same seed. */
  tag: string;
  turn: number;
  sides: [Combatant, Combatant];
  /** Sides that owe a replacement before anything else can happen. */
  awaitingSwitch: [boolean, boolean];
  outcome: BattleOutcome | null;
  /** Narration for the turn just resolved. Derived from everything else, so
   * stateHash leaves it out. */
  events: BattleEvent[];
}

/**
 * What a battle allows.
 *
 * Two independent questions, not one: a wild creature can be caught and run
 * from and is worth experience; a trainer is worth experience but cannot be
 * caught; another person is neither. Collapsing them into a single "is this
 * wild" flag cannot express the middle case.
 */
export interface BattleRules {
  /** Whether balls and running are legal. */
  catchable: boolean;
  /** Whether beating it is worth experience. */
  awardsExp: boolean;
}

export const WILD_RULES: BattleRules = { catchable: true, awardsExp: true };
export const TRAINER_RULES: BattleRules = { catchable: false, awardsExp: true };
export const DUEL_RULES: BattleRules = { catchable: false, awardsExp: false };

/**
 * The turn after which a battle is decided on health rather than allowed to
 * continue.
 *
 * Not a nicety — without it some battles genuinely never end. Rowlet is
 * Grass/Flying, so Wooper-Paldea's Mud Shot is a zero-times no-op, and if the
 * Rowlet answers with Growl neither side can reduce the other's HP by a single
 * point, ever. A wild battle could be run from; a trainer battle could not,
 * and the game simply stopped.
 *
 * These games solve it with PP: moves run out and the attacker is forced into
 * Struggle, which always damages and always recoils. That is the more faithful
 * answer and it needs a PP system to mean anything. This is the guarantee
 * underneath it — even with Struggle, two creatures healing each other back up
 * would still need a stop — and 300 turns is far beyond any real battle.
 */
export const MAX_TURNS = 300;

const NO_STAGES: Stages = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

/**
 * Everything a creature's abilities say about one question.
 *
 * The battle never asks "what does Adaptability do"; it asks "does anything
 * change the same-type bonus" and takes what comes back. That is what keeps
 * the ability list open — a new entry that answers an existing question needs
 * no change here at all — and it is why the effects are shapes rather than
 * callbacks. A closed set of questions is a battle whose behaviour can still
 * be read off one file.
 */
function effects<K extends AbilityEffect["t"]>(
  creature: Individual,
  kind: K,
): Extract<AbilityEffect, { t: K }>[] {
  return abilitiesOf(creature.abilities)
    .map((spec) => spec.effect)
    .filter((effect): effect is Extract<AbilityEffect, { t: K }> => effect.t === kind);
}

/** Whether a creature carries any ability answering this question. */
function has(creature: Individual, kind: AbilityEffect["t"]): boolean {
  return effects(creature, kind).length > 0;
}

/** The ability id behind a shape, for the log to name it. */
function whichAbility(creature: Individual, kind: AbilityEffect["t"]): string | null {
  return abilitiesOf(creature.abilities).find((spec) => spec.effect.t === kind)?.id ?? null;
}

/** Multiplying by per-mille, kept in integers like everything else. */
function scaled(value: number, mille: number): number {
  return Math.floor((value * mille) / 1000);
}

/**
 * Whether a status will take at all.
 *
 * One predicate, and every road to a status goes down it: a move's own status,
 * a secondary effect, and anything added later. An immunity that only covered
 * the direct case would be an immunity that quietly fails against the very
 * moves people carry it for.
 */
function statusSticks(target: Individual, status: StatusId): boolean {
  return !effects(target, "ignore").some((effect) => effect.status === status);
}

/** One in this many, by the move's crit ratio. */
const CRIT_ODDS = [24, 8, 2, 1];

/** Types that simply cannot catch a given condition. */
const STATUS_IMMUNE: Record<StatusId, string[]> = {
  brn: ["fire"],
  frz: ["ice"],
  par: ["electric"],
  psn: ["poison", "steel"],
  slp: [],
};

export function startBattle(
  seed: string,
  tag: string,
  ours: readonly Individual[],
  theirs: readonly Individual[],
  ourActive = 0,
): BattleState {
  return {
    seed,
    tag,
    turn: 0,
    sides: [
      { team: ours.map((creature) => ({ ...creature })), active: ourActive, stages: { ...NO_STAGES } },
      { team: theirs.map((creature) => ({ ...creature })), active: 0, stages: { ...NO_STAGES } },
    ],
    awaitingSwitch: [false, false],
    outcome: null,
    events: [],
  };
}

export function maxHp(individual: Individual): number {
  return computeStats(speciesById(individual.speciesId), individual).hp;
}

export function isFainted(individual: Individual): boolean {
  return individual.hp <= 0;
}

export function activeOf(state: BattleState, side: SideIndex): Individual {
  const combatant = state.sides[side];
  return combatant.team[combatant.active];
}

/** Stage multipliers as a fraction, never a float. */
function stageFactor(stage: number): [number, number] {
  const clamped = Math.max(-6, Math.min(6, stage));
  return clamped >= 0 ? [2 + clamped, 2] : [2, 2 - clamped];
}

function effectiveStat(individual: Individual, stat: StageStat, stage: number): number {
  const base = computeStats(speciesById(individual.speciesId), individual)[stat];
  const [numerator, denominator] = stageFactor(stage);
  let value = Math.floor((base * numerator) / denominator);
  if (stat === "spe" && individual.status === "par") value = Math.floor(value / 2);

  // Huge Power, Hustle, Guts, Marvel Scale, Quick Feet, Defeatist. Applied
  // after the stage and after paralysis, so a creature with Quick Feet that is
  // paralysed ends up faster than one that is merely paralysed — which is what
  // carrying it is for.
  for (const effect of effects(individual, "stat")) {
    const applies =
      effect.when === "always" ||
      (effect.when === "statused" && individual.status !== null) ||
      (effect.when === "hurt" && individual.hp * 2 <= maxHp(individual));
    if (!applies) continue;

    const named = effect.stat === "offence" ? stat === "atk" || stat === "spa" : effect.stat === stat;
    if (named) value = scaled(value, effect.mille);
  }

  return Math.max(1, value);
}

// --------------------------------------------------------------- turn context

/**
 * Working state for one turn. Copied in at the top of resolveTurn and handed
 * back out, so callers never see a half-resolved battle and nothing outside
 * this module is ever mutated.
 */
interface Turn {
  battle: BattleState;
  events: BattleEvent[];
  /** Which side moves second this turn, once that is known. Analytic asks. */
  movingLast?: SideIndex;
  /**
   * Move damage each side has taken this turn, by category.
   *
   * The counter family reads it, and only *move* damage counts: recoil and
   * poison are not something there is anybody to retaliate against. Held on
   * the turn rather than on the creature because it is answered within the
   * turn and forgotten after it.
   */
  taken: [{ physical: number; special: number }, { physical: number; special: number }];
}

function active(turn: Turn, side: SideIndex): Individual {
  return activeOf(turn.battle, side);
}

function setActive(turn: Turn, side: SideIndex, individual: Individual): void {
  const combatant = turn.battle.sides[side];
  combatant.team = combatant.team.map((member, index) => (index === combatant.active ? individual : member));
}

function roll(turn: Turn, tag: string): number {
  return rngFor(turn.battle.seed, turn.battle.tag, turn.battle.turn, tag)();
}

function chance(turn: Turn, tag: string, percent: number): boolean {
  return Math.floor(roll(turn, tag) * 100) < percent;
}

function other(side: SideIndex): SideIndex {
  return side === 0 ? 1 : 0;
}

// --------------------------------------------------------------- mechanics

/**
 * A blow landing, with everything that hangs off it.
 *
 * Sturdy, the damage event, the tally the counter family reads, and Moxie —
 * four things that used to sit inline in one branch and now have to serve
 * three (a move with power, a move that states a number, and a move whose
 * power was computed). One place, so the three cannot drift.
 */
function landDamage(
  turn: Turn,
  side: SideIndex,
  move: MoveEntry,
  wanted: number,
  quarters: number,
  crit: boolean,
): number {
  const defender = active(turn, other(side));
  const attacker = active(turn, side);

  // Sturdy: from full health, one hit never finishes it. Trimmed here rather
  // than in the damage formula, because it is about the blow landing rather
  // than about how hard it was.
  let amount = wanted;
  if (defender.hp >= maxHp(defender) && amount >= defender.hp && has(defender, "endure")) {
    amount = Math.max(0, defender.hp - 1);
    const named = whichAbility(defender, "endure");
    if (named) turn.events.push({ t: "ability", side: other(side), abilityId: named });
  }

  const dealt = applyDamage(turn, other(side), amount);
  turn.events.push({ t: "damage", side: other(side), amount: dealt, quarters, crit });

  // What the counter family answers. Only move damage, and only this turn.
  if (move.category === "physical") turn.taken[other(side)].physical += dealt;
  else turn.taken[other(side)].special += dealt;

  // Moxie: the spoils of a knockout.
  if (isFainted(active(turn, other(side)))) {
    for (const effect of effects(attacker, "spoils")) {
      applyBoosts(turn, side, { [effect.stat]: effect.delta });
      const named = whichAbility(attacker, "spoils");
      if (named) turn.events.push({ t: "ability", side, abilityId: named });
    }
  }

  return dealt;
}

function applyDamage(turn: Turn, side: SideIndex, amount: number): number {
  const target = active(turn, side);
  const dealt = Math.max(0, Math.min(target.hp, amount));
  setActive(turn, side, { ...target, hp: target.hp - dealt });
  return dealt;
}

function applyHeal(turn: Turn, side: SideIndex, amount: number): number {
  const target = active(turn, side);
  const healed = Math.max(0, Math.min(maxHp(target) - target.hp, amount));
  if (healed > 0) setActive(turn, side, { ...target, hp: target.hp + healed });
  return healed;
}

function applyStatus(turn: Turn, side: SideIndex, status: StatusId, tag: string): boolean {
  const target = active(turn, side);
  if (target.status || isFainted(target)) return false;
  if (speciesById(target.speciesId).types.some((type) => STATUS_IMMUNE[status].includes(type))) return false;

  // Immunity, Limber, Water Veil, Insomnia, Magma Armor. Checked here so that
  // every road to a status goes through it — a move's own, a secondary, and
  // anything added later.
  if (!statusSticks(target, status)) {
    const named = abilitiesOf(target.abilities).find(
      (spec) => spec.effect.t === "ignore" && spec.effect.status === status,
    );
    if (named) turn.events.push({ t: "ability", side, abilityId: named.id });
    return false;
  }

  const sleepTurns = status === "slp" ? 1 + intBelow(rngFor(turn.battle.seed, turn.battle.tag, turn.battle.turn, tag, "slp"), 3) : 0;
  setActive(turn, side, { ...target, status, sleepTurns });
  turn.events.push({ t: "status", side, status });
  return true;
}

/**
 * A stage change, from anybody.
 *
 * `byOther` says whether somebody else did this, because that is the whole of
 * what Clear Body and Hyper Cutter protect against: a creature lowering its
 * own Defence to raise its Attack is its own business.
 */
function applyBoosts(turn: Turn, side: SideIndex, boosts: Boosts, byOther = false): void {
  const target = active(turn, side);
  const held = new Set(effects(target, "hold").flatMap((effect) => effect.stats));

  const stages = { ...turn.battle.sides[side].stages };
  for (const stat of Object.keys(boosts) as StageStat[]) {
    const delta = boosts[stat] ?? 0;
    if (byOther && delta < 0 && held.has(stat)) {
      const named = whichAbility(target, "hold");
      if (named) turn.events.push({ t: "ability", side, abilityId: named });
      continue;
    }
    const next = Math.max(-6, Math.min(6, stages[stat] + delta));
    if (next === stages[stat]) continue;
    stages[stat] = next;
    turn.events.push({ t: "boost", side, stat, delta });
  }
  turn.battle.sides[side].stages = stages;
}

/**
 * Everything a variable-damage move might read, gathered up.
 *
 * moves.ts is handed this rather than reaching for it: that module must not
 * import battle.ts — battle.ts imports it — and a cycle between the two would
 * be a build problem for no gain. So the one place that knows about stages and
 * maximum health fills in the form.
 */
function damageContext(turn: Turn, side: SideIndex, moveId: string): DamageContext {
  const attacker = active(turn, side);
  const defender = active(turn, other(side));
  const theirStages = turn.battle.sides[other(side)].stages;

  return {
    attacker,
    defender,
    attackerMaxHp: maxHp(attacker),
    defenderMaxHp: maxHp(defender),
    attackerSpeed: effectiveStat(attacker, "spe", turn.battle.sides[side].stages.spe),
    defenderSpeed: effectiveStat(defender, "spe", theirStages.spe),
    defenderBoosts: (["atk", "def", "spa", "spd", "spe"] as StageStat[]).reduce(
      (sum, stat) => sum + Math.max(0, theirStages[stat]),
      0,
    ),
    takenPhysical: turn.taken[side].physical,
    takenSpecial: turn.taken[side].special,
    // Named from the battle's own stream, like every other draw, so Magnitude
    // and Present come out the same on both peers in a duel.
    rng: rngFor(turn.battle.seed, turn.battle.tag, turn.battle.turn, `${side}-var`),
    // The slot has already been charged for this swing by the time damage is
    // worked out, so the last use reads as zero left — which is exactly when
    // Trump Card is meant to be at its worst-case best.
    ppLeft: ppLeft(attacker, attacker.moves.indexOf(moveId)),
  };
}

/**
 * `power` is passed in rather than read off the move, because thirty-nine of
 * them do not have one: the manifest ships `power: 0` for every move whose
 * damage Showdown computes in a script, and moves.ts is the missing script.
 */
function damageFor(
  turn: Turn,
  side: SideIndex,
  move: MoveEntry,
  power: number,
): { amount: number; quarters: number; crit: boolean } {
  const attacker = active(turn, side);
  const defender = active(turn, other(side));

  // Struggle is outside the type chart entirely — neither resisted, nor
  // doubled, nor blocked. Exempting it only from the early "immune" return was
  // not enough: the multiplier is applied again at the end, so a ghost still
  // took nothing and a creature with no moves left had no way to end the
  // fight. Four quarters is neutral, which is what "types do not apply" means
  // in this arithmetic.
  const struggling = move.id === STRUGGLE;
  // Scrappy: Normal and Fighting reach a Ghost. Applied by pretending the
  // target has no Ghost in it, which is exactly what the ability says.
  const reaching =
    has(attacker, "reach") && (move.type === "normal" || move.type === "fighting");
  const defenderTypes = reaching
    ? speciesById(defender.speciesId).types.filter((type) => type !== "ghost")
    : speciesById(defender.speciesId).types;

  const quarters = struggling ? 4 : effectiveness(move.type, defenderTypes);
  if (move.category === "status" || power <= 0 || quarters === 0) {
    return { amount: 0, quarters, crit: false };
  }

  const physical = move.category === "physical";
  const attack = effectiveStat(attacker, physical ? "atk" : "spa", turn.battle.sides[side].stages[physical ? "atk" : "spa"]);
  const defence = effectiveStat(
    defender,
    physical ? "def" : "spd",
    turn.battle.sides[other(side)].stages[physical ? "def" : "spd"],
  );

  let value = Math.floor((2 * attacker.level) / 5) + 2;
  value = Math.floor((value * power * attack) / defence);
  value = Math.floor(value / 50) + 2;

  // Super Luck: one stage up the same ladder the move's own ratio walks.
  const luck = effects(attacker, "luck").reduce((sum, effect) => sum + effect.stages, 0);
  const ratio = move.critRatio + luck;
  const odds = CRIT_ODDS[Math.max(0, Math.min(CRIT_ODDS.length - 1, ratio - 1))];
  const crit = intBelow(rngFor(turn.battle.seed, turn.battle.tag, turn.battle.turn, `${side}-crit`), odds) === 0;
  if (crit) value = Math.floor((value * 3) / 2);

  // 85..100, the damage roll every one of these games has.
  const spread = 85 + intBelow(rngFor(turn.battle.seed, turn.battle.tag, turn.battle.turn, `${side}-roll`), 16);
  value = Math.floor((value * spread) / 100);

  const attackerTypes: readonly string[] = speciesById(attacker.speciesId).types;
  // No same-type bonus on Struggle: it is the absence of an attack rather than
  // a Normal one, and a Normal type should not be rewarded for having nothing
  // left. Adaptability makes the bonus double instead of half again.
  if (!struggling && attackerTypes.includes(move.type)) {
    const stab = effects(attacker, "stab")[0]?.mille ?? 1500;
    value = scaled(value, stab);
  }

  // Technician, Reckless, Analytic, and the eighteen cornered abilities. Each
  // is a multiplier on its own attack, and they compound — a cornered
  // Technician is both.
  for (const effect of effects(attacker, "power")) {
    const applies =
      effect.when === "always" ||
      // Technician reads the power the move is *actually* swinging with, so a
      // Low Kick standing in at 60 qualifies and a Flail at 200 does not.
      (effect.when === "weak" && power > 0 && power <= 60) ||
      (effect.when === "costly" && move.recoil !== null) ||
      (effect.when === "late" && turn.movingLast === side) ||
      (effect.when === "cornered" &&
        effect.type === move.type &&
        attacker.hp * 3 <= maxHp(attacker));
    if (applies) value = scaled(value, effect.mille);
  }

  value = Math.floor((value * quarters) / 4);

  // Filter and Solid Rock on the way in; Tinted Lens on the way out. Both are
  // about the type chart's verdict rather than about a type, which is why they
  // sit after the multiplier rather than beside it.
  if (quarters > 4) {
    for (const effect of effects(defender, "cushion")) value = scaled(value, effect.mille);
  }
  if (quarters < 4) {
    for (const effect of effects(attacker, "pierce")) value = scaled(value, effect.mille);
  }

  // Ward and Thick Fat: a share off, by the move's type.
  for (const effect of effects(defender, "ward")) {
    if (effect.types.includes(move.type)) value = scaled(value, effect.mille);
  }

  // Guts ignores the burn penalty it is carried for.
  const gutsy = effects(attacker, "stat").some(
    (effect) => effect.when === "statused" && effect.stat === "atk",
  );
  if (attacker.status === "brn" && physical && !gutsy) value = Math.floor(value / 2);

  return { amount: Math.max(1, value), quarters, crit };
}

/** Can this side act at all? Handles the conditions that skip a turn, and the
 * rolls that end them. */
function canAct(turn: Turn, side: SideIndex): boolean {
  const creature = active(turn, side);

  if (creature.status === "slp") {
    if (creature.sleepTurns <= 1) {
      setActive(turn, side, { ...creature, status: null, sleepTurns: 0 });
      turn.events.push({ t: "woke", side });
      return true;
    }
    setActive(turn, side, { ...creature, sleepTurns: creature.sleepTurns - 1 });
    turn.events.push({ t: "blocked", side, reason: "slp" });
    return false;
  }

  if (creature.status === "frz") {
    if (chance(turn, `${side}-thaw`, 20)) {
      setActive(turn, side, { ...creature, status: null });
      turn.events.push({ t: "thawed", side });
      return true;
    }
    turn.events.push({ t: "blocked", side, reason: "frz" });
    return false;
  }

  if (creature.status === "par" && chance(turn, `${side}-par`, 25)) {
    turn.events.push({ t: "blocked", side, reason: "par" });
    return false;
  }

  return true;
}

function executeMove(turn: Turn, side: SideIndex, moveId: string): void {
  const attacker = active(turn, side);
  if (isFainted(attacker)) return;
  if (!canAct(turn, side)) return;

  const move = moveById(moveId);
  const struggling = moveId === STRUGGLE;

  // Spent here rather than when the move was chosen: a creature that is
  // asleep, frozen or fully paralysed never got the move off, and charging it
  // for a turn it did not have is how a battle quietly becomes unwinnable.
  // Struggle costs nothing, because it is what having nothing costs you.
  if (!struggling) {
    const slot = attacker.moves.indexOf(moveId);
    if (slot >= 0) setActive(turn, side, spendPp(attacker, slot));
  }

  turn.events.push(struggling ? { t: "struggling", side } : { t: "use", side, moveId });

  const defender = active(turn, other(side));

  // Absorb and Levitate. Checked before the type chart, because an ability
  // that grants an immunity the chart does not have is the whole point of it —
  // and the healing has to happen even though nothing landed.
  if (!struggling && move.category !== "status") {
    const drinking = abilitiesOf(defender.abilities).find(
      (spec) =>
        (spec.effect.t === "absorb" || spec.effect.t === "immune") &&
        spec.effect.type === move.type,
    );
    if (drinking) {
      turn.events.push({ t: "ability", side: other(side), abilityId: drinking.id });
      if (drinking.effect.t === "absorb") {
        const mended = applyHeal(
          turn,
          other(side),
          Math.max(1, Math.floor(maxHp(defender) / drinking.effect.share)),
        );
        if (mended > 0) turn.events.push({ t: "heal", side: other(side), amount: mended });
      } else {
        turn.events.push({ t: "immune", side: other(side) });
      }
      return;
    }
  }

  const reaching =
    has(attacker, "reach") && (move.type === "normal" || move.type === "fighting");
  const defenderTypes = reaching
    ? speciesById(defender.speciesId).types.filter((type) => type !== "ghost")
    : speciesById(defender.speciesId).types;
  const quarters = effectiveness(move.type, defenderTypes);
  // Struggle is the exception to the type chart. It has to be: a creature out
  // of moves facing something its last resort cannot touch would be stuck in
  // a battle with no way to act and no way to lose.
  if (!struggling && move.category !== "status" && quarters === 0) {
    turn.events.push({ t: "immune", side: other(side) });
    return;
  }

  // Compound Eyes, No Guard and Hustle. Accuracy of 0 in the manifest means
  // the move cannot miss to begin with.
  let accuracy = move.accuracy;
  let unmissable = accuracy === 0;
  for (const effect of effects(attacker, "aim")) {
    if (effect.mille === 0) unmissable = true;
    else accuracy = Math.min(100, scaled(accuracy, effect.mille));
  }
  // Hustle's cost: the same ability that raises Attack makes physical moves
  // less accurate, which is the trade it exists to offer.
  if (attacker.abilities.includes("hustle") && move.category === "physical") {
    accuracy = scaled(accuracy, 800);
  }

  if (!unmissable && accuracy > 0 && !chance(turn, `${side}-acc`, accuracy)) {
    turn.events.push({ t: "miss", side });
    return;
  }

  let dealt = 0;
  if (move.category !== "status") {
    // Thirty-nine moves in the manifest ship `power: 0` because Showdown
    // computes their damage in a script. moves.ts is that script; this is the
    // one place it is asked. Before it was wired in, every one of them burned
    // a turn and did exactly nothing — Seismic Toss, Night Shade, Fissure,
    // Return, Flail, Gyro Ball, the whole counter family.
    const variable = hasVariableDamage(move)
      ? variableDamage(move, damageContext(turn, side, moveId))
      : ({ t: "power", power: move.power } as const);

    if (variable.t === "fails") {
      turn.events.push({ t: "fizzled", side, moveId });
    } else if (variable.t === "exact") {
      // Exactly this many hit points. No crit, no roll, no same-type bonus and
      // no type multiplier — immunity already had its say above, and that is
      // the whole point of a move that states a number.
      dealt = landDamage(turn, side, move, variable.amount, 4, false);
      if (variable.selfKo) {
        const spent = active(turn, side);
        applyDamage(turn, side, spent.hp);
        turn.events.push({ t: "recoil", side, amount: spent.hp });
      }
    } else if (variable.power > 0) {
      const result = damageFor(turn, side, move, variable.power);
      dealt = landDamage(turn, side, move, result.amount, result.quarters, result.crit);
    }
  }

  if (move.heal) {
    const healed = applyHeal(turn, side, Math.floor((maxHp(attacker) * move.heal[0]) / move.heal[1]));
    if (healed > 0) turn.events.push({ t: "heal", side, amount: healed });
  }

  if (move.drain && dealt > 0) {
    const healed = applyHeal(turn, side, Math.max(1, Math.floor((dealt * move.drain[0]) / move.drain[1])));
    if (healed > 0) turn.events.push({ t: "heal", side, amount: healed });
  }

  // Rock Head. Struggle's own cost is below and is not recoil in this sense —
  // it is what having nothing left costs you, and nothing waives it.
  if (move.recoil && dealt > 0 && !has(attacker, "reckless")) {
    const taken = applyDamage(turn, side, Math.max(1, Math.floor((dealt * move.recoil[0]) / move.recoil[1])));
    if (taken > 0) turn.events.push({ t: "recoil", side, amount: taken });
  }

  // Struggle's own cost, which is a share of the user's own health rather
  // than of the damage it dealt. The manifest cannot say so — Showdown
  // computes it in a script — so it is named here, the way moves.ts names the
  // other formulas the data cannot hold.
  if (struggling) {
    const share = Math.max(1, Math.floor((maxHp(attacker) * STRUGGLE_RECOIL[0]) / STRUGGLE_RECOIL[1]));
    const taken = applyDamage(turn, side, share);
    if (taken > 0) turn.events.push({ t: "recoil", side, amount: taken });
  }

  if (move.status) applyStatus(turn, other(side), move.status, `${side}-status`);
  if (move.boosts) {
    const onSelf = move.target === "self";
    applyBoosts(turn, onSelf ? side : other(side), move.boosts, !onSelf);
  }

  // Shield Dust: the side effects of a move used on it never land. Its own
  // self-targeting secondaries are not "used on it", so they still do.
  const shielded = has(active(turn, other(side)), "unfazed");
  const secondary = move.secondary;
  if (
    secondary &&
    !(shielded && !secondary.self) &&
    !isFainted(active(turn, other(side))) &&
    chance(turn, `${side}-sec`, secondary.chance)
  ) {
    if (secondary.status) applyStatus(turn, other(side), secondary.status, `${side}-secstatus`);
    if (secondary.boosts) {
      applyBoosts(turn, secondary.self ? side : other(side), secondary.boosts, !secondary.self);
    }
  }
}

/** Burn and poison, at the end of the turn. */
function residual(turn: Turn, side: SideIndex): void {
  const creature = active(turn, side);
  if (isFainted(creature) || !creature.status) return;
  if (creature.status !== "brn" && creature.status !== "psn") return;

  const fraction = creature.status === "brn" ? 16 : 8;
  const amount = applyDamage(turn, side, Math.max(1, Math.floor(maxHp(creature) / fraction)));
  turn.events.push({ t: "residual", side, status: creature.status, amount });
}

/**
 * What the side the player is not driving does.
 *
 * Uniform among its moves. A wild animal is not running a damage calculator,
 * and a trainer who did would need a difficulty curve of its own — worth
 * having, but it is a design problem rather than a plumbing one, and it can
 * arrive later without anything else moving.
 *
 * A side owing a replacement sends out its first healthy member, because the
 * engine will accept nothing else from it.
 */
export function aiAction(state: BattleState, side: SideIndex = 1): BattleAction {
  if (state.awaitingSwitch[side]) {
    const next = state.sides[side].team.findIndex((creature) => !isFainted(creature));
    return next >= 0 ? { t: "switch", partyIndex: next } : { t: "pass" };
  }

  const active = activeOf(state, side);
  if (!active.moves.length) return { t: "pass" };
  // Out of everything, like anybody else would be.
  if (!anyPp(active)) return { t: "struggle" };

  // Only from what it can actually still use. Picking blind and then being
  // refused would leave the other side taking a free turn every time.
  const usable = active.moves.map((_, at) => at).filter((at) => hasPp(active, at));
  const roll = intBelow(rngFor(state.seed, state.tag, state.turn + 1, `ai${side}`), usable.length);
  return { t: "fight", moveIndex: usable[roll] };
}

/**
 * A move's priority, and what Prankster does to it.
 *
 * Dark types are immune to it in the games because Prankster is mischief, and
 * that reading is worth keeping: it is the one line in the ability that stops
 * it being simply "status moves go first, always".
 */
function priorityOf(turn: Turn, side: SideIndex, moveId: string | null): number {
  if (!moveId) return 0;
  const move = moveById(moveId);
  if (move.category !== "status") return move.priority;

  const target = speciesById(active(turn, other(side)).speciesId).types;
  if (target.includes("dark")) return move.priority;

  const plus = effects(active(turn, side), "quick").reduce((sum, one) => sum + one.plus, 0);
  return move.priority + plus;
}

/** Who moves first: priority, then speed, then a seeded coin. */
function firstMover(turn: Turn, moveA: string | null, moveB: string | null): SideIndex {
  const priorityA = priorityOf(turn, 0, moveA);
  const priorityB = priorityOf(turn, 1, moveB);
  if (priorityA !== priorityB) return priorityA > priorityB ? 0 : 1;

  const speedA = effectiveStat(active(turn, 0), "spe", turn.battle.sides[0].stages.spe);
  const speedB = effectiveStat(active(turn, 1), "spe", turn.battle.sides[1].stages.spe);
  if (speedA !== speedB) return speedA > speedB ? 0 : 1;

  return roll(turn, "speedtie") < 0.5 ? 0 : 1;
}

// --------------------------------------------------------------- catching

/**
 * Vanilla's shape, in integers: a full-health target is worth about a third
 * of its catch rate, a nearly-fainted one close to all of it, and a status
 * condition is worth roughly a further half again.
 */
export function catchOdds(wild: Individual, ballMult: number): number {
  const max = maxHp(wild);
  const rate = speciesById(wild.speciesId).catchRate;
  const hpTerm = Math.floor(((3 * max - 2 * wild.hp) * rate * ballMult) / (3 * max * 1000));
  const statusBonus = wild.status === "slp" || wild.status === "frz" ? 2000 : wild.status ? 1500 : 1000;
  return Math.max(1, Math.min(255, Math.floor((hpTerm * statusBonus) / 1000)));
}

// --------------------------------------------------------------- the turn

export interface TurnResult {
  battle: BattleState;
  /** The creature caught this turn, if any. The caller owns where it goes. */
  caught: Individual | null;
  ballsUsed: number;
}

export class IllegalAction extends Error {}

/**
 * Resolves one battle turn from both sides' actions.
 *
 * Pure in (battle, actions, rules, balls): the same arguments always produce
 * the same turn, which is what lets a save file be replayed and a duel be
 * checked by both peers independently.
 */
export function resolveTurn(
  state: BattleState,
  actions: [BattleAction, BattleAction],
  rules: BattleRules = WILD_RULES,
  balls = 0,
): TurnResult {
  if (state.outcome) throw new IllegalAction("battle is already over");

  const turn: Turn = {
    taken: [
      { physical: 0, special: 0 },
      { physical: 0, special: 0 },
    ],
    battle: {
      ...state,
      turn: state.turn + 1,
      sides: [cloneSide(state.sides[0]), cloneSide(state.sides[1])],
      awaitingSwitch: [...state.awaitingSwitch],
      events: [],
    },
    events: [],
  };

  // A side owing a replacement must send one out, and nothing else happens
  // that turn. Both sides can owe one at once after a double knockout.
  if (state.awaitingSwitch[0] || state.awaitingSwitch[1]) {
    for (const side of [0, 1] as SideIndex[]) {
      if (!state.awaitingSwitch[side]) continue;
      const action = actions[side];
      if (action.t !== "switch") throw new IllegalAction(`side ${side} must send out a replacement`);
      switchTo(turn, side, action.partyIndex);
      turn.battle.awaitingSwitch[side] = false;
    }
    return finish(turn, null, 0);
  }

  let caught: Individual | null = null;
  let ballsUsed = 0;

  // Balls and running are wild-only, resolve before anything else, and give
  // the opponent a free move if they fail.
  const ours = actions[0];
  if (ours.t === "ball" || ours.t === "flee") {
    if (!rules.catchable) throw new IllegalAction("there is no running from this one");

    if (ours.t === "ball") {
      if (balls <= 0) {
        turn.events.push({ t: "noBalls" });
        return finish(turn, null, 0);
      }
      ballsUsed = 1;
      const wild = active(turn, 1);
      const odds = catchOdds(wild, 1000);
      if (intBelow(rngFor(state.seed, state.tag, turn.battle.turn, "ball"), 256) < odds) {
        caught = { ...wild };
        turn.events.push({ t: "caught" });
        turn.battle.outcome = { t: "caught" };
        return finish(turn, caught, ballsUsed);
      }
      turn.events.push({ t: "catchFailed" });
    } else {
      const own = effectiveStat(active(turn, 0), "spe", turn.battle.sides[0].stages.spe);
      const theirs = effectiveStat(active(turn, 1), "spe", turn.battle.sides[1].stages.spe);
      const odds = own >= theirs ? 100 : Math.max(35, Math.floor((own * 100) / theirs));
      if (chance(turn, "flee", odds)) {
        turn.events.push({ t: "fled" });
        turn.battle.outcome = { t: "fled" };
        return finish(turn, null, 0);
      }
      turn.events.push({ t: "fleeFailed" });
    }

    // The opponent gets its move in regardless.
    const reply = actions[1];
    const replyMove = chosenMove(turn, 1, reply);
    if (replyMove) executeMove(turn, 1, replyMove);
    settle(turn, rules);
    return finish(turn, caught, ballsUsed);
  }

  // The opening lead counts as an arrival. Intimidate on the creature you
  // send out first has to work, or the ability is worth nothing on the one
  // creature most likely to be carrying it.
  if (turn.battle.turn === 1) {
    for (const side of [0, 1] as SideIndex[]) onArriving(turn, side);
  }

  // Switches happen before any move, on both sides.
  for (const side of [0, 1] as SideIndex[]) {
    const action = actions[side];
    if (action.t === "switch") switchTo(turn, side, action.partyIndex);
  }

  const moveA = chosenMove(turn, 0, actions[0]);
  const moveB = chosenMove(turn, 1, actions[1]);

  const first = firstMover(turn, moveA, moveB);
  const second = other(first);
  const moves: [string | null, string | null] = [moveA, moveB];
  // Analytic asks, and it has to be answered before either move resolves.
  turn.movingLast = second;

  if (moves[first]) executeMove(turn, first, moves[first]!);
  if (moves[second] && !isFainted(active(turn, second))) executeMove(turn, second, moves[second]!);

  for (const side of [0, 1] as SideIndex[]) {
    if (!isFainted(active(turn, side))) residual(turn, side);
  }

  settle(turn, rules);
  return finish(turn, caught, ballsUsed);
}

/**
 * The move an action comes down to, or null if it is not a move at all.
 *
 * Struggle is resolved here rather than at the menu so that both peers in a
 * duel reach it from the same rule instead of trusting each other's word for
 * what was left in the tank.
 */
function chosenMove(turn: Turn, side: SideIndex, action: BattleAction): string | null {
  if (action.t === "fight") return moveIdFor(turn, side, action.moveIndex);
  if (action.t !== "struggle") return null;
  if (anyPp(active(turn, side))) throw new IllegalAction("it still has moves to use");
  return STRUGGLE;
}

function cloneSide(side: Combatant): Combatant {
  return { team: side.team.map((creature) => ({ ...creature })), active: side.active, stages: { ...side.stages } };
}

function moveIdFor(turn: Turn, side: SideIndex, index: number): string {
  const creature = active(turn, side);
  if (index < 0 || index >= creature.moves.length) throw new IllegalAction("no such move");
  if (!hasPp(creature, index)) throw new IllegalAction("no uses left in that one");
  return creature.moves[index];
}

/** Why this action would be refused, or null. One predicate, two callers: the
 * battle menu greys a button for exactly what resolveTurn would throw on. */
export function actionRefusal(state: BattleState, side: SideIndex, action: BattleAction): string | null {
  if (state.outcome) return "the battle is over";
  const creature = activeOf(state, side);

  if (action.t === "fight") {
    if (action.moveIndex < 0 || action.moveIndex >= creature.moves.length) return "no such move";
    return hasPp(creature, action.moveIndex) ? null : "no uses left in that one";
  }
  if (action.t === "struggle") {
    return anyPp(creature) ? "it still has moves to use" : null;
  }
  return null;
}

/**
 * Regenerator and Natural Cure, on the way out; Intimidate, on the way in.
 *
 * Both halves live in one place because a switch is one event and reading it
 * in two would be how the two quietly stop agreeing about the order.
 */
function onLeaving(turn: Turn, side: SideIndex): void {
  const leaving = active(turn, side);
  if (isFainted(leaving)) return;

  let changed = leaving;
  for (const effect of effects(leaving, "mend")) {
    const room = maxHp(leaving) - leaving.hp;
    const mended = Math.min(room, Math.floor(maxHp(leaving) / effect.share));
    if (mended > 0) changed = { ...changed, hp: changed.hp + mended };
  }
  if (has(leaving, "shake") && changed.status) {
    changed = { ...changed, status: null, sleepTurns: 0 };
  }

  if (changed !== leaving) {
    setActive(turn, side, changed);
    const named = whichAbility(leaving, "mend") ?? whichAbility(leaving, "shake");
    if (named) turn.events.push({ t: "ability", side, abilityId: named });
  }
}

/** Intimidate, when somebody new is standing there. */
function onArriving(turn: Turn, side: SideIndex): void {
  const arriving = active(turn, side);
  for (const effect of effects(arriving, "arrival")) {
    // Scrappy is immune to it, as it is in the games.
    if (has(active(turn, other(side)), "reach")) continue;
    turn.events.push({ t: "ability", side, abilityId: whichAbility(arriving, "arrival")! });
    applyBoosts(turn, other(side), { [effect.stat]: effect.delta }, true);
  }
}

function switchTo(turn: Turn, side: SideIndex, partyIndex: number): void {
  const combatant = turn.battle.sides[side];
  if (partyIndex < 0 || partyIndex >= combatant.team.length) throw new IllegalAction("no such party member");
  if (partyIndex === combatant.active && !turn.battle.awaitingSwitch[side]) {
    throw new IllegalAction("that one is already out");
  }
  if (isFainted(combatant.team[partyIndex])) throw new IllegalAction("that one has fainted");

  // Whatever the one on its way out can do about leaving.
  onLeaving(turn, side);

  combatant.active = partyIndex;
  // Stat stages belong to the slot, not the creature, so they reset.
  combatant.stages = { ...NO_STAGES };
  turn.events.push({ t: "switch", side, partyIndex });

  // And whatever the one arriving does on arrival. After the event, so a log
  // reads in the order it happened.
  onArriving(turn, side);
}

/** Faints, experience and who has run out of creatures. */
function settle(turn: Turn, rules: BattleRules): void {
  const down: SideIndex[] = [];
  for (const side of [0, 1] as SideIndex[]) {
    if (isFainted(active(turn, side))) {
      turn.events.push({ t: "faint", side });
      down.push(side);
    }
  }
  if (!down.length) return;

  // Experience is for beating creatures and trainers, never people.
  if (rules.awardsExp && down.includes(1) && !down.includes(0)) {
    const loser = active(turn, 1);
    const victor = active(turn, 0);
    const amount = expYield(loser);
    const growth = awardExp(victor, amount);

    // Effort before the event is pushed, so the numbers a log replays are the
    // numbers the screen showed. Same award as experience: whatever was
    // standing when the other one fell.
    const yielded = effortYield(loser.speciesId);
    const before = growth.individual.evs;
    const evs = gainEffort(before, yielded);
    setActive(turn, 0, { ...growth.individual, evs });

    turn.events.push({
      t: "exp",
      amount,
      levels: growth.levelsGained,
      uid: victor.uid,
      learned: growth.movesLearned,
      offered: growth.movesOffered,
      evolvedFrom: growth.evolvedTo ? victor.speciesId : null,
      evolved: growth.evolvedTo,
    });

    // Only reported when something was actually earned — a creature at the
    // cap should not be told about effort it did not gain.
    const gained = STAT_IDS.filter((stat) => evs[stat] > before[stat]);
    if (gained.length) {
      turn.events.push({ t: "effort", stats: gained, amount: yielded.amount });
    }
  }

  const wipedOut = ([0, 1] as SideIndex[]).map((side) =>
    turn.battle.sides[side].team.every(isFainted),
  );

  if (wipedOut[0] && wipedOut[1]) {
    turn.battle.outcome = { t: "draw" };
    return;
  }
  if (wipedOut[0]) {
    turn.battle.outcome = { t: "win", side: 1 };
    return;
  }
  if (wipedOut[1]) {
    turn.battle.outcome = { t: "win", side: 0 };
    return;
  }

  for (const side of down) turn.battle.awaitingSwitch[side] = true;
}

/**
 * Decides a battle that has gone on too long, on remaining health.
 *
 * Compared as a fraction of each side's total, cross-multiplied so the
 * comparison stays in integers: a side down to its last creature has not
 * "won" by having more raw HP than a full team of smaller ones.
 */
function decideOnHealth(turn: Turn): void {
  const totals = ([0, 1] as SideIndex[]).map((side) => {
    const team = turn.battle.sides[side].team;
    return {
      hp: team.reduce((sum, creature) => sum + Math.max(0, creature.hp), 0),
      max: team.reduce((sum, creature) => sum + maxHp(creature), 0),
    };
  });

  turn.events.push({ t: "timeout" });

  const ours = totals[0].hp * totals[1].max;
  const theirs = totals[1].hp * totals[0].max;
  if (ours === theirs) turn.battle.outcome = { t: "draw" };
  else turn.battle.outcome = { t: "win", side: ours > theirs ? 0 : 1 };
}

function finish(turn: Turn, caught: Individual | null, ballsUsed: number): TurnResult {
  // The turn limit belongs on the way out, not on one path through.
  //
  // It used to sit at the end of the ordinary move-resolution path, which six
  // `return finish(...)` statements never reach: a switch, a ball, a flee that
  // failed. So a battle that only ever saw those could pass three hundred
  // turns and keep going. The deadlock probe walked straight into it the
  // moment power points existed — out of moves, out of balls, and throwing a
  // ball it did not have a thousand times over. A guarantee that only holds
  // on the common path is not a guarantee.
  if (!turn.battle.outcome && turn.battle.turn >= MAX_TURNS) decideOnHealth(turn);
  return { battle: { ...turn.battle, events: turn.events }, caught, ballsUsed };
}

/**
 * A fingerprint of a battle, for two peers to compare after every turn.
 *
 * A duel where the two sides disagree is not a difference of opinion, it is
 * one client running different rules; the point of this is to notice
 * immediately rather than three turns later.
 */
export function battleHash(state: BattleState): string {
  const creature = (individual: Individual) =>
    [
      individual.uid,
      individual.speciesId,
      individual.level,
      individual.hp,
      individual.status ?? "-",
      individual.sleepTurns,
      // What it can do decides what the numbers come out as, so two peers that
      // disagree about an ability would disagree about every hit after it.
      individual.abilities.join("+"),
    ].join(":");

  const side = (index: SideIndex) => {
    const combatant = state.sides[index];
    return [
      combatant.active,
      combatant.team.map(creature).join("|"),
      (["atk", "def", "spa", "spd", "spe"] as const).map((stat) => combatant.stages[stat]).join(","),
    ].join("/");
  };

  let hash = 0x811c9dc5;
  const canonical = [state.turn, side(0), side(1), state.awaitingSwitch.join(","), JSON.stringify(state.outcome ?? null)].join(";");
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
