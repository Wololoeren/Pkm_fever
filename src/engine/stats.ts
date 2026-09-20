import { temperedNature } from "./abilities";
import { natureVector } from "./natures";
import { intBelow, type Rng } from "./rng";
import { STAT_IDS, type Individual, type SpeciesEntry, type StatId, type StatTable } from "./types";
import { variant } from "./variants";

/**
 * Turning a creature into the six numbers a battle actually uses.
 *
 * Integer arithmetic throughout, with the floors written where the formula
 * puts them. Nothing here is ever cached on the individual: stats are derived
 * from (species, level, IVs, EVs, nature, variant) every time they are
 * needed, because a stored stat is a cache that can only ever be wrong after
 * a level-up, an EV gain, or a rules change.
 *
 * The pipeline, in order:
 *
 *   raw   = 2*base + IV + nature + floor(EV/4)      nature only on the five
 *   stat  = floor(raw * level / 100) + 5            (+level+10 for HP)
 *   final = floor(stat * variant / 1000)
 *
 * Vanilla's nature multiplier is gone; see natures.ts for why an additive
 * vector is both cleaner and — at magnitude 24 — worth exactly as much.
 */

/**
 * What a wild roll used to be capped at, and what breeding still measures
 * itself against: a stat of six is an average wild stat. Nothing rolls
 * against this any more — see `IV_WEIGHTS` — but the number is the same
 * number, and the daycare's arithmetic is written in terms of it.
 */
export const WILD_IV_MAX = 6;

/** The ceiling breeding can climb to. */
export const IV_MAX = 31;

export const EV_MAX_PER_STAT = 252;
export const EV_MAX_TOTAL = 510;

/**
 * The stat a creature has right now, before any in-battle stage modifiers.
 */
export function computeStats(species: SpeciesEntry, individual: Individual): StatTable {
  const { level, ivs, evs, variantId } = individual;
  const nature = natureTerms(individual);
  const mult = variant(variantId).mult;

  const out = {} as StatTable;
  for (const stat of STAT_IDS) {
    out[stat] = computeStat(species.base[stat], stat, level, ivs[stat], evs[stat], nature[stat], mult[stat]);
  }
  return out;
}

/**
 * What its nature adds to each stat's raw sum, after any ability that makes a
 * nature count for more (Strong-Willed and the rest). The stat screen reads
 * this too, so the column it draws is the number the battle uses.
 */
export function natureTerms(individual: Pick<Individual, "natureId" | "abilities">): StatTable {
  const vector = natureVector(individual.natureId);
  const out = {} as StatTable;
  for (const stat of STAT_IDS) out[stat] = temperedNature(individual.abilities ?? [], vector[stat]);
  return out;
}

/**
 * One stat, exposed on its own so tests can pin the arithmetic without
 * building a whole individual.
 */
export function computeStat(
  base: number,
  stat: StatId,
  level: number,
  iv: number,
  ev: number,
  natureTerm: number,
  variantMult: number,
): number {
  const raw = 2 * base + iv + (stat === "hp" ? 0 : natureTerm) + Math.floor(ev / 4);
  const scaled = Math.floor(Math.max(0, raw) * level / 100);
  const before = stat === "hp" ? scaled + level + 10 : scaled + 5;
  return Math.floor(before * variantMult / 1000);
}

/**
 * What one term of the raw sum is worth at this level, and at the cap.
 *
 * The pipeline scales the whole of `raw` by `level / 100`, so at level five a
 * base of 45 is contributing four points rather than ninety — which is the
 * single most common thing to be confused by on a stat screen, because the
 * number the dex quotes and the number in the battle look nothing alike.
 *
 * The scaling is applied once, to the sum, so the shares shown here are each
 * term's own scaling and will not always add to the total exactly. Off by at
 * most a point or two, and it is the difference between "why is my base 45
 * only giving me 20 HP" being answerable at a glance or not at all.
 */
export function termAtLevel(term: number, level: number): { now: number; max: number } {
  return {
    now: Math.floor(Math.max(0, term) * level / 100),
    max: Math.max(0, term),
  };
}

/** Where every point of one stat came from. The columns add to `total`. */
export interface StatBreakdown {
  base: number;
  iv: number;
  nature: number;
  ev: number;
  /** +5, or level + 10 on HP. */
  flat: number;
  /** What the variant multiplier added (or took) after everything else. */
  special: number;
  total: number;
  /** The unscaled sum, 2*base + IV + nature + floor(EV/4). */
  raw: number;
}

/**
 * The same arithmetic as computeStat, split so the parts add up exactly.
 *
 * Scaling each term on its own and summing loses points to rounding — at
 * level one a base of 190 and an IV of 31 are "1 + 0" apart but 2 together.
 * So the terms are added in pipeline order and each is credited with what the
 * running sum gained when it joined: the IV that tips 190 over 200 gets the
 * point it tipped. The attribution depends on the order; the total does not.
 */
