import { BIOMES, copiesOf, tiersOf } from "./biomes";
import { intBelow, intBetween, shuffle, type Rng } from "./rng";

/**
 * The shape of the world: which places exist, and what joins them.
 *
 * This replaces a star. The world used to be a hub with arms running outward
 * and difficulty read straight off an arm index — walk east and every step is
 * harder than the last, forever, in a straight line. That is easy to reason
 * about and it is not a place: you never choose a direction, you only choose
 * an arm, and having chosen it there is exactly one way on.
 *
 * So the world is a graph now. Fifty places on an irregular lattice, joined
 * with **loops** so most of it can be walked round rather than only into and
 * back out of, and a **few blind ends** so exploring can still be wrong.
 * Difficulty is distance from town measured in *hops*, which means the two
 * ways round a loop can be different lengths and the far side of a short loop
 * can be milder than the near side of a long one.
 *
 * ## Why a lattice
 *
 * Because a route has edges. A node with three neighbours needs three gaps in
 * its wall, and a gap is on the north side or the east side — so a neighbour
 * has to have a *direction*, not just an identity. Putting the places on a
 * grid of cells gives every link a compass bearing for free, makes the region
 * map a drawing of the truth rather than a diagram of it, and makes "avoid
 * symmetry" a property of how the cells were chosen rather than something to
 * be arranged afterwards.
 *
 * ## What is random and what is not
 *
 * Everything here is drawn from the seed, so a world is still a pure function
 * of (config, seed) and two players sharing a seed share a map. What varies is
 * the shape: which cells exist, which adjacencies are open, and which biome
 * sits in which cell.
 */

/** Four ways off a cell, and the four edges of a route. */
export type Bearing = "n" | "e" | "s" | "w";

export const BEARINGS: readonly Bearing[] = ["n", "e", "s", "w"];

const STEP: Record<Bearing, readonly [number, number]> = {
  n: [0, -1],
  e: [1, 0],
  s: [0, 1],
  w: [-1, 0],
};

export function opposite(bearing: Bearing): Bearing {
  return bearing === "n" ? "s" : bearing === "s" ? "n" : bearing === "e" ? "w" : "e";
}

export interface PlanNode {
  /**
   * `biome-nth`, so the four meadows are meadow-1 through meadow-4 **in order
   * of distance from town**.
   *
   * The ordering is load-bearing, not cosmetic. It is how everything placed by
   * hand says where it goes: a gym is written down as "the nearest marsh",
   * because node cells are dealt from the seed and no hand-written coordinate
   * could survive that. Making the number in the name *be* that ordinal means
   * there is one fact here rather than two that have to be kept in step.
   */
  id: string;
  biome: string;
  /** Where it sits on the lattice. The town is the origin. */
  cell: { x: number; y: number };
  /**
   * Hops from town along the shortest way there.
   *
   * This is what difficulty is read off, and it is the whole reason the graph
   * is worth having: on a star, distance and direction are the same fact.
   */
  depth: number;
  /** Which way each neighbour lies, and which node it is. */
  links: { bearing: Bearing; to: string }[];
}

export interface WorldPlan {
  /** The town's cell. Always the origin, and always `depth` 0. */
  hub: { cell: { x: number; y: number }; links: { bearing: Bearing; to: string }[] };
  nodes: readonly PlanNode[];
  /** The deepest anything gets, for scaling everything that scales. */
  maxDepth: number;
}

/** How many neighbours a cell can have. Four, because a cell has four sides. */
const MOST_LINKS = 4;

/**
 * How many blind ends the world should end up with.
 *
 * "A few" — enough that walking down one and finding nothing is a thing that
 * happens, few enough that it is not what the world is made of. Loops are
 * added until the count is at or below this.
 */
const BLIND_ENDS = 6;

/**
 * Builds the plan.
 *
 * Four passes, and each is doing one job:
 *
 *   **Grow.** Cells are added one at a time, each beside a cell that already
 *   exists, chosen at random. That is what makes the outline lumpy rather than
 *   a disc — a frontier that is picked from uniformly wanders, and a wandering
 *   frontier is asymmetric without anybody arranging it.
 *
 *   **Join.** The cell each one grew from is its first link, so the graph
 *   starts as a tree and everything is reachable from town by construction.
 *
 *   **Loop.** Extra links are opened between cells that are already beside
 *   each other, until few enough places are dead ends. This is the pass that
 *   turns a tree into somewhere you can walk round.
 *
 *   **Settle.** Depth by breadth-first search from town, then the biomes are
 *   dealt out: the common ones nearer in, the strange ones further out, with
 *   enough jitter that it is a tendency rather than a ring.
 */
