import { describe, expect, it } from "vitest";
import {
  aiAction,
  resolveTurn,
  startBattle,
  WILD_RULES,
  type BattleEvent,
  type BattleState,
} from "@/engine/battle";
import { ALL_MOVES, move as moveById } from "@/engine/dex";
import { powerOfBlow } from "@/engine/moves";
import { powerText } from "@/components/BattleView";
import { narrate } from "@/lib/narrate";
import { creature } from "./helpers";

/**
 * The thirty-one moves that land more than once.
 *
 * Fury Swipes is 18 power, which is the worst number on any move button in
 * the game and is meant to be: it is 18 power *five times*. The manifest holds
 * that as plain data — `multihit: [2, 5]` — and the build script was not
 * copying it across, so every one of them spent a turn landing exactly once.
 * **356 of 1134 species learn at least one**, over 438 learnset slots, so it
 * was not a corner of the game.
 *
 * Three fields, all of them data rather than script, which is why they belong
 * in the manifest rather than in a table here: `multihit`, `multiaccuracy`
 * (accuracy rolled again for every blow — Triple Kick, Triple Axel,
 * Population Bomb) and `alwaysCrit` (Frost Breath and the other four). The one
 * thing the manifest genuinely cannot say is Triple Kick's rising power, and
 * that lives in `moves.ts` beside the other thirty-nine formulas Showdown
 * keeps in script.
 *
 * What is worth guarding is not "does it hit twice" but the four things that
 * make five blows read as five rather than as one blow times five: each rolls
 * its own damage and its own crit, the sequence stops when the target goes
 * down, the per-blow accuracy stops at the first miss, and everything that
 * reads the total — drain, recoil, a Life Orb's cut — reads the total.
 */

const TAG = "wild:multi:0";

/** One turn of a move against something too big to kill. */
function swing(moveId: string, seed: string, level = 50): readonly BattleEvent[] {
  const ours = creature("machop", { level, moves: [moveId] });
  // Chansey at 80: enormous health, so nothing is ever clamped by the target
  // running out of it and every blow's own number survives to be compared.
  const theirs = creature("chansey", { level: 80, uid: 2 });
  const battle = startBattle(seed, TAG, [ours], [theirs]);
  return resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, aiAction(battle)], WILD_RULES, 10)
    .battle.events;
}

/** The blows that landed on the far side, in order. */
function blows(events: readonly BattleEvent[]): { amount: number; crit: boolean }[] {
  return events.flatMap((event) =>
    event.t === "damage" && event.side === 1 ? [{ amount: event.amount, crit: event.crit }] : [],
  );
}

/** What the log's summary said, or null if it said nothing. */
function counted(events: readonly BattleEvent[]): number | null {
  const found = events.find((event) => event.t === "hits");
  return found && found.t === "hits" ? found.count : null;
}

describe("what the manifest carries", () => {
  it("U1: the three fields are there, on the moves they belong to", () => {
    // A dropped field is silent: the move still exists, still has power, still
    // burns a turn, and lands once. That is exactly how this shipped.
    const many = ALL_MOVES.filter((entry) => entry.multihit);
    expect(many.length).toBe(31);

    for (const entry of many) {
      const [least, most] = entry.multihit!;
      expect(least, entry.id).toBeGreaterThanOrEqual(2);
      expect(most, entry.id).toBeGreaterThanOrEqual(least);
      // Two shapes and no others: a fixed count, or the classic two-to-five.
      expect(most - least, entry.id).toBeOneOf([0, 3]);
      // Nothing lands several times for no damage.
      expect(entry.category, entry.id).not.toBe("status");
    }

    expect(ALL_MOVES.filter((entry) => entry.multiaccuracy).map((entry) => entry.id).sort()).toEqual(
      ["populationbomb", "tripleaxel", "triplekick"],
    );
    expect(ALL_MOVES.filter((entry) => entry.alwaysCrit).map((entry) => entry.id).sort()).toEqual(
      ["flowertrick", "frostbreath", "stormthrow", "surgingstrikes", "wickedblow"],
    );

    // Every move that rolls accuracy per blow lands more than once, or the
    // flag is about nothing.
    for (const entry of ALL_MOVES) {
      if (entry.multiaccuracy) expect(entry.multihit, entry.id).not.toBeNull();
    }
  });

  it("U2: rising power is the pair's shared rule, not a table of six numbers", () => {
    expect(powerOfBlow(moveById("triplekick"), 10, 0)).toBe(10);
    expect(powerOfBlow(moveById("triplekick"), 10, 1)).toBe(20);
    expect(powerOfBlow(moveById("triplekick"), 10, 2)).toBe(30);
    expect(powerOfBlow(moveById("tripleaxel"), 20, 2)).toBe(60);
    // And nothing else rises. Fury Swipes is the same 18 five times over.
    expect(powerOfBlow(moveById("furyswipes"), 18, 4)).toBe(18);
    expect(powerOfBlow(moveById("tackle"), 40, 3)).toBe(40);
  });
});

