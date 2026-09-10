import { describe, expect, it } from "vitest";
import {
  BIOMES,
  BIOME_IDS,
  biome,
  copiesOf,
  isBiome,
  placesWanted,
  profileFor,
  tiersOf,
  typesFor,
} from "@/engine/biomes";
import { ALL_SPECIES, TYPE_NAMES } from "@/engine/dex";
import { TILE, walkable } from "@/engine/terrain";
import { DEFAULT_WORLD } from "@/engine/types";
import { BEARINGS } from "@/engine/layout";
import {
  encounterTable,
  routeId,
  TOWN_HEIGHT,
  TOWN_WIDTH,
  townArrival,
  townExits,
} from "@/engine/world";
import { paletteFor } from "@/render/tiles";
import { outdoorRoutes, testWorld } from "./helpers";

/**
 * Twenty places, and the three tables that have to agree about them.
 *
 * A biome is a row in `biomes.ts` (what it is made of, what lives in it), a
 * palette in `render/tiles.ts` (what it looks like), and a tier (how many of
 * it there are, and roughly how far out). Adding one means touching two files
 * in two layers, and the failure when you forget the second is *silent*: a
 * place that generates correctly, holds the right creatures, and is painted
 * meadow green.
 *
 * `paletteFor` falls back to the meadow by design, so nothing throws and
 * nothing looks obviously wrong — you just have two biomes the same colour and
 * no reason to suspect it. This file is the reason to suspect it.
 */

const SEEDS = ["A1", "B2"];

describe("the tables agree", () => {
  it("X1: every biome has a palette of its own, and no two share one", () => {
    // The silent one. A missing palette is not an error, it is the meadow.
    const seen = new Map<string, string>();

    for (const spec of BIOMES) {
      const key = JSON.stringify(paletteFor(spec.id));
      const already = seen.get(key);

      expect(
        already,
        `${spec.id} is painted exactly like ${already} — it has no palette of its own`,
      ).toBeUndefined();
      seen.set(key, spec.id);
    }

    // And the two that are places without being biomes still have theirs.
    for (const other of ["hearth", "indoors"]) {
      expect(JSON.stringify(paletteFor(other)), other).not.toBe(
        JSON.stringify(paletteFor(BIOMES[0].id)),
      );
    }
  });

  it("X2: the default world is the biome list, and every id resolves", () => {
    expect(DEFAULT_WORLD.biomes).toEqual([...BIOME_IDS]);
    expect(BIOMES.length).toBe(20);
    expect(new Set(BIOME_IDS).size).toBe(BIOMES.length);

    for (const id of BIOME_IDS) {
      expect(isBiome(id)).toBe(true);
      expect(biome(id).id).toBe(id);
      expect(profileFor(id)).toBe(biome(id).profile);
      expect(typesFor(id)).toBe(biome(id).types);
    }

    expect(() => biome("nowhere")).toThrow();
    // The two that are not biomes fall back rather than throwing, because the
    // town and every interior carry a `biome` string that is not one.
    expect(profileFor("hearth")).toBe(BIOMES[0].profile);
    expect(typesFor("indoors")).toEqual([]);
  });

  it("X3: the town has one way out per wall, and none of them is a corner", () => {
    // Twenty gaps, five to a wall, because twenty arms hung off the town. The
    // town is one cell of a lattice now: four neighbours at most, each in a
    // compass direction, so a gap is the middle of a wall.
    const gaps = townExits(TOWN_WIDTH, TOWN_HEIGHT);
    const all = BEARINGS.map((bearing) => gaps[bearing]);
    expect(all.length).toBe(4);

    const keys = new Set(all.map((gap) => `${gap.x},${gap.y}`));
    expect(keys.size, "two ways out share one gap in the town wall").toBe(4);

    for (const bearing of BEARINGS) {
      const gap = gaps[bearing];
      const onEdge =
        gap.x === 0 || gap.y === 0 || gap.x === TOWN_WIDTH - 1 || gap.y === TOWN_HEIGHT - 1;
      expect(onEdge, `${bearing} gap ${gap.x},${gap.y} is not on the wall`).toBe(true);

      // Never a corner: a corner gap has no tile inside it to arrive on.
      const corner =
        (gap.x === 0 || gap.x === TOWN_WIDTH - 1) && (gap.y === 0 || gap.y === TOWN_HEIGHT - 1);
      expect(corner, `${bearing} gap is a corner`).toBe(false);

      // And the wall it is on is the one that bearing names, or walking north
      // out of town comes back in from the west.
      const wall =
        gap.y === 0 ? "n" : gap.y === TOWN_HEIGHT - 1 ? "s" : gap.x === 0 ? "w" : "e";
      expect(wall, `the ${bearing} gap is on the ${wall} wall`).toBe(bearing);

      // Somewhere to stand when you walk back in, and it is inside.
      const landing = townArrival(TOWN_WIDTH, TOWN_HEIGHT, bearing);
      expect(landing.x).toBeGreaterThan(0);
      expect(landing.y).toBeGreaterThan(0);
      expect(landing.x).toBeLessThan(TOWN_WIDTH - 1);
      expect(landing.y).toBeLessThan(TOWN_HEIGHT - 1);
    }
  });

  it("X4: the tiers deal fifty places out of twenty kinds", () => {
    const tiers = tiersOf();
    expect(tiers.length).toBe(4);

    // Five of each tier, and four copies of the most ordinary down to one of
    // the strangest. The shape of that is the design: you should meet a meadow
    // four times over and a Crystal Vault once ever.
    expect(tiers.map((ids) => ids.length)).toEqual([5, 5, 5, 5]);
    expect([0, 1, 2, 3].map(copiesOf)).toEqual([4, 3, 2, 1]);
    expect(placesWanted()).toBe(50);

    // Every biome in exactly one tier, and the tier on the row is the tier it
    // is filed under — the two are read from the same field, and this is the
    // guard that says so.
    const filed = new Map<string, number>();
    tiers.forEach((ids, tier) => ids.forEach((id) => filed.set(id, tier)));
    expect(filed.size).toBe(BIOMES.length);
    for (const spec of BIOMES) expect(filed.get(spec.id), spec.id).toBe(spec.tier);
  });
});

