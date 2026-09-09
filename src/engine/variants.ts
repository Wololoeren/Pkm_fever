import type { StatTable } from "./types";

/**
 * The eleven appearances a creature can wear, and what each is worth.
 *
 * Multipliers are per-mille integers — 1085 is x1.085 — and applied as
 * `floor(stat * mult / 1000)`. Floating-point multiplication would be easier
 * to read and would drift between engines; a save file has to outlive that
 * convenience.
 *
 * On the size of the numbers: a flat multiplier on *every* stat is far
 * stronger than it feels. On a stat of 120, x1.15 is +18 points, which is
 * more than the entire 0..31 IV range is worth (15). At that size the
 * competitive question stops being "who bred well" and becomes "who got
 * lucky". The true shiny is therefore x1.085 — about +10 points, roughly one
 * nature step. Clearly worth hunting, never the only thing that matters.
 *
 * `census` is the count placed per world, not a probability. See world.ts:
 * variants are positioned during world generation rather than rolled at an
 * encounter, which is what turns shiny hunting into exploration and makes two
 * players on one seed exactly equal.
 */

export type VariantKind = "normal" | "tint" | "chroma" | "shiny";

export interface Variant {
  id: string;
  name: string;
  kind: VariantKind;
  /**
   * How far along the normal -> shiny palette this sits, per mille. The
   * renderer interpolates the two source sprites in OKLab by this amount;
   * a straight sRGB lerp muddies pixel art badly through the midpoint.
   */
  mix: number;
  /**
   * Hue rotation in degrees applied in OKLCh, keeping lightness and chroma.
   * That is what "colours transformed, contrast preserved" means precisely,
   * and it keeps every chroma legible against the same battle backgrounds.
   */
  hueShift: number;
  /** Per-mille multiplier per stat. */
  mult: StatTable;
  /** How many exist in one world. Zero means "everything else". */
  census: number;
}

const flat = (n: number): StatTable => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });

/** Chroma forms are sidegrades: two stats up hard, one down, rest untouched.
 * Each favours an archetype, so finding one suggests a team rather than
 * simply being better than what you had. */
const chroma = (up: [keyof StatTable, keyof StatTable], down: keyof StatTable): StatTable => {
  const mult = flat(1000);
  mult[up[0]] = 1100;
  mult[up[1]] = 1100;
  mult[down] = 970;
  return mult;
};

export const VARIANTS: readonly Variant[] = [
  { id: "normal", name: "Normal", kind: "normal", mix: 0, hueShift: 0, mult: flat(1000), census: 0 },

  { id: "tint1", name: "Faded", kind: "tint", mix: 200, hueShift: 0, mult: flat(1015), census: 18 },
  { id: "tint2", name: "Washed", kind: "tint", mix: 400, hueShift: 0, mult: flat(1030), census: 12 },
  { id: "tint3", name: "Turning", kind: "tint", mix: 600, hueShift: 0, mult: flat(1045), census: 7 },
  { id: "tint4", name: "Nearly", kind: "tint", mix: 800, hueShift: 0, mult: flat(1060), census: 3 },

  { id: "ember", name: "Ember", kind: "chroma", mix: 1000, hueShift: 30, mult: chroma(["atk", "spe"], "def"), census: 1 },
  { id: "tide", name: "Tide", kind: "chroma", mix: 1000, hueShift: 100, mult: chroma(["def", "spd"], "spe"), census: 1 },
  { id: "static", name: "Static", kind: "chroma", mix: 1000, hueShift: 170, mult: chroma(["spa", "spe"], "hp"), census: 1 },
  { id: "verdant", name: "Verdant", kind: "chroma", mix: 1000, hueShift: 240, mult: chroma(["hp", "def"], "spa"), census: 1 },
  { id: "umbral", name: "Umbral", kind: "chroma", mix: 1000, hueShift: 300, mult: chroma(["spa", "spd"], "atk"), census: 1 },

  { id: "shiny", name: "Shiny", kind: "shiny", mix: 1000, hueShift: 0, mult: flat(1085), census: 1 },
];

const BY_ID = new Map(VARIANTS.map((v) => [v.id, v]));

export function variant(id: string): Variant {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`unknown variant: ${id}`);
  return found;
}

/**
 * Which step of the tint ladder this is, 1 to 4, or 0 for anything else.
 *
 * Derived from the mix rather than parsed out of the id, so renaming a variant
 * cannot silently change what a badge says.
 */
export function tintTier(id: string): number {
  const form = variant(id);
  return form.kind === "tint" ? Math.round(form.mix / 200) : 0;
}

/** How much better or worse this form is, as a percentage, for a tooltip. */
export function variantSummary(id: string): string {
  const form = variant(id);
  if (form.kind === "normal") return "Ordinary.";

  const parts = STAT_LABEL_ORDER.filter((stat) => form.mult[stat] !== 1000).map(
    (stat) => `${stat} ${form.mult[stat] > 1000 ? "+" : ""}${((form.mult[stat] - 1000) / 10).toFixed(1)}%`,
  );
  return parts.length ? `${form.name} — ${parts.join(", ")}` : form.name;
}

const STAT_LABEL_ORDER: (keyof StatTable)[] = ["hp", "atk", "def", "spa", "spd", "spe"];

/** Every variant that is placed during world generation, rarest last. */
export const PLACED_VARIANTS: readonly Variant[] = VARIANTS.filter((v) => v.census > 0);

/** How many special creatures exist in any world. Useful in the UI ("3 of 46
 * found") and as a test that the census tables have not drifted. */
export const CENSUS_TOTAL = PLACED_VARIANTS.reduce((total, v) => total + v.census, 0);
