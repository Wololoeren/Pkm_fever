import { describe, expect, it } from "vitest";
import {
  aiAction,
  resolveTurn,
  startBattle,
  WILD_RULES,
  type BattleEvent,
  type BattleState,
} from "@/engine/battle";
import { ALL_MOVES } from "@/engine/dex";
import { creature } from "./helpers";

/**
 * What a move costs the creature that used it.
 *
 * Seventeen moves carry it and sixteen are a drawback: Close Combat's guard
 * dropping, Overheat burning out its own Sp. Atk, Superpower spending the very
 * Attack it just hit with. All seventeen are data upstream and all seventeen
 * were being dropped on the way across, so **every one of them was strictly
 * better in this game than it is meant to be** — Close Combat at 120 power
 * with no downside at all is not a trade, it is the best physical move in the
 * game. 187 of 1134 species learn at least one, and five of the seventeen are
 * machines, so anything that can be taught can have one.
 *
 * The interesting half is not "does the stage move" but the three places the
 * obvious implementation gets it wrong. Folding these into `secondary` would
 * have looked right and been wrong twice — a secondary is gated on the target
 * still standing, and on the target's shield, and neither has anything to do
 * with what a move costs its user. And the drop has to be *self*-inflicted, or
 * a Clear Body across the field cancels your own downside.
 */

const TAG = "wild:cost:0";

/** One turn, and everything it produced. */
function swing(
  moveId: string,
  seed: string,
  options: {
    mine?: string;
    theirs?: string;
    level?: number;
    theirLevel?: number;
    /** On the user. What the cost has to get past. */
    mineAbilities?: string[];
    theirAbilities?: string[];
    theirScreens?: BattleState["sides"][0]["screens"];
  } = {},
): readonly BattleEvent[] {
  const ours = creature(options.mine ?? "machamp", {
    level: options.level ?? 60,
    moves: [moveId],
    abilities: options.mineAbilities ?? [],
  });
  const theirs = creature(options.theirs ?? "chansey", {
    level: options.theirLevel ?? 80,
    uid: 2,
    abilities: options.theirAbilities ?? [],
  });

  const opened = startBattle(seed, TAG, [ours], [theirs]);
  const battle: BattleState = options.theirScreens
    ? { ...opened, sides: [opened.sides[0], { ...opened.sides[1], screens: options.theirScreens }] }
    : opened;

  return resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, aiAction(battle)], WILD_RULES, 10)
    .battle.events;
}

/** The stage changes on one side, in order. */
function moved(events: readonly BattleEvent[], side: 0 | 1): { stat: string; delta: number }[] {
  return events.flatMap((event) =>
    event.t === "boost" && event.side === side ? [{ stat: event.stat, delta: event.delta }] : [],
  );
}

describe("what the manifest carries", () => {
  it("W1: seventeen moves, all of them attacks, one of them a coin flip", () => {
    const costly = ALL_MOVES.filter((entry) => entry.selfBoosts);
    expect(costly.length).toBe(17);

    for (const entry of costly) {
      // A status move that lowered its user's stats and did nothing else would
      // be a move nobody would ever press.
      expect(entry.category, entry.id).not.toBe("status");
      expect(entry.power, entry.id).toBeGreaterThan(0);
      // It has to actually say something, or the field is decoration.
      expect(Object.keys(entry.selfBoosts!.boosts).length, entry.id).toBeGreaterThan(0);
      expect(entry.selfBoosts!.chance, entry.id).toBeGreaterThan(0);
      expect(entry.selfBoosts!.chance, entry.id).toBeLessThanOrEqual(100);
      // And it must not be saying it twice: these moves carry their cost in
      // `self`, not in `boosts`, and a row with both would apply both.
      expect(entry.boosts, entry.id).toBeNull();
    }

    // Sixteen certainties and one coin flip, which is the one that is a reward
    // rather than a cost.
    const flips = costly.filter((entry) => entry.selfBoosts!.chance < 100);
    expect(flips.map((entry) => entry.id)).toEqual(["diamondstorm"]);
    expect(flips[0].selfBoosts!.chance).toBe(50);
    expect(flips[0].selfBoosts!.boosts).toEqual({ def: 2 });

    // The famous four, spelled out, because a table that quietly loses a row
    // is the failure this guard is for.
    const cost = (id: string) => ALL_MOVES.find((entry) => entry.id === id)!.selfBoosts!.boosts;
    expect(cost("closecombat")).toEqual({ def: -1, spd: -1 });
    expect(cost("superpower")).toEqual({ atk: -1, def: -1 });
    expect(cost("overheat")).toEqual({ spa: -2 });
    expect(cost("vcreate")).toEqual({ def: -1, spd: -1, spe: -1 });
  });
});