export function planWorld(rng: Rng, count: number): WorldPlan {
  const key = (x: number, y: number) => `${x},${y}`;

  // ------------------------------------------------------------------ grow
  const taken = new Map<string, { x: number; y: number; from: string | null }>();
  taken.set(key(0, 0), { x: 0, y: 0, from: null });

  const order: { x: number; y: number; from: string | null }[] = [];

  let guard = 0;
  while (order.length < count && guard < count * 400) {
    guard++;

    // Somewhere that already exists, and a free side of it.
    const existing = [...taken.values()];
    const from = existing[intBelow(rng, existing.length)];
    const bearing = BEARINGS[intBelow(rng, BEARINGS.length)];
    const [dx, dy] = STEP[bearing];
    const x = from.x + dx;
    const y = from.y + dy;

    if (taken.has(key(x, y))) continue;

    // Not so many neighbours that the lattice fills in solid. Three is enough
    // for junctions and loops; four everywhere would be a grid, and a grid is
    // the symmetry we are avoiding.
    const already = BEARINGS.filter((look) => {
      const [ax, ay] = STEP[look];
      return taken.has(key(x + ax, y + ay));
    }).length;
    if (already > 2) continue;

    const cell = { x, y, from: key(from.x, from.y) };
    taken.set(key(x, y), cell);
    order.push(cell);
  }

  // ------------------------------------------------------------------ join
  const links = new Map<string, Set<string>>();
  const join = (a: string, b: string) => {
    if (!links.has(a)) links.set(a, new Set());
    if (!links.has(b)) links.set(b, new Set());
    links.get(a)!.add(b);
    links.get(b)!.add(a);
  };

  for (const cell of order) if (cell.from) join(key(cell.x, cell.y), cell.from);

  // ------------------------------------------------------------------ loop
  //
  // Every pair of cells that are beside each other and not yet joined, in a
  // seeded order, opened one at a time until few enough places are blind ends.
  const candidates: [string, string][] = [];
  for (const cell of taken.values()) {
    for (const bearing of ["e", "s"] as Bearing[]) {
      const [dx, dy] = STEP[bearing];
      const other = key(cell.x + dx, cell.y + dy);
      if (!taken.has(other)) continue;
      const here = key(cell.x, cell.y);
      if (links.get(here)?.has(other)) continue;
      candidates.push([here, other]);
    }
  }

  const blindEnds = () =>
    [...taken.keys()].filter((at) => at !== key(0, 0) && (links.get(at)?.size ?? 0) <= 1).length;

  for (const [a, b] of shuffle(rng, candidates)) {
    if (blindEnds() <= BLIND_ENDS) break;
    if ((links.get(a)?.size ?? 0) >= MOST_LINKS) continue;
    if ((links.get(b)?.size ?? 0) >= MOST_LINKS) continue;
    join(a, b);
  }

  // ---------------------------------------------------------------- settle
  const depth = new Map<string, number>([[key(0, 0), 0]]);
  const queue = [key(0, 0)];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    for (const next of links.get(at) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, depth.get(at)! + 1);
      queue.push(next);
    }
  }

  // Anything the walk never reached grew in a pocket the loop pass then left
  // alone. It cannot happen — every cell is joined to the one it grew from —
  // but a plan with an unreachable place in it is a world with somewhere you
  // cannot go, so it is worth being certain rather than confident.
  const reachable = order.filter((cell) => depth.has(key(cell.x, cell.y)));

  const places = dealBiomes(rng, reachable.map((cell) => depth.get(key(cell.x, cell.y))!));

  const byCell = new Map<string, string>();
  reachable.forEach((cell, index) => byCell.set(key(cell.x, cell.y), places[index]));

  const nodes: PlanNode[] = reachable.map((cell, index) => {
    const here = key(cell.x, cell.y);
    return {
      id: places[index],
      biome: places[index].slice(0, places[index].lastIndexOf("-")),
      cell: { x: cell.x, y: cell.y },
      depth: depth.get(here)!,
      links: BEARINGS.flatMap((bearing) => {
        const [dx, dy] = STEP[bearing];
        const other = key(cell.x + dx, cell.y + dy);
        if (!links.get(here)?.has(other)) return [];
        const to = other === key(0, 0) ? HUB : byCell.get(other);
        return to ? [{ bearing, to }] : [];
      }),
    };
  });

  const hubLinks = BEARINGS.flatMap((bearing) => {
    const [dx, dy] = STEP[bearing];
    const other = key(dx, dy);
    if (!links.get(key(0, 0))?.has(other)) return [];
    const to = byCell.get(other);
    return to ? [{ bearing, to }] : [];
  });

  return {
    hub: { cell: { x: 0, y: 0 }, links: hubLinks },
    nodes,
    maxDepth: Math.max(1, ...nodes.map((node) => node.depth)),
  };
}

