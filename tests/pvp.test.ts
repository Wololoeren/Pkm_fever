import { describe, expect, it } from "vitest";
import { DuelSession, type DuelMessage } from "@/engine/duel";
import { learnableAt } from "@/engine/dex";
import { maxPp } from "@/engine/pp";
import { applyInput, initialState, MAX_MOVES, movesRefusal, reduce, stateHash, type Input } from "@/engine/engine";
import { cheatPrizeOffer } from "@/engine/prize";
import { STAT_IDS } from "@/engine/types";
import { TradeSession, type TradeMessage } from "@/engine/trade";
import type { Individual } from "@/engine/types";
import { countOf } from "@/engine/items";
import { creature, testWorld } from "./helpers";

/**
 * Playing against another person: agreeing a format, swapping creatures, and
 * the one place the "a save proves what you earned" property gives way.
 */

function inTown(seed = "PKMFEVER1") {
  const world = testWorld(seed);
  const state = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  return { world, state };
}

/** Out of town and onto the first ring, whichever way the town opens. */
function walkOut(world: ReturnType<typeof testWorld>, from: ReturnType<typeof initialState>) {
  let state = from;
  for (let i = 0; i < 60 && world.routes.get(state.route)?.kind !== "route"; i++) {
    try {
      state = applyInput(world, state, { t: "move", dir: "e" });
    } catch {
      break;
    }
  }
  return state;
}

/** Two trade sessions wired to each other, with no network in between. */
function connectTrade() {
  const bus: Array<["a" | "b", TradeMessage]> = [];
  const a = new TradeSession((message) => bus.push(["b", message]));
  const b = new TradeSession((message) => bus.push(["a", message]));

  const pump = () => {
    let guard = 0;
    while (bus.length && guard++ < 200) {
      const [to, message] = bus.shift()!;
      (to === "a" ? a : b).receive(message);
    }
  };

  return { a, b, pump };
}

describe("agreeing a format", () => {
  it("P1: bringing different numbers is refused rather than quietly trimmed", async () => {
    // Truncating the longer team would throw away creatures its owner picked
    // on purpose, and padding the shorter one is not possible at all.
    const bus: Array<["a" | "b", DuelMessage]> = [];
    const a = new DuelSession([creature("machop", { uid: 1 }), creature("squirtle", { uid: 2 })], (m) =>
      bus.push(["b", m]),
    );
    const b = new DuelSession([creature("machop", { uid: 3 })], (m) => bus.push(["a", m]));

    await a.open();
    await b.open();
    for (let i = 0; bus.length && i < 50; i++) {
      const [to, message] = bus.shift()!;
      await (to === "a" ? a : b).receive(message);
    }

    expect(a.view().fault).toEqual({ t: "sizeMismatch", ours: 2, theirs: 1 });
    expect(a.view().battle).toBeNull();
  });
});

