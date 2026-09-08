/**
 * Every random thing the game does is derived from one seed, fixed when the
 * world is created. Nothing is rolled at the moment it is needed.
 *
 * That is the whole architecture in one file. Because a creature's stats, its
 * variant and its position in an encounter table are all pure functions of
 * (seed, place, index), rewinding and walking back into the same grass gives
 * you *the same creature*. There is nothing to reset for and nothing to
 * scum, and two players on one seed inhabit the same world.
 *
 * The generator only has to be uniform and identical everywhere — not
 * cryptographic. mulberry32 is eight lines and gives the same 32-bit
 * arithmetic in every JS engine. Where a real secret is needed (commit-reveal
 * in a battle, signing a save) that is WebCrypto's job, in the net and save
 * layers, never in here: the engine is synchronous and must stay so.
 */

/** FNV-1a. Folds a seed string into 32 bits, and fingerprints state for
 * divergence detection. A checksum, deliberately not a security boundary. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A generator for one specific decision, e.g. `rngFor(seed, "encounter", 3, 12)`.
 *
 * Naming the decision rather than threading one stream through the whole game
 * is what makes the world stable under change: adding an item to a shop must
 * not shift which creature lives in the twelfth encounter slot of route 3.
 */
export function rngFor(...parts: (string | number)[]): Rng {
  return mulberry32(hash32(parts.join(" ")));
}

/** Uniform integer in [0, bound). Bound must be a positive integer. */
export function intBelow(rng: Rng, bound: number): number {
  return Math.floor(rng() * bound);
}

/** Uniform integer in [min, max], inclusive both ends. */
export function intBetween(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Fisher-Yates on a copy. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Picks one of `items` by weight. Weights are integers so the choice is exact
 * arithmetic rather than a float comparison that could land differently on a
 * different engine.
 */
export function weighted<T>(rng: Rng, items: readonly T[], weightOf: (item: T) => number): T {
  let total = 0;
  for (const item of items) total += weightOf(item);
  if (total <= 0) throw new Error("weighted: total weight must be positive");

  let roll = intBelow(rng, total);
  for (const item of items) {
    roll -= weightOf(item);
    if (roll < 0) return item;
  }
  // Unreachable while the weights are non-negative integers, but a total
  // ordering beats a possible undefined.
  return items[items.length - 1];
}