/** What the town is called in a plan's links. */
export const HUB = "hub-0";

/**
 * Which biome goes where, and how many of each there are.
 *
 * The counts come from the tiers in biomes.ts: the five most ordinary places
 * appear four times each, the next five three times, then twice, then once.
 * Fifty in total, and the shape of that is the point — you should meet a
 * meadow four times over and a Crystal Vault once ever.
 *
 * Where each copy *goes* is a tendency rather than a rule. Nodes are ranked by
 * depth and biome slots by tier, both with a few places of jitter, and then
 * zipped. So the ordinary places cluster near town and the strange ones sit
 * out past them, without the world becoming a set of concentric bands: a
 * Glacier three hops from home is unusual and allowed, which is exactly the
 * sort of thing that makes a map worth looking at.
 */
function dealBiomes(rng: Rng, depths: readonly number[]): string[] {
  const slots: { biome: string; tier: number; jitter: number }[] = [];
  for (const [tier, ids] of tiersOf().entries()) {
    const copies = copiesOf(tier);
    for (const id of ids) {
      for (let copy = 0; copy < copies; copy++) {
        slots.push({ biome: id, tier, jitter: intBetween(rng, 0, 3) });
      }
    }
  }

  // More slots than places, or fewer, is a mismatch worth failing on rather
  // than papering over: it means the tiers and the node count disagree.
  const wanted = depths.length;
  const ranked = shuffle(rng, slots)
    .sort((a, b) => a.tier + a.jitter - (b.tier + b.jitter))
    .slice(0, wanted);

  const order = depths
    .map((depth, index) => ({ index, rank: depth * 4 + intBetween(rng, 0, 3) }))
    .sort((a, b) => a.rank - b.rank);

  const biomes: string[] = new Array(wanted);
  order.forEach((place, at) => {
    biomes[place.index] = ranked[at]?.biome ?? BIOMES[0].id;
  });

  // Numbered by depth rather than by the order they were dealt.
  //
  // Dealing order is depth *plus jitter*, so numbering as they came out would
  // usually agree with distance and occasionally not — and "usually" is no
  // use at all to something that says "the nearest marsh" and means it. So the
  // copies of each biome are sorted by hops (ties by the index they were dealt
  // at, which is settled) and numbered from one.
  const out: string[] = new Array(wanted);
  const byBiome = new Map<string, number[]>();
  biomes.forEach((biome, index) => byBiome.set(biome, [...(byBiome.get(biome) ?? []), index]));

  for (const [biome, indices] of byBiome) {
    const sorted = [...indices].sort((a, b) => depths[a] - depths[b] || a - b);
    sorted.forEach((index, copy) => {
      out[index] = `${biome}-${copy + 1}`;
    });
  }

  return out;
}

/**
 * Which copy of its biome a place is: 1 for the nearest, counting outward.
 *
 * This is how anything hand-placed says where it goes, and the change is worth
 * spelling out. A gym used to be written down as `{ biome: "marsh", ring: 1 }`,
 * which worked because the ring was part of the route's name and the same name
 * existed in every world. Node cells are dealt from the seed — where the third
 * marsh landed, and how far out that is, is a different answer every time — so
 * a hand-written ring would be a gym that exists on some worlds only.
 *
 * An *ordinal* survives that. Every world has exactly four marshes, because the
 * tiers say so, and ordering them by distance is a total order. So "the nearest
 * marsh" is an address that always resolves, and it means what a designer means
 * by it: near town is early, far out is late.
 */
export function copyOf(id: string): number {
  return Number(id.slice(id.lastIndexOf("-") + 1)) || 1;
}

/**
 * Hops from town, turned into one of the difficulty bands.
 *
 * Depth is the honest number — it is how far you actually walked — but it is
 * not the same number on every seed: the grower wanders, so one world is eight
 * hops across and the next is ten. Reading levels straight off depth would
 * make the same seeded world harder or easier depending on a shape nobody
 * chose, and would put the top of the curve out of reach on the shallow ones.
 *
 * So the deepest place in any world is always the last band and the first hop
 * is always the first, and everything between is stretched to fit. `Route.ring`
 * is this number; `Route.depth` keeps the hops, because the map wants to draw
 * the truth even where the difficulty curve is normalised.
 */
export function bandOf(depth: number, maxDepth: number, bands: number): number {
  if (depth <= 0) return 0;
  if (maxDepth <= 1) return 1;
  return 1 + Math.round(((depth - 1) * (bands - 1)) / (maxDepth - 1));
}
