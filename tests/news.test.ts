import { describe, expect, it } from "vitest";
import { applyInput, initialState, type GameState } from "@/engine/engine";
import { newsItem, NEWS_KEPT, NEWS_LEVELS, NEWS_QUIET } from "@/engine/news";
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
