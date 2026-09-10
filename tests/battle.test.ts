import { describe, expect, it } from "vitest";
import {
  activeOf,
  catchOdds,
  isFainted,
  maxHp,
  resolveTurn,
  startBattle,
  aiAction,
  DUEL_RULES,
  MAX_TURNS,
  TRAINER_RULES,
  WILD_RULES,
  type BattleAction,
  type BattleEvent,
  type BattleState,
  type SideIndex,
} from "@/engine/battle";
import { anyPp } from "@/engine/pp";
import { effectiveness, move } from "@/engine/dex";
import { awardExp, evolutionAt, expForLevel, levelFromExp } from "@/engine/progression";
import type { Individual } from "@/engine/types";
import { creature } from "./helpers";

const SEED = "BATTLE1";
const TAG = "wild:meadow-1:0";

/** Runs one turn of a fresh battle and hands back everything it produced. */
function fight(player: Individual, wild: Individual, moveIndex = 0, state?: BattleState) {
  const battle = state ?? startBattle(SEED, TAG, [player], [wild]);
  return resolveTurn(battle, [{ t: "fight", moveIndex }, aiAction(battle)], WILD_RULES, 10);
}

/** Plays a battle out with both sides using their first move. */
function playOut(ours: Individual[], theirs: Individual[], turns = 12) {
  let battle = startBattle(SEED, TAG, ours, theirs);
  for (let i = 0; i < turns && !battle.outcome && !battle.awaitingSwitch[0]; i++) {
    battle = resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, aiAction(battle)], WILD_RULES, 10).battle;
  }
  return battle;
}

function damageTo(events: readonly BattleEvent[], side: SideIndex): number {
  return events
    .filter((event): event is Extract<BattleEvent, { t: "damage" }> => event.t === "damage" && event.side === side)
    .reduce((total, event) => total + event.amount, 0);
}

describe("the type chart", () => {
  it("B1: reads the way the games do", () => {
    expect(effectiveness("fire", ["grass"])).toBe(8);
    expect(effectiveness("fire", ["water"])).toBe(2);
    expect(effectiveness("electric", ["ground"])).toBe(0);
    expect(effectiveness("normal", ["ghost"])).toBe(0);
    expect(effectiveness("ice", ["dragon"])).toBe(8);
  });

  it("B2: dual types multiply, and a quarter is the floor", () => {
    expect(effectiveness("fire", ["grass", "bug"])).toBe(16);
    expect(effectiveness("fire", ["water", "rock"])).toBe(1);
    expect(effectiveness("normal", ["ghost", "grass"])).toBe(0);
  });
});

describe("damage", () => {
  it("B3: the same turn always resolves the same way", () => {
    const player = creature("charmander", { level: 30, moves: ["ember"] });
    const wild = creature("bulbasaur", { level: 30 });

    const first = fight(player, wild);
    const second = fight(player, wild);

    expect(activeOf(second.battle, 1).hp).toBe(activeOf(first.battle, 1).hp);
    expect(activeOf(second.battle, 0).hp).toBe(activeOf(first.battle, 0).hp);
    expect(second.battle.events).toEqual(first.battle.events);
  });

  it("B4: type effectiveness moves real numbers", () => {
    const attacker = creature("charmander", { level: 40, moves: ["ember"] });
    const burned = fight(attacker, creature("bulbasaur", { level: 40 }));
    const resisted = fight(attacker, creature("squirtle", { level: 40 }));

    expect(damageTo(burned.battle.events, 1)).toBeGreaterThan(damageTo(resisted.battle.events, 1));
  });

  it("B5: an immune defender takes nothing at all", () => {
    const result = fight(
      creature("rattata", { level: 40, moves: ["tackle"] }),
      creature("gastly", { level: 40 }),
    );

    expect(damageTo(result.battle.events, 1)).toBe(0);
    expect(result.battle.events.some((event) => event.t === "immune")).toBe(true);
    expect(activeOf(result.battle, 1).hp).toBe(maxHp(activeOf(result.battle, 1)));
  });

  it("B6: burn halves physical damage but leaves special alone", () => {
    const healthy = creature("machop", { level: 40, moves: ["tackle"] });
    const burnt = creature("machop", { level: 40, moves: ["tackle"], status: "brn" });
    const target = creature("bulbasaur", { level: 40 });

    const clean = damageTo(fight(healthy, target).battle.events, 1);
    const scorched = damageTo(fight(burnt, target).battle.events, 1);

    expect(scorched).toBeLessThan(clean);
    expect(scorched).toBeGreaterThan(0);
  });

  it("B7: a resisted hit still chips for at least one", () => {
    const result = fight(
      creature("caterpie", { level: 50, moves: ["tackle"], iv: 0 }),
      creature("steelix", { level: 50 }),
    );
    expect(damageTo(result.battle.events, 1)).toBeGreaterThanOrEqual(1);
  });

  it("B8: a creature knocked out before its turn does not get to swing", () => {
    const result = fight(
      creature("caterpie", { level: 2, moves: ["tackle"], iv: 0 }),
      creature("machamp", { level: 90, moves: ["karatechop"] }),
    );

    expect(activeOf(result.battle, 0).hp).toBe(0);
    expect(damageTo(result.battle.events, 1)).toBe(0);
    expect(result.battle.events.some((event) => event.t === "faint" && event.side === 0)).toBe(true);
  });
});

