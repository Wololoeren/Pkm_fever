import { describe, expect, it } from "vitest";
import { rngFor } from "@/engine/rng";
import { rollIv, rollIvs, IV_MAX, IV_MEAN, IV_WEIGHTS, IV_WEIGHT_TOTAL } from "@/engine/stats";
import { STAT_IDS } from "@/engine/types";

/**
 * The table a creature born in the world rolls its stats off: nothing capped,
 * an average of six, and a 31 at 0.016%.
 */

describe("the IV table", () => {
  it("IV1: thirty-two weights out of a million, averaging six, with the tail it promises", () => {
    expect(IV_WEIGHTS).toHaveLength(IV_MAX + 1);
    expect(IV_WEIGHT_TOTAL).toBe(1_000_000);
    expect(IV_MEAN).toBeCloseTo(6, 3);

    // 0.016% at the top, which is one creature in about a thousand carrying
    // one somewhere across its six stats.
    expect(IV_WEIGHTS[IV_MAX] / IV_WEIGHT_TOTAL).toBeCloseTo(0.00016, 5);
    const anywhere = 1 - (1 - IV_WEIGHTS[IV_MAX] / IV_WEIGHT_TOTAL) ** STAT_IDS.length;
    expect(1 / anywhere).toBeGreaterThan(900);
    expect(1 / anywhere).toBeLessThan(1200);

    // It falls the whole way: every value is rarer than the one below it.
    for (let value = 1; value <= IV_MAX; value++) {
      expect(IV_WEIGHTS[value], `${value} against ${value - 1}`).toBeLessThan(IV_WEIGHTS[value - 1]);
    }
  });

  it("IV2: rolling it lands where the table says, and the same seed rolls the same stat", () => {
    const runs = 200_000;
    const seen = new Array<number>(IV_MAX + 1).fill(0);
    let total = 0;
    for (let at = 0; at < runs; at++) {
      const value = rollIv(rngFor("iv", at));
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(IV_MAX);
      seen[value]++;
      total += value;
    }

    expect(total / runs).toBeCloseTo(6, 1);
    // Half of everything is five or less, and a fifth is ten or better.
    const atMost = (bound: number) => seen.slice(0, bound + 1).reduce((sum, count) => sum + count, 0) / runs;
    expect(atMost(5)).toBeGreaterThan(0.47);
    expect(atMost(5)).toBeLessThan(0.58);
    expect(1 - atMost(9)).toBeGreaterThan(0.17);
    expect(1 - atMost(9)).toBeLessThan(0.27);
    // Nothing is capped: across two hundred thousand, the top of the ladder shows up.
    expect(seen[IV_MAX]).toBeGreaterThan(0);

    // One draw per stat, and the same stream twice is the same six.
    expect(rollIvs(rngFor("iv", 7))).toEqual(rollIvs(rngFor("iv", 7)));
  });
});
