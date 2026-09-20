import { levelBracket } from "./levels";
import { intBetween, type Rng, rngFor } from "./rng";
import { carve, carveLine, Grid, TILE, walkable } from "./terrain";
import type { Route } from "./world";

/**
 * Caves: three a world, each a staircase down through floors that get worse.
 *
 * The overworld is a lattice joined north, east, south and west, so two places
 * that sit corner to corner are as far apart as anywhere — you walk round.
 * A cave is the way through the corner: its mouth is on one route, its bottom
 * floor opens onto the routes *diagonally* beside that one, and nothing else
 * in the world can make that crossing.
 *
 * The floors are not mazes. A route is a maze and there are fifty of them;
 * another one underground would be more of the same in the dark. A floor is
 * one jagged corridor from the way in to the stairs down, with a few chambers
 * hung off it — a walk with turns in it rather than a puzzle. What makes it
 * worth the walk is what lives there: each floor counts as a ring deeper than
 * the one above, so the species and the levels both climb as you go down.
 */

/** How many caves a world has. */
export const CAVE_COUNT = 3;
/** How many floors a cave has. The last one is the one with the ways out. */
export const CAVE_FLOORS = 3;

export const CAVE_WIDTH = 56;
export const CAVE_HEIGHT = 36;

/**
 * The biome a cave floor carries.
 *
 * Deliberately not one of `BIOMES`: that list is dealt onto the lattice and
 * carries a Grey Line post per entry, and a coach service to the third floor
 * of a cave is not a thing. `typesFor` knows this one by name instead.
 */
export const CAVE_BIOME = "cavern";
export const CAVE_TYPES: readonly string[] = ["rock", "ground", "dark"];

/** The floor's id, from the route its mouth is on. */
export function caveFloorId(entry: string, floor: number): string {
  return `${entry}:cave-${floor}`;
}

/** Whether this id names a cave floor. */
export function isCaveFloor(id: string): boolean {
  return /:cave-\d+$/.test(id);
}

/** Which floor it is, 1 for the one behind the mouth. */
export function caveFloorOf(id: string): number {
  return Number(/:cave-(\d+)$/.exec(id)?.[1] ?? 0);
}

const DIAGONALS = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: 1, y: 1 },
] as const;

/** A mouth, and the solid tile beside it the board goes on. */
interface Mouth {
  x: number;
  y: number;
  sign: { x: number; y: number };
}

/** A spot on an outdoor route a cave mouth can be cut into. */
function mouthSpot(rng: Rng, route: Route, taken: Set<string>): Mouth | null {
  // Walkable, with walkable ground below it to stand on, and nothing else
  // already claiming either tile: a mouth on a doorstep or across a border
  // gate would be two things on one square.
  const spoken = new Set<string>([
    ...route.doors.map((door) => `${door.x},${door.y}`),
    ...route.borders.map((border) => `${border.x},${border.y}`),
    ...route.props.map((prop) => `${prop.x},${prop.y}`),
    ...route.signs.map((sign) => `${sign.x},${sign.y}`),
    ...taken,
  ]);

  for (let attempt = 0; attempt < 400; attempt++) {
    const x = intBetween(rng, 2, route.width - 3);
    const y = intBetween(rng, 2, route.height - 3);
    const here = route.tiles[y * route.width + x];
    const below = route.tiles[(y + 1) * route.width + x];
    if (here !== TILE.PATH && here !== TILE.MEADOW && here !== TILE.SAND) continue;
    if (!walkable(below)) continue;
    if (spoken.has(`${x},${y}`) || spoken.has(`${x},${y + 1}`)) continue;

    // Somewhere solid beside it for the board, the way a building's sign
    // stands against its own wall: a post on open ground is something to walk
    // into, and the way in is the tile below, which stays clear.
    const post = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y - 1 },
    ].find(
      (spot) =>
        !walkable(route.tiles[spot.y * route.width + spot.x]) &&
        !spoken.has(`${spot.x},${spot.y}`),
    );
    if (!post) continue;

    return { x, y, sign: post };
  }
  return null;
}

/**
 * One floor: a jagged corridor from the way in to the way on.
 *
 * Waypoints marching left to right with the height jittered, joined by
 * `carveLine`, which turns one axis at a time — so the corridor is a run of
 * right angles rather than a diagonal smear, and it reads as something dug
 * rather than something drawn.
 */
