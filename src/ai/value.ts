import { activeOf, isFainted, maxHp, type BattleState, type Combatant, type SideIndex } from "@/engine/battle";
import type { Individual } from "@/engine/types";
import { estimateDamage } from "./features";

/**
 * What being decided adds to a position, on top of the health that decided it.
 *
 * Small on purpose. A won battle is already the most a side can score on
 * health — the other team at nought, ours at whatever is left — so this only
 * has to break the tie with "one hit from won". It was a hundred thousand,
 * and that made the search a gambler: one sample in three that happened to
 * end the battle outweighed any position that had not, so a coin-flip on a
 * knock-out beat a sure hit every time.
 */
export const WIN_VALUE = 1500;

/** What a condition costs the side carrying it, in the same thousandths. */
const STATUS_COST: Record<string, number> = {
  slp: 300,
  frz: 300,
  par: 200,
  brn: 180,
  psn: 150,
};

/** Health left on a side, in thousandths of a full team, plus a bounty for
 * every member still standing, less what each one is suffering from. */
function sideWorth(team: readonly Individual[]): number {
  let worth = 0;
  for (const creature of team) {
    if (isFainted(creature)) continue;
    worth += 500 + Math.floor((creature.hp * 1000) / Math.max(1, maxHp(creature)));
    if (creature.status) worth -= STATUS_COST[creature.status] ?? 0;
  }
  return worth;
}

/**
 * What the creature standing there has built up: its stat ladders, and a
 * few things it is under. Small next to a body, because all of it is gone
 * the moment it switches out.
 */
function standingWorth(side: Combatant): number {
  let worth = 0;
  for (const stat of ["atk", "def", "spa", "spd", "spe"] as const) {
    worth += Math.max(-6, Math.min(6, side.stages[stat])) * 40;
  }
  if (side.aim) worth += (side.aim.accuracy - side.aim.evasion) * 30;
  const volatiles = side.volatiles;
  if (volatiles?.seeded) worth -= 120;
  if (volatiles?.confusion) worth -= 100;
  return worth;
}

/**
 * The most the creature standing on `side` is estimated to do to the one
 * opposite with a single move, as thousandths of the target's full health.
 */
function reach(state: BattleState, side: SideIndex): number {
  const attacker = activeOf(state, side);
  const defender = activeOf(state, (1 - side) as SideIndex);
  const full = Math.max(1, maxHp(defender));
  let best = 0;
  for (const moveId of attacker.moves) {
    const { amount } = estimateDamage(state, side, moveId);
    best = Math.max(best, Math.min(1000, Math.floor((amount * 1000) / full)));
  }
  return best;
}

/**
 * How good a position is for `side`, as one integer.
 *
 * Health, bodies and conditions on both sides, what each active creature has
 * built up, or the outcome when there is one. Zero-sum by construction: what
 * it says for one side is the negative of what it says for the other, which
 * is what lets one matrix of played-out turns be read from both chairs.
 *
 * Blunt on purpose. It is the *search* that makes the player clever, and a
 * value that already knew about type matchups would be double-counting what
 * a turn of lookahead discovers for itself. Integer throughout so that two
 * machines score a position identically.
 */
export function evaluate(state: BattleState, side: SideIndex, matchupWeight = 0): number {
  const other = (1 - side) as SideIndex;
  const health = sideWorth(state.sides[side].team) - sideWorth(state.sides[other].team);
  const outcome = state.outcome;
  if (outcome) {
    if (outcome.t === "win") return health + (outcome.side === side ? WIN_VALUE : -WIN_VALUE);
    return health;
  }
  let worth = health + standingWorth(state.sides[side]) - standingWorth(state.sides[other]);
  // Who is winning the exchange the two on the field are in: what each can
  // do to the other per move, which the health alone cannot see until it has
  // happened. Weighted by the caller, because it is an estimate laid over a
  // count.
  if (matchupWeight) {
    if (state.awaitingSwitch[0] || state.awaitingSwitch[1]) return worth;
    worth += Math.floor((matchupWeight * (reach(state, side) - reach(state, other))) / 1000);
  }
  return worth;
}
