import { describe, expect, it } from "vitest";
import { activeOf, isFainted } from "@/engine/battle";
import { ALL_SPECIES } from "@/engine/dex";
import { applyInput, initialState, type GameState } from "@/engine/engine";
import { encounterTable, levelForRing, trainerAt, TILE_PATH, wildAt } from "@/engine/world";
import { creature, testWorld } from "./helpers";

/**
 * Trainers: the reason to come back to a route rather than a wall across it.
 *
 * They stand on the path, so they are visible and avoidable, and their teams
 * come from the same table the route's grass does — a couple of levels above
 * it. Like everything else in the world they are derived from the seed, which
 * is what keeps two players on one seed in the same game.
 */

const SEEDS = ["A1", "B2", "C3", "D4", "E5"];

describe("where they stand", () => {
  it("T1: every route outside the hub has somebody on it, and the hub has nobody", () => {
    for (const seed of SEEDS) {
      const world = testWorld(seed);
      expect(world.trainers.has("hub-0")).toBe(false);

      for (const route of world.routes.values()) {
        if (route.ring < 1) continue;
        const here = world.trainers.get(route.id) ?? [];
        expect(here.length).toBeGreaterThanOrEqual(1);
        expect(here.length).toBeLessThanOrEqual(3);
      }
    }
  });

  it("T2: they stand on the path, never in grass or inside a wall", () => {
    for (const seed of SEEDS) {
      const world = testWorld(seed);
      for (const [routeId, here] of world.trainers) {
        const route = world.routes.get(routeId)!;
        for (const trainer of here) {
          expect(route.tiles[trainer.y * route.width + trainer.x]).toBe(TILE_PATH);
        }
      }
    }
  });

  it("T3: nobody blocks the tile you arrive on", () => {
    // Landing on a route already inside a battle reads as a bug, not an ambush.
    for (const seed of SEEDS) {
      const world = testWorld(seed);
      for (const [routeId, here] of world.trainers) {
        const route = world.routes.get(routeId)!;
        for (const trainer of here) {
          expect([trainer.x, trainer.y]).not.toEqual([route.entry.x, route.entry.y]);
          expect(trainer.x).not.toBe(route.width - 2);
        }
      }
    }
  });

  it("T4: the same seed puts the same people in the same places", () => {
    const one = testWorld("A1");
    const two = testWorld("A1");
    expect([...two.trainers.entries()]).toEqual([...one.trainers.entries()]);
    expect([...testWorld("B2").trainers.entries()]).not.toEqual([...one.trainers.entries()]);
  });
});

describe("what they bring", () => {
  it("T5: teams come from the route's own table", () => {
    const world = testWorld("A1");
    for (const [routeId, here] of world.trainers) {
      const route = world.routes.get(routeId)!;
      const allowed = new Set(
        encounterTable(ALL_SPECIES, route.biome, route.ring, world.config.rings).map((row) => row.speciesId),
      );
      for (const trainer of here) {
        expect(trainer.team.length).toBeGreaterThanOrEqual(1);
        expect(trainer.team.length).toBeLessThanOrEqual(3);
        for (const member of trainer.team) expect(allowed.has(member.speciesId)).toBe(true);
      }
    }
  });

  it("T6: they are a step above the grass around them", () => {
    const world = testWorld("A1");
    for (const [routeId, here] of world.trainers) {
      const route = world.routes.get(routeId)!;
      const wildLevel = wildAt(world, ALL_SPECIES, routeId, 0, 1).level;
      for (const trainer of here) {
        for (const member of trainer.team) {
          expect(member.level).toBeGreaterThanOrEqual(wildLevel - 2);
          expect(member.level).toBeLessThanOrEqual(levelForRing(route.ring) + 3);
        }
      }
    }
  });
});

/**
 * Puts the player on a path tile beside a trainer, and says which way to step.
 *
 * Not simply "one tile west": the routes are a cross, so a trainer standing on
 * the vertical corridor has grass either side of them and only north and south
 * are walkable. The player is placed rather than pathfound — this is about
 * what happens on arrival, and walking is covered elsewhere.
 */
