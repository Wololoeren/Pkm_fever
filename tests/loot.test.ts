import { describe, expect, it } from "vitest";
import { maxHp } from "@/engine/battle";
import { ALL_SPECIES, species as speciesById } from "@/engine/dex";
import { effortSpent } from "@/engine/effort";
import {
  activeRepel,
  applyInput,
  initialState,
  itemRefusal,
  rivalIdOf,
  type GameState,
} from "@/engine/engine";
import { bagUse, ITEMS, item, MART_STOCK } from "@/engine/items";
import { nature, NATURES } from "@/engine/natures";
import { canStillEvolve, evolutionByItem, forgottenMoves } from "@/engine/progression";
import { rngFor } from "@/engine/rng";
import { computeStats, EV_MAX_PER_STAT, EV_MAX_TOTAL } from "@/engine/stats";
import { STAT_IDS } from "@/engine/types";
import { creature, testWorld, walkCandidates } from "./helpers";

/**
 * The shelf: stones, tonics, mints and the things used on the world.
 *
 * Everything here is a *consumable used from the bag in the field*, which is
 * the half of the item problem that needed no new machinery — `useItem` already
 * existed and already worked. What the tests are for is the two places that
 * kind of item can go quietly wrong:
 *
 *   **A stone that does nothing.** Twenty-two of them, sixty-seven doors, and
 *   the relation is read out of the manifest rather than written down beside
 *   it. If that read breaks, every stone becomes a stone that "has no use for
 *   that" against everything, and nothing fails to compile.
 *
 *   **A cap that is not enforced.** Effort now moves in both directions from
 *   the bag, and the 252/510 ceilings are the only thing standing between that
 *   and a creature no amount of play could have produced.
 */

const SEED = "LOOT1";

function started(seed = SEED) {
  const world = testWorld(seed);
  const state = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  return { world, state };
}

/** One creature in the party, and whatever is in the bag. */
function carrying(
  speciesId: string,
  bag: Record<string, number>,
  options: Parameters<typeof creature>[1] = {},
): { world: ReturnType<typeof testWorld>; state: GameState } {
  const { world, state } = started();
  return {
    world,
    state: { ...state, party: [creature(speciesId, { uid: 1, ...options })], bag: { ...state.bag, ...bag } },
  };
}

