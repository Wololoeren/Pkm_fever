import { describe, expect, it } from "vitest";
import {
  applyInput,
  BOX_SIZE,
  BOX_TABS_MAX,
  boxCount,
  initialState,
  reduce,
  stateHash,
  storeRefusal,
  type GameState,
  type Input,
} from "@/engine/engine";
import { creature, testWorld } from "./helpers";

/**
 * The box's tabs.
 *
 * `box` is still one flat list — every input that names a box index keeps
 * meaning what it meant — and which tab a creature sits in is `boxOf`. What
 * these guard is that the two never disagree: everybody boxed has a tab, a tab
 * never holds more than a grid, and a new arrival lands somewhere with room.
 */
describe("box tabs", () => {
  const world = testWorld("BOX1");
  const started = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

  /**
   * A state with `count` creatures in the box, placed the way a real game
   * places them: the last one arrives through an input that changes the box,
   * which is what makes the engine shelve everybody.
   */
  function boxedWith(count: number): GameState {
    const box = Array.from({ length: count - 1 }, (_, at) => creature("pidgey", { uid: 1000 + at }));
    const party = [...started.party, creature("pidgey", { uid: 1000 + count - 1 })];
    return applyInput(world, { ...started, party, box, boxOf: {} }, { t: "store", index: party.length - 1 });
  }

  it("BX1: a new game has one tab, and storing puts the creature in it", () => {
    expect(started.boxNames).toEqual(["Box 1"]);
    const two = { ...started, party: [...started.party, creature("rattata", { uid: 50 })] };
    const stored = applyInput(world, two, { t: "store", index: 1 });
    expect(stored.boxOf[50]).toBe(0);
  });

  it("BX1b: storing into a named tab puts it there — the one on screen — and a full tab refuses", () => {
    const tabbed = applyInput(world, applyInput(world, started, { t: "addBox" }), { t: "addBox" });
    const two = { ...tabbed, party: [...tabbed.party, creature("rattata", { uid: 51 })] };
    const stored = applyInput(world, two, { t: "store", index: 1, tab: 2 });
    expect(stored.boxOf[51]).toBe(2);
    expect(boxCount(stored, 0)).toBe(0);

    const full = {
      ...two,
      box: Array.from({ length: BOX_SIZE }, (_, at) => creature("pidgey", { uid: 2000 + at })),
      boxOf: Object.fromEntries(Array.from({ length: BOX_SIZE }, (_, at) => [2000 + at, 1])),
    };
    expect(storeRefusal(full, 1, 1)).toBe("that box is full");
    expect(() => applyInput(world, full, { t: "store", index: 1, tab: 1 })).toThrow();
    expect(storeRefusal(full, 1, 7)).toBe("no such box");
    expect(applyInput(world, full, { t: "store", index: 1, tab: 0 }).boxOf[51]).toBe(0);
  });

  it("BX2: a full tab spills into the next, and a new tab opens when every one is full", () => {
    const state = applyInput(world, boxedWith(BOX_SIZE + 3), { t: "renameBox", tab: 0, name: "First" });
    expect(state.boxNames).toEqual(["First", "Box 2"]);
    expect(boxCount(state, 0)).toBe(BOX_SIZE);
    expect(boxCount(state, 1)).toBe(3);
    for (const one of state.box) expect(state.boxOf[one.uid]).toBeDefined();
  });

  it("BX3: tabs can be named, and an empty name gives the default back", () => {
    let state = applyInput(world, started, { t: "addBox" });
    state = applyInput(world, state, { t: "renameBox", tab: 1, name: "  Breeding   stock " });
    expect(state.boxNames[1]).toBe("Breeding stock");
    state = applyInput(world, state, { t: "renameBox", tab: 1, name: "" });
    expect(state.boxNames[1]).toBe("Box 2");
    expect(() => applyInput(world, state, { t: "renameBox", tab: 9, name: "Nope" })).toThrow();
  });

  it("BX4: a creature moves between tabs, but not into a full one", () => {
    const state = applyInput(world, boxedWith(BOX_SIZE + 1), { t: "addBox" });
    // Tab 0 is full, tab 1 has the spill, tab 2 was just added and is empty.
    expect(boxCount(state, 0)).toBe(BOX_SIZE);
    const uid = state.box[0].uid;

    const moved = applyInput(world, state, { t: "moveToBox", uid, tab: 2 });
    expect(moved.boxOf[uid]).toBe(2);
    expect(boxCount(moved, 0)).toBe(BOX_SIZE - 1);

    const spill = state.box.at(-1)!.uid;
    expect(() => applyInput(world, state, { t: "moveToBox", uid: spill, tab: 0 })).toThrow(/full/);
    expect(() => applyInput(world, state, { t: "moveToBox", uid: 424242, tab: 1 })).toThrow();
  });

  it("BX5: taking one out forgets its tab, and there is a limit on adding tabs by hand", () => {
    const state = boxedWith(2);
    const uid = state.box[0].uid;
    const out = applyInput(world, state, { t: "retrieve", index: 0 });
    expect(out.boxOf[uid]).toBeUndefined();

    let many = started;
    while (many.boxNames.length < BOX_TABS_MAX) many = applyInput(world, many, { t: "addBox" });
    expect(() => applyInput(world, many, { t: "addBox" })).toThrow();
  });

  it("BX6: tabs are state and names replay, but a name is not in the hash", () => {
    const named = applyInput(world, started, { t: "renameBox", tab: 0, name: "Keepers" });
    expect(named.boxNames[0]).toBe("Keepers");
    expect(stateHash(named)).toBe(stateHash(started));
    expect(stateHash(applyInput(world, started, { t: "addBox" }))).not.toBe(stateHash(started));

    const inputs: Input[] = [
      { t: "pickStarter", index: 0 },
      { t: "addBox" },
      { t: "renameBox", tab: 1, name: "Spares" },
    ];
    const again = reduce(world, inputs);
    expect(again.boxNames).toEqual(["Box 1", "Spares"]);
  });
});
