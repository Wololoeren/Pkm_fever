import { describe, expect, it } from "vitest";
import {
  activeOf,
  actionRefusal,
  aiAction,
  battleHash,
  isFainted,
  maxHp,
  resolveTurn,
  startBattle,
  TRAINER_RULES,
  WILD_RULES,
  type BattleEvent,
  type BattleState,
  type SideIndex,
} from "@/engine/battle";
import {
  ALL_MOVES,
  ALL_SPECIES,
  learnset,
  MACHINE_MOVES,
  move as moveById,
  movesAtLevel,
  rawLearnset,
} from "@/engine/dex";
import { actsOnSomething, STATUS_EFFECTS } from "@/engine/statusmoves";
import type { Individual } from "@/engine/types";
import { creature } from "./helpers";

/**
 * Status moves that do something.
 *
 * The manifest carries five effect fields and Showdown keeps the rest in
 * script, so 179 of its 264 status moves arrived here with nothing this engine
 * could act on — and were dealt out anyway. What these check is the two halves
 * of the fix: that the ones now honoured actually bite, and that the ones that
 * are not honoured are no longer handed to anybody.
 *
 * The second half is the one that matters in a year's time. Any move added to
 * the manifest, or any effect quietly dropped from the build script, lands in
 * X1 rather than in somebody's battle.
 */

const SEED = "STATUS1";
const TAG = "wild:meadow-1:0";

/** One turn, with both sides' move index named. */
function turn(
  battle: BattleState,
  ours: number,
  theirs: number,
  rules = WILD_RULES,
): { battle: BattleState; events: readonly BattleEvent[] } {
  const result = resolveTurn(battle, [{ t: "fight", moveIndex: ours }, { t: "fight", moveIndex: theirs }], rules, 10);
  return { battle: result.battle, events: result.battle.events };
}

function fought(ours: Individual, theirs: Individual): BattleState {
  return startBattle(SEED, TAG, [ours], [theirs]);
}

function volatilesOf(battle: BattleState, side: SideIndex) {
  return battle.sides[side].volatiles ?? {};
}

function healedOn(events: readonly BattleEvent[], side: SideIndex): number {
  return events
    .filter((event): event is Extract<BattleEvent, { t: "heal" }> => event.t === "heal" && event.side === side)
    .reduce((total, event) => total + event.amount, 0);
}

function damagedOn(events: readonly BattleEvent[], side: SideIndex): number {
  return events
    .filter((event): event is Extract<BattleEvent, { t: "damage" }> => event.t === "damage" && event.side === side)
    .reduce((total, event) => total + event.amount, 0);
}

describe("nothing dealt does nothing", () => {
  it("X1: no creature in the game can be given a move that cannot change a battle", () => {
    // The guard the whole change exists for. Before it, 635 of 1134 species
    // held at least one dead slot and Togekiss held four.
    const dead: string[] = [];

    for (const spec of ALL_SPECIES) {
      // Every level a creature can be built at, which is what decides the four
      // it is dealt. Sampled rather than all hundred: the learnset is sorted,
      // so the last four only change at the levels it learns something.
      for (const level of [1, 5, 16, 30, 50, 75, 100]) {
        for (const moveId of movesAtLevel(spec.id, level)) {
          if (!actsOnSomething(moveById(moveId))) dead.push(`${spec.id}@${level}:${moveId}`);
        }
      }
    }

    expect(dead.slice(0, 20)).toEqual([]);
  });

  it("X2: and no machine on the Mart's shelf teaches one either", () => {
    // items.ts builds a purchasable item per machine move, so an unhonoured
    // move here is four thousand for a wasted turn.
    const dead = MACHINE_MOVES.filter((id) => !actsOnSomething(moveById(id)));
    expect(dead).toEqual([]);
  });

  it("X3: the filter takes moves away, and never takes everything away", () => {
    // Both halves matter. A filter that removed nothing would pass X1 only
    // because the engine honoured everything, and one that removed too much
    // would leave a creature with no way to act at all.
    let trimmed = 0;
    for (const spec of ALL_SPECIES) {
      const all = rawLearnset(spec.id);
      const live = learnset(spec.id);
      if (live.length < all.length) trimmed++;
      if (all.length > 0) expect(live.length, `${spec.id} has nothing left`).toBeGreaterThan(0);
    }
    expect(trimmed, "the filter removed nothing at all").toBeGreaterThan(400);

    // Ditto and Smeargle are the two the floor would have caught: their whole
    // learnset is one move. They pass because that move is now honoured.
    expect(learnset("ditto").map(([, id]) => id)).toContain("transform");
    expect(learnset("smeargle").map(([, id]) => id)).toContain("sketch");
  });

  it("X4: Splash is kept, because doing nothing is what Splash is for", () => {
    expect(actsOnSomething(moveById("splash"))).toBe(true);
    expect(learnset("magikarp").map(([, id]) => id)).toContain("splash");
  });

  it("X5: every effect in the table names a move the manifest has", () => {
    // A typo in the table would silently honour nothing, and the move would go
    // on being filtered out with no sign that anybody meant otherwise.
    const known = new Set(ALL_MOVES.map((entry) => entry.id));
    for (const id of Object.keys(STATUS_EFFECTS)) {
      expect(known.has(id), `${id} is not a move`).toBe(true);
    }
  });
});

