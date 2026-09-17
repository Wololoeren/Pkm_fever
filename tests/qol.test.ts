import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyInput,
  BOX_SIZE,
  boxRefusal,
  DOOMSCROLLER,
  DOOMSCROLLER_AT,
  EGGOMETER,
  EGGOMETER_AT,
  HATCHED_BOX_NAME,
  HATCHED_TEXT,
  initialState,
  LOCKED_TEXT,
  LODGER_KINDS,
  releaseRefusal,
  storeRefusal,
  takeHeldRefusal,
  type GameState,
} from "@/engine/engine";
import { countOf, hasItem } from "@/engine/items";
import { AUTOSAVE_SLOTS, readAutosaves, writeAutosave } from "@/lib/save";
import { stepToward } from "@/lib/pathing";
import { feedPosts } from "@/components/Doomscroller";
import { HUB_ID } from "@/engine/world";
import { creature, testWorld } from "./helpers";

/**
 * The quality-of-life batch: locks, taking held items back from a box, the
 * Hatched box, the Egg-o-meter, the Doomscroller, autosave slots and
 * tap-to-walk.
 */

const SEED = "QOL1";

function started(): { world: ReturnType<typeof testWorld>; state: GameState } {
  const world = testWorld(SEED);
  return { world, state: applyInput(world, initialState(world), { t: "pickStarter", index: 0 }) };
}

describe("locks", () => {
  it("QL1: a locked creature cannot be released, and unlocking lets it go again", () => {
    const { world, state } = started();
    const two = { ...state, party: [...state.party, creature("rattata", { uid: 50 })] };
    expect(releaseRefusal(two, "party", 1, 50)).toBeNull();

    const locked = applyInput(world, two, { t: "lock", uid: 50 });
    expect(locked.locked).toEqual([50]);
    expect(releaseRefusal(locked, "party", 1, 50)).toBe(LOCKED_TEXT);
    // A lock is not a move.
    expect(locked.tick).toBe(two.tick);

    const unlocked = applyInput(world, locked, { t: "lock", uid: 50 });
    expect(unlocked.locked).toEqual([]);
    expect(releaseRefusal(unlocked, "party", 1, 50)).toBeNull();
    expect(() => applyInput(world, two, { t: "lock", uid: 999 })).toThrow();
  });
});

describe("the box", () => {
  it("QL2: every item held in a tab comes back to the bag in one go", () => {
    const { world, state } = started();
    const box = [
      { ...creature("pidgey", { uid: 60 }), heldItem: "hold-choiceband" },
      { ...creature("pidgey", { uid: 61 }), heldItem: "hold-choiceband" },
      creature("pidgey", { uid: 62 }),
    ];
    const boxed = { ...state, box, boxOf: { 60: 0, 61: 0, 62: 0 } };
    expect(takeHeldRefusal(boxed, 0)).toBeNull();
    const after = applyInput(world, boxed, { t: "takeHeldFromBox", tab: 0 });
    expect(countOf(after.bag, "hold-choiceband")).toBe(2);
    expect(after.box.every((one) => one.heldItem === null)).toBe(true);
    expect(after.notice).toEqual({ t: "heldTaken", count: 2 });
    expect(takeHeldRefusal(after, 0)).toBe("nobody in this box is holding anything");
  });

  it("QL3: incubated eggs hatch into the Hatched box, and nothing can be put back into it", () => {
    const { world, state } = started();
    const egg = { creature: creature("togepi", { uid: 0, level: 1 }), steps: 0, total: 300 };
    const ready = { ...state, daycare: { ...state.daycare, incubating: [egg] } };
    const hatched = applyInput(world, ready, { t: "hatch", index: 0, from: "incubator" });

    expect(hatched.hatchedTab).not.toBeNull();
    const tab = hatched.hatchedTab!;
    expect(hatched.boxNames[tab]).toBe(HATCHED_BOX_NAME);
    const born = hatched.box.at(-1)!;
    expect(hatched.boxOf[born.uid]).toBe(tab);

    // Out of it into another tab is fine; back in is not.
    const moved = applyInput(world, hatched, { t: "moveToBox", uid: born.uid, tab: 0 });
    expect(boxRefusal(moved, { t: "moveToBox", uid: born.uid, tab })).toBe(HATCHED_TEXT);
    const pair = { ...moved, party: [...moved.party, creature("rattata", { uid: 71 })] };
    expect(storeRefusal(pair, 1, tab)).toBe(HATCHED_TEXT);
    expect(boxRefusal(moved, { t: "renameBox", tab, name: "Mine now" })).toBe("the Hatched box keeps its name");

    // And the ordinary shelving never files anything into it.
    const two = { ...moved, party: [...moved.party, creature("rattata", { uid: 70 })] };
    const stored = applyInput(world, two, { t: "store", index: 1 });
    expect(stored.boxOf[70]).not.toBe(tab);
    expect(BOX_SIZE).toBeGreaterThan(1);
  });
});

