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

/** What sits in a cell: somewhere to walk through, or somewhere to rest. */
export type PlaceKind = "route" | "town";

export interface PlanNode {
  /**
   * A town, or a route.
   *
   * The origin is a town and always was; what changed is that it is now a node
   * in this list like any other rather than a thing beside it. Three more towns
   * are chosen out on the lattice, and a town is a cell with buildings in it
   * instead of grass — so everything that joins one place to another (the
   * bearings, the borders, the region map, the depth) works on all four without
   * knowing which kind it has.
   */
  kind: PlaceKind;
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
  /**
   * Every place in the world: the fifty routes and the four towns, the origin
   * among them.
   *
   * The origin used to sit outside this list in a `hub` field of its own,
   * which meant every walk over the graph had a special case in it for the one
   * cell that was not a node. It is a node.
   */
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
 * How many towns the world holds besides the one you start in, and how far
 * apart they have to be.
 *
 * Three, and **at least three hops from each other and from home** — which is
 * to say with at least two routes in between, so no two towns are ever within
 * sight of one another and reaching the next one is a journey rather than a
 * step. A town every other cell would make the whole map a rest stop and the
 * distances meaningless.
 */
export const OUTER_TOWNS = 3;
export const TOWNS_APART = 3;

/**
 * How far out a town may be founded.
 *
 * Not in the first ring: somewhere to heal one hop from the town you started
 * in is somewhere nobody will ever walk to.
 */
const TOWN_FROM = 3;

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
  // `count` is how many places to *grow*, and three of them will be towns
  // rather than routes, so the caller asks for the routes it wants plus the
  // towns. See `placesWanted` in biomes.ts and `OUTER_TOWNS` above.
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

  // ------------------------------------------------------------------ found
  //
  // Three towns, spread over the lattice and over the *journey*.
  //
  // Two rules together, because either alone gets it wrong. Each town is taken
  // from its own third of the distance from home, so there is one on the way
  // out, one further, and one near the rim: picking purely by how far apart
  // they are put all three of them on the rim, and the middle of the world —
  // six hops of it — had nowhere to heal. And within its third each is the
  // candidate *furthest from every town already chosen*, which is what keeps
  // two of them from ending up neighbours.
  //
  // Only candidates at least `TOWNS_APART` from everything chosen are
  // considered, and if a third has none, the search widens to the whole map
  // rather than giving up the separation. Measured over five seeds, the third
  // is never empty and the separation is never the thing that gives.
  //
  // Dead ends are not eligible either. A town you can only enter and leave by
  // the one road is somewhere you visit once by mistake.
  const deepest = Math.max(TOWN_FROM, ...[...depth.values()]);
  const between = hops(links, reachable.map((cell) => key(cell.x, cell.y)).concat(key(0, 0)));
  const eligible = shuffle(
    rng,
    reachable.filter(
      (cell) =>
        depth.get(key(cell.x, cell.y))! >= TOWN_FROM &&
        (links.get(key(cell.x, cell.y))?.size ?? 0) >= 2,
    ),
  );

  const towns = [key(0, 0)];
  const span = (deepest - TOWN_FROM + 1) / OUTER_TOWNS;

  for (let band = 0; band < OUTER_TOWNS; band++) {
    const low = TOWN_FROM + Math.floor(band * span);
    const high = band === OUTER_TOWNS - 1 ? deepest : TOWN_FROM + Math.floor((band + 1) * span) - 1;

    const pick = (inBand: boolean) => {
      let best: string | null = null;
      let furthest = -1;
      for (const cell of eligible) {
        const at = key(cell.x, cell.y);
        if (towns.includes(at)) continue;
        const how = depth.get(at)!;
        if (inBand && (how < low || how > high)) continue;
        const nearest = Math.min(...towns.map((town) => between.get(town)?.get(at) ?? Infinity));
        if (nearest < TOWNS_APART) continue;
        if (nearest > furthest) {
          furthest = nearest;
          best = at;
        }
      }
      return best;
    };

    const found = pick(true) ?? pick(false);
    if (found) towns.push(found);
  }

  const townAt = new Map<string, string>();
  towns.slice(1).forEach((at, index) => townAt.set(at, `town-${index + 1}`));
  townAt.set(key(0, 0), HUB);

  // Biomes are dealt only to what is left, so a town does not take a meadow's
  // place in the world's twenty kinds.
  const wilds = reachable.filter((cell) => !townAt.has(key(cell.x, cell.y)));
  const places = dealBiomes(rng, wilds.map((cell) => depth.get(key(cell.x, cell.y))!));

  const byCell = new Map<string, string>(townAt);
  wilds.forEach((cell, index) => byCell.set(key(cell.x, cell.y), places[index]));

  const cells = [{ x: 0, y: 0 }, ...reachable.map((cell) => ({ x: cell.x, y: cell.y }))];

  const nodes: PlanNode[] = cells.map((cell) => {
    const here = key(cell.x, cell.y);
    const id = byCell.get(here)!;
    const town = townAt.has(here);
    return {
      id,
      kind: town ? "town" : "route",
      // A town's palette, which is not one of the twenty.
      biome: town ? "hearth" : id.slice(0, id.lastIndexOf("-")),
      cell: { x: cell.x, y: cell.y },
      depth: depth.get(here)!,
      links: BEARINGS.flatMap((bearing) => {
        const [dx, dy] = STEP[bearing];
        const to = byCell.get(key(cell.x + dx, cell.y + dy));
        if (!to || !links.get(here)?.has(key(cell.x + dx, cell.y + dy))) return [];
        return [{ bearing, to }];
      }),
    };
  });

  return {
    nodes,
    maxDepth: Math.max(1, ...nodes.map((node) => node.depth)),
  };
}

/**
 * How many hops between every pair of cells.
 *
 * A breadth-first walk from each, which is fifty-three walks over fifty-three
 * cells and therefore free. It exists so the towns can be spread by *graph*
 * distance rather than by how far apart they look on the lattice: two cells one
 * apart as the crow flies can be five hops if the wall between them is closed,
 * and it is the walking that matters.
 */
function hops(
  links: Map<string, Set<string>>,
  cells: readonly string[],
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();

  for (const start of cells) {
    const seen = new Map<string, number>([[start, 0]]);
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const at = queue[head];
      for (const next of links.get(at) ?? []) {
        if (seen.has(next)) continue;
        seen.set(next, seen.get(at)! + 1);
        queue.push(next);
      }
    }
    out.set(start, seen);
  }

  return out;
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
