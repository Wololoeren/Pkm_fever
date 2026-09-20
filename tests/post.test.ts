import { describe, expect, it } from "vitest";
import { applyInput, initialState, postDealRefusal, type GameState } from "@/engine/engine";
import { creature, testWorld } from "./helpers";

/**
 * A deal struck at Tim's board: a creature out, a creature in, money either
 * way, and any of the three left off.
 */

const SEED = "POST1";

function playing(extra: Partial<GameState> = {}): { world: ReturnType<typeof testWorld>; state: GameState } {
  const world = testWorld(SEED);
  const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  return {
    world,
    state: {
      ...start,
      money: 10_000,
      party: [creature("bulbasaur", { uid: 1, level: 20 }), creature("machop", { uid: 2, level: 25, heldItem: "hold-leftovers" })],
      ...extra,
    },
  };
}

const theirs = () => creature("dratini", { uid: 900, level: 30 });

describe("the trading post", () => {
  it("PT1: a creature for a creature and cash, and the whole thing lands at once", () => {
    const { world, state } = playing();
    const done = applyInput(world, state, {
      t: "postDeal",
      give: 1,
      receive: theirs(),
      paid: -2_000,
      who: "Kim",
    });

    expect(done.party.map((one) => one.speciesId)).toEqual(["bulbasaur", "dratini"]);
    expect(done.money).toBe(8_000);
    // What arrives is rebuilt, marked as somebody else's, and keeps its level.
    const got = done.party[1];
    expect(got.level).toBe(30);
    expect(got.traded).toBe(true);
    expect(got.uid).not.toBe(900);
    // And what the one you handed over was carrying is at lost property.
    expect(done.lost["hold-leftovers"]).toBe(1);
    expect(done.notice).toMatchObject({ t: "dealt", who: "Kim", given: "machop", received: "dratini", paid: -2_000 });
  });

  it("PT2: money alone, in either direction", () => {
    const { world, state } = playing();

    // Selling one for cash: nothing arrives.
    const sold = applyInput(world, state, { t: "postDeal", give: 1, receive: null, paid: 5_000, who: "Kim" });
    expect(sold.party).toHaveLength(1);
    expect(sold.money).toBe(15_000);

    // Buying one for cash: nothing leaves.
    const bought = applyInput(world, state, { t: "postDeal", give: null, receive: theirs(), paid: -5_000, who: "Kim" });
    expect(bought.party).toHaveLength(3);
    expect(bought.money).toBe(5_000);
  });

  it("PT3: it refuses what it can check", () => {
    const { world, state } = playing();
    const deal = { give: null, receive: null, paid: 0 };
    expect(postDealRefusal(world, state, deal)).toBe("there is nothing in that deal");
    expect(postDealRefusal(world, state, { ...deal, give: 9 })).toBe("you do not have that one any more");
    expect(postDealRefusal(world, state, { ...deal, receive: theirs(), paid: -50_000 })).toBe("you cannot cover that");
    // A locked creature is locked here as well.
    expect(
      postDealRefusal(world, { ...state, locked: [2] }, { give: 1, receive: theirs(), paid: 0 }),
    ).toBe("that one is locked");
    // And the last thing that can fight does not leave for money.
    expect(
      postDealRefusal(world, { ...state, party: [state.party[0]] }, { give: 0, receive: null, paid: 100 }),
    ).toBe("keep something that can fight");
    expect(() => applyInput(world, state, { t: "postDeal", give: 9, receive: null, paid: 0, who: "Kim" })).toThrow();
  });

  it("PT4: a full party sends the arrival to the box", () => {
    const { world, state } = playing({
      party: Array.from({ length: 6 }, (_, at) => creature("rattata", { uid: at + 1, level: 10 })),
    });
    const done = applyInput(world, state, { t: "postDeal", give: null, receive: theirs(), paid: 0, who: "Kim" });
    expect(done.party).toHaveLength(6);
    expect(done.box.at(-1)?.speciesId).toBe("dratini");
  });
});
