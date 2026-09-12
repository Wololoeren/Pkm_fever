import { describe, expect, it } from "vitest";
import { resolveTurn, startBattle, TRAINER_RULES } from "@/engine/battle";
import { autoPick, pickByKey, switchTargets } from "@/lib/switching";
import { creature } from "./helpers";

/**
 * Switching from the keyboard: who a number means, and when nobody needs to
 * be asked.
 */
const SEED = "SWITCH1";

describe("switching", () => {
  it("SW1: the eligible are everybody standing who is not already out", () => {
    const ours = [
      creature("rattata", { level: 50, moves: ["tackle"], uid: 1 }),
      creature("pidgey", { level: 50, moves: ["tackle"], uid: 2, hp: 0 }),
      creature("machop", { level: 50, moves: ["tackle"], uid: 3 }),
    ];
    const theirs = creature("geodude", { level: 50, moves: ["splash"], uid: 4 });
    const battle = startBattle(SEED, "trainer:t", ours, [theirs]);
    expect(switchTargets(battle, 0)).toEqual([2]);
    expect(autoPick(battle, 0)).toBe(2);
    expect(pickByKey(battle, 0, "3")).toBe(2);
    expect(pickByKey(battle, 0, "2")).toBeNull();
    expect(pickByKey(battle, 0, "1")).toBeNull();
    expect(pickByKey(battle, 0, "x")).toBeNull();
  });

  it("SW2: two choices is a question, and a trap is no choice at all", () => {
    const ours = [
      creature("rattata", { level: 50, moves: ["tackle"], uid: 1 }),
      creature("pidgey", { level: 50, moves: ["tackle"], uid: 2 }),
      creature("machop", { level: 50, moves: ["tackle"], uid: 3 }),
    ];
    const theirs = creature("gastly", { level: 50, moves: ["meanlook"], uid: 4 });
    const battle = startBattle(SEED, "trainer:t", ours, [theirs]);
    expect(switchTargets(battle, 0)).toEqual([1, 2]);
    expect(autoPick(battle, 0)).toBeNull();

    const trapped = resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], TRAINER_RULES).battle;
    expect(switchTargets(trapped, 0)).toEqual([]);
    expect(autoPick(trapped, 0)).toBeNull();
  });
});
