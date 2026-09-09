import { describe, expect, it } from "vitest";
import {
  appraisal,
  appraiseRefusal,
  applyInput,
  activeLures,
  initialState,
  itemRefusal,
  lureLeft,
  nextEncounterSlot,
  offerRefusal,
  reduce,
  stateHash,
  type GameState,
  type Input,
} from "@/engine/engine";
import {
  climbChance,
  CLIMB_ITEMS,
  flatBonus,
  GLITTER,
  inheritTier,
  tierMatrix,
} from "@/engine/breeding";
import { countOf, item, ITEMS, LURE_MOVES, LURES } from "@/engine/items";
import { NPCS, SHINE_GLITTER, SHINE_PRICE } from "@/engine/npc";
import { rngFor } from "@/engine/rng";
import { walkable } from "@/engine/terrain";
import { appearanceId, TOP_TIER, variant } from "@/engine/variants";
import { creature, testWorld } from "./helpers";

/**
 * The shine economy: what somebody will pay for it, what buys more of it, and
 * what brings it to you sooner.
 *
 * All three lean on the same rule, which is the one worth guarding: shine is
 * decided when the world is made or when an egg is produced, and never at the
 * moment a player would like some. The buyer takes shine away, the breeding
 * gear makes the next egg likelier to have it, and a lure only closes the
 * distance to shine that already exists somewhere down the route.
 */

function started(seed = "PKMFEVER1") {
  const world = testWorld(seed);
  const state = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  return { world, state };
}

/** Stands the player next to somebody, wherever they ended up. */
function beside(world: ReturnType<typeof testWorld>, state: GameState, id: string) {
  for (const [routeId, here] of world.npcs) {
    const who = here.find((one) => one.id === id);
    if (!who) continue;
    const route = world.routes.get(routeId)!;
    const spot = [
      { x: who.x - 1, y: who.y },
      { x: who.x + 1, y: who.y },
      { x: who.x, y: who.y - 1 },
      { x: who.x, y: who.y + 1 },
    ].find((at) => walkable(route.tiles[at.y * route.width + at.x]));
    if (!spot) continue;
    return { ...state, route: routeId, x: spot.x, y: spot.y };
  }
  throw new Error(`nobody called ${id} was placed`);
}

