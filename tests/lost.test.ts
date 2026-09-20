import { describe, expect, it } from "vitest";
import {
  applyInput,
  initialState,
  reclaimPrice,
  reclaimRefusal,
  RECLAIM_FLOOR,
  type GameState,
} from "@/engine/engine";
import { item } from "@/engine/items";
import { creature, testWorld } from "./helpers";

/**
 * Lost property: everything that left your hands by a road that was not
 * using it, and a clerk in Hearth who wants a fee for it back.
 */

const SEED = "LOST1";

function inHearth(extra: Partial<GameState> = {}): { world: ReturnType<typeof testWorld>; state: GameState } {
  const world = testWorld(SEED);
  const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  return { world, state: { ...start, money: 50_000, ...extra } };
}

/** Standing in front of Miss Vell. */
function atCounter(world: ReturnType<typeof testWorld>, state: GameState): GameState {
  const [routeId, here] = [...world.npcs].find(([, people]) => people.some((one) => one.id === "lost-property"))!;
  const her = here.find((one) => one.id === "lost-property")!;
  return { ...state, route: routeId, x: her.x, y: her.y + 1, talking: "lost-property" };
}

/** Inside a Mart, which is where selling happens. */
function inMart(world: ReturnType<typeof testWorld>, state: GameState): GameState {
  const shop = [...world.routes.values()].find((route) => route.role === "mart")!;
  return { ...state, route: shop.id, x: shop.entry.x, y: shop.entry.y, talking: null };
}

describe("lost property", () => {
  it("LP1: what you sell is handed in, and comes back for the fee", () => {
    const { world, state } = inHearth({ bag: { "hold-leftovers": 2 } });
    const sold = applyInput(world, inMart(world, state), { t: "sellItem", item: "hold-leftovers", count: 2 });
    expect(sold.bag["hold-leftovers"] ?? 0).toBe(0);
    expect(sold.lost["hold-leftovers"]).toBe(2);

    const counter = atCounter(world, sold);
    const fee = reclaimPrice("hold-leftovers");
    expect(fee).toBe(Math.max(RECLAIM_FLOOR, item("hold-leftovers").sell));

    const back = applyInput(world, counter, { t: "reclaim", item: "hold-leftovers" });
    expect(back.bag["hold-leftovers"]).toBe(1);
    expect(back.money).toBe(counter.money - fee);
    expect(back.lost["hold-leftovers"]).toBe(1);
    expect(back.notice).toMatchObject({ t: "reclaimed", item: "hold-leftovers", paid: fee });

    // The second one empties the line rather than leaving a zero behind.
    const both = applyInput(world, back, { t: "reclaim", item: "hold-leftovers" });
    expect(both.lost["hold-leftovers"]).toBeUndefined();
    expect(reclaimRefusal(world, both, "hold-leftovers")).toBe("nothing of that description has come in");
  });

  it("LP2: what a traded creature was carrying goes with it, and is handed in", () => {
    const { world, state } = inHearth({
      party: [creature("bulbasaur", { uid: 1, heldItem: "hold-luckyegg" })],
    });
    const traded = applyInput(world, { ...state, route: "hub-0" }, {
      t: "trade",
      give: 0,
      receive: { ...creature("charmander", { uid: 99 }), caughtBy: "Someone" },
    });
    expect(traded.party[0].speciesId).toBe("charmander");
    expect(traded.lost["hold-luckyegg"]).toBe(1);
  });

  it("LP3: she wants the fee, and she will not hand back what you drank", () => {
    const { world, state } = inHearth({ bag: { potion: 3 }, lost: { "hold-leftovers": 1 } });
    const counter = atCounter(world, state);

    // A potion used is spent, not lost: nothing is written down.
    const drunk = applyInput(world, { ...state, party: [creature("bulbasaur", { uid: 1, hp: 1 })] }, {
      t: "useItem",
      item: "potion",
      index: 0,
    });
    expect(drunk.lost.potion).toBeUndefined();

    // And the fee is real money.
    expect(reclaimRefusal(world, { ...counter, money: 0 }, "hold-leftovers")).toContain("the fee is");
    expect(() => applyInput(world, { ...counter, money: 0 }, { t: "reclaim", item: "hold-leftovers" })).toThrow();
    // Only at her counter.
    expect(reclaimRefusal(world, { ...state, talking: null }, "hold-leftovers")).toBe("nobody is talking");
  });
});
