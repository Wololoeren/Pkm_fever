import { describe, expect, it } from "vitest";
import { profileFor } from "@/engine/biomes";
import { passable, TILE, walkable } from "@/engine/terrain";
import type { Route } from "@/engine/world";
import { testWorld } from "./helpers";

/** Steps from one tile to every other, crossing what `open` allows. */
function distances(route: Route, from: { x: number; y: number }, open: (tile: number) => boolean): Int32Array {
  const out = new Int32Array(route.width * route.height).fill(-1);
  const queue = [from];
  out[from.y * route.width + from.x] = 0;
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (x < 0 || y < 0 || x >= route.width || y >= route.height) continue;
      const i = y * route.width + x;
      if (out[i] >= 0 || !open(route.tiles[i])) continue;
      out[i] = out[at.y * route.width + at.x] + 1;
      queue.push({ x, y });
    }
  }
  return out;
}

const WATERS = new Set<number>([TILE.WATER, TILE.WATERFALL, TILE.WHIRLPOOL, TILE.DEEP]);

describe("the lake and the shortcuts", () => {
  it("LK1: every world has one big lake, on a route with land walls", () => {
    for (const seed of ["PKMFEVER1", "LAKE3", "LAKE4"]) {
      const world = testWorld(seed);
      const lakes = [...world.routes.values()].filter(
        (route) =>
          route.kind === "route" &&
          profileFor(route.biome).wall !== TILE.WATER &&
          route.tiles.filter((tile) => WATERS.has(tile)).length >= 400,
      );
      expect(lakes, seed).toHaveLength(1);
    }
  });

  it("LK2: with Cut and Surf the gates are sometimes closer, and never further or cut off on foot", () => {
    const world = testWorld("PKMFEVER1");
    const onFoot = walkable;
    const withTools = (tile: number) => passable(tile, (item) => item === "hm-cut" || item === "hm-surf");
    let shorter = 0;
    for (const route of [...world.routes.values()].filter((one) => one.kind === "route")) {
      const [first, ...rest] = route.gates;
      if (!first || !rest.length) continue;
      const start = { x: first.x, y: first.y };
      const walking = distances(route, start, onFoot);
      const tooled = distances(route, start, withTools);
      for (const gate of rest) {
        const i = gate.y * route.width + gate.x;
        expect(walking[i], `${route.id}: gate unreachable on foot`).toBeGreaterThan(0);
        expect(tooled[i]).toBeLessThanOrEqual(walking[i]);
        if (tooled[i] < walking[i]) shorter++;
      }
    }
    expect(shorter, "no shortcut shortened anything").toBeGreaterThan(5);
  });
});