describe("the buyer in the north", () => {
  it("S1: the Appraiser is indoors on pinewood's third ring, on every seed", () => {
    for (const seed of ["A1", "B2", "C3", "D4", "E5", "F6"]) {
      const world = testWorld(seed);
      const where = [...world.npcs].find(([, here]) =>
        here.some((one) => one.id === "buy-appraiser"),
      );
      expect(where, `no Appraiser on seed ${seed}`).toBeDefined();

      // The cabin is *built* for him rather than hoped for. One random attempt
      // per route put a cabin on one pinewood route in forty-eight, because
      // pinewood's rooms are the small ones — so a person written to be inside
      // one was, in practice, always outside instead.
      const [routeId] = where!;
      expect(routeId, `Appraiser is outdoors on seed ${seed}`).toBe("pinewood-3:cabin");

      const room = world.routes.get(routeId)!;
      expect(room.kind).toBe("interior");
      // And the door out of it still goes somewhere.
      expect(room.doors.some((door) => door.to === "pinewood-3")).toBe(true);
    }
  });

  it("S2: a thousand a rung, in money or in Glitter", () => {
    for (let tier = 0; tier <= TOP_TIER; tier++) {
      const paid = appraisal(creature("pidgey", { variantId: appearanceId(tier, null) }));
      expect(paid.money).toBe(tier * SHINE_PRICE);
      expect(paid.glitter).toBe(tier * SHINE_GLITTER);
    }

    // The headline number the Appraiser quotes.
    expect(appraisal(creature("pidgey", { variantId: "shiny" })).money).toBe(5_000);
  });

  it("S3: colour is not shine, and is not paid for", () => {
    const wearing = creature("pidgey", { variantId: "ember" });
    expect(appraisal(wearing)).toEqual({ money: 0, glitter: 0 });

    const both = creature("pidgey", { variantId: "shiny:ember" });
    expect(appraisal(both).money).toBe(5_000);
  });

  it("S4: he will not take a plain one, and will not take the wrong one", () => {
    const { world } = started("SELL1");
    let state = beside(world, started("SELL1").state, "buy-appraiser");

    const plain = creature("pidgey", { uid: 90, variantId: "normal" });
    const shiny = creature("rattata", { uid: 91, variantId: "shiny" });
    state = { ...state, party: [plain, shiny], talking: "buy-appraiser" };

    // Nothing shiny at all is a refusal before any creature is named.
    expect(offerRefusal(world, { ...state, party: [plain] })).toMatch(/shine/);

    expect(appraiseRefusal(world, state, 0, plain.uid)).toBe("there is no shine on that one");
    // The uid is the safety catch: the right slot with the wrong identity is
    // a mis-click on a list that moved, and it sells nothing.
    expect(appraiseRefusal(world, state, 1, plain.uid)).toBe("that is not the one you were shown");
    expect(appraiseRefusal(world, state, 1, shiny.uid)).toBeNull();
  });

  it("S5: you cannot sell the last thing that can fight", () => {
    const { world, state } = started("SELL2");
    const only = creature("rattata", { uid: 92, variantId: "shiny" });
    const alone = { ...beside(world, state, "buy-appraiser"), party: [only], talking: "buy-appraiser" };
    expect(appraiseRefusal(world, alone, 0, only.uid)).toBe("keep something that can fight");
  });

  it("S6: selling hands over the money and takes the creature", () => {
    const { world, state } = started("SELL3");
    const keep = creature("pidgey", { uid: 93 });
    const shiny = creature("rattata", { uid: 94, variantId: "shiny" });
    const standing = { ...beside(world, state, "buy-appraiser"), party: [keep, shiny], talking: "buy-appraiser" };

    const paid = applyInput(world, standing, {
      t: "npcSell",
      index: 1,
      take: "money",
      confirm: shiny.uid,
    });
    expect(paid.party.map((one) => one.uid)).toEqual([93]);
    expect(paid.money).toBe(standing.money + 5_000);
    expect(countOf(paid.bag, GLITTER)).toBe(0);

    const dusted = applyInput(world, standing, {
      t: "npcSell",
      index: 1,
      take: "glitter",
      confirm: shiny.uid,
    });
    expect(dusted.money).toBe(standing.money);
    expect(countOf(dusted.bag, GLITTER)).toBe(5);
  });
});

