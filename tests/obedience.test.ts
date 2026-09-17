import { describe, expect, it } from "vitest";
import { DUEL_RULES, resolveTurn, startBattle, WILD_RULES, type BattleEvent, type BattleRules } from "@/engine/battle";
import { disobeys, initialState, obedienceLevel } from "@/engine/engine";
import { creature, testWorld } from "./helpers";

/**
 * Traded creatures and the level they listen to.
 *
 * Below 20 + 10·badges a traded creature obeys. At or above it, a fight order
 * is ignored: it uses any legal move of its own choosing, each equally likely,
 * or loafs — and loafing is twice as likely as any one move.
 */

const MOVES = ["tackle", "growl", "tailwhip", "quickattack"];

/** One turn of a fresh battle, and what happened in it. */
function oneTurn(tag: number, fighter: ReturnType<typeof creature>, rules: BattleRules): BattleEvent[] {
  const foe = creature("magikarp", { uid: 99, level: 5, moves: ["splash"] });
  const battle = startBattle("OBEY1", `wild:meadow-1:${tag}`, [fighter], [foe]);
  return resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], rules, 0).battle.events;
}

const obey = (level: number): BattleRules => ({ ...WILD_RULES, obeysBelow: level });

describe("obedience", () => {
  it("OB1: the line is 20, and ten more for every badge", () => {
    expect(obedienceLevel(0)).toBe(20);
    expect(obedienceLevel(3)).toBe(50);
    expect(obedienceLevel(8)).toBe(100);
  });

  it("OB2: a traded creature below the line always does as it is told", () => {
    const traded = { ...creature("rattata", { uid: 1, level: 19, moves: MOVES }), traded: true };
    for (let tag = 0; tag < 100; tag++) {
      const events = oneTurn(tag, traded, obey(20));
      expect(events.some((event) => event.t === "disobeyed")).toBe(false);
    }
  });

  it("OB3: nor does one you raised yourself, however strong — or anybody in a battle with no line", () => {
    const own = creature("rattata", { uid: 1, level: 80, moves: MOVES });
    const traded = { ...own, traded: true };
    for (let tag = 0; tag < 60; tag++) {
      expect(oneTurn(tag, own, obey(20)).some((event) => event.t === "disobeyed")).toBe(false);
      expect(oneTurn(tag, traded, DUEL_RULES).some((event) => event.t === "disobeyed")).toBe(false);
    }
  });

  it("OB4: at the line it ignores orders — its own move, or twice as often nothing at all", () => {
    const traded = { ...creature("rattata", { uid: 1, level: 20, moves: MOVES }), traded: true };
    const N = 3000;
    let loafed = 0;
    const picked = new Map<string, number>();
    for (let tag = 0; tag < N; tag++) {
      const events = oneTurn(tag, traded, obey(20));
      const refusal = events.find((event) => event.t === "disobeyed");
      expect(refusal, `turn ${tag} obeyed`).toBeDefined();
      if (refusal?.t !== "disobeyed") continue;
      if (refusal.moveId === null) {
        loafed++;
        // Loafing is a turn with no move of its own in it.
        expect(events.some((event) => event.t === "use" && event.side === 0)).toBe(false);
      } else {
        picked.set(refusal.moveId, (picked.get(refusal.moveId) ?? 0) + 1);
        expect(MOVES).toContain(refusal.moveId);
        // And the move it chose is the one it actually used.
        expect(events.some((event) => event.t === "use" && event.side === 0 && event.moveId === refusal.moveId)).toBe(true);
      }
    }

    // Four moves and a double share of nothing: nothing is 2/6, each move 1/6.
    expect(loafed / N).toBeGreaterThan(2 / 6 - 0.04);
    expect(loafed / N).toBeLessThan(2 / 6 + 0.04);
    for (const moveId of MOVES) {
      expect((picked.get(moveId) ?? 0) / N, moveId).toBeGreaterThan(1 / 6 - 0.04);
      expect((picked.get(moveId) ?? 0) / N, moveId).toBeLessThan(1 / 6 + 0.04);
    }
  });

  it("OB5: badges are what move the line, and the stat screen asks the same question", () => {
    const world = testWorld("OBEY1");
    const state = initialState(world);
    const traded = { ...creature("rattata", { uid: 1, level: 25, moves: MOVES }), traded: true };
    expect(disobeys(state, traded)).toBe(true);
    expect(disobeys({ ...state, badges: ["gym-bug"] }, traded)).toBe(false);
    expect(disobeys(state, { ...traded, traded: false })).toBe(false);
  });
});