describe("trading", () => {
  it("P2: both see both offers before either agrees", () => {
    const { a, b, pump } = connectTrade();
    a.offer(creature("machop", { uid: 1 }));
    pump();

    // One offer is not a trade; there is nothing yet to agree to.
    expect(a.view().phase).toBe("offering");
    expect(b.view().theirs?.uid).toBe(1);

    b.offer(creature("squirtle", { uid: 2 }));
    pump();

    expect(a.view().phase).toBe("reviewing");
    expect(a.view().theirs?.uid).toBe(2);
    expect(b.view().theirs?.uid).toBe(1);
  });

  it("P3: it completes only when both have agreed to the same pair", () => {
    const { a, b, pump } = connectTrade();
    a.offer(creature("machop", { uid: 1 }));
    b.offer(creature("squirtle", { uid: 2 }));
    pump();

    a.accept();
    pump();
    expect(a.view().phase).toBe("waiting");
    expect(a.view().completed).toBeNull();

    b.accept();
    pump();

    expect(a.view().completed).toEqual({
      given: expect.objectContaining({ uid: 1 }),
      received: expect.objectContaining({ uid: 2 }),
    });
    expect(b.view().completed).toEqual({
      given: expect.objectContaining({ uid: 2 }),
      received: expect.objectContaining({ uid: 1 }),
    });
  });

  it("P4: switching your offer after they agree voids their agreement", () => {
    // Otherwise you could take somebody's yes and complete against something
    // they never saw.
    const { a, b, pump } = connectTrade();
    a.offer(creature("machop", { uid: 1 }));
    b.offer(creature("squirtle", { uid: 2 }));
    pump();

    b.accept();
    pump();
    expect(a.view().theyAccepted).toBe(true);

    a.offer(creature("caterpie", { uid: 3 }));
    pump();

    expect(a.view().theyAccepted).toBe(false);
    a.accept();
    pump();
    expect(a.view().completed).toBeNull();
  });

  it("P5: either side can call it off", () => {
    const { a, b, pump } = connectTrade();
    a.offer(creature("machop", { uid: 1 }));
    b.offer(creature("squirtle", { uid: 2 }));
    pump();

    b.cancel();
    pump();
    expect(a.view().phase).toBe("cancelled");
  });
});

describe("what a trade does to the save", () => {
  it("P6: the arrival is renumbered and marked", () => {
    // uids are unique within one save, not across two: both players have been
    // handing out uid 1 since they started.
    const { world, state } = inTown();
    const incoming: Individual = { ...creature("squirtle", { uid: 1, level: 30 }), traded: false };

    const after = applyInput(world, state, { t: "trade", give: 0, receive: incoming });
    const arrival = after.party[0];

    expect(arrival.speciesId).toBe("squirtle");
    expect(arrival.traded).toBe(true);
    expect(arrival.uid).not.toBe(state.party[0].uid);
    expect(after.party).toHaveLength(state.party.length);
    expect(after.cheated).toBe(false);
  });

  it("P7: trading happens in town, like everything else you walk back for", () => {
    const { world, state } = inTown();
    const outside = walkOut(world, state);
    expect(world.routes.get(outside.route)?.kind).toBe("route");

    expect(() =>
      applyInput(world, outside, { t: "trade", give: 0, receive: creature("squirtle", { uid: 9 }) }),
    ).toThrow();
  });
});

describe("the testing shortcuts", () => {
  it("P8: a cheat marks the save, and the mark does not wash off", () => {
    // The whole reason cheats are inputs rather than edits: a save that used
    // one says so, and replaying it at a tournament check-in still says so.
    const { world, state } = inTown();
    expect(state.cheated).toBe(false);

    const cheated = applyInput(world, state, { t: "cheat", cheat: { op: "balls", count: 50 } });
    expect(cheated.cheated).toBe(true);
    expect(countOf(cheated.bag, "pokeball")).toBe(countOf(state.bag, "pokeball") + 50);

    const later = applyInput(world, cheated, { t: "move", dir: "n" });
    expect(later.cheated).toBe(true);
  });

  it("P9: a cheated save replays as cheated", () => {
    const { world, state } = inTown();
    const cheated = applyInput(world, state, {
      t: "cheat",
      cheat: { op: "give", speciesId: "mewtwo", level: 100, variantId: "shiny", gender: "female" },
    });

    const given = [...cheated.party, ...cheated.box].at(-1)!;
    expect(given.speciesId).toBe("mewtwo");
    expect(given.variantId).toBe("shiny");
    expect(given.level).toBe(100);
    expect(cheated.cheated).toBe(true);
  });

  it("P10: warping records the arrival, so item finds still fire", () => {
    const { world, state } = inTown();
    const warped = applyInput(world, state, { t: "cheat", cheat: { op: "warp", route: "meadow-4" } });

    expect(warped.route).toBe("meadow-4");
    expect(warped.visited).toContain("meadow-4");
    expect(() => applyInput(world, state, { t: "cheat", cheat: { op: "warp", route: "nowhere" } })).toThrow();
  });
});


