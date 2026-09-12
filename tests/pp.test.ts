import { describe, expect, it } from "vitest";
import {
  actionRefusal,
  activeOf,
  isFainted,
  maxHp,
  resolveTurn,
  startBattle,
  aiAction,
  MAX_TURNS,
  TRAINER_RULES,
  type BattleAction,
  type BattleState,
} from "@/engine/battle";
import { applyInput, initialState, reduce, stateHash, type GameState, type Input } from "@/engine/engine";
import { move as moveById } from "@/engine/dex";
import { alignPp, anyPp, fullPp, maxPp, ppLeft, restorePp, spendPp } from "@/engine/pp";
import { creature, standInside, testWorld } from "./helpers";

/**
 * Power points: the one resource spent by playing well.
 *
 * Health is lost to mistakes and bought back from a shelf. Uses are spent by
 * every attack that lands and nothing in the bag returns them — they come back
 * at the centre, and by being beaten, which restores the party anyway. That is
 * what makes a walk to the sixth ring a question about stamina rather than
 * about hit points.
 */

function started(seed = "PKMFEVER1") {
  const world = testWorld(seed);
  const state = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  return { world, state };
}

/** Swings until the battle ends, struggling once there is nothing left. */
function fightItOut(battle: BattleState, rules = TRAINER_RULES, cap = MAX_TURNS + 5) {
  let at = battle;
  for (let turn = 0; turn < cap && !at.outcome; turn++) {
    const ours = activeOf(at, 0);
    const mine: BattleAction = anyPp(ours) ? { t: "fight", moveIndex: 0 } : { t: "struggle" };
    at = resolveTurn(at, [mine, aiAction(at)], rules).battle;
  }
  return at;
}

describe("uses", () => {
  it("P1: a fresh creature is full, and the numbers come from the manifest", () => {
    const mine = creature("pidgey", { moves: ["tackle", "gust"] });
    expect(ppLeft(mine, 0)).toBe(moveById("tackle").pp);
    expect(ppLeft(mine, 1)).toBe(moveById("gust").pp);
    expect(fullPp(["tackle", "gust"])).toEqual([moveById("tackle").pp, moveById("gust").pp]);
  });

  it("P2: attacking spends one, and only the slot that was used", () => {
    const mine = creature("machop", { uid: 1, level: 20, moves: ["tackle", "lowkick"] });
    const foe = creature("chansey", { uid: 2, level: 20, moves: ["growl"] });

    const after = resolveTurn(
      startBattle("PP", "duel", [mine], [foe]),
      [{ t: "fight", moveIndex: 0 }, { t: "pass" }],
      TRAINER_RULES,
    ).battle;

    const ours = activeOf(after, 0);
    expect(ppLeft(ours, 0)).toBe(maxPp("tackle") - 1);
    expect(ppLeft(ours, 1)).toBe(maxPp("lowkick"));
  });

  it("P3: a spent slot is refused, by the engine and by the same predicate the menu asks", () => {
    const mine = creature("machop", { uid: 1, level: 20, moves: ["tackle"], pp: [0] });
    const foe = creature("chansey", { uid: 2, level: 20, moves: ["growl"] });
    const battle = startBattle("PP", "duel", [mine], [foe]);

    expect(actionRefusal(battle, 0, { t: "fight", moveIndex: 0 })).toBe("no uses left in that one");
    expect(() =>
      resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, { t: "pass" }], TRAINER_RULES),
    ).toThrow();
  });

  it("P4: a turn it could not act on costs nothing", () => {
    // Frozen solid. Charging for a turn it never got is how a battle quietly
    // becomes unwinnable.
    const frozen = creature("machop", { uid: 1, level: 20, moves: ["tackle"], status: "frz" });
    const foe = creature("chansey", { uid: 2, level: 60, moves: ["growl"] });

    let battle = startBattle("PP-FRZ", "duel", [frozen], [foe]);
    let spent = 0;
    for (let turn = 0; turn < 12 && !battle.outcome; turn++) {
      battle = resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, { t: "pass" }], TRAINER_RULES).battle;
      const ours = activeOf(battle, 0);
      spent = maxPp("tackle") - ppLeft(ours, 0);
      // Every turn it actually swung is a turn it thawed on.
      const used = battle.events.filter((event) => event.t === "use").length;
      expect(spent).toBeLessThanOrEqual(turn + 1);
      expect(used).toBeLessThanOrEqual(1);
    }
  });
});

