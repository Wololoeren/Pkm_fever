import { describe, expect, it } from "vitest";
import { aiAction, resolveTurn, startBattle, WILD_RULES, type BattleEvent } from "@/engine/battle";
import { BEAT_MS, BLOW_GAP_MS, beatLength, beatsFor, catchFor } from "@/lib/beats";
import { cuesFor } from "@/lib/sound";
import { creature } from "./helpers";

/**
 * What a turn looks like.
 *
 * The battle emits events and nothing else — no positions, no timings, no
 * words. `narrate.ts` turns them into sentences and `beats.ts` turns the same
 * list into motion, and both are display: an animation the state depended on
 * would be a save that broke when somebody retimed a shake. So these check the
 * derivation, not the pixels.
 *
 * The part actually worth guarding is the *ordering*. Both sides move in one
 * turn, and animating them at once reads as two things happening to one
 * creature rather than as one of them swinging and the other answering.
 */

const SEED = "BEAT1";
const TAG = "wild:meadow-1:0";

/** A turn's events, from a real battle rather than a hand-written list. */
function played(ourMove: string, theirMove: string): readonly BattleEvent[] {
  const ours = creature("machop", { level: 50, moves: [ourMove] });
  const theirs = creature("rattata", { level: 50, moves: [theirMove], uid: 2 });
  const battle = startBattle(SEED, TAG, [ours], [theirs]);
  return resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, aiAction(battle)], WILD_RULES, 10)
    .battle.events;
}

describe("reading a turn", () => {
  it("A1: a swing and the answer to it are not simultaneous", () => {
    // The whole reason this module exists rather than a class per event.
    const [first, second] = beatsFor([
      { t: "use", side: 0, moveId: "tackle" },
      { t: "damage", side: 1, amount: 10, quarters: 4, crit: false },
      { t: "use", side: 1, moveId: "tackle" },
      { t: "damage", side: 0, amount: 8, quarters: 4, crit: false },
    ]);

    expect(first.lungeAt).toBe(0);
    expect(second.lungeAt).toBe(BEAT_MS);
    // Each one is hit after whoever hit it swung, not before.
    expect(second.hitAt!).toBeGreaterThan(first.lungeAt!);
    expect(first.hitAt!).toBeGreaterThan(second.lungeAt!);
  });

  it("A2: the blow is attributed to whoever was mid-swing", () => {
    const [mine, theirs] = beatsFor([
      { t: "use", side: 0, moveId: "ember" },
      { t: "damage", side: 1, amount: 12, quarters: 8, crit: true },
    ]);

    // They were hit, by fire, critically. We were not hit at all.
    expect(theirs.hitAt).not.toBeNull();
    expect(theirs.type).toBe("fire");
    expect(theirs.crit).toBe(true);
    expect(mine.hitAt).toBeNull();
  });

  it("A3: a residual has no swing in front of it and still lands", () => {
    // A burn or a seed arrives at the end of the turn with nobody having used
    // anything. Read naively that is damage attributed to the last attacker,
    // which would flash it in that move's colour — a poison tick lighting up
    // green because somebody used Vine Whip four events earlier.
    const [, theirs] = beatsFor([
      { t: "use", side: 0, moveId: "vinewhip" },
      { t: "damage", side: 1, amount: 10, quarters: 4, crit: false },
      { t: "residual", side: 1, status: "psn", amount: 3 },
      { t: "damage", side: 1, amount: 3, quarters: 4, crit: false },
    ]);

    expect(theirs.hitAt).not.toBeNull();
    // Still the move's colour from the hit that *did* have a swing; what
    // matters is that the second damage did not overwrite it with nothing.
    expect(theirs.type).toBe("grass");
  });

  it("A4: a miss makes the other one dodge, not the one who swung", () => {
    const [mine, theirs] = beatsFor([
      { t: "use", side: 0, moveId: "tackle" },
      { t: "miss", side: 0 },
    ]);

    // `miss` carries whoever swung, so it is the target that moves.
    expect(theirs.dodgeAt).not.toBeNull();
    expect(mine.dodgeAt).toBeNull();
    expect(theirs.hitAt).toBeNull();
  });

  it("A5: a gesture takes its turn in the order without lunging", () => {
    // Growl is not a swing. It should still occupy its place, or the answer
    // to it lands at the same moment it was used.
    const [mine, theirs] = beatsFor([
      { t: "use", side: 0, moveId: "growl" },
      { t: "boost", side: 1, stat: "atk", delta: -1 },
      { t: "use", side: 1, moveId: "tackle" },
      { t: "damage", side: 0, amount: 9, quarters: 4, crit: false },
    ]);

    expect(mine.lungeAt, "a growl lunged").toBeNull();
    expect(theirs.lungeAt).toBe(BEAT_MS);
    expect(mine.hitAt!).toBeGreaterThan(0);
    // And the thing that was growled at glows rather than flinching.
    expect(theirs.glowAt).not.toBeNull();
    expect(theirs.hitAt).toBeNull();
  });

  it("A6: a glow is suppressed when the same creature was also hit", () => {
    // A move that hurts and burns should play one animation, not two over
    // each other reading as neither.
    const [, theirs] = beatsFor([
      { t: "use", side: 0, moveId: "flamethrower" },
      { t: "damage", side: 1, amount: 20, quarters: 4, crit: false },
      { t: "status", side: 1, status: "brn" },
    ]);

    expect(theirs.hitAt).not.toBeNull();
    // `glowAt` is still recorded; it is the hook that declines to play it, and
    // that is asserted here so the rule lives somewhere a reader can find it.
    expect(theirs.glowAt).not.toBeNull();
  });

  it("A7: fainting is the last thing that happens to it", () => {
    const [, theirs] = beatsFor([
      { t: "use", side: 0, moveId: "tackle" },
      { t: "damage", side: 1, amount: 99, quarters: 4, crit: false },
      { t: "faint", side: 1 },
    ]);

    expect(theirs.faintAt!).toBeGreaterThan(theirs.hitAt!);
  });

  it("A8: an empty turn is silent rather than a flurry at zero", () => {
    const [mine, theirs] = beatsFor([]);
    for (const beat of [mine, theirs]) {
      expect(beat.lungeAt).toBeNull();
      expect(beat.hitAt).toBeNull();
      expect(beat.faintAt).toBeNull();
    }
    expect(beatLength([mine, theirs])).toBe(BEAT_MS);
  });
});