function approach(
  world: ReturnType<typeof testWorld>,
  state: GameState,
  trainer: { x: number; y: number },
): { state: GameState; dir: "n" | "s" | "e" | "w" } {
  const route = world.routes.get(state.route)!;
  const sides = [
    { x: trainer.x - 1, y: trainer.y, dir: "e" as const },
    { x: trainer.x + 1, y: trainer.y, dir: "w" as const },
    { x: trainer.x, y: trainer.y - 1, dir: "s" as const },
    { x: trainer.x, y: trainer.y + 1, dir: "n" as const },
  ];

  const spot = sides.find(
    (side) =>
      side.x > 0 &&
      side.y > 0 &&
      side.x < route.width - 1 &&
      side.y < route.height - 1 &&
      route.tiles[side.y * route.width + side.x] === TILE_PATH &&
      !trainerAt(world, route.id, side.x, side.y),
  );
  expect(spot).toBeDefined();

  return { state: { ...state, x: spot!.x, y: spot!.y }, dir: spot!.dir };
}

describe("fighting them", () => {
  function reachRoute(seed: string) {
    const world = testWorld(seed);
    let state = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    // Out of the hub, eastward, into ring 1.
    for (let i = 0; i < 14 && state.route === "hub-0"; i++) {
      state = applyInput(world, state, { t: "move", dir: "e" });
    }
    return { world, state };
  }

  it("T7: walking into one starts a battle with no catching and no running", () => {
    const { world, state } = reachRoute("A1");
    const here = world.trainers.get(state.route)!;
    const trainer = here[0];

    // Stand next to them, then step on.
    const { state: beside, dir } = approach(world, state, trainer);
    const fighting = applyInput(world, beside, { t: "move", dir });

    expect(fighting.phase).toBe("battle");
    expect(fighting.battle!.tag).toBe(`trainer:${trainer.id}`);
    expect(fighting.battle!.sides[1].team.length).toBe(trainer.team.length);

    // A trainer is not something you catch or walk away from.
    expect(() => applyInput(world, fighting, { t: "ball" })).toThrow();
    expect(() => applyInput(world, fighting, { t: "flee" })).toThrow();
  });

  it("T8: beating one is recorded, pays out, and does not happen twice", () => {
    const { world, state } = reachRoute("A1");
    const trainer = world.trainers.get(state.route)![0];

    // A team far beyond anything on ring 1, so the fight actually finishes.
    const strong = {
      ...state,
      party: [creature("machamp", { uid: 500, level: 80, moves: ["karatechop"] })],
    };
    const { state: beside, dir } = approach(world, strong, trainer);

    let current = applyInput(world, beside, { t: "move", dir });
    const ballsBefore = current.balls;

    for (let i = 0; i < 40 && current.phase === "battle"; i++) {
      const action = current.battle!.awaitingSwitch[0]
        ? ({ t: "switch", partyIndex: 0 } as const)
        : ({ t: "fight", moveIndex: 0 } as const);
      current = applyInput(world, current, action);
    }

    expect(current.phase).toBe("battleEnd");
    expect(current.notice).toEqual({ t: "beatTrainer", name: trainer.name, balls: 5 });
    expect(current.beaten).toContain(trainer.id);
    expect(current.balls).toBe(ballsBefore + 5);

    // Beating them also fed the winner, which a duel would not have.
    expect(current.battle!.events.some((event) => event.t === "exp")).toBe(true);

    // Walking over them again is just walking.
    const cleared = { ...current, phase: "field" as const, battle: null };
    const { state: again, dir: backDir } = approach(world, cleared, trainer);
    expect(applyInput(world, again, { t: "move", dir: backDir }).phase).toBe("field");
  });

  it("T9: nobody challenges you with a fainted party", () => {
    const { world, state } = reachRoute("A1");
    const trainer = world.trainers.get(state.route)![0];

    const wiped = {
      ...state,
      party: state.party.map((member) => ({ ...member, hp: 0 })),
    };
    expect(wiped.party.every(isFainted)).toBe(true);

    const { state: beside, dir } = approach(world, wiped, trainer);
    const stepped = applyInput(world, beside, { t: "move", dir });
    expect(stepped.phase).toBe("field");
  });

  it("T10: their team is materialised whole, at full health", () => {
    const { world, state } = reachRoute("A1");
    const trainer = world.trainers.get(state.route)![0];
    const { state: beside, dir } = approach(world, state, trainer);
    const fighting = applyInput(world, beside, { t: "move", dir });

    const team = fighting.battle!.sides[1].team;
    expect(team.every((member) => member.hp > 0)).toBe(true);
    expect(team.every((member) => member.moves.length > 0)).toBe(true);
    // Distinct identities, so nothing downstream confuses two of them.
    expect(new Set(team.map((member) => member.uid)).size).toBe(team.length);
    expect(activeOf(fighting.battle!, 1).speciesId).toBe(trainer.team[0].speciesId);
  });
});
