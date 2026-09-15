import { describe, expect, it } from "vitest";
import { baseFormOf, species as speciesById } from "@/engine/dex";
import { applyInput, initialState, type Direction, type GameState } from "@/engine/engine";
import { FOUND_EGG_FROM_RING, FOUND_EGG_ITEM, FOUND_EGG_STEPS, type PickupSpec } from "@/engine/world";
import { creature, testWorld } from "./helpers";

/** One egg lying somewhere in every ring from the second out. */
describe("found eggs", () => {
  const world = testWorld("PKMFEVER1");

  const eggs = (): { routeId: string; drop: PickupSpec }[] =>
    [...world.pickups.entries()].flatMap(([routeId, drops]) =>
      drops.filter((drop) => drop.egg).map((drop) => ({ routeId, drop })),
    );

  it("FE1: exactly one in each ring from ring 2, none nearer, each a base form that can breed", () => {
    const rings = new Set([...world.routes.values()].filter((r) => r.kind === "route" && r.ring >= FOUND_EGG_FROM_RING).map((r) => r.ring));
    const found = eggs();
    expect(found.length).toBe(rings.size);
    const perRing = found.map(({ routeId }) => world.routes.get(routeId)!.ring).sort((a, b) => a - b);
    expect(perRing).toEqual([...rings].sort((a, b) => a - b));

    for (const { drop } of found) {
      expect(drop.item).toBe(FOUND_EGG_ITEM);
      const entry = speciesById(drop.egg!.speciesId);
      expect(baseFormOf(entry.id)).toBe(entry.id);
      expect(entry.eggGroups).not.toContain("Undiscovered");
    }
  });

  it("FE2: the same seed lays the same eggs", () => {
    const again = testWorld("PKMFEVER1");
    const same = [...again.pickups.values()].flat().filter((drop) => drop.egg);
    expect(same).toEqual(eggs().map(({ drop }) => drop));
  });

  /** The player standing next to the egg, and the step that lands on it. */
  const beside = (base: GameState): { state: GameState; dir: Direction } => {
    const { routeId, drop } = eggs()[0];
    const back: Record<Direction, [number, number]> = { n: [0, 1], s: [0, -1], e: [-1, 0], w: [1, 0] };
    for (const dir of ["n", "s", "e", "w"] as const) {
      const state = { ...base, route: routeId, x: drop.x + back[dir][0], y: drop.y + back[dir][1] };
      try {
        const stepped = applyInput(world, state, { t: "move", dir });
        if (stepped.x === drop.x && stepped.y === drop.y) return { state, dir };
      } catch {
        /* walled on that side */
      }
    }
    throw new Error("no way onto the egg");
  };

  it("FE3: walking onto it takes an egg that needs 3000 steps, once", () => {
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const { state, dir } = beside(base);
    const taken = applyInput(world, state, { t: "move", dir });

    expect(taken.eggs).toHaveLength(1);
    expect(taken.eggs[0].steps).toBe(FOUND_EGG_STEPS);
    expect(taken.eggs[0].total).toBe(FOUND_EGG_STEPS);
    expect(taken.eggs[0].creature.speciesId).toBe(eggs()[0].drop.egg!.speciesId);
    expect(taken.eggs[0].creature.level).toBe(1);
    expect(taken.notice).toEqual({ t: "foundEgg", taken: true });
    expect(taken.taken).toContain(eggs()[0].drop.id);
    expect(Object.keys(taken.bag)).not.toContain(FOUND_EGG_ITEM);
  });

  it("FE4: with no room it stays on the ground", () => {
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const full = {
      ...base,
      party: Array.from({ length: 6 }, (_, at) => creature("rattata", { uid: 100 + at })),
    };
    const { state, dir } = beside(full);
    const left = applyInput(world, state, { t: "move", dir });
    expect(left.eggs).toHaveLength(0);
    expect(left.taken).not.toContain(eggs()[0].drop.id);
    expect(left.notice).toEqual({ t: "foundEgg", taken: false });
  });
});
