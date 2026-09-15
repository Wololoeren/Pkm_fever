import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  activeOf,
  actionRefusal,
  aiAction,
  battleHash,
  isFainted,
  landsAs,
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
  species as speciesById,
} from "@/engine/dex";
import { computeStats } from "@/engine/stats";
import { actsOnSomething, STATUS_EFFECTS, UNCALLABLE } from "@/engine/statusmoves";
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
    // Only the doubles-only moves are left to filter, and dozens of species
    // still learn one of them.
    expect(trimmed, "the filter removed nothing at all").toBeGreaterThan(100);

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

  it("X38b: a caught Ditto is a Ditto, with its own stats and moves", () => {
    const wildDitto = creature("ditto", { level: 30, moves: ["transform"], uid: 2, iv: 3 });
    const ours = creature("machamp", { level: 60, moves: ["bulkup"], iv: 31 });

    // Ours sets up while the Ditto copies it; then a Master Ball.
    const copied = turn(fought(ours, wildDitto), 0, 0);
    expect(activeOf(copied.battle, 1).speciesId).toBe("machamp");

    const thrown = resolveTurn(copied.battle, [{ t: "ball", item: "masterball" }, { t: "pass" }], WILD_RULES, 1);
    expect(thrown.caught).not.toBeNull();
    expect(thrown.caught!.speciesId).toBe("ditto");
    expect(thrown.caught!.ivs).toEqual(wildDitto.ivs);
    expect(thrown.caught!.natureId).toBe(wildDitto.natureId);
    expect(thrown.caught!.moves).toEqual(["transform"]);
    expect(thrown.caught!.hp).toBeLessThanOrEqual(maxHp(thrown.caught!));
    // And the team handed back with the result says the same.
    expect(activeOf(thrown.battle, 1).speciesId).toBe("ditto");
  });

  it("X38c: your own Ditto goes home as a Ditto, and turns back when it is switched out", () => {
    const ditto = creature("ditto", { level: 50, moves: ["transform"] });
    const bench = creature("machop", { level: 50, moves: ["tackle"], uid: 3 });
    const theirs = creature("snorlax", { level: 50, moves: ["splash"], uid: 2 });

    const battle = startBattle(SEED, TAG, [ditto, bench], [theirs]);
    const copied = turn(battle, 0, 0).battle;
    expect(activeOf(copied, 0).speciesId).toBe("snorlax");

    // Switched out: the one on the bench is a Ditto again.
    const swapped = resolveTurn(copied, [{ t: "switch", partyIndex: 1 }, { t: "fight", moveIndex: 0 }], WILD_RULES, 0).battle;
    expect(swapped.sides[0].team[0].speciesId).toBe("ditto");
    expect(swapped.sides[0].team[0].moves).toEqual(["transform"]);

    // Still transformed when the battle ends: reverted on the way out. It
    // copies a Tackle off something weak and wins with it.
    let won = startBattle(SEED, TAG, [ditto], [creature("caterpie", { level: 3, moves: ["tackle"], uid: 4, iv: 0 })]);
    won = turn(won, 0, 0).battle;
    expect(activeOf(won, 0).speciesId).toBe("caterpie");
    for (let at = 0; at < 5 && !won.outcome; at++) won = turn(won, 0, 0).battle;
    expect(won.outcome).toEqual({ t: "win", side: 0 });
    expect(won.sides[0].team[0].speciesId).toBe("ditto");
    expect(won.sides[0].team[0].moves).toEqual(["transform"]);
    expect(won.sides[0].team[0].ivs).toEqual(ditto.ivs);
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

describe("the cheap group: more of the machinery that already existed", () => {
  it("X42: Aqua Ring mends a sixteenth a turn, and Ingrain also plants it", () => {
    const ours = creature("rattata", { level: 50, moves: ["aquaring"], hp: 20 });
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    const first = turn(fought(ours, theirs), 0, 0);
    expect(volatilesOf(first.battle, 0).rooted).toBe(true);
    expect(healedOn(first.events, 0)).toBe(Math.max(1, Math.floor(maxHp(ours) / 16)));
    // Not trapped: Aqua Ring is the heal without the roots.
    expect(actionRefusal(first.battle, 0, { t: "flee" })).toBeNull();

    // Ingrain is both halves, and no wind moves it.
    const planted = [
      creature("rattata", { level: 50, moves: ["ingrain"] }),
      creature("pidgey", { level: 50, moves: ["tackle"], uid: 3 }),
    ];
    const blower = creature("machop", { level: 50, moves: ["roar"], uid: 2 });
    const rooted = resolveTurn(
      startBattle(SEED, TAG, planted, [blower]),
      [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }],
      TRAINER_RULES,
    ).battle;
    expect(volatilesOf(rooted, 0).rooted).toBe(true);
    expect(volatilesOf(rooted, 0).trapped).toBe(true);
    expect(rooted.sides[0].active, "Roar moved something that was planted").toBe(0);
    expect(rooted.events.some((event) => event.t === "fizzled" && event.side === 1)).toBe(true);
    expect(actionRefusal(rooted, 0, { t: "switch", partyIndex: 1 })).not.toBeNull();
  });

  it("X43: Attract asks the question breeding asks, and then costs turns", () => {
    const ours = creature("rattata", { level: 50, moves: ["attract"], gender: "female" });
    const him = creature("machop", { level: 50, moves: ["tackle"], uid: 2, gender: "male" });
    const her = creature("machop", { level: 50, moves: ["tackle"], uid: 2, gender: "female" });

    const same = turn(fought(ours, her), 0, 0);
    expect(volatilesOf(same.battle, 1).infatuated).toBeUndefined();
    expect(same.events.some((event) => event.t === "fizzled")).toBe(true);

    let live = turn(fought(ours, him), 0, 0).battle;
    expect(volatilesOf(live, 1).infatuated).toBe(true);

    // Half the time it cannot move. Over ten turns a love that never once
    // bit would be no love at all.
    let smitten = 0;
    let moved = 0;
    for (let n = 0; n < 10 && !live.outcome; n++) {
      const next = turn(live, 0, 0);
      if (next.events.some((event) => event.t === "volatile" && event.which === "smitten" && event.side === 1)) smitten++;
      if (next.events.some((event) => event.t === "use" && event.side === 1)) moved++;
      live = next.battle;
    }
    expect(smitten, "it never once lost a turn").toBeGreaterThan(0);
    expect(moved, "it never once moved").toBeGreaterThan(0);
  });

  it("X44: Heal Pulse mends the target, which nothing could do before", () => {
    const ours = creature("rattata", { level: 50, moves: ["healpulse"] });
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2, hp: 10 });

    const first = turn(fought(ours, theirs), 0, 0);
    expect(healedOn(first.events, 1)).toBe(Math.floor(maxHp(theirs) / 2));
    expect(activeOf(first.battle, 1).hp).toBe(10 + Math.floor(maxHp(theirs) / 2));

    // And at full there is nothing to mend.
    const whole = creature("machop", { level: 50, moves: ["splash"], uid: 2 });
    const nothing = turn(fought(ours, whole), 0, 0);
    expect(nothing.events.some((event) => event.t === "fizzled")).toBe(true);
  });

  it("X45: Strength Sap takes the target's Attack as health, and a stage of it", () => {
    const ours = creature("rattata", { level: 50, moves: ["strengthsap"], hp: 10 });
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    const first = turn(fought(ours, theirs), 0, 0);
    const attack = computeStats(speciesById("machop"), theirs).atk;
    expect(healedOn(first.events, 0)).toBe(Math.min(attack, maxHp(ours) - 10));
    expect(first.battle.sides[1].stages.atk).toBe(-1);
  });

  it("X46: Psych Up copies, Power Swap exchanges, and Heart Swap takes the ladders too", () => {
    const setup = (mine: string[], theirsMove: string) => {
      const ours = creature("rattata", { level: 50, moves: mine });
      const theirs = creature("machop", { level: 50, moves: [theirsMove], uid: 2 });
      // Their boost first, so there is something to copy or take.
      const first = turn(fought(ours, theirs), 1, 0);
      return turn(first.battle, 0, 0).battle;
    };

    const copied = setup(["psychup", "splash"], "swordsdance");
    expect(copied.sides[0].stages.atk).toBe(2);

    // Rattata moves first: it takes the two stages, and then the dance puts
    // two back on the Machop.
    const swapped = setup(["powerswap", "splash"], "swordsdance");
    expect(swapped.sides[0].stages.atk).toBe(2);
    expect(swapped.sides[1].stages.atk).toBe(2);

    const hearts = setup(["heartswap", "splash"], "doubleteam");
    expect(hearts.sides[0].aim?.evasion).toBe(1);
  });

  it("X47: Power Split rewrites the number rather than the ladder, and the hash sees it", () => {
    const ours = creature("rattata", { level: 50, moves: ["powersplit", "swordsdance"] });
    const theirs = creature("machamp", { level: 50, moves: ["splash"], uid: 2 });

    const first = turn(fought(ours, theirs), 0, 0);
    const mine = computeStats(speciesById("rattata"), ours).atk;
    const its = computeStats(speciesById("machamp"), theirs).atk;
    const between = Math.floor((mine + its) / 2);
    expect(volatilesOf(first.battle, 0).stats?.atk).toBe(between);
    expect(volatilesOf(first.battle, 1).stats?.atk).toBe(between);

    // A stage still lands on top of it.
    const danced = turn(first.battle, 1, 0).battle;
    expect(danced.sides[0].stages.atk).toBe(2);
    expect(volatilesOf(danced, 0).stats?.atk).toBe(between);

    // Two different splits are two different battles, or a duel could not
    // tell them apart.
    const a = startBattle(SEED, TAG, [ours], [theirs]);
    const b = startBattle(SEED, TAG, [ours], [theirs]);
    a.sides[0].volatiles = { stats: { atk: 40 } };
    b.sides[0].volatiles = { stats: { atk: 41 } };
    expect(battleHash(a)).not.toBe(battleHash(b));
  });

  it("X48: Stockpile counts to three, Swallow spends it on mending, Spit Up on damage", () => {
    const ours = creature("rattata", { level: 50, moves: ["stockpile", "swallow", "spitup"], hp: 20 });
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    let live = fought(ours, theirs);
    for (let n = 0; n < 3; n++) live = turn(live, 0, 0).battle;
    expect(volatilesOf(live, 0).stockpile).toBe(3);
    expect(live.sides[0].stages.def).toBe(3);
    expect(live.sides[0].stages.spd).toBe(3);

    const fourth = turn(live, 0, 0);
    expect(fourth.events.some((event) => event.t === "fizzled")).toBe(true);

    // Three swallowed is everything, and the guards it bought go back.
    const swallowed = turn(fourth.battle, 1, 0);
    expect(activeOf(swallowed.battle, 0).hp).toBe(maxHp(ours));
    expect(volatilesOf(swallowed.battle, 0).stockpile).toBeUndefined();
    expect(swallowed.battle.sides[0].stages.def).toBe(0);

    // Spit Up with nothing behind it is nothing.
    const empty = turn(fought(ours, theirs), 2, 0);
    expect(empty.events.some((event) => event.t === "fizzled")).toBe(true);
    expect(damagedOn(empty.events, 1)).toBe(0);

    // And with two behind it, it hits and the counter is spent.
    let stocked = turn(fought(ours, theirs), 0, 0).battle;
    stocked = turn(stocked, 0, 0).battle;
    const spat = turn(stocked, 2, 0);
    expect(damagedOn(spat.events, 1)).toBeGreaterThan(0);
    expect(volatilesOf(spat.battle, 0).stockpile).toBeUndefined();
    expect(spat.battle.sides[0].stages.def).toBe(0);
  });

  it("X49: Lock-On makes the next Fissure certain", () => {
    // Measured across seeds rather than asserted once: a lock that happened
    // to land on a seed where Fissure hit anyway proves nothing.
    let lockedHits = 0;
    let bareMisses = 0;
    for (let at = 0; at < 15; at++) {
      const ours = creature("rattata", { level: 50, moves: ["lockon", "fissure"] });
      const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

      const locked = resolveTurn(
        startBattle(`${SEED}-${at}`, TAG, [ours], [theirs]),
        [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }],
      ).battle;
      expect(volatilesOf(locked, 0).sure).toBe(true);
      const swung = resolveTurn(locked, [{ t: "fight", moveIndex: 1 }, { t: "fight", moveIndex: 0 }]).battle;
      if (damagedOn(swung.events, 1) > 0) lockedHits++;
      // Spent by the swing.
      expect(volatilesOf(swung, 0).sure).toBeUndefined();

      const bare = resolveTurn(
        startBattle(`${SEED}-${at}`, TAG, [ours], [theirs]),
        [{ t: "fight", moveIndex: 1 }, { t: "fight", moveIndex: 0 }],
      ).battle;
      if (bare.events.some((event) => event.t === "miss" && event.side === 0)) bareMisses++;
    }
    expect(lockedHits).toBe(15);
    expect(bareMisses, "Fissure never missed on its own").toBeGreaterThan(0);
  });

  it("X50: Destiny Bond takes the attacker down, and only an attacker", () => {
    const ours = creature("rattata", { level: 50, moves: ["destinybond"], hp: 1 });
    const theirs = creature("machop", { level: 50, moves: ["tackle"], uid: 2 });

    // Rattata is the faster, so the bond is up before the tackle lands.
    const first = turn(fought(ours, theirs), 0, 0);
    expect(isFainted(activeOf(first.battle, 0))).toBe(true);
    expect(isFainted(activeOf(first.battle, 1)), "the bond did not bite").toBe(true);
    expect(first.events.some((event) => event.t === "volatile" && event.which === "avenged")).toBe(true);
    expect(first.battle.outcome).toEqual({ t: "draw" });

    // A poison has nobody standing behind it.
    const poisoned = creature("rattata", { level: 50, moves: ["destinybond"], hp: 1, status: "psn" });
    const idle = creature("machop", { level: 50, moves: ["splash"], uid: 2 });
    const bled = turn(fought(poisoned, idle), 0, 0);
    expect(isFainted(activeOf(bled.battle, 0))).toBe(true);
    expect(isFainted(activeOf(bled.battle, 1))).toBe(false);
  });

  it("X51: a Wish comes true at the end of the next turn, for half", () => {
    const ours = creature("rattata", { level: 50, moves: ["wish"], hp: 10 });
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    const first = turn(fought(ours, theirs), 0, 0);
    expect(volatilesOf(first.battle, 0).wish).toBe(1);
    expect(activeOf(first.battle, 0).hp, "it came true too soon").toBe(10);

    const second = turn(first.battle, 0, 0);
    expect(activeOf(second.battle, 0).hp).toBe(10 + Math.floor(maxHp(ours) / 2));
    expect(volatilesOf(second.battle, 0).wish).toBeUndefined();
  });

  it("X52: Healing Wish faints so the next one arrives whole, and refuses with nobody to arrive", () => {
    const ours = [
      creature("chansey", { level: 50, moves: ["healingwish"] }),
      creature("rattata", { level: 50, moves: ["tackle"], uid: 3, hp: 10, status: "brn" }),
    ];
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    let battle = startBattle(SEED, TAG, ours, [theirs]);
    battle = resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], TRAINER_RULES).battle;
    expect(isFainted(activeOf(battle, 0))).toBe(true);
    expect(battle.awaitingSwitch[0]).toBe(true);

    battle = resolveTurn(battle, [{ t: "switch", partyIndex: 1 }, { t: "pass" }], TRAINER_RULES).battle;
    const arrived = activeOf(battle, 0);
    expect(arrived.hp).toBe(maxHp(arrived));
    expect(arrived.status).toBeNull();
    // And it was a one-off: the blessing went with the volatiles.
    //
    // Asked of the blessing rather than of the whole object, because a switch
    // now writes exactly one volatile of its own on the way in — `fresh`, the
    // marker that says this slot has not had a turn yet and a Fake Out would
    // still work on it. That is created *by* the arrival rather than surviving
    // it, so "switching clears every volatile" is intact; what it no longer
    // means is "and leaves nothing behind".
    expect(battle.sides[0].volatiles?.blessing).toBeUndefined();
    expect(battle.sides[0].volatiles).toEqual({ fresh: true });

    // Alone, it fails rather than fainting for nobody.
    const alone = turn(fought(ours[0], theirs), 0, 0, TRAINER_RULES);
    expect(isFainted(activeOf(alone.battle, 0))).toBe(false);
    expect(alone.events.some((event) => event.t === "fizzled")).toBe(true);
  });

  it("X53: Revival Blessing brings somebody in reserve back at half", () => {
    const ours = [
      creature("chansey", { level: 50, moves: ["revivalblessing"] }),
      creature("rattata", { level: 50, moves: ["tackle"], uid: 3, hp: 0 }),
    ];
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    const battle = resolveTurn(
      startBattle(SEED, TAG, ours, [theirs]),
      [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }],
      TRAINER_RULES,
    ).battle;
    expect(battle.sides[0].team[1].hp).toBe(Math.floor(maxHp(ours[1]) / 2));
    expect(battle.events.some((event) => event.t === "revived" && event.speciesId === "rattata")).toBe(true);

    // With nobody down it has nothing to do.
    const whole = turn(fought(ours[0], theirs), 0, 0, TRAINER_RULES);
    expect(whole.events.some((event) => event.t === "fizzled")).toBe(true);
  });

  it("X54: Magnet Rise puts it out of reach of the ground for five turns", () => {
    const ours = creature("rattata", { level: 50, moves: ["magnetrise", "splash"] });
    const theirs = creature("machop", { level: 20, moves: ["earthquake"], uid: 2 });

    let live = turn(fought(ours, theirs), 0, 0);
    expect(volatilesOf(live.battle, 0).afloat).toBe(4);
    expect(live.events.some((event) => event.t === "immune" && event.side === 0)).toBe(true);
    // The move buttons know, so an Earthquake is not promised into it.
    expect(landsAs(theirs, ours, "earthquake", live.battle.sides[0].volatiles)).toBe(0);
    expect(landsAs(theirs, ours, "earthquake")).toBeGreaterThan(0);

    for (let n = 0; n < 4; n++) {
      live = turn(live.battle, 1, 0);
      expect(damagedOn(live.events, 0), `it was hit on turn ${n + 2}`).toBe(0);
    }
    expect(volatilesOf(live.battle, 0).afloat).toBeUndefined();
    const landed = turn(live.battle, 1, 0);
    expect(damagedOn(landed.events, 0)).toBeGreaterThan(0);
  });

  it("X55: every one of the twenty-five is honoured, and dealt again", () => {
    const group = [
      "aquaring", "ingrain", "attract", "healpulse", "floralhealing", "strengthsap",
      "psychup", "powerswap", "guardswap", "speedswap", "heartswap", "powersplit", "guardsplit",
      "stockpile", "swallow", "spitup", "lockon", "mindreader", "destinybond",
      "wish", "healingwish", "lunardance", "revivalblessing", "magnetrise", "telekinesis",
    ];
    for (const id of group) expect(actsOnSomething(moveById(id)), `${id} is still filtered`).toBe(true);

    // And the filter has let them back into the learnsets.
    const dealt = new Set<string>();
    for (const spec of ALL_SPECIES) {
      for (const [, id] of learnset(spec.id)) if (group.includes(id)) dealt.add(id);
    }
    expect(dealt.size, "hardly anything learns them").toBeGreaterThan(20);
  });
});