describe("status and stages", () => {
  it("B9: a status move applies its condition", () => {
    const result = fight(
      creature("pikachu", { level: 40, moves: ["thunderwave"] }),
      creature("bulbasaur", { level: 40 }),
    );
    const landed = result.battle.events.some((event) => event.t === "status" && event.status === "par");
    const missed = result.battle.events.some((event) => event.t === "miss");
    expect(landed || missed).toBe(true);
    if (landed) expect(activeOf(result.battle, 1).status).toBe("par");
  });

  it("B10: type immunity to a status is respected", () => {
    let battle = startBattle(SEED, TAG, [creature("gastly", { level: 40, moves: ["willowisp"] })], [
      creature("charmander", { level: 40 }),
    ]);

    for (let i = 0; i < 8 && !battle.outcome; i++) {
      battle = resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, aiAction(battle)], WILD_RULES, 10).battle;
      expect(activeOf(battle, 1).status).not.toBe("brn");
    }
  });

  it("B11: stat stages clamp at six and reset on a switch", () => {
    const team = [
      creature("machop", { level: 40, moves: ["swordsdance"], uid: 1 }),
      creature("squirtle", { level: 40, uid: 2 }),
    ];
    const battle = playOut(team, [creature("bulbasaur", { level: 60 })], 10);
    expect(battle.sides[0].stages.atk).toBeLessThanOrEqual(6);

    if (!battle.outcome && !battle.awaitingSwitch[0]) {
      const switched = resolveTurn(battle, [{ t: "switch", partyIndex: 1 }, aiAction(battle)], WILD_RULES, 10);
      expect(switched.battle.sides[0].stages.atk).toBe(0);
      expect(switched.battle.sides[0].active).toBe(1);
    }
  });
});

describe("winning and losing", () => {
  it("B12: beating something awards experience to the survivor", () => {
    const before = expForLevel(40);
    const battle = playOut(
      [creature("machop", { level: 40, moves: ["tackle"] })],
      [creature("caterpie", { level: 3, iv: 0 })],
    );

    expect(battle.outcome).toEqual({ t: "win", side: 0 });
    expect(activeOf(battle, 0).exp).toBeGreaterThan(before);
    expect(battle.events.some((event) => event.t === "exp")).toBe(true);
  });

  it("B13: a lone fainted creature loses the battle rather than hanging", () => {
    const battle = playOut(
      [creature("caterpie", { level: 2, iv: 0, moves: ["tackle"] })],
      [creature("machamp", { level: 90 })],
    );

    expect(battle.outcome).toEqual({ t: "win", side: 1 });
    expect(isFainted(activeOf(battle, 0))).toBe(true);
  });

  it("B14: with a reserve, a faint demands a switch instead of ending it", () => {
    const battle = playOut(
      [
        creature("caterpie", { level: 2, iv: 0, moves: ["tackle"], uid: 1 }),
        creature("squirtle", { level: 40, uid: 2 }),
      ],
      [creature("machamp", { level: 90 })],
    );

    expect(battle.awaitingSwitch[0]).toBe(true);
    expect(battle.outcome).toBeNull();
    // Only a switch is legal now.
    expect(() =>
      resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, { t: "pass" }], WILD_RULES, 10),
    ).toThrow();

    const recovered = resolveTurn(battle, [{ t: "switch", partyIndex: 1 }, { t: "pass" }], WILD_RULES, 10);
    expect(recovered.battle.awaitingSwitch[0]).toBe(false);
    expect(recovered.battle.sides[0].active).toBe(1);
  });
});