describe("when it is paid", () => {
  it("W2: on landing", () => {
    const dropped = moved(swing("closecombat", "COST1"), 0);
    expect(dropped).toEqual([
      { stat: "def", delta: -1 },
      { stat: "spd", delta: -1 },
    ]);
  });

  it("W3: still, when the blow knocked the target out", () => {
    // The trap in folding this into `secondary`, which is gated on the target
    // surviving: a Close Combat that knocks something out would keep its
    // guard, which is the one case where the move would be free.
    const events = swing("closecombat", "COST2", { level: 80, theirs: "caterpie", theirLevel: 5 });

    expect(events.some((event) => event.t === "faint" && event.side === 1)).toBe(true);
    expect(moved(events, 0)).toEqual([
      { stat: "def", delta: -1 },
      { stat: "spd", delta: -1 },
    ]);
  });

  it("W4: and not when the move never landed", () => {
    // A miss, an immunity and a shield all return before the cost. The first
    // two are reachable from here; the third is the same early return.
    // Overheat, because it is one of the seven that can miss at all —
    // Hyperspace Fury and Close Combat never do, which is what the first cut
    // of this test picked and why it measured nothing.
    let missed = 0;
    for (let at = 0; at < 120 && missed < 3; at++) {
      const events = swing("overheat", `COST3-${at}`);
      if (!events.some((event) => event.t === "miss" && event.side === 0)) continue;
      missed++;
      expect(moved(events, 0), `COST3-${at}`).toEqual([]);
    }
    expect(missed, "nothing ever missed, so this checked nothing").toBeGreaterThan(0);

    // Fighting cannot touch a Ghost, so Close Combat does not land at all.
    const blocked = swing("closecombat", "COST4", { theirs: "misdreavus", theirLevel: 50 });
    expect(blocked.some((event) => event.t === "immune" && event.side === 1)).toBe(true);
    expect(moved(blocked, 0)).toEqual([]);
  });
});

describe("whose doing it is", () => {
  it("W5: the user's own Clear Body does not cancel its own downside", () => {
    // `applyBoosts` is called with `byOther` false, which is the whole point:
    // Clear Body answers "can the other side lower my stages", and this is not
    // the other side. Handing it this would make every drawback move free on
    // anything that happens to carry it.
    //
    // On the *user*, and that is the whole test. The first cut of this put the
    // Clear Body on the creature across the field, which cannot matter either
    // way — `applyBoosts` reads the abilities of whoever is being boosted —
    // so it passed against every wrong implementation as well as the right
    // one. A test that cannot fail is a rubber stamp.
    const guarded = swing("closecombat", "COST5", { mineAbilities: ["clearbody"] });
    expect(moved(guarded, 0)).toEqual([
      { stat: "def", delta: -1 },
      { stat: "spd", delta: -1 },
    ]);

    // And the ability really does what it says, from the direction it is
    // about: a Growl aimed at something carrying it moves nothing, and the
    // same Growl without it does.
    expect(moved(swing("growl", "COST5b", { theirAbilities: ["clearbody"] }), 1)).toEqual([]);
    expect(moved(swing("growl", "COST5b"), 1)).toEqual([{ stat: "atk", delta: -1 }]);
  });

  it("W6: and neither does a Mist, even over the user's own side", () => {
    const ours = creature("machamp", { level: 60, moves: ["closecombat"] });
    const theirs = creature("chansey", { level: 80, uid: 2 });
    const opened = startBattle("COST6", TAG, [ours], [theirs]);
    const misted: BattleState = {
      ...opened,
      sides: [{ ...opened.sides[0], screens: { mist: 5 } }, opened.sides[1]],
    };

    const events = resolveTurn(
      misted,
      [{ t: "fight", moveIndex: 0 }, aiAction(misted)],
      WILD_RULES,
      10,
    ).battle.events;

    expect(moved(events, 0)).toEqual([
      { stat: "def", delta: -1 },
      { stat: "spd", delta: -1 },
    ]);
    // And the mist did not announce itself, because it was never asked.
    expect(events.some((event) => event.t === "screen" && event.which === "mist")).toBe(false);
  });
});