function digFloor(
  rng: Rng,
  exits: number,
): { grid: Grid; entry: { x: number; y: number }; stairs: { x: number; y: number }[] } {
  const grid = new Grid(CAVE_WIDTH, CAVE_HEIGHT, TILE.ROCK);
  const entry = { x: 4, y: Math.floor(CAVE_HEIGHT / 2) };

  const legs = intBetween(rng, 5, 7);
  const points = [entry];
  for (let leg = 1; leg <= legs; leg++) {
    points.push({
      x: Math.round(4 + ((CAVE_WIDTH - 9) * leg) / legs),
      y: intBetween(rng, 4, CAVE_HEIGHT - 5),
    });
  }

  let last = entry;
  for (const point of points.slice(1)) {
    carveLine(grid, last, point, intBetween(rng, 2, 3), TILE.PATH);
    last = point;
  }
  carve(grid, entry.x - 1, entry.y - 1, 3, 3, TILE.PATH);

  // Chambers off the corridor, each with something growing in it. A cave's
  // encounters have to live somewhere, and grass along the walk itself would
  // make crossing a floor a fight every few steps.
  const chambers = intBetween(rng, 3, 5);
  for (let at = 0; at < chambers; at++) {
    const from = points[intBetween(rng, 1, points.length - 1)];
    const wide = intBetween(rng, 5, 8);
    const tall = intBetween(rng, 4, 6);
    const x = Math.min(CAVE_WIDTH - wide - 2, Math.max(2, from.x + intBetween(rng, -6, 6)));
    const y = Math.min(CAVE_HEIGHT - tall - 2, Math.max(2, from.y + intBetween(rng, -8, 8)));
    carveLine(grid, from, { x: x + Math.floor(wide / 2), y: y + Math.floor(tall / 2) }, 2, TILE.PATH);
    carve(grid, x, y, wide, tall, TILE.PATH);
    for (let dy = 1; dy < tall - 1; dy++) {
      for (let dx = 1; dx < wide - 1; dx++) {
        if (rng() < 0.55) grid.set(x + dx, y + dy, TILE.GRASS);
      }
    }
  }

  // The ways on. One is the end of the corridor; any others are the far end
  // of a spur, so a floor with three ways out does not have them in a row.
  const stairs: { x: number; y: number }[] = [{ x: CAVE_WIDTH - 5, y: last.y }];
  carveLine(grid, last, stairs[0], 2, TILE.PATH);
  for (let extra = 1; extra < exits; extra++) {
    const from = points[intBetween(rng, 2, points.length - 1)];
    const spot = {
      x: intBetween(rng, 6, CAVE_WIDTH - 6),
      y: extra % 2 === 1 ? 3 : CAVE_HEIGHT - 4,
    };
    carveLine(grid, from, spot, 2, TILE.PATH);
    stairs.push(spot);
  }
  for (const spot of stairs) carve(grid, spot.x - 1, spot.y - 1, 3, 3, TILE.PATH);

  return { grid, entry, stairs };
}

/** "Plain of Char Cave B2F [27-31]" — the place it opens from, how deep, and what lives there. */
function caveLabel(name: string, floor: number, ring: number): string {
  const [low, high] = levelBracket(ring);
  return `${name} Cave B${floor}F [${low}-${high}]`;
}

/** The bare floor, before its doors are wired. */
function floorRoute(id: string, parent: string, label: string, ring: number, built: ReturnType<typeof digFloor>): Route {
  return {
    id,
    kind: "cave",
    biome: CAVE_BIOME,
    ring,
    // Underground is nowhere on the lattice, exactly as a room behind a door
    // is nowhere: no cell, no hops, no walls with neighbours behind them.
    depth: 0,
    nth: 0,
    cell: { x: 0, y: 0 },
    width: CAVE_WIDTH,
    height: CAVE_HEIGHT,
    tiles: built.grid.tiles,
    entry: built.entry,
    doors: [],
    gates: [],
    borders: [],
    signs: [],
    props: [],
    parent,
    label,
  };
}

/** What a cave turned out to be, for the tests and for anything that wants to name one. */
export interface CaveSpec {
  /** The outdoor route its mouth is on. */
  entry: string;
  /** Where the mouth is on that route. */
  mouth: { x: number; y: number };
  /** The floors, top first. */
  floors: string[];
  /** The routes the bottom floor comes out on, diagonal to `entry`. */
  exits: string[];
}

/**
 * Digs the caves, adding their floors to `routes` and cutting their mouths
 * into the routes they open from.
 *
 * Called after every outdoor route exists and its borders are wired, because
 * a mouth has to avoid the gates and doorsteps that are already there.
 */
export function digCaves(seed: string, routes: Map<string, Route>): CaveSpec[] {
  const outdoors = [...routes.values()]
    .filter((route) => route.kind === "route" && route.ring >= 2)
    .sort((a, b) => a.id.localeCompare(b.id));
  const byCell = new Map<string, Route>();
  for (const route of routes.values()) {
    if (route.kind === "route" || route.kind === "town") byCell.set(`${route.cell.x},${route.cell.y}`, route);
  }

  const diagonalsOf = (route: Route) =>
    DIAGONALS.map((step) => byCell.get(`${route.cell.x + step.x},${route.cell.y + step.y}`)).filter(
      (other): other is Route => Boolean(other) && other!.kind === "route",
    );

  const rng = rngFor(seed, "caves");
  const wanted = outdoors.filter((route) => diagonalsOf(route).length > 0);

  const caves: CaveSpec[] = [];
  const used = new Set<string>();
  for (let attempt = 0; attempt < 500 && caves.length < CAVE_COUNT; attempt++) {
    const entry = wanted[intBetween(rng, 0, wanted.length - 1)];
    if (!entry || used.has(entry.id)) continue;

    // Not two caves in one corner of the world: an exit route already spoken
    // for by another cave would leave two mouths on one map.
    const out = diagonalsOf(entry).filter((other) => !used.has(other.id));
    if (!out.length) continue;

    const mouthRng = rngFor(seed, "cave-mouth", entry.id);
    const mouth = mouthSpot(mouthRng, entry, new Set());
    if (!mouth) continue;

    const exits = out.slice(0, 2);
    const cave = digCave(seed, routes, entry, mouth, exits);
    if (!cave) continue;

    caves.push(cave);
    used.add(entry.id);
    for (const other of exits) used.add(other.id);
  }

  return caves;
}