describe("battles that cannot end on their own", () => {
  it("B14b: two creatures that cannot scratch each other run dry and settle it", () => {
    // The real case, found by the deadlock probe: Rowlet is Grass/Flying, so
    // Wooper-Paldea's Mud Shot is a zero-times no-op, and Growl and Tail Whip
    // deal no damage either. Neither creature can reduce the other's HP by a
    // single point.
    //
    // Power points are what actually resolve this, which is what the games
    // they resemble have always used them for: both sides spend everything
    // they have, and Struggle does the rest. The turn limit is still there
    // underneath as a floor, but this no longer needs it.
    let battle = startBattle(
      SEED,
      "wild:ashflats-1:2",
      [creature("rowlet", { level: 12, moves: ["growl"] })],
      [creature("wooperpaldea", { level: 10, moves: ["mudshot", "tailwhip"] })],
    );

    for (let turn = 0; turn < MAX_TURNS + 5 && !battle.outcome; turn++) {
      const ours = activeOf(battle, 0);
      const mine: BattleAction = anyPp(ours) ? { t: "fight", moveIndex: 0 } : { t: "struggle" };
      battle = resolveTurn(battle, [mine, aiAction(battle)], TRAINER_RULES).battle;
    }

    expect(battle.outcome).not.toBeNull();
    // It ended because somebody was reduced to Struggle, not because a clock
    // ran out on it.
    expect(battle.turn).toBeLessThan(MAX_TURNS);
    expect(battle.events.some((event) => event.t === "struggling")).toBe(true);
  });

  it("B14c: three hundred turns of nothing at all still ends, on health", () => {
    // Both sides passing spends nothing, which is the cleanest way to ask the
    // one question this is about: does the limit hold on its own?
    const healthy = creature("machop", { uid: 1, level: 40, moves: ["growl"] });
    const hurt = { ...creature("machop", { uid: 2, level: 40, moves: ["growl"] }), hp: 3 };

    let battle = startBattle(SEED, "duel", [healthy], [hurt]);
    for (let turn = 0; turn < MAX_TURNS + 5 && !battle.outcome; turn++) {
      battle = resolveTurn(battle, [{ t: "pass" }, { t: "pass" }], DUEL_RULES).battle;
    }

    expect(battle.turn).toBe(MAX_TURNS);
    expect(battle.events.some((event) => event.t === "timeout")).toBe(true);
    expect(battle.outcome).toEqual({ t: "win", side: 0 });
  });

  it("B14d: the limit holds on every way out of a turn, not just the usual one", () => {
    // It used to be checked at the end of the ordinary move-resolution path,
    // which the six early returns never reach — a switch, a ball, a flee that
    // failed. A battle that only ever saw those could pass three hundred turns
    // and keep going, and the probe found exactly that: out of moves, out of
    // balls, and throwing a ball it did not have a thousand times over.
    let battle = startBattle(
      SEED,
      "wild:limit",
      [creature("machop", { uid: 1, level: 40, moves: ["growl"] })],
      [creature("chansey", { uid: 2, level: 40, moves: ["growl"] })],
    );

    for (let turn = 0; turn < MAX_TURNS + 5 && !battle.outcome; turn++) {
      // No balls in the bag, so every throw is a fumble that costs a turn and
      // does nothing — the exact shape of the stall.
      battle = resolveTurn(battle, [{ t: "ball" }, { t: "pass" }], WILD_RULES, 0).battle;
    }

    expect(battle.turn).toBe(MAX_TURNS);
    expect(battle.outcome).not.toBeNull();
  });
});

describe("catching", () => {
  it("B15: odds rise as the target weakens and again with status", () => {
    const full = creature("rattata", { level: 10 });
    const hurt = { ...full, hp: 1 };
    const asleep = { ...hurt, status: "slp" as const };

    expect(catchOdds(hurt, 1000)).toBeGreaterThan(catchOdds(full, 1000));
    expect(catchOdds(asleep, 1000)).toBeGreaterThan(catchOdds(hurt, 1000));
  });

  it("B16: a rarer creature is harder to catch than a common one", () => {
    expect(catchOdds(creature("rattata", { level: 10 }), 1000)).toBeGreaterThan(
      catchOdds(creature("dragonite", { level: 10 }), 1000),
    );
  });

  it("B17: throwing with no balls left spends nothing and ends nothing", () => {
    const battle = startBattle(SEED, TAG, [creature("machop")], [creature("rattata", { level: 10 })]);
    const result = resolveTurn(battle, [{ t: "ball" }, { t: "pass" }], WILD_RULES, 0);

    expect(result.ballsUsed).toBe(0);
    expect(result.caught).toBeNull();
    expect(result.battle.outcome).toBeNull();
    expect(result.battle.events.some((event) => event.t === "noBalls")).toBe(true);
  });

  it("B18: a duel allows neither balls nor running", () => {
    // The rules object is the only difference between a wild encounter and a
    // match against a person, which is what keeps them one engine.
    const battle = startBattle(SEED, "duel", [creature("machop")], [creature("machop", { uid: 2 })]);
    expect(() => resolveTurn(battle, [{ t: "ball" }, { t: "pass" }], DUEL_RULES, 10)).toThrow();
    expect(() => resolveTurn(battle, [{ t: "flee" }, { t: "pass" }], DUEL_RULES, 10)).toThrow();
  });

  it("B19: nobody gains experience from beating a person", () => {
    const battle = startBattle(SEED, "duel", [creature("machamp", { level: 80, moves: ["karatechop"] })], [
      creature("caterpie", { level: 2, iv: 0 }),
    ]);
    const result = resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], DUEL_RULES, 0);

    expect(result.battle.outcome).toEqual({ t: "win", side: 0 });
    expect(result.battle.events.some((event) => event.t === "exp")).toBe(false);
  });
});