describe("the arithmetic around it", () => {
  it("W7: the cost is paid after the damage, not before it", () => {
    // Superpower spends the Attack it just hit with. If the order were the
    // other way round the move would hit at its own reduced Attack, which is
    // a different and much worse move. Two swings in a row: the second is the
    // one that pays for the first.
    // Level twenty against a level-hundred Chansey that only Splashes: two
    // swings that both land, on something with the health to take them and no
    // way to end the battle first.
    const ours = creature("machamp", { level: 20, moves: ["superpower"] });
    const theirs = creature("chansey", { level: 100, uid: 2, moves: ["splash"] });

    let battle = startBattle("COST7", TAG, [ours], [theirs]);
    const hits: number[] = [];

    for (let turn = 0; turn < 2; turn++) {
      const events = resolveTurn(
        battle,
        [{ t: "fight", moveIndex: 0 }, aiAction(battle)],
        WILD_RULES,
        10,
      );
      battle = events.battle;
      for (const event of events.battle.events) {
        if (event.t === "damage" && event.side === 1) hits.push(event.amount);
      }
    }

    expect(hits.length).toBe(2);
    // A stage down is ÷1.5, and the spread roll is ±15%, so the second blow
    // cannot be as big as the first even on the kindest pair of rolls.
    expect(hits[1]).toBeLessThan(hits[0]);
    expect(battle.sides[0].stages.atk).toBe(-2);
    expect(battle.sides[0].stages.def).toBe(-2);
  });

  it("W8: it stops at the floor, and says only what moved", () => {
    // Six stages down is the bottom. Set up one rung short on one stat and
    // already at the bottom on the other, so a single swing has to do both
    // things at once: take Defence the last rung, and report nothing at all
    // about Sp. Def.
    //
    // Set rather than walked to, because Close Combat has five power points
    // and the floor is six rungs away — which is the arithmetic the first cut
    // of this test got wrong.
    const ours = creature("machamp", { level: 20, moves: ["closecombat"] });
    const theirs = creature("chansey", { level: 100, uid: 2, moves: ["splash"] });

    const opened = startBattle("COST8", TAG, [ours], [theirs]);
    const low: BattleState = {
      ...opened,
      sides: [
        { ...opened.sides[0], stages: { ...opened.sides[0].stages, def: -5, spd: -6 } },
        opened.sides[1],
      ],
    };

    const result = resolveTurn(
      low,
      [{ t: "fight", moveIndex: 0 }, aiAction(low)],
      WILD_RULES,
      10,
    );

    expect(result.battle.sides[0].stages.def).toBe(-6);
    expect(result.battle.sides[0].stages.spd).toBe(-6);
    // One report, for the one rung that actually moved.
    expect(moved(result.battle.events, 0)).toEqual([{ stat: "def", delta: -1 }]);
  });

  it("W9: a coin flip is a coin flip", () => {
    // Diamond Storm, the one that is a reward. Both outcomes have to happen,
    // and at roughly the rate the manifest says, or the chance is being
    // ignored in one direction or the other.
    let won = 0;
    let swung = 0;

    for (let at = 0; at < 400; at++) {
      const events = swing("diamondstorm", `COST9-${at}`, { mine: "tyranitar" });
      if (!events.some((event) => event.t === "damage" && event.side === 1)) continue;
      swung++;
      if (moved(events, 0).some((one) => one.stat === "def" && one.delta === 2)) won++;
    }

    expect(swung).toBeGreaterThan(300);
    const share = won / swung;
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.6);
  });
});