export function statBreakdown(
  base: number,
  stat: StatId,
  level: number,
  iv: number,
  ev: number,
  natureTerm: number,
  variantMult: number,
): StatBreakdown {
  const scale = (sum: number) => Math.floor(Math.max(0, sum) * level / 100);
  const terms = [2 * base, iv, stat === "hp" ? 0 : natureTerm, Math.floor(ev / 4)];

  const shares: number[] = [];
  let sum = 0;
  for (const term of terms) {
    const before = scale(sum);
    sum += term;
    shares.push(scale(sum) - before);
  }

  const flat = stat === "hp" ? level + 10 : 5;
  const unmultiplied = scale(sum) + flat;
  const total = Math.floor(unmultiplied * variantMult / 1000);

  return {
    base: shares[0],
    iv: shares[1],
    nature: shares[2],
    ev: shares[3],
    flat,
    special: total - unmultiplied,
    total,
    raw: sum,
  };
}

/** A term's share now, keeping its sign — a nature can take points away, and
 * the scaling rounds toward zero so −24 at level one is worth nothing rather
 * than a whole point off. */
export function signedAtLevel(term: number, level: number): number {
  return Math.sign(term) * Math.floor(Math.abs(term) * level / 100);
}

/** What a base stat contributes: doubled, then scaled by level. */
export function baseAtLevel(base: number, level: number): { now: number; max: number } {
  return termAtLevel(2 * base, level);
}

/** Clamps an IV table into the legal range. Used wherever IVs are produced —
 * a wild roll, an egg, a debug command — so no path can mint an out-of-range
 * individual that later replays differently. */
export function clampIvs(ivs: StatTable): StatTable {
  const out = {} as StatTable;
  for (const stat of STAT_IDS) out[stat] = Math.min(IV_MAX, Math.max(0, Math.floor(ivs[stat])));
  return out;
}

/** Total IVs, the number the breeding UI actually wants to show. */
export function ivTotal(ivs: StatTable): number {
  return STAT_IDS.reduce((total, stat) => total + ivs[stat], 0);
}

/**
 * How a creature born in the world rolls one stat.
 *
 * Nothing is capped any more. The old rule — a flat nought to six in the
 * grass — made a wild catch a starting point by *forbidding* anything else,
 * which is a rule you can read off a sheet and never think about again. This
 * is the same promise made by arithmetic instead: the average is still six,
 * so nothing about the game's numbers moves, and a perfect stat is possible
 * and costs one in six thousand.
 *
 * The shape is a stretched exponential, `exp(-(k/10.467)^1.72)`, which is the
 * one family that lets the mean and the tail be chosen separately. A plain
 * geometric with this mean would deal a 31 eight times too often; a Poisson
 * with this mean would never deal one at all.
 *
 * Written down as weights out of a million rather than computed, because a
 * distribution the engine derives is a distribution that can drift when
 * somebody touches the arithmetic. These numbers are the contract; the test
 * pins the mean and the tail against them.
 *
 * Half of all stats land at five or less. One in five is ten or better, one
 * in fifty-three is twenty or better, and 0.016% is a 31 — which is one
 * creature in a thousand carrying one somewhere.
 */
export const IV_WEIGHTS: readonly number[] = [
  101742, 99966, 96006, 90548, 84037, 76847, 69300, 61674,
  54197, 47049, 40364, 34235, 28715, 23824, 19557, 15888,
  12776, 10171, 8017, 6259, 4840, 3707, 2813, 2115,
  1576, 1164, 852, 618, 445, 317, 224, 157,
];

/** What those weights add up to: one roll, out of a million. */
export const IV_WEIGHT_TOTAL = IV_WEIGHTS.reduce((sum, weight) => sum + weight, 0);

/** The average of the table — six, which is what everything else was tuned against. */
export const IV_MEAN = IV_WEIGHTS.reduce((sum, weight, at) => sum + weight * at, 0) / IV_WEIGHT_TOTAL;

/**
 * One stat, rolled off the table.
 *
 * One draw per stat, so a creature costs six draws exactly as it always did
 * and nothing downstream of it shifts.
 */
export function rollIv(rng: Rng): number {
  let at = intBelow(rng, IV_WEIGHT_TOTAL);
  for (let value = 0; value < IV_WEIGHTS.length; value++) {
    at -= IV_WEIGHTS[value];
    if (at < 0) return value;
  }
  return IV_WEIGHTS.length - 1;
}

/** Six of them. */
export function rollIvs(rng: Rng): StatTable {
  const ivs = {} as StatTable;
  for (const stat of STAT_IDS) ivs[stat] = rollIv(rng);
  return ivs;
}
