import { describe, expect, it } from "vitest";
import { opposite, type Bearing } from "@/engine/layout";
import { ALL_SPECIES, movesAtLevel, species, STARTER_TRIOS } from "@/engine/dex";
import { applyInput, initialState, type GameState } from "@/engine/engine";
import { passable, walkable } from "@/engine/terrain";
import { PROPS } from "@/engine/props";
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
    // Read off the world rather than off three route names. It used to walk
    // meadow-1, meadow-3 and meadow-6, which was the same thing when the
    // number in the name was the ring — it is which copy now, and the copies
    // of one biome are scattered rather than in a line.
    const world = testWorld("A1");
    const byBand = new Map<number, string>();
    for (const route of outdoorRoutes(world)) if (!byBand.has(route.ring)) byBand.set(route.ring, route.id);

    const bands = [...byBand.keys()].sort((a, b) => a - b);
    expect(bands.length, "the world is graded into one band").toBeGreaterThan(3);

    const levelAt = (band: number) => wildAt(world, ALL_SPECIES, byBand.get(band)!, 3, 1).level;

    // Every step out is a step up, band by band, all the way to the far edge.
    for (let index = 1; index < bands.length; index++) {
      expect(
        levelAt(bands[index]),
        `band ${bands[index]} is no harder than band ${bands[index - 1]}`,
      ).toBeGreaterThan(levelAt(bands[index - 1]));
    }
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
        // Underground has no boards: the staircases are the only doors down
        // there, and a cave that sign-posted its own stairs would be a cave
        // with a receptionist. The mouth above ground is sign-posted.
        if (route.kind === "interior" || route.kind === "cave") continue;

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

  it("W21: and that holds at every crossing in the world, both ways", () => {
    // Every gap in every wall, walked out of and back into.
    //
    // This used to step east off each route and shrug if nothing happened,
    // because the world was a star and east was the way on. On a graph "east"
    // is a way on for some places and a wall for others, so a test that
    // shrugged was a test that passed by declining to look — and a crossing
    // whose two halves disagree is a door that puts you somewhere you cannot
    // walk back from. There are about a hundred and forty of them.
    const world = testWorld("B2");
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    let crossings = 0;

    for (const route of outdoorRoutes(world)) {
      for (const border of route.borders) {
        const dir =
          border.x === 0
            ? "w"
            : border.x === route.width - 1
              ? "e"
              : border.y === 0
                ? "n"
                : "s";

        const inside = {
          x: border.x === 0 ? 1 : border.x === route.width - 1 ? route.width - 2 : border.x,
          y: border.y === 0 ? 1 : border.y === route.height - 1 ? route.height - 2 : border.y,
        };

        const at: GameState = { ...base, route: route.id, ...inside };
        const out = step(world, at, dir);
        expect(out, `${route.id}: cannot step ${dir} onto its own border`).not.toBeNull();
        expect(out!.route, `${route.id} -> ${border.to}`).toBe(border.to);
        expect([out!.x, out!.y], `${route.id} -> ${border.to} landing`).toEqual([
          border.at.x,
          border.at.y,
        ]);

        const back = step(world, out!, opposite(dir as Bearing));
        expect(back, `no way back from ${border.to} to ${route.id}`).not.toBeNull();
        expect(back!.route).toBe(route.id);
        expect([back!.x, back!.y]).toEqual([inside.x, inside.y]);

        crossings++;
      }
    }

    // A world whose routes had no borders at all would satisfy every
    // expectation above by never running one.
    expect(crossings).toBeGreaterThan(60);
  });
});