describe("they are actually different places", () => {
  it("X5: no two biomes have the same terrain profile", () => {
    // Twenty biomes that differ only in colour is one biome with twenty coats.
    const seen = new Map<string, string>();

    for (const spec of BIOMES) {
      const key = JSON.stringify(spec.profile);
      const already = seen.get(key);
      expect(already, `${spec.id} is shaped exactly like ${already}`).toBeUndefined();
      seen.set(key, spec.id);
    }
  });

  it("X6: no two hold the same creatures, and every type has somewhere to live", () => {
    const seen = new Map<string, string>();
    for (const spec of BIOMES) {
      const key = [...spec.types].sort().join(",");
      const already = seen.get(key);
      expect(already, `${spec.id} holds exactly what ${already} holds`).toBeUndefined();
      seen.set(key, spec.id);

      // Between two and five. One type is a novelty route with six creatures
      // on it; six is "most things".
      expect(spec.types.length, spec.id).toBeGreaterThanOrEqual(2);
      expect(spec.types.length, spec.id).toBeLessThanOrEqual(5);
      for (const type of spec.types) expect(TYPE_NAMES, `${spec.id}: ${type}`).toContain(type);
    }

    // All eighteen. The four settled biomes leave Electric, Ice, Fighting,
    // Psychic and Dragon with nowhere at all, which is the clearest sign that
    // four biomes is not enough for a bestiary of eleven hundred.
    const covered = new Set(BIOMES.flatMap((spec) => spec.types));
    const missing = TYPE_NAMES.filter((type) => type !== "stellar" && !covered.has(type));
    expect(missing, `no biome holds: ${missing.join(", ")}`).toEqual([]);
  });

  it("X7: every biome has something to meet at every ring", () => {
    // A route whose grass does nothing is, for a place whose whole business is
    // what lives in it, the worst thing it can be. `encounterTable` widens
    // rather than returning empty, so this is really a check that the widening
    // never has to fire — the thinnest tables in the game are here.
    for (const spec of BIOMES) {
      for (let ring = 1; ring <= DEFAULT_WORLD.rings; ring++) {
        const table = encounterTable(ALL_SPECIES, spec.id, ring, DEFAULT_WORLD.rings);
        expect(table.length, `${spec.id} ring ${ring}`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("X8: the knobs stay inside what the generator can act on", () => {
    for (const spec of BIOMES) {
      const { corridor, loops, grass, pools, clutter, roomInset } = spec.profile;

      // A route narrows by one tile every three rings and loops fall by one
      // per ring, both with a floor of 2 — so anything at or below 2 is the
      // same as 2, and saying 1 would be saying nothing.
      expect(corridor, `${spec.id} corridor`).toBeGreaterThanOrEqual(2);
      expect(loops, `${spec.id} loops`).toBeGreaterThanOrEqual(2);

      // Grass is a share per mille. Below about a tenth there is nowhere to
      // hunt on the route at all.
      expect(grass, `${spec.id} grass`).toBeGreaterThanOrEqual(100);
      expect(grass, `${spec.id} grass`).toBeLessThanOrEqual(1000);

      expect(pools, `${spec.id} pools`).toBeGreaterThanOrEqual(0);
      expect(clutter, `${spec.id} clutter`).toBeGreaterThanOrEqual(0);
      expect(roomInset[0], `${spec.id} inset`).toBeLessThanOrEqual(roomInset[1]);

      // The inset *is* the wall between a room and its neighbours, so nought
      // carves the whole cell and the two rooms merge. Five biomes were
      // written `[0, 0]` and their routes came out as one open field.
      //
      // And it is exactly one at the near end, never two. A room inset two into
      // an eight-tile cell is four across, and a building is five by four — so
      // a biome whose rooms are *all* inset two is a biome where a gym hall
      // cannot be built, which is how six of these were caught. Rolling from
      // one means about half the rooms of any route can take a roof.
      expect(roomInset[0], `${spec.id} inset`).toBe(1);
      expect(roomInset[1], `${spec.id} inset`).toBeLessThanOrEqual(2);

      // And a doorway wider than five leaves under three tiles of wall along
      // the edge two rooms share, which reads as a hole rather than a door.
      expect(corridor, `${spec.id} corridor`).toBeLessThanOrEqual(5);

      // Walls have to be something you cannot simply walk through, or the maze
      // is a field.
      expect(walkable(spec.profile.wall), `${spec.id} wall`).toBe(false);
      expect(walkable(spec.profile.ground), `${spec.id} ground`).toBe(true);
    }
  });
});

describe("in a real world", () => {
  it("X9: every biome gets its whole allowance of copies, on every seed", () => {
    for (const seed of SEEDS) {
      const world = testWorld(seed);

      for (const spec of BIOMES) {
        const copies = copiesOf(spec.tier);

        for (let nth = 1; nth <= copies; nth++) {
          const route = world.routes.get(routeId(spec.id, nth));
          expect(route, `${seed}: ${spec.id} copy ${nth} was never built`).toBeTruthy();
          expect(route!.biome).toBe(spec.id);
          expect(route!.nth).toBe(nth);

          // At least one gap in the wall, or it is somewhere you cannot reach.
          expect(route!.gates.length, `${seed}: ${route!.id} has no gate`).toBeGreaterThan(0);
          expect(route!.gates.length).toBeLessThanOrEqual(4);
          expect(new Set(route!.gates.map((gate) => gate.bearing)).size).toBe(
            route!.gates.length,
          );
        }

        // And no more than its allowance: an extra meadow is a biome that has
        // quietly borrowed somebody else's place in the world.
        expect(
          world.routes.has(routeId(spec.id, copies + 1)),
          `${seed}: ${spec.id} has more copies than its tier allows`,
        ).toBe(false);

        // The copies are numbered outward. This is what every hand-placed
        // thing in the game relies on — "the nearest marsh" has to be the
        // nearest marsh, or a gym is somewhere nobody meant to put it.
        const depths = Array.from(
          { length: copies },
          (_, index) => world.routes.get(routeId(spec.id, index + 1))!.depth,
        );
        expect([...depths].sort((a, b) => a - b), `${seed}: ${spec.id}`).toEqual(depths);
      }

      expect(outdoorRoutes(world).length).toBe(placesWanted());
    }
  });

  it("X10: the grass share a biome asks for is roughly what it gets", () => {
    // The number means something, which was the whole reason it became a share
    // rather than a count of clumps. Measured on ring one, where the maze has
    // carved the most open ground and the target is easiest to hit.
    const world = testWorld("A1");

    for (const spec of BIOMES) {
      const route = world.routes.get(routeId(spec.id, 1))!;
      const open = route.tiles.filter(walkable).length;
      const grass = route.tiles.filter((tile) => tile === TILE.GRASS).length;
      const share = Math.round((grass * 1000) / Math.max(1, open));
      const where = `${spec.id} wanted ${spec.profile.grass}, got ${share}`;

      // Generous either way: growing stops at a guard, and pools and clutter
      // are painted over ground the grass wanted. What would be a bug is a
      // biome asking for nine tenths and getting a tenth.
      expect(share, where).toBeGreaterThan(spec.profile.grass * 0.35);
      expect(share, where).toBeLessThan(spec.profile.grass * 1.8 + 60);
    }
  });

  it("X11: the two water-walled biomes are mostly water, and still walkable", () => {
    // The most interesting thing a biome can be made of. Water is an obstacle
    // answered by Surf and never cleared, so a water-walled route is a handful
    // of connected spits before you have it and open sea afterwards — the same
    // map, twice.
    const world = testWorld("A1");
    const waterWalled = BIOMES.filter((spec) => spec.profile.wall === TILE.WATER);
    expect(waterWalled.length, "nothing walls with water any more").toBe(2);

    for (const spec of waterWalled) {
      const route = world.routes.get(routeId(spec.id, 1))!;
      const water = route.tiles.filter((tile) => tile === TILE.WATER).length;
      // Most of the map, not a pond.
      expect(water / route.tiles.length, spec.id).toBeGreaterThan(0.2);

      // And the carved skeleton is walkable without Surf on every copy of it,
      // or somewhere in the world is shut until the second gym.
      for (let nth = 1; nth <= copiesOf(spec.tier); nth++) {
        const at = world.routes.get(routeId(spec.id, nth))!;
        const open = at.tiles.filter(walkable).length;
        expect(open, `${spec.id} copy ${nth} has nowhere to stand`).toBeGreaterThan(400);
      }
    }
  });
});
