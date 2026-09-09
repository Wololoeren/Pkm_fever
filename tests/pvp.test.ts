import { describe, expect, it } from "vitest";
import { DuelSession, type DuelMessage } from "@/engine/duel";
import { applyInput, initialState } from "@/engine/engine";
import { TradeSession, type TradeMessage } from "@/engine/trade";
import type { Individual } from "@/engine/types";
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
    let outside = state;
    for (let i = 0; i < 14 && outside.route === "hub-0"; i++) {
      outside = applyInput(world, outside, { t: "move", dir: "e" });
    }
    expect(outside.route).not.toBe("hub-0");

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
    expect(cheated.balls).toBe(state.balls + 50);

    const later = applyInput(world, cheated, { t: "move", dir: "n" });
    expect(later.cheated).toBe(true);
  });

  it("P9: a cheated save replays as cheated", () => {
    const { world, state } = inTown();
    const cheated = applyInput(world, state, {
      t: "cheat",
      cheat: { op: "give", speciesId: "mewtwo", level: 100, variantId: "shiny" },
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

