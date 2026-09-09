import { intBetween, type Rng } from "./rng";

/**
 * What a place is made of, and how one gets built.
 *
 * The first world was a 24x18 box with a cross carved through it and blocks
 * scattered at random. It read as a grid because it was one: every route had
 * the same shape, the path went exactly through the middle, and nothing on it
 * was anywhere for a reason.
 *
 * This is the vocabulary a place needs instead — ground you walk on, ground
 * that hides things, water and rock you go round, and buildings you go into —
 * plus the handful of operations that put them somewhere believable: a path
 * that wanders, clumps that grow, and structures that sit against the path
 * rather than floating in a field.
 */

export const TILE = {
  /** Trodden ground. Walkable, and nothing lives in it. */
  PATH: 0,
  /** Tall grass. Walkable, and the only place an encounter starts. */
  GRASS: 1,
  /** Short grass. Walkable, empty — most of a route's ground. */
  MEADOW: 2,
  TREE: 3,
  ROCK: 4,
  WATER: 5,
  /** Planted ground. Walkable, and purely somewhere to look at. */
  FLOWER: 6,
  SAND: 7,
  /** A building's body and roof. */
  WALL: 8,
  ROOF: 9,
  /** The one tile of a building you can step on, which takes you inside. */
  DOOR: 10,
  FENCE: 11,
  /** Interior flooring. */
  FLOOR: 12,
  /** The tile you leave an interior by. */
  EXIT: 13,
  /** A board beside a door saying what the building is. Solid, like the post
   * it stands on. */
  SIGN: 14,
} as const;

export type Tile = (typeof TILE)[keyof typeof TILE];

const WALKABLE = new Set<number>([
  TILE.PATH,
  TILE.GRASS,
  TILE.MEADOW,
  TILE.FLOWER,
  TILE.SAND,
  TILE.DOOR,
  TILE.FLOOR,
  TILE.EXIT,
]);

export function walkable(tile: number): boolean {
  return WALKABLE.has(tile);
}

/** Only tall grass hides anything. */
export function hidesEncounters(tile: number): boolean {
  return tile === TILE.GRASS;
}

// ------------------------------------------------------------------ canvas

/** A rectangle of tiles, with the handful of edits a generator needs. */
export class Grid {
  readonly width: number;
  readonly height: number;
  readonly tiles: number[];

  constructor(width: number, height: number, fill: number) {
    this.width = width;
    this.height = height;
    this.tiles = new Array<number>(width * height).fill(fill);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): number {
    return this.inside(x, y) ? this.tiles[y * this.width + x] : TILE.TREE;
  }

  set(x: number, y: number, tile: number): void {
    if (this.inside(x, y)) this.tiles[y * this.width + x] = tile;
  }

  /** Paints a rectangle, clipped to the grid. */
  rect(x: number, y: number, w: number, h: number, tile: number): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) this.set(x + dx, y + dy, tile);
    }
  }

  /** Whether every tile of a rectangle is currently one of `allowed`. */
  clear(x: number, y: number, w: number, h: number, allowed: readonly number[]): boolean {
    const ok = new Set(allowed);
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (!this.inside(x + dx, y + dy)) return false;
        if (!ok.has(this.get(x + dx, y + dy))) return false;
      }
    }
    return true;
  }
}

// ------------------------------------------------------------------ shapes

/**
 * A path that wanders from one edge to the other.
 *
 * Straight lines are what made the first routes read as a diagram. This walks
 * east one column at a time, drifting up and down, and carves a band two or
 * three tiles wide — so the way through is obvious without being a ruler.
 *
 * Returns the y it arrived at on each column, which is what branch paths and
 * structures use to find "beside the path".
 */
export function meander(grid: Grid, rng: Rng, fromY: number, toY: number, width = 2): number[] {
  const spine: number[] = [];
  let y = fromY;

  for (let x = 0; x < grid.width; x++) {
    // Pulled gently towards the far end, so it always arrives.
    const remaining = grid.width - x;
    const pull = Math.sign(toY - y) * (Math.abs(toY - y) > remaining ? 1 : 0);
    const drift = pull || (rng() < 0.34 ? (rng() < 0.5 ? -1 : 1) : 0);

    y = Math.max(2, Math.min(grid.height - 3, y + drift));
    spine.push(y);

    const half = Math.floor(width / 2);
    for (let dy = -half; dy <= half; dy++) grid.set(x, y + dy, TILE.PATH);
  }

  return spine;
}

/**
 * Grows a blob of one tile from a seed point.
 *
 * Random-walk growth rather than a circle: a forest with a straight edge looks
 * planted, and this is meant to look like it happened.
 */
export function clump(grid: Grid, rng: Rng, x: number, y: number, size: number, tile: number, over: readonly number[]): void {
  const allowed = new Set(over);
  let cx = x;
  let cy = y;

  for (let i = 0; i < size; i++) {
    if (allowed.has(grid.get(cx, cy))) grid.set(cx, cy, tile);

    // Four-way drift keeps blobs compact; eight-way scatters into noise.
    const step = intBetween(rng, 0, 3);
    cx += step === 0 ? 1 : step === 1 ? -1 : 0;
    cy += step === 2 ? 1 : step === 3 ? -1 : 0;
    cx = Math.max(1, Math.min(grid.width - 2, cx));
    cy = Math.max(1, Math.min(grid.height - 2, cy));
  }
}

/**
 * A building: a solid block with a roof, and one door on its south face.
 *
 * Returns where the door landed, or null if there was no room. Buildings are
 * placed against ground that is already clear, so nothing is ever half-buried
 * in a forest.
 */
export function building(
  grid: Grid,
  x: number,
  y: number,
  w: number,
  h: number,
  over: readonly number[],
): { x: number; y: number; sign: { x: number; y: number } | null } | null {
  // One row below the footprint has to be walkable, or the door opens onto a
  // wall and the building is decoration.
  if (!grid.clear(x, y, w, h, over)) return null;
  if (!grid.clear(x, y + h, w, 1, over)) return null;

  grid.rect(x, y, w, h, TILE.WALL);
  grid.rect(x, y, w, Math.max(1, h - 1), TILE.ROOF);

  const doorX = x + Math.floor(w / 2);
  const doorY = y + h - 1;
  grid.set(doorX, doorY, TILE.DOOR);

  // A step of path in front, so a door is never reached across tall grass.
  grid.set(doorX, doorY + 1, TILE.PATH);

  // A board beside the step, never on it: a sign that blocked its own door
  // would be a very good joke and a very bad building. Left if there is room,
  // right otherwise, and nowhere at all if the building is wedged in tight.
  const signY = doorY + 1;
  const signX = [doorX - 1, doorX + 1].find(
    (candidate) => grid.inside(candidate, signY) && over.includes(grid.get(candidate, signY)),
  );
  if (signX !== undefined) grid.set(signX, signY, TILE.SIGN);

  return { x: doorX, y: doorY, sign: signX === undefined ? null : { x: signX, y: signY } };
}

/** Scatters single tiles over whatever is already there. */
export function speckle(grid: Grid, rng: Rng, tile: number, count: number, over: readonly number[]): void {
  const allowed = new Set(over);
  for (let i = 0; i < count; i++) {
    const x = intBetween(rng, 1, grid.width - 2);
    const y = intBetween(rng, 1, grid.height - 2);
    if (allowed.has(grid.get(x, y))) grid.set(x, y, tile);
  }
}