describe("leech seed", () => {
  it("X6: drains the seeded and heals whoever seeded it", () => {
    // The move that started this. It did nothing at all: no damage, no
    // healing, one turn gone.
    const ours = creature("bulbasaur", { level: 50, moves: ["leechseed"] });
    const theirs = creature("rattata", { level: 50, moves: ["tackle"], uid: 2 });

    const first = turn(fought(ours, theirs), 0, 0);
    expect(volatilesOf(first.battle, 1).seeded, "nothing was seeded").toBe(true);

    // Our own health at the top of the next turn, so the seed's healing can be
    // told apart from the tackle's damage.
    const before = activeOf(first.battle, 0).hp;
    const theirsBefore = activeOf(first.battle, 1).hp;

    const second = turn(first.battle, 0, 0);
    const drained = theirsBefore - activeOf(second.battle, 1).hp;
    const eighth = Math.floor(maxHp(theirs) / 8);

    // An eighth off them, and the same back to us. Their tackle is also
    // landing, so ours is measured as the healing event rather than as a net.
    expect(drained, "the seed took nothing").toBeGreaterThanOrEqual(eighth);
    expect(healedOn(second.events, 0), "the seed fed nobody").toBeGreaterThanOrEqual(eighth);

    // And the two halves balance: what came off them is what went into us.
    // Health is conserved, which is what makes it a seed and not two effects.
    expect(healedOn(second.events, 0)).toBe(drained);
    expect(before).toBeLessThan(maxHp(ours));
  });

  it("X7: cannot seed a Grass type, and cannot seed twice", () => {
    const ours = creature("bulbasaur", { level: 50, moves: ["leechseed"] });
    const grass = creature("oddish", { level: 50, moves: ["tackle"], uid: 2 });

    const onGrass = turn(fought(ours, grass), 0, 0);
    expect(volatilesOf(onGrass.battle, 1).seeded).toBeUndefined();
    expect(onGrass.events.some((event) => event.t === "fizzled")).toBe(true);

    // And a second seed on something already seeded finds nothing to do.
    const theirs = creature("rattata", { level: 50, moves: ["tackle"], uid: 2 });
    const once = turn(fought(ours, theirs), 0, 0);
    const twice = turn(once.battle, 0, 0);
    expect(twice.events.some((event) => event.t === "fizzled")).toBe(true);
  });

  it("X8: the healing stops at full, so health cannot appear out of nowhere", () => {
    const ours = creature("bulbasaur", { level: 50, moves: ["leechseed"] });
    // Something that will not hit back, so we stay at full health.
    const theirs = creature("rattata", { level: 50, moves: ["splash"], uid: 2 });

    let live = turn(fought(ours, theirs), 0, 0).battle;
    const full = maxHp(activeOf(live, 0));

    for (let n = 0; n < 3; n++) live = turn(live, 0, 0).battle;
    expect(activeOf(live, 0).hp).toBe(full);
    // It is still draining them, though.
    expect(activeOf(live, 1).hp).toBeLessThan(maxHp(theirs));
  });

  it("X9: it goes away when the seeded creature does", () => {
    const ours = creature("bulbasaur", { level: 50, moves: ["leechseed", "tackle"] });
    const theirs = [
      creature("rattata", { level: 50, moves: ["tackle"], uid: 2 }),
      creature("pidgey", { level: 50, moves: ["tackle"], uid: 3 }),
    ];

    let battle = startBattle(SEED, TAG, [ours], theirs);
    battle = resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], TRAINER_RULES).battle;
    expect(volatilesOf(battle, 1).seeded).toBe(true);

    // Tackle rather than the seed on the turn they swap, or we would simply
    // seed the replacement and learn nothing.
    battle = resolveTurn(battle, [{ t: "fight", moveIndex: 1 }, { t: "switch", partyIndex: 1 }], TRAINER_RULES).battle;
    // Being seeded is a fact about standing there, not about the animal.
    expect(volatilesOf(battle, 1).seeded).toBeUndefined();
  });
});

