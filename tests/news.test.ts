import { describe, expect, it } from "vitest";
import { applyInput, initialState, type GameState } from "@/engine/engine";
import { startBattle } from "@/engine/battle";
import { expForLevel } from "@/engine/progression";
import { newsItem, NEWS_KEPT, NEWS_LEVELS, NEWS_QUIET, NEWS_WILD_EVERY } from "@/engine/news";
import { creature, testWorld } from "./helpers";

/**
 * The feed: a channel that comments on your own game, written from the seed
 * so a replay writes it word for word.
 */

const SEED = "NEWS1";

/** Walks one step, whichever way there is room for. */
function step(world: ReturnType<typeof testWorld>, state: GameState): GameState {
  for (const dir of ["n", "s", "e", "w"] as const) {
    try {
      return applyInput(world, state, { t: "move", dir });
    } catch {
      /* walled */
    }
  }
  throw new Error("boxed in");
}

describe("the feed", () => {
  it("NW1: a line is the seed's, not a roll's — the same game writes the same feed", () => {
    const one = newsItem(SEED, 400, "caught", { creature: creature("zubat", { uid: 1, level: 7 }) });
    const two = newsItem(SEED, 400, "caught", { creature: creature("zubat", { uid: 1, level: 7 }) });
    expect(one).toEqual(two);
    expect(one.text).toContain("Zubat");
    expect(one.kind).toBe("caught");

    // A shiny catch is its own sort of line.
    const shiny = newsItem(SEED, 400, "caught", {
      creature: creature("zubat", { uid: 1, level: 7, variantId: "shiny" }),
    });
    expect(shiny.kind).toBe("shiny");

    // Every blank is filled: no line ever reaches a player with a {name} in it.
    for (const at of [0, 1, 2, 3, 5, 8, 13, 21]) {
      for (const kind of ["caught", "hatched", "evolved", "level", "badge", "beaten", "idle"] as const) {
        const item = newsItem(SEED, at, kind, {
          creature: creature("pikachu", { uid: 2, level: 50 }),
          level: 50,
          badges: 3,
          steps: 1234,
        });
        expect(item.text, `${kind} at ${at}`).not.toMatch(/\{\w+\}/);
        expect(item.text.length).toBeGreaterThan(10);
      }
    }
  });

  it("NW2: it speaks up when the quiet has gone on long enough, and not before", () => {
    const world = testWorld(SEED);
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    expect(base.news).toHaveLength(0);

    // Early on it has nothing to say: the quiet starts when the game does.
    expect(step(world, { ...base, stepsTaken: 10 }).news).toHaveLength(0);

    // The step that crosses the quiet is the one that gets a line.
    const spoke = step(world, { ...base, stepsTaken: NEWS_QUIET - 1 });
    expect(spoke.news).toHaveLength(1);
    expect(spoke.news[0].at).toBe(NEWS_QUIET);
    expect(spoke.news[0].kind).toBe("idle");

    // And then it is quiet again until the next four hundred.
    const after = step(world, spoke);
    expect(after.news).toHaveLength(1);
    expect(step(world, { ...spoke, stepsTaken: spoke.stepsTaken + NEWS_QUIET - 1 }).news).toHaveLength(2);
  });

  it("NW3: a level worth remarking on gets remarked on, once", () => {
    const world = testWorld(SEED);
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const young = creature("machop", { uid: 40, level: 49 });
    const state: GameState = { ...base, party: [young], news: [] };

    // Levelling it over fifty with a Rare Candy is the shortest road there.
    const raised = applyInput(
      world,
      { ...state, bag: { ...state.bag, rarecandy: 1 } },
      { t: "useItem", item: "rarecandy", index: 0 },
    );
    expect(raised.party[0].level).toBe(50);
    expect(raised.news.at(-1)?.kind).toBe("level");
    expect(raised.news.at(-1)?.text).toContain("50");
    expect(NEWS_LEVELS).toEqual([50, 60, 70, 80, 90, 100]);

    // And nothing more for the level after it, which is not one of the six.
    const again = applyInput(world, { ...raised, bag: { ...raised.bag, rarecandy: 1 } }, { t: "useItem", item: "rarecandy", index: 0 });
    expect(again.party[0].level).toBe(51);
    expect(again.news).toHaveLength(raised.news.length);
  });


  it("NW5: the grass is a tally, not an event — one line every thirty", () => {
    const world = testWorld(SEED);
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    /*
     * One wild fight, won. A level 60 Machamp against a level 2 Magikarp is
     * the shortest road to a `won` notice through the real path — which is
     * the path that decides whether anything is said about it.
     */
    const fight = (state: GameState, tag: string): GameState => {
      const party = [creature("machamp", { uid: 1, level: 60, moves: ["karatechop"] })];
      const ready: GameState = {
        ...state,
        party,
        phase: "battle",
        battle: startBattle(world.seed, tag, party, [creature("magikarp", { uid: 2, level: 2, moves: ["splash"] })], 0),
      };
      const done = applyInput(world, ready, { t: "fight", moveIndex: 0 });
      // A wild win says `won`; a person says `beatTrainer`, because a person
      // pays a purse. That difference is what this test is about.
      expect(["won", "beatTrainer"], "the fixture did not actually win").toContain(done.notice?.t);
      return done;
    };

    let live: GameState = { ...base, news: [] };
    for (let at = 1; at < NEWS_WILD_EVERY; at++) {
      live = fight(live, `wild:meadow-1:${at}`);
      expect(live.wildsFought, `after ${at}`).toBe(at);
      expect(live.news, `after ${at}`).toHaveLength(0);
    }

    // The thirtieth is the one that gets a line, and it counts them.
    live = fight(live, "wild:meadow-1:30");
    expect(live.wildsFought).toBe(NEWS_WILD_EVERY);
    expect(live.news).toHaveLength(1);
    expect(live.news[0].kind).toBe("wild");
    expect(live.news[0].text).toContain(String(NEWS_WILD_EVERY));
    expect(live.news[0].text).not.toMatch(/\{\w+\}/);
    // Never a trainer: the grass is not a person, and used to be reported as one.
    expect(live.news[0].text).not.toContain("trainer");

    // And then quiet again for another thirty.
    live = fight(live, "wild:meadow-1:31");
    expect(live.news).toHaveLength(1);

    // Somebody standing on a route is still an event, every time.
    const met = fight({ ...live, news: [] }, "trainer:meadow-1:0");
    expect(met.news).toHaveLength(1);
    expect(met.news[0].kind).toBe("trainer");
    // And beating one does not touch the grass's tally.
    expect(met.wildsFought).toBe(live.wildsFought);
  });


  it("NW6: two pieces of news from one input are both written down", () => {
    const world = testWorld(SEED);
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    /*
     * The case that was being lost: the experience for a win takes somebody
     * past fifty on the same input as the win. The old `reported` returned on
     * the first thing it found, so the fifty - the rarer and by far the more
     * interesting of the two - was never written at all, on your own feed or
     * on your friends'.
     */
    const nearly = creature("machamp", { uid: 1, level: 49, moves: ["karatechop"] });
    const party = [{ ...nearly, exp: expForLevel(50) - 1 }];
    const ready: GameState = {
      ...base,
      news: [],
      party,
      phase: "battle",
      battle: startBattle(world.seed, "wild:meadow-1:7", party, [creature("blissey", { uid: 2, level: 40, moves: ["splash"] })], 0),
    };

    const done = applyInput(world, ready, { t: "fight", moveIndex: 0 });
    expect(done.party[0].level, "the fixture did not actually level").toBeGreaterThanOrEqual(50);
    expect(done.news.map((one) => one.kind)).toContain("level");
    expect(done.news.at(-1)?.text).toContain("50");

    // And the win it came with still counts towards the grass's tally.
    expect(done.wildsFought).toBe(1);
  });


  it("NW7: a catch names what was caught, not the last thing in your box", () => {
    const world = testWorld(SEED);
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    /*
     * The arrival used to be found as "the last of the party and the box laid
     * end to end", which is the caught one only when the box is empty or the
     * party was full. With anything at all in the box, the feed announced the
     * last creature in the box - one of yours, caught weeks ago.
     */
    const party = [creature("machamp", { uid: 1, level: 60, moves: ["karatechop"] })];
    const wild = creature("dratini", { uid: 9, level: 5, moves: ["wrap"] });
    const ready: GameState = {
      ...base,
      news: [],
      party,
      box: [creature("rattata", { uid: 2, level: 3 }), creature("zubat", { uid: 3, level: 4 })],
      bag: { masterball: 1 },
      phase: "battle",
      battle: startBattle(world.seed, "wild:meadow-1:3", party, [wild], 0),
    };

    const done = applyInput(world, ready, { t: "ball", item: "masterball" });
    expect(done.notice, "the fixture did not actually catch it").toMatchObject({ t: "caught" });
    expect(done.news.at(-1)?.kind).toBe("caught");
    expect(done.news.at(-1)?.text).toContain("Dratini");
    expect(done.news.at(-1)?.text).not.toContain("Zubat");

    // And with a full party, where it goes to the box instead.
    const full: GameState = {
      ...ready,
      party: [...party, ...Array.from({ length: 5 }, (_, at) => creature("rattata", { uid: 20 + at, level: 3 }))],
    };
    const boxed = applyInput(world, { ...full, battle: startBattle(world.seed, "wild:meadow-1:4", full.party, [wild], 0) }, { t: "ball", item: "masterball" });
    expect(boxed.notice).toMatchObject({ t: "caught" });
    expect(boxed.news.at(-1)?.text).toContain("Dratini");
  });


  it("NW8: a line about somebody carries a face to draw, and a line about nobody does not", () => {
    const zubat = creature("zubat", { uid: 1, level: 7, heldItem: "hold-leftovers" });
    const caught = newsItem(SEED, 400, "caught", { creature: zubat });
    expect(caught.face).toEqual({ speciesId: "zubat", variantId: zubat.variantId, heldItem: "hold-leftovers" });

    // Enough to draw and no more: a copy of the creature would go stale while
    // the creature itself carried on levelling.
    expect(Object.keys(caught.face!).sort()).toEqual(["heldItem", "speciesId", "variantId"]);

    // A badge and a beating are about nobody, and draw nothing.
    expect(newsItem(SEED, 400, "badge", { badges: 3 }).face).toBeUndefined();
    expect(newsItem(SEED, 400, "beaten", {}).face).toBeUndefined();

    // And it travels: the feed's own line about a catch is the one that arrives.
    const world = testWorld(SEED);
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const party = [creature("machamp", { uid: 1, level: 60, moves: ["karatechop"] })];
    const done = applyInput(
      world,
      {
        ...base,
        news: [],
        party,
        bag: { masterball: 1 },
        phase: "battle",
        battle: startBattle(world.seed, "wild:meadow-1:5", party, [creature("dratini", { uid: 9, level: 5, moves: ["wrap"] })], 0),
      } as GameState,
      { t: "ball", item: "masterball" },
    );
    expect(done.news.at(-1)?.face?.speciesId).toBe("dratini");
  });

  it("NW4: it keeps the last forty and no more", () => {
    const world = testWorld(SEED);
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const full = Array.from({ length: NEWS_KEPT }, (_, at) => newsItem(SEED, at, "idle", { creature: base.party[0] }));
    const state: GameState = { ...base, party: [creature("machop", { uid: 9, level: 49 })], news: full };

    const after = applyInput(
      world,
      { ...state, bag: { ...state.bag, rarecandy: 1 } },
      { t: "useItem", item: "rarecandy", index: 0 },
    );
    expect(after.news).toHaveLength(NEWS_KEPT);
    expect(after.news.at(-1)!.kind).toBe("level");
    expect(after.news[0].at).toBe(1);
  });
});
