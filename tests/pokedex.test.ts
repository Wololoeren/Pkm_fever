import { describe, expect, it } from "vitest";
import { applyInput, initialState, reduce, stateHash, type GameState } from "@/engine/engine";
import { DEX_REVEAL, dexOf } from "@/engine/pokedex";
import { play, testWorld } from "./helpers";

/**
 * The Pokédex: seen, caught, and a route's table once it has been earned.
 *
 * `seen` is the field notes and is tested there. What is new is `caught`, and
 * the property that matters is the same one: it is folded in one place, so
 * every road to owning something writes it and releasing does not unwrite it.
 */

const SEED = "PKMFEVER1";

describe("caught", () => {
  it("PD1: a fresh game has caught nothing, and the starter is the first entry", () => {
    const world = testWorld(SEED);
    const fresh = initialState(world);
    expect(fresh.caught).toEqual([]);
    expect(dexOf(world, fresh).caught).toBe(0);

    const picked = applyInput(world, fresh, { t: "pickStarter", index: 0 });
    expect(picked.caught).toEqual([picked.party[0].speciesId]);
    const dex = dexOf(world, picked);
    expect(dex.caught).toBe(1);
    expect(dex.seen).toBe(1);
    expect(dex.entries[0]).toMatchObject({ speciesId: picked.party[0].speciesId, caught: true, seen: true });
  });

  it("PD2: something met across the field is seen and not caught", () => {
    const world = testWorld(SEED);
    const { state } = play(world, 300);
    const dex = dexOf(world, state);
    // A played run has fought things it did not catch.
    expect(dex.seen).toBeGreaterThan(dex.caught);
    for (const entry of dex.entries) if (entry.caught) expect(state.caught).toContain(entry.speciesId);
    expect(dex.entries.map((entry) => entry.num)).toEqual([...dex.entries.map((entry) => entry.num)].sort((a, b) => a - b));
  });

  it("PD3: releasing keeps the entry, and the list stays sorted", () => {
    const world = testWorld(SEED);
    const { state } = play(world, 300);
    const gone: GameState = { ...state, party: state.party.slice(0, 1), box: [] };
    // Nothing is unwritten by losing the creature; the fold only ever adds.
    const after = reduce(world, []);
    expect(after.caught).toEqual([]);
    expect(gone.caught).toEqual(state.caught);
    expect([...state.caught].sort()).toEqual(state.caught);
  });

  it("PD4: it is in the hash and survives a replay", () => {
    const world = testWorld(SEED);
    const { inputs, state } = play(world, 300);
    expect(reduce(world, inputs).caught).toEqual(state.caught);

    const other: GameState = { ...state, caught: [...state.caught, "zzz-nothing"] };
    expect(stateHash(other)).not.toBe(stateHash(state));
  });
});

describe("the reveal", () => {
  it("PD5: a route shows its table only after enough encounters, and the table is the world's", () => {
    const world = testWorld(SEED);
    const { state } = play(world, 600);
    const dex = dexOf(world, state);
    expect(dex.routes.length).toBeGreaterThan(0);

    for (const route of dex.routes) {
      expect(route.encounters).toBe(state.nextSlot[route.routeId] ?? 0);
      if (route.encounters >= DEX_REVEAL) {
        expect(route.table, `${route.routeId} earned its table`).not.toBeNull();
        expect(route.table!.length).toBeGreaterThan(0);
      } else {
        expect(route.table, `${route.routeId} has not earned its table`).toBeNull();
      }
    }

    // Force one over the line and it shows; force it back and it does not.
    const first = dex.routes[0];
    const shown = dexOf(world, { ...state, nextSlot: { ...state.nextSlot, [first.routeId]: DEX_REVEAL } });
    expect(shown.routes.find((route) => route.routeId === first.routeId)?.table).not.toBeNull();
    const hidden = dexOf(world, { ...state, nextSlot: { ...state.nextSlot, [first.routeId]: DEX_REVEAL - 1 } });
    expect(hidden.routes.find((route) => route.routeId === first.routeId)?.table).toBeNull();
  });
});