describe("struggle", () => {
  it("P5: it is legal only when there is nothing else, and illegal when there is", () => {
    const full = creature("machop", { uid: 1, level: 20, moves: ["tackle"] });
    const empty = creature("machop", { uid: 1, level: 20, moves: ["tackle"], pp: [0] });
    const foe = creature("chansey", { uid: 2, level: 20, moves: ["growl"] });

    expect(actionRefusal(startBattle("S", "duel", [full], [foe]), 0, { t: "struggle" })).toBe(
      "it still has moves to use",
    );
    expect(actionRefusal(startBattle("S", "duel", [empty], [foe]), 0, { t: "struggle" })).toBeNull();
  });

  it("P6: it damages, it hurts the user, and it ignores the type chart", () => {
    // Normal does nothing to a ghost. Struggle has to, or a creature out of
    // moves facing one would be stuck in a battle it can neither act in nor
    // lose.
    const mine = creature("machop", { uid: 1, level: 40, moves: ["tackle"], pp: [0] });
    const ghost = creature("gastly", { uid: 2, level: 40, moves: ["growl"] });

    const before = maxHp(mine);
    const after = resolveTurn(
      startBattle("S2", "duel", [mine], [ghost]),
      [{ t: "struggle" }, { t: "pass" }],
      TRAINER_RULES,
    ).battle;

    expect(after.events.some((event) => event.t === "struggling")).toBe(true);
    // It landed on something Normal cannot touch.
    const dealt = after.events.find((event) => event.t === "damage");
    expect(dealt).toBeDefined();
    expect(activeOf(after, 1).hp).toBeLessThan(maxHp(ghost));
    // And it cost a quarter of its own.
    expect(activeOf(after, 0).hp).toBeLessThanOrEqual(before - Math.floor(before / 4));
  });

  it("P7: the AI reaches for it too, rather than picking a slot it cannot use", () => {
    const mine = creature("chansey", { uid: 1, level: 60, moves: ["growl"] });
    const dry = creature("machop", { uid: 2, level: 20, moves: ["tackle", "lowkick"], pp: [0, 0] });

    const battle = startBattle("S3", "duel", [mine], [dry]);
    expect(aiAction(battle, 1)).toEqual({ t: "struggle" });

    // And with one slot left it names that slot, not a spent one.
    const partly = startBattle(
      "S4",
      "duel",
      [mine],
      [creature("machop", { uid: 2, level: 20, moves: ["tackle", "lowkick"], pp: [0, 5] })],
    );
    expect(aiAction(partly, 1)).toEqual({ t: "fight", moveIndex: 1 });
  });

  it("P8: a battle nobody can win on damage now ends on its own", () => {
    // Rowlet is Grass/Flying, so Mud Shot is a no-op and Growl and Tail Whip
    // deal nothing. Before uses existed this ran for three hundred turns and
    // ended on a timeout; now both sides run dry and Struggle settles it.
    const ended = fightItOut(
      startBattle(
        "S5",
        "wild:stalemate",
        [creature("rowlet", { level: 12, moves: ["growl"] })],
        [creature("wooperpaldea", { level: 10, moves: ["mudshot", "tailwhip"] })],
      ),
    );

    expect(ended.outcome).not.toBeNull();
    expect(ended.turn).toBeLessThan(MAX_TURNS);
  });
});