describe("the stones", () => {
  it("K1: every item evolution in the manifest has a stone that performs it", () => {
    // The point of generating the shelf from the bestiary. A door in the data
    // with no key on the shelf is a species that can never become what it is
    // meant to become, and nothing anywhere would say so.
    const doors = new Map<string, string[]>();
    for (const entry of ALL_SPECIES) {
      for (const step of entry.evolvesTo) {
        if (step.method !== "useItem" || !step.item) continue;
        doors.set(step.item, [...(doors.get(step.item) ?? []), entry.id]);
      }
    }

    expect(doors.size, "the manifest carries no item evolutions at all").toBeGreaterThan(15);

    const stones = ITEMS.filter((spec) => spec.evolves);
    expect(stones.length).toBe(doors.size);

    for (const [name, species] of doors) {
      const stone = stones.find((spec) => spec.name === name);
      expect(stone, `nothing on the shelf is called ${name}`).toBeTruthy();

      // And it actually opens each of them.
      for (const id of species) {
        expect(evolutionByItem(creature(id, { uid: 1 }), name), `${name} on ${id}`).toBeTruthy();
      }
    }
  });

  it("K2: a stone changes what it should and refuses what it should not", () => {
    for (const [speciesId, stoneId, into] of [
      ["vulpix", "stone-firestone", "ninetales"],
      ["eevee", "stone-waterstone", "vaporeon"],
      ["eevee", "stone-thunderstone", "jolteon"],
      ["gloom", "stone-sunstone", "bellossom"],
      ["applin", "stone-tartapple", "flapple"],
      ["charcadet", "stone-auspiciousarmor", "armarouge"],
    ] as const) {
      const { world, state } = carrying(speciesId, { [stoneId]: 1 });
      expect(itemRefusal(world, state, stoneId, 0), `${speciesId} + ${stoneId}`).toBeNull();

      const after = applyInput(world, state, { t: "useItem", item: stoneId, index: 0 });
      expect(after.party[0].speciesId, `${speciesId} + ${stoneId}`).toBe(into);
      // Spent when it works, and its own notice so the screen can show it.
      expect(after.bag[stoneId] ?? 0).toBe(0);
      expect(after.notice).toEqual({ t: "evolved", from: speciesId, to: into });
    }

    // And a stone with nothing behind it says so, in the refusal, rather than
    // being spent on nothing.
    const { world, state } = carrying("magikarp", { "stone-firestone": 1 });
    expect(itemRefusal(world, state, "stone-firestone", 0)).toBe("a Magikarp has no use for that");
    expect(() => applyInput(world, state, { t: "useItem", item: "stone-firestone", index: 0 })).toThrow();
  });

  it("K3: a stone keeps the proportion of health, not the number", () => {
    // The same rule levelling into an evolution follows: a Magikarp on its
    // last legs comes out of it a Gyarados on its last legs. A stone that
    // healed would be a Full Restore with a species change attached.
    const hurt = creature("poliwhirl", { uid: 1, level: 40 });
    const { world, state } = carrying("poliwhirl", { "stone-waterstone": 1 }, { level: 40 });
    const wounded: GameState = { ...state, party: [{ ...hurt, hp: Math.floor(maxHp(hurt) / 4) }] };

    const after = applyInput(world, wounded, { t: "useItem", item: "stone-waterstone", index: 0 });
    const grown = after.party[0];
    expect(grown.speciesId).toBe("poliwrath");
    expect(grown.hp).toBeLessThan(maxHp(grown));
    // A quarter, give or take the rounding.
    expect(grown.hp / maxHp(grown)).toBeGreaterThan(0.2);
    expect(grown.hp / maxHp(grown)).toBeLessThan(0.3);
  });

  it("K4: every stone is on the shelf, and the specialist ones cost more", () => {
    // All of them stocked, deliberately. Leaving the twelve one-door stones to
    // the floor meant a given one turned up in under one world in twelve, so
    // whether a Sinistea could ever become a Polteageist was decided by a die
    // rolled before the player existed. The guard below is what found that.
    for (const spec of ITEMS.filter((one) => one.evolves)) {
      expect(spec.price, spec.name).toBeGreaterThan(0);
      expect(MART_STOCK.some((row) => row.id === spec.id), spec.name).toBe(true);

      const opens = ALL_SPECIES.filter((entry) =>
        entry.evolvesTo.some((step) => step.method === "useItem" && step.item === spec.name),
      ).length;

      // One door costs double: a Fire Stone is on every shelf in every game
      // ever made, and a Masterpiece Teacup is a thing you go in asking for.
      const specialist = ITEMS.find((one) => one.id === "stone-crackedpot")!.price;
      const ordinary = ITEMS.find((one) => one.id === "stone-firestone")!.price;
      expect(spec.price, spec.name).toBe(opens > 1 ? ordinary : specialist);
    }

    expect(ITEMS.find((one) => one.id === "stone-crackedpot")!.price).toBeGreaterThan(
      ITEMS.find((one) => one.id === "stone-firestone")!.price,
    );
  });
});

