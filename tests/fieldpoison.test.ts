import { describe, expect, it } from "vitest";
import {
  applyInput,
  initialState,
  POISON_STEP_EVERY,
  type GameState,
} from "@/engine/engine";
import { creature, testWorld } from "./helpers";

/**
 * Poison out of battle: every fifth step each poisoned creature in the party
 * loses 1 HP, or shakes the poison off (2%). It never faints from walking.
 */
describe("poison on the map", () => {
  const world = testWorld("PKMFEVER1");
  const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

  const walk = (from: GameState, count: number, offset = 0): GameState => {
    let state = from;
    for (let i = 0; i < count; i++) {
      state = applyInput(world, state, { t: "move", dir: (i + offset) % 2 === 0 ? "n" : "s" });
    }
    return state;
  };

  const poisoned = (hp: number, uid = 500): GameState => ({
    ...base,
    party: [{ ...creature("rattata", { uid, level: 30 }), hp, status: "psn" }],
  });

  it("FP1: nothing for four steps, then 1 HP on the fifth, and the flash tick is set", () => {
    const start = poisoned(50);
    const four = walk(start, POISON_STEP_EVERY - 1);
    expect(four.party[0].hp).toBe(50);
    expect(four.poisonedAt).toBeNull();

    const five = walk(four, 1, POISON_STEP_EVERY - 1);
    // Either the 2% cure or the 1 HP; with 50 HP there is nothing else.
    if (five.party[0].status === "psn") {
      expect(five.party[0].hp).toBe(49);
      expect(five.poisonedAt).toBe(five.tick);
    } else {
      expect(five.party[0].hp).toBe(50);
    }
    expect(five.poisonWalk).toBe(0);
  });

  it("FP2: over many ticks it cures about 2% of the time and hurts the rest", () => {
    let cured = 0;
    let hurt = 0;
    for (let uid = 1000; uid < 1400; uid++) {
      const after = walk(poisoned(80, uid), POISON_STEP_EVERY);
      if (after.party[0].status === null) cured++;
      else if (after.party[0].hp === 79) hurt++;
    }
    expect(cured + hurt).toBe(400);
    expect(cured).toBeGreaterThan(0);
    expect(cured).toBeLessThan(25);
  });

  it("FP3: it never faints from walking; at 1 HP the poison wears off", () => {
    const after = walk(poisoned(2), POISON_STEP_EVERY * 4);
    expect(after.party[0].hp).toBeGreaterThanOrEqual(1);
    expect(after.party[0].status).toBeNull();
  });

  it("FP4: healthy parties take no ticks, and nothing counts up", () => {
    const after = walk(base, POISON_STEP_EVERY * 2);
    expect(after.party[0].hp).toBe(base.party[0].hp);
    expect(after.poisonWalk).toBe(0);
    expect(after.poisonedAt).toBeNull();
  });
});
