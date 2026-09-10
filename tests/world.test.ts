import { describe, expect, it } from "vitest";
import { armOf } from "@/engine/biomes";
import { ALL_SPECIES, movesAtLevel, species, STARTER_TRIOS } from "@/engine/dex";
import { applyInput, initialState, type GameState } from "@/engine/engine";
import { passable, walkable } from "@/engine/terrain";
import { STAT_IDS } from "@/engine/types";
import { CENSUS_TOTAL, CHROMA_IDS, TOP_TIER, variant } from "@/engine/variants";
import { encounterTable, pickStarters, STARTER_COUNT, wildAt } from "@/engine/world";
import { outdoorRoutes, testWorld } from "./helpers";

/**
 * World generation invariants — the "census, not lottery" design, checked
 * against many seeds rather than one, because a rule that holds for the seed
 * the author happened to try is not a rule.
 */

/** Four seeds. A world is four times the size it was, so this is the same
 * evidence eight used to be, in a quarter of the time. */
const SEEDS = ["A1", "B2", "C3", "D4"];

/** The level a starter is handed to you at — see pickStarter in engine.ts. */
const STARTER_LEVEL = 5;

describe("the census", () => {
  it("W1: every world contains exactly the same census", () => {
    for (const seed of SEEDS) {
      expect(testWorld(seed).census.size).toBe(CENSUS_TOTAL);
    }
  });

  it("W2: every world holds exactly one true shiny, and one wearing a colour", () => {
    for (const seed of SEEDS) {
      const placed = [...testWorld(seed).census.values()].map((id) => variant(id));
      const top = placed.filter((form) => form.tier === TOP_TIER);

      expect(top.filter((form) => form.chromaId === null)).toHaveLength(1);
      expect(top.filter((form) => form.chromaId !== null)).toHaveLength(1);
    }
  });

  it("W2b: and which colour the crown wears is the seed's choice", () => {
    const crowns = SEEDS.map((seed) => {
      const placed = [...testWorld(seed).census.values()].map((id) => variant(id));
      return placed.find((form) => form.tier === TOP_TIER && form.chromaId)!.chromaId;
    });
    // Not a fixed colour across every world, which is what would make the
    // rarest thing in the game the same hunt in every save.
    expect(new Set(crowns).size).toBeGreaterThan(1);
  });

  it("W3: each chroma form appears exactly once on its own", () => {
    for (const seed of SEEDS) {
      const placed = [...testWorld(seed).census.values()];
      for (const id of CHROMA_IDS) {
        expect(placed.filter((value) => value === id)).toHaveLength(1);
      }
    }
  });

  it("W3b: and once more wearing a rung of the ladder", () => {
    for (const seed of SEEDS) {
      const placed = [...testWorld(seed).census.values()].map((id) => variant(id));
      for (const id of CHROMA_IDS) {
        const tinted = placed.filter(
          (form) => form.chromaId === id && form.tier > 0 && form.tier < TOP_TIER,
        );
        expect(tinted).toHaveLength(1);
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
        if (variant(variantId).chromaId !== null) {
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

describe("signs", () => {
  it("W19: every building outside is sign-posted, and no sign blocks a door", () => {
    for (const seed of ["A1", "B2", "C3", "D4"]) {
      const world = testWorld(seed);
      for (const route of world.routes.values()) {
        if (route.kind === "interior") continue;

        // A door you can see from outside has a board beside it.
        expect(route.signs.length).toBe(route.doors.length);

        for (const sign of route.signs) {
          expect(sign.text.length).toBeGreaterThan(0);

          // Standing on a signpost is not a thing, and standing in front of a
          // door has to stay one — a sign that took the doorstep would seal
          // the building it was advertising.
          expect(walkable(route.tiles[sign.y * route.width + sign.x])).toBe(false);
          for (const door of route.doors) {
            expect([sign.x, sign.y]).not.toEqual([door.x, door.y + 1]);
          }
        }
      }
    }
  });
});

describe("crossing a border", () => {
  /** Walks one step in a direction, returning null if it is not allowed. */
  function step(world: ReturnType<typeof testWorld>, state: GameState, dir: "n" | "s" | "e" | "w") {
    try {
      return applyInput(world, state, { t: "move", dir });
    } catch {
      return null;
    }
  }

  it("W20: leaving town and coming straight back returns you to the tile you left", () => {
    // Leaving town eastward and walking back used to land you on the far side
    // of the square: every return from ring one arrived at the *western* gap,
    // whichever arm you had come from.
    //
    // Driven from the gates rather than by walking in a straight line from the
    // middle. A straight line was fine until people were standing in the
    // world — they are solid, so walking into one talks to them instead of
    // moving, and the test failed on a town that was working perfectly.
    const world = testWorld("A1");
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const town = world.routes.get("hub-0")!;
    const dirs = ["n", "s", "e", "w"] as const;

    expect(town.borders.length).toBeGreaterThan(1);

    for (const gate of town.borders) {
      // Stand just inside the gap, then step onto it.
      const inside = {
        x: gate.x === 0 ? 1 : gate.x === town.width - 1 ? town.width - 2 : gate.x,
        y: gate.y === 0 ? 1 : gate.y === town.height - 1 ? town.height - 2 : gate.y,
      };
      const at: GameState = { ...base, route: town.id, ...inside };

      const out = dirs.map((dir) => step(world, at, dir)).find((next) => next && next.route === gate.to);
      expect(out, `no way out of town toward ${gate.to}`).toBeTruthy();

      const home = dirs
        .map((dir) => step(world, out!, dir))
        .find((next) => next && next.route === town.id);
      expect(home, `no way back into town from ${gate.to}`).toBeTruthy();
      expect([home!.x, home!.y]).toEqual([inside.x, inside.y]);
    }
  });

  it("W21: and that holds between rings, in both directions", () => {
    const world = testWorld("B2");

    for (const route of outdoorRoutes(world)) {
      const exitRow = route.tiles.findIndex((_, index) => {
        const x = index % route.width;
        return x === route.width - 1 && walkable(route.tiles[index]);
      });
      if (exitRow < 0) continue;

      const y = Math.floor(exitRow / route.width);
      const at: GameState = {
        ...applyInput(world, initialState(world), { t: "pickStarter", index: 0 }),
        route: route.id,
        x: route.width - 2,
        y,
      };

      const out = step(world, at, "e");
      if (!out || out.route === route.id) continue;

      const back = step(world, out, "w");
      expect(back, `no way back from ${out.route} to ${route.id}`).not.toBeNull();
      expect(back!.route).toBe(route.id);
      expect([back!.x, back!.y]).toEqual([at.x, at.y]);
    }
  });
});

describe("which way an arm runs", () => {
  /** Which edge of a map a border tile sits on. */
  function edgeOf(gate: { x: number; y: number }, width: number, height: number): string {
    if (gate.x === 0) return "W";
    if (gate.x === width - 1) return "E";
    if (gate.y === 0) return "N";
    if (gate.y === height - 1) return "S";
    return "?";
  }

  it("W22: going up keeps going up, and every arm points away from town", () => {
    // Routes are generated running west to east and turned afterwards. Before
    // that, all four arms ran sideways: you walked north out of town and the
    // way onward was *west*, because the map had not been turned to match the
    // direction you left in.
    //
    // Derived from the arm layout rather than tabulated. It used to be a table
    // of four biome names, so a fifth biome failed this test by having no
    // row — and sixteen more would have meant sixteen rows all saying the
    // same four things. Five arms share each wall of town and all five run the
    // same way, so the expectation is a property of the wall.
    const byEdge = [
      { home: "E", on: "W" },
      { home: "S", on: "N" },
      { home: "W", on: "E" },
      { home: "N", on: "S" },
    ];

    for (const seed of ["A1", "B2"]) {
      const world = testWorld(seed);
      for (const route of outdoorRoutes(world)) {
        const index = world.config.biomes.indexOf(route.biome);
        expect(index, `${route.biome} is not in the config`).toBeGreaterThanOrEqual(0);

        const want = byEdge[armOf(index).edge];
        expect(edgeOf(route.inGate!, route.width, route.height), route.id).toBe(want.home);
        expect(edgeOf(route.outGate!, route.width, route.height), route.id).toBe(want.on);
      }
    }
  });

  it("W23: the arms that run up and down are taller than they are wide", () => {
    const world = testWorld("A1");
    for (const route of outdoorRoutes(world)) {
      // The north and south walls, whichever biomes happen to hang off them.
      const edge = armOf(world.config.biomes.indexOf(route.biome)).edge;
      const upright = edge === 1 || edge === 3;

      expect(
        upright ? route.height > route.width : route.width > route.height,
        `${route.id} on edge ${edge}`,
      ).toBe(true);
      // Four times the area of the old routes, whichever way round.
      expect(route.width * route.height).toBe(88 * 68);
    }
  });

  it("W24: every room a route carves can be reached, given the right tools", () => {
    // The whole point of carving a maze over a spanning tree rather than
    // scattering obstacles: connectivity is structural. If this ever fails,
    // some route has a piece of itself walled off and something on it — a
    // trainer, an item, the one shiny — is unreachable.
    //
    // "Reachable" means with the tools, not on foot. A bush is supposed to
    // stop you; what would be a bug is a bush nothing can ever get past.
    for (const seed of ["A1", "B2", "C3", "D4"]) {
      const world = testWorld(seed);
      for (const route of outdoorRoutes(world)) {
        const seen = new Uint8Array(route.width * route.height);
        const start = route.entry;
        const queue = [start];
        seen[start.y * route.width + start.x] = 1;
        let reached = 0;

        for (let head = 0; head < queue.length; head++) {
          const at = queue[head];
          reached++;
          for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const x = at.x + dx;
            const y = at.y + dy;
            if (x < 0 || y < 0 || x >= route.width || y >= route.height) continue;
            const index = y * route.width + x;
            if (seen[index] || !passable(route.tiles[index], () => true)) continue;
            seen[index] = 1;
            queue.push({ x, y });
          }
        }

        const open = route.tiles.filter((tile) => passable(tile, () => true)).length;
        // Doors are walkable but sit in a wall, so allow the handful of them.
        expect(reached, `${seed} ${route.id} strands ${open - reached} tiles`).toBeGreaterThanOrEqual(
          open - route.doors.length,
        );
      }
    }
  });
});
