import { species as speciesById } from "./dex";
import { EV_MAX_PER_STAT, EV_MAX_TOTAL } from "./stats";
import { STAT_IDS, type Individual, type StatId, type StatTable } from "./types";

/**
 * Effort: the part of a creature's strength that comes from what it fought.
 *
 * IVs are what a creature was born with and breeding is the slow way to move
 * them. Effort is the opposite number — it moves in an afternoon, it is
 * directed by choice rather than luck, and it is the only stat input a player
 * controls completely. Between them they answer the two questions a stat
 * screen should: what did you inherit, and what did you do about it.
 *
 * Four effort points are worth one stat point at level 100 and half of one at
 * level 50, which is the vanilla exchange rate and is already what
 * `computeStat` does with `floor(ev / 4)`. Nothing here changes that; this
 * file only decides who earns what.
 *
 * What a species yields is *derived from its base stats* rather than carried
 * in the manifest. Showdown's dex has no effort yield to copy, and inventing a
 * table of 1,134 hand-authored numbers would be a lie dressed as data. A
 * species yields effort in the thing it is best at, which is both the rule the
 * real games mostly follow and the one a player can work out by looking.
 */

/** The most effort a single defeat can be worth. */
const YIELD_SMALL = 1;
const YIELD_MEDIUM = 2;
const YIELD_LARGE = 3;

/** Where a species stops being a low-stage creature, by base stat total. */
const MEDIUM_BST = 400;
const LARGE_BST = 500;

/**
 * A second stat shares the yield when it is within this much of the best one.
 *
 * Without it a creature genuinely good at two things — Shuckle's two defences,
 * say — would arbitrarily teach one of them. Kept narrow on purpose: at ten
 * points it swept HP into most yields, because a lot of species carry HP just
 * under whatever they are actually for, and "train against Machop for Attack"
 * quietly became "for Attack and HP".
 */
const SHARE_WINDOW = 5;

/**
 * At most two stats ever share a yield.
 *
 * The amount is paid to *each* sharing stat, so without a cap a flat species
 * pays more in total than a specialist does — Swinub has three stats level at
 * 50 and was handing out three points where a Machamp hands out three in one
 * place. That is worse than it sounds: the 510 budget is meant to be spent
 * deliberately, and a creature that quietly fills it with a spread nobody
 * asked for is a trap rather than a choice.
 */
const MAX_SHARED = 2;

export interface EffortYield {
  stats: StatId[];
  amount: number;
}

/** What beating this species is worth, and in what. */
export function effortYield(speciesId: string): EffortYield {
  const base = speciesById(speciesId).base;
  const total = STAT_IDS.reduce((sum, stat) => sum + base[stat], 0);
  const best = Math.max(...STAT_IDS.map((stat) => base[stat]));

  // Best first, and ties broken by the canonical stat order so the answer is
  // the same on every machine.
  const shared = STAT_IDS.filter((stat) => base[stat] >= best - SHARE_WINDOW)
    .sort((a, b) => base[b] - base[a] || STAT_IDS.indexOf(a) - STAT_IDS.indexOf(b))
    .slice(0, MAX_SHARED);

  return {
    stats: shared,
    amount: total >= LARGE_BST ? YIELD_LARGE : total >= MEDIUM_BST ? YIELD_MEDIUM : YIELD_SMALL,
  };
}

/**
 * The effort a creature has after beating one of these.
 *
 * Both caps are enforced here rather than at the point of display, because a
 * creature carrying 300 in a stat and showing 252 would compute one set of
 * numbers and replay as another. The per-stat cap is applied first: overflow
 * does not spill into another stat, it is simply not earned.
 */
export function gainEffort(evs: StatTable, yielded: EffortYield): StatTable {
  const next = { ...evs };
  let spent = STAT_IDS.reduce((sum, stat) => sum + next[stat], 0);

  for (const stat of yielded.stats) {
    if (spent >= EV_MAX_TOTAL) break;
    const room = Math.min(EV_MAX_PER_STAT - next[stat], EV_MAX_TOTAL - spent);
    const gain = Math.max(0, Math.min(yielded.amount, room));
    next[stat] += gain;
    spent += gain;
  }

  return next;
}

/** How much effort is spent and how much is left, for the stat screen. */
export function effortSpent(evs: StatTable): number {
  return STAT_IDS.reduce((sum, stat) => sum + evs[stat], 0);
}

/** Whether this creature can still earn effort anywhere. */
export function effortFull(creature: Individual): boolean {
  return effortSpent(creature.evs) >= EV_MAX_TOTAL;
}
