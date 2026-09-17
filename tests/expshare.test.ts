import { describe, expect, it } from "vitest";
import { resolveTurn, startBattle, WILD_RULES, type BattleState } from "@/engine/battle";
import { applyInput, EXP_SHARE, EXP_SHARE_LEVEL, initialState } from "@/engine/engine";
import { countOf } from "@/engine/items";
import { expYield } from "@/engine/progression";
import type { Individual } from "@/engine/types";
import { narrate } from "@/lib/narrate";
import { creature, testWorld } from "./helpers";

/**
 * The Exp. Share.
 *
 * A held item: whoever carries it and sat the fight out gets half of what the
 * beaten creature was worth, on top of what the fighters split — not a cut of
 * theirs. Handed over once, when anybody of yours first reaches level 40.
 */

/** One turn in which the lead knocks out a weak wild creature. */
function knockout(team: Individual[]): { before: BattleState; after: BattleState; loser: Individual } {
  const loser = creature("caterpie", { level: 20, moves: ["splash"], uid: 99, iv: 0 });
  const before = startBattle("SHARE1", "wild:meadow-1:0", team, [loser]);
  const after = resolveTurn(before, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], WILD_RULES, 0).battle;
  return { before, after, loser };
}

describe("the Exp. Share in battle", () => {
  it("ES1: a holder that did not fight gets half the whole prize, and the fighter's share is unchanged", () => {
    const fighter = creature("machamp", { level: 60, moves: ["karatechop"], uid: 1 });
    const bench = creature("pidgey", { level: 10, moves: ["tackle"], uid: 2 });

    const plain = knockout([fighter, bench]);
    const shared = knockout([fighter, { ...bench, heldItem: EXP_SHARE }]);
    expect(shared.after.outcome).toEqual({ t: "win", side: 0 });

    const gained = (state: BattleState, at: number, from: BattleState) => state.sides[0].team[at].exp - from.sides[0].team[at].exp;
    expect(gained(plain.after, 1, plain.before)).toBe(0);
    expect(gained(shared.after, 1, shared.before)).toBe(Math.floor(expYield(shared.loser) / 2));
    expect(gained(shared.after, 0, shared.before)).toBe(gained(plain.after, 0, plain.before));

    // And the effort that goes with it.
    const evs = (state: BattleState) => Object.values(state.sides[0].team[1].evs).reduce((a, b) => a + b, 0);
    expect(evs(shared.after)).toBeGreaterThan(evs(shared.before));
  });

  it("ES2: a fainted holder is not paid", () => {
    const fighter = creature("machamp", { level: 60, moves: ["karatechop"], uid: 1 });
    const holder = { ...creature("pidgey", { level: 10, uid: 2 }), heldItem: EXP_SHARE, hp: 0 };
    const { before, after } = knockout([fighter, holder]);
    expect(after.sides[0].team[1].exp).toBe(before.sides[0].team[1].exp);
  });

  it("ES2b: nor is one that fainted earlier in the same battle", () => {
    const holder = { ...creature("caterpie", { level: 2, moves: ["tackle"], uid: 2 }), heldItem: EXP_SHARE };
    const fighter = creature("machamp", { level: 60, moves: ["karatechop"], uid: 1 });
    const foe = creature("machamp", { level: 40, moves: ["karatechop"], uid: 99 });
    let battle = startBattle("SHARE1", "wild:meadow-1:0", [holder, fighter], [foe]);
    const start = battle.sides[0].team[0].exp;
    for (let turn = 0; turn < 10 && !battle.outcome; turn++) {
      const down = battle.sides[0].team[battle.sides[0].active].hp <= 0;
      const mine = down ? { t: "switch" as const, partyIndex: 1 } : { t: "fight" as const, moveIndex: 0 };
      battle = resolveTurn(battle, [mine, { t: "fight", moveIndex: 0 }], WILD_RULES, 0).battle;
    }
    expect(battle.outcome).toEqual({ t: "win", side: 0 });
    expect(battle.sides[0].team[0].hp).toBe(0);
    expect(battle.sides[0].team[0].exp).toBe(start);
    expect(battle.sides[0].team[1].exp).toBeGreaterThan(fighter.exp);
  });
});

describe("getting the Exp. Share", () => {
  const world = testWorld("SHARE1");
  const started = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

  function step(state: typeof started) {
    for (const dir of ["n", "s", "e", "w"] as const) {
      try {
        return applyInput(world, state, { t: "move", dir });
      } catch {
        /* walled */
      }
    }
    throw new Error("nowhere to walk");
  }

  it("ES3: nothing below level 40; given once when one of yours reaches it", () => {
    const below = { ...started, party: [{ ...started.party[0], level: EXP_SHARE_LEVEL - 1 }] };
    const walked = step(below);
    expect(walked.expShareGiven).toBe(false);
    expect(countOf(walked.bag, EXP_SHARE)).toBe(0);

    const grown = { ...started, party: [{ ...started.party[0], level: EXP_SHARE_LEVEL }] };
    const given = step(grown);
    expect(given.expShareGiven).toBe(true);
    expect(countOf(given.bag, EXP_SHARE)).toBe(1);
    expect(given.notice).toMatchObject({ t: "expShare" });

    // Once: gone from the bag, it does not come back.
    const again = step({ ...given, bag: { ...given.bag, [EXP_SHARE]: 0 }, notice: null });
    expect(countOf(again.bag, EXP_SHARE)).toBe(0);
  });

  it("ES4: it waits rather than writing over something else being said", () => {
    const grown = { ...started, party: [{ ...started.party[0], level: 50 }], bag: { ...started.bag, potion: 1 } };
    const hurt = { ...grown, party: [{ ...grown.party[0], hp: 1 }] };
    const used = applyInput(world, hurt, { t: "useItem", item: "potion", index: 0 });
    expect(used.notice?.t).toBe("used");
    expect(used.expShareGiven).toBe(false);
    expect(step({ ...used, notice: null }).expShareGiven).toBe(true);
  });
});

describe("the log says who", () => {
  it("ES5: every experience line names the creature that earned it, the bench holder included", () => {
    const fighter = creature("machamp", { level: 60, moves: ["karatechop"], uid: 1 });
    const bench = { ...creature("pidgey", { level: 10, moves: ["tackle"], uid: 2 }), heldItem: EXP_SHARE };
    const { after } = knockout([fighter, bench]);
    const names: Record<number, string> = { 1: "Machamp", 2: "Pidgey" };
    const lines = narrate(after.events, () => "somebody", (uid) => names[uid] ?? null);
    expect(lines.some((line) => /^Machamp gained \d+ EXP\.$/.test(line))).toBe(true);
    expect(lines.some((line) => /^Pidgey gained \d+ EXP\.$/.test(line))).toBe(true);
    expect(lines.some((line) => /^Gained/.test(line))).toBe(false);
  });
});