describe("the tonics", () => {
  it("K5: a vitamin adds ten, and stops at both ceilings", () => {
    const { world } = carrying("machop", {});
    let state = carrying("machop", { protein: 40, hpup: 40 }, { level: 100 }).state;

    let bottles = 0;
    for (; bottles < 40; bottles++) {
      if (itemRefusal(world, state, "protein", 0)) break;
      state = applyInput(world, state, { t: "useItem", item: "protein", index: 0 });
    }

    // 252 is the per-stat ceiling, so twenty-six bottles reach it and the
    // twenty-sixth is trimmed to fit rather than overshooting.
    expect(state.party[0].evs.atk).toBe(EV_MAX_PER_STAT);
    expect(bottles).toBe(26);
    expect(itemRefusal(world, state, "protein", 0)).toBe("that stat holds all the effort it can");

    // The per-stat ceiling bites first, and it bites on health too: 252 and
    // 252 is 504, so health also fills up rather than soaking up the rest.
    for (let i = 0; i < 40; i++) {
      if (itemRefusal(world, state, "hpup", 0)) break;
      state = applyInput(world, state, { t: "useItem", item: "hpup", index: 0 });
    }
    expect(state.party[0].evs.hp).toBe(EV_MAX_PER_STAT);
    expect(effortSpent(state.party[0].evs)).toBe(504);

    // The last six can only go into a third stat, and then the *total*
    // ceiling is what refuses — a different sentence, correctly.
    let third: GameState = { ...state, bag: { ...state.bag, carbos: 5 } };
    for (let i = 0; i < 5; i++) {
      if (itemRefusal(world, third, "carbos", 0)) break;
      third = applyInput(world, third, { t: "useItem", item: "carbos", index: 0 });
    }
    expect(effortSpent(third.party[0].evs)).toBe(EV_MAX_TOTAL);
    expect(third.party[0].evs.spe).toBe(6);
    expect(itemRefusal(world, third, "carbos", 0)).toBe("it has spent every point it has");
  });

  it("K6: a berry takes ten back out, and refuses when there is nothing there", () => {
    const { world, state } = carrying("machop", { kelpsy: 2 }, { level: 100 });
    expect(itemRefusal(world, state, "kelpsy", 0)).toBe("there is no effort there to take back out");

    const trained: GameState = {
      ...state,
      party: [{ ...state.party[0], evs: { ...state.party[0].evs, atk: 25 } }],
    };
    const after = applyInput(world, trained, { t: "useItem", item: "kelpsy", index: 0 });
    expect(after.party[0].evs.atk).toBe(15);

    // And it never goes below nothing.
    const nearly: GameState = {
      ...state,
      party: [{ ...state.party[0], evs: { ...state.party[0].evs, atk: 4 } }],
    };
    expect(applyInput(world, nearly, { t: "useItem", item: "kelpsy", index: 0 }).party[0].evs.atk).toBe(0);
  });

  it("K7: there is one of each, in both directions, for all six stats", () => {
    for (const stat of STAT_IDS) {
      const up = ITEMS.filter((spec) => spec.effort && spec.effort.delta > 0 && spec.effort.stat === stat);
      const down = ITEMS.filter((spec) => spec.effort && spec.effort.delta < 0 && spec.effort.stat === stat);
      expect(up.length, `nothing raises ${stat}`).toBe(1);
      expect(down.length, `nothing lowers ${stat}`).toBe(1);
    }
  });

  it("K8: moving health effort moves the bar and keeps the proportion", () => {
    const { world, state } = carrying("machop", { hpup: 2 }, { level: 100 });
    const half: GameState = {
      ...state,
      party: [{ ...state.party[0], hp: Math.floor(maxHp(state.party[0]) / 2) }],
    };

    const before = maxHp(half.party[0]);
    const after = applyInput(world, half, { t: "useItem", item: "hpup", index: 0 });
    const grown = after.party[0];

    expect(maxHp(grown)).toBeGreaterThan(before);
    expect(grown.hp).toBeLessThanOrEqual(maxHp(grown));
    // Still about half, rather than healed to full or left behind at the old
    // number as the maximum moved out from under it.
    expect(grown.hp / maxHp(grown)).toBeGreaterThan(0.45);
    expect(grown.hp / maxHp(grown)).toBeLessThan(0.55);
  });

  it("K9: a mint settles a nature, and the stat screen moves with it", () => {
    const { world, state } = carrying("machop", { "mint-adamant": 2 }, { level: 100, natureId: "hardy" });
    const before = computeStats(speciesById("machop"), state.party[0]);

    const after = applyInput(world, state, { t: "useItem", item: "mint-adamant", index: 0 });
    const grown = after.party[0];
    expect(grown.natureId).toBe("adamant");

    const now = computeStats(speciesById("machop"), grown);
    expect(now.atk).toBeGreaterThan(before.atk);
    expect(now.spa).toBeLessThan(before.spa);

    // Twice on the same nature is refused rather than wasted.
    expect(itemRefusal(world, after, "mint-adamant", 0)).toBe("it already has that nature");
  });

  it("K10: there is a mint for every nature, the neutral ones included", () => {
    const mints = ITEMS.filter((spec) => spec.natureId);
    expect(mints.length).toBe(NATURES.length);
    for (const entry of NATURES) {
      const mint = mints.find((spec) => spec.natureId === entry.id);
      expect(mint, `no mint for ${entry.id}`).toBeTruthy();
      expect(nature(mint!.natureId!).id).toBe(entry.id);
    }
  });
});

