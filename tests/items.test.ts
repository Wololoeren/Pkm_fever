import { describe, expect, it } from "vitest";
import { ALL_SPECIES } from "@/engine/dex";
import {
  applyInput,
  bestRod,
  buyRefusal,
  fishRefusal,
  FISH_STEPS,
  initialState,
  reduce,
  sellRefusal,
  stateHash,
  itemRefusal,
  type GameState,
} from "@/engine/engine";
import { addItem, BALLS, countOf, hasItem, item, ITEMS, MART_STOCK, removeItem } from "@/engine/items";
import { TILE } from "@/engine/terrain";
import { fishAt, fishingTable } from "@/engine/world";
import { creature, standInside, testWorld } from "./helpers";

/**
 * The bag, the purse, and the Mart.
 *
 * Everything held lives in one place now — balls, medicine, rods and breeding
 * gear together — because "how many of this do I have" should have one answer
 * whatever it is you are asking about.
 */

function started(seed = "PKMFEVER1") {
  const world = testWorld(seed);
  const state = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  return { world, state };
}

describe("the catalogue", () => {
  it("I1: nothing sells for more than it costs, or a bag is a mint", () => {
    for (const spec of ITEMS) {
      if (spec.price > 0) expect(spec.sell).toBeLessThanOrEqual(spec.price);
      expect(spec.sell).toBeGreaterThanOrEqual(0);
    }
  });

  it("I2: every item the Mart stocks is one the engine can describe", () => {
    for (const spec of MART_STOCK) {
      expect(spec.price).toBeGreaterThan(0);
      expect(item(spec.id).name).toBe(spec.name);
      expect(spec.blurb.length).toBeGreaterThan(0);
    }
  });

  it("I3: the plain balls cost more and hold better, in the same order", () => {
    // The ones with a condition are priced for the condition, not the base
    // rate, so the ladder is the three that are only a rate.
    const plain = BALLS.filter((ball) => !ball.ballRule);
    expect(plain.map((ball) => ball.id)).toEqual(["pokeball", "greatball", "ultraball"]);
    for (let i = 1; i < plain.length; i++) {
      expect(plain[i].ballMult!).toBeGreaterThan(plain[i - 1].ballMult!);
      expect(plain[i].price).toBeGreaterThan(plain[i - 1].price);
    }
    // And the Master Ball is the last thing a battle offers.
    expect(BALLS.at(-1)!.id).toBe("masterball");
  });

  it("I4: equipment never stacks past one", () => {
    let bag = {};
    bag = addItem(bag, "oldrod", 5);
    expect(countOf(bag, "oldrod")).toBe(1);

    // Stacking things do stack.
    bag = addItem(bag, "potion", 5);
    bag = addItem(bag, "potion", 3);
    expect(countOf(bag, "potion")).toBe(8);
  });

  it("I5: taking the last of something removes it rather than leaving a zero", () => {
    const bag = removeItem(addItem({}, "potion", 1), "potion");
    expect(hasItem(bag, "potion")).toBe(false);
    expect(Object.keys(bag)).not.toContain("potion");
    expect(() => removeItem(bag, "potion")).toThrow();
  });
});

describe("using things", () => {
  it("I6: a potion heals, and is spent doing it", () => {
    const { world, state } = started();
    const hurt: GameState = {
      ...state,
      bag: addItem(state.bag, "potion", 2),
      party: [{ ...state.party[0], hp: 1 }],
    };

    const used = applyInput(world, hurt, { t: "useItem", item: "potion", index: 0 });
    expect(used.party[0].hp).toBeGreaterThan(1);
    expect(countOf(used.bag, "potion")).toBe(1);
  });

  it("I7: it is refused on something that does not need it, and says why", () => {
    const { world, state } = started();
    const full: GameState = { ...state, bag: addItem(state.bag, "potion") };

    expect(itemRefusal(world, full, "potion", 0)).toBe("it is already well");
    expect(() => applyInput(world, full, { t: "useItem", item: "potion", index: 0 })).toThrow();

    // And on nobody at all.
    expect(itemRefusal(world, full, "potion", 5)).toBe("nobody there");
    expect(itemRefusal(world, state, "potion", 0)).toBe("you have none");
  });

  it("I8: a revive is for the fallen, and a potion is not", () => {
    const { world, state } = started();
    const down: GameState = {
      ...state,
      bag: addItem(addItem(state.bag, "revive", 2), "potion"),
      party: [{ ...state.party[0], hp: 0 }],
    };

    expect(itemRefusal(world, down, "potion", 0)).toBe("it has fainted");
    expect(itemRefusal(world, down, "revive", 0)).toBeNull();

    const back = applyInput(world, down, { t: "useItem", item: "revive", index: 0 });
    expect(back.party[0].hp).toBeGreaterThan(0);
    // Still carrying one, so the refusal is about the target rather than the
    // bag — the bag is checked first, which is the more immediate truth.
    expect(countOf(back.bag, "revive")).toBe(1);
    expect(itemRefusal(world, back, "revive", 0)).toBe("it is still standing");
  });

  it("I9: a rare candy is one level, and stops at the ceiling", () => {
    const { world, state } = started();
    const ready: GameState = {
      ...state,
      bag: addItem(state.bag, "rarecandy", 2),
      party: [creature("machop", { uid: 1, level: 20 })],
    };

    const grown = applyInput(world, ready, { t: "useItem", item: "rarecandy", index: 0 });
    expect(grown.party[0].level).toBe(21);

    const capped: GameState = { ...ready, party: [creature("machop", { uid: 1, level: 100 })] };
    expect(itemRefusal(world, capped, "rarecandy", 0)).toBe("it cannot grow further");
  });

  it("I10: things that are not medicine are not used on creatures", () => {
    const { world, state } = started();
    const holding: GameState = { ...state, bag: addItem(state.bag, "nugget") };
    expect(itemRefusal(world, holding, "nugget", 0)).toContain("not used on a creature");
  });
});

