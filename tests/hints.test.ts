import { describe, expect, it } from "vitest";
import { dealHints, hint, HINTS } from "@/engine/hints";
import { opponentHint } from "@/engine/engine";
import { startBattle } from "@/engine/battle";
import { STEPS_PER_EGG } from "@/engine/breeding";
import { CENSUS_TOTAL } from "@/engine/variants";
import { CUP_SIZE } from "@/engine/cup";
import { LEVELS_PER_BADGE, MOVES_PER_LEVEL } from "@/engine/gyms";
import { LURE_MOVES } from "@/engine/items";
import { NATURE_MAGNITUDE } from "@/engine/natures";
import { REMATCH_AFTER, REMATCH_LEVELS } from "@/engine/engine";
import { RIVAL_BEHIND, RIVAL_EVERY, RIVAL_STALK } from "@/engine/rival";
import { SHINE_PRICE } from "@/engine/npc";
import { EV_MAX_PER_STAT, EV_MAX_TOTAL, WILD_IV_MAX } from "@/engine/stats";
import { rngFor } from "@/engine/rng";
import { creature, testWorld } from "./helpers";

describe("what the people on the routes know", () => {
  it("HN1: every hint has a distinct id and something to say", () => {
    const ids = HINTS.map((one) => one.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const one of HINTS) {
      expect(one.id).toMatch(/^[a-z0-9-]+$/);
      // Long enough to be a fact rather than a slogan, short enough to read
      // before a battle starts.
      expect(one.text.length).toBeGreaterThan(60);
      expect(one.text.length).toBeLessThan(420);
    }
  });

  it("HN2: there are enough of them to be worth walking to", () => {
    // The point of the feature is that a player meets a lot of trainers and
    // keeps learning. A handful of hints spread over two hundred and seventy
    // people is the thing this replaced, so the count is the feature.
    expect(HINTS.length).toBeGreaterThanOrEqual(90);
  });

  /**
   * The deck, which is the whole reason `dealHints` is not a roll.
   *
   * Rolling independently per trainer would repeat inside the first dozen
   * people and hand out roughly sixty distinct hints across the hundred a
   * player meets early on. A deck hands out every one before it repeats any.
   */
  it("HN3: every hint is dealt before any is dealt twice", () => {
    const dealt = dealHints(rngFor("HINTS1", "deal"), HINTS.length);
    expect(new Set(dealt).size).toBe(HINTS.length);
  });

  it("HN4: a world with more people than hints cycles rather than running dry", () => {
    const wanted = HINTS.length * 3 + 7;
    const dealt = dealHints(rngFor("HINTS2", "deal"), wanted);

    expect(dealt).toHaveLength(wanted);
    expect(dealt.every((id) => hint(id) !== null)).toBe(true);
    // Each hint used three or four times, never eleven.
    const counts = new Map<string, number>();
    for (const id of dealt) counts.set(id, (counts.get(id) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(4);
  });

  it("HN5: the deck is shuffled again rather than repeating its order", () => {
    const twice = dealHints(rngFor("HINTS3", "deal"), HINTS.length * 2);
    const first = twice.slice(0, HINTS.length);
    const second = twice.slice(HINTS.length);
    expect(second).not.toEqual(first);
    expect(new Set(second).size).toBe(HINTS.length);
  });
});

describe("who is carrying which", () => {
  it("HN6: every route trainer has one, and it is a real one", () => {
    const world = testWorld("HINTW1");
    const onRoutes = [...world.trainers.entries()].filter(
      ([routeId]) => world.routes.get(routeId)?.kind === "route",
    );

    const people = onRoutes.flatMap(([, here]) => here);
    expect(people.length).toBeGreaterThan(150);
    for (const who of people) {
      expect(who.hintId).toBeTruthy();
      expect(hint(who.hintId!)).not.toBeNull();
    }
  });

  /**
   * The written cast keep their own jokes.
   *
   * A town trainer's punchline is their team — a council of one man fielded as
   * five Dittos — and a fact about the crit ladder coming out of them would be
   * a fact standing where a joke was.
   */
  it("HN7: the town trainers have none", () => {
    const world = testWorld("HINTW1");
    const inTowns = [...world.trainers.entries()]
      .filter(([routeId]) => world.routes.get(routeId)?.kind !== "route")
      .flatMap(([, here]) => here);

    expect(inTowns.length).toBeGreaterThan(0);
    for (const who of inTowns) expect(who.hintId).toBeUndefined();
  });

  it("HN8: the same seed deals the same people the same lines, and another seed does not", () => {
    const one = testWorld("HINTW1");
    const again = testWorld("HINTW1");
    const other = testWorld("HINTW2");

    const read = (world: typeof one) =>
      [...world.trainers.keys()]
        .sort()
        .flatMap((id) => world.trainers.get(id)!.map((who) => `${who.id}=${who.hintId}`));

    expect(read(again)).toEqual(read(one));
    expect(read(other)).not.toEqual(read(one));
  });

  it("HN9: a world spreads them widely rather than saying four things a lot", () => {
    const world = testWorld("HINTW1");
    const used = new Set(
      [...world.trainers.values()].flat().map((who) => who.hintId).filter(Boolean),
    );
    // Two hundred and seventy people against a hundred-odd hints: every one of
    // them should be standing somewhere.
    expect(used.size).toBe(HINTS.length);
  });
});

describe("saying it", () => {
  it("HN10: a trainer battle carries the line and a wild one does not", () => {
    const world = testWorld("HINTW1");
    const who = [...world.trainers.values()]
      .flat()
      .find((one) => one.hintId !== undefined)!;

    const mine = [creature("pidgey", { uid: 1 })];
    const theirs = [creature("rattata", { uid: 2 })];

    const duel = startBattle(world.seed, `trainer:${who.id}`, mine, theirs, 0);
    expect(opponentHint(world, duel)?.id).toBe(who.hintId);

    const wild = startBattle(world.seed, "wild:test", mine, theirs, 0);
    expect(opponentHint(world, wild)).toBeNull();
  });

  it("HN11: the characters keep their own words", () => {
    const world = testWorld("HINTW1");
    const mine = [creature("pidgey", { uid: 1 })];
    const theirs = [creature("rattata", { uid: 2 })];

    // A gym leader, the rival and a Cup contender all have written lines and
    // are people rather than passers-by.
    for (const tag of ["gym:stone", "rival:1", "cup:1"]) {
      expect(opponentHint(world, startBattle(world.seed, tag, mine, theirs, 0))).toBeNull();
    }
    expect(opponentHint(world, null)).toBeNull();
  });
});

/**
 * The numbers, checked against the engine that owns them.
 *
 * A hint that is merely plausible is worse than no hint, because it will be
 * believed — and the way a hundred sentences of arithmetic go wrong is not all
 * at once, it is one constant changed months later by somebody with no reason
 * to think a sentence was reading it. This is `tests/statusdoc.test.ts`'s idea
 * applied to dialogue: each row names a constant, the phrase written against
 * it, and the value that phrase was written for. Change the constant and the
 * test fails naming both, which is the only useful thing it could say.
 *
 * Spelled out rather than in digits because these are people talking. That is
 * why the row carries the phrase instead of deriving it: there is no honest
 * way to compute "three hundred steps" from `300` that is shorter than
 * writing it down.
 */
describe("the numbers are the engine's", () => {
  const GUARDED: {
    id: string;
    phrase: string;
    constant: string;
    actual: number;
    written: number;
  }[] = [
    { id: "egg-steps", phrase: "three hundred steps", constant: "STEPS_PER_EGG", actual: STEPS_PER_EGG, written: 300 },
    { id: "wild-ivs-cap", phrase: "Nought to six", constant: "WILD_IV_MAX", actual: WILD_IV_MAX, written: 6 },
    { id: "natures-add", phrase: "Twenty-four points", constant: "NATURE_MAGNITUDE", actual: NATURE_MAGNITUDE, written: 24 },
    { id: "effort-from-fighting", phrase: "two hundred and fifty-two", constant: "EV_MAX_PER_STAT", actual: EV_MAX_PER_STAT, written: 252 },
    { id: "effort-from-fighting", phrase: "five hundred and ten", constant: "EV_MAX_TOTAL", actual: EV_MAX_TOTAL, written: 510 },
    { id: "rematch", phrase: "a thousand steps", constant: "REMATCH_AFTER", actual: REMATCH_AFTER, written: 1000 },
    { id: "rematch", phrase: "Three levels", constant: "REMATCH_LEVELS", actual: REMATCH_LEVELS, written: 3 },
    { id: "lure-reaches", phrase: "five hundred moves", constant: "LURE_MOVES", actual: LURE_MOVES, written: 500 },
    { id: "gyms-scale", phrase: "five levels", constant: "LEVELS_PER_BADGE", actual: LEVELS_PER_BADGE, written: 5 },
    { id: "gyms-scale", phrase: "every thousand moves", constant: "MOVES_PER_LEVEL", actual: MOVES_PER_LEVEL, written: 1000 },
    { id: "census-is-placed", phrase: "Fifty-eight", constant: "CENSUS_TOTAL", actual: CENSUS_TOTAL, written: 58 },
    { id: "rival-no-escape", phrase: "three steps behind you for twenty moves", constant: "RIVAL_BEHIND/RIVAL_STALK", actual: RIVAL_BEHIND * 100 + RIVAL_STALK, written: 320 },
    { id: "cup-no-healing", phrase: "five of them, six each", constant: "CUP_SIZE", actual: CUP_SIZE, written: 6 },
  ];

  it.each(GUARDED)("HN12: $id still says the truth about $constant", (row) => {
    const one = hint(row.id);
    expect(one, `no hint with id ${row.id}`).not.toBeNull();
    expect(
      one!.text,
      `${row.id} should contain "${row.phrase}"`,
    ).toContain(row.phrase);
    expect(
      row.actual,
      `${row.constant} has changed, so the hint "${row.id}" no longer tells the truth — rewrite the line, do not change this number`,
    ).toBe(row.written);
  });

  it("HN13: the rival's interval is still what he says it is", () => {
    expect(RIVAL_EVERY).toBe(2500);
    expect(hint("rival-builds-on-you")!.text).toContain("three levels above your average");
  });

  it("HN14: what a rung of shine is worth at the counter", () => {
    expect(SHINE_PRICE).toBe(1000);
  });
});