describe("gadgets", () => {
  it("QL4: the fifteenth egg hatched hands over the Egg-o-meter, once", () => {
    const { world, state } = started();
    const egg = () => ({ creature: creature("togepi", { uid: 0, level: 1 }), steps: 0, total: 300 });
    let current: GameState = { ...state, eggsHatched: EGGOMETER_AT - 1, eggs: [egg()] };
    current = applyInput(world, current, { t: "hatch", index: 0, from: "party" });
    expect(hasItem(current.bag, EGGOMETER)).toBe(true);
    expect(current.notice).toMatchObject({ t: "hatched", gift: EGGOMETER });

    // Gone from the bag, it does not come back on the next egg.
    const lost = { ...current, bag: {}, eggs: [egg()], party: [current.party[0]] };
    const again = applyInput(world, lost, { t: "hatch", index: 0, from: "party" });
    expect(hasItem(again.bag, EGGOMETER)).toBe(false);
  });

  it("QL5: meeting six of the people who run something hands over the Doomscroller", () => {
    const { world, state } = started();
    const specials = [...world.npcs.values()].flat().filter((one) => LODGER_KINDS.has(one.kind));
    expect(specials.length).toBeGreaterThanOrEqual(DOOMSCROLLER_AT);

    // Five already met; talking to the sixth is what does it.
    const five = { ...state, spokenTo: specials.slice(0, DOOMSCROLLER_AT - 1).map((one) => one.id).sort() };
    const sixth = specials[DOOMSCROLLER_AT - 1];
    const talked = applyInput(world, { ...five, route: sixth.route, x: sixth.x, y: sixth.y + 1 }, { t: "talk", id: sixth.id });
    expect(hasItem(talked.bag, DOOMSCROLLER)).toBe(true);
    expect(talked.given).toContain(DOOMSCROLLER);
  });

  it("QL6: the feed lists what is running, and puts what is ready first", () => {
    const { world, state } = started();
    const busy: GameState = {
      ...state,
      tick: 100,
      printedAt: 95,
      pawnedAt: -5000,
      stepsTaken: 10,
      eggs: [{ creature: creature("togepi", { uid: 0, level: 1 }), steps: 0, total: 300 }],
    };
    const posts = feedPosts(world, busy);
    expect(posts.map((one) => one.who)).toEqual(expect.arrayContaining(["Ivo", "Pawnbroker", "Egg"]));
    const firstWaiting = posts.findIndex((one) => !one.ready);
    expect(posts.slice(firstWaiting).every((one) => !one.ready)).toBe(true);
    expect(posts.find((one) => one.who === "Ivo")!.ready).toBe(false);
    expect(posts.find((one) => one.who === "Pawnbroker")!.ready).toBe(true);
  });
});

describe("tap-to-walk", () => {
  it("QL7: steps toward a seen tile along open ground, and refuses the fog and where you stand", () => {
    const { world, state } = started();
    const hub = world.routes.get(HUB_ID)!;
    expect(state.route).toBe(HUB_ID);

    // Two tiles east along the road you start on.
    const target = { x: state.x + 2, y: state.y };
    let current = state;
    for (let step = 0; step < 6 && (current.x !== target.x || current.y !== target.y); step++) {
      const dir = stepToward(world, current, target);
      expect(dir, `step ${step}`).not.toBeNull();
      current = applyInput(world, current, { t: "move", dir: dir! });
    }
    expect([current.x, current.y]).toEqual([target.x, target.y]);
    expect(stepToward(world, current, target)).toBeNull();

    // Nothing seen, nowhere to walk.
    const blind = { ...state, seen: {} as GameState["seen"] };
    expect(stepToward(world, blind, { x: 1, y: 1 })).toBeNull();
    expect(hub.width).toBeGreaterThan(target.x);
  });
});

describe("autosave slots", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("QL8: the last three runs keep a save each, newest first, and a run keeps its own slot", () => {
    writeAutosave("SEEDA", [], undefined, "runA");
    writeAutosave("SEEDB", [], undefined, "runB");
    writeAutosave("SEEDA", [{ t: "pickStarter", index: 0 }], undefined, "runA");
    expect(readAutosaves().map((one) => one.run)).toEqual(["runA", "runB"]);
    expect(readAutosaves()[0].inputs).toHaveLength(1);

    writeAutosave("SEEDC", [], undefined, "runC");
    writeAutosave("SEEDD", [], undefined, "runD");
    expect(readAutosaves()).toHaveLength(AUTOSAVE_SLOTS);
    expect(readAutosaves().map((one) => one.run)).toEqual(["runD", "runC", "runA"]);
  });
});
