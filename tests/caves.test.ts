import { describe, expect, it } from "vitest";
import { ALL_SPECIES } from "@/engine/dex";
import { CAVE_BIOME, CAVE_COUNT, CAVE_FLOORS, caveFloorId, caveFloorOf } from "@/engine/caves";
import { applyInput, canSee, initialState, type GameState } from "@/engine/engine";
import { encounterTable, wildAt, type Route, type World } from "@/engine/world";
import { hidesEncounters, walkable } from "@/engine/terrain";
import { creature, testWorld } from "./helpers";

/**
 * Three caves a world, each a staircase down through floors that get worse,
 * and out onto the routes the lattice cannot reach from where you went in.
 */

const SEEDS = ["A1", "B2", "C3", "CAVE4"];

const floorsOf = (world: World): Route[] => [...world.routes.values()].filter((route) => route.kind === "cave");

/** Every tile you can reach on foot from the way in. */
function reached(route: Route): Set<string> {
  const seen = new Set<string>([`${route.entry.x},${route.entry.y}`]);
  const queue = [route.entry];
  while (queue.length) {
    const here = queue.shift()!;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const x = here.x + dx;
      const y = here.y + dy;
      if (x < 0 || y < 0 || x >= route.width || y >= route.height) continue;
      if (seen.has(`${x},${y}`) || !walkable(route.tiles[y * route.width + x])) continue;
      seen.add(`${x},${y}`);
      queue.push({ x, y });
    }
  }
  return seen;
}

describe("three caves a world", () => {
  it("CV1: three of them, three floors each, every floor a cave", () => {
    for (const seed of SEEDS) {
      const world = testWorld(seed);
      expect(world.caves.length, seed).toBe(CAVE_COUNT);
      expect(floorsOf(world).length, seed).toBe(CAVE_COUNT * CAVE_FLOORS);

      for (const cave of world.caves) {
        expect(cave.floors).toEqual(
          Array.from({ length: CAVE_FLOORS }, (_, at) => caveFloorId(cave.entry, at + 1)),
        );
        for (const id of cave.floors) {
          const floor = world.routes.get(id)!;
          expect(floor.kind).toBe("cave");
          expect(floor.biome).toBe(CAVE_BIOME);
          expect(floor.parent).toBe(cave.entry);
          expect(floor.label).toMatch(/Cave B\d+F \[\d+-\d+\]$/);
        }
      }
    }
  });

  it("CV2: each floor is a ring deeper, and what lives there is a cave's, not the route's", () => {
    const world = testWorld("A1");
    for (const cave of world.caves) {
      const above = world.routes.get(cave.entry)!;
      for (const id of cave.floors) {
        const floor = world.routes.get(id)!;
        expect(floor.ring, id).toBe(above.ring + caveFloorOf(id));
      }

      // Rock, Ground and Dark — and deeper is stronger, which is the whole
      // reason to go down rather than round.
      const table = encounterTable(ALL_SPECIES, CAVE_BIOME, world.routes.get(cave.floors[0])!.ring, world.config.rings);
      expect(table.length).toBeGreaterThan(0);
      for (const row of table.slice(0, 20)) {
        const kind = ALL_SPECIES.find((one) => one.id === row.speciesId)!;
        expect(kind.types.some((type) => ["rock", "ground", "dark"].includes(type)), row.speciesId).toBe(true);
      }

      const top = wildAt(world, ALL_SPECIES, cave.floors[0], 0, 1);
      const bottom = wildAt(world, ALL_SPECIES, cave.floors[CAVE_FLOORS - 1], 0, 2);
      expect(bottom.level).toBeGreaterThan(top.level);
    }
  });

  it("CV3: a corridor with chambers, not a maze — every floor is walkable end to end and has grass", () => {
    for (const seed of SEEDS) {
      const world = testWorld(seed);
      for (const floor of floorsOf(world)) {
        const open = reached(floor);
        const grass = floor.tiles.filter((tile) => hidesEncounters(tile)).length;
        expect(grass, `${floor.id} has nothing growing in it`).toBeGreaterThan(0);

        // Every staircase is reachable from the way in, or a floor is a floor
        // you can be stranded on.
        for (const door of floor.doors) {
          expect(open.has(`${door.x},${door.y}`), `${floor.id} cannot reach its door to ${door.to}`).toBe(true);
        }
      }
    }
  });

  it("CV4: the stairs join up in both directions, and the bottom comes out somewhere diagonal", () => {
    for (const seed of SEEDS) {
      const world = testWorld(seed);
      for (const cave of world.caves) {
        const above = world.routes.get(cave.entry)!;

        // In from the mouth, down to the bottom, and every step of it lands
        // somewhere you could stand.
        let here: Route = above;
        for (const id of cave.floors) {
          const down = here.doors.find((door) => door.to === id);
          expect(down, `${here.id} has no way to ${id}`).toBeDefined();
          const floor = world.routes.get(id)!;
          expect(walkable(floor.tiles[down!.at.y * floor.width + down!.at.x])).toBe(true);
          // And back the way you came.
          expect(floor.doors.some((door) => door.to === here.id), `${id} has no way back to ${here.id}`).toBe(true);
          here = floor;
        }

        // The ways out: routes that are corner to corner with the one the
        // mouth is on, which nothing else in the world joins.
        expect(cave.exits.length).toBeGreaterThan(0);
        for (const id of cave.exits) {
          const out = world.routes.get(id)!;
          expect(Math.abs(out.cell.x - above.cell.x), `${id} is not diagonal`).toBe(1);
          expect(Math.abs(out.cell.y - above.cell.y), `${id} is not diagonal`).toBe(1);
          expect(above.borders.some((border) => border.to === id), `${id} is already next door`).toBe(false);
          expect(here.doors.some((door) => door.to === id), `the bottom does not come out on ${id}`).toBe(true);
          expect(out.doors.some((door) => door.to === here.id), `${id} has no way back down`).toBe(true);
        }
      }
    }
  });

  it("CV5: underground is dark without a Flash, and no coach and no bird go there", () => {
    const world = testWorld("A1");
    const floor = world.routes.get(world.caves[0].floors[0])!;
    const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    expect(canSee(start, floor)).toBe(false);
    expect(canSee({ ...start, bag: { ...start.bag, "hm-flash": 1 } }, floor)).toBe(true);

    const flying: GameState = {
      ...start,
      party: [creature("pidgeot", { uid: 1, level: 40 })],
      bag: { ...start.bag, "hm-fly": 1 },
      visited: [...start.visited, floor.id],
    };
    expect(() => applyInput(world, flying, { t: "fly", route: floor.id })).toThrow(/underground/);
  });
});