describe("the things used on the world", () => {
  it("K11: a repel silences the grass, and leaves the census exactly where it was", () => {
    // The promise on the label. A repel that spent encounters while it burned
    // would be the single worst item in a game whose whole rarity model is
    // "that slot is gone once you have met it".
    const world = testWorld("REPEL1");
    const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    // Everybody on every route already beaten, so the walker hunts grass
    // rather than people. Without this it walks into trainers, which is a
    // battle a repel has nothing to say about — and counting those made the
    // first cut of this test report two hundred and sixty "encounters" while
    // the repel was working perfectly.
    const beaten = [...world.trainers.values()].flat().map((who) => who.id).sort();
    const bagged: GameState = {
      ...start,
      beaten,
      bag: { ...start.bag, maxrepel: 2 },
    };

    const walk = (from: GameState, steps: number) => {
      const rng = rngFor("repel", "walk");
      let live = from;
      let met = 0;
      for (let i = 0; i < steps; i++) {
        if (live.phase === "battle") {
          // Somebody following you is not something a repel has anything to
          // say about, any more than a trainer is. Counted the same way, and
          // for the same reason: this counts what came out of the *grass*.
          if (!rivalIdOf(live.battle)) met++;
          live = { ...live, phase: "field", battle: null };
          continue;
        }
        for (const input of walkCandidates(world, live, rng)) {
          try {
            live = applyInput(world, live, input);
            break;
          } catch {
            // A wall. Try the next direction.
          }
        }
      }
      return { live, met };
    };

    // Without one, that walk meets things.
    const plain = walk(bagged, 1200);
    expect(plain.met, "the walker never met anything, so this proves nothing").toBeGreaterThan(2);

    // With one, it does not.
    const lit = applyInput(world, bagged, { t: "useItem", item: "maxrepel", index: 0 });
    expect(activeRepel(lit)?.item).toBe("maxrepel");

    const quiet = walk(lit, 900);
    expect(quiet.met).toBe(0);
    // And nothing was spent: every route's place in its own encounter list is
    // where it started.
    expect(quiet.live.nextSlot).toEqual(lit.nextSlot);

    // Then it lapses on its own, and the grass wakes up.
    const lapsed: GameState = { ...quiet.live, tick: quiet.live.tick + 5000 };
    expect(activeRepel(lapsed)).toBeNull();
    expect(walk(lapsed, 1200).met).toBeGreaterThan(0);
  });

  it("K12: the strongest repel burning is the one that counts", () => {
    const { world, state } = carrying("machop", { repel: 2, maxrepel: 2 });

    const small = applyInput(world, state, { t: "useItem", item: "repel", index: 0 });
    expect(activeRepel(small)?.left).toBe(item("repel").repel);

    const big = applyInput(world, small, { t: "useItem", item: "maxrepel", index: 0 });
    // Two at once is not twice the quiet: the longer one answers.
    expect(activeRepel(big)?.item).toBe("maxrepel");
    expect(activeRepel(big)!.left).toBeGreaterThan(item("repel").repel!);

    // And one already burning will not be lit twice.
    expect(itemRefusal(world, big, "maxrepel", 0)).toBe("that one is still working");
  });

  it("K13: an Escape Rope walks you home, and refuses when you are already there", () => {
    const { world, state } = carrying("machop", { escaperope: 2 });
    expect(itemRefusal(world, state, "escaperope", 0)).toBe("you are already in town");

    // Somewhere else, and it works.
    const away: GameState = { ...state, route: "meadow-1", visited: [...state.visited, "meadow-1"].sort() };
    expect(itemRefusal(world, away, "escaperope", 0)).toBeNull();

    const home = applyInput(world, away, { t: "useItem", item: "escaperope", index: 0 });
    expect(home.route).not.toBe("meadow-1");
    expect(home.bag.escaperope).toBe(1);
  });

  it("K14: a Heart Scale offers back something it grew past, through the usual queue", () => {
    // Four moves it did not learn last, so there is definitely something
    // behind it, and no room to simply take one.
    const early = creature("machop", {
      uid: 1,
      level: 45,
      moves: ["lowkick", "focusenergy", "karatechop", "seismictoss"],
    });
    const { world, state } = carrying("machop", { heartscale: 2 });
    const grown: GameState = { ...state, party: [early] };

    expect(forgottenMoves(early).length).toBeGreaterThan(0);
    expect(itemRefusal(world, grown, "heartscale", 0)).toBeNull();

    const after = applyInput(world, grown, { t: "useItem", item: "heartscale", index: 0 });
    // No room, so it is offered rather than forced — the same queue a
    // level-up uses, so what to forget is asked in exactly one place.
    expect(after.party[0].moves).toEqual(early.moves);
    expect(after.pendingMoves.length).toBe(1);
    expect(forgottenMoves(early)).toContain(after.pendingMoves[0].moveId);

    // With room, it simply takes it.
    const roomy: GameState = { ...state, party: [creature("machop", { uid: 1, level: 45, moves: ["lowkick"] })] };
    const taken = applyInput(world, roomy, { t: "useItem", item: "heartscale", index: 0 });
    expect(taken.party[0].moves.length).toBe(2);
    expect(taken.pendingMoves).toEqual([]);

    // And something with nothing behind it says so.
    const fresh: GameState = { ...state, party: [creature("machop", { uid: 1, level: 1, moves: ["lowkick", "leer"] })] };
    const why = itemRefusal(world, fresh, "heartscale", 0);
    if (forgottenMoves(fresh.party[0]).length === 0) {
      expect(why).toBe("there is nothing it has grown past");
    }
  });
});