describe("how many times", () => {
  it("U3: a two-to-five move lands two to five times, in eighths", () => {
    // Three eighths two, three eighths three, one eighth four, one eighth
    // five, which averages exactly three — so Fury Swipes at 18 is a little
    // over fifty, which is where a move of that shape should sit.
    const tally = new Map<number, number>();
    let missed = 0;

    for (let at = 0; at < 800; at++) {
      const landed = counted(swing("furyswipes", `E${at}`));
      if (landed === null) missed++;
      else tally.set(landed, (tally.get(landed) ?? 0) + 1);
    }

    // It is an 80% move, so about a fifth of these are misses rather than
    // hits. A miss is silent: there is no count to report.
    expect(missed).toBeGreaterThan(80);
    expect([...tally.keys()].sort()).toEqual([2, 3, 4, 5]);

    const hits = [...tally.values()].reduce((sum, one) => sum + one, 0);
    const share = (count: number) => (tally.get(count) ?? 0) / hits;
    // Generous bands: this is checking the shape, not the die.
    expect(share(2)).toBeGreaterThan(0.28);
    expect(share(3)).toBeGreaterThan(0.28);
    expect(share(4)).toBeLessThan(0.2);
    expect(share(5)).toBeLessThan(0.2);

    const mean = [...tally.entries()].reduce((sum, [n, c]) => sum + n * c, 0) / hits;
    expect(mean).toBeGreaterThan(2.85);
    expect(mean).toBeLessThan(3.15);
  });

  it("U4: a fixed count is fixed", () => {
    for (const [moveId, times] of [
      ["doublekick", 2],
      ["twineedle", 2],
      ["surgingstrikes", 3],
    ] as const) {
      for (let at = 0; at < 40; at++) {
        const landed = counted(swing(moveId, `F${moveId}${at}`));
        // All three never miss at this level, so every swing has a count.
        expect(landed, `${moveId} on seed F${moveId}${at}`).toBe(times);
      }
    }
  });

  it("U5: the count is the blows, and the blows are the count", () => {
    // Two ways of saying the same thing, from two different events. They come
    // apart the moment somebody adds a reason to stop early and forgets one.
    for (let at = 0; at < 60; at++) {
      const events = swing("furyswipes", `G${at}`);
      const landed = counted(events);
      if (landed === null) {
        expect(blows(events).length, `G${at}`).toBe(0);
      } else {
        expect(blows(events).length, `G${at}`).toBe(landed);
      }
    }
  });
});

