import { BATTLE_STAT_IDS, type StatId, type StatTable, zeroStats } from "./types";

/**
 * Natures, as additive vectors rather than multipliers.
 *
 * Vanilla multiplies one stat by 1.1 and another by 0.9, which reads simply
 * but computes awkwardly: the multiplier lands after a floor, so the same
 * nature is worth a different number of points on different base stats, and
 * no UI can honestly tell a player where their points came from. An additive
 * vector keeps the pipeline linear and inspectable.
 *
 * The magnitude is the part worth getting right. At level 50 one point of the
 * pre-multiplication term is worth half a stat point, so a vanilla nature —
 * ±10% around a stat near 120 — is worth about ±12 points. A vector on the
 * IV scale (±6) would be worth ±3, which is invisible. NATURE_MAGNITUDE is
 * therefore 24, and the nature term lives outside the 0..31 IV range rather
 * than inside it.
 *
 * The 25 names and their up/down stat pairs are vanilla's, deliberately:
 * anyone who has played knows Adamant trades special attack for attack, and
 * spending that familiarity buys nothing. Richer vectors — two up, two down —
 * are possible within this representation if the format ever wants them.
 */

export const NATURE_MAGNITUDE = 24;

export interface Nature {
  id: string;
  name: string;
  /** The stat raised, or null for a neutral nature. */
  plus: Exclude<StatId, "hp"> | null;
  /** The stat lowered, or null for a neutral nature. */
  minus: Exclude<StatId, "hp"> | null;
}

/** The vanilla 25, in dex order: five neutrals and twenty trades. */
export const NATURES: readonly Nature[] = [
  { id: "hardy", name: "Hardy", plus: null, minus: null },
  { id: "lonely", name: "Lonely", plus: "atk", minus: "def" },
  { id: "brave", name: "Brave", plus: "atk", minus: "spe" },
  { id: "adamant", name: "Adamant", plus: "atk", minus: "spa" },
  { id: "naughty", name: "Naughty", plus: "atk", minus: "spd" },
  { id: "bold", name: "Bold", plus: "def", minus: "atk" },
  { id: "docile", name: "Docile", plus: null, minus: null },
  { id: "relaxed", name: "Relaxed", plus: "def", minus: "spe" },
  { id: "impish", name: "Impish", plus: "def", minus: "spa" },
  { id: "lax", name: "Lax", plus: "def", minus: "spd" },
  { id: "timid", name: "Timid", plus: "spe", minus: "atk" },
  { id: "hasty", name: "Hasty", plus: "spe", minus: "def" },
  { id: "serious", name: "Serious", plus: null, minus: null },
  { id: "jolly", name: "Jolly", plus: "spe", minus: "spa" },
  { id: "naive", name: "Naive", plus: "spe", minus: "spd" },
  { id: "modest", name: "Modest", plus: "spa", minus: "atk" },
  { id: "mild", name: "Mild", plus: "spa", minus: "def" },
  { id: "quiet", name: "Quiet", plus: "spa", minus: "spe" },
  { id: "bashful", name: "Bashful", plus: null, minus: null },
  { id: "rash", name: "Rash", plus: "spa", minus: "spd" },
  { id: "calm", name: "Calm", plus: "spd", minus: "atk" },
  { id: "gentle", name: "Gentle", plus: "spd", minus: "def" },
  { id: "sassy", name: "Sassy", plus: "spd", minus: "spe" },
  { id: "careful", name: "Careful", plus: "spd", minus: "spa" },
  { id: "quirky", name: "Quirky", plus: null, minus: null },
];

/** Ids in dex order. Anything picking a nature at random draws from this, so
 * the index a roll lands on means the same thing everywhere. */
export const NATURE_IDS: readonly string[] = NATURES.map((n) => n.id);

const BY_ID = new Map(NATURES.map((n) => [n.id, n]));

export function nature(id: string): Nature {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`unknown nature: ${id}`);
  return found;
}

/**
 * The vector a nature contributes, in the same units as an IV.
 *
 * Always sums to zero across the five battle stats, so no nature is a free
 * gain and the choice is a genuine trade.
 */
export function natureVector(id: string): StatTable {
  const { plus, minus } = nature(id);
  const vector = zeroStats();
  if (plus) vector[plus] += NATURE_MAGNITUDE;
  if (minus) vector[minus] -= NATURE_MAGNITUDE;
  return vector;
}

/** Guards the invariant above, and is worth asserting in a test: a nature
 * that quietly stopped summing to zero would be a balance bug nobody spots. */
export function natureVectorSum(id: string): number {
  const vector = natureVector(id);
  return BATTLE_STAT_IDS.reduce((total, stat) => total + vector[stat], 0);
}
