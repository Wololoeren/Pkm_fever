import { describe, expect, it } from "vitest";
import { BIOMES, copiesOf, placesWanted } from "@/engine/biomes";
import { BEARINGS, bandOf, copyOf, HUB, opposite, planWorld } from "@/engine/layout";
import { rngFor } from "@/engine/rng";
import { walkable } from "@/engine/terrain";
import { DEFAULT_WORLD } from "@/engine/types";
import { HUB_ID, type Route } from "@/engine/world";
import { outdoorRoutes, testWorld } from "./helpers";

/**
 * The shape of the world.
 *
 * The old world was a star: twenty arms, six rings each, and everything about
 * it followed from an index. There was nothing to test — a route's neighbours
 * were arithmetic, and difficulty was the same number as the name.
 *
 * A graph has to be *checked*. Fifty places on a lattice grown from the seed,
 * joined with loops and a few blind ends, and every one of the properties the
 * world is built on is now a claim rather than a consequence:
 *
 *   - everywhere is reachable from town;
 *   - every gap in a wall pairs with a gap in the wall facing it;
 *   - within a route, every gap can be walked to from every other one, with
 *     no tools at all;
 *   - the copies of a biome are numbered outward, because that is the address
 *     every gym, every person and every one-off item is written down as.
 *
 * Any of those failing is a place in the world you cannot get to or cannot get
 * out of, and none of them would throw.
 */

/** Enough seeds that a shape which is merely lucky does not pass. */
const SEEDS = ["A1", "B2", "C3", "PKMFEVER1", "ZZZZ9"];

describe("the plan", () => {
  it("Y1: fifty places, all reachable, with loops and a few blind ends", () => {
    for (const seed of SEEDS) {
      const plan = planWorld(rngFor(seed, "plan"), placesWanted());

      expect(plan.nodes.length, seed).toBe(50);
      expect(new Set(plan.nodes.map((node) => node.id)).size, seed).toBe(50);
      expect(new Set(plan.nodes.map((node) => `${node.cell.x},${node.cell.y}`)).size, seed).toBe(50);

      // Nothing on the town's own cell, and nothing at depth 0 but the town.
      for (const node of plan.nodes) {
        expect(`${node.cell.x},${node.cell.y}`, seed).not.toBe("0,0");
        expect(node.depth, `${seed}: ${node.id}`).toBeGreaterThan(0);
      }

      // Links are symmetric, and a link's bearing is the way the neighbour
      // actually lies. Everything about walking between places rests on this.
      const byId = new Map(plan.nodes.map((node) => [node.id, node]));
      for (const node of plan.nodes) {
        for (const link of node.links) {
          expect(BEARINGS, `${seed}: ${node.id}`).toContain(link.bearing);

          if (link.to === HUB) {
            expect(
              [node.cell.x, node.cell.y].map(Math.abs).reduce((a, b) => a + b),
              `${seed}: ${node.id} links to town but is not beside it`,
            ).toBe(1);
            continue;
          }

          const other = byId.get(link.to);
          expect(other, `${seed}: ${node.id} links to a place that is not there`).toBeTruthy();
          const back = other!.links.find((each) => each.to === node.id);
          expect(back, `${seed}: ${node.id} -> ${link.to} is one-way`).toBeTruthy();
          expect(back!.bearing, `${seed}: ${node.id} -> ${link.to}`).toBe(opposite(link.bearing));

          const step = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }[link.bearing];
          expect(
            [other!.cell.x, other!.cell.y],
            `${seed}: ${link.to} is not ${link.bearing} of ${node.id}`,
          ).toEqual([node.cell.x + step[0], node.cell.y + step[1]]);
        }

        // Four sides, four neighbours at most, and no two the same way.
        expect(node.links.length, `${seed}: ${node.id}`).toBeGreaterThan(0);
        expect(node.links.length, `${seed}: ${node.id}`).toBeLessThanOrEqual(4);
        expect(new Set(node.links.map((link) => link.bearing)).size).toBe(node.links.length);
      }

      // Loops, which is the whole reason for the graph: a tree over fifty
      // nodes has forty-nine edges, so anything more than that is somewhere
      // you can walk round rather than only into and back out of.
      const edges =
        plan.nodes.reduce((total, node) => total + node.links.length, 0) / 2 +
        plan.hub.links.length / 2;
      expect(edges, `${seed}: no loops at all`).toBeGreaterThan(50);

      // And a few blind ends, so exploring can still be wrong. "A few": more
      // than none and nothing like a majority.
      const blind = plan.nodes.filter((node) => node.links.length === 1).length;
      expect(blind, `${seed}: nowhere to be disappointed`).toBeGreaterThan(0);
      expect(blind, `${seed}: the world is mostly cul-de-sacs`).toBeLessThan(15);
    }
  });

  it("Y2: no two worlds are the same shape", () => {
    // Not a property of the generator so much as a guard against losing it:
    // an unseeded rng, or a seed that stops reaching the grower, would leave
    // every player walking one map. The cells are the fingerprint.
    const shapes = SEEDS.map((seed) =>
      planWorld(rngFor(seed, "plan"), placesWanted())
        .nodes.map((node) => `${node.cell.x},${node.cell.y}`)
        .sort()
        .join(" "),
    );
    expect(new Set(shapes).size).toBe(SEEDS.length);
  });

  it("Y3: difficulty is distance, stretched onto the bands", () => {
    // The first hop is always the first band and the furthest place is always
    // the last one, whatever shape the world came out. Between them it only
    // has to be monotone: two hops that share a band are fine, a hop that
    // goes *backwards* is not.
    for (const bands of [6, 8, 10]) {
      for (const maxDepth of [4, 7, 8, 9, 12]) {
        expect(bandOf(0, maxDepth, bands)).toBe(0);
        expect(bandOf(1, maxDepth, bands)).toBe(1);
        expect(bandOf(maxDepth, maxDepth, bands)).toBe(bands);

        for (let depth = 2; depth <= maxDepth; depth++) {
          expect(
            bandOf(depth, maxDepth, bands),
            `depth ${depth} of ${maxDepth} over ${bands}`,
          ).toBeGreaterThanOrEqual(bandOf(depth - 1, maxDepth, bands));
        }
      }
    }
  });

  it("Y4: a place's name says which copy it is", () => {
    expect(copyOf("meadow-1")).toBe(1);
    expect(copyOf("crystalvault-1")).toBe(1);
    expect(copyOf("meadow-4")).toBe(4);
    // The town's own id goes through the same parser, and interiors carry a
    // colon rather than a dash — neither may come back as NaN.
    expect(copyOf(HUB)).toBe(1);
    expect(copyOf("nonsense")).toBe(1);
  });
});

