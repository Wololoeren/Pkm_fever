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
  | { t: "switch"; partyIndex: number }
  /** Wild battles only. */
  | { t: "ball" }
  | { t: "flee" }
  /** Nothing to do — a side with a fainted active that owes no replacement. */
  | { t: "pass" };

export type BattleEvent =
  | { t: "use"; side: SideIndex; moveId: string }
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
  | { t: "exp"; amount: number; levels: number; learned: string[]; evolved: string | null }
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

  const sleepTurns = status === "slp" ? 1 + intBelow(rngFor(turn.battle.seed, turn.battle.tag, turn.battle.turn, tag, "slp"), 3) : 0;
  setActive(turn, side, { ...target, status, sleepTurns });
  turn.events.push({ t: "status", side, status });
  return true;
}

function applyBoosts(turn: Turn, side: SideIndex, boosts: Boosts): void {
  const stages = { ...turn.battle.sides[side].stages };
  for (const stat of Object.keys(boosts) as StageStat[]) {
    const delta = boosts[stat] ?? 0;
    const next = Math.max(-6, Math.min(6, stages[stat] + delta));
    if (next === stages[stat]) continue;
    stages[stat] = next;
    turn.events.push({ t: "boost", side, stat, delta });
  }
  turn.battle.sides[side].stages = stages;
}