describe("choosing moves", () => {
  it("P11: you pick from everything it has naturally learned by now", () => {
    const { world, state } = inTown();
    const lead = state.party[0];
    const pool = learnableAt(lead.speciesId, lead.level);

    expect(pool.length).toBeGreaterThan(0);
    // What it walks around with is a subset of what it knows.
    for (const moveId of lead.moves) expect(pool).toContain(moveId);

    const chosen = pool.slice(0, Math.min(MAX_MOVES, pool.length));
    const after = applyInput(world, state, { t: "setMoves", index: 0, moves: chosen });
    expect(after.party[0].moves).toEqual(chosen);

    // And the uses follow the moves rather than the slots. Rearranged, a
    // move keeps what it had left; swapped out for another, the new one
    // arrives full — and never with more than its own maximum, which is how
    // a five-use move used to come out of here with forty.
    const spent = {
      ...after.party[0],
      pp: after.party[0].moves.map((moveId, at) => (at === 0 ? 1 : maxPp(moveId))),
    };
    const swapped = applyInput(
      world,
      { ...after, party: [spent, ...after.party.slice(1)] },
      { t: "setMoves", index: 0, moves: [...chosen].reverse() },
    );
    for (const [at, moveId] of swapped.party[0].moves.entries()) {
      expect(swapped.party[0].pp[at], moveId).toBeLessThanOrEqual(maxPp(moveId));
      // The one that was nearly spent is still nearly spent, wherever it sits.
      expect(swapped.party[0].pp[at]).toBe(moveId === chosen[0] ? 1 : maxPp(moveId));
    }
  });

  it("P12: nothing it has not learned, no duplicates, no fifth move", () => {
    const { world, state } = inTown();
    const lead = state.party[0];
    const known = learnableAt(lead.speciesId, lead.level);

    // Something no starter learns at level five.
    expect(movesRefusal(world, state, 0, ["hyperbeam"])).toBe("it has not learned that");
    expect(movesRefusal(world, state, 0, [known[0], known[0]])).toBe("no duplicates");
    expect(movesRefusal(world, state, 0, [])).toBe("keep at least one move");
    expect(() => applyInput(world, state, { t: "setMoves", index: 0, moves: ["hyperbeam"] })).toThrow();
  });

  it("P13: a higher level opens up more of the learnset", () => {
    const early = learnableAt("bulbasaur", 5);
    const later = learnableAt("bulbasaur", 40);
    expect(later.length).toBeGreaterThan(early.length);
    for (const moveId of early) expect(later).toContain(moveId);
  });

  it("P14: moves are rearranged in town, not in the grass", () => {
    const { world, state } = inTown();
    const outside = walkOut(world, state);
    expect(world.routes.get(outside.route)?.kind).toBe("route");
    expect(movesRefusal(world, outside, 0, outside.party[0].moves)).toBe("moves are rearranged in town");
  });
});

/**
 * The prize bench.
 *
 * A shortcut for looking at what a bracket pays without winning one, which
 * otherwise costs four wins and three other people in a room. It is a cheat
 * like every other: it marks the save, it marks the creature, and it lands in
 * the log.
 *
 * The interesting property is that the *offer* is recomputed rather than
 * carried. `takePrize` has to carry a creature whole because a real tournament
 * happened in browsers this seed cannot see; this one happened nowhere, so the
 * log says which roll and which of the three, and a replay produces the same
 * creature from the same two numbers.
 */
