import { describe, expect, it } from "vitest";
import { applyInput, initialState } from "@/engine/engine";
import { journalOf } from "@/lib/journal";
import { play, testWorld } from "./helpers";

/**
 * The journal is derived, so what these check is that it agrees with the
 * log and the state it was read off — never that it counted anything.
 */

const SEED = "PKMFEVER1";

describe("the journal", () => {
  it("J1: a fresh game has nothing in it but the world's size", () => {
    const world = testWorld(SEED);
    const journal = journalOf(world, initialState(world), []);
    expect(journal.moves).toBe(0);
    expect(journal.obtained).toBe(0);
    expect(journal.firsts).toEqual([]);
    expect(journal.badges).toEqual([]);
    expect(journal.rival.visits).toBe(0);
    expect(journal.placesVisited).toBe(0);
    expect(journal.placesInAll).toBeGreaterThan(10);
  });

  it("J2: the counts are the log's, and the roster is in order of arrival", () => {
    const world = testWorld(SEED);
    const { inputs, state } = play(world, 500);
    const journal = journalOf(world, state, inputs);

    expect(journal.moves).toBe(500);
    expect(journal.steps).toBe(inputs.filter((input) => input.t === "move").length);
    expect(journal.ballsThrown).toBe(inputs.filter((input) => input.t === "ball").length);
    expect(journal.battles).toBe(inputs.filter((input) => input.t === "continue").length);
    expect(journal.battles).toBeGreaterThan(0);
    expect(journal.obtained).toBe(state.nextUid - 1);
    expect(journal.obtained).toBeGreaterThanOrEqual(state.party.length + state.box.length);

    const uids = journal.firsts.map((one) => one.uid);
    expect(uids).toEqual([...uids].sort((a, b) => a - b));
    expect(journal.firsts.length).toBe(state.party.length + state.box.length);
    expect(journal.speciesMet).toBe(Object.keys(state.whereMet).length);
    expect(journal.speciesCaught).toBe(state.caught.length);
    expect(journal.cheated).toBe(false);
  });

  it("J3: the rival's visits are counted where his visit begins", () => {
    const world = testWorld(SEED);
    const { state } = play(world, 4000);
    const journal = journalOf(world, state, []);
    if (state.rivalLast !== null) {
      expect(journal.rival.visits).toBeGreaterThan(0);
      expect(journal.rival.lastVisit).toBe(state.rivalLast);
    } else {
      expect(journal.rival.visits).toBe(0);
    }
  });

  it("J4: a cheat is written down here too", () => {
    const world = testWorld(SEED);
    const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const cheated = applyInput(world, start, { t: "cheat", cheat: { op: "heal" } });
    expect(journalOf(world, cheated, []).cheated).toBe(true);
  });
});
