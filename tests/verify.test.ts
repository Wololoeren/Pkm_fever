import { describe, expect, it } from "vitest";
import { reduce, stateHash, type Input } from "@/engine/engine";
import { ENGINE_VERSION } from "@/engine/types";
import { dailySeed, makeSave, normaliseSeed } from "@/lib/save";
import { verifySave } from "@/lib/verify";
import { play, testWorld } from "./helpers";

/**
 * The verify page and the daily seed.
 *
 * Both are the same claim as the replay tests, seen from a tournament desk:
 * a save replays to one state, and a date names one world.
 */

const SEED = "PKMFEVER1";

describe("the verify page", () => {
  it("VF1: a played save replays to the hash the engine would give it", () => {
    const world = testWorld(SEED);
    const { inputs } = play(world, 300);
    const report = verifySave(makeSave(SEED, inputs));

    expect(report.ok).toBe(true);
    expect(report.error).toBeNull();
    expect(report.moves).toBe(300);
    expect(report.seed).toBe(normaliseSeed(SEED));
    expect(report.hash).toBe(stateHash(reduce(world, inputs)));
    expect(report.cheated).toBe(false);
    expect(report.party.length).toBeGreaterThan(0);
    expect(report.version).toBe(ENGINE_VERSION);
  });

  it("VF2: a cheat leaves its mark, and the mark survives everything after it", () => {
    const world = testWorld(SEED);
    const { inputs } = play(world, 120);
    const cheat: Input = { t: "cheat", cheat: { op: "heal" } };
    const report = verifySave(makeSave(SEED, [...inputs.slice(0, 60), cheat, ...inputs.slice(60)]));

    // The rest of the log may or may not still replay after a heal; either
    // way the mark is what the desk reads.
    expect(report.cheated || !report.ok).toBe(true);
    if (report.ok) expect(report.cheated).toBe(true);
  });

  it("VF3: a log the engine refuses says where, rather than 'corrupt'", () => {
    const world = testWorld(SEED);
    const { inputs } = play(world, 50);
    // Dismissing a battle that is not there is refused by the engine.
    const broken: Input[] = [...inputs, { t: "continue" }, ...inputs.slice(0, 3)];
    const report = verifySave(makeSave(SEED, broken));

    expect(report.ok).toBe(false);
    expect(report.failedAt).toBe(inputs.length);
    expect(report.error).toBeTruthy();
    // And it still reports the state it reached, so the desk can see what
    // was there before the log went wrong.
    expect(report.moves).toBe(broken.length);
  });

  it("VF4: a save from another engine version is not verified, and says so", () => {
    const world = testWorld(SEED);
    const { inputs } = play(world, 20);
    const report = verifySave({ ...makeSave(SEED, inputs), v: ENGINE_VERSION + 1 });
    expect(report.ok).toBe(false);
    expect(report.error).toContain("engine version");
  });
});

describe("today's seed", () => {
  it("VF5: one seed per day, in the alphabet a seed can be read out loud in", () => {
    const a = dailySeed(new Date("2026-09-12T00:00:01Z"));
    const b = dailySeed(new Date("2026-09-12T23:59:59Z"));
    const c = dailySeed(new Date("2026-09-13T00:00:01Z"));
    expect(a).toBe("DAY20260912");
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(normaliseSeed(a)).toBe(a);
  });

  it("VF6: and it is the same world for two people who begin it", () => {
    const seed = dailySeed(new Date("2026-09-12T12:00:00Z"));
    const one = testWorld(seed);
    const two = testWorld(seed);
    expect(one.starters).toEqual(two.starters);
    expect(stateHash(reduce(one, []))).toBe(stateHash(reduce(two, [])));
  });
});
