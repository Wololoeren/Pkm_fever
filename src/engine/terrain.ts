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

  // The obstacles a tool answers. Each is impassable on its own and passable
  // with the right thing in the bag, which is the whole of what an HM is:
  // a key shaped like a verb.
  /** Cut. */
  BUSH: 15,
  /** Strength. */
  BOULDER: 16,
  /** Rock Smash. */
  RUBBLE: 17,
  /** Waterfall. */
  WATERFALL: 18,
  /** Whirlpool. */
  WHIRLPOOL: 19,
  /** Rock Climb. */
  CLIFF: 20,
  /** Dive. */
  DEEP: 21,
} as const;

/**
 * What each obstacle wants, and whether the tool clears it for good.
 *
 * The split matters: Cut takes a bush down and it stays down, while Surf is
 * something you are doing rather than something you did — step off the water
 * and it is water again. So one writes to the save and the other is a question
 * asked of the bag every time you move.
 */
export const OBSTACLES: Record<number, { item: string; clears: boolean }> = {
  [TILE.BUSH]: { item: "hm-cut", clears: true },
  [TILE.BOULDER]: { item: "hm-strength", clears: true },
  [TILE.RUBBLE]: { item: "hm-rocksmash", clears: true },
  [TILE.WATER]: { item: "hm-surf", clears: false },
  [TILE.WATERFALL]: { item: "hm-waterfall", clears: false },
  [TILE.WHIRLPOOL]: { item: "hm-whirlpool", clears: false },
  [TILE.CLIFF]: { item: "hm-rockclimb", clears: false },
  [TILE.DEEP]: { item: "hm-dive", clears: false },
};

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

/**
 * Whether this tile can be crossed by somebody carrying these things.
 *
 * Ordinary ground answers without asking the bag. Everything else is an
 * obstacle with a tool that answers it, which is what turns the outer rings
 * from a wall into a sequence.
 */
export function passable(tile: number, has: (item: string) => boolean): boolean {
  if (walkable(tile)) return true;
  const gate = OBSTACLES[tile];
  return gate ? has(gate.item) : false;
}

/** Whether a tool is what takes this obstacle away for good. */
export function clearedBy(tile: number, item: string): boolean {
  const gate = OBSTACLES[tile];
  return Boolean(gate?.clears && gate.item === item);
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
export function clump(
  grid: Grid,
  rng: Rng,
  x: number,
  y: number,
  size: number,
  tile: number,
  over: readonly number[],
): number {
  const allowed = new Set(over);
  let cx = x;
  let cy = y;
  let painted = 0;

  for (let i = 0; i < size; i++) {
    if (allowed.has(grid.get(cx, cy))) {
      grid.set(cx, cy, tile);
      painted++;
    }

    // Four-way drift keeps blobs compact; eight-way scatters into noise.
    const step = intBetween(rng, 0, 3);
    cx += step === 0 ? 1 : step === 1 ? -1 : 0;
    cy += step === 2 ? 1 : step === 3 ? -1 : 0;
    cx = Math.max(1, Math.min(grid.width - 2, cx));
    cy = Math.max(1, Math.min(grid.height - 2, cy));
  }

  // How much ground it actually took, which is what lets a caller aim for a
  // share of the map rather than guess at a number of blobs.
  return painted;
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

// ------------------------------------------------------------------- maze

export interface MazeCell {
  cx: number;
  cy: number;
}

export interface MazePlan {
  cols: number;
  rows: number;
  /** Which cells are joined, as "cx,cy>cx,cy" with the lower key first. */
  joins: Set<string>;
  /** Visit order of the spanning tree, so a caller can pick a far cell. */
  order: MazeCell[];
}

const joinKey = (a: MazeCell, b: MazeCell): string => {
  const one = `${a.cx},${a.cy}`;
  const two = `${b.cx},${b.cy}`;
  return one < two ? `${one}>${two}` : `${two}>${one}`;
};

export function joined(plan: MazePlan, a: MazeCell, b: MazeCell): boolean {
  return plan.joins.has(joinKey(a, b));
}

/**
 * A maze over a coarse grid of cells, as a spanning tree plus a few loops.
 *
 * Depth-first from a corner, which is what gives long winding corridors and
 * real dead ends rather than the short stubby ones a random-edge maze
 * produces. The tree guarantees every cell is reachable, so a route can never
 * generate itself shut.
 *
 * The extra joins matter as much as the tree: a pure spanning tree has exactly
 * one path between any two points, which reads less like a place and more like
 * a corridor that happens to bend. A handful of loops turns wrong turns into
 * detours instead of dead ends you must retrace in full.
 */
export function maze(rng: Rng, cols: number, rows: number, extraLoops: number): MazePlan {
  const joins = new Set<string>();
  const order: MazeCell[] = [];
  const seen = new Set<string>();
  const stack: MazeCell[] = [{ cx: 0, cy: Math.floor(rows / 2) }];
  seen.add(`${stack[0].cx},${stack[0].cy}`);
  order.push(stack[0]);

  while (stack.length) {
    const at = stack[stack.length - 1];
    const options = neighbours(at, cols, rows).filter((next) => !seen.has(`${next.cx},${next.cy}`));

    if (!options.length) {
      stack.pop();
      continue;
    }

    const next = options[intBetween(rng, 0, options.length - 1)];
    joins.add(joinKey(at, next));
    seen.add(`${next.cx},${next.cy}`);
    order.push(next);
    stack.push(next);
  }

  for (let i = 0; i < extraLoops; i++) {
    const cell = { cx: intBetween(rng, 0, cols - 1), cy: intBetween(rng, 0, rows - 1) };
    const options = neighbours(cell, cols, rows);
    if (!options.length) continue;
    joins.add(joinKey(cell, options[intBetween(rng, 0, options.length - 1)]));
  }

  return { cols, rows, joins, order };
}

function neighbours(cell: MazeCell, cols: number, rows: number): MazeCell[] {
  return [
    { cx: cell.cx - 1, cy: cell.cy },
    { cx: cell.cx + 1, cy: cell.cy },
    { cx: cell.cx, cy: cell.cy - 1 },
    { cx: cell.cx, cy: cell.cy + 1 },
  ].filter((next) => next.cx >= 0 && next.cy >= 0 && next.cx < cols && next.cy < rows);
}

/** Carves a filled rectangle, clamped to the grid. */
export function carve(grid: Grid, x: number, y: number, w: number, h: number, tile: number): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (grid.inside(x + dx, y + dy)) grid.set(x + dx, y + dy, tile);
    }
  }
}