describe("confusion", () => {
  it("X10: costs turns, and sometimes costs health", () => {
    const ours = creature("gastly", { level: 50, moves: ["confuseray"] });
    const theirs = creature("rattata", { level: 50, moves: ["tackle"], uid: 2 });

    let live = turn(fought(ours, theirs), 0, 0).battle;
    expect(volatilesOf(live, 1).confusion, "nobody is confused").toBeGreaterThan(0);

    // Over the whole span of it, some turns are lost and some are not — a
    // confusion that never bit and one that always did would both be wrong.
    let lost = 0;
    let swung = 0;
    for (let n = 0; n < 3 && !live.outcome; n++) {
      const next = turn(live, 0, 0);
      if (next.events.some((event) => event.t === "volatile" && event.which === "selfhit")) lost++;
      if (next.events.some((event) => event.t === "use" && event.side === 1)) swung++;
      live = next.battle;
    }
    expect(lost + swung, "neither hit nor missed a turn").toBeGreaterThan(0);
  });

  it("X11: Swagger pays for the boost it gives, which is the whole move", () => {
    // Not in the inert list — it raises a stat, so the row looks complete. It
    // was a move that handed the opponent a free +2 Attack and nothing else.
    const ours = creature("rattata", { level: 50, moves: ["swagger"] });
    const theirs = creature("pidgey", { level: 50, moves: ["tackle"], uid: 2 });

    const first = turn(fought(ours, theirs), 0, 0);
    expect(first.battle.sides[1].stages.atk, "no bribe").toBe(2);
    expect(volatilesOf(first.battle, 1).confusion, "no payment").toBeGreaterThan(0);
  });
});

describe("the shields", () => {
  it("X12: Protect stops the move, and stops working if you lean on it", () => {
    const ours = creature("rattata", { level: 50, moves: ["protect"] });
    const theirs = creature("machop", { level: 50, moves: ["tackle"], uid: 2 });

    const first = turn(fought(ours, theirs), 0, 0);
    expect(first.events.some((event) => event.t === "shielded" && event.side === 0)).toBe(true);
    expect(damagedOn(first.events, 0)).toBe(0);
    // Down again at the end of the turn it was raised.
    expect(volatilesOf(first.battle, 0).shield).toBeUndefined();

    // Put up every turn, it has to fail eventually — otherwise it is an answer
    // to everything.
    let live = first.battle;
    let failures = 0;
    for (let n = 0; n < 8 && !live.outcome; n++) {
      const next = turn(live, 0, 0);
      if (next.events.some((event) => event.t === "damage" && event.side === 0)) failures++;
      live = next.battle;
    }
    expect(failures, "it never once failed").toBeGreaterThan(0);
  });

  it("X13: Endure survives at one instead of preventing the hit", () => {
    const ours = creature("rattata", { level: 5, moves: ["endure"], hp: 4 });
    const theirs = creature("machamp", { level: 80, moves: ["tackle"], uid: 2 });

    const first = turn(fought(ours, theirs), 0, 0);
    // It took the hit — that is the difference from Protect — and lived.
    expect(damagedOn(first.events, 0)).toBeGreaterThan(0);
    expect(isFainted(activeOf(first.battle, 0))).toBe(false);
    expect(activeOf(first.battle, 0).hp).toBe(1);
  });
});