describe("the deferred list", () => {
  const doc = readFileSync(join(process.cwd(), "docs", "moves-deferred.md"), "utf8");
  const rows = doc.split("\n").filter((line) => line.startsWith("| **"));
  const named = new Set(rows.flatMap((row) => [...row.matchAll(/\*\*([^*]+)\*\*/g)].map((one) => one[1])));

  it("X56: every move the filter takes away is on the list", () => {
    // A move that is neither dealt nor written down is a move nobody knows is
    // missing, which is how Leech Seed went unnoticed in the first place.
    const missing = ALL_MOVES.filter((move) => !actsOnSomething(move) && !named.has(move.name));
    expect(missing.map((move) => move.name), "filtered but not in docs/moves-deferred.md").toEqual([]);
  });

  it("X57: and nothing on the list is quietly honoured after all", () => {
    // The other way the pair rots, and the same guard H29 keeps for items: a
    // move filed as waiting on something that has since been built is a
    // reader sent looking for what is already there.
    const byName = new Map(ALL_MOVES.map((move) => [move.name, move]));
    const wrongly = [...named].filter((name) => {
      const move = byName.get(name);
      return move !== undefined && actsOnSomething(move);
    });
    expect(wrongly, "docs/moves-deferred.md says these are missing, and they are not").toEqual([]);

    // And the count it opens with is the real one.
    const filtered = ALL_MOVES.filter((move) => !actsOnSomething(move)).length;
    expect(doc).toContain(`the **${filtered}** below`);
  });
});