describe("which way the gates face", () => {
  /** Which edge of a map a border tile sits on. */
  function edgeOf(gate: { x: number; y: number }, width: number, height: number): string {
    if (gate.x === 0) return "w";
    if (gate.x === width - 1) return "e";
    if (gate.y === 0) return "n";
    if (gate.y === height - 1) return "s";
    return "?";
  }

  it("W22: a gate is on the wall its bearing names, and its neighbour's is opposite", () => {
    // The invariant that replaced the rotation.
    //
    // Routes used to be generated running west to east and turned afterwards
    // to face the way their arm ran, and the bug that guarded was walking
    // north out of town and finding the way onward pointing *west*. There is
    // no turn now: a gate is cut on the real wall, and its bearing is how
    // wireBorders knows which of its neighbour's gates to pair it with. If a
    // bearing and a wall ever disagree, two places are joined through walls
    // that do not face each other and the crossing is a teleport.
    for (const seed of ["A1", "B2"]) {
      const world = testWorld(seed);

      for (const route of outdoorRoutes(world)) {
        for (const gate of route.gates) {
          expect(edgeOf(gate, route.width, route.height), `${route.id} ${gate.bearing}`).toBe(
            gate.bearing,
          );
        }

        // No two gates on one wall, and never more than four.
        expect(new Set(route.gates.map((gate) => gate.bearing)).size).toBe(route.gates.length);
        expect(route.gates.length).toBeGreaterThan(0);
        expect(route.gates.length).toBeLessThanOrEqual(4);

        // And every crossing pairs a wall with the wall facing it.
        for (const border of route.borders) {
          const here = edgeOf(border, route.width, route.height) as Bearing;
          const there = world.routes.get(border.to)!;
          const back = there.borders.find((each) => each.to === route.id);
          expect(back, `${route.id} -> ${there.id} is one-way`).toBeTruthy();
          expect(edgeOf(back!, there.width, there.height), `${route.id} -> ${there.id}`).toBe(
            opposite(here),
          );
        }
      }
    }
  });

  it("W23: every route is the same size, because none of them is turned", () => {
    const world = testWorld("A1");
    for (const route of outdoorRoutes(world)) {
      // Half the routes came out 68x88 when there was a rotation, and every
      // coordinate written down before the turn had to be mapped through it.
      // One shape means there is nothing to map.
      expect([route.width, route.height], route.id).toEqual([88, 68]);
    }
  });

  it("W25: a route is something to find your way through, not walk across", () => {
    // The complaint this guards, in one number.
    //
    // A room is carved *inset* from its cell, and that inset is the wall
    // between it and its neighbours. Five biomes were written with an inset of
    // nought, which carves the whole cell: adjacent rooms merged, and their
    // routes came out as one open field eighty cells across. On top of that
    // every gate was joined to the middle of the map with a corridor five wide,
    // straight through whatever the maze had drawn. Between them you could walk
    // in one side of any route and out of the other as though a path had been
    // cleared, and the maze underneath was scenery.
    //
    // Measured as how far you actually walk between two gaps in the wall
    // against how far apart they are. One means a straight line. Before this
    // was fixed the median across a world was 1.00 to 1.14 — that is, *most
    // routes were a straight line*. It is about 1.8 now.
    //
    // The threshold is well under what it measures, because this is a property
    // of a generator and not a fixed number: it should fail when routes stop
    // being mazes, not when a seed deals a slightly tidier world.
    for (const seed of ["A1", "B2", "C3"]) {
      const world = testWorld(seed);
      const ratios: number[] = [];

      for (const route of outdoorRoutes(world)) {
        // Open ground, as a share of the map. A field is the failure mode; a
        // route that is two thirds walkable has no walls left worth the name.
        const open = route.tiles.filter(walkable).length / route.tiles.length;
        expect(open, `${seed}: ${route.id} is an open field`).toBeLessThan(0.72);

        if (route.gates.length < 2) continue;

        for (let a = 0; a < route.gates.length; a++) {
          const from = insideOf(route.gates[a], route);
          const steps = walkFrom(route, from);

          for (let b = a + 1; b < route.gates.length; b++) {
            const to = insideOf(route.gates[b], route);
            const walk = steps[to.y * route.width + to.x];
            const line = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
            if (walk > 0 && line > 0) ratios.push(walk / line);
          }
        }
      }

      ratios.sort((a, b) => a - b);
      expect(ratios.length, `${seed}: nothing to measure`).toBeGreaterThan(50);

      const median = ratios[Math.floor(ratios.length / 2)];
      expect(median, `${seed}: the median route is a straight walk through`).toBeGreaterThan(1.4);

      // And it is not one heroic maze carrying a world of fields.
      const straight = ratios.filter((ratio) => ratio < 1.15).length;
      expect(straight / ratios.length, `${seed}: too many ways straight through`).toBeLessThan(0.3);
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

/** The walkable tile just inside a gap in the wall. */
function insideOf(
  gate: { x: number; y: number },
  route: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: gate.x === 0 ? 1 : gate.x === route.width - 1 ? route.width - 2 : gate.x,
    y: gate.y === 0 ? 1 : gate.y === route.height - 1 ? route.height - 2 : gate.y,
  };
}

/**
 * How many steps each tile is from here, with every tool.
 *
 * With the tools rather than without: a bush is meant to stop you, and a route
 * whose two gates are far apart *because of a boulder* is not the thing being
 * measured.
 */
function walkFrom(
  route: { width: number; height: number; tiles: number[] },
  from: { x: number; y: number },
): Int32Array {
  const steps = new Int32Array(route.width * route.height).fill(-1);
  steps[from.y * route.width + from.x] = 0;
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
      if (steps[y * route.width + x] >= 0) continue;
      // On foot. Cut and Surf shortcuts exist precisely to make the walk
      // shorter for somebody carrying them; the maze is what is left for
      // somebody who is not.
      if (!walkable(route.tiles[y * route.width + x])) continue;
      steps[y * route.width + x] = steps[at.y * route.width + at.x] + 1;
      queue.push({ x, y });
    }
  }
  return steps;
}

/**
 * Where the cast is allowed to stand.
 *
 * Route trainers were the one placement in the world that did not go through
 * `nearestSpot`, and so the one with none of its standards: `buildTrainers`
 * took any walkable tile at all. `TILE.DOOR` is walkable — it has to be, you
 * walk through it — so a trainer could be dealt a gym doorway, and more often
 * the single step in front of one, which is the only way in.
 *
 * A gym you cannot enter is a badge you cannot earn, on a save with no way to
 * reroll the world.
 */
describe("nobody stands where you need to walk", () => {
  /** Everybody solid on a route, from all three rosters. */
  function peopleOn(world: ReturnType<typeof testWorld>, routeId: string) {
    const out: { x: number; y: number; id: string; from: string }[] = [];
    for (const one of world.trainers.get(routeId) ?? []) {
      out.push({ x: one.x, y: one.y, id: one.id, from: "trainer" });
    }
    for (const one of world.npcs.get(routeId) ?? []) {
      out.push({ x: one.x, y: one.y, id: one.id, from: "npc" });
    }
    for (const one of world.critters.get(routeId) ?? []) {
      out.push({ x: one.x, y: one.y, id: one.id, from: "critter" });
    }
    return out;
  }

  // Sixteen worlds is sixteen full generations; the default timeout is for
  // tests that do arithmetic, not tests that build worlds.
  it("W26: nobody is standing in a doorway, or on the step in front of one", { timeout: 60_000 }, () => {
    // More seeds than the rest of this file uses, and deliberately: the
    // trainer that prompted this turned up on one route of one seed in eight.
    // A rule about a rare placement needs enough worlds to have seen it.
    const many = Array.from({ length: 16 }, (_, at) => `door${at}`);
    const wrong: string[] = [];
    let doors = 0;

    for (const seed of many) {
      const world = testWorld(seed);
      for (const route of world.routes.values()) {
        const people = peopleOn(world, route.id);
        if (!people.length) continue;

        for (let y = 0; y < route.height; y++) {
          for (let x = 0; x < route.width; x++) {
            // Asked of the tile rather than of `route.doors`, which lists only
            // the doors wired to an interior — a building whose room could not
            // be built still has a door drawn on it.
            if (route.tiles[y * route.width + x] !== DOOR_TILE) continue;
            doors++;

            for (const who of people) {
              const blocking =
                (who.x === x && who.y === y) ||
                // Orthogonally adjacent only. A diagonal neighbour is beside
                // the doorway rather than in front of it, and blocks nothing.
                Math.abs(who.x - x) + Math.abs(who.y - y) === 1;
              if (blocking) {
                wrong.push(`${seed} ${route.id}: ${who.from} ${who.id} at ${who.x},${who.y} vs door ${x},${y}`);
              }
            }
          }
        }
      }
    }

    // The evidence is worth nothing if there were no doors to stand in.
    expect(doors).toBeGreaterThan(100);
    expect(wrong, `somebody is blocking a door:\n${wrong.join("\n")}`).toEqual([]);
  });

  it("W27: and nobody is standing where they would wall the route off", () => {
    // The other standard route trainers were missing. A route is a real maze
    // with one-wide corridors, and a person is solid: a trainer on the wrong
    // tile is everything past them unreachable for the rest of the save.
    for (const seed of ["A1", "B2"]) {
      const world = testWorld(seed);
      for (const route of outdoorRoutes(world)) {
        const people = peopleOn(world, route.id);
        if (!people.length) continue;

        // Props are solid too, and they are solid in both terms — the
        // question is what the *cast* costs on top of the map as it is.
        const props = new Set(
          route.props.filter((prop) => !PROPS[prop.kind].walkable).map((prop) => `${prop.x},${prop.y}`),
        );
        const blocked = new Set([...props, ...people.map((who) => `${who.x},${who.y}`)]);
        const open = reachable(route, props);
        const withThem = reachable(route, blocked);

        // Everybody standing costs exactly the tile they stand on, and
        // nothing behind them.
        const standingOnReachable = people.filter((who) => open.has(`${who.x},${who.y}`)).length;
        expect(
          withThem.size,
          `${seed} ${route.id}: the cast cuts the route off`,
        ).toBe(open.size - standingOnReachable);
      }
    }
  });
});

/** `TILE.DOOR`, named here rather than imported as the whole table. */
const DOOR_TILE = 10;

/** Every tile you could walk to from the way in, given these are solid. */
function reachable(
  route: { width: number; height: number; tiles: ArrayLike<number>; entry: { x: number; y: number } },
  blocked: Set<string>,
): Set<string> {
  const seen = new Set<string>();
  const start = route.entry;
  if (blocked.has(`${start.x},${start.y}`)) return seen;
  if (!walkable(route.tiles[start.y * route.width + start.x])) return seen;

  const queue = [start];
  seen.add(`${start.x},${start.y}`);
  for (let head = 0; head < queue.length; head++) {
    const here = queue[head];
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      const x = here.x + dx;
      const y = here.y + dy;
      if (x < 0 || y < 0 || x >= route.width || y >= route.height) continue;
      const key = `${x},${y}`;
      if (seen.has(key) || blocked.has(key)) continue;
      if (!walkable(route.tiles[y * route.width + x])) continue;
      seen.add(key);
      queue.push({ x, y });
    }
  }
  return seen;
}