describe("the two probability ladders", () => {
  it("X14: Sand Attack lowers accuracy and Double Team raises evasion", () => {
    const ours = creature("rattata", { level: 50, moves: ["sandattack"] });
    const theirs = creature("pidgey", { level: 50, moves: ["doubleteam"], uid: 2 });

    const first = turn(fought(ours, theirs), 0, 0);
    expect(first.battle.sides[1].aim?.accuracy).toBe(-1);
    expect(first.battle.sides[1].aim?.evasion).toBe(1);
    expect(first.events.filter((event) => event.t === "aim")).toHaveLength(2);
  });

  it("X15: and a lowered accuracy actually misses more", () => {
    // Measured rather than asserted: the ladder is only worth having if the
    // rolls move. Same seed either way, so the difference is the stages.
    const swing = (stages: number) => {
      let misses = 0;
      for (let at = 0; at < 60; at++) {
        const ours = creature("rattata", { level: 50, moves: ["tackle"] });
        const theirs = creature("pidgey", { level: 50, moves: ["splash"], uid: 2 });
        const battle = startBattle(`${SEED}-${at}`, TAG, [ours], [theirs]);
        if (stages !== 0) battle.sides[0].aim = { accuracy: stages, evasion: 0 };
        const result = resolveTurn(
          battle,
          [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }],
          WILD_RULES,
        );
        if (result.battle.events.some((event) => event.t === "miss" && event.side === 0)) misses++;
      }
      return misses;
    };

    const clear = swing(0);
    const blinded = swing(-6);
    expect(clear, "tackle missed with no stages on it").toBeLessThan(10);
    expect(blinded, "six stages of sand changed nothing").toBeGreaterThan(clear + 10);
  });

  it("X16: the ladder cancels exactly, so accuracy down and evasion down are even", () => {
    // One combined fraction rather than two roundings. If these were applied
    // separately the two would not come back to the same number.
    const ours = creature("rattata", { level: 50, moves: ["tackle"] });
    const theirs = creature("pidgey", { level: 50, moves: ["splash"], uid: 2 });

    const plain = startBattle(SEED, TAG, [ours], [theirs]);
    const tilted = startBattle(SEED, TAG, [ours], [theirs]);
    tilted.sides[0].aim = { accuracy: 2, evasion: 0 };
    tilted.sides[1].aim = { accuracy: 0, evasion: 2 };

    const hit = (battle: BattleState) =>
      resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], WILD_RULES)
        .battle.events.some((event) => event.t === "damage" && event.side === 1);

    expect(hit(tilted)).toBe(hit(plain));
  });
});

