import { describe, expect, it } from "vitest";
import {
  applyInput,
  initialState,
  loadLoadoutRefusal,
  LOADOUTS_MAX,
  saveLoadoutRefusal,
  type GameState,
} from "@/engine/engine";
import { addItem, countOf } from "@/engine/items";
import { packInputs, unpackInputs } from "@/lib/pack";
import { creature, testWorld } from "./helpers";

/**
 * Loadouts: a team written down, and put back.
 *
 * The property under all of it is that a loadout is a *note*, not a copy. It
 * holds uids, move ids and item ids, so what comes back is whatever those
 * name right now — and anything they no longer name is skipped rather than
 * conjured. A loadout that could restore a creature would be a second source
 * of truth about that creature, which is the bug this whole engine is shaped
 * to avoid.
 */

const SEED = "LOAD1";

function playing(extra: Partial<GameState> = {}): { world: ReturnType<typeof testWorld>; state: GameState } {
  const world = testWorld(SEED);
  const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  return {
    world,
    state: {
      ...start,
      party: [
        { ...creature("bulbasaur", { uid: 1, level: 20, moves: ["tackle", "vinewhip", "growl"] }), heldItem: "hold-leftovers" },
        creature("machop", { uid: 2, level: 18, moves: ["karatechop", "lowkick"] }),
        creature("pidgey", { uid: 3, level: 12, moves: ["gust"] }),
      ],
      box: [creature("abra", { uid: 4, level: 9, moves: ["teleport"] })],
      ...extra,
    },
  };
}

describe("writing a team down", () => {
  it("LO1: saving takes the party as it stands, and only as references", () => {
    const { world, state } = playing();
    const saved = applyInput(world, state, { t: "saveLoadout", name: "  Gym   run  " });

    expect(saved.loadouts).toHaveLength(1);
    const [one] = saved.loadouts;
    // Whitespace tidied, and a name given when none was.
    expect(one.name).toBe("Gym run");
    expect(applyInput(world, saved, { t: "saveLoadout" }).loadouts[1].name).toBe("Team 2");

    expect(one.members.map((who) => who.uid)).toEqual([1, 2, 3]);
    expect(one.members[0].moves).toEqual(["tackle", "vinewhip", "growl"]);
    expect(one.members[0].heldItem).toBe("hold-leftovers");
    expect(one.members[1].heldItem).toBeNull();
    // Nothing of the creature itself: levels, stats and health are looked up
    // when it is loaded, never stored here.
    expect(Object.keys(one.members[0]).sort()).toEqual(["heldItem", "moves", "uid"]);
  });

  it("LO2: it refuses an empty party, and stops at the limit", () => {
    const { world, state } = playing();
    expect(saveLoadoutRefusal({ ...state, party: [] })).toBe("there is nobody to write down");
    expect(saveLoadoutRefusal({ ...state, phase: "battle" })).toBe("not right now");

    let full = state;
    for (let at = 0; at < LOADOUTS_MAX; at++) full = applyInput(world, full, { t: "saveLoadout" });
    expect(full.loadouts).toHaveLength(LOADOUTS_MAX);
    expect(saveLoadoutRefusal(full)).toMatch(/no more than/);
    expect(() => applyInput(world, full, { t: "saveLoadout" })).toThrow();

    // And one can be forgotten, which is the only way back under the limit.
    const fewer = applyInput(world, full, { t: "dropLoadout", index: 0 });
    expect(fewer.loadouts).toHaveLength(LOADOUTS_MAX - 1);
    expect(() => applyInput(world, fewer, { t: "dropLoadout", index: 99 })).toThrow();

    // Every one of the three survives the codec.
    const log = [
      { t: "saveLoadout" as const, name: "A" },
      { t: "loadLoadout" as const, index: 0 },
      { t: "dropLoadout" as const, index: 0 },
    ];
    expect(unpackInputs(packInputs(log))).toEqual(log);
  });
});

