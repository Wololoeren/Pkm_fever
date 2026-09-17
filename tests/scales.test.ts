import { describe, expect, it } from "vitest";
import { breed, expectedIvs, ivTilt } from "@/engine/breeding";
import { HELD_ITEMS, SCALE_AMOUNT } from "@/engine/carry";
import { item } from "@/engine/items";
import { IV_MAX } from "@/engine/stats";
import { STAT_IDS, type StatTable } from "@/engine/types";
import { creature } from "./helpers";

/**
 * The IV scales: held by a parent, they move five IV points from one stat to
 * another on every egg — for builds that want a stat low as much as high.
 */

const SEED = "SCALES1";
const ivs = (n: number): StatTable => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });
const mother = (heldItem: string | null = null, level = 15) =>
  creature("rattata", { uid: 1, gender: "female", iv: level, heldItem });
const father = (heldItem: string | null = null, level = 15) =>
  creature("rattata", { uid: 2, gender: "male", iv: level, heldItem });

describe("IV scales", () => {
  const scales = HELD_ITEMS.filter((entry) => entry.id.startsWith("hold-scale-"));

  it("SC1: thirty of them, one for every ordered pair of stats, sold at the Mart", () => {
    expect(scales).toHaveLength(30);
    const pairs = new Set(
      scales.map((entry) => {
        const tilt = entry.hold.effects.find((effect) => effect.t === "tilt");
        expect(tilt?.t === "tilt" && tilt.up !== tilt.down && tilt.amount === SCALE_AMOUNT, entry.id).toBe(true);
        return tilt?.t === "tilt" ? `${tilt.up}>${tilt.down}` : "";
      }),
    );
    expect(pairs.size).toBe(30);
    expect(item("hold-scale-atk-spe").name).toBe("Scale: +Atk −Spe");
    expect(item("hold-scale-atk-spe").price).toBeGreaterThan(0);
  });

  it("SC2: an egg is the same egg, moved five up in one stat and five down in the other", () => {
    for (let egg = 0; egg < 40; egg++) {
      const plain = breed(SEED, mother(), father(), egg, []);
      const scaled = breed(SEED, mother("hold-scale-atk-spe"), father(), egg, []);
      for (const stat of STAT_IDS) {
        const want =
          stat === "atk" ? Math.min(IV_MAX, plain.ivs.atk + 5) : stat === "spe" ? Math.max(0, plain.ivs.spe - 5) : plain.ivs[stat];
        expect(scaled.ivs[stat], `egg ${egg} ${stat}`).toBe(want);
      }
      // Nothing else about the egg moved.
      expect(scaled.natureId).toBe(plain.natureId);
      expect(scaled.variantId).toBe(plain.variantId);
      expect(scaled.abilities).toEqual(plain.abilities);
    }
  });

  it("SC3: never below nought or above the cap, and two scales on the pair add", () => {
    // Parents with nothing in Speed: the egg's Speed can only be 0 plus a
    // mutation of at most 3, so five off always reaches the floor.
    for (let egg = 0; egg < 20; egg++) {
      const low = breed(SEED, mother("hold-scale-hp-spe", 0), father(null, 0), egg, []);
      expect(low.ivs.spe).toBe(0);
      const high = breed(SEED, mother("hold-scale-hp-spe", IV_MAX), father(null, IV_MAX), egg, []);
      expect(high.ivs.hp).toBe(IV_MAX);
      expect(high.ivs.spe).toBe(IV_MAX - 5);
    }

    expect(ivTilt([mother("hold-scale-atk-spe"), father("hold-scale-def-spe")])).toEqual({
      hp: 0, atk: 5, def: 5, spa: 0, spd: 0, spe: -10,
    });
    expect(ivTilt([mother("hold-scale-atk-spe"), father("hold-scale-spe-atk")])).toEqual(ivs(0));
  });

  it("SC4: the daycare's expected IVs still match what the eggs actually come out as", () => {
    const a = { ...mother("hold-scale-spa-spe"), ivs: { hp: 30, atk: 3, def: 12, spa: 29, spd: 20, spe: 4 } };
    const b = { ...father(), ivs: { hp: 10, atk: 0, def: 25, spa: 31, spd: 18, spe: 7 } };
    const N = 6000;
    const sums = ivs(0);
    for (let egg = 0; egg < N; egg++) {
      const child = breed(SEED, a, b, egg, []);
      for (const stat of STAT_IDS) sums[stat] += child.ivs[stat];
    }
    for (const row of expectedIvs(a, b, [])) {
      expect(Math.abs(sums[row.stat] / N - row.expected), row.stat).toBeLessThan(0.35);
    }
  });
});
