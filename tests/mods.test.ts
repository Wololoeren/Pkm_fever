import { describe, expect, it } from "vitest";
import { startBattle, type BattleState } from "@/engine/battle";
import { battleMods, describeMod, factorText, sideMods, stageText } from "@/lib/mods";
import { creature } from "./helpers";

/**
 * The Mod column on the stat sheet.
 *
 * The sheet shows what a creature is; this column shows what the battle is
 * doing to it, and only then. The invariant worth guarding is the *absence*:
 * the column must not exist outside a battle, for a creature that is not out,
 * or for the one out when nothing has touched it — because a column that is
 * always there and usually empty is a column nobody reads.
 */

function battle(): BattleState {
  const ours = [
    creature("rattata", { level: 50, moves: ["tackle"], uid: 1 }),
    creature("pidgey", { level: 50, moves: ["tackle"], uid: 2 }),
  ];
  const theirs = creature("machop", { level: 50, moves: ["tackle"], uid: 3 });
  return startBattle("MODS", "wild:test:0", ours, [theirs]);
}

describe("the mod column", () => {
  it("MD1: nothing outside a battle, and nothing for a creature that is not out", () => {
    expect(battleMods({ battle: null, phase: "field" }, 0)).toBeNull();

    const live = battle();
    live.sides[0].stages.atk = 2;
    // The one in reserve has no slot, so nothing is happening to it.
    expect(battleMods({ battle: live, phase: "battle" }, 1)).toBeNull();
    // And a decided battle is not a battle any more.
    expect(battleMods({ battle: live, phase: "battleEnd" }, 0)).toBeNull();
  });

  it("MD2: nothing for the one out until something has touched it", () => {
    expect(battleMods({ battle: battle(), phase: "battle" }, 0)).toBeNull();
  });

  it("MD3: a stage, a split number and a paralysis each show, on their own stat only", () => {
    const live = battle();
    live.sides[0].stages.atk = 2;
    live.sides[0].stages.def = -1;
    live.sides[0].volatiles = { stats: { spa: 77 } };
    live.sides[0].team[0] = { ...live.sides[0].team[0], status: "par" };

    const mods = battleMods({ battle: live, phase: "battle" }, 0);
    expect(mods).not.toBeNull();
    expect(Object.keys(mods!).sort()).toEqual(["atk", "def", "spa", "spe"]);
    expect(mods!.atk).toEqual({ stage: 2, factor: [4, 2] });
    expect(mods!.def).toEqual({ stage: -1, factor: [2, 3] });
    expect(mods!.spa).toEqual({ stage: 0, factor: [2, 2], override: 77 });
    expect(mods!.spe).toEqual({ stage: 0, factor: [2, 2], halved: true });
    // HP has no ladder and never appears.
    expect(mods!.hp).toBeUndefined();
  });

  it("MD5: the hover card reads the same facts off the side, for either creature", () => {
    // The battle screen's card is where the column was first missed: it
    // shows the foe as well as yours, so it reads the side rather than the
    // party index.
    const live = battle();
    expect(sideMods(live.sides[1])).toBeNull();
    live.sides[1].stages.def = 1;
    live.sides[1].aim = { accuracy: 0, evasion: 2 };
    const theirs = sideMods(live.sides[1]);
    expect(theirs).toEqual({ def: { stage: 1, factor: [3, 2] } });
    expect(describeMod(theirs!.def!)).toEqual({ text: "+1", tone: "up", title: "raised 1 stage (×1.5)" });
    expect(describeMod({ stage: -2, factor: [2, 4], halved: true })).toMatchObject({ text: "−2 ½", tone: "down" });
  });

  it("MD4: the text is the sheet's own sign convention, and the multiplier is exact", () => {
    expect(stageText(0)).toBe("");
    expect(stageText(2)).toBe("+2");
    expect(stageText(-1)).toBe("−1");
    expect(factorText([4, 2])).toBe("×2");
    expect(factorText([2, 3])).toBe("×0.67");
    expect(factorText([2, 2])).toBe("×1");
  });
});