describe("what buys the climb", () => {
  it("S7: the five light items add exactly what they say, and add together", () => {
    expect(CLIMB_ITEMS.map((id) => item(id).climbBonus)).toEqual([100, 200, 300, 500, 1000]);

    // One percent to begin with, and the item on top of it.
    expect(climbChance(["glint"], 0)).toBe(200);
    expect(climbChance(["brilliance"], 0)).toBe(1100);
    // Held together they simply sum: no multiplier anywhere but the Prism.
    expect(climbChance(["glint", "gleam", "lustre"], 0)).toBe(700);
    expect(flatBonus(["glint", "gleam", "lustre"])).toBe(600);
  });

  it("S8: Glitter is worth ten percent, on top of everything else", () => {
    expect(item(GLITTER).climbBonus).toBe(1000);
    expect(item(GLITTER).consumed).toBe(true);
    expect(item(GLITTER).stacks).toBe(true);

    expect(climbChance([GLITTER], 0)).toBe(1100);
    // The Prism still multiplies the base only, and everything flat lands
    // after it: five percent, plus ten, plus a hundred levels' worth.
    expect(climbChance(["prism", GLITTER], 100)).toBe(500 + 1000 + 500);
  });

  it("S9: the odds the daycare shows are the odds the egg is rolled against", () => {
    const applied = ["brilliance", GLITTER];
    const shown = tierMatrix(0, 0, applied, 0);

    const counts = new Array(shown.length).fill(0);
    const runs = 40_000;
    for (let index = 0; index < runs; index++) {
      counts[inheritTier(rngFor("ladder", "sample", index), 0, 0, applied, 0)]++;
    }

    // A fifth of a percent of tolerance, which is wider than the sampling
    // error and far narrower than any disagreement in the rule would be.
    for (let tier = 0; tier < shown.length; tier++) {
      expect(Math.abs((counts[tier] / runs) * 1000 - shown[tier])).toBeLessThan(5);
    }
    // And the headline: a fifth of these children climb.
    expect(climbChance(applied, 0)).toBe(2100);
  });

  it("S10: a pinch of Glitter goes with the egg, and the last one lifts itself off", () => {
    const world = testWorld("EGGS1");
    let state = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    const pair = [
      creature("ditto", { uid: 500, gender: "trans", level: 20 }),
      creature("pidgey", { uid: 501, gender: "female", level: 20 }),
    ];
    state = {
      ...state,
      bag: { ...state.bag, [GLITTER]: 2 },
      daycare: {
        slots: [pair[0], pair[1]],
        steps: 0,
        eggIndex: 0,
        eggReady: true,
        applied: [GLITTER],
      },
      route: [...world.routes.values()].find((one) => one.role === "daycare")!.id,
    };
    const room = world.routes.get(state.route)!;
    state = { ...state, x: room.entry.x, y: room.entry.y };

    const first = applyInput(world, state, { t: "collectEgg" });
    expect(countOf(first.bag, GLITTER)).toBe(1);
    expect(first.daycare.applied).toContain(GLITTER);

    const second = applyInput(world, { ...first, daycare: { ...first.daycare, eggReady: true } }, {
      t: "collectEgg",
    });
    expect(countOf(second.bag, GLITTER)).toBe(0);
    // Nothing left to spend, so the pairing stops claiming the ten percent.
    expect(second.daycare.applied).not.toContain(GLITTER);
  });
});