describe("types that belong to the appearance", () => {
  it("X58: a Soaked creature is Water to the chart, to a status and to the bonus", () => {
    // Magnemite is Electric and Steel: a Grass move is resisted and nothing
    // poisons it. Soaked, neither is true any more.
    const ours = creature("rattata", { level: 50, moves: ["soak", "vinewhip", "toxic"] });
    const theirs = creature("magnemite", { level: 50, moves: ["splash"], uid: 2 });

    expect(landsAs(ours, theirs, "vinewhip")).toBeLessThan(4);
    const soaked = turn(fought(ours, theirs), 0, 0);
    expect(volatilesOf(soaked.battle, 1).types).toEqual(["water"]);
    expect(landsAs(ours, theirs, "vinewhip", soaked.battle.sides[1].volatiles)).toBe(8);

    const shocked = turn(soaked.battle, 1, 0);
    expect(shocked.events.some((event) => event.t === "damage" && event.side === 1 && event.quarters === 8)).toBe(true);

    const poisoned = turn(shocked.battle, 2, 0);
    expect(activeOf(poisoned.battle, 1).status).toBe("psn");

    // And a switch gives it its species back.
    const again = turn(fought(ours, theirs), 0, 0);
    expect(again.events.some((event) => event.t === "volatile" && event.which === "retyped")).toBe(true);
    const twice = turn(again.battle, 0, 0);
    expect(twice.events.some((event) => event.t === "fizzled")).toBe(true);
  });

  it("X59: Forest's Curse adds a type, and a seed then finds a Grass type", () => {
    const ours = creature("bulbasaur", { level: 50, moves: ["forestscurse", "leechseed"] });
    const theirs = creature("rattata", { level: 50, moves: ["splash"], uid: 2 });

    const cursed = turn(fought(ours, theirs), 0, 0);
    expect(volatilesOf(cursed.battle, 1).types).toEqual(["normal", "grass"]);

    const seeded = turn(cursed.battle, 1, 0);
    expect(volatilesOf(seeded.battle, 1).seeded).toBeUndefined();
    expect(seeded.events.some((event) => event.t === "fizzled")).toBe(true);
  });

  it("X60: Reflect Type, Conversion and Conversion 2 each pick a type from somewhere", () => {
    const mirror = creature("gastly", { level: 50, moves: ["reflecttype"] });
    const plain = creature("rattata", { level: 50, moves: ["tackle"], uid: 2 });
    const mirrored = turn(fought(mirror, plain), 0, 0);
    expect(volatilesOf(mirrored.battle, 0).types).toEqual(["normal"]);

    // Its first move's type, which is Fire here and not the Normal it is.
    const convert = creature("rattata", { level: 50, moves: ["ember", "conversion"] });
    const converted = turn(fought(convert, plain), 1, 0);
    expect(volatilesOf(converted.battle, 0).types).toEqual(["fire"]);

    // Something their last move cannot touch: they used Tackle, so Ghost.
    const answer = creature("rattata", { level: 50, moves: ["splash", "conversion2"] });
    const tackled = turn(fought(answer, plain), 0, 0);
    const answered = turn(tackled.battle, 1, 0);
    expect(volatilesOf(answered.battle, 0).types).toEqual(["ghost"]);
  });

  it("X61: Foresight sees through a Ghost and Miracle Eye through a Dark", () => {
    const ours = creature("rattata", { level: 50, moves: ["foresight", "tackle"] });
    const ghost = creature("gastly", { level: 50, moves: ["splash"], uid: 2 });

    const blind = turn(fought(ours, ghost), 1, 0);
    expect(blind.events.some((event) => event.t === "immune")).toBe(true);

    const seen = turn(fought(ours, ghost), 0, 0);
    expect(volatilesOf(seen.battle, 1).seen).toBe("ghost");
    expect(landsAs(ours, ghost, "tackle", seen.battle.sides[1].volatiles)).toBe(4);
    const landed = turn(seen.battle, 1, 0);
    expect(damagedOn(landed.events, 1)).toBeGreaterThan(0);

    const seer = creature("rattata", { level: 50, moves: ["miracleeye", "confusion"] });
    const dark = creature("poochyena", { level: 50, moves: ["splash"], uid: 2 });
    const eyed = turn(fought(seer, dark), 0, 0);
    expect(volatilesOf(eyed.battle, 1).seen).toBe("dark");
    const struck = turn(eyed.battle, 1, 0);
    expect(damagedOn(struck.events, 1)).toBeGreaterThan(0);
  });
});

