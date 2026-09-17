import { describe, expect, it } from "vitest";
import {
  applyInput,
  EGG_PRICE_BASE,
  eggValue,
  initialState,
  sellEggRefusal,
  stateHash,
  type GameState,
} from "@/engine/engine";
import { EGG_BUYER_AFTER_TWO } from "@/engine/npc";
import { appearanceId, CHROMA_IDS, TOP_TIER } from "@/engine/variants";
import { creature, testWorld } from "./helpers";

/**
 * Gus, the egg buyer in New Willow.
 *
 * Eggs unopened, 1000 to 3000 by what is inside, and a line about the pan once
 * he has two.
 */

const GUS = "egg-buyer";

function egg(uid: number, tier = 0, chromaId: string | null = null) {
  return { creature: creature("togepi", { uid, level: 1, variantId: appearanceId(tier, chromaId) }), steps: 500, total: 500 };
}

function atGus(seed: string, eggs: ReturnType<typeof egg>[]) {
  const world = testWorld(seed);
  const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  const where = [...world.npcs].find(([, here]) => here.some((one) => one.id === GUS));
  expect(where, "Gus is not placed").toBeDefined();
  const [routeId, here] = where!;
  const him = here.find((one) => one.id === GUS)!;
  const state: GameState = { ...start, route: routeId, x: him.x, y: him.y - 1, talking: GUS, eggs };
  return { world, state };
}

describe("the egg buyer", () => {
  it("EB1: he is in New Willow on every seed", () => {
    for (const seed of ["EGGS1", "EGGS2", "EGGS3"]) {
      const world = testWorld(seed);
      const where = [...world.npcs].find(([, here]) => here.some((one) => one.id === GUS));
      expect(where?.[0]).toBe("town-2");
    }
  });

  it("EB2: a plain egg is 1000, a true shiny in a colour is 3000, and every egg is in between", () => {
    expect(eggValue(egg(1))).toBe(EGG_PRICE_BASE);
    expect(eggValue(egg(1, TOP_TIER, CHROMA_IDS[0]))).toBe(3000);
    for (let tier = 0; tier <= TOP_TIER; tier++) {
      for (const chromaId of [null, ...CHROMA_IDS]) {
        const value = eggValue(egg(1, tier, chromaId));
        expect(value).toBeGreaterThanOrEqual(1000);
        expect(value).toBeLessThanOrEqual(3000);
      }
      // Each rung is worth more than the one below it.
      if (tier > 0) expect(eggValue(egg(1, tier))).toBeGreaterThan(eggValue(egg(1, tier - 1)));
    }
    expect(eggValue(egg(1, 0, CHROMA_IDS[0]))).toBeGreaterThan(eggValue(egg(1)));
  });

  it("EB3: selling takes the egg, pays for it and counts it", () => {
    const shiny = egg(7, TOP_TIER);
    const { world, state } = atGus("EGGS1", [egg(6), shiny]);

    const sold = applyInput(world, state, { t: "sellEgg", index: 1, confirm: 7 });
    expect(sold.eggs).toHaveLength(1);
    expect(sold.eggs[0].creature.uid).toBe(6);
    expect(sold.money).toBe(state.money + eggValue(shiny));
    expect(sold.eggsSold).toBe(1);
    expect(sold.notice).toEqual({ t: "eggSold", money: eggValue(shiny), count: 1 });
  });

  it("EB4: the wrong egg, or nobody to sell to, is refused", () => {
    const { world, state } = atGus("EGGS1", [egg(6)]);
    expect(sellEggRefusal(world, state, 0, 99)).toBe("that is not the egg you were shown");
    expect(sellEggRefusal(world, state, 3, 6)).toBe("no such egg");
    expect(sellEggRefusal(world, { ...state, talking: null }, 0, 6)).toBe("nobody is talking");
    expect(() => applyInput(world, state, { t: "sellEgg", index: 0, confirm: 99 })).toThrow();
  });

  it("EB5: he has more to say after the second — and never says the word", () => {
    const { world, state } = atGus("EGGS2", [egg(6), egg(8)]);
    const once = applyInput(world, state, { t: "sellEgg", index: 0, confirm: 6 });
    const twice = applyInput(world, once, { t: "sellEgg", index: 0, confirm: 8 });
    expect(once.eggsSold).toBe(1);
    expect(twice.eggsSold).toBe(2);

    expect(EGG_BUYER_AFTER_TWO.length).toBeGreaterThan(0);
    expect(EGG_BUYER_AFTER_TWO.join(" ").toLowerCase()).not.toContain("omelet");
  });
});

describe("people you have spoken to", () => {
  it("EB6: walking into somebody remembers them, once, and it changes nothing the hash can see", () => {
    const { world, state } = atGus("EGGS1", []);
    const before = { ...state, talking: null, spokenTo: [] };
    const talked = applyInput(world, before, { t: "move", dir: "s" });
    expect(talked.talking).toBe(GUS);
    expect(talked.spokenTo).toEqual([GUS]);
    const again = applyInput(world, { ...talked, talking: null }, { t: "move", dir: "s" });
    expect(again.spokenTo).toEqual([GUS]);
    expect(stateHash(talked)).toBe(stateHash({ ...talked, spokenTo: [] }));
  });
});