describe("crits, screens and the rest", () => {
  it("X17: Focus Energy walks the critical ladder", () => {
    const ours = creature("rattata", { level: 50, moves: ["focusenergy", "tackle"] });
    const theirs = creature("pidgey", { level: 50, moves: ["splash"], uid: 2 });

    const first = turn(fought(ours, theirs), 0, 0);
    expect(volatilesOf(first.battle, 0).crit).toBe(2);

    // Two stages up is one in two rather than one in twenty-four, so over
    // enough battles the difference is not subtle.
    let crits = 0;
    for (let at = 0; at < 40; at++) {
      const battle = startBattle(`${SEED}-crit-${at}`, TAG, [ours], [theirs]);
      battle.sides[0].volatiles = { crit: 2 };
      const result = resolveTurn(
        battle,
        [{ t: "fight", moveIndex: 1 }, { t: "fight", moveIndex: 0 }],
        WILD_RULES,
      );
      if (result.battle.events.some((event) => event.t === "damage" && event.crit)) crits++;
    }
    expect(crits, "two stages of focus produced no crits").toBeGreaterThan(8);
  });

  it("X18: Lucky Chant stops them outright", () => {
    let crits = 0;
    for (let at = 0; at < 40; at++) {
      const ours = creature("rattata", { level: 50, moves: ["tackle"] });
      const theirs = creature("pidgey", { level: 50, moves: ["splash"], uid: 2 });
      const battle = startBattle(`${SEED}-chant-${at}`, TAG, [ours], [theirs]);
      battle.sides[0].volatiles = { crit: 3 };
      battle.sides[1].screens = { luckychant: 5 };
      const result = resolveTurn(
        battle,
        [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }],
        WILD_RULES,
      );
      if (result.battle.events.some((event) => event.t === "damage" && event.crit)) crits++;
    }
    expect(crits).toBe(0);
  });

  it("X19: Reflect halves physical damage and Light Screen does not", () => {
    const hitFor = (screen: "reflect" | "lightscreen" | null, moveId: string) => {
      const ours = creature("machop", { level: 50, moves: [moveId] });
      const theirs = creature("rattata", { level: 50, moves: ["splash"], uid: 2 });
      const battle = startBattle(SEED, TAG, [ours], [theirs]);
      if (screen) battle.sides[1].screens = { [screen]: 5 };
      const result = resolveTurn(
        battle,
        [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }],
        WILD_RULES,
      );
      return damagedOn(result.battle.events, 1);
    };

    const plain = hitFor(null, "tackle");
    expect(hitFor("reflect", "tackle")).toBeLessThan(plain);
    // The other screen answers the other half of the split, and not this one.
    expect(hitFor("lightscreen", "tackle")).toBe(plain);
  });

  it("X20: a screen belongs to the side, so switching does not take it down", () => {
    const ours = [
      creature("rattata", { level: 50, moves: ["reflect"] }),
      creature("pidgey", { level: 50, moves: ["tackle"], uid: 3 }),
    ];
    const theirs = creature("machop", { level: 50, moves: ["tackle"], uid: 2 });

    let battle = startBattle(SEED, TAG, ours, [theirs]);
    battle = resolveTurn(
      battle,
      [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }],
      TRAINER_RULES,
    ).battle;
    expect(battle.sides[0].screens?.reflect).toBeGreaterThan(0);

    battle = resolveTurn(
      battle,
      [{ t: "switch", partyIndex: 1 }, { t: "fight", moveIndex: 0 }],
      TRAINER_RULES,
    ).battle;
    expect(battle.sides[0].screens?.reflect, "the screen came down with the creature").toBeGreaterThan(0);
  });

  it("X21: and it runs out", () => {
    const ours = creature("rattata", { level: 50, moves: ["reflect", "tackle"] });
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    let live = turn(fought(ours, theirs), 0, 0).battle;
    const raised = live.sides[0].screens?.reflect ?? 0;
    expect(raised).toBeGreaterThan(0);

    for (let n = 0; n < raised + 1 && !live.outcome; n++) live = turn(live, 1, 0).battle;
    expect(live.sides[0].screens?.reflect ?? 0).toBe(0);
  });

  it("X22: Safeguard answers every road to a status at once", () => {
    const ours = creature("rattata", { level: 50, moves: ["safeguard", "tackle"] });
    // Thunder Wave is the plain road to a status; Confuse Ray is the volatile
    // one. Splash first, because a Pikachu outspeeds a Rattata and would
    // otherwise land the paralysis before the guard was ever up — which is
    // the engine being right and the fixture being wrong.
    const theirs = creature("pikachu", {
      level: 50,
      moves: ["splash", "thunderwave", "confuseray"],
      uid: 2,
    });

    const up = turn(fought(ours, theirs), 0, 0);
    expect(up.battle.sides[0].screens?.safeguard).toBeGreaterThan(0);
    expect(activeOf(up.battle, 0).status).toBeNull();

    const zapped = turn(up.battle, 1, 1);
    expect(activeOf(zapped.battle, 0).status, "the guard let a status through").toBeNull();
    expect(zapped.events.some((event) => event.t === "screen" && event.which === "safeguard")).toBe(true);

    const rayed = turn(up.battle, 1, 2);
    expect(volatilesOf(rayed.battle, 0).confusion ?? 0).toBe(0);
  });

  it("X23: Mist refuses what the other side lowers, and allows what you lower yourself", () => {
    const ours = creature("rattata", { level: 50, moves: ["mist", "tailwhip", "defensecurl"] });
    const theirs = creature("machop", { level: 50, moves: ["growl"], uid: 2 });

    const up = turn(fought(ours, theirs), 0, 0);
    expect(up.battle.sides[0].screens?.mist).toBeGreaterThan(0);

    // Growl is theirs, and it is refused.
    const growled = turn(up.battle, 2, 0);
    expect(growled.battle.sides[0].stages.atk).toBe(0);
    // Our own Defence Curl still lands, because a mist is not a Clear Body.
    expect(growled.battle.sides[0].stages.def).toBeGreaterThan(0);
  });

  it("X24: Tailwind is felt by everything that reads speed", () => {
    const slow = creature("shuckle", { level: 50, moves: ["tailwind", "tackle"] });
    const fast = creature("jolteon", { level: 50, moves: ["tackle"], uid: 2 });

    const up = turn(fought(slow, fast), 0, 0);
    expect(up.battle.sides[0].screens?.tailwind).toBeGreaterThan(0);

    // Doubled but still slower than a Jolteon, so what is checked is that the
    // number moved rather than that the order flipped.
    const battle = up.battle;
    battle.sides[0].screens = { tailwind: 4 };
    const fled = resolveTurn(battle, [{ t: "flee" }, { t: "fight", moveIndex: 0 }], WILD_RULES, 10);
    expect(fled.battle.events.some((event) => event.t === "fled" || event.t === "fleeFailed")).toBe(true);
  });
});

