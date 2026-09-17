/**
 * How strong things are at this distance from the hub.
 *
 * Ring 1 has to sit *below* the level 5 starter, or the first patch of grass
 * outside the hub is unwinnable and the game opens by killing you. Each ring
 * out is worth another eight levels, which puts the outermost in the forties.
 *
 * Its own file so that the quest text can quote a bracket without importing
 * the world generator.
 */
export function levelForRing(ring: number): number {
  return 3 + (ring - 1) * 8;
}

/** How far a wild creature's level strays from `levelForRing`, either way. */
export const WILD_LEVEL_SPREAD = 2;

/**
 * The levels a route's grass can hold, lowest and highest — what its name
 * shows in brackets. The same arithmetic `wildAt` rolls in, so the bracket on
 * the sign is the truth about the grass.
 */
export function levelBracket(ring: number): [number, number] {
  const centre = levelForRing(ring);
  return [Math.max(2, centre - WILD_LEVEL_SPREAD), Math.max(2, centre + WILD_LEVEL_SPREAD)];
}
