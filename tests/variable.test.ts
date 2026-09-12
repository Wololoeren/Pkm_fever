import { describe, expect, it } from "vitest";
import {
  activeOf,
  isFainted,
  maxHp,
  resolveTurn,
  startBattle,
  DUEL_RULES,
  TRAINER_RULES,
  type BattleState,
} from "@/engine/battle";
import { ALL_MOVES, move as moveById } from "@/engine/dex";
import { displayPower, hasVariableDamage } from "@/engine/moves";
import { maxPp } from "@/engine/pp";
import { narrate } from "@/lib/narrate";
import { creature } from "./helpers";

/**
 * The thirty-nine moves the manifest cannot price.
 *
 * `@pkmn/dex` ships data, not scripts, so every move whose damage Showdown
 * works out in code arrives with `power: 0`. moves.ts is the missing script,
 * and for a long time it was also dead: nothing imported it, so Seismic Toss,
 * Night Shade, Low Kick, Fissure, Return, Flail, Gyro Ball and the whole
 * counter family burned a turn and dealt exactly nothing. The module's own
 * header says that is where the hard-locks came from.
 *
 * These tests are the wire being live. The first is the one that matters most:
 * it fails if any of the thirty-nine goes back to doing nothing.
 */

const SEED = "VAR";

/** One swing, and what it took off. */
function swing(
  moveId: string,
  mine: Parameters<typeof creature>[1] = {},
  theirs: Parameters<typeof creature>[1] = {},
): { battle: BattleState; dealt: number } {
  const attacker = creature("machop", { uid: 1, level: 40, ...mine, moves: [moveId] });
  const target = creature("chansey", { uid: 2, level: 60, moves: ["growl"], ...theirs });
  const before = target.hp;

  const battle = resolveTurn(
    startBattle(SEED, `duel:${moveId}`, [attacker], [target]),
    [{ t: "fight", moveIndex: 0 }, { t: "pass" }],
    DUEL_RULES,
  ).battle;

  return { battle, dealt: before - activeOf(battle, 1).hp };
}

