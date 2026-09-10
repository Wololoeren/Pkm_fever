import { move as moveById } from "./dex";
import type { Individual } from "./types";

/**
 * How many times a creature can use each of its moves.
 *
 * The one resource in this game that is spent by playing well rather than by
 * playing badly. Health is lost to mistakes and restored by items; power
 * points are spent by every single attack that lands, and nothing in the bag
 * brings them back. That makes a long walk out to the sixth ring a decision
 * about *stamina* rather than about hit points, and it is why the outer rings
 * are somewhere you go with a plan instead of somewhere you grind.
 *
 * There is deliberately no Ether and no Elixir. Points come back in exactly
 * two places — a full restore of the whole party at the centre, and being
 * beaten, which restores the party anyway — so the question a player asks
 * before stepping into the grass again is "can I still fight?" and not "how
 * many bottles am I carrying?".
 *
 * Stored as a list beside `moves` rather than a table keyed by move id: a
 * creature can be offered the same move twice over a lifetime, the slots are
 * what the battle menu addresses, and two lists that must stay the same length
 * are easier to keep honest than a map that can hold keys for moves nothing
 * knows any more. `alignPp` is the one function that keeps them in step.
 */

/** What a move holds when it is fresh. */
export function maxPp(moveId: string): number {
  return moveById(moveId).pp;
}

/** A full set, for a creature that has just been made. */
export function fullPp(moves: readonly string[]): number[] {
  return moves.map(maxPp);
}

/** What is left in this slot. A slot with no entry reads as full, which is
 * what lets an older save load without a migration. */
export function ppLeft(creature: Individual, index: number): number {
  const moveId = creature.moves[index];
  if (moveId === undefined) return 0;
  return creature.pp[index] ?? maxPp(moveId);
}

/** Whether this slot can still be used. */
export function hasPp(creature: Individual, index: number): boolean {
  return ppLeft(creature, index) > 0;
}

/**
 * Whether anything is left at all.
 *
 * False is what forces Struggle, which is the whole reason a battle cannot
 * become unwinnable and unleavable at the same time.
 */
export function anyPp(creature: Individual): boolean {
  return creature.moves.some((_, index) => hasPp(creature, index));
}

/** One use, spent. */
export function spendPp(creature: Individual, index: number): Individual {
  const pp = creature.moves.map((_, at) => ppLeft(creature, at));
  pp[index] = Math.max(0, pp[index] - 1);
  return { ...creature, pp };
}

/** Everything back. Only a full restore of the party ever calls this. */
export function restorePp(creature: Individual): Individual {
  return { ...creature, pp: fullPp(creature.moves) };
}

/**
 * Keeps the two lists the same length and the same order.
 *
 * Called wherever a moveset changes. A move that survives the change keeps
 * what it had spent — forgetting Tackle should not quietly refill Surf — and
 * anything new arrives fresh. Nothing here is a way to restore points: the
 * only place a moveset can be rebuilt is town, where the centre will do it
 * for nothing anyway.
 */
export function alignPp(creature: Individual, before?: Individual): Individual {
  const had = new Map<string, number>();
  const from = before ?? creature;
  from.moves.forEach((moveId, at) => {
    if (!had.has(moveId)) had.set(moveId, ppLeft(from, at));
  });

  return {
    ...creature,
    pp: creature.moves.map((moveId) => Math.min(maxPp(moveId), had.get(moveId) ?? maxPp(moveId))),
  };
}

/** The move a creature with nothing left is reduced to. */
export const STRUGGLE = "struggle";

/** What Struggle costs its user, as a fraction of full health.
 *
 * A quarter, and taken from the user's own maximum rather than from the damage
 * dealt — which is the one thing the manifest cannot say, because Showdown
 * computes it in a script and `@pkmn/dex` ships data. Same reason moves.ts
 * exists. */
export const STRUGGLE_RECOIL: readonly [number, number] = [1, 4];
