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
import { evolve } from "@/engine/progression";
import { rngFor } from "@/engine/rng";
import { routeId as worldRouteId } from "@/engine/world";
import { walkable } from "@/engine/terrain";
import { appearanceId, TOP_TIER, variant } from "@/engine/variants";
import { resolveTurn, startBattle, WILD_RULES } from "@/engine/battle";
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
  it("S1: the Appraiser is indoors, behind his own door, on every seed", () => {
    // Where he lives is read off the roster rather than written down here, so
    // moving him moves the test with him. What is under test is not the
    // address — it is that the cabin at that address is *built* rather than
    // hoped for. One random attempt per route put a cabin on one route in
    // forty-eight where the rooms are small, so a person written to be inside
    // one was, in practice, always standing outside in the rain instead.
    const spec = NPCS.find((who) => who.id === "buy-appraiser")!;
    expect(spec.where.at).toBe("cabin");
    const home =
      spec.where.at === "cabin" ? worldRouteId(spec.where.biome, spec.where.nth) : "";

    for (const seed of ["A1", "B2", "C3"]) {
      const world = testWorld(seed);
      const where = [...world.npcs].find(([, here]) =>
        here.some((one) => one.id === "buy-appraiser"),
      );
      expect(where, `no Appraiser on seed ${seed}`).toBeDefined();

      const [routeId] = where!;
      expect(routeId, `Appraiser is outdoors on seed ${seed}`).toBe(`${home}:cabin`);

      const room = world.routes.get(routeId)!;
      expect(room.kind).toBe("interior");
      // And the door out of it still goes somewhere.
      expect(room.doors.some((door) => door.to === home)).toBe(true);
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
  it("S7: the light items add exactly what they say, and add together", () => {
    // Weakest first, and the Cup last: it is not found anywhere, so it is the
    // one that may be larger than the far end of the world.
    expect(CLIMB_ITEMS.map((id) => item(id).climbBonus)).toEqual([
      100, 200, 300, 500, 1000, 1500,
    ]);

    // One percent to begin with, and the item on top of it.
    expect(climbChance(["glint"], 0)).toBe(200);
    expect(climbChance(["brilliance"], 0)).toBe(1100);
    expect(climbChance(["thecup"], 0)).toBe(1600);
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

    expect(itemRefusal(world, state, "lure-shiny", 0)).toBeNull();
    const lit = applyInput(world, state, { t: "useItem", item: "lure-shiny", index: 0 });

    expect(countOf(lit.bag, "lure-shiny")).toBe(0);
    expect(lureLeft(lit, "lure-shiny")).toBe(LURE_MOVES);
    // Lighting the same one twice would be paying twice for one window.
    expect(itemRefusal(world, { ...lit, bag: { "lure-shiny": 1 } }, "lure-shiny", 0)).toBe(
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

/**
 * An appearance is a fact about a creature, not about its species.
 *
 * Which means it has to survive the one moment the species changes. Both roads
 * there are guarded, because they are separate code and an appearance that
 * survived one of them would be an appearance that half works — and because
 * the evolution scene reads the creature back out afterwards to know what to
 * draw. It used to ask for `variantId="normal"` and get it, so the one moment
 * the game stops everything to look at a creature showed somebody else's.
 */
describe("an appearance survives becoming something else", () => {
  it("S18: levelling into an evolution keeps it, and the event says which one", () => {
    const mine = creature("caterpie", {
      uid: 1,
      level: 6,
      moves: ["tackle"],
      variantId: "shiny:tide",
    });
    const theirs = creature("magikarp", { uid: 2, level: 40, hp: 1, moves: ["splash"] });

    let battle = startBattle("SHINE-EVO", "wild:evolve:0", [mine], [theirs]);
    let grown: { evolved: string | null; uid: number } | null = null;

    for (let i = 0; i < 20 && !battle.outcome; i++) {
      battle = resolveTurn(
        battle,
        [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }],
        WILD_RULES,
      ).battle;
      for (const event of battle.events) {
        if (event.t === "exp" && event.evolved) grown = event;
      }
    }

    expect(grown).not.toBeNull();
    expect(grown!.evolved).toBe("metapod");

    // The uid is on the event so a screen can find the creature it is about,
    // and this is what finding it has to yield: the same appearance, on the
    // new species.
    const found = battle.sides[0].team.find((one) => one.uid === grown!.uid);
    expect(found, "the event named a uid that is not on the team").toBeDefined();
    // Still a Caterpie: the battle offers the change rather than making it.
    expect(found!.speciesId).toBe("caterpie");

    // The appearance is what this file is about, and it has to survive the
    // step that actually changes the species — which is now `evolve`, reached
    // through an input, rather than something growth did on its own.
    const changed = evolve(found!, grown!.evolved!);
    expect(changed.speciesId).toBe("metapod");
    expect(changed.variantId).toBe("shiny:tide");
  });

  it("S19: a stone keeps it, and the notice says which creature it was", () => {
    // Two of the same species, wearing different appearances, and the stone
    // goes on the second. Deliberately two: with one, a screen that assumed
    // the first party member or the first match on species would pass, and
    // that is the assumption worth breaking here.
    const world = testWorld("STONE1");
    const before = reduce(world, [
      { t: "pickStarter", index: 0 },
      {
        t: "cheat",
        cheat: { op: "give", speciesId: "vulpix", level: 25, variantId: "normal", gender: "female" },
      },
      {
        t: "cheat",
        cheat: { op: "give", speciesId: "vulpix", level: 25, variantId: "shiny:ember", gender: "female" },
      },
      { t: "cheat", cheat: { op: "items" } },
    ]);

    const slots = before.party
      .map((one, index) => ({ one, index }))
      .filter(({ one }) => one.speciesId === "vulpix");
    expect(slots.length).toBe(2);

    const { one: target, index } = slots[1];
    expect(target.variantId).toBe("shiny:ember");

    const after = applyInput(world, before, { t: "useItem", item: "stone-firestone", index });

    expect(after.notice?.t).toBe("evolved");
    const notice = after.notice as { t: "evolved"; from: string; to: string; uid: number };
    expect(notice.from).toBe("vulpix");
    expect(notice.to).toBe("ninetales");
    // The uid rather than the species: "which species" does not say which
    // creature, and there are two of this one standing right here.
    expect(notice.uid).toBe(target.uid);

    const grown = after.party.find((one) => one.uid === notice.uid);
    expect(grown, "the notice named a uid that is not in the party").toBeDefined();
    expect(grown!.speciesId).toBe("ninetales");
    expect(grown!.variantId).toBe("shiny:ember");

    // And the one that was not stoned is untouched, which is the other half of
    // naming the right creature.
    const spare = after.party.find((one) => one.uid === slots[0].one.uid);
    expect(spare!.speciesId).toBe("vulpix");
    expect(spare!.variantId).toBe("normal");
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