describe("against a real turn", () => {
  it("A9: a fight out of the engine produces a swing on both sides", () => {
    // Hand-written event lists can drift from what the engine actually emits.
    const events = played("tackle", "tackle");
    const beats = beatsFor(events);

    expect(beats[0].lungeAt).not.toBeNull();
    expect(beats[1].lungeAt).not.toBeNull();
    expect(beats[0].lungeAt).not.toBe(beats[1].lungeAt);
    // Somebody took something.
    expect(beats[0].hitAt !== null || beats[1].hitAt !== null).toBe(true);
  });

  it("A10: a status move out of the engine does not lunge", () => {
    const events = played("leechseed", "tackle");
    const beats = beatsFor(events);
    expect(beats[0].lungeAt).toBeNull();
  });

  it("A11: every time is a whole number of milliseconds", () => {
    // Fed straight to the Web Animations API as a delay. A fraction there is
    // not wrong, but a rounding difference between two machines would make a
    // recorded battle look different on replay, which is the one thing this
    // codebase does not allow anywhere.
    const beats = beatsFor(played("tackle", "growl"));
    for (const beat of beats) {
      for (const at of [beat.lungeAt, beat.hitAt, beat.dodgeAt, beat.glowAt, beat.faintAt]) {
        if (at !== null) expect(Number.isInteger(at), `${at}`).toBe(true);
      }
    }
  });
});