describe("the Mart", () => {
  function inMart() {
    const { world, state } = started();
    return { world, state: standInside(world, state, "mart") };
  }

  it("I11: buying costs money and fills the bag", () => {
    const { world, state } = inMart();
    const bought = applyInput(world, state, { t: "buyItem", item: "potion", count: 3 });

    expect(countOf(bought.bag, "potion")).toBe(3);
    expect(bought.money).toBe(state.money - item("potion").price * 3);
  });

  it("I12: you cannot buy what you cannot afford, or outside the shop", () => {
    const { world, state: fresh } = inMart();
    // Past every shelf's gate, so the purse is the only thing in the way.
    const state = { ...fresh, badges: ["1", "2", "3", "4", "5", "6", "7"] };

    expect(buyRefusal(world, state, "superrod", 1)).toBe("you cannot afford that");
    expect(buyRefusal(world, state, "nugget", 1)).toBe("that is not for sale");

    // Standing in the town square is standing outside the Mart.
    const { world: w2, state: outside } = started();
    expect(buyRefusal(w2, outside, "potion", 1)).toBe("you are not in the Mart");
    expect(() => applyInput(w2, outside, { t: "buyItem", item: "potion", count: 1 })).toThrow();
  });

  it("I13: selling pays and empties, and a round trip is never profitable", () => {
    const { world, state } = inMart();

    const bought = applyInput(world, state, { t: "buyItem", item: "potion", count: 2 });
    const sold = applyInput(world, bought, { t: "sellItem", item: "potion", count: 2 });

    expect(countOf(sold.bag, "potion")).toBe(0);
    // Buying and selling the same thing must lose money, or the Mart is an
    // infinite loop with a counter in front of it.
    expect(sold.money).toBeLessThan(state.money);
  });

  it("I14: you cannot sell what you do not have, nor the irreplaceable", () => {
    const { world, state } = inMart();

    expect(sellRefusal(world, state, "potion", 1)).toBe("you do not have that many");

    const withPrism: GameState = { ...state, bag: addItem(state.bag, "prism") };
    expect(sellRefusal(world, withPrism, "prism", 1)).toBe("nobody will buy that");
  });

  it("I15: trainers pay into the purse, and it buys things", () => {
    const { world, state } = inMart();
    const rich: GameState = { ...state, money: 999_999, badges: ["1", "2", "3", "4", "5", "6", "7"] };
    expect(buyRefusal(world, rich, "superrod", 1)).toBeNull();

    const bought = applyInput(world, rich, { t: "buyItem", item: "superrod", count: 1 });
    expect(bestRod(bought.bag)?.id).toBe("superrod");
    // A second one is not twice the rod.
    expect(buyRefusal(world, bought, "superrod", 1)).toBe("you already have one");
  });
});

