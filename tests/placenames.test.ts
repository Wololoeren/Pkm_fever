import { describe, expect, it } from "vitest";
import { ALL_SPECIES } from "@/engine/dex";
import { levelBracket } from "@/engine/levels";
import { placeWords } from "@/engine/placenames";
import { goalText } from "@/engine/quests";
import { DEFAULT_WORLD } from "@/engine/types";
import { generateWorld, wildAt } from "@/engine/world";
import { testWorld } from "./helpers";

/**
 * Route names.
 *
 * Every route is "<ground> of <thing> [low-high]": words from its own biome,
 * never the same name twice in one world, and the bracket is the truth about
 * the levels in its grass.
 */

describe("route names", () => {
  const SEEDS = ["NAMES1", "NAMES2", "Z4J5P5"];

  it("PN1: every route has a name no other route in its world has", () => {
    for (const seed of SEEDS) {
      const routes = [...testWorld(seed).routes.values()].filter((route) => route.kind === "route");
      const labels = routes.map((route) => route.label);
      expect(new Set(labels).size, seed).toBe(labels.length);
    }
  });

  it("PN2: a name is its biome's words and its level bracket", () => {
    for (const seed of SEEDS) {
      for (const route of testWorld(seed).routes.values()) {
        if (route.kind !== "route") continue;
        const match = /^(.+) of (.+) \[(\d+)-(\d+)\]$/.exec(route.label);
        expect(match, route.label).not.toBeNull();
        const words = placeWords(route.biome);
        expect(words.grounds, route.label).toContain(match![1]);
        expect(words.of, route.label).toContain(match![2]);
        expect([Number(match![3]), Number(match![4])]).toEqual(levelBracket(route.ring));
        expect(route.label).not.toMatch(/ring/);
      }
    }
  });

  it("PN3: the same seed names the same route the same thing", () => {
    const labels = (world: { routes: Map<string, { id: string; label: string }> }) =>
      [...world.routes.values()].map((route) => `${route.id}=${route.label}`).sort();
    // A fresh build of the world against the cached one.
    expect(labels(generateWorld(DEFAULT_WORLD, "NAMES1", ALL_SPECIES))).toEqual(labels(testWorld("NAMES1")));
  });

  it("PN4: the bracket is the truth — every wild creature in the grass is inside it, and both ends happen", () => {
    const world = testWorld("NAMES1");
    for (const route of world.routes.values()) {
      if (route.kind !== "route") continue;
      const [low, high] = levelBracket(route.ring);
      const levels = new Set<number>();
      for (let slot = 0; slot < 200; slot++) {
        const level = wildAt(world, ALL_SPECIES, route.id, slot, 1).level;
        expect(level, route.label).toBeGreaterThanOrEqual(low);
        expect(level, route.label).toBeLessThanOrEqual(high);
        levels.add(level);
      }
      expect(levels.has(low) && levels.has(high), route.label).toBe(true);
    }
  });

  it("PN5: a quest that sends you outward quotes the bracket, not a ring nobody can see", () => {
    const [low, high] = levelBracket(4);
    expect(goalText({ t: "reachRing", ring: 4 })).toBe(`Stand somewhere marked [${low}-${high}] or further out`);
  });
});
