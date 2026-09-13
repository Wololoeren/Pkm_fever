import { activeOf, maxHp, stageFactor, type BattleAction, type BattleState, type SideIndex } from "@/engine/battle";
import { effectiveness, move as moveById, species as speciesById, type MoveEntry } from "@/engine/dex";
import { displayPower } from "@/engine/moves";
import { ppLeft } from "@/engine/pp";
import { computeStats } from "@/engine/stats";
import type { Individual, TypeId } from "@/engine/types";

/**
 * What a policy is allowed to know about an action, in the order it knows it.
 *
 * Every feature is an integer, most of them in thousandths, and the list is
 * the contract between the weights on disk and the code that reads them: a
 * weights file records these names, and loading one whose names differ from
 * this list is refused. Add a feature at the end and retrain; never reorder.
 */
export const FEATURE_NAMES = [
  // A move.
  "fight",
  "dmg_of_hp", // estimated damage as thousandths of the target's current HP, capped
  "ko", // the estimate would take it out
  "effect", // type chart quarters x 250: 1000 is neutral
  "immune", // the chart says nothing lands
  "stab",
  "accuracy", // thousandths; a sure hit is 1000
  "priority", // signed, x 1000
  "faster", // we move before the target this turn, all else equal
  "inflicts", // a status the target does not yet have, weighted by its odds
  "raises_self", // stages the move adds to the user, x 250
  "lowers_target", // stages the move takes from the target, x 250
  "heals", // healed fraction x missing fraction
  "recoil", // fraction of damage taken back
  "drain", // fraction of damage recovered
  "status_move",
  "pp_left", // thousandths of the slot
  "dmg_of_max", // estimated damage as thousandths of the target's full HP
  "own_hp", // the user's health, thousandths
  "struggle",
  "expected", // dmg_of_hp x accuracy
  // A switch.
  "switch",
  "in_hp", // the incoming creature's health
  "in_offence", // its best type-chart quarters against the target x 250
  "in_defence", // the target's best quarters against it x 250
  "out_defence", // the target's best quarters against whoever is out now x 250
  "out_offence", // the current creature's best quarters x 250
  "out_hp",
  "forced", // a replacement is owed, so this is not a choice against fighting
  "in_faster",
  // What the other side can do back, on every action.
  "threat_out", // their best estimated damage as thousandths of the current creature's HP
  "threat_in", // the same against the incoming creature, on a switch
  "ko_by_them", // their best estimate takes the creature that will be standing there out
  "two_hit", // on a move: the estimate takes the target out in two
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export const FEATURE_COUNT = FEATURE_NAMES.length;
const AT = Object.fromEntries(FEATURE_NAMES.map((name, at) => [name, at])) as Record<FeatureName, number>;

/** A creature's stat after its stage and paralysis, the way the engine reads it. */
function statOf(creature: Individual, stat: "atk" | "def" | "spa" | "spd" | "spe", stage: number): number {
  const base = computeStats(speciesById(creature.speciesId), creature)[stat];
  const [numerator, denominator] = stageFactor(stage);
  let value = Math.floor((base * numerator) / denominator);
  if (stat === "spe" && creature.status === "par") value = Math.floor(value / 2);
  return value;
}

/** The type chart against the creature's species. */
function quarters(move: MoveEntry, defender: Individual): number {
  return effectiveness(move.type, speciesById(defender.speciesId).types);
}

/**
 * A middle roll of the engine's damage formula, with no critical and none of
 * the field, items or abilities.
 *
 * An estimate, not the number. The engine's own damage lives behind a `Turn`
 * and half a dozen things that are only known once both actions are in; a
 * feature is asked before either is. Mirroring the integer shape of the real
 * formula, the same floors in the same order, keeps the estimate on the same
 * scale as the truth, which is all a weight needs.
 */
export function estimateDamage(
  state: BattleState,
  side: SideIndex,
  moveId: string,
): { amount: number; quarters: number } {
  const attacker = activeOf(state, side);
  const defender = activeOf(state, (1 - side) as SideIndex);
  const move = moveById(moveId);
  const power = move.power > 0 ? move.power : (displayPower(move) ?? 0);
  const chart = quarters(move, defender);
  if (move.category === "status" || power <= 0 || chart === 0) return { amount: 0, quarters: chart };

  const physical = move.category === "physical";
  const attack = statOf(attacker, physical ? "atk" : "spa", state.sides[side].stages[physical ? "atk" : "spa"]);
  const defence = Math.max(
    1,
    statOf(defender, physical ? "def" : "spd", state.sides[1 - side].stages[physical ? "def" : "spd"]),
  );

  let value = Math.floor((2 * attacker.level) / 5) + 2;
  value = Math.floor((value * power * attack) / defence);
  value = Math.floor(value / 50) + 2;
  value = Math.floor((value * 92) / 100);
  if (speciesById(attacker.speciesId).types.includes(move.type as TypeId)) value = Math.floor((value * 1500) / 1000);
  value = Math.floor((value * chart) / 4);
  if (physical && attacker.status === "brn") value = Math.floor(value / 2);
  return { amount: Math.max(1, value), quarters: chart };
}

/** The best the chart offers any of the attacker's damaging moves against the defender, x 250. */
function bestOffence(attacker: Individual, defender: Individual): number {
  let best = 0;
  for (const moveId of attacker.moves) {
    const move = moveById(moveId);
    if (move.category === "status") continue;
    best = Math.max(best, quarters(move, defender));
  }
  return best * 250;
}

/**
 * The most the other side's creature could be estimated to do to `defender`
 * with one move, as thousandths of the defender's current HP.
 *
 * Read off the same estimator as our own damage, against whichever of ours
 * would be standing there: the one out now, or the one a switch brings in
 * (with no stages, because a switch clears them).
 */
function threatTo(state: BattleState, side: SideIndex, defender: Individual, defenderStages: boolean): number {
  const other = (1 - side) as SideIndex;
  const attacker = activeOf(state, other);
  let worst = 0;
  for (const moveId of attacker.moves) {
    const move = moveById(moveId);
    const power = move.power > 0 ? move.power : (displayPower(move) ?? 0);
    const chart = quarters(move, defender);
    if (move.category === "status" || power <= 0 || chart === 0) continue;
    const physical = move.category === "physical";
    const attack = statOf(attacker, physical ? "atk" : "spa", state.sides[other].stages[physical ? "atk" : "spa"]);
    const defence = Math.max(
      1,
      statOf(defender, physical ? "def" : "spd", defenderStages ? state.sides[side].stages[physical ? "def" : "spd"] : 0),
    );
    let value = Math.floor((2 * attacker.level) / 5) + 2;
    value = Math.floor((value * power * attack) / defence);
    value = Math.floor(value / 50) + 2;
    value = Math.floor((value * 92) / 100);
    if (speciesById(attacker.speciesId).types.includes(move.type as TypeId)) value = Math.floor((value * 1500) / 1000);
    value = Math.floor((value * chart) / 4);
    if (physical && attacker.status === "brn") value = Math.floor(value / 2);
    worst = Math.max(worst, value);
  }
  return worst;
}

function stagesOf(boosts: Partial<Record<string, number>> | null | undefined, sign: 1 | -1): number {
  if (!boosts) return 0;
  let total = 0;
  for (const amount of Object.values(boosts)) {
    if (amount !== undefined && Math.sign(amount) === sign) total += Math.abs(amount);
  }
  return total;
}

function mille(numerator: number, denominator: number): number {
  return Math.floor((numerator * 1000) / Math.max(1, denominator));
}

/**
 * The feature vector of one action, from one side's point of view.
 *
 * Integers only, so that the dot product a policy takes over them is exact
 * and a battle replays the same on every machine.
 */
export function featuresOf(state: BattleState, side: SideIndex, action: BattleAction): number[] {
  const f = new Array<number>(FEATURE_COUNT).fill(0);
  const other = (1 - side) as SideIndex;
  const us = activeOf(state, side);
  const them = activeOf(state, other);
  const ourSpeed = statOf(us, "spe", state.sides[side].stages.spe);
  const theirSpeed = statOf(them, "spe", state.sides[other].stages.spe);

  if (action.t === "fight" || action.t === "struggle") {
    const moveId = action.t === "struggle" ? "struggle" : us.moves[action.moveIndex];
    const move = moveById(moveId);
    const { amount, quarters: chart } = estimateDamage(state, side, moveId);
    const damaging = move.category !== "status";

    f[AT.fight] = 1000;
    f[AT.dmg_of_hp] = Math.min(1000, mille(amount, them.hp));
    f[AT.ko] = amount > 0 && amount >= them.hp ? 1000 : 0;
    f[AT.effect] = damaging ? chart * 250 : 1000;
    f[AT.immune] = damaging && chart === 0 ? 1000 : 0;
    f[AT.stab] = damaging && speciesById(us.speciesId).types.includes(move.type as TypeId) ? 1000 : 0;
    f[AT.accuracy] = move.accuracy === 0 ? 1000 : move.accuracy * 10;
    f[AT.priority] = move.priority * 1000;
    f[AT.faster] = ourSpeed > theirSpeed || move.priority > 0 ? 1000 : 0;
    if (them.status === null) {
      if (move.status) f[AT.inflicts] = 1000;
      else if (move.secondary?.status) f[AT.inflicts] = move.secondary.chance * 10;
    }
    const selfTargeted = move.target === "self";
    f[AT.raises_self] =
      250 *
      (stagesOf(move.selfBoosts?.boosts, 1) +
        (selfTargeted ? stagesOf(move.boosts, 1) : 0) +
        (move.secondary?.self ? stagesOf(move.secondary.boosts, 1) : 0));
    f[AT.lowers_target] =
      250 *
      ((selfTargeted ? 0 : stagesOf(move.boosts, -1)) +
        (move.secondary && !move.secondary.self ? stagesOf(move.secondary.boosts, -1) : 0));
    if (move.heal) {
      const missing = 1000 - mille(us.hp, maxHp(us));
      f[AT.heals] = Math.floor((mille(move.heal[0], move.heal[1]) * missing) / 1000);
    }
    if (move.recoil) f[AT.recoil] = mille(move.recoil[0], move.recoil[1]);
    if (move.drain) f[AT.drain] = Math.floor((mille(move.drain[0], move.drain[1]) * f[AT.dmg_of_hp]) / 1000);
    f[AT.status_move] = damaging ? 0 : 1000;
    f[AT.pp_left] = action.t === "fight" ? mille(ppLeft(us, action.moveIndex), move.pp) : 0;
    f[AT.dmg_of_max] = Math.min(1000, mille(amount, maxHp(them)));
    f[AT.own_hp] = mille(us.hp, maxHp(us));
    f[AT.struggle] = action.t === "struggle" ? 1000 : 0;
    f[AT.expected] = Math.floor((f[AT.dmg_of_hp] * f[AT.accuracy]) / 1000);
    const threat = threatTo(state, side, us, true);
    f[AT.threat_out] = Math.min(1000, mille(threat, us.hp));
    f[AT.ko_by_them] = threat >= us.hp ? 1000 : 0;
    f[AT.two_hit] = amount > 0 && amount * 2 >= them.hp ? 1000 : 0;
    return f;
  }

  if (action.t === "switch") {
    const incoming = state.sides[side].team[action.partyIndex];
    f[AT.switch] = 1000;
    f[AT.in_hp] = mille(incoming.hp, maxHp(incoming));
    f[AT.in_offence] = bestOffence(incoming, them);
    f[AT.in_defence] = bestOffence(them, incoming);
    f[AT.out_defence] = bestOffence(them, us);
    f[AT.out_offence] = bestOffence(us, them);
    f[AT.out_hp] = mille(us.hp, maxHp(us));
    f[AT.forced] = state.awaitingSwitch[side] ? 1000 : 0;
    f[AT.in_faster] = statOf(incoming, "spe", 0) > theirSpeed ? 1000 : 0;
    const threatIn = threatTo(state, side, incoming, false);
    f[AT.threat_out] = Math.min(1000, mille(threatTo(state, side, us, true), us.hp));
    f[AT.threat_in] = Math.min(1000, mille(threatIn, incoming.hp));
    f[AT.ko_by_them] = threatIn >= incoming.hp ? 1000 : 0;
    return f;
  }

  return f;
}