describe("what makes five blows five", () => {
  it("U6: each blow rolls its own number", () => {
    // Otherwise a Fury Swipes is one number printed five times, which reads as
    // the screen repeating itself. The first blow keeps the bare roll tag and
    // the rest are suffixed, so this also pins that the suffixing happens at
    // all.
    let sawDifferent = false;

    for (let at = 0; at < 120 && !sawDifferent; at++) {
      const hit = blows(swing("furyswipes", `H${at}`));
      if (hit.length < 3) continue;
      if (new Set(hit.map((one) => one.amount)).size > 1) sawDifferent = true;
    }

    expect(sawDifferent, "every blow of a multi-hit move dealt the same damage").toBe(true);
  });

  it("U7: and its own critical hit", () => {
    // A crit on the third of five is the whole reason to watch a multi-hit
    // move land. Shared rolls would make it all-or-nothing.
    let split = false;

    for (let at = 0; at < 400 && !split; at++) {
      const hit = blows(swing("furyswipes", `I${at}`));
      if (hit.length < 3) continue;
      const crits = hit.filter((one) => one.crit).length;
      if (crits > 0 && crits < hit.length) split = true;
    }

    expect(split, "no multi-hit turn ever crit on some blows and not others").toBe(true);
  });

  it("U8: nothing swings at something already down", () => {
    // A five-hit move that knocks the target out on its second blow used to go
    // on hitting a fainted creature three more times, and the log said so
    // three more times.
    //
    // Checked by the *blows* rather than by where the `faint` event sits,
    // which is the trap here and one this test fell into first time out:
    // fainting is noticed in `settle`, after the move is over, so every blow
    // is before it in the list however many of them there were. The tell is
    // the blow itself — `applyDamage` clamps to what is left, so a swing at
    // something already at nothing reports nothing.
    let dropped = 0;

    for (let at = 0; at < 300; at++) {
      const ours = creature("machop", { level: 80, moves: ["furyswipes"] });
      const theirs = creature("caterpie", { level: 5, uid: 2 });
      const battle = startBattle(`J${at}`, TAG, [ours], [theirs]);
      const events = resolveTurn(
        battle,
        [{ t: "fight", moveIndex: 0 }, aiAction(battle)],
        WILD_RULES,
        10,
      ).battle.events;

      if (!events.some((event) => event.t === "faint" && event.side === 1)) continue;
      dropped++;

      const hit = blows(events);
      expect(hit.length, `J${at}: it went down to no blows at all`).toBeGreaterThan(0);
      for (const one of hit) {
        expect(one.amount, `J${at}: a blow landed for nothing`).toBeGreaterThan(0);
      }
    }

    // A Machop at eighty against a Caterpie at five: it should be nearly all
    // of them, and if it is none the test measured nothing.
    expect(dropped, "nothing ever fainted, so this test checked nothing").toBeGreaterThan(100);
  });

  it("U9: per-blow accuracy stops at the first miss", () => {
    // Population Bomb is ten blows at 90%, so all ten is 0.9^10 — about one
    // swing in three. Without this it was ten for ten every time: two hundred
    // base power for ten power points.
    const tally = new Map<number, number>();
    for (let at = 0; at < 400; at++) {
      const landed = counted(swing("populationbomb", `K${at}`)) ?? 0;
      tally.set(landed, (tally.get(landed) ?? 0) + 1);
    }

    const total = 400;
    const all = (tally.get(10) ?? 0) / total;
    expect(all, "every Population Bomb landed all ten").toBeLessThan(0.5);
    expect(all, "no Population Bomb ever landed all ten").toBeGreaterThan(0.2);
    // And it can stop anywhere, rather than only at the end.
    expect([...tally.keys()].filter((n) => n > 0 && n < 10).length).toBeGreaterThan(4);

    // A two-to-five move without the flag never stops short: its accuracy was
    // settled once, before any of it landed.
    for (let at = 0; at < 120; at++) {
      const landed = counted(swing("bulletseed", `L${at}`));
      if (landed !== null) expect(landed, `L${at}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("U10: a rising move hits harder as it goes", () => {
    // 10, 20, 30 for Triple Kick. The spread roll is ±15%, so a threefold
    // difference in power is not something it can hide.
    let checked = 0;

    for (let at = 0; at < 200 && checked < 12; at++) {
      const hit = blows(swing("triplekick", `M${at}`));
      if (hit.length !== 3 || hit.some((one) => one.crit)) continue;
      checked++;
      expect(hit[1].amount, `M${at} second blow`).toBeGreaterThan(hit[0].amount);
      expect(hit[2].amount, `M${at} third blow`).toBeGreaterThan(hit[1].amount);
    }

    expect(checked, "no clean three-blow Triple Kick to measure").toBeGreaterThan(5);
  });
});

describe("the five that always crit", () => {
  it("U11: they always do", () => {
    for (const moveId of ["frostbreath", "stormthrow", "wickedblow"]) {
      for (let at = 0; at < 30; at++) {
        const hit = blows(swing(moveId, `N${moveId}${at}`));
        if (!hit.length) continue;
        for (const one of hit) expect(one.crit, `${moveId} on N${moveId}${at}`).toBe(true);
      }
    }
  });

  it("U12: and a Lucky Chant still stops them", () => {
    // A chant that the five strongest crits in the game walked through would
    // be a chant that protects against nothing anybody uses it for.
    const ours = creature("machop", { level: 50, moves: ["frostbreath"] });
    const theirs = creature("chansey", { level: 80, uid: 2 });
    const opened = startBattle("CHANT1", TAG, [ours], [theirs]);
    const chanted: BattleState = {
      ...opened,
      sides: [opened.sides[0], { ...opened.sides[1], screens: { luckychant: 5 } }],
    };

    const events = resolveTurn(
      chanted,
      [{ t: "fight", moveIndex: 0 }, aiAction(chanted)],
      WILD_RULES,
      10,
    ).battle.events;

    const hit = blows(events);
    expect(hit.length).toBeGreaterThan(0);
    for (const one of hit) expect(one.crit).toBe(false);
  });
});

describe("what the screen says about it", () => {
  it("U14: the button says how many times, because the power is one blow's", () => {
    // 18 is the worst number on any move button in the game, and printed bare
    // it is a lie by omission: three blows of it is a little over fifty. The
    // function is exported for this — the same reason `crispSize` is.
    expect(powerText(moveById("furyswipes"))).toBe("18 pow ×2–5");
    expect(powerText(moveById("doublekick"))).toBe("30 pow ×2");
    expect(powerText(moveById("populationbomb"))).toBe("20 pow ×10");
    // And everything else reads exactly as it did.
    expect(powerText(moveById("tackle"))).toBe("40 pow");
    expect(powerText(moveById("growl"))).toBe("status");
    expect(powerText(moveById("gyroball"))).toBe("power varies");
  });

  it("U15: the log says it once, after the blows", () => {
    const said = narrate(
      [
        { t: "use", side: 0, moveId: "furyswipes" },
        { t: "damage", side: 1, amount: 7, quarters: 4, crit: false },
        { t: "damage", side: 1, amount: 8, quarters: 4, crit: true },
        { t: "damage", side: 1, amount: 6, quarters: 4, crit: false },
        { t: "hits", side: 0, count: 3 },
      ],
      (side) => (side === 0 ? "Sandshrew" : "Wild Rattata"),
    );

    expect(said[said.length - 1]).toBe("It hit 3 times!");
    // Three separate numbers above it, which is the point of not summing them.
    expect(said.filter((line) => /took \d/.test(line)).length).toBe(3);

    // And the singular, for a Triple Kick that missed its second blow.
    const once = narrate(
      [
        { t: "use", side: 0, moveId: "triplekick" },
        { t: "damage", side: 1, amount: 5, quarters: 4, crit: false },
        { t: "hits", side: 0, count: 1 },
      ],
      () => "Sandshrew",
    );
    expect(once[once.length - 1]).toBe("It hit once.");
  });
});

describe("everything else is untouched", () => {
  it("U13: a single-hit move lands once and says nothing about it", () => {
    // No `hits` event at all for the seven hundred and eighty-nine, so nothing
    // in the log ever tells a player that a Tackle hit one time.
    for (let at = 0; at < 40; at++) {
      const events = swing("tackle", `O${at}`);
      expect(counted(events), `O${at}`).toBeNull();
      expect(blows(events).length, `O${at}`).toBeLessThanOrEqual(1);
    }
  });
});
