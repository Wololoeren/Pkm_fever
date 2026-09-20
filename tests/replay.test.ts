import { describe, expect, it } from "vitest";
import { ALL_SPECIES } from "@/engine/dex";
import { applyInput, initialState, reduce, stateHash, type Input } from "@/engine/engine";
import { expForLevel } from "@/engine/progression";
import { IV_MAX, IV_MEAN } from "@/engine/stats";
import { STAT_IDS } from "@/engine/types";
import { wildAt } from "@/engine/world";
import { outdoorRoutes, play, testWorld } from "./helpers";

/**
 * The property the entire project rests on.
 *
 * Verifiable saves, unforgeable tournament teams, unrerollable encounters and
 * peer-to-peer battles are all one claim wearing four hats: the same inputs
 * against the same seed produce the same state, everywhere, always. These
 * tests are the reason to trust that claim, and they exist before the game has
 * a single pixel.
 */

const SEED = "PKMFEVER1";

describe("replay determinism", () => {
  it("R1: a 500-input session replays to the same state", () => {
    const world = testWorld(SEED);
    const { inputs, state } = play(world, 500);

    expect(inputs.length).toBe(500);
    expect(stateHash(reduce(world, inputs))).toBe(stateHash(state));
  });

  it("R1b: and that session actually fought, so R1 means something", () => {
    // A determinism test over a log of nothing but footsteps would pass while
    // covering none of the battle system. This asserts the fixture is real.
    const world = testWorld(SEED);
    const { inputs, state } = play(world, 500);
    const count = (t: Input["t"]) => inputs.filter((input) => input.t === t).length;

    expect(count("move")).toBeGreaterThan(50);
    expect(count("fight")).toBeGreaterThan(20);
    expect(count("ball")).toBeGreaterThan(0);

    // Balls were thrown and something was kept, so catching ran.
    expect(state.party.length).toBeGreaterThan(1);

    // And something won a fight. A creature is minted with exactly the
    // experience its level requires, so any excess can only have been earned
    // in battle — which means damage, fainting and the exp award all ran.
    expect(state.party.some((creature) => creature.exp > expForLevel(creature.level))).toBe(true);
  });

  it("R1c: you are never left walking around with nothing that can fight", () => {
    // A creature that faints on the same turn it lands the killing blow ends
    // the battle as "won" with nothing standing. That used to skip the
    // blackout, and `move` then quietly refused every encounter for the rest
    // of the run — the game looked broken rather than saying anything. The
    // symptom was a fixture whose battle count stopped growing with its
    // length, which is why this is checked over the whole log rather than at
    // the end of it.
    const world = testWorld(SEED);
    const { inputs } = play(world, 1500);

    let state = initialState(world);
    for (const input of inputs) {
      state = applyInput(world, state, input);
      if (state.phase !== "field" || !state.party.length) continue;
      expect(state.party.some((creature) => creature.hp > 0)).toBe(true);
    }
  });

  it("R2: a world rebuilt from the seed replays the log identically", () => {
    // The save file carries a seed and a log, never a world. Loading has to
    // rebuild an identical world or every save is worthless.
    const { inputs } = play(testWorld(SEED), 500);
    const first = stateHash(reduce(testWorld(SEED), inputs));
    const second = stateHash(reduce(testWorld(SEED), inputs));

    expect(first).toBe(second);
  });

  it("R3: replaying a prefix matches stepping to that point", () => {
    // Partial replay is what a verifier does when it stops early, and what
    // undo would do. It must not be a different code path.
    const world = testWorld(SEED);
    const { inputs } = play(world, 200);

    let stepped = initialState(world);
    for (let i = 0; i < inputs.length; i++) {
      stepped = applyInput(world, stepped, inputs[i]);
      if (i % 50 !== 0) continue;
      expect(stateHash(reduce(world, inputs.slice(0, i + 1)))).toBe(stateHash(stepped));
    }
  });

  it("R4: two different seeds give different worlds", () => {
    const a = testWorld(SEED);
    const b = testWorld("PKMFEVER2");
    expect(a.starters).not.toEqual(b.starters);
  });

  it("R5: an illegal input throws rather than being quietly ignored", () => {
    const world = testWorld(SEED);
    const state = initialState(world);
    // Walking before a starter is chosen is not a no-op, it is a corrupt log.
    expect(() => applyInput(world, state, { t: "move", dir: "n" } as Input)).toThrow();
  });
});

describe("the anti-scum property", () => {
  it("A1: the same encounter slot always holds the same creature", () => {
    // This is what makes save-scumming impossible. Walking away and coming
    // back does not reroll anything, because nothing was ever rolled.
    const world = testWorld(SEED);
    const route = "meadow-1";

    for (const slot of [0, 1, 7, 40, 119]) {
      const first = wildAt(world, ALL_SPECIES, route, slot, 1);
      const second = wildAt(world, ALL_SPECIES, route, slot, 1);
      expect(second).toEqual(first);
    }
  });

  it("A2: a rebuilt world serves the identical creature", () => {
    const one = wildAt(testWorld(SEED), ALL_SPECIES, "marsh-2", 12, 1);
    const two = wildAt(testWorld(SEED), ALL_SPECIES, "marsh-2", 12, 1);
    expect(two).toEqual(one);
  });

  it("A3: wild IVs are the table's — inside the bounds, and averaging what it says", () => {
    const world = testWorld(SEED);
    let total = 0;
    let rolled = 0;
    for (const route of outdoorRoutes(world)) {
      for (let slot = 0; slot < 25; slot++) {
        const wild = wildAt(world, ALL_SPECIES, route.id, slot, 1);
        for (const stat of STAT_IDS) {
          // Nothing is capped any more, but nothing is off the ladder either.
          expect(wild.ivs[stat]).toBeLessThanOrEqual(IV_MAX);
          expect(wild.ivs[stat]).toBeGreaterThanOrEqual(0);
          total += wild.ivs[stat];
          rolled++;
        }
      }
    }
    // Thousands of stats out of one world: the mean is the table's mean.
    expect(total / rolled).toBeGreaterThan(IV_MEAN - 1);
    expect(total / rolled).toBeLessThan(IV_MEAN + 1);
  });
});