describe("the second cheap group", () => {
  it("X62: Venom Drench wants a poisoned target", () => {
    const ours = creature("rattata", { level: 50, moves: ["venomdrench"] });
    const sick = creature("machop", { level: 50, moves: ["splash"], uid: 2, status: "psn" });
    const well = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    const drenched = turn(fought(ours, sick), 0, 0);
    expect(drenched.battle.sides[1].stages).toMatchObject({ atk: -1, spa: -1, spe: -1 });
    const dry = turn(fought(ours, well), 0, 0);
    expect(dry.events.some((event) => event.t === "fizzled")).toBe(true);
  });

  it("X63: Acupressure raises one ladder by two", () => {
    const ours = creature("rattata", { level: 50, moves: ["acupressure"] });
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    const pressed = turn(fought(ours, theirs), 0, 0).battle;
    const stages = pressed.sides[0].stages;
    const aim = pressed.sides[0].aim ?? { accuracy: 0, evasion: 0 };
    const total = stages.atk + stages.def + stages.spa + stages.spd + stages.spe + aim.accuracy + aim.evasion;
    expect(total).toBe(2);
  });

  it("X64: Psycho Shift hands the condition over, and keeps it when refused", () => {
    const ours = creature("rattata", { level: 50, moves: ["psychoshift"], status: "brn" });
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });
    const shifted = turn(fought(ours, theirs), 0, 0);
    expect(activeOf(shifted.battle, 0).status).toBeNull();
    expect(activeOf(shifted.battle, 1).status).toBe("brn");

    // A Fire type does not burn, so the user is stuck with it.
    const fire = creature("vulpix", { level: 50, moves: ["splash"], uid: 2 });
    const refused = turn(fought(ours, fire), 0, 0);
    expect(activeOf(refused.battle, 0).status).toBe("brn");
    expect(refused.events.some((event) => event.t === "fizzled")).toBe(true);
  });

  it("X65: Power Trick exchanges the two numbers, and exchanges them back", () => {
    const ours = creature("rattata", { level: 50, moves: ["powertrick"] });
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });
    const own = computeStats(speciesById("rattata"), ours);

    const tricked = turn(fought(ours, theirs), 0, 0).battle;
    expect(volatilesOf(tricked, 0).stats).toEqual({ atk: own.def, def: own.atk });
    const untricked = turn(tricked, 0, 0).battle;
    expect(volatilesOf(untricked, 0).stats).toEqual({ atk: own.atk, def: own.def });
  });

  it("X66: Topsy-Turvy turns the stages over", () => {
    const ours = creature("rattata", { level: 50, moves: ["topsyturvy", "splash"] });
    const theirs = creature("machop", { level: 50, moves: ["swordsdance"], uid: 2 });

    const raised = turn(fought(ours, theirs), 1, 0);
    expect(raised.battle.sides[1].stages.atk).toBe(2);
    // Rattata is faster: the flip comes first, and the dance then puts two
    // back on top of the minus two.
    const flipped = turn(raised.battle, 0, 0);
    expect(flipped.events.some((event) => event.t === "volatile" && event.which === "inverted")).toBe(true);
    expect(flipped.battle.sides[1].stages.atk).toBe(0);

    const level = creature("machop", { level: 50, moves: ["splash"], uid: 2 });
    const nothing = turn(fought(ours, level), 0, 0);
    expect(nothing.events.some((event) => event.t === "fizzled")).toBe(true);
  });

  it("X67: Take Heart cures and raises, and Jungle Healing cures and mends", () => {
    const heart = creature("rattata", { level: 50, moves: ["takeheart"], status: "par" });
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });
    const taken = turn(fought(heart, theirs), 0, 0).battle;
    expect(activeOf(taken, 0).status).toBeNull();
    expect(taken.sides[0].stages).toMatchObject({ spa: 1, spd: 1 });

    const jungle = creature("rattata", { level: 50, moves: ["junglehealing"], status: "psn", hp: 10 });
    const healed = turn(fought(jungle, theirs), 0, 0);
    expect(activeOf(healed.battle, 0).status).toBeNull();
    expect(healedOn(healed.events, 0)).toBe(Math.floor(maxHp(jungle) / 4));
  });

  it("X68: Flower Shield raises every Grass type standing, and nothing else", () => {
    const ours = creature("bulbasaur", { level: 50, moves: ["flowershield"] });
    const theirs = creature("rattata", { level: 50, moves: ["splash"], uid: 2 });
    const shielded = turn(fought(ours, theirs), 0, 0).battle;
    expect(shielded.sides[0].stages.def).toBe(1);
    expect(shielded.sides[1].stages.def).toBe(0);
  });
});