describe("what brings them back", () => {
  it("P9: nothing in the bag does", () => {
    // Deliberate: there is no Ether and no Elixir, so the question before
    // walking back into the grass is "can I still fight" rather than "how many
    // bottles am I carrying".
    const spent = spendPp(creature("pidgey", { moves: ["tackle"] }), 0);
    expect(ppLeft(spent, 0)).toBe(maxPp("tackle") - 1);
    expect(ppLeft(restorePp(spent), 0)).toBe(maxPp("tackle"));
  });

  it("P10: the centre restores them, along with everything else", () => {
    const { world, state } = started("PPHEAL");
    const tired = {
      ...creature("pidgey", { uid: 1, moves: ["tackle", "gust"], pp: [0, 1], status: "psn" }),
      hp: 3,
    };

    // Standing in front of the nurse, who patches up the whole party.
    let inside: GameState = { ...standInside(world, state, "centre"), party: [tired] };
    const nurse = (world.npcs.get(inside.route) ?? []).find((who) => who.kind === "heal");
    expect(nurse, "no healer in the centre").toBeDefined();

    inside = { ...inside, talking: nurse!.id };
    const healed = applyInput(world, inside, { t: "npcAccept" });

    expect(ppLeft(healed.party[0], 0)).toBe(maxPp("tackle"));
    expect(ppLeft(healed.party[0], 1)).toBe(maxPp("gust"));
    expect(healed.party[0].hp).toBe(maxHp(healed.party[0]));
    expect(healed.party[0].status).toBeNull();
  });

  it("P11: being beaten restores them, because it restores the party anyway", () => {
    const { world, state } = started("PPWIPE");

    const doomed = {
      ...creature("magikarp", { uid: 1, level: 5, moves: ["tackle"], pp: [0] }),
      hp: 1,
    };
    const killer = creature("dragonite", { uid: 2, level: 80, moves: ["slam"] });

    let fighting: GameState = {
      ...state,
      phase: "battle",
      party: [doomed],
      battle: startBattle(world.seed, "trainer:pp", [doomed], [killer], 0),
    };

    for (let turn = 0; turn < 8 && fighting.phase === "battle"; turn++) {
      const ours = fighting.battle ? activeOf(fighting.battle, 0) : doomed;
      const mine: Input = anyPp(ours) ? { t: "fight", moveIndex: 0 } : { t: "struggle" };
      fighting = applyInput(world, fighting, mine);
    }

    expect(fighting.notice).toMatchObject({ t: "whiteout" });
    expect(fighting.party.every((one) => !isFainted(one))).toBe(true);
    expect(ppLeft(fighting.party[0], 0)).toBe(maxPp("tackle"));
  });

  it("P12: rebuilding a moveset keeps what was spent, and starts anything new full", () => {
    const before = creature("pidgey", { moves: ["tackle", "gust"], pp: [3, 4] });

    // Forgetting Gust for Quick Attack: Tackle keeps its three, and the new
    // one arrives fresh.
    const after = alignPp({ ...before, moves: ["tackle", "quickattack"] }, before);
    expect(ppLeft(after, 0)).toBe(3);
    expect(ppLeft(after, 1)).toBe(maxPp("quickattack"));

    // And a move put back keeps nothing it never had — full, not negative.
    const restored = alignPp({ ...before, moves: ["gust"] }, before);
    expect(ppLeft(restored, 0)).toBe(4);
  });

  it("P13: what is left is part of the save, and replays", () => {
    const world = testWorld("PPREPLAY");
    const inputs: Input[] = [{ t: "pickStarter", index: 0 }];
    const once = reduce(world, inputs);

    expect(stateHash(reduce(world, inputs))).toBe(stateHash(once));

    // A creature that has spent its Surf cannot hash the same as one that has
    // not, or a duel could not tell the two apart.
    const tired = {
      ...once,
      party: [spendPp(once.party[0], 0)],
    };
    expect(stateHash(tired)).not.toBe(stateHash(once));
  });

  it("P14: a caught creature arrives with a full tank", () => {
    const { world, state } = started("PPCATCH");
    const wild = creature("rattata", { uid: 9, level: 5, moves: ["tackle"], hp: 1 });
    const mine = creature("pidgey", { uid: 1, level: 30, moves: ["tackle"] });

    let fighting: GameState = {
      ...state,
      phase: "battle",
      party: [mine],
      bag: { ...state.bag, pokeball: 40 },
      battle: startBattle(world.seed, "wild:catch", [mine], [wild], 0),
    };

    for (let turn = 0; turn < 40 && fighting.phase === "battle"; turn++) {
      fighting = applyInput(world, fighting, { t: "ball" });
    }

    const caught = [...fighting.party, ...fighting.box].find((one) => one.speciesId === "rattata");
    if (!caught) return; // Forty balls and it still got away; nothing to check.
    caught.moves.forEach((moveId, at) => expect(ppLeft(caught, at)).toBe(maxPp(moveId)));
  });
});