describe("the prize bench", () => {
  it("P11: it takes what it showed, and marks it twice", () => {
    const { world, state } = inTown("BENCH1");
    const offered = cheatPrizeOffer(world.seed, 0, 8, state.nextUid);
    expect(offered).toHaveLength(3);

    const after = applyInput(world, state, {
      t: "cheat",
      cheat: { op: "prize", size: 8, roll: 0, index: 1 },
    });

    const won = [...after.party, ...after.box].at(-1)!;
    // The one the bench had on screen in that position, not another roll.
    expect(won.speciesId).toBe(offered[1].speciesId);
    expect(won.variantId).toBe(offered[1].variantId);
    expect(won.level).toBe(1);

    // Both marks. `prize` because that is what it is; `cheat` because the
    // menu made it — without the second, the bench would be a way to conjure
    // a prize that checks in looking legitimately won.
    expect(won.prize).toBe(true);
    expect(won.cheat).toBe(true);
    expect(after.cheated).toBe(true);

    // And it arrived with a moveset and full health, like anything else does.
    expect(won.moves.length).toBeGreaterThan(0);
    expect(won.hp).toBeGreaterThan(0);
  });

  it("P12: the same log always produces the same creature", () => {
    // The offer is recomputed from `roll` and `size` rather than carried, so
    // this is the property that keeps it an ordinary cheat.
    const world = testWorld("BENCH2");
    const log: Input[] = [
      { t: "pickStarter", index: 0 },
      { t: "cheat", cheat: { op: "prize", size: 16, roll: 7, index: 2 } },
    ];
    expect(stateHash(reduce(world, log))).toBe(stateHash(reduce(world, log)));

    // A different roll or a different slot is a different creature, which is
    // what makes the reroll button worth having.
    const taken = (roll: number, index: number) =>
      reduce(world, [
        { t: "pickStarter", index: 0 },
        { t: "cheat", cheat: { op: "prize", size: 16, roll, index } },
      ] as Input[]).party.at(-1)!;

    expect(taken(7, 2).speciesId).not.toBe(taken(7, 0).speciesId);
    expect(stateHash(reduce(world, log))).not.toBe(
      stateHash(
        reduce(world, [
          { t: "pickStarter", index: 0 },
          { t: "cheat", cheat: { op: "prize", size: 16, roll: 8, index: 2 } },
        ] as Input[]),
      ),
    );
  });

  it("P13: it refuses a field that is not a bracket, and a slot that is not offered", () => {
    const { world, state } = inTown("BENCH3");
    expect(() =>
      applyInput(world, state, {
        t: "cheat",
        // Six is a team size, not a bracket size. Refused rather than rounded
        // to something nearby, which would be the bench quietly testing a
        // field the game cannot run.
        cheat: { op: "prize", size: 6 as never, roll: 0, index: 0 },
      }),
    ).toThrow(/bracket/);

    expect(() =>
      applyInput(world, state, { t: "cheat", cheat: { op: "prize", size: 4, roll: 0, index: 9 } }),
    ).toThrow(/no such prize/);
  });

  it("P15: the bench draws from this world, so two worlds see two benches", () => {
    const species = (seed: string) => cheatPrizeOffer(seed, 0, 8, 1).map((one) => one.speciesId);
    expect(species("BENCH5")).toEqual(species("BENCH5"));
    expect(species("BENCH6")).not.toEqual(species("BENCH5"));

    // And the engine takes from the same draw the menu previews for that world.
    const { world, state } = inTown("BENCH6");
    const after = applyInput(world, state, { t: "cheat", cheat: { op: "prize", size: 8, roll: 0, index: 0 } });
    expect([...after.party, ...after.box].at(-1)!.speciesId).toBe(
      cheatPrizeOffer(world.seed, 0, 8, state.nextUid)[0].speciesId,
    );
  });

  it("P14: a bigger field on the bench really is a better roll", () => {
    // The reason the bench exists: seeing that the field size moves the odds.
    // Over enough rolls rather than on one, because these are odds.
    function sample(size: 4 | 8 | 16) {
      let ivs = 0;
      let seen = 0;
      for (let roll = 0; roll < 200; roll++) {
        for (const one of cheatPrizeOffer("BENCH4", roll, size, 1)) {
          ivs += STAT_IDS.reduce((total, stat) => total + one.ivs[stat], 0);
          seen++;
        }
      }
      return ivs / seen;
    }
    expect(sample(16)).toBeGreaterThan(sample(4));
  });
});
