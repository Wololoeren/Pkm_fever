import { describe, expect, it } from "vitest";
import { NATURE_MAGNITUDE, NATURES, natureVectorSum } from "@/engine/natures";
import { baseAtLevel, computeStat, IV_MAX, statBreakdown, termAtLevel, WILD_IV_MAX } from "@/engine/stats";
import { BATTLE_STAT_IDS, STAT_IDS } from "@/engine/types";
import { APPEARANCE_COUNT, CENSUS_TOTAL, CHROMAS, variant } from "@/engine/variants";

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
    for (const form of CHROMAS) {
      const mults = Object.values(form.mult);
      expect(Math.max(...mults)).toBeGreaterThan(1000);
      expect(Math.min(...mults)).toBeLessThan(1000);
    }
  });

  it("V4: there are 54 appearances and a census of 58", () => {
    // Six rungs times eight colours or none.
    expect(APPEARANCE_COUNT).toBe(54);
    expect(CENSUS_TOTAL).toBe(58);
  });

  it("V5: the two axes are independent and fold into one multiplier", () => {
    // The reason the whole model changed: a shiny Tide is a real thing, and it
    // is the shiny multiplier and the Tide multiplier composed, not either of
    // them winning.
    const form = variant("shiny:tide");
    expect(form.tier).toBe(5);
    expect(form.chromaId).toBe("tide");
    expect(form.name).toBe("Shiny Tide");

    const shiny = variant("shiny").mult;
    const tide = variant("tide").mult;
    for (const stat of STAT_IDS) {
      expect(form.mult[stat]).toBe(Math.round((shiny[stat] * tide[stat]) / 1000));
    }

    // And a colour at rung zero still spells the way it always did, so every
    // id a version 2 save could hold still parses.
    expect(variant("tide").tier).toBe(0);
    expect(variant("tint3").chromaId).toBeNull();
  });

  it("V6: Onyx and Ivory are opposites, and neither is a hue", () => {
    const onyx = CHROMAS.find((form) => form.id === "onyx")!;
    const ivory = CHROMAS.find((form) => form.id === "ivory")!;

    // No rotation reaches black or white, which is why these two move
    // lightness instead — in opposite directions, and both drain colour.
    expect(onyx.hueShift).toBe(0);
    expect(ivory.hueShift).toBe(0);
    expect(onyx.lightShift).toBeLessThan(0);
    expect(ivory.lightShift).toBeGreaterThan(0);
    expect(onyx.satScale).toBeLessThan(1000);
    expect(ivory.satScale).toBeLessThan(1000);

    // They spike harder than the colours and pay for it twice.
    expect(Math.max(...Object.values(onyx.mult))).toBeGreaterThan(1100);
    expect(Object.values(onyx.mult).filter((m) => m < 1000)).toHaveLength(2);
  });
});

describe("what a base stat is worth right now", () => {
  it("V7: base is doubled, then scaled by level", () => {
    // The number the dex quotes and the number in a level-five battle look
    // nothing alike, which is the commonest confusion a stat screen causes.
    expect(baseAtLevel(45, 100)).toEqual({ now: 90, max: 90 });
    expect(baseAtLevel(45, 5)).toEqual({ now: 4, max: 90 });
    expect(baseAtLevel(45, 50)).toEqual({ now: 45, max: 90 });
    expect(baseAtLevel(0, 50)).toEqual({ now: 0, max: 0 });
  });

  it("V8: and the shares agree with the stat the battle actually uses", () => {
    // Not to the point — the pipeline floors the sum once rather than each
    // term — but close enough that the screen is not telling a story the
    // battle disagrees with.
    for (const level of [5, 25, 50, 100]) {
      for (const base of [20, 45, 90, 130]) {
        const real = computeStat(base, "atk", level, 31, 0, 0, 1000);
        const shown = baseAtLevel(base, level).now + termAtLevel(31, level).now + 5;
        expect(Math.abs(real - shown), `base ${base} at level ${level}`).toBeLessThanOrEqual(1);
      }
    }
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

describe("statBreakdown", () => {
  it("adds up to computeStat exactly, including rounding and negative natures", () => {
    for (const stat of ["hp", "atk"] as const) {
      for (const level of [1, 5, 13, 50, 100]) {
        for (const [base, iv, ev, nat, mult] of [
          [90, 9, 4, 0, 1280], [85, 27, 2, -24, 1031], [95, 31, 2, 0, 1085], [5, 0, 0, -24, 1000], [85, 16, 12, 24, 1085],
        ]) {
          const b = statBreakdown(base, stat, level, iv, ev, nat, mult);
          expect(b.total).toBe(computeStat(base, stat, level, iv, ev, nat, mult));
          expect(b.base + b.iv + b.nature + b.ev + b.flat + b.special).toBe(b.total);
        }
      }
    }
  });

  it("credits the IV that tips the sum over a rounding step", () => {
    const b = statBreakdown(95, "spa", 1, 31, 0, 0, 1000);
    expect([b.base, b.iv, b.flat, b.total]).toEqual([1, 1, 5, 7]);
  });
});