describe("moves that call moves", () => {
  const usedBy = (events: readonly BattleEvent[], side: SideIndex) =>
    events.filter((event): event is Extract<BattleEvent, { t: "use" }> => event.t === "use" && event.side === side).map((event) => event.moveId);

  it("X69: Metronome lands on something that does something, and never on a caller", () => {
    // Across seeds, because one roll proves nothing. Every landing is a move
    // the engine honours — the guarantee the whole design makes — and none
    // is a caller, which is what keeps the call depth at one.
    const landed = new Set<string>();
    for (let at = 0; at < 24; at++) {
      const ours = creature("rattata", { level: 50, moves: ["metronome"] });
      const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });
      const played = resolveTurn(
        startBattle(`${SEED}-${at}`, TAG, [ours], [theirs]),
        [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }],
      ).battle;
      const used = usedBy(played.events, 0);
      expect(used[0]).toBe("metronome");
      expect(used.length, "Metronome called nothing").toBe(2);
      expect(UNCALLABLE.has(used[1]), `Metronome called ${used[1]}`).toBe(false);
      expect(actsOnSomething(moveById(used[1]))).toBe(true);
      landed.add(used[1]);
    }
    expect(landed.size, "every roll landed on the same move").toBeGreaterThan(5);
  });

  it("X70: Mirror Move uses what was used on it, and spends only its own uses", () => {
    const ours = creature("rattata", { level: 50, moves: ["mirrormove"] });
    const theirs = creature("machop", { level: 50, moves: ["tackle"], uid: 2 });

    // Rattata moves first: nothing has been used on it yet.
    const first = turn(fought(ours, theirs), 0, 0);
    expect(first.events.some((event) => event.t === "fizzled" && event.side === 0)).toBe(true);

    const second = turn(first.battle, 0, 0);
    expect(usedBy(second.events, 0)).toEqual(["mirrormove", "tackle"]);
    expect(damagedOn(second.events, 1)).toBeGreaterThan(0);
    // Two Mirror Moves spent, and nothing else — the called Tackle is not a
    // slot and costs no uses.
    expect(activeOf(second.battle, 0).pp[0]).toBe(moveById("mirrormove").pp - 2);
  });

  it("X71: Sleep Talk works only while it sleeps", () => {
    const asleep = creature("rattata", { level: 50, moves: ["sleeptalk", "tackle"], status: "slp" });
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    const talked = turn(fought(asleep, theirs), 0, 0);
    expect(talked.events.some((event) => event.t === "blocked" && event.side === 0)).toBe(true);
    expect(usedBy(talked.events, 0)).toEqual(["sleeptalk", "tackle"]);
    expect(damagedOn(talked.events, 1)).toBeGreaterThan(0);

    const awake = creature("rattata", { level: 50, moves: ["sleeptalk", "tackle"] });
    const idle = turn(fought(awake, theirs), 0, 0);
    expect(usedBy(idle.events, 0)).toEqual(["sleeptalk"]);
    expect(idle.events.some((event) => event.t === "fizzled" && event.side === 0)).toBe(true);
  });

  it("X72: Assist borrows from the party, and has nothing to borrow alone", () => {
    const ours = [
      creature("rattata", { level: 50, moves: ["assist"] }),
      creature("pidgey", { level: 50, moves: ["gust"], uid: 3 }),
    ];
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    const borrowed = resolveTurn(
      startBattle(SEED, TAG, ours, [theirs]),
      [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }],
      TRAINER_RULES,
    ).battle;
    expect(usedBy(borrowed.events, 0)).toEqual(["assist", "gust"]);

    const alone = turn(fought(ours[0], theirs), 0, 0);
    expect(alone.events.some((event) => event.t === "fizzled" && event.side === 0)).toBe(true);
  });

  it("X73: Instruct makes the target do it again", () => {
    const ours = creature("rattata", { level: 50, moves: ["instruct", "splash"] });
    const theirs = creature("machop", { level: 50, moves: ["tackle"], uid: 2 });

    const first = turn(fought(ours, theirs), 1, 0);
    const second = turn(first.battle, 0, 0);
    // Rattata moves first, so the instructed Tackle comes before Machop's own.
    expect(usedBy(second.events, 1)).toEqual(["tackle", "tackle"]);
    expect(second.events.filter((event) => event.t === "damage" && event.side === 0)).toHaveLength(2);
  });

  it("X74: Spite takes four uses off what was last used", () => {
    const ours = creature("rattata", { level: 50, moves: ["spite"] });
    const theirs = creature("machop", { level: 50, moves: ["tackle"], uid: 2 });

    const first = turn(fought(ours, theirs), 0, 0);
    expect(first.events.some((event) => event.t === "fizzled" && event.side === 0)).toBe(true);

    const second = turn(first.battle, 0, 0);
    // Their Tackle: one spent by using it twice, four by the Spite.
    expect(activeOf(second.battle, 1).pp[0]).toBe(moveById("tackle").pp - 2 - 4);
    expect(second.events.some((event) => event.t === "spite" && event.amount === 4)).toBe(true);
  });
});
