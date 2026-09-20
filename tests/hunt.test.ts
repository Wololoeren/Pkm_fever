import { describe, expect, it } from "vitest";
import { applyInput, huntOffers, huntRefusal, initialState, quarryAt, type GameState } from "@/engine/engine";
import { huntLeft, HUNT_IV_MIN, HUNT_OFFERS, HUNT_ROTATION, HUNT_STEPS } from "@/engine/hunt";
import { IV_MAX } from "@/engine/stats";
import { STAT_IDS } from "@/engine/types";
import { creature, testWorld } from "./helpers";

/**
 * The hunter: five on a board, one at a time, eight hundred steps to find it.
 */

const SEED = "HUNT1";

function facing(extra: Partial<GameState> = {}): { world: ReturnType<typeof testWorld>; state: GameState } {
  const world = testWorld(SEED);
  const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  const [routeId, here] = [...world.npcs].find(([, people]) => people.some((one) => one.id === "hunter"))!;
  const him = here.find((one) => one.id === "hunter")!;
  return { world, state: { ...start, route: routeId, x: him.x, y: him.y + 1, talking: "hunter", ...extra } };
}

describe("the hunter", () => {
  it("HU1: five on the board, bred better than the grass, and the board turns over", () => {
    const { world, state } = facing();
    const board = huntOffers(world, state);
    expect(board).toHaveLength(HUNT_OFFERS);

    for (const offer of board) {
      for (const stat of STAT_IDS) {
        expect(offer.ivs[stat], `${offer.speciesId} ${stat}`).toBeGreaterThanOrEqual(HUNT_IV_MIN);
        expect(offer.ivs[stat]).toBeLessThanOrEqual(IV_MAX);
      }
      expect(offer.abilities.length).toBeGreaterThanOrEqual(1);
      expect(world.routes.get(offer.routeId)?.kind).toBe("route");
    }

    // The same board until the rotation, and a different one after it.
    expect(huntOffers(world, { ...state, stepsTaken: HUNT_ROTATION - 1 })).toEqual(board);
    expect(huntOffers(world, { ...state, stepsTaken: HUNT_ROTATION })).not.toEqual(board);
  });

  it("HU2: one at a time, and it stands somewhere on the route he named", () => {
    const { world, state } = facing();
    const taken = applyInput(world, state, { t: "huntTake", index: 2 });
    const offer = huntOffers(world, state)[2];

    expect(taken.hunt?.offer.speciesId).toBe(offer.speciesId);
    expect(taken.notice).toMatchObject({ t: "huntOn", speciesId: offer.speciesId, routeId: offer.routeId });
    expect(huntRefusal(world, taken, 0)).toBe("you are already after something");
    expect(() => applyInput(world, taken, { t: "huntTake", index: 0 })).toThrow();

    // It is out there: a tile on the route he named, and the same tile until
    // something moves it.
    const spot = quarryAt(world, taken);
    expect(spot, "the quarry is nowhere").not.toBeNull();
    expect(quarryAt(world, taken)).toEqual(spot);

    // And it can be given up on.
    const dropped = applyInput(world, taken, { t: "huntDrop" });
    expect(dropped.hunt).toBeNull();
    expect(quarryAt(world, dropped)).toBeNull();
  });

  it("HU3: eight hundred steps and it has moved on", () => {
    const { world, state } = facing();
    const taken = applyInput(world, state, { t: "huntTake", index: 0 });
    expect(huntLeft(taken.hunt, taken.stepsTaken)).toBe(HUNT_STEPS);

    // The clock runs wherever the steps are taken — here, a sitting with the
    // feed rather than a walk.
    const scrolled = applyInput(
      world,
      { ...taken, talking: null, bag: { ...taken.bag, doomscroller: 1 } },
      { t: "doomscroll", steps: 500 },
    );
    expect(scrolled.hunt).not.toBeNull();
    expect(huntLeft(scrolled.hunt, scrolled.stepsTaken)).toBe(HUNT_STEPS - 500);

    const gone = applyInput(
      world,
      { ...scrolled, bag: { ...scrolled.bag, doomscroller: 1 } },
      { t: "doomscroll", steps: 500 },
    );
    expect(gone.hunt).toBeNull();
    expect(quarryAt(world, gone)).toBeNull();
    // The sitting with the feed has its own notice, so the hunt's only shows
    // when the steps that ran it out were ordinary ones.
    expect(gone.notice).toMatchObject({ t: "scrolled" });
  });

  it("HU4: walking onto it is a wild battle against exactly what was advertised", () => {
    const { world, state } = facing({ party: [creature("machamp", { uid: 1, level: 80, moves: ["tackle"] })] });
    const taken = applyInput(world, state, { t: "huntTake", index: 1 });
    const hunt = taken.hunt!;
    const route = world.routes.get(hunt.offer.routeId)!;

    // Standing beside it, on its route, and stepping onto its tile.
    const spot = quarryAt(world, taken)!;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const from: GameState = {
        ...taken,
        talking: null,
        route: route.id,
        x: spot.x + dx,
        y: spot.y + dy,
      };
      let met: GameState;
      try {
        met = applyInput(world, from, { t: "move", dir: dx === 0 ? (dy === 1 ? "n" : "s") : dx === 1 ? "w" : "e" });
      } catch {
        continue;
      }
      if (met.phase !== "battle") continue;

      const foe = met.battle!.sides[1].team[0];
      expect(foe.speciesId).toBe(hunt.offer.speciesId);
      expect(foe.level).toBe(hunt.offer.level);
      expect(foe.ivs).toEqual(hunt.offer.ivs);
      // Wild, so it can be caught — which is the whole point of the hunt.
      expect(met.battle!.tag).toContain("wild:");
      // And the hunt is over the moment it is in front of you.
      expect(met.hunt).toBeNull();
      return;
    }
    throw new Error("never met the quarry");
  });
});
