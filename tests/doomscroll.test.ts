import { describe, expect, it } from "vitest";
import {
  applyInput,
  DOOMSCROLLER,
  DOOMSCROLL_STEPS,
  doomscrollRefusal,
  initialState,
  stateHash,
  type GameState,
} from "@/engine/engine";
import { eggSteps } from "@/engine/breeding";
import { creature, testWorld } from "./helpers";

/**
 * The three buttons on the feed: a hundred steps, five hundred, a thousand,
 * without going anywhere — and every one of them a real step of the world.
 */

const SEED = "SCROLL1";

function reading(extra: Partial<GameState> = {}): { world: ReturnType<typeof testWorld>; state: GameState } {
  const world = testWorld(SEED);
  const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  return { world, state: { ...base, bag: { ...base.bag, [DOOMSCROLLER]: 1 }, ...extra } };
}

describe("scrolling on", () => {
  it("DS1: a hundred, five hundred, a thousand — and only with the thing in the bag", () => {
    expect(DOOMSCROLL_STEPS).toEqual([100, 500, 1000]);

    const { world, state } = reading();
    expect(doomscrollRefusal(state, 100)).toBeNull();
    expect(doomscrollRefusal(state, 250)).toBe("not one of the three");
    expect(doomscrollRefusal({ ...state, bag: {} }, 100)).toBe("you have no feed to scroll");
    expect(doomscrollRefusal({ ...state, talking: "somebody" }, 100)).toBe("somebody is talking to you");

    const after = applyInput(world, state, { t: "doomscroll", steps: 500 });
    expect(after.stepsTaken).toBe(state.stepsTaken + 500);
    expect(after.x).toBe(state.x);
    expect(after.y).toBe(state.y);
    expect(after.route).toBe(state.route);
    expect(after.notice).toEqual({ t: "scrolled", steps: 500 });
    expect(() => applyInput(world, state, { t: "doomscroll", steps: 250 })).toThrow();
  });

  it("DS2: every step counts as a step — eggs walk and the daycare pairs", () => {
    const egg = {
      creature: creature("bulbasaur", { uid: 50, level: 1 }),
      steps: 600,
      total: 600,
    };
    const { world, state } = reading({ eggs: [egg] });

    const after = applyInput(world, state, { t: "doomscroll", steps: 500 });
    expect(after.eggs[0].steps).toBe(100);

    // A pair in the daycare is 500 steps nearer an egg.
    const pair = reading({
      daycare: {
        ...state.daycare,
        slots: [creature("bulbasaur", { uid: 92, gender: "female" }), creature("oddish", { uid: 93, gender: "male" })],
      },
    });
    const bred = applyInput(pair.world, pair.state, { t: "doomscroll", steps: 500 });
    expect(bred.daycare.steps).toBe(Math.min(500, eggSteps(pair.state.daycare.applied)));
  });

  it("DS3: a thousand scrolled is a thousand walked, as far as the save is concerned", () => {
    const { world, state } = reading();
    const scrolled = applyInput(world, state, { t: "doomscroll", steps: 1000 });
    const again = applyInput(world, state, { t: "doomscroll", steps: 1000 });
    expect(stateHash(again)).toBe(stateHash(scrolled));
    // Two sittings stack.
    const twice = applyInput(world, scrolled, { t: "doomscroll", steps: 100 });
    expect(twice.stepsTaken).toBe(state.stepsTaken + 1100);
  });
});