function damageFor(turn: Turn, side: SideIndex, move: MoveEntry): { amount: number; quarters: number; crit: boolean } {
  const attacker = active(turn, side);
  const defender = active(turn, other(side));
  const quarters = effectiveness(move.type, speciesById(defender.speciesId).types);
  if (move.category === "status" || move.power <= 0 || quarters === 0) {
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
  value = Math.floor((value * move.power * attack) / defence);
  value = Math.floor(value / 50) + 2;

  const odds = CRIT_ODDS[Math.max(0, Math.min(CRIT_ODDS.length - 1, move.critRatio - 1))];
  const crit = intBelow(rngFor(turn.battle.seed, turn.battle.tag, turn.battle.turn, `${side}-crit`), odds) === 0;
  if (crit) value = Math.floor((value * 3) / 2);

  // 85..100, the damage roll every one of these games has.
  const spread = 85 + intBelow(rngFor(turn.battle.seed, turn.battle.tag, turn.battle.turn, `${side}-roll`), 16);
  value = Math.floor((value * spread) / 100);

  const attackerTypes: readonly string[] = speciesById(attacker.speciesId).types;
  if (attackerTypes.includes(move.type)) value = Math.floor((value * 3) / 2);
  value = Math.floor((value * quarters) / 4);
  if (attacker.status === "brn" && physical) value = Math.floor(value / 2);

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
  turn.events.push({ t: "use", side, moveId });

  const quarters = effectiveness(move.type, speciesById(active(turn, other(side)).speciesId).types);
  if (move.category !== "status" && quarters === 0) {
    turn.events.push({ t: "immune", side: other(side) });
    return;
  }

  // Accuracy of 0 in the manifest means the move cannot miss.
  if (move.accuracy > 0 && !chance(turn, `${side}-acc`, move.accuracy)) {
    turn.events.push({ t: "miss", side });
    return;
  }

  let dealt = 0;
  if (move.category !== "status" && move.power > 0) {
    const result = damageFor(turn, side, move);
    dealt = applyDamage(turn, other(side), result.amount);
    turn.events.push({ t: "damage", side: other(side), amount: dealt, quarters: result.quarters, crit: result.crit });
  }

  if (move.heal) {
    const healed = applyHeal(turn, side, Math.floor((maxHp(attacker) * move.heal[0]) / move.heal[1]));
    if (healed > 0) turn.events.push({ t: "heal", side, amount: healed });
  }

  if (move.drain && dealt > 0) {
    const healed = applyHeal(turn, side, Math.max(1, Math.floor((dealt * move.drain[0]) / move.drain[1])));
    if (healed > 0) turn.events.push({ t: "heal", side, amount: healed });
  }

  if (move.recoil && dealt > 0) {
    const taken = applyDamage(turn, side, Math.max(1, Math.floor((dealt * move.recoil[0]) / move.recoil[1])));
    if (taken > 0) turn.events.push({ t: "recoil", side, amount: taken });
  }

  if (move.status) applyStatus(turn, other(side), move.status, `${side}-status`);
  if (move.boosts) applyBoosts(turn, move.target === "self" ? side : other(side), move.boosts);

  const secondary = move.secondary;
  if (secondary && !isFainted(active(turn, other(side))) && chance(turn, `${side}-sec`, secondary.chance)) {
    if (secondary.status) applyStatus(turn, other(side), secondary.status, `${side}-secstatus`);
    if (secondary.boosts) applyBoosts(turn, secondary.self ? side : other(side), secondary.boosts);
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

  const index = intBelow(rngFor(state.seed, state.tag, state.turn + 1, `ai${side}`), active.moves.length);
  return { t: "fight", moveIndex: index };
}

/** Who moves first: priority, then speed, then a seeded coin. */
function firstMover(turn: Turn, moveA: string | null, moveB: string | null): SideIndex {
  const priorityA = moveA ? moveById(moveA).priority : 0;
  const priorityB = moveB ? moveById(moveB).priority : 0;
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
    if (reply.t === "fight") executeMove(turn, 1, moveIdFor(turn, 1, reply.moveIndex));
    settle(turn, rules);
    return finish(turn, caught, ballsUsed);
  }

  // Switches happen before any move, on both sides.
  for (const side of [0, 1] as SideIndex[]) {
    const action = actions[side];
    if (action.t === "switch") switchTo(turn, side, action.partyIndex);
  }

  const moveA = actions[0].t === "fight" ? moveIdFor(turn, 0, actions[0].moveIndex) : null;
  const moveB = actions[1].t === "fight" ? moveIdFor(turn, 1, actions[1].moveIndex) : null;

  const first = firstMover(turn, moveA, moveB);
  const second = other(first);
  const moves: [string | null, string | null] = [moveA, moveB];

  if (moves[first]) executeMove(turn, first, moves[first]!);
  if (moves[second] && !isFainted(active(turn, second))) executeMove(turn, second, moves[second]!);

  for (const side of [0, 1] as SideIndex[]) {
    if (!isFainted(active(turn, side))) residual(turn, side);
  }

  settle(turn, rules);
  if (!turn.battle.outcome && turn.battle.turn >= MAX_TURNS) decideOnHealth(turn);
  return finish(turn, caught, ballsUsed);
}

function cloneSide(side: Combatant): Combatant {
  return { team: side.team.map((creature) => ({ ...creature })), active: side.active, stages: { ...side.stages } };
}

function moveIdFor(turn: Turn, side: SideIndex, index: number): string {
  const creature = active(turn, side);
  if (index < 0 || index >= creature.moves.length) throw new IllegalAction("no such move");
  return creature.moves[index];
}

function switchTo(turn: Turn, side: SideIndex, partyIndex: number): void {
  const combatant = turn.battle.sides[side];
  if (partyIndex < 0 || partyIndex >= combatant.team.length) throw new IllegalAction("no such party member");
  if (partyIndex === combatant.active && !turn.battle.awaitingSwitch[side]) {
    throw new IllegalAction("that one is already out");
  }
  if (isFainted(combatant.team[partyIndex])) throw new IllegalAction("that one has fainted");

  combatant.active = partyIndex;
  // Stat stages belong to the slot, not the creature, so they reset.
  combatant.stages = { ...NO_STAGES };
  turn.events.push({ t: "switch", side, partyIndex });
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
      learned: growth.movesLearned,
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
    [individual.uid, individual.speciesId, individual.level, individual.hp, individual.status ?? "-", individual.sleepTurns].join(":");

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
