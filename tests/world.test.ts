import { describe, expect, it } from "vitest";
import { ALL_SPECIES, movesAtLevel, species } from "@/engine/dex";
import { STAT_IDS } from "@/engine/types";
import { CENSUS_TOTAL, variant } from "@/engine/variants";
import { encounterTable, HUB_ID, starterPool, wildAt } from "@/engine/world";
import { testWorld } from "./helpers";

/**
 * World generation invariants — the "census, not lottery" design, checked
 * against many seeds rather than one, because a rule that holds for the seed
 * the author happened to try is not a rule.
 */

const SEEDS = ["A1", "B2", "C3", "D4", "E5", "F6", "G7", "H8"];

/** The level a starter is handed to you at — see pickStarter in engine.ts. */
const STARTER_LEVEL = 5;

describe("the census", () => {
  it("W1: every world contains exactly the same census", () => {
    for (const seed of SEEDS) {
      expect(testWorld(seed).census.size).toBe(CENSUS_TOTAL);
    }
  });

  it("W2: every world holds exactly one true shiny", () => {
    for (const seed of SEEDS) {
      const shinies = [...testWorld(seed).census.values()].filter((id) => id === "shiny");
      expect(shinies).toHaveLength(1);
    }
  });

  it("W3: each chroma form appears exactly once", () => {
    for (const seed of SEEDS) {
      const placed = [...testWorld(seed).census.values()];
      for (const id of ["ember", "tide", "static", "verdant", "umbral"]) {
        expect(placed.filter((v) => v === id)).toHaveLength(1);
      }
    }
  });

  it("W4: nothing rare hides in the hub, and rare things live far out", () => {
    for (const seed of SEEDS) {
      const world = testWorld(seed);
      for (const [key, variantId] of world.census) {
        const route = world.routes.get(key.split(":")[0]);
        expect(route).toBeDefined();
        expect(route!.ring).toBeGreaterThanOrEqual(1);
        if (variant(variantId).kind !== "tint") {
          expect(route!.ring).toBeGreaterThanOrEqual(world.config.rings - 2);
        }
      }
    }
  });

  it("W5: the census is reachable — every slot is inside the encounter range", () => {
    // A shiny placed at slot 900 is the same as no shiny at all.
    for (const seed of SEEDS) {
      for (const key of testWorld(seed).census.keys()) {
        expect(Number(key.split(":")[1])).toBeLessThan(120);
      }
    }
  });
});

describe("starters", () => {
  it("W6: every world offers six distinct starters", () => {
    for (const seed of SEEDS) {
      const { starters } = testWorld(seed);
      expect(starters).toHaveLength(6);
      expect(new Set(starters).size).toBe(6);
    }
  });

  it("W7: a starter is always the base of a three-stage line", () => {
    const pool = new Set(starterPool(ALL_SPECIES).map((s) => s.id));
    for (const seed of SEEDS) {
      for (const id of testWorld(seed).starters) {
        expect(pool.has(id)).toBe(true);
        const middle = species(species(id).evolvesTo[0].id);
        expect(middle.evolvesTo.length).toBe(1);
      }
    }
  });
});

describe("routes", () => {
  it("W8: no route is empty, so no patch of grass can soft-lock", () => {
    const world = testWorld("A1");
    for (const route of world.routes.values()) {
      if (route.id === HUB_ID) continue;
      const table = encounterTable(ALL_SPECIES, route.biome, route.ring, world.config.rings);
      expect(table.length).toBeGreaterThan(0);
    }
  });

  it("W9: difficulty rises with distance from the hub", () => {
    const world = testWorld("A1");
    const levelAt = (ring: number) => wildAt(world, ALL_SPECIES, `meadow-${ring}`, 3, 1).level;
    expect(levelAt(1)).toBeLessThan(levelAt(3));
    expect(levelAt(3)).toBeLessThan(levelAt(6));
  });

  it("W12: the first ring is winnable with the starter you are given", () => {
    // Found by playing: ring 1 used to deal level 9 wilds to a level 5
    // starter, so the first patch of grass outside the hub was unwinnable and
    // the game opened by killing you. Nothing in ring 1 may outlevel the
    // starter it is meant to be fought with.
    for (const seed of SEEDS) {
      const world = testWorld(seed);
      for (const route of world.routes.values()) {
        if (route.ring !== 1) continue;
        for (let slot = 0; slot < 30; slot++) {
          expect(wildAt(world, ALL_SPECIES, route.id, slot, 1).level).toBeLessThanOrEqual(STARTER_LEVEL);
        }
      }
    }
  });

  it("W10: every wild creature knows at least one move", () => {
    const world = testWorld("A1");
    for (const route of world.routes.keys()) {
      if (route === HUB_ID) continue;
      for (let slot = 0; slot < 10; slot++) {
        const wild = wildAt(world, ALL_SPECIES, route, slot, 1);
        expect(movesAtLevel(wild.speciesId, wild.level).length).toBeGreaterThan(0);
      }
    }
  });

  it("W11: every species in the manifest has complete stats", () => {
    for (const entry of ALL_SPECIES) {
      for (const stat of STAT_IDS) {
        expect(Number.isInteger(entry.base[stat])).toBe(true);
        expect(entry.base[stat]).toBeGreaterThan(0);
      }
      expect(entry.catchRate).toBeGreaterThanOrEqual(3);
      expect(entry.catchRate).toBeLessThanOrEqual(255);
    }
  });
});
