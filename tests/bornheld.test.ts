import { describe, expect, it } from "vitest";
import {
  rollHeld,
  STARTER_HELD_ITEMS,
  STARTER_HELD_PER_MILLE,
  WILD_HELD_ITEMS,
  WILD_HELD_PER_MILLE,
} from "@/engine/carry";
import { ALL_SPECIES } from "@/engine/dex";
import { offeredStarter } from "@/engine/engine";
import { isItem } from "@/engine/items";
import { rngFor } from "@/engine/rng";
import { outdoorRoutes, testWorld } from "./helpers";
import { wildAt } from "@/engine/world";

/** Wild creatures now and then hold something; starters more often, and better. */
describe("born holding something", () => {
  it("BH1: 1% for the wild, 30% for starters, from pools of real items", () => {
    expect(WILD_HELD_PER_MILLE).toBe(10);
    expect(STARTER_HELD_PER_MILLE).toBe(300);
    for (const id of [...WILD_HELD_ITEMS, ...STARTER_HELD_ITEMS]) expect(isItem(id), id).toBe(true);
    expect(WILD_HELD_ITEMS).toContain("nugget");
    expect(WILD_HELD_ITEMS).toContain("pearl");
  });

  it("BH2: the roll lands at about the rate it says", () => {
    const runs = 100_000;
    let wild = 0;
    let starter = 0;
    for (let n = 0; n < runs; n++) {
      if (rollHeld(rngFor("held", "wild", n), WILD_HELD_ITEMS, WILD_HELD_PER_MILLE)) wild++;
      if (rollHeld(rngFor("held", "starter", n), STARTER_HELD_ITEMS, STARTER_HELD_PER_MILLE)) starter++;
    }
    expect(wild / runs).toBeCloseTo(0.01, 2);
    expect(starter / runs).toBeCloseTo(0.3, 1);
  });

  it("BH3: real encounters and starters carry them, and only from their own pool", () => {
    const world = testWorld("PKMFEVER1");
    const route = outdoorRoutes(world)[0].id;
    let holding = 0;
    for (let slot = 0; slot < 3000; slot++) {
      const held = wildAt(world, ALL_SPECIES, route, slot, 1).heldItem;
      if (!held) continue;
      holding++;
      expect(WILD_HELD_ITEMS).toContain(held);
    }
    expect(holding).toBeGreaterThan(10);
    expect(holding).toBeLessThan(60);

    let starters = 0;
    for (let seed = 0; seed < 300; seed++) {
      // One world, many seeds: the roll reads only the seed and the slot.
      const held = offeredStarter({ ...world, seed: `HELD${seed}` }, 0).heldItem;
      if (!held) continue;
      starters++;
      expect(STARTER_HELD_ITEMS).toContain(held);
    }
    expect(starters).toBeGreaterThan(10);
  });
});