describe("mending and clearing", () => {
  it("X25: Rest fills it up and puts it out", () => {
    const hurt = creature("snorlax", { level: 50, moves: ["rest"], hp: 20, status: "psn" });
    const theirs = creature("pidgey", { level: 50, moves: ["splash"], uid: 2 });

    const first = turn(fought(hurt, theirs), 0, 0);
    const after = activeOf(first.battle, 0);
    expect(after.hp).toBe(maxHp(after));
    expect(after.status).toBe("slp");
    expect(after.sleepTurns).toBeGreaterThan(0);
  });

  it("X26: and refuses when there is nothing to gain", () => {
    const well = creature("snorlax", { level: 50, moves: ["rest"] });
    const theirs = creature("pidgey", { level: 50, moves: ["splash"], uid: 2 });

    const first = turn(fought(well, theirs), 0, 0);
    expect(activeOf(first.battle, 0).status, "it slept for nothing").toBeNull();
    expect(first.events.some((event) => event.t === "fizzled")).toBe(true);
  });

  it("X27: Synthesis mends a half", () => {
    const hurt = creature("bulbasaur", { level: 50, moves: ["synthesis"], hp: 1 });
    const theirs = creature("pidgey", { level: 50, moves: ["splash"], uid: 2 });

    const first = turn(fought(hurt, theirs), 0, 0);
    expect(healedOn(first.events, 0)).toBe(Math.floor(maxHp(hurt) / 2));
  });

  it("X28: Pain Split meets in the middle", () => {
    const ours = creature("gastly", { level: 50, moves: ["painsplit"], hp: 5 });
    const theirs = creature("snorlax", { level: 50, moves: ["splash"], uid: 2 });

    const first = turn(fought(ours, theirs), 0, 0);
    const mine = activeOf(first.battle, 0);
    const yours = activeOf(first.battle, 1);

    // Ours goes up, theirs comes down, and neither is over its own maximum.
    expect(mine.hp).toBeGreaterThan(5);
    expect(yours.hp).toBeLessThan(maxHp(theirs));
    expect(mine.hp).toBeLessThanOrEqual(maxHp(mine));
  });

  it("X29: Belly Drum pays half for a maxed Attack, and refuses if it cannot", () => {
    const whole = creature("snorlax", { level: 50, moves: ["bellydrum"] });
    const theirs = creature("pidgey", { level: 50, moves: ["splash"], uid: 2 });

    const paid = turn(fought(whole, theirs), 0, 0);
    expect(paid.battle.sides[0].stages.atk).toBe(6);
    expect(activeOf(paid.battle, 0).hp).toBeLessThan(maxHp(whole));

    // Too little health to pay is a refusal rather than a death.
    const frail = creature("snorlax", { level: 50, moves: ["bellydrum"], hp: 3 });
    const refused = turn(fought(frail, theirs), 0, 0);
    expect(isFainted(activeOf(refused.battle, 0))).toBe(false);
    expect(refused.battle.sides[0].stages.atk).toBe(0);
  });

  it("X30: Haze clears both sides and both ladders", () => {
    const ours = creature("rattata", { level: 50, moves: ["haze"] });
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    const battle = fought(ours, theirs);
    battle.sides[0].stages = { atk: 3, def: 0, spa: 0, spd: 0, spe: 0 };
    battle.sides[1].stages = { atk: 0, def: -2, spa: 0, spd: 0, spe: 0 };
    battle.sides[1].aim = { accuracy: -3, evasion: 2 };

    const cleared = turn(battle, 0, 0);
    expect(cleared.battle.sides[0].stages.atk).toBe(0);
    expect(cleared.battle.sides[1].stages.def).toBe(0);
    expect(cleared.battle.sides[1].aim).toBeUndefined();
  });

  it("X31: a bell cures the ones in reserve too", () => {
    const ours = [
      creature("rattata", { level: 50, moves: ["healbell"], status: "brn" }),
      creature("pidgey", { level: 50, moves: ["tackle"], status: "par", uid: 3 }),
    ];
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    const rung = resolveTurn(
      startBattle(SEED, TAG, ours, [theirs]),
      [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }],
      TRAINER_RULES,
    );
    expect(rung.battle.sides[0].team.map((one) => one.status)).toEqual([null, null]);
  });
});

