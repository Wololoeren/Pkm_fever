import { describe, expect, it } from "vitest";
import {
  activeOf,
  battleHash,
  catchOdds,
  isFainted,
  maxHp,
  ballMultiplier,
  conditionOf,
  fleeFailPercent,
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
import { ALL_MOVES, effectiveness, move } from "@/engine/dex";
import { awardExp, evolutionAt, evolve, expForLevel, levelFromExp } from "@/engine/progression";
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
  it("B9d: Hex and Infernal Parade hit twice as hard at a target with a condition", () => {
    for (const moveId of ["hex", "infernalparade"]) {
      const attacker = creature("gengar", { level: 50, moves: [moveId], iv: 0 });
      const hitOn = (status?: "slp" | "par") => {
        // The same tag and turn, so the damage roll and crit roll are identical
        // and the only difference is the condition.
        const target = creature("lapras", { level: 50, moves: ["splash"], uid: 2, iv: 0, status });
        const battle = startBattle(SEED, "wild:hex:0", [attacker], [target]);
        const result = resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], WILD_RULES, 0);
        return damageTo(result.battle.events, 1);
      };
      const plain = hitOn();
      expect(plain, moveId).toBeGreaterThan(10);
      for (const status of ["slp", "par"] as const) {
        const doubled = hitOn(status);
        expect(doubled, `${moveId} on ${status}`).toBeGreaterThanOrEqual(plain * 2 - 2);
        expect(doubled, `${moveId} on ${status}`).toBeLessThanOrEqual(plain * 2 + 2);
      }
    }
  });

  it("B9b: a creature asleep on a counter of n loses exactly n turns, then moves on the next", () => {
    for (const counter of [1, 2, 3]) {
      const sleeper = { ...creature("machop", { level: 40, moves: ["tackle"], status: "slp" }), sleepTurns: counter };
      let battle = startBattle(SEED, `wild:sleep:${counter}`, [sleeper], [creature("chansey", { level: 80, moves: ["splash"], uid: 2 })]);
      let lost = 0;
      let woke = -1;
      for (let at = 0; at < 6 && woke < 0; at++) {
        battle = resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], WILD_RULES, 0).battle;
        if (battle.events.some((event) => event.t === "blocked" && event.side === 0 && event.reason === "slp")) lost++;
        if (battle.events.some((event) => event.t === "woke" && event.side === 0)) woke = at;
      }
      expect(lost, `counter ${counter}`).toBe(counter);
      expect(woke, `counter ${counter}`).toBe(counter);
    }
  });

  it("B9c: a sleep move always costs its target at least one turn", () => {
    for (let n = 0; n < 30; n++) {
      const tag = `wild:spore:${n}`;
      const battle = startBattle(SEED, tag, [creature("paras", { level: 50, moves: ["spore"] })], [
        creature("rattata", { level: 20, moves: ["tackle"], uid: 2 }),
      ]);
      let state = resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], WILD_RULES, 0).battle;
      if (activeOf(state, 1).status !== "slp") continue;
      // Counted from the turn it fell asleep: if the spore was faster, the
      // target loses that very turn.
      let lost = state.events.filter((event) => event.t === "blocked" && event.side === 1).length;
      for (let at = 0; at < 5 && activeOf(state, 1).status === "slp" && !state.outcome; at++) {
        state = resolveTurn(state, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], WILD_RULES, 0).battle;
        lost += state.events.filter((event) => event.t === "blocked" && event.side === 1).length;
      }
      expect(lost, tag).toBeGreaterThanOrEqual(1);
    }
  });

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

  it("B16b: a Great Ball and an Ultra Ball really do catch more often than a Poké Ball", () => {
    // They were bought, carried and never used: the throw ignored which ball
    // it was and always rolled at the Poké Ball's rate.
    const catches = (ball?: string) => {
      let caught = 0;
      for (let n = 0; n < 400; n++) {
        const battle = startBattle(SEED, `wild:balls:${n}`, [creature("machop")], [creature("dragonite", { level: 30, uid: 2 })]);
        const action: BattleAction = ball ? { t: "ball", item: ball } : { t: "ball" };
        if (resolveTurn(battle, [action, { t: "pass" }], WILD_RULES, 1).caught) caught++;
      }
      return caught;
    };
    const poke = catches();
    const great = catches("greatball");
    const ultra = catches("ultraball");
    expect(great).toBeGreaterThan(poke);
    expect(ultra).toBeGreaterThan(great);
  });

  it("B16c: each special ball pays out only under its own condition", () => {
    const ours = creature("machop", { level: 40 });
    const fresh = startBattle(SEED, TAG, [ours], [creature("magikarp", { level: 10, uid: 2 })]);
    const later = { ...fresh, turn: 5 };
    const wild = fresh.sides[1].team[0];
    const at = (ball: string, state = fresh, mine = ours, them = wild) => ballMultiplier(ball, state, mine, them);

    expect(at("masterball")).toBeNull();
    expect(at("quickball")).toBe(5000);
    expect(at("quickball", later)).toBe(1000);
    expect(at("timerball")).toBe(1000);
    expect(at("timerball", later)).toBe(2500);
    expect(at("timerball", { ...fresh, turn: 40 })).toBe(4000);
    expect(at("netball")).toBe(3500); // Magikarp is Water
    expect(at("netball", fresh, ours, creature("geodude", { level: 10 }))).toBe(1000);
    expect(at("nestball")).toBe(3100);
    expect(at("nestball", fresh, ours, creature("magikarp", { level: 30 }))).toBe(1000);
    expect(at("levelball")).toBe(8000); // 40 is four times 10
    expect(at("levelball", fresh, creature("machop", { level: 25 }))).toBe(4000);
    expect(at("levelball", fresh, creature("machop", { level: 11 }))).toBe(2000);
    expect(at("levelball", fresh, creature("machop", { level: 10 }))).toBe(1000);
    expect(at("fastball", fresh, ours, creature("electrode", { level: 10 }))).toBe(4000);
    expect(at("fastball")).toBe(1000);
    expect(at("diveball")).toBe(1000);
    expect(at("diveball", { ...fresh, tag: "wild:lake-1:rod:3" })).toBe(3500);

    // And a Master Ball really does not miss, even on the hardest catch.
    for (let n = 0; n < 50; n++) {
      const battle = startBattle(SEED, `wild:master:${n}`, [ours], [creature("mewtwo", { level: 70, uid: 2 })]);
      expect(resolveTurn(battle, [{ t: "ball", item: "masterball" }, { t: "pass" }], WILD_RULES, 1).caught).not.toBeNull();
    }
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

  it("B18b: running fails ten percent a level the wild one is above you, never under ten", () => {
    expect(fleeFailPercent(30, 10)).toBe(10);
    expect(fleeFailPercent(10, 10)).toBe(10);
    expect(fleeFailPercent(10, 11)).toBe(10);
    expect(fleeFailPercent(10, 13)).toBe(30);
    expect(fleeFailPercent(10, 20)).toBe(100);
    expect(fleeFailPercent(10, 35)).toBe(100);

    // And the engine uses it: ten levels up, there is no getting away however
    // fast you are, and a slow creature well above the wild one mostly does.
    let escaped = 0;
    for (let n = 0; n < 200; n++) {
      const tag = `wild:flee:${n}`;
      const trapped = startBattle(SEED, tag, [creature("electrode", { level: 10 })], [creature("slowpoke", { level: 20, uid: 2 })]);
      expect(resolveTurn(trapped, [{ t: "flee" }, { t: "pass" }], WILD_RULES, 0).battle.outcome).toBeNull();
      const easy = startBattle(SEED, tag, [creature("slowpoke", { level: 30 })], [creature("electrode", { level: 10, uid: 2 })]);
      if (resolveTurn(easy, [{ t: "flee" }, { t: "pass" }], WILD_RULES, 0).battle.outcome?.t === "fled") escaped++;
    }
    expect(escaped).toBeGreaterThan(150);
    expect(escaped).toBeLessThan(200);
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

  it("B23: reaching the level offers the evolution, and does not take it", () => {
    const bulbasaur = creature("bulbasaur", { level: 5 });
    expect(evolutionAt(bulbasaur)).toBeNull();

    const grown = awardExp(bulbasaur, expForLevel(20) - bulbasaur.exp);
    expect(grown.evolveTo).toBe("ivysaur");
    // And it is still a Bulbasaur. Growth reports what is ready and stops:
    // saying no is the player's, and a decision has to reach the engine as an
    // input or the save cannot replay it.
    expect(grown.individual.speciesId).toBe("bulbasaur");

    // Taking it is the separate step, and it keeps the health fraction the
    // way levelling does rather than the raw number.
    const changed = evolve(grown.individual, grown.evolveTo!);
    expect(changed.speciesId).toBe("ivysaur");
    expect(changed.hp).toBeGreaterThan(0);
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
  it("B28: the event says what it is ready to become, and does not change it", () => {
    // Both halves, because a screen showing the change needs the thing it
    // would change from and has no other way back to it.
    //
    // And the creature is still a Caterpie afterwards. A battle no longer
    // evolves anybody: it reports the offer, and whoever owns the party asks
    // — because saying no has to be a decision the save records, or a replay
    // would evolve what the player refused.
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
    expect(battle.sides[0].team[0].speciesId).toBe("caterpie");
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

describe("conditions the manifest has and this engine does not", () => {
  it("B-tox: every condition the manifest knows lands as one this engine has", () => {
    // A crash that type-checked all the way to the throw.
    //
    // The manifest carries six conditions and this engine has five: Toxic is
    // `tox`, poison that gets worse each turn, and there is no worsening here.
    // The field is typed `StatusId` and the manifest is cast to that shape on
    // the way in, so a value outside the union is invisible to the compiler —
    // and `STATUS_IMMUNE["tox"]` is `undefined`, and `.includes` on it throws,
    // and the throw comes back to the player as "illegal input" on a move that
    // is perfectly legal.
    //
    // It survived because nothing ever used Toxic: the people on the routes
    // draw their moves from the route's own table. The rival draws his from the
    // whole dex and found it inside a hundred battles.
    const known = new Set(["brn", "psn", "par", "slp", "frz"]);

    for (const move of ALL_MOVES) {
      for (const status of [move.status, move.secondary?.status]) {
        if (!status) continue;
        // Either this engine knows it outright, or `conditionOf` turns it into
        // one this engine knows. Nothing may fall through to neither.
        expect(
          known.has(status) || known.has(conditionOf(status) ?? ""),
          `${move.id} inflicts ${status}, which is neither`,
        ).toBe(true);
      }
    }

    // And Toxic itself resolves rather than throwing, which is the thing that
    // actually broke. Ninety accuracy, so it is given a few goes.
    const mine = creature("machop", { uid: 1, level: 50, moves: ["toxic"] });
    const theirs = creature("pidgey", { uid: 2, level: 50, moves: ["tackle"] });

    let live = startBattle("tox", "wild:test:0", [mine], [theirs]);
    for (let turn = 0; turn < 8 && !live.sides[1].team[0].status; turn++) {
      live = resolveTurn(
        live,
        [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }],
        WILD_RULES,
      ).battle;
    }

    // Poison, because that is the nearest condition this engine has.
    expect(live.sides[1].team[0].status).toBe("psn");
  });
});

/**
 * Experience, split between everybody who took part.
 *
 * Switching out was a pure loss before this: send something in to take a hit,
 * bring it back, and it had done all the work and earned none of the
 * experience. That taught exactly one lesson — never switch — which is the
 * opposite of what a switch is for.
 *
 * `BattleState.sharing` is the whole mechanism: who has stood opposite *this*
 * creature, reset when the other side sends out somebody new.
 */
describe("who earned it", () => {
  /** Two of ours against one very weak thing, so the fight ends on cue. */
  function bout(ours: Individual[], theirs: Individual[], lead = 0) {
    return startBattle("SHARE", "wild:share:0", ours, theirs, lead);
  }

  function team(count: number, level = 30): Individual[] {
    return Array.from({ length: count }, (_, at) =>
      creature("machop", { uid: at + 1, level, moves: ["karatechop", "tackle"] }),
    );
  }

  /** Beaten in one, by handing the other side no health at all. */
  function finish(state: BattleState) {
    const flattened: BattleState = {
      ...state,
      sides: [
        state.sides[0],
        { ...state.sides[1], team: state.sides[1].team.map((one) => ({ ...one, hp: 1 })) },
      ],
    };
    return resolveTurn(flattened, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], WILD_RULES);
  }

  it("X70: the lead is the only one owed a share, to begin with", () => {
    const state = bout(team(3), [creature("caterpie", { uid: 9, level: 3, iv: 0 })], 1);
    expect(state.sharing).toEqual([1]);
  });

  it("X71: something switched out and back in is still owed its share", () => {
    // The whole point. Sending one in to take a hit and bringing it back used
    // to earn it nothing at all.
    const ours = team(2);
    let state = bout(ours, [creature("caterpie", { uid: 9, level: 3, iv: 0 })]);
    state = resolveTurn(state, [{ t: "switch", partyIndex: 1 }, { t: "fight", moveIndex: 0 }], WILD_RULES).battle;
    expect(state.sharing.sort()).toEqual([0, 1]);

    const before = state.sides[0].team.map((one) => one.exp);
    const done = finish(state);

    // Both of them, and neither by accident: two `exp` events, one per uid.
    const paid = done.battle.events.filter((one) => one.t === "exp");
    expect(paid).toHaveLength(2);
    expect(new Set(paid.map((one) => (one as { uid: number }).uid))).toEqual(new Set([1, 2]));

    for (let at = 0; at < 2; at++) {
      expect(done.battle.sides[0].team[at].exp, `slot ${at}`).toBeGreaterThan(before[at]);
    }
  });

  it("X72: the other side switching starts the list again", () => {
    // The list is about *one* opposing creature. Without the reset, beating a
    // team of six would pay the whole party six times over for the work it
    // did against the first one.
    const ours = team(2);
    const theirs = [
      creature("caterpie", { uid: 9, level: 3, iv: 0 }),
      creature("weedle", { uid: 10, level: 3, iv: 0 }),
    ];
    let state = bout(ours, theirs);
    state = resolveTurn(state, [{ t: "switch", partyIndex: 1 }, { t: "fight", moveIndex: 0 }], TRAINER_RULES).battle;
    expect(state.sharing.sort()).toEqual([0, 1]);

    // They send out somebody new: only whoever we have standing has faced it.
    state = resolveTurn(state, [{ t: "fight", moveIndex: 0 }, { t: "switch", partyIndex: 1 }], TRAINER_RULES).battle;
    expect(state.sharing).toEqual([1]);
  });

  it("X73: the split is the yield divided, and never rounds to nothing", () => {
    // One creature takes the lot; six take a sixth each. What matters is that
    // the sixth is not zero — a party that all took a turn against a Caterpie
    // should each come away with something.
    const alone = finish(bout(team(1), [creature("caterpie", { uid: 9, level: 5, iv: 0 })]));
    const soloPaid = alone.battle.events.find((one) => one.t === "exp") as { amount: number };

    const ours = team(6);
    let crowd = bout(ours, [creature("caterpie", { uid: 9, level: 5, iv: 0 })]);
    // Everybody takes a turn out.
    for (let at = 1; at < 6; at++) {
      crowd = resolveTurn(crowd, [{ t: "switch", partyIndex: at }, { t: "fight", moveIndex: 0 }], WILD_RULES).battle;
    }
    expect(crowd.sharing.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);

    const shared = finish(crowd);
    const each = shared.battle.events.filter((one) => one.t === "exp") as { amount: number }[];
    expect(each).toHaveLength(6);
    for (const one of each) {
      expect(one.amount).toBeGreaterThan(0);
      expect(one.amount).toBeLessThan(soloPaid.amount);
    }
    // Roughly a sixth each, allowing for the floor and the never-zero rule.
    expect(each[0].amount).toBeLessThanOrEqual(Math.ceil(soloPaid.amount / 6));
  });

  it("X74: effort is not split — it is a lesson, not a prize", () => {
    // Two creatures that both fought a Machop have both been hit by a Machop.
    // This is also what the games do.
    const ours = team(2);
    let state = bout(ours, [creature("machop", { uid: 9, level: 5, iv: 0 })]);
    state = resolveTurn(state, [{ t: "switch", partyIndex: 1 }, { t: "fight", moveIndex: 0 }], WILD_RULES).battle;

    const done = finish(state);
    const efforts = done.battle.events.filter((one) => one.t === "effort") as { amount: number }[];
    expect(efforts).toHaveLength(2);
    // The same amount each, rather than half apiece.
    expect(efforts[0].amount).toBe(efforts[1].amount);
  });

  it("X75: a participant that has fainted since is not paid, and not counted in the split", () => {
    // Experience goes to creatures that can use it. A fainted one levelling up
    // in a battle it is out of would be strange, and the games do not do it.
    const ours = team(2);
    let state = bout(ours, [creature("caterpie", { uid: 9, level: 3, iv: 0 })]);
    state = resolveTurn(state, [{ t: "switch", partyIndex: 1 }, { t: "fight", moveIndex: 0 }], WILD_RULES).battle;
    expect(state.sharing.sort()).toEqual([0, 1]);

    // The first one is knocked out while sitting on the bench.
    const wounded: BattleState = {
      ...state,
      sides: [
        {
          ...state.sides[0],
          team: state.sides[0].team.map((one, at) => (at === 0 ? { ...one, hp: 0 } : one)),
        },
        state.sides[1],
      ],
    };
    const benchedExp = wounded.sides[0].team[0].exp;

    const done = finish(wounded);
    const paid = done.battle.events.filter((one) => one.t === "exp") as { uid: number; amount: number }[];
    expect(paid.map((one) => one.uid)).toEqual([2]);
    expect(done.battle.sides[0].team[0].exp).toBe(benchedExp);

    // And the one still standing takes the whole of it, not half.
    const alone = finish(bout(team(1), [creature("caterpie", { uid: 9, level: 3, iv: 0 })]));
    const solo = alone.battle.events.find((one) => one.t === "exp") as { amount: number };
    expect(paid[0].amount).toBe(solo.amount);
  });

  it("X77: a lead that goes down taking the other one with it earns nothing", () => {
    // Self-Destruct into a creature on its last point: both faint in the same
    // turn, and the one that fainted is not paid for it.
    const ours = [
      creature("machop", { uid: 1, level: 30, moves: ["selfdestruct"] }),
      creature("machop", { uid: 2, level: 30, moves: ["tackle"] }),
    ];
    const state = bout(ours, [creature("caterpie", { uid: 9, level: 3, iv: 0 })]);
    const onePoint: BattleState = {
      ...state,
      sides: [state.sides[0], { ...state.sides[1], team: state.sides[1].team.map((one) => ({ ...one, hp: 1 })) }],
    };

    const done = resolveTurn(onePoint, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], WILD_RULES);
    expect(done.battle.sides[0].team[0].hp).toBe(0);
    expect(done.battle.sides[1].team[0].hp).toBe(0);
    expect(done.battle.events.filter((one) => one.t === "exp")).toHaveLength(0);
    expect(done.battle.sides[0].team[0].exp).toBe(state.sides[0].team[0].exp);
  });

  it("X76: who is owed is part of the battle hash", () => {
    // Two peers that disagreed about this would agree about the whole battle
    // right up until something fainted, which is the worst moment to find out.
    const state = bout(team(2), [creature("caterpie", { uid: 9, level: 3, iv: 0 })]);
    expect(battleHash({ ...state, sharing: [0, 1] })).not.toBe(battleHash(state));
  });
});