describe("progression", () => {
  it("B20: the level curve round-trips", () => {
    for (const level of [1, 5, 17, 42, 99, 100]) {
      expect(levelFromExp(expForLevel(level))).toBe(level);
    }
  });

  it("B21: levelling up learns moves while there is room", () => {
    const young = creature("bulbasaur", { level: 5, moves: ["tackle"] });
    const grown = awardExp(young, expForLevel(25) - young.exp);

    expect(grown.levelsGained).toBeGreaterThan(0);
    expect(grown.individual.moves.length).toBeGreaterThan(1);
    expect(grown.individual.moves.length).toBeLessThanOrEqual(4);
  });

  it("B22: a full moveset is never silently overwritten", () => {
    const full = creature("bulbasaur", { level: 5, moves: ["tackle", "growl", "vinewhip", "growth"] });
    const grown = awardExp(full, expForLevel(30) - full.exp);
    expect(grown.individual.moves).toEqual(full.moves);
    expect(grown.movesLearned).toEqual([]);
  });

  it("B23: reaching the level evolves it", () => {
    const bulbasaur = creature("bulbasaur", { level: 5 });
    expect(evolutionAt(bulbasaur)).toBeNull();

    const grown = awardExp(bulbasaur, expForLevel(20) - bulbasaur.exp);
    expect(grown.evolvedTo).toBe("ivysaur");
    expect(grown.individual.speciesId).toBe("ivysaur");
  });

  it("B24: levelling keeps the proportion of health, not a free heal", () => {
    const hurt = creature("machop", { level: 10, moves: ["tackle"] });
    const half = { ...hurt, hp: Math.floor(maxHp(hurt) / 2) };
    const grown = awardExp(half, expForLevel(14) - half.exp);

    expect(grown.individual.hp).toBeLessThan(maxHp(grown.individual));
    expect(grown.individual.hp).toBeGreaterThan(0);
  });
});

describe("move data", () => {
  it("B25: the manifest carries the effects the engine reads", () => {
    expect(move("ember").type).toBe("fire");
    expect(move("ember").category).toBe("special");
    expect(move("thunderwave").status).toBe("par");
    expect(move("swordsdance").boosts).toEqual({ atk: 2 });
    expect(move("absorb").drain).toEqual([1, 2]);
    expect(move("doubleedge").recoil).toEqual([33, 100]);
    expect(move("recover").heal).toEqual([1, 2]);
  });
});

describe("evolving", () => {
  it("B28: the event says what it became and what it was", () => {
    // Both halves, because by the time anything reads this the creature has
    // already changed — a screen that wants to show the change has no way
    // back to the thing it changed from.
    const mine = creature("caterpie", { uid: 1, level: 6, moves: ["tackle"] });
    const theirs = creature("magikarp", { uid: 2, level: 40, hp: 1, moves: ["splash"] });

    let battle = startBattle("SEED", "wild:evolve:0", [mine], [theirs]);
    let evolved: { evolved: string | null; evolvedFrom: string | null } | null = null;

    for (let i = 0; i < 20 && !battle.outcome; i++) {
      battle = resolveTurn(
        battle,
        [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }],
        WILD_RULES,
      ).battle;

      for (const event of battle.events) {
        if (event.t === "exp" && event.evolved) evolved = event;
      }
    }

    expect(evolved).not.toBeNull();
    expect(evolved!.evolvedFrom).toBe("caterpie");
    expect(evolved!.evolved).toBe("metapod");
    expect(battle.sides[0].team[0].speciesId).toBe("metapod");
  });

  it("B29: and says nothing about it when nothing evolved", () => {
    const mine = creature("machamp", { uid: 1, level: 80, moves: ["karatechop"] });
    const theirs = creature("magikarp", { uid: 2, level: 5, hp: 1, moves: ["splash"] });

    let battle = startBattle("SEED", "wild:plain:0", [mine], [theirs]);
    battle = resolveTurn(
      battle,
      [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }],
      WILD_RULES,
    ).battle;

    for (const event of battle.events) {
      if (event.t !== "exp") continue;
      expect(event.evolved).toBeNull();
      expect(event.evolvedFrom).toBeNull();
    }
  });
});
