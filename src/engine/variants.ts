import type { StatTable } from "./types";

/**
 * What a creature looks like, on two axes that do not interfere.
 *
 * **Shine** is a ladder of six rungs — ordinary, four tints, then the true
 * shiny — and it multiplies every stat by a little. **Chroma** is a colour,
 * one of eight or none, and it is a sidegrade rather than a step up.
 *
 * They used to be one field, which made "shiny" and "Tide" alternatives and
 * meant a shiny Tide could not exist. They are independent now: an appearance
 * is a rung and a colour, and every one of the 54 combinations is a real
 * thing a creature can be.
 *
 * Multipliers are per-mille integers — 1085 is x1.085 — and applied as
 * `floor(stat * mult / 1000)`. Floating-point multiplication would be easier
 * to read and would drift between engines; a save file has to outlive that
 * convenience. The two axes are folded into one multiplier before the stat
 * pipeline sees them, so a stat is never floored twice.
 *
 * On the size of the numbers: a flat multiplier on *every* stat is far
 * stronger than it feels. On a stat of 120, x1.15 is +18 points, which is
 * more than the entire 0..31 IV range is worth (15). At that size the
 * competitive question stops being "who bred well" and becomes "who got
 * lucky". The true shiny is therefore x1.085 — about +10 points, roughly one
 * nature step. Clearly worth hunting, never the only thing that matters.
 */

/** Rungs on the shine ladder: 0 is ordinary, 5 is a true shiny. */
export const TOP_TIER = 5;
export const TIER_COUNT = TOP_TIER + 1;

const TIER_NAMES = ["Normal", "Faded", "Washed", "Turning", "Nearly", "Shiny"] as const;

/** Flat per-stat multiplier for each rung. */
const TIER_MULT = [1000, 1015, 1030, 1045, 1060, 1085] as const;

/** The id fragment each rung contributes to an appearance id. */
const TIER_IDS = ["normal", "tint1", "tint2", "tint3", "tint4", "shiny"] as const;

const flat = (n: number): StatTable => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });

/**
 * Most chroma forms are sidegrades: two stats up hard, one down, rest
 * untouched. Each favours an archetype, so finding one suggests a team rather
 * than simply being better than what you had.
 */
const chromaMult = (up: [keyof StatTable, keyof StatTable], down: keyof StatTable): StatTable => {
  const mult = flat(1000);
  mult[up[0]] = 1100;
  mult[up[1]] = 1100;
  mult[down] = 970;
  return mult;
};

/**
 * Onyx and Ivory take a different shape, because they are a different kind of
 * thing. The six colours are hue rotations; those two are moves along
 * lightness, which is a separate axis of the same colour space. They spike one
 * stat much harder and pay for it twice, so the pair reads as opposites in
 * both look and use rather than as two more colours.
 */
const spikeMult = (up: keyof StatTable, down: [keyof StatTable, keyof StatTable]): StatTable => {
  const mult = flat(1000);
  mult[up] = 1180;
  mult[down[0]] = 950;
  mult[down[1]] = 950;
  return mult;
};

export interface Chroma {
  id: string;
  name: string;
  /**
   * Hue rotation in degrees applied in OKLCh, keeping lightness and chroma.
   * That is what "colours transformed, contrast preserved" means precisely,
   * and it keeps every chroma legible against the same battle backgrounds.
   */
  hueShift: number;
  /**
   * An absolute OKLCh hue in degrees, for a colour that has to *be* something
   * rather than be rotated. Teal is teal on every species; a rotation would
   * make it teal on some and olive on others.
   */
  hueSet: number | null;
  /** Signed per-mille shift on lightness. This is how black and white happen
   * at all — no rotation reaches them, because neither is a hue. */
  lightShift: number;
  /** Per-mille scale on colourfulness. Draining it is what stops a darkened
   * sprite reading as merely "the same creature in shadow". */
  satScale: number;
  mult: StatTable;
}

const hue = (id: string, name: string, hueShift: number, mult: StatTable): Chroma => ({
  id, name, hueShift, hueSet: null, lightShift: 0, satScale: 1000, mult,
});