/** Carves a straight run between two points, one axis then the other. */
export function carveLine(
  grid: Grid,
  from: { x: number; y: number },
  to: { x: number; y: number },
  width: number,
  tile: number,
): void {
  const half = Math.floor(width / 2);
  const stepX = Math.sign(to.x - from.x);
  const stepY = Math.sign(to.y - from.y);

  for (let x = from.x; x !== to.x + stepX && stepX !== 0; x += stepX) {
    carve(grid, x, from.y - half, 1, width, tile);
  }
  for (let y = from.y; y !== to.y + stepY && stepY !== 0; y += stepY) {
    carve(grid, to.x - half, y, width, 1, tile);
  }
}

/** Every tile reachable on foot from a starting point. */
export function reachable(grid: Grid, from: { x: number; y: number }): Uint8Array {
  return reachableWith(grid, from, walkable);
}

/** As `reachable`, but you decide what counts as crossable. */
export function reachableWith(
  grid: Grid,
  from: { x: number; y: number },
  crossable: (tile: number) => boolean,
): Uint8Array {
  const seen = new Uint8Array(grid.width * grid.height);
  if (!grid.inside(from.x, from.y)) return seen;

  const queue = [from];
  seen[from.y * grid.width + from.x] = 1;

  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (!grid.inside(x, y)) continue;
      const index = y * grid.width + x;
      if (seen[index] || !crossable(grid.get(x, y))) continue;
      seen[index] = 1;
      queue.push({ x, y });
    }
  }

  return seen;
}

/**
 * Fills in anything you could not have walked to, and says how much it filled.
 *
 * The maze guarantees the *rooms* are connected; it says nothing about what
 * gets dropped on them afterwards. A cabin in one of pinewood's small rooms
 * filled the room end to end and sealed off everything beyond it — two
 * thousand tiles of a route, carved, decorated, and unreachable. Rather than
 * forbid every placement that might do it, the last word on a route is a walk
 * from its front door: what that walk cannot get to was never really part of
 * the map, so it stops pretending to be.
 */
export function sealUnreachable(
  grid: Grid,
  from: { x: number; y: number },
  wall: number,
  /** What counts as crossable. Obstacles are crossable *eventually*, so the
   * seal has to walk as though every tool is in the bag — otherwise the first
   * bush placed on a route deletes everything behind it. */
  crossable: (tile: number) => boolean = walkable,
): number {
  const seen = reachableWith(grid, from, crossable);
  let sealed = 0;

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const index = y * grid.width + x;
      if (seen[index] || !crossable(grid.get(x, y))) continue;
      grid.set(x, y, wall);
      sealed++;
    }
  }

  return sealed;
}

// --------------------------------------------------------------- rotation

export interface Rotated {
  tiles: number[];
  width: number;
  height: number;
  /** Where a point in the original ends up. */
  map: (x: number, y: number) => { x: number; y: number };
}

/**
 * Turns a map a quarter at a time.
 *
 * Every route is generated in one canonical form — in at the west, out at the
 * east — and then turned to face the way its arm actually runs. Generating
 * four orientations instead would mean four chances for a rule to hold in one
 * of them and not the others; this way there is one generator and a transform
 * that cannot change what is connected to what.
 */
export function rotate(tiles: readonly number[], width: number, height: number, quarters: number): Rotated {
  const turns = ((quarters % 4) + 4) % 4;
  if (turns === 0) {
    return { tiles: [...tiles], width, height, map: (x, y) => ({ x, y }) };
  }

  const flipped = turns % 2 === 1;
  const outWidth = flipped ? height : width;
  const outHeight = flipped ? width : height;
  const out = new Array<number>(outWidth * outHeight).fill(0);

  // One clockwise quarter sends (x, y) to (height - 1 - y, x).
  const step = (x: number, y: number, h: number) => ({ x: h - 1 - y, y: x });

  const map = (x: number, y: number) => {
    let point = { x, y };
    let w = width;
    let h = height;
    for (let i = 0; i < turns; i++) {
      point = step(point.x, point.y, h);
      [w, h] = [h, w];
    }
    void w;
    return point;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const to = map(x, y);
      out[to.y * outWidth + to.x] = tiles[y * width + x];
    }
  }

  return { tiles: out, width: outWidth, height: outHeight, map };
}

/** Mirrors left to right, for an arm that runs the other way along its axis. */
export function mirror(tiles: readonly number[], width: number, height: number): Rotated {
  const out = new Array<number>(width * height).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[y * width + (width - 1 - x)] = tiles[y * width + x];
  }
  return { tiles: out, width, height, map: (x, y) => ({ x: width - 1 - x, y }) };
}
