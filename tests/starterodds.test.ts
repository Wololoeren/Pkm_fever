import { describe, expect, it } from "vitest";
import { rollAbilities, STARTER_ABILITY_ODDS, WILD_ABILITY_ODDS } from "@/engine/abilities";
import { rngFor } from "@/engine/rng";
import { starterAppearance } from "@/engine/world";

/** The starter odds: a better ladder, colour and ability count than the wild. */
describe("starter odds", () => {
  it("SO1: shiny 1%, Nearly 1.5%, Turning 2%, Washed 2.5%, Faded 3%", () => {
    const runs = 40_000;
    const tiers = [0, 0, 0, 0, 0, 0];
    for (let n = 0; n < runs; n++) {
      const id = starterAppearance(`ODDS${n}`, 0);
      const tier = id.includes("shiny") ? 5 : Number(/tint(\d)/.exec(id)?.[1] ?? 0);
      tiers[tier]++;
    }
    const share = tiers.map((count) => count / runs);
    expect(share[5]).toBeCloseTo(0.01, 2);
    expect(share[4]).toBeCloseTo(0.015, 2);
    expect(share[3]).toBeCloseTo(0.02, 2);
    expect(share[2]).toBeCloseTo(0.025, 2);
    expect(share[1]).toBeCloseTo(0.03, 2);
  });

  it("SO2: starters 30% one, 6% two, 1% three; the wild unchanged", () => {
    const runs = 40_000;
    const count = (odds = WILD_ABILITY_ODDS) => {
      const by = [0, 0, 0, 0];
      for (let n = 0; n < runs; n++) by[rollAbilities(rngFor("odds", n), odds).length]++;
      return by.map((one) => one / runs);
    };
    const starter = count(STARTER_ABILITY_ODDS);
    expect(starter[1]).toBeCloseTo(0.3, 1);
    expect(starter[2]).toBeCloseTo(0.06, 2);
    expect(starter[3]).toBeCloseTo(0.01, 2);
    const wild = count();
    expect(wild[1]).toBeCloseTo(0.1, 1);
    expect(wild[2]).toBeCloseTo(0.01, 2);
    expect(wild[3]).toBe(0);
  });
});
