import { NATURE_IDS, nature } from "./natures";
import { intBelow, type Rng } from "./rng";
import { STAT_IDS, type Individual, type StatId } from "./types";

/**
 * The smith: a new nature, paid for in breeding.
 *
 * He puts a creature on the anvil and hits it with a hammer, and it gets up
 * with a different temperament — and one point fewer in one of its IVs,
 * because a hammer is not a precision instrument.
 *
 * ## Where he sits beside a Mint
 *
 * A Mint already sets a nature, exactly, for money. The smith is the other
 * trade: free of money, but *random*, and paid for in the one resource this
 * game refuses to sell. Breeding is the IV system — ten to fifteen generations
 * to perfect a single stat, as `items.ts` puts it — so an IV point is worth a
 * great deal more than a Mint's price, and that is what makes the smith a
 * decision rather than a shortcut.
 *
 * ## Why no cooldown
 *
 * The other people in the game who change a creature have a thousand moves
 * between goes, because what they pay out could otherwise be farmed. This one
 * cannot be, and the reason is the cost itself: a creature has at most one
 * hundred and eighty-six IV points, and fishing for one particular nature out
 * of twenty-four others costs about twenty-four of them. The IVs run out long
 * before the patience does. A gate on top of that would be a second limit on
 * something already limited.
 *
 * ## Why the new nature is always a *different* one
 *
 * Because the price is paid either way. A reroll that could land where it
 * started would take an IV point for nothing a quarter of the time on a
 * four-way table and one time in twenty-five here — which is exactly the kind
 * of result a player remembers and the kind of rule nobody can defend.
 */

/** How many IV points a swing costs. */
export const REFORGE_COST = 1;

/**
 * The nature it gets up with.
 *
 * Drawn from the other twenty-four, uniformly. Uniform rather than weighted
 * toward the neutral five or away from them: a smith with an opinion about
 * which temperament you ought to have is a smith selling something.
 */
export function nextNature(rng: Rng, current: string): string {
  const others = NATURE_IDS.filter((id) => id !== current);
  return others[intBelow(rng, others.length)];
}

/**
 * Which IV takes the dent.
 *
 * Any of the six with a point left in it, uniformly. A stat already at nought
 * is not a candidate — you cannot take a point from nothing, and a swing that
 * landed on an empty stat and cost nothing would be a free reroll hidden
 * inside a rule about rounding.
 *
 * Null when there is nothing left to take anywhere, which is a creature with
 * every IV at nought — and the one creature he will not touch.
 */
export function chippedStat(rng: Rng, ivs: Individual["ivs"]): StatId | null {
  const candidates = STAT_IDS.filter((stat) => ivs[stat] > 0);
  if (!candidates.length) return null;
  return candidates[intBelow(rng, candidates.length)];
}

/** Whether a creature has anything left for the hammer to take. */
export function hasIvsLeft(creature: Individual): boolean {
  return STAT_IDS.some((stat) => creature.ivs[stat] > 0);
}

/** A nature's name, for the notice and the panel. */
export function natureName(id: string): string {
  return nature(id).name;
}