describe("the world built on it", () => {
  /** Every route you can walk to from town, following borders. */
  function reachable(world: ReturnType<typeof testWorld>): Set<string> {
    const seen = new Set([HUB_ID]);
    const queue = [HUB_ID];
    for (let head = 0; head < queue.length; head++) {
      const route = world.routes.get(queue[head]);
      if (!route) continue;
      for (const border of route.borders) {
        if (seen.has(border.to)) continue;
        seen.add(border.to);
        queue.push(border.to);
      }
    }
    return seen;
  }

  /** Everywhere you can walk to inside one route, with no tools at all. */
  function onFoot(route: Route, from: { x: number; y: number }): Uint8Array {
    const seen = new Uint8Array(route.width * route.height);
    seen[from.y * route.width + from.x] = 1;
    const queue = [from];
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
        if (x < 0 || y < 0 || x >= route.width || y >= route.height) continue;
        if (seen[y * route.width + x]) continue;
        if (!walkable(route.tiles[y * route.width + x])) continue;
        seen[y * route.width + x] = 1;
        queue.push({ x, y });
      }
    }
    return seen;
  }

  it("Y5: every place in the world can be walked to from town", () => {
    for (const seed of SEEDS) {
      const world = testWorld(seed);
      const seen = reachable(world);

      for (const route of outdoorRoutes(world)) {
        expect(seen.has(route.id), `${seed}: ${route.id} is cut off from town`).toBe(true);
      }
      expect(outdoorRoutes(world).length, seed).toBe(placesWanted());
    }
  });

  it("Y6: and every gap in a route's wall can be walked to from every other", () => {
    // The one that would soft-lock a save. Walk in through one gate, find the
    // other three behind a boulder, and the only way on is the way you came —
    // except the route you came from may itself have been a one-way trip.
    //
    // Checked with *no tools*, because the obstacles in a route are supposed
    // to gate optional pockets and never the route. `placeGates` puts each one
    // down and takes it straight back up if this stops being true, and this is
    // the guard that says the check it uses is the right check.
    for (const seed of SEEDS) {
      const world = testWorld(seed);

      for (const route of outdoorRoutes(world)) {
        const seen = onFoot(route, route.entry);
        for (const gate of route.gates) {
          expect(
            seen[gate.y * route.width + gate.x],
            `${seed}: ${route.id} cannot walk to its ${gate.bearing} gate`,
          ).toBe(1);
        }
      }
    }
  });

  it("Y7: the copies of a biome are numbered outward from town", () => {
    // The address every hand-placed thing in the game uses. If this drifts,
    // "the nearest marsh" quietly becomes some other marsh and eight gyms,
    // twenty-one people and fourteen one-off items all move with it.
    for (const seed of SEEDS) {
      const world = testWorld(seed);
      const byBiome = new Map<string, Route[]>();
      for (const route of outdoorRoutes(world)) {
        byBiome.set(route.biome, [...(byBiome.get(route.biome) ?? []), route]);
      }

      expect(byBiome.size, seed).toBe(BIOMES.length);

      for (const spec of BIOMES) {
        const here = byBiome.get(spec.id)!;
        expect(here.length, `${seed}: ${spec.id}`).toBe(copiesOf(spec.tier));

        const inOrder = [...here].sort((a, b) => a.nth - b.nth);
        expect(inOrder.map((route) => route.nth), `${seed}: ${spec.id}`).toEqual(
          inOrder.map((_, index) => index + 1),
        );
        // The name and the field agree, and both agree with the distance.
        for (const route of inOrder) expect(copyOf(route.id), route.id).toBe(route.nth);
        for (let index = 1; index < inOrder.length; index++) {
          expect(
            inOrder[index].depth,
            `${seed}: ${spec.id} copy ${index + 1} is nearer than copy ${index}`,
          ).toBeGreaterThanOrEqual(inOrder[index - 1].depth);
        }
      }
    }
  });

  it("Y8: the band a route is graded into follows its distance", () => {
    for (const seed of SEEDS) {
      const world = testWorld(seed);
      const routes = outdoorRoutes(world);
      const deepest = Math.max(...routes.map((route) => route.depth));

      for (const route of routes) {
        expect(route.ring, route.id).toBe(bandOf(route.depth, deepest, DEFAULT_WORLD.rings));
        expect(route.ring, route.id).toBeGreaterThanOrEqual(1);
        expect(route.ring, route.id).toBeLessThanOrEqual(DEFAULT_WORLD.rings);
      }

      // Both ends of the curve are actually used, or the world is either
      // unwinnable at the door or never gets hard.
      expect(Math.min(...routes.map((route) => route.ring)), seed).toBe(1);
      expect(Math.max(...routes.map((route) => route.ring)), seed).toBe(DEFAULT_WORLD.rings);
    }
  });
});