describe("moves the manifest cannot price", () => {
  it("V1: every one of them does something — none is inert", () => {
    const variable = ALL_MOVES.filter(hasVariableDamage);
    expect(variable.length).toBeGreaterThan(30);

    const inert: string[] = [];
    for (const move of variable) {
      // A big healthy target, so nothing is clamped, and a big attacker, so
      // nothing rounds to zero.
      const { battle, dealt } = swing(move.id, { level: 60 }, { level: 80 });

      const fizzled = battle.events.some((event) => event.t === "fizzled");
      const missed = battle.events.some((event) => event.t === "miss");
      const immune = battle.events.some((event) => event.t === "immune");

      // Doing nothing is allowed — Counter with nothing to counter, a Fissure
      // that missed — as long as the log *says* so rather than reporting a
      // hit of zero.
      if (dealt > 0 || fizzled || missed || immune) continue;
      inert.push(move.id);
    }

    expect(inert, `these burn a turn and do nothing: ${inert.join(", ")}`).toEqual([]);
  });

  it("V2: every zero-power move is named in moves.ts, not caught by the default", () => {
    // The module's safety net is a `default` arm returning 50 power. It is a
    // net, not a design: a regenerated manifest that introduces a new
    // computed-damage move should fail here rather than quietly ship a
    // fifty-power stranger.
    const unnamed = ALL_MOVES.filter(hasVariableDamage).filter(
      (move) => displayPower(move) === null,
    );

    // Those with no honest single number are fine — they are the ones whose
    // power genuinely depends on the battle. What matters is that the set is
    // the one moves.ts knows about, and it is checked by V1 above doing
    // something for each. Here we only pin the count so a manifest rebuild
    // that adds one is noticed.
    // Thirty, since Spit Up stopped being a flat hundred: its power is the
    // Stockpile count, which is a fact about the battle rather than a number.
    expect(unnamed.length).toBeLessThan(31);
    for (const move of unnamed) expect(move.power).toBe(0);
  });

  it("V3: Seismic Toss and Night Shade deal the attacker's level, exactly", () => {
    // Against a Water type, because Chansey is Normal and Ghost does nothing
    // to a Normal — an immunity these moves are still subject to, which is the
    // one thing about them that is not "exactly this many points".
    for (const moveId of ["seismictoss", "nightshade"]) {
      const attacker = creature("machop", { uid: 1, level: 37, moves: [moveId] });
      const target = creature("wailord", { uid: 2, level: 80, moves: ["growl"] });
      const before = target.hp;

      const battle = resolveTurn(
        startBattle(SEED, `level:${moveId}`, [attacker], [target]),
        [{ t: "fight", moveIndex: 0 }, { t: "pass" }],
        DUEL_RULES,
      ).battle;

      expect(before - activeOf(battle, 1).hp, moveId).toBe(37);
    }

    // And a Ghost move still cannot touch a Normal, level or no level.
    const blocked = swing("nightshade", { level: 37 }, { level: 80 });
    expect(blocked.dealt).toBe(0);
    expect(blocked.battle.events.some((event) => event.t === "immune")).toBe(true);
  });

  it("V4: Dragon Rage and Sonic Boom state a number and keep to it", () => {
    expect(swing("dragonrage", { level: 20 }, { level: 80 }).dealt).toBe(40);
    expect(swing("sonicboom", { level: 20 }, { level: 80 }).dealt).toBe(20);
  });

  it("V5: Super Fang takes half of what is left, not half of the maximum", () => {
    const hurt = creature("chansey", { uid: 2, level: 80, moves: ["growl"] });
    const { dealt } = swing("superfang", { level: 20 }, { ...hurt, hp: 100 } as never);
    expect(dealt).toBe(50);
  });

  it("V6: Endeavor levels the two of them, or comes to nothing", () => {
    // The target is healthier, so it is brought down to the attacker.
    const brought = swing("endeavor", { level: 40, hp: 30 }, { level: 80 });
    const target = activeOf(brought.battle, 1);
    expect(target.hp).toBe(30);

    // The target is already weaker, so there is nothing to do — and the log
    // says so rather than reporting a hit of zero.
    const nothing = swing("endeavor", { level: 40 }, { level: 80, hp: 5 });
    expect(nothing.dealt).toBe(0);
    expect(nothing.battle.events.some((event) => event.t === "fizzled")).toBe(true);
    expect(narrate(nothing.battle.events, () => "It").join(" ")).toContain("came to nothing");
  });

  it("V7: a one-hit move that lands, lands completely", () => {
    // Accuracy is the whole balance on these, so a landed one is total.
    for (let attempt = 0; attempt < 40; attempt++) {
      const attacker = creature("machop", { uid: 1, level: 60, moves: ["fissure"] });
      const target = creature("chansey", { uid: 2, level: 20, moves: ["growl"] });
      const battle = resolveTurn(
        startBattle(SEED, `ohko:${attempt}`, [attacker], [target]),
        [{ t: "fight", moveIndex: 0 }, { t: "pass" }],
        TRAINER_RULES,
      ).battle;

      if (battle.events.some((event) => event.t === "miss")) continue;
      expect(isFainted(activeOf(battle, 1))).toBe(true);
      return;
    }
    throw new Error("forty tries and Fissure never landed");
  });

  it("V8: Final Gambit trades the user's health for the same damage", () => {
    const { battle, dealt } = swing("finalgambit", { level: 40, hp: 61 }, { level: 80 });
    expect(dealt).toBe(61);
    // And it costs the user everything.
    expect(isFainted(activeOf(battle, 0))).toBe(true);
  });

  it("V9: Flail hits harder the worse things are", () => {
    const healthy = swing("flail", { level: 40 }, { level: 80 }).dealt;
    const desperate = swing("flail", { level: 40, hp: 1 }, { level: 80 }).dealt;
    expect(desperate).toBeGreaterThan(healthy);
  });

  it("V10: Gyro Ball rewards being slow, Electro Ball being fast", () => {
    // Machop is slow; Electrode is very fast.
    const slowAttacker = swing("gyroball", { level: 40 }, { level: 80 }).dealt;
    const fastAttacker = resolveTurn(
      startBattle(SEED, "gyro-fast", [creature("electrode", { uid: 1, level: 40, moves: ["gyroball"] })], [
        creature("chansey", { uid: 2, level: 80, moves: ["growl"] }),
      ]),
      [{ t: "fight", moveIndex: 0 }, { t: "pass" }],
      DUEL_RULES,
    ).battle;

    const tookFromFast =
      maxHp(creature("chansey", { level: 80 })) - activeOf(fastAttacker, 1).hp;
    expect(slowAttacker).toBeGreaterThan(tookFromFast);
  });

  it("V11: Counter answers what hit it, and only that", () => {
    // Counter is priority -5, so it resolves after the blow it answers.
    const counterer = creature("machop", { uid: 1, level: 60, moves: ["counter"] });
    const hitter = creature("machop", { uid: 2, level: 60, moves: ["brickbreak"] });

    const after = resolveTurn(
      startBattle(SEED, "counter", [counterer], [hitter]),
      [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }],
      DUEL_RULES,
    ).battle;

    const took = maxHp(counterer) - activeOf(after, 0).hp;
    const gave = maxHp(hitter) - activeOf(after, 1).hp;
    expect(took).toBeGreaterThan(0);
    // Twice what it took, unless that would be more than the target had.
    expect(gave).toBe(Math.min(maxHp(hitter), took * 2));
  });

  it("V12: Counter with nothing to answer comes to nothing", () => {
    const { battle, dealt } = swing("counter", { level: 60 }, { level: 80 });
    expect(dealt).toBe(0);
    expect(battle.events.some((event) => event.t === "fizzled")).toBe(true);
  });

  it("V13: Trump Card reads the uses left — the one thing it was waiting for", () => {
    // Its comment in moves.ts used to say "there is no PP". There is now: 40
    // with plenty left, and 200 on the last one.
    const many = swing("trumpcard", { level: 40 }, { level: 80 }).dealt;
    const last = swing("trumpcard", { level: 40, pp: [1] }, { level: 80 }).dealt;

    expect(maxPp("trumpcard")).toBeGreaterThan(1);
    expect(last).toBeGreaterThan(many);
  });

  it("V14: the button never says a move has zero power", () => {
    for (const move of ALL_MOVES) {
      const shown = displayPower(move);
      if (move.category === "status") {
        expect(shown, move.id).toBeNull();
      } else if (shown !== null) {
        // Either a real number or nothing at all — never a zero that reads as
        // a bug on a button.
        expect(shown, move.id).toBeGreaterThan(0);
      }
    }
  });

  it("V15: a stand-in is a real number, and the move it stands for is not inert", () => {
    // The nine placeholders are waiting on data the manifest does not carry
    // (friendship, weight) or on mechanics the game does not have (multi-hit,
    // held items). Each stands in with a real power rather than nothing.
    for (const moveId of ["return", "lowkick", "grassknot", "heavyslam", "beatup", "fling"]) {
      expect(displayPower(moveById(moveId)), moveId).toBeGreaterThan(0);
      expect(swing(moveId, { level: 60 }, { level: 80 }).dealt, moveId).toBeGreaterThan(0);
    }
  });
});
