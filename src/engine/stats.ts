import { natureVector } from "./natures";
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

/** Wild creatures roll IVs in [0, WILD_IV_MAX]. One fifth of the ceiling, so
 * a caught creature is a starting point rather than a lottery ticket, and
 * breeding is the only route to a competitive individual. */
export const WILD_IV_MAX = 6;

/** The ceiling breeding can climb to. */
export const IV_MAX = 31;

export const EV_MAX_PER_STAT = 252;
export const EV_MAX_TOTAL = 510;

/**
 * The stat a creature has right now, before any in-battle stage modifiers.
 */
export function computeStats(species: SpeciesEntry, individual: Individual): StatTable {
  const { level, ivs, evs, natureId, variantId } = individual;
  const nature = natureVector(natureId);
  const mult = variant(variantId).mult;

  const out = {} as StatTable;
  for (const stat of STAT_IDS) {
    out[stat] = computeStat(species.base[stat], stat, level, ivs[stat], evs[stat], nature[stat], mult[stat]);
  }
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