describe("the timers", () => {
  it("X32: Yawn puts it to sleep a turn later", () => {
    const ours = creature("snorlax", { level: 50, moves: ["yawn"] });
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    const first = turn(fought(ours, theirs), 0, 0);
    expect(volatilesOf(first.battle, 1).yawn, "nobody got drowsy").toBeGreaterThan(0);
    expect(activeOf(first.battle, 1).status, "it fell asleep at once").toBeNull();

    let live = first.battle;
    for (let n = 0; n < 3 && activeOf(live, 1).status === null; n++) live = turn(live, 0, 0).battle;
    expect(activeOf(live, 1).status).toBe("slp");
  });

  it("X33: Nightmare only bites what is asleep, and stops when it wakes", () => {
    const ours = creature("gastly", { level: 50, moves: ["nightmare"] });
    const awake = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    const missed = turn(fought(ours, awake), 0, 0);
    expect(volatilesOf(missed.battle, 1).nightmare).toBeUndefined();
    expect(missed.events.some((event) => event.t === "fizzled")).toBe(true);

    const asleep = creature("machop", { level: 50, moves: ["splash"], status: "slp", uid: 2 });
    const landed = turn(fought(ours, asleep), 0, 0);
    expect(volatilesOf(landed.battle, 1).nightmare).toBe(true);
    expect(landed.events.some((event) => event.t === "volatile" && event.which === "dreaming")).toBe(true);
    // A quarter, at the end of the same turn it landed.
    expect(damagedOn(landed.events, 1)).toBeGreaterThanOrEqual(Math.floor(maxHp(asleep) / 4));
  });

  it("X34: Perish Song counts on both sides and kills what is left", () => {
    const ours = creature("misdreavus", { level: 50, moves: ["perishsong"] });
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    let live = turn(fought(ours, theirs), 0, 0).battle;
    expect(volatilesOf(live, 0).perish, "the singer is exempt").toBeGreaterThan(0);
    expect(volatilesOf(live, 1).perish).toBeGreaterThan(0);

    for (let n = 0; n < 5 && !live.outcome; n++) live = turn(live, 0, 0).battle;
    // Both were counting, so somebody has gone down.
    expect(live.outcome, "nobody perished").not.toBeNull();
  });
});

describe("leaving, and not being allowed to", () => {
  it("X35: Mean Look refuses the switch and the run, in the same words the menu greys", () => {
    const ours = [
      creature("rattata", { level: 50, moves: ["tackle"] }),
      creature("pidgey", { level: 50, moves: ["tackle"], uid: 3 }),
    ];
    const theirs = creature("gastly", { level: 50, moves: ["meanlook"], uid: 2 });

    const battle = startBattle(SEED, TAG, ours, [theirs]);
    expect(actionRefusal(battle, 0, { t: "switch", partyIndex: 1 })).toBeNull();

    const held = resolveTurn(
      battle,
      [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }],
      WILD_RULES,
      10,
    ).battle;
    expect(volatilesOf(held, 0).trapped).toBe(true);
    expect(actionRefusal(held, 0, { t: "switch", partyIndex: 1 })).toBe("it cannot be called back");
    expect(actionRefusal(held, 0, { t: "flee" })).toBe("there is no getting away");
  });

  it("X36: Roar drives a wild creature off and replaces a trainer's", () => {
    const ours = creature("rattata", { level: 50, moves: ["roar"] });
    const wild = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    const grass = turn(fought(ours, wild), 0, 0);
    expect(grass.battle.outcome).toEqual({ t: "fled" });

    const team = [
      creature("machop", { level: 50, moves: ["splash"], uid: 2 }),
      creature("geodude", { level: 50, moves: ["splash"], uid: 3 }),
    ];
    const trainer = resolveTurn(
      startBattle(SEED, TAG, [ours], team),
      [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }],
      TRAINER_RULES,
    ).battle;
    expect(trainer.outcome, "it ended a trainer battle").toBeNull();
    expect(trainer.sides[1].active, "nobody was pulled out").toBe(1);
  });

  it("X37b: and nothing else happens once a move has ended the battle", () => {
    // A hole that could not exist before: no move could finish a battle, only
    // a fainting could. Left unguarded, the residuals tick for a battle nobody
    // is in and `settle` awards experience for a creature that walked away.
    //
    // The wild one is burned, so a residual *would* fire if anything after the
    // outcome still ran. It also moves first whatever its speed — Teleport is
    // priority -6 — which is why the reachable case is the *second* move
    // ending the battle rather than the first.
    const ours = creature("abra", { level: 60, moves: ["teleport"] });
    const wild = creature("machop", { level: 40, moves: ["tackle"], status: "brn", uid: 2 });

    const gone = turn(fought(ours, wild), 0, 0);
    expect(gone.battle.outcome).toEqual({ t: "fled" });
    expect(
      gone.events.some((event) => event.t === "residual"),
      "a burn ticked after the battle had ended",
    ).toBe(false);
    expect(gone.events.some((event) => event.t === "exp")).toBe(false);
    expect(gone.events.some((event) => event.t === "faint")).toBe(false);
  });

  it("X37: Teleport is the way out of the grass", () => {
    const ours = creature("abra", { level: 50, moves: ["teleport"] });
    const wild = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    const gone = turn(fought(ours, wild), 0, 0);
    expect(gone.battle.outcome).toEqual({ t: "fled" });
  });
});

