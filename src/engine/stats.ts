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