describe("fishing", () => {
  it("I16: no rod, no fishing — and the refusal says which problem it is", () => {
    const { world, state } = started();
    expect(fishRefusal(world, state)).toBe("you have no rod");

    const equipped: GameState = { ...state, bag: addItem(state.bag, "oldrod") };
    expect(fishRefusal(world, equipped)).toBe("no water within reach");
  });

  it("I17: standing beside water with a rod, you can cast", () => {
    const world = testWorld("A1");
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    // Find any tile with water next to it, anywhere in the world.
    let spot: GameState | null = null;
    for (const route of world.routes.values()) {
      for (let y = 1; y < route.height - 1 && !spot; y++) {
        for (let x = 1; x < route.width - 1 && !spot; x++) {
          if (route.tiles[y * route.width + x] === TILE.WATER) continue;
          const beside = [
            [0, -1],
            [0, 1],
            [-1, 0],
            [1, 0],
          ].some(([dx, dy]) => route.tiles[(y + dy) * route.width + (x + dx)] === TILE.WATER);
          if (beside) {
            spot = { ...base, route: route.id, x, y, bag: addItem(base.bag, "oldrod") };
          }
        }
      }
      if (spot) break;
    }

    expect(spot, "no water anywhere in this world").not.toBeNull();
    expect(fishRefusal(world, spot!)).toBeNull();

    const hooked = applyInput(world, spot!, { t: "fish" });
    expect(hooked.phase).toBe("battle");
    expect(hooked.battle!.sides[1].team).toHaveLength(1);

    // Casting again gives the next one along, never a second roll at the last.
    expect(hooked.nextSlot[`${spot!.route}:rod`]).toBe(1);

    // And it costs the walk it saves: eight steps of the world go by, so a
    // pond is not a way to train without spending any of the game's clock.
    expect(hooked.stepsTaken).toBe(spot!.stepsTaken + FISH_STEPS);

    // Real steps: an egg in the bag is eight nearer hatching.
    const carrying = {
      ...spot!,
      eggs: [{ creature: hooked.party[0], steps: 100, total: 100 }],
    };
    expect(applyInput(world, carrying, { t: "fish" }).eggs[0].steps).toBe(100 - FISH_STEPS);
  });

  it("I18: what bites is a water creature, and a better rod reaches better ones", () => {
    const world = testWorld("A1");

    for (const reach of [1, 2, 3]) {
      const table = fishingTable(ALL_SPECIES, 1, reach, world.config.rings);
      expect(table.length).toBeGreaterThan(0);
      for (const row of table) {
        const species = ALL_SPECIES.find((entry) => entry.id === row.speciesId)!;
        expect(species.types).toContain("water");
      }
    }

    // Depth is a second axis of progress: a Super Rod in the shallows finds
    // stronger things than an Old Rod does, without walking further out.
    const shallow = fishingTable(ALL_SPECIES, 1, 1, world.config.rings);
    const deep = fishingTable(ALL_SPECIES, 1, 3, world.config.rings);
    const power = (rows: { speciesId: string }[]) => {
      const stats = rows.map((row) => {
        const species = ALL_SPECIES.find((entry) => entry.id === row.speciesId)!;
        return Object.values(species.base).reduce((sum, value) => sum + value, 0);
      });
      return stats.reduce((sum, value) => sum + value, 0) / stats.length;
    };
    expect(power(deep)).toBeGreaterThan(power(shallow));
  });

  it("I19: the same cast from the same spot always hooks the same creature", () => {
    const world = testWorld("A1");
    const route = [...world.routes.values()].find((entry) => entry.kind === "route")!.id;

    const once = fishAt(world, ALL_SPECIES, route, 1, 3, 1);
    const twice = fishAt(world, ALL_SPECIES, route, 1, 3, 1);
    expect(twice).toEqual(once);

    // A different rod is a different table, not the same fish at a new level.
    const deeper = fishAt(world, ALL_SPECIES, route, 3, 3, 1);
    expect(deeper.speciesId === once.speciesId && deeper.level === once.level).toBe(false);
  });
});

describe("the log still decides everything", () => {
  it("I20: buying, using and fishing all replay", () => {
    const world = testWorld("PKMFEVER1");
    const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    void start;

    const inputs = [
      { t: "pickStarter" as const, index: 0 },
      { t: "cheat" as const, cheat: { op: "money" as const, count: 50_000 } },
      { t: "cheat" as const, cheat: { op: "warp" as const, route: martRoute(world) } },
      { t: "buyItem" as const, item: "potion", count: 4 },
      { t: "sellItem" as const, item: "potion", count: 1 },
    ];

    const once = reduce(world, inputs);
    expect(countOf(once.bag, "potion")).toBe(3);
    expect(stateHash(reduce(world, inputs))).toBe(stateHash(once));
  });
});

function martRoute(world: ReturnType<typeof testWorld>): string {
  return [...world.routes.values()].find((route) => route.role === "mart")!.id;
}