/** One cave: its floors, its mouth, and the ways out of the bottom. */
function digCave(
  seed: string,
  routes: Map<string, Route>,
  entry: Route,
  mouth: Mouth,
  exits: Route[],
): CaveSpec | null {
  // The mouths on the far side first: if one of them cannot be cut, nothing
  // is written and the caller tries somewhere else.
  const outside: { route: Route; at: Mouth }[] = []; 
  for (const other of exits) {
    const spot = mouthSpot(rngFor(seed, "cave-exit", entry.id, other.id), other, new Set());
    if (!spot) return null;
    outside.push({ route: other, at: spot });
  }

  const name = entry.label.replace(/ \[[^\]]*\]$/, "");

  // Each floor with the stairs it was dug with, which is what the wiring
  // below needs and nothing outside this function ever wants.
  const floors = Array.from({ length: CAVE_FLOORS }, (_, at) => {
    const floor = at + 1;
    const bottom = floor === CAVE_FLOORS;
    const built = digFloor(rngFor(seed, "cave-floor", entry.id, floor), bottom ? 1 + outside.length : 1);
    return {
      route: floorRoute(caveFloorId(entry.id, floor), entry.id, caveLabel(name, floor, entry.ring + floor), entry.ring + floor, built),
      stairs: built.stairs,
    };
  });

  /** The tile in front of a staircase: where somebody using it from the other end lands. */
  const foot = (spot: { x: number; y: number }) => ({ x: spot.x, y: spot.y + 1 });

  for (let at = 0; at < floors.length; at++) {
    const { route: here, stairs } = floors[at];

    // Back the way you came: the first floor comes out at the mouth, the
    // others at the foot of the stairs on the floor above.
    const above = at === 0 ? entry : floors[at - 1].route;
    const back = at === 0 ? foot(mouth) : foot(floors[at - 1].stairs[0]);
    const up = { x: here.entry.x, y: here.entry.y - 1 };
    here.doors.push({ x: up.x, y: up.y, to: above.id, at: back });
    here.tiles[up.y * here.width + up.x] = TILE.STAIRS;

    const below = floors[at + 1];
    if (below) {
      here.doors.push({ x: stairs[0].x, y: stairs[0].y, to: below.route.id, at: below.route.entry });
      here.tiles[stairs[0].y * here.width + stairs[0].x] = TILE.STAIRS;
      continue;
    }

    // The bottom floor: out onto the routes diagonally beside the mouth.
    for (let which = 0; which < outside.length; which++) {
      const spot = stairs[which + 1] ?? stairs[0];
      here.doors.push({ x: spot.x, y: spot.y, to: outside[which].route.id, at: foot(outside[which].at) });
      here.tiles[spot.y * here.width + spot.x] = TILE.STAIRS;
    }
  }

  // And the mouths themselves, on the maps above ground.
  const first = floors[0].route;
  entry.tiles[mouth.y * entry.width + mouth.x] = TILE.STAIRS;
  entry.doors.push({ x: mouth.x, y: mouth.y, to: first.id, at: first.entry });
  entry.tiles[mouth.sign.y * entry.width + mouth.sign.x] = TILE.SIGN;
  entry.signs.push({ ...mouth.sign, text: `${name} Cave — a way down` });

  const bottom = floors[floors.length - 1];
  for (let which = 0; which < outside.length; which++) {
    const { route, at: where } = outside[which];
    const spot = bottom.stairs[which + 1] ?? bottom.stairs[0];
    route.tiles[where.y * route.width + where.x] = TILE.STAIRS;
    route.doors.push({ x: where.x, y: where.y, to: bottom.route.id, at: foot(spot) });
    route.tiles[where.sign.y * route.width + where.sign.x] = TILE.SIGN;
    route.signs.push({ ...where.sign, text: `${name} Cave — a way up from below` });
  }

  for (const { route } of floors) routes.set(route.id, route);

  return {
    entry: entry.id,
    mouth: { x: mouth.x, y: mouth.y },
    floors: floors.map(({ route }) => route.id),
    exits: outside.map(({ route }) => route.id),
  };
}