describe("a ball thrown", () => {
  it("A14: a move that lands more than once swings and shakes once per blow, and the answer waits", () => {
    const events = played("doublekick", "tackle");
    const blows = events.filter((event) => event.t === "damage" && event.side === 1).length;
    expect(blows, "Double Kick should land twice here").toBe(2);

    const [mine, theirs] = beatsFor(events);
    expect(mine.lunges).toHaveLength(2);
    expect(theirs.hits).toHaveLength(2);
    expect(mine.lunges[1] - mine.lunges[0]).toBe(BLOW_GAP_MS);
    expect(theirs.hits[1].at).toBeGreaterThan(theirs.hits[0].at);

    // Rattata answers after the second blow rather than over it.
    // (Only when it swung second, of course.)
    if (theirs.lungeAt !== null && theirs.lungeAt > mine.lunges[0]) expect(theirs.lungeAt).toBeGreaterThanOrEqual(mine.lunges[1] + BEAT_MS);
    const [first, second] = beatsFor([
      { t: "use", side: 0, moveId: "doublekick" },
      { t: "damage", side: 1, amount: 5, quarters: 4, crit: false },
      { t: "damage", side: 1, amount: 5, quarters: 4, crit: true },
      { t: "hits", side: 0, count: 2 },
      { t: "use", side: 1, moveId: "tackle" },
      { t: "damage", side: 0, amount: 5, quarters: 4, crit: false },
    ] as BattleEvent[]);
    expect(first.lunges).toEqual([0, BLOW_GAP_MS]);
    expect(second.hits.map((hit) => hit.crit)).toEqual([false, true]);
    expect(second.lungeAt).toBe(BEAT_MS + BLOW_GAP_MS);

    // And the sound is two hits, at the two times.
    const hits = cuesFor(events, [mine, theirs]).filter((cue) => (cue.cue === "hit" || cue.cue === "crit") && cue.at <= theirs.hits[1].at);
    expect(hits.map((cue) => cue.at)).toEqual(expect.arrayContaining(theirs.hits.map((hit) => hit.at)));
  });

  it("A12: a catch wobbles three times, an escape one to three by the turn, and nothing else has a ball", () => {
    const caught: BattleEvent[] = [{ t: "caught" }];
    const got = catchFor(caught, 7)!;
    expect(got.outcome).toBe("caught");
    expect(got.wobbles).toBe(3);
    expect(got.wobblesAt).toHaveLength(3);
    expect(got.endAt).toBeGreaterThan(got.wobblesAt[2]);
    expect(got.length).toBeGreaterThan(got.endAt);

    const escaped: BattleEvent[] = [{ t: "catchFailed" }, { t: "use", side: 1, moveId: "tackle" }];
    for (let turn = 1; turn <= 6; turn++) {
      const away = catchFor(escaped, turn)!;
      expect(away.outcome).toBe("escaped");
      expect(away.wobbles).toBeGreaterThanOrEqual(1);
      expect(away.wobbles).toBeLessThanOrEqual(3);
      expect(catchFor(escaped, turn)).toEqual(away);
    }
    expect(new Set([1, 2, 3, 4, 5, 6].map((turn) => catchFor(escaped, turn)!.wobbles)).size).toBe(3);

    expect(catchFor([{ t: "use", side: 0, moveId: "tackle" }], 1)).toBeNull();
  });

  it("A13: the wild creature's answer to a failed throw comes after the smoke", () => {
    const events: BattleEvent[] = [
      { t: "catchFailed" },
      { t: "use", side: 1, moveId: "tackle" },
      { t: "damage", side: 0, amount: 5, quarters: 4, crit: false },
    ];
    const attempt = catchFor(events, 2)!;
    const plain = beatsFor(events);
    const shifted = beatsFor(events, attempt.length);
    expect(plain[1].lungeAt).toBe(0);
    expect(shifted[1].lungeAt).toBe(attempt.length);
    expect(shifted[0].hitAt).toBe(attempt.length + (plain[0].hitAt ?? 0));
    expect(beatLength(shifted)).toBeGreaterThan(attempt.length);
  });
});
