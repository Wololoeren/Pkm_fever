import { describe, expect, it } from "vitest";
import { ALL_SPECIES, movesAtLevel, species, STARTER_TRIOS } from "@/engine/dex";
import { applyInput, initialState } from "@/engine/engine";
import { walkable } from "@/engine/terrain";
import { STAT_IDS } from "@/engine/types";
import { CENSUS_TOTAL, variant } from "@/engine/variants";
import { encounterTable, HUB_ID, pickStarters, STARTER_COUNT, wildAt } from "@/engine/world";
import { outdoorRoutes, testWorld } from "./helpers";

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
  it("W6: every world offers three distinct starters", () => {
    for (const seed of SEEDS) {
      const { starters } = testWorld(seed);
      expect(starters).toHaveLength(STARTER_COUNT);
      expect(new Set(starters).size).toBe(STARTER_COUNT);
    }
  });

  it("W6b: always one grass, one fire and one water, in that order", () => {
    // The point of three rather than six: the first decision the game asks
    // has to be a real one, and it is only real if the three answers differ.
    for (const seed of SEEDS) {
      const primaries = testWorld(seed).starters.map((id) => species(id).types[0]);
      expect(primaries).toEqual(["grass", "fire", "water"]);
    }
  });

  it("W7: every one of them is an actual starter", () => {
    // The heuristic this replaced asked for three-stage lines with a base stat
    // total between 280 and 330, and duly offered Beldum, Klink and Solosis.
    const real = new Set(STARTER_TRIOS.flat());
    for (const seed of SEEDS) {
      for (const id of testWorld(seed).starters) expect(real.has(id)).toBe(true);
    }
  });

  it("W7b: each is the bottom of a three-stage line", () => {
    for (const seed of SEEDS) {
      for (const id of testWorld(seed).starters) {
        const middle = species(species(id).evolvesTo[0].id);
        // At least one final form: Quilava evolves into both Typhlosion and
        // Typhlosion-Hisui, so "exactly one" would fail three real starters.
        expect(middle.evolvesTo.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("W7c: the whole curated list is reachable, not just the first trio", () => {
    // Each type is drawn independently, so a world can pair Charmander with
    // Rowlet and Quaxly. Over enough seeds every starter should turn up.
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      for (const id of pickStarters(`SEED${i}`, ALL_SPECIES)) seen.add(id);
    }
    for (const id of STARTER_TRIOS.flat()) expect(seen.has(id)).toBe(true);
  });

  it("W7d: a roster with no curated list still offers three distinct types", () => {
    // The fallback keeps the roster swappable: point the build script at a
    // different bestiary and the game still opens with a choice.
    const fallback = pickStarters("A1", ALL_SPECIES.filter((s) => !STARTER_TRIOS.flat().includes(s.id)));
    expect(fallback).toHaveLength(STARTER_COUNT);
    expect(new Set(fallback).size).toBe(STARTER_COUNT);
  });
});

describe("routes", () => {
  it("W8: no route is empty, so no patch of grass can soft-lock", () => {
    const world = testWorld("A1");
    for (const route of outdoorRoutes(world)) {
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
      for (const route of outdoorRoutes(world)) {
        if (route.ring !== 1) continue;
        for (let slot = 0; slot < 30; slot++) {
          expect(wildAt(world, ALL_SPECIES, route.id, slot, 1).level).toBeLessThanOrEqual(STARTER_LEVEL);
        }
      }
    }
  });

  it("W10: every wild creature knows at least one move", () => {
    const world = testWorld("A1");
    for (const route of outdoorRoutes(world)) {
      for (let slot = 0; slot < 10; slot++) {
        const wild = wildAt(world, ALL_SPECIES, route.id, slot, 1);
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

describe("doors", () => {
  it("W17: every door lands you somewhere you could stand", () => {
    // The interior knows where its own front step is; the town knows where
    // its door tile is. Wiring one to the other by hand put the player at a
    // town coordinate inside a 13x10 room — off the map, invisible, and
    // unable to move in any direction. The tests passed anyway, because they
    // placed the player by asking the room. This asks the doors.
    for (const seed of ["A1", "B2", "C3", "D4"]) {
      const world = testWorld(seed);
      for (const route of world.routes.values()) {
        for (const door of route.doors) {
          const target = world.routes.get(door.to);
          expect(target, `${route.id} has a door to nowhere`).toBeDefined();

          const { x, y } = door.at;
          expect(x, `${route.id} -> ${door.to}`).toBeGreaterThanOrEqual(0);
          expect(y, `${route.id} -> ${door.to}`).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(target!.width);
          expect(y).toBeLessThan(target!.height);
          expect(walkable(target!.tiles[y * target!.width + x])).toBe(true);
        }
      }
    }
  });

  it("W18: and walking through one and back leaves you outside it again", () => {
    const world = testWorld("A1");
    let state = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    const town = world.routes.get(state.route)!;
    const door = town.doors[0];
    state = { ...state, x: door.x, y: door.y + 1 };
    const indoors = applyInput(world, state, { t: "move", dir: "n" });

    expect(indoors.route).toBe(door.to);
    const room = world.routes.get(indoors.route)!;
    expect(walkable(room.tiles[indoors.y * room.width + indoors.x])).toBe(true);

    // The way out is the tile below the one you arrive on.
    const outdoors = applyInput(world, indoors, { t: "move", dir: "s" });
    expect(outdoors.route).toBe(town.id);
    expect(walkable(town.tiles[outdoors.y * town.width + outdoors.x])).toBe(true);
  });
});