describe("getting hold of them", () => {
  it("K14b: every stone that is not stocked can be found, and everything else is buyable", () => {
    // A stone that is neither stocked nor droppable is a locked door with no
    // key cut, and nothing anywhere would say so. This is the guard that
    // caught it: the twelve one-door stones were floor-only at first, and
    // twelve worlds could not turn up a Cracked Pot between them.
    const stones = ITEMS.filter((spec) => spec.evolves);
    const found = new Set<string>();

    for (const seed of ["a", "b", "c", "d"]) {
      for (const drop of [...testWorld(seed).pickups.values()].flat()) found.add(drop.item);
    }

    for (const spec of stones) {
      const reachable = spec.price > 0 || found.has(spec.id);
      expect(reachable, `${spec.name} is neither stocked nor droppable`).toBe(true);
    }

    // The floor is a bonus route rather than the only one, so it does not have
    // to carry every stone — but it has to carry some, or the table row is
    // dead weight.
    expect([...found].some((id) => item(id).evolves), "no stone on any floor").toBe(true);

    // The Heart Scale is genuinely floor-only, so this one is load-bearing.
    expect(found.has("heartscale"), "no Heart Scale in twelve worlds").toBe(true);
  });

  it("K14bb: no world ever scatters an item that does not exist", () => {
    // The drop table has two rows that stand for a *family* rather than a
    // thing, and a family is a filter over the catalogue. Emptying one is a
    // one-line change made somewhere else entirely: pricing every stone
    // emptied the stone family, the sentinel resolved to `undefined`, and the
    // world quietly scattered items with no id. Walking onto one would have
    // thrown. Nothing in the type system can catch that; this can.
    for (const seed of ["a", "b", "c"]) {
      for (const drop of [...testWorld(seed).pickups.values()].flat()) {
        expect(typeof drop.item, `${seed}: ${drop.id}`).toBe("string");
        expect(() => item(drop.item), `${seed}: ${drop.id} -> ${drop.item}`).not.toThrow();
      }
    }
  });

  it("K14c: one world holds enough of the floor to be worth walking", () => {
    // Not a balance assertion, a sanity one: the new rows went into a weighted
    // table, and a typo in a weight is a family that never drops at all.
    const drops = [...testWorld("SPREAD1").pickups.values()].flat();
    expect(drops.length).toBeGreaterThan(20);

    const kinds = new Set(drops.map((drop) => item(drop.item).kind));
    expect(kinds.has("medicine")).toBe(true);
    expect(kinds.has("tm")).toBe(true);
  });
});