export const CHROMAS: readonly Chroma[] = [
  hue("ember", "Ember", 30, chromaMult(["atk", "spe"], "def")),
  hue("tide", "Tide", 100, chromaMult(["def", "spd"], "spe")),
  hue("static", "Static", 170, chromaMult(["spa", "spe"], "hp")),
  hue("verdant", "Verdant", 240, chromaMult(["hp", "def"], "spa")),
  hue("umbral", "Umbral", 300, chromaMult(["spa", "spd"], "atk")),

  // Teal sets its hue instead of turning it, and pulls colourfulness up so it
  // lands on teal rather than near it.
  { id: "teal", name: "Teal", hueShift: 0, hueSet: 195, lightShift: 0, satScale: 1150,
    mult: chromaMult(["spe", "spd"], "def") },

  // The lightness pair. Onyx darkens and drains colour; Ivory does the
  // opposite. Both keep the silhouette, which is the only thing that has to
  // survive for a sprite to still read as its species.
  { id: "onyx", name: "Onyx", hueShift: 0, hueSet: null, lightShift: -380, satScale: 250,
    mult: spikeMult("atk", ["spa", "spe"]) },
  { id: "ivory", name: "Ivory", hueShift: 0, hueSet: null, lightShift: 320, satScale: 200,
    mult: spikeMult("hp", ["atk", "spe"]) },
];

export const CHROMA_IDS: readonly string[] = CHROMAS.map((form) => form.id);

const CHROMA_BY_ID = new Map(CHROMAS.map((form) => [form.id, form]));

export function chroma(id: string): Chroma {
  const found = CHROMA_BY_ID.get(id);
  if (!found) throw new Error(`unknown chroma: ${id}`);
  return found;
}

/** How many distinct appearances exist: six rungs times eight colours or none. */
export const APPEARANCE_COUNT = TIER_COUNT * (CHROMAS.length + 1);

export interface Appearance {
  /** Canonical id, and what a save file stores. */
  id: string;
  name: string;
  /** 0..5 on the shine ladder. */
  tier: number;
  chromaId: string | null;
  /**
   * How far along the normal -> shiny palette this sits, per mille. The
   * renderer interpolates the two source sprites in OKLab by this amount;
   * a straight sRGB lerp muddies pixel art badly through the midpoint.
   */
  mix: number;
  /** The colour transform, copied off the chroma so a renderer never has to
   * look one up. Neutral when there is no chroma. */
  hueShift: number;
  hueSet: number | null;
  lightShift: number;
  satScale: number;
  /** Per-mille multiplier per stat, both axes already folded together. */
  mult: StatTable;
}

/**
 * The canonical id for a rung and a colour.
 *
 * Every id the one-axis model used is still the id for the same thing —
 * "shiny", "tint3", "ember" — so old ids parse and only combinations need
 * new spelling. A combination reads as the rung, a colon, then the colour.
 */
export function appearanceId(tier: number, chromaId: string | null): string {
  if (tier < 0 || tier > TOP_TIER) throw new Error(`no such shine tier: ${tier}`);
  if (chromaId === null) return TIER_IDS[tier];
  chroma(chromaId);
  return tier === 0 ? chromaId : `${TIER_IDS[tier]}:${chromaId}`;
}

const CACHE = new Map<string, Appearance>();

/** The appearance a stored id names. Throws on anything unrecognised, because
 * a save carrying an id this build cannot read is corrupt, not merely odd. */
export function variant(id: string): Appearance {
  const cached = CACHE.get(id);
  if (cached) return cached;

  const built = parse(id);
  CACHE.set(id, built);
  return built;
}