describe("putting it back", () => {
  it("LO3: the party, the order, the moves and the items all come back", () => {
    const { world, state } = playing();
    const saved = applyInput(world, state, { t: "saveLoadout", name: "Gym run" });

    // Now make a mess of it: a different party, in a different order, with
    // the moves rearranged and the item off.
    const messy: GameState = {
      ...saved,
      party: [
        saved.box[0],
        { ...saved.party[1], moves: ["lowkick", "karatechop"] },
        { ...saved.party[0], moves: ["growl", "tackle", "vinewhip"], heldItem: null },
      ],
      box: [saved.party[2]],
      bag: addItem(saved.bag, "hold-leftovers"),
    };

    const back = applyInput(world, messy, { t: "loadLoadout", index: 0 });

    expect(back.party.map((one) => one.uid)).toEqual([1, 2, 3]);
    expect(back.party[0].moves).toEqual(["tackle", "vinewhip", "growl"]);
    expect(back.party[1].moves).toEqual(["karatechop", "lowkick"]);
    expect(back.party[0].heldItem).toBe("hold-leftovers");
    // Taken out of the bag rather than minted.
    expect(countOf(back.bag, "hold-leftovers")).toBe(countOf(messy.bag, "hold-leftovers") - 1);
    // Whoever was in the party and is not in the loadout is in the box.
    expect(back.box.map((one) => one.uid)).toEqual([4]);
    expect(back.notice).toMatchObject({ t: "loadedOut", name: "Gym run", brought: 3, missing: 0 });
  });

  it("LO4: a move it no longer knows is not taught, and one it has learned is kept", () => {
    const { world, state } = playing();
    const saved = applyInput(world, state, { t: "saveLoadout" });

    // It has forgotten Vine Whip and learned Razor Leaf since.
    const changed: GameState = {
      ...saved,
      party: [{ ...saved.party[0], moves: ["growl", "razorleaf", "tackle"] }, ...saved.party.slice(1)],
    };

    const back = applyInput(world, changed, { t: "loadLoadout", index: 0 });
    // Saved order first, for the moves it still has; anything new on the end.
    expect(back.party[0].moves).toEqual(["tackle", "growl", "razorleaf"]);
    expect(back.party[0].moves).not.toContain("vinewhip");
    // The uses went with the moves rather than staying in their slots.
    expect(back.party[0].pp).toHaveLength(3);
  });

  it("LO5: what is gone is skipped, and what will not fit is left", () => {
    const { world, state } = playing();
    const saved = applyInput(world, state, { t: "saveLoadout", name: "Gym run" });

    // Two of the three released, the third still here.
    const thinned: GameState = { ...saved, party: [saved.party[2]], box: [] };
    const back = applyInput(world, thinned, { t: "loadLoadout", index: 0 });
    expect(back.party.map((one) => one.uid)).toEqual([3]);
    expect(back.notice).toMatchObject({ t: "loadedOut", brought: 1, missing: 2 });

    // None of them here at all, and it says so rather than emptying the party.
    const stranger: GameState = { ...saved, party: [creature("eevee", { uid: 90 })], box: [] };
    expect(loadLoadoutRefusal(stranger, 0)).toBe("none of them are still here");
    expect(() => applyInput(world, stranger, { t: "loadLoadout", index: 0 })).toThrow();
    expect(loadLoadoutRefusal(saved, 9)).toBe("no such loadout");
    expect(loadLoadoutRefusal({ ...saved, phase: "battle" }, 0)).toBe("not in the middle of something");

    // Eggs sit in party slots, so they are what a loadout has to fit around.
    const eggy: GameState = {
      ...saved,
      eggs: Array.from({ length: 5 }, () => ({ creature: creature("bulbasaur", { uid: 50 }), steps: 10, total: 10 })),
    };
    const squeezed = applyInput(world, eggy, { t: "loadLoadout", index: 0 });
    expect(squeezed.party).toHaveLength(1);
    expect(squeezed.notice).toMatchObject({ t: "loadedOut", brought: 1, missing: 2 });
  });

  it("LO6: an item that is no longer in the bag leaves the creature as it is", () => {
    const { world, state } = playing();
    const saved = applyInput(world, state, { t: "saveLoadout" });

    // The Leftovers have gone elsewhere and it is carrying a berry instead.
    const swapped: GameState = {
      ...saved,
      party: [{ ...saved.party[0], heldItem: "berry-sitrus" }, ...saved.party.slice(1)],
      bag: {},
    };

    const back = applyInput(world, swapped, { t: "loadLoadout", index: 0 });
    expect(back.party[0].heldItem).toBe("berry-sitrus");
    // And nothing was invented to make up the difference.
    expect(countOf(back.bag, "hold-leftovers")).toBe(0);
  });
});