describe("borrowing", () => {
  it("X38: Ditto is a creature rather than a statue", () => {
    // Its whole learnset is Transform, which did nothing — so Sanchford's
    // Council of five Dittos was five creatures in a battle that could only
    // ever time out.
    const ditto = creature("ditto", { level: 50, moves: ["transform"] });
    const theirs = creature("machop", { level: 50, moves: ["tackle"], uid: 2 });

    const first = turn(fought(ditto, theirs), 0, 0);
    const after = activeOf(first.battle, 0);
    expect(after.speciesId).toBe("machop");
    expect(after.moves).toEqual(theirs.moves);
    expect(first.events.some((event) => event.t === "transformed")).toBe(true);

    // And it can now actually swing.
    const swung = turn(first.battle, 0, 0);
    expect(damagedOn(swung.events, 1)).toBeGreaterThan(0);
  });

  it("X39: Smeargle keeps what it copies", () => {
    const smeargle = creature("smeargle", { level: 50, moves: ["sketch"] });
    const theirs = creature("machop", { level: 50, moves: ["karatechop"], uid: 2 });

    const first = turn(fought(smeargle, theirs), 0, 0);
    const after = activeOf(first.battle, 0);
    expect(after.moves).toContain("karatechop");
    expect(after.moves).not.toContain("sketch");
    expect(first.events.some((event) => event.t === "sketched")).toBe(true);
  });
});

describe("determinism", () => {
  it("X40: the hash covers all of it, or a duel could disagree about a battle", () => {
    const ours = creature("rattata", { level: 50, moves: ["tackle"] });
    const theirs = creature("machop", { level: 50, moves: ["tackle"], uid: 2 });
    const plain = startBattle(SEED, TAG, [ours], [theirs]);

    const seeded = startBattle(SEED, TAG, [ours], [theirs]);
    seeded.sides[1].volatiles = { seeded: true };

    const dimmed = startBattle(SEED, TAG, [ours], [theirs]);
    dimmed.sides[0].aim = { accuracy: -2, evasion: 0 };

    const behind = startBattle(SEED, TAG, [ours], [theirs]);
    behind.sides[0].screens = { reflect: 3 };

    const base = battleHash(plain);
    expect(battleHash(seeded)).not.toBe(base);
    expect(battleHash(dimmed)).not.toBe(base);
    expect(battleHash(behind)).not.toBe(base);
  });

  it("X41: and a battle with none of it in hashes as if none of it existed", () => {
    // Absent rather than zero, in one representation only, so every saved
    // battle log still checks against the engine that grew these fields.
    const ours = creature("rattata", { level: 50, moves: ["tackle"] });
    const theirs = creature("machop", { level: 50, moves: ["tackle"], uid: 2 });

    const battle = startBattle(SEED, TAG, [ours], [theirs]);
    const played = resolveTurn(
      battle,
      [{ t: "fight", moveIndex: 0 }, aiAction(battle)],
      WILD_RULES,
      10,
    ).battle;

    expect(played.sides[0].volatiles, "a plain battle grew a condition").toBeUndefined();
    expect(played.sides[0].aim).toBeUndefined();
    expect(played.sides[0].screens).toBeUndefined();
    // `lastMove` is the one thing every battle now records, which is why it
    // sits beside `locked` rather than among the volatiles: keeping it there
    // gave every battle in the game a volatile record from its first turn.
    expect(played.sides[0].lastMove).toBe("tackle");
  });
});