function parse(id: string): Appearance {
  const [head, tail] = id.split(":");

  const tierIndex = TIER_IDS.indexOf(head as (typeof TIER_IDS)[number]);
  const asChroma = CHROMA_BY_ID.get(head);

  // A bare colour is that colour at rung zero; anything else must name a rung.
  const tier = tierIndex >= 0 ? tierIndex : asChroma ? 0 : -1;
  const chromaId = tierIndex >= 0 ? (tail ?? null) : asChroma ? head : null;

  if (tier < 0 || (tail !== undefined && tierIndex < 0)) throw new Error(`unknown variant: ${id}`);
  const colour = chromaId === null ? null : chroma(chromaId);

  const mult = flat(1000);
  for (const stat of Object.keys(mult) as (keyof StatTable)[]) {
    // One rounding, not two: folding the axes before the stat pipeline runs
    // is what stops a shiny Tide differing from a Tide shiny.
    mult[stat] = Math.round((TIER_MULT[tier] * (colour ? colour.mult[stat] : 1000)) / 1000);
  }

  return {
    id: appearanceId(tier, chromaId),
    name: nameOf(tier, colour),
    tier,
    chromaId,
    mix: (tier * 1000) / TOP_TIER,
    hueShift: colour?.hueShift ?? 0,
    hueSet: colour?.hueSet ?? null,
    lightShift: colour?.lightShift ?? 0,
    satScale: colour?.satScale ?? 1000,
    mult,
  };
}

function nameOf(tier: number, colour: Chroma | null): string {
  if (!colour) return TIER_NAMES[tier];
  return tier === 0 ? colour.name : `${TIER_NAMES[tier]} ${colour.name}`;
}

/** Which rung of the shine ladder this is, 0 to 5. */
export function tintTier(id: string): number {
  return variant(id).tier;
}

/** Whether this is anything other than an ordinary creature. */
export function isSpecial(id: string): boolean {
  const form = variant(id);
  return form.tier > 0 || form.chromaId !== null;
}

/** How much better or worse this form is, as a percentage, for a tooltip. */
export function variantSummary(id: string): string {
  const form = variant(id);
  if (!isSpecial(id)) return "Ordinary.";

  const parts = STAT_LABEL_ORDER.filter((stat) => form.mult[stat] !== 1000).map(
    (stat) => `${stat} ${form.mult[stat] > 1000 ? "+" : ""}${((form.mult[stat] - 1000) / 10).toFixed(1)}%`,
  );
  return parts.length ? `${form.name} — ${parts.join(", ")}` : form.name;
}

const STAT_LABEL_ORDER: (keyof StatTable)[] = ["hp", "atk", "def", "spa", "spd", "spe"];

/** Every appearance there is, ordinary first. Drives the cheat menu and the
 * "n of 35 found" counter. */
export const ALL_APPEARANCES: readonly string[] = Array.from({ length: TIER_COUNT }, (_, tier) => [
  appearanceId(tier, null),
  ...CHROMA_IDS.map((id) => appearanceId(tier, id)),
]).flat();

/**
 * What world generation places, and how deep.
 *
 * `count` is the number per world, not a probability: variants are positioned
 * during world generation rather than rolled at an encounter, which is what
 * turns shiny hunting into exploration and makes two players on one seed
 * exactly equal.
 *
 * `depth` is how far out a copy may sit: 1 anywhere, 2 the outer third, 3 the
 * outermost ring only. The tint ladder is scattered everywhere; a colour asks
 * for a journey; the one shiny chroma in a world sits at the edge of it.
 */
export interface CensusEntry {
  id: string;
  count: number;
  depth: 1 | 2 | 3;
}

export const CENSUS_PLAN: readonly CensusEntry[] = [
  { id: "tint1", count: 18, depth: 1 },
  { id: "tint2", count: 12, depth: 1 },
  { id: "tint3", count: 7, depth: 1 },
  { id: "tint4", count: 3, depth: 1 },

  ...CHROMA_IDS.map((id): CensusEntry => ({ id, count: 1, depth: 2 })),

  // One tinted example of each colour, so a combination is something the
  // world shows you before it asks you to breed one. The rung climbs with the
  // list so the eight are not interchangeable.
  ...CHROMA_IDS.map((id, index): CensusEntry => ({ id: appearanceId(1 + (index % 4), id), count: 1, depth: 2 })),

  { id: "shiny", count: 1, depth: 2 },
];

/** How many special creatures exist in any world — the plan, plus the one
 * shiny chroma whose colour the seed chooses. Useful in the UI ("3 of 52
 * found") and as a test that the census tables have not drifted. */
export const CENSUS_TOTAL = CENSUS_PLAN.reduce((total, entry) => total + entry.count, 0) + 1;