describe("lures", () => {
  /** A route on this world with at least two marked encounter slots. */
  function markedRoute(world: ReturnType<typeof testWorld>) {
    const byRoute = new Map<string, { slot: number; variantId: string }[]>();
    for (const [key, variantId] of world.census) {
      const at = key.lastIndexOf(":");
      const route = key.slice(0, at);
      const slot = Number(key.slice(at + 1));
      byRoute.set(route, [...(byRoute.get(route) ?? []), { slot, variantId }]);
    }
    for (const [route, marks] of byRoute) {
      if (marks.length >= 1) return { route, marks: marks.sort((a, b) => a.slot - b.slot) };
    }
    throw new Error("this world has no census at all");
  }

  it("S11: every lure knows what it draws and how far it reaches", () => {
    expect(LURES.length).toBeGreaterThan(1);
    for (const spec of LURES) {
      expect(spec.lure).toBeDefined();
      expect(spec.lure!.pull).toBeGreaterThan(0);
      expect(Boolean(spec.lure!.shine) !== Boolean(spec.lure!.chromaId)).toBe(true);
      // A consumable nobody can restock is a consumable nobody spends.
      expect(spec.stacks).toBe(true);
      expect(spec.price).toBeGreaterThan(0);
    }
    // One for shine, and one for each colour.
    expect(ITEMS.filter((one) => one.lure?.shine).length).toBe(1);
  });

  it("S12: with nothing lit the grass serves the next slot, in order", () => {
    const world = testWorld("LURE1");
    const { route, marks } = markedRoute(world);
    const state = { ...started("LURE1").state, nextSlot: { [route]: marks[0].slot - 3 } };

    expect(nextEncounterSlot(world, state, route)).toBe(marks[0].slot - 3);
  });

  it("S13: a lure reaches down the census and pulls the marked slot forward", () => {
    const world = testWorld("LURE1");
    const { route, marks } = markedRoute(world);
    const mark = marks[0];
    const form = variant(mark.variantId);
    const lureId = form.chromaId ? `lure-${form.chromaId}` : "lure-shiny";
    const pull = item(lureId).lure!.pull;

    const base = started("LURE1").state;
    const state: GameState = {
      ...base,
      nextSlot: { [route]: Math.max(0, mark.slot - pull) },
      lures: { [lureId]: base.tick + LURE_MOVES },
    };

    expect(activeLures(state).map((one) => one.id)).toEqual([lureId]);
    expect(nextEncounterSlot(world, state, route)).toBe(mark.slot);

    // Out of reach is out of reach: a lure closes a distance, it does not
    // abolish one.
    const far = { ...state, nextSlot: { [route]: Math.max(0, mark.slot - pull - 1) } };
    if (mark.slot - pull - 1 >= 0) {
      expect(nextEncounterSlot(world, far, route)).toBe(mark.slot - pull - 1);
    }
  });

  it("S14: a lure never burns past something rare it does not draw", () => {
    const world = testWorld("LURE1");
    const { route, marks } = markedRoute(world);
    const mark = marks[0];
    const form = variant(mark.variantId);

    // A lure that wants something this one is not. Anything with shine takes
    // the colour lure; anything wearing colour takes the shine lure.
    const wrong = form.chromaId
      ? "lure-shiny"
      : `lure-${form.chromaId === "ember" ? "tide" : "ember"}`;
    const lureId = form.tier > 0 && !form.chromaId ? "lure-ember" : wrong;
    if (variant(mark.variantId).chromaId === lureId.slice("lure-".length)) return;

    const base = started("LURE1").state;
    const from = Math.max(0, mark.slot - item(lureId).lure!.pull);
    const state: GameState = {
      ...base,
      nextSlot: { [route]: from },
      lures: { [lureId]: base.tick + LURE_MOVES },
    };

    // The rare thing is within reach and is not what the lure wants, so
    // nothing moves: the slots between it and here are not spent, and it is
    // still standing there when you get to it the ordinary way.
    expect(nextEncounterSlot(world, state, route)).toBe(from);
  });

  it("S15: a lure burns for five hundred moves and then stops", () => {
    const world = testWorld("LURE2");
    let state = started("LURE2").state;
    state = { ...state, bag: { ...state.bag, "lure-shiny": 1 } };

    expect(itemRefusal(state, "lure-shiny", 0)).toBeNull();
    const lit = applyInput(world, state, { t: "useItem", item: "lure-shiny", index: 0 });

    expect(countOf(lit.bag, "lure-shiny")).toBe(0);
    expect(lureLeft(lit, "lure-shiny")).toBe(LURE_MOVES);
    // Lighting the same one twice would be paying twice for one window.
    expect(itemRefusal({ ...lit, bag: { "lure-shiny": 1 } }, "lure-shiny", 0)).toBe(
      "that one is already burning",
    );

    const later = { ...lit, tick: lit.tick + LURE_MOVES };
    expect(lureLeft(later, "lure-shiny")).toBe(0);
    expect(activeLures(later)).toEqual([]);
  });

  it("S16: lighting one, selling a shiny and taking the Glitter all replay", () => {
    const world = testWorld("REPLAY9");
    const inputs: Input[] = [
      { t: "pickStarter", index: 0 },
      { t: "cheat", cheat: { op: "give", speciesId: "rattata", level: 20, variantId: "shiny", gender: "female" } },
      { t: "cheat", cheat: { op: "items" } },
    ];

    const once = reduce(world, inputs);
    const twice = reduce(world, inputs);
    expect(stateHash(twice)).toBe(stateHash(once));

    // And the lure record is part of what a hash covers, so a save that lit
    // one cannot be mistaken for a save that did not.
    const lit = { ...once, lures: { "lure-shiny": once.tick + LURE_MOVES } };
    expect(stateHash(lit)).not.toBe(stateHash(once));
  });
});

describe("the roster still holds together", () => {
  it("S17: exactly one person buys, and everything they need is spelled out", () => {
    const buyers = NPCS.filter((who) => who.kind === "buy");
    expect(buyers.length).toBe(1);
    for (const who of buyers) {
      expect(who.lines.length).toBeGreaterThan(1);
      expect(who.where.at).toBe("cabin");
    }
  });
});