describe("the catalogue still holds together", () => {
  it("K15: nothing new sells above its price, and everything usable has a use", () => {
    for (const spec of ITEMS) {
      if (spec.price > 0) expect(spec.sell, spec.id).toBeLessThanOrEqual(spec.price);

      // Every new kind carries the field that makes it do something. A stone
      // with no `evolves`, or a tonic with neither `effort` nor `natureId`,
      // would sit in the bag as a button that does nothing at all.
      if (spec.kind === "stone") expect(spec.evolves, spec.id).toBe(true);
      if (spec.kind === "tonic") {
        expect(Boolean(spec.effort || spec.natureId), spec.id).toBe(true);
      }
      if (spec.kind === "field") {
        expect(Boolean(spec.repel || spec.escape || spec.relearn), spec.id).toBe(true);
      }
    }
  });

  it("K15b: every item in the bag can actually be pressed", () => {
    // The bug this exists for was invisible and total. The bag decided what a
    // row could do with its own hand-written list of kinds:
    //
    //     spec.kind === "medicine" || spec.kind === "lure" ||
    //       Boolean(spec.teaches) || spec.field === "clear" || ...
    //
    // Every kind added after that was written rendered correctly — right name,
    // right blurb — greyed out, titled "Nothing to use this on". All
    // twenty-two stones, all thirty-seven tonics, the repels, the rope, the
    // Heart Scale, and then a hundred and eleven held items and berries.
    // Nothing failed and nothing looked broken.
    //
    // `bagUse` is the one predicate now, and this is the guard: exactly one
    // kind may answer null, and it is the one that is only ever sold.
    // Some things genuinely are not pressed from the bag, and each has a
    // reason that is not "nobody updated a list":
    const elsewhere: Record<string, string> = {
      ball: "thrown in a battle",
      breeding: "applied to a pairing at the daycare",
      treasure: "only ever sold",
      key: "only ever held",
      hm: "the crossing tools work by walking into the thing",
      rod: "cast by standing at the water, from the field controls",
    };

    const dead = ITEMS.filter((spec) => bagUse(spec) === null);
    for (const spec of dead) {
      expect(
        elsewhere[spec.kind],
        `${spec.id} (${spec.kind}) is a row that cannot be pressed and has no reason to be`,
      ).toBeTruthy();
    }

    // And the kinds that *are* used from the bag are pressable to the last
    // one. This is the assertion the bug would have failed: stones, tonics,
    // field items, held items and berries were every one of them dead.
    for (const kind of ["medicine", "stone", "tonic", "field", "hold", "berry", "tm"] as const) {
      const rows = ITEMS.filter((spec) => spec.kind === kind);
      expect(rows.length, `no ${kind} at all`).toBeGreaterThan(0);
      for (const spec of rows) {
        expect(bagUse(spec), `${spec.id} cannot be pressed`).not.toBeNull();
      }
    }
  });

  it("K16: ids and names are unique across the whole shelf", () => {
    // Four hundred-odd items now, most of them generated. Two stones with one
    // id would mean `item()` silently returned the wrong one.
    const ids = ITEMS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);

    const names = ITEMS.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("K17: whether a creature can still grow is a question the manifest answers", () => {
    // Eviolite's question, asked here because the answer is used before the
    // item exists — and because "fully evolved" is not a flag in the data, it
    // is the absence of any door at all.
    expect(canStillEvolve(creature("machop", { uid: 1 }))).toBe(true);
    expect(canStillEvolve(creature("machamp", { uid: 1 }))).toBe(false);
    expect(canStillEvolve(creature("eevee", { uid: 1 }))).toBe(true);
    expect(canStillEvolve(creature("vaporeon", { uid: 1 }))).toBe(false);
  });
});
