import { describe, expect, it } from "vitest";
import { NATURE_MAGNITUDE, NATURES, natureVectorSum } from "@/engine/natures";
import { computeStat, IV_MAX, WILD_IV_MAX } from "@/engine/stats";
import { BATTLE_STAT_IDS } from "@/engine/types";
import { CENSUS_TOTAL, VARIANTS, variant } from "@/engine/variants";

/**
 * The arithmetic these pin is the whole balance argument for the custom
 * mechanics, so it is asserted against hand-computed numbers rather than
 * against whatever the code currently returns. If one of these changes, the
 * game changed, and every save file in existence replays differently.
 */

const LV = 50;
const BASE = 100;

const at = (iv: number, nature = 0, mult = 1000) =>
  computeStat(BASE, "atk", LV, iv, 0, nature, mult);

describe("stat arithmetic", () => {
  it("S1: one IV point is worth half a stat point at level 50", () => {
    expect(at(0)).toBe(105);
    expect(at(IV_MAX)).toBe(120);
    // The full IV range is worth 15 points. Everything else is measured
    // against this.
    expect(at(IV_MAX) - at(0)).toBe(15);
  });

  it("S2: a wild catch spans only three points, which is the design", () => {
    expect(at(WILD_IV_MAX)).toBe(108);
    expect(at(WILD_IV_MAX) - at(0)).toBe(3);
  });

  it("S3: a nature vector of 24 carries exactly vanilla's weight", () => {
    // Vanilla at IV 31 is floor(120 * 1.1) = 132 and floor(120 * 0.9) = 108.
    expect(at(IV_MAX, +NATURE_MAGNITUDE)).toBe(132);
    expect(at(IV_MAX, -NATURE_MAGNITUDE)).toBe(108);
    expect(at(IV_MAX, +NATURE_MAGNITUDE) - at(IV_MAX, -NATURE_MAGNITUDE)).toBe(24);
  });

  it("S4: an IV-scale nature vector would have been invisible", () => {
    // The mistake this design nearly made: +/-6 moves a stat by three points.
    expect(at(IV_MAX, 6) - at(IV_MAX, -6)).toBe(6);
  });

  it("S5: HP ignores the nature term entirely", () => {
    const withNature = computeStat(BASE, "hp", LV, IV_MAX, 0, NATURE_MAGNITUDE, 1000);
    const without = computeStat(BASE, "hp", LV, IV_MAX, 0, 0, 1000);
    expect(withNature).toBe(without);
  });

  it("S6: a stat can never be driven below its floor by a nature", () => {
    // Base 5, minimum IV, worst nature: the max(0, raw) guard has to hold.
    expect(computeStat(5, "atk", 100, 0, 0, -NATURE_MAGNITUDE, 1000)).toBeGreaterThanOrEqual(5);
  });
});

describe("variants", () => {
  it("V1: the true shiny is worth about one nature step, not more than IVs", () => {
    const plain = at(IV_MAX);
    const shiny = at(IV_MAX, 0, variant("shiny").mult.atk);
    expect(plain).toBe(120);
    expect(shiny).toBe(130);
    // +10 points: less than the 15 the whole IV range is worth, so breeding
    // still outranks luck.
    expect(shiny - plain).toBeLessThan(at(IV_MAX) - at(0));
  });

  it("V2: the ladder rises monotonically from normal to shiny", () => {
    const rungs = ["normal", "tint1", "tint2", "tint3", "tint4", "shiny"];
    const values = rungs.map((id) => at(IV_MAX, 0, variant(id).mult.atk));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });

  it("V3: chroma forms are sidegrades — every one gives something up", () => {
    for (const form of VARIANTS.filter((v) => v.kind === "chroma")) {
      const mults = Object.values(form.mult);
      expect(Math.max(...mults)).toBeGreaterThan(1000);
      expect(Math.min(...mults)).toBeLessThan(1000);
    }
  });

  it("V4: there are eleven appearances and a census of 46", () => {
    expect(VARIANTS).toHaveLength(11);
    expect(CENSUS_TOTAL).toBe(46);
  });
});

describe("natures", () => {
  it("N1: all 25 exist and every vector sums to zero", () => {
    expect(NATURES).toHaveLength(25);
    for (const nature of NATURES) {
      expect(natureVectorSum(nature.id)).toBe(0);
    }
  });

  it("N2: exactly five are neutral, as in vanilla", () => {
    const neutral = NATURES.filter((n) => n.plus === null && n.minus === null);
    expect(neutral).toHaveLength(5);
  });

  it("N3: no nature raises and lowers the same stat", () => {
    for (const nature of NATURES) {
      if (nature.plus && nature.minus) expect(nature.plus).not.toBe(nature.minus);
    }
  });

  it("N4: every battle stat is raised by some nature and lowered by another", () => {
    for (const stat of BATTLE_STAT_IDS) {
      expect(NATURES.some((n) => n.plus === stat)).toBe(true);
      expect(NATURES.some((n) => n.minus === stat)).toBe(true);
    }
  });
});
