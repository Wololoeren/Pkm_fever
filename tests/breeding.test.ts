import { describe, expect, it } from "vitest";
import {
  breed,
  DITTO_EGG_PERCENT,
  breedingRefusal,
  compatible,
  chromaOdds,
  climbChance,
  EGG_STEPS_MIN,
  eggSteps,
  expectedIvs,
  generationsToMax,
  hatchReduction,
  incubatorSlots,
  reducedHatch,
  HATCH_MAX,
  HATCH_MIN,
  hatchRarity,
  hatchSteps,
  inheritChroma,
  mutationBonus,
  mutationChance,
  inheritTier,
  STEPS_PER_EGG,
  tierMatrix,
  type BreedingItem,
  type DaycareState,
} from "@/engine/breeding";
import { ALL_SPECIES } from "@/engine/dex";
import { applyInput, collectRefusal, depositRefusal, hatchRefusal, incubateRefusal, uncubateRefusal, initialState, inTown, readyEgg, stateHash } from "@/engine/engine";
import { gendersPair, GENDERS, rollGender } from "@/engine/gender";
import { IV_MAX, ivTotal, WILD_IV_MAX } from "@/engine/stats";
import { intBetween, rngFor } from "@/engine/rng";
import { STAT_IDS, type Individual, type StatTable } from "@/engine/types";
import { wildAt } from "@/engine/world";
import { CHROMA_IDS, TIER_COUNT, TOP_TIER, variant } from "@/engine/variants";
import { creature, standInside, testWorld } from "./helpers";

/**
 * Breeding, and the hole it was built to fill.
 *
 * Wild IVs cap at 6 on purpose. If inheritance only copied, 6 would be the
 * permanent ceiling for the whole game and the breeding pillar would do
 * nothing at all — so the tests that matter most here are the ones about
 * climbing past the parents.
 */

const SEED = "BREED1";

/** A daycare holding a pair, ready to walk. */
function pairing(first: Individual, second: Individual, steps: number): DaycareState {
  return { slots: [first, second], steps, eggIndex: 0, eggReady: false, applied: [], incubating: [] };
}

/** A wild-strength creature: IVs somewhere in 0..6, like anything caught. */
function wild(speciesId: string, uid: number, salt: string): Individual {
  const rng = rngFor(salt, uid);
  const ivs = {} as StatTable;
  for (const stat of STAT_IDS) ivs[stat] = intBetween(rng, 0, WILD_IV_MAX);
  return { ...creature(speciesId, { uid, level: 20 }), ivs };
}

/**
 * Breeds a line forward, always keeping the best child as one parent.
 *
 * This is what a player actually does, and it is the only way to see whether
 * the curve arrives anywhere.
 */
function breedForward(
  first: Individual,
  second: Individual,
  generations: number,
  applied: BreedingItem[] = [],
): Individual {
  let mother = first;
  let father = second;
  let uid = 1000;

  for (let generation = 0; generation < generations; generation++) {
    // A few eggs per generation, as anybody breeding would take, and the best
    // two carry the line forward — which is what a player actually does.
    const brood = [mother, father];
    for (let egg = 0; egg < 5; egg++) {
      brood.push({ ...breed(SEED, mother, father, generation * 5 + egg, applied), uid: uid++, level: 20 });
    }
    brood.sort((a, b) => ivTotal(b.ivs) - ivTotal(a.ivs));
    [mother, father] = brood;
  }

  return mother;
}

describe("the ceiling", () => {
  it("BR1: a child can exceed both its parents — the whole point", () => {
    // Without the mutation this is impossible by construction, and the wild
    // ceiling of 6 would be the game's ceiling forever.
    const mother = wild("bulbasaur", 1, "m");
    const father = wild("bulbasaur", 2, "f");

    let exceeded = false;
    for (let egg = 0; egg < 40 && !exceeded; egg++) {
      const child = breed(SEED, mother, father, egg, []);
      exceeded = STAT_IDS.some(
        (stat) => child.ivs[stat] > Math.max(mother.ivs[stat], father.ivs[stat]),
      );
    }
    expect(exceeded).toBe(true);
  });

  it("BR2: a line bred from two wild catches reaches perfect stats", () => {
    const mother = wild("bulbasaur", 1, "m");
    const father = wild("bulbasaur", 2, "f");
    expect(ivTotal(mother.ivs)).toBeLessThanOrEqual(WILD_IV_MAX * STAT_IDS.length);

    const descendant = breedForward(mother, father, 20);
    expect(ivTotal(descendant.ivs)).toBeGreaterThan(ivTotal(mother.ivs));
    expect(STAT_IDS.some((stat) => descendant.ivs[stat] === IV_MAX)).toBe(true);
  });

  it("BR3: no IV ever escapes the legal range", () => {
    const mother = { ...wild("bulbasaur", 1, "m"), ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } };
    const father = { ...mother, uid: 2 };

    for (let egg = 0; egg < 30; egg++) {
      const child = breed(SEED, mother, father, egg, ["catalyst"]);
      for (const stat of STAT_IDS) {
        expect(child.ivs[stat]).toBeGreaterThanOrEqual(0);
        expect(child.ivs[stat]).toBeLessThanOrEqual(IV_MAX);
      }
    }
  });

  it("BR4: the catalyst gets there faster than going without", () => {
    const mother = wild("bulbasaur", 1, "m");
    const father = wild("bulbasaur", 2, "f");

    const plain = breedForward(mother, father, 6);
    const boosted = breedForward(mother, father, 6, ["catalyst"]);
    expect(ivTotal(boosted.ivs)).toBeGreaterThan(ivTotal(plain.ivs));
  });

  it("BR5: the climb is a project, not an afternoon or a career", () => {
    expect(generationsToMax()).toBeGreaterThanOrEqual(15);
    expect(generationsToMax()).toBeLessThanOrEqual(40);
    expect(generationsToMax(["catalyst"])).toBeLessThan(generationsToMax());
    expect(generationsToMax(["heirloom"])).toBeLessThan(generationsToMax());
  });
});

describe("what comes out", () => {
  it("BR6: breeding is deterministic in the parents and the egg number", () => {
    const mother = wild("bulbasaur", 1, "m");
    const father = wild("bulbasaur", 2, "f");
    expect(breed(SEED, mother, father, 7, [])).toEqual(breed(SEED, mother, father, 7, []));
    expect(breed(SEED, mother, father, 8, [])).not.toEqual(breed(SEED, mother, father, 7, []));
  });

  it("BR7: the child is the bottom of the line, at level one", () => {
    const mother = creature("venusaur", { uid: 1 });
    const father = creature("venusaur", { uid: 2 });
    const child = breed(SEED, mother, father, 0, []);

    expect(child.speciesId).toBe("bulbasaur");
    expect(child.level).toBe(1);
    expect(child.moves.length).toBeGreaterThan(0);
    expect(child.parents).toEqual([1, 2]);
  });

  it("BR8: a Ditto lends a slot, not a species — unless it stands first, and then one egg in five is another Ditto", () => {
    const ditto = creature("ditto", { uid: 1 });
    const partner = creature("charmander", { uid: 2, gender: "male" });

    // Second slot: never itself, whatever the roll.
    for (let egg = 0; egg < 60; egg++) {
      expect(breed(SEED, partner, ditto, egg, []).speciesId).toBe("charmander");
    }

    // First slot: about one in five, which is the only way the world makes
    // more of them.
    const eggs = 4000;
    let dittos = 0;
    for (let egg = 0; egg < eggs; egg++) {
      const child = breed(SEED, ditto, partner, egg, []);
      expect(["ditto", "charmander"]).toContain(child.speciesId);
      if (child.speciesId === "ditto") dittos++;
    }
    expect(dittos / eggs).toBeCloseTo(DITTO_EGG_PERCENT / 100, 2);
  });

  it("BR9: appearance is inherited on both axes at once", () => {
    // The census counts what the *world* holds, not what exists. Breeding is
    // the second path to an appearance, and the only path to a combination
    // the world did not place.
    const mother = creature("bulbasaur", { uid: 1, variantId: "shiny" });
    const father = creature("bulbasaur", { uid: 2, variantId: "ember" });

    const children = Array.from({ length: 200 }, (_, egg) =>
      variant(breed(SEED, mother, father, egg, []).variantId),
    );

    // Shiny x ordinary-rung averages to the middle of the ladder — and never
    // below it, because the only thing that moves a child off the average is
    // the climb, which only goes up.
    for (const child of children) expect(child.tier).toBeGreaterThanOrEqual(2);
    expect(children.filter((child) => child.tier === 2 || child.tier === 3).length).toBeGreaterThan(190);

    // One Ember parent is a coin flip on the colour.
    const ember = children.filter((child) => child.chromaId === "ember").length;
    expect(ember).toBeGreaterThan(70);
    expect(ember).toBeLessThan(130);

    // Which means a tinted Ember — a combination — comes out routinely.
    expect(children.some((child) => child.tier > 0 && child.chromaId === "ember")).toBe(true);
  });

  it("BR10: the talisman fixes the nature to the first parent's", () => {
    const mother = creature("bulbasaur", { uid: 1, natureId: "adamant" });
    const father = creature("bulbasaur", { uid: 2, natureId: "timid" });

    for (let egg = 0; egg < 12; egg++) {
      expect(breed(SEED, mother, father, egg, ["talisman"]).natureId).toBe("adamant");
    }
  });
});

describe("who can breed with whom", () => {
  it("BR11: shared egg groups, and Ditto with anything", () => {
    expect(
      compatible(
        creature("bulbasaur", { uid: 1, gender: "male" }),
        creature("oddish", { uid: 2, gender: "female" }),
      ),
    ).toBe(true);
    // A Ditto pairs across egg groups — that is the whole of what it is for —
    // but it has a gender like anything else and still has to pair on that.
    expect(
      compatible(creature("ditto", { uid: 1, gender: "male" }), creature("bulbasaur", { uid: 2, gender: "female" })),
    ).toBe(true);
    expect(
      compatible(creature("ditto", { uid: 1, gender: "male" }), creature("bulbasaur", { uid: 2, gender: "male" })),
    ).toBe(false);
    // And two of them work, because a Ditto is a species like any other now
    // that one can hatch.
    expect(
      compatible(creature("ditto", { uid: 1, gender: "male" }), creature("ditto", { uid: 2, gender: "female" })),
    ).toBe(true);
    // Nothing breeds with itself.
    const one = creature("bulbasaur", { uid: 1 });
    expect(compatible(one, one)).toBe(false);
  });

  it("BR12: legendaries are in the group that cannot breed", () => {
    expect(compatible(creature("mewtwo", { uid: 1 }), creature("ditto", { uid: 2 }))).toBe(false);
  });
});

describe("the daycare", () => {
  it("BR13: it is a building you walk into, not a menu you carry", () => {
    const world = testWorld("PKMFEVER1");
    const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    // Standing in the town square is standing outside a closed door.
    expect(depositRefusal(world, start, "party", 0)).toBe("you are not in the daycare");

    // Inside, the refusal changes to the real one: you would have nothing
    // left to walk with.
    const inside = standInside(world, start, "daycare");
    expect(depositRefusal(world, inside, "party", 0)).toBe("keep something that can fight");

    // And it is a room of the town, so the things town allows still apply.
    expect(inTown(world, inside)).toBe(true);
  });

  it("BR14: an egg costs footsteps, and only from a compatible pair", () => {
    const world = testWorld("PKMFEVER1");
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    const pair = {
      ...base,
      party: [creature("machop", { uid: 90 }), creature("bulbasaur", { uid: 91 })],
      daycare: pairing(
        creature("bulbasaur", { uid: 92, gender: "female" }),
        creature("oddish", { uid: 93, gender: "male" }),
        STEPS_PER_EGG - 1,
      ),
    };

    expect(pair.daycare.eggReady).toBe(false);
    const walked = applyInput(world, pair, { t: "move", dir: "n" });
    expect(walked.daycare.eggReady).toBe(true);

    // Collecting means going back to the daycare itself, and what you collect
    // is an egg in the bag — nobody joins the party yet.
    const inside = standInside(world, walked, "daycare");
    const collected = applyInput(world, inside, { t: "collectEgg" });
    expect(collected.party).toHaveLength(inside.party.length);
    expect(collected.eggs).toHaveLength(1);
    expect(collected.daycare.eggReady).toBe(false);
    expect(collected.daycare.eggIndex).toBe(1);

    const [egg] = collected.eggs;
    expect(egg.creature.speciesId).toBe("bulbasaur");
    expect(egg.creature.level).toBe(1);
    expect(egg.steps).toBe(egg.total);
    expect(egg.steps).toBeGreaterThanOrEqual(HATCH_MIN);
    expect(egg.steps).toBeLessThanOrEqual(HATCH_MAX);
    expect(collected.notice).toEqual({ t: "eggTaken", steps: egg.steps });
  });

  it("BR14b: an egg walks down one per step, cannot be opened early, and hatches what it promised", () => {
    const world = testWorld("PKMFEVER1");
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const promised = { ...creature("oddish", { uid: 0, level: 1 }), variantId: "normal" };
    const state = { ...base, eggs: [{ creature: promised, steps: 2, total: 800 }] };

    expect(hatchRefusal(state, 0)).toBe("it is not ready to hatch");
    expect(() => applyInput(world, state, { t: "hatch", index: 0 })).toThrow();
    expect(readyEgg(state)).toBeNull();

    let walked = state;
    for (let n = 0; n < 2; n++) {
      for (const dir of ["n", "s", "e", "w"] as const) {
        try {
          walked = applyInput(world, walked, { t: "move", dir });
          break;
        } catch {
          /* walled */
        }
      }
    }
    expect(walked.eggs[0].steps).toBe(0);
    expect(readyEgg(walked)?.index).toBe(0);

    const hatched = applyInput(world, walked, { t: "hatch", index: 0 });
    expect(hatched.eggs).toHaveLength(0);
    const child = hatched.party.at(-1)!;
    expect(child.speciesId).toBe("oddish");
    expect(child.uid).toBe(walked.nextUid);
    expect(hatched.notice).toMatchObject({ t: "hatched", speciesId: "oddish" });
    // And the egg is part of the save's state, so two logs that differ only in
    // how far an egg has walked do not hash the same.
    expect(stateHash(walked)).not.toBe(stateHash(state));
  });

  it("BR14d: an egg takes a party slot, and a full party cannot take one", () => {
    const world = testWorld("PKMFEVER1");
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const egg = { creature: creature("oddish", { uid: 0, level: 1 }), steps: 0, total: 300 };
    const five = Array.from({ length: 5 }, (_, at) => creature("machop", { uid: 100 + at }));

    const ready = standInside(world, {
      ...base,
      party: five,
      eggs: [egg],
      daycare: { ...pairing(creature("bulbasaur", { uid: 92, gender: "female" }), creature("oddish", { uid: 93, gender: "male" }), 0), eggReady: true },
    }, "daycare");
    // Five creatures and an egg is six: no room for a second egg.
    expect(() => applyInput(world, ready, { t: "collectEgg" })).toThrow(/party is full/);

    // And a creature that joins with the egg taking the sixth slot goes to the box.
    const room = standInside(world, { ...base, party: five.slice(0, 4), eggs: [egg, egg] }, "daycare");
    expect(() => applyInput(world, room, { t: "retrieve", index: 0 })).toThrow();

    // Hatching fills the slot the egg was in, so it is never boxed.
    const out = { ...base, party: five, eggs: [egg] };
    const hatched = applyInput(world, out, { t: "hatch", index: 0 });
    expect(hatched.party).toHaveLength(6);
    expect(hatched.box).toHaveLength(out.box.length);
  });

  it("BR20: the expected IVs the daycare shows are what eggs actually average", () => {
    const first = wild("bulbasaur", 1, "E1");
    const second = wild("oddish", 2, "E1");
    for (const applied of [[], ["catalyst"], ["heirloom", "primordialseed"]] as BreedingItem[][]) {
      const rows = expectedIvs(first, second, applied);
      const eggs = 4000;
      const sums: Record<string, number> = {};
      for (let egg = 0; egg < eggs; egg++) {
        const child = breed(SEED, first, second, egg, applied);
        for (const stat of STAT_IDS) sums[stat] = (sums[stat] ?? 0) + child.ivs[stat];
      }
      for (const row of rows) {
        expect(sums[row.stat] / eggs, `${row.stat} with ${applied.join("+") || "nothing"}`).toBeCloseTo(row.expected, 0);
        expect(row.gain).toBeGreaterThan(0);
      }
    }
  });

  it("BR21: the rare three raise the mutation rate, add up, and make eggs better", () => {
    expect(mutationBonus([])).toBe(0);
    expect(mutationBonus(["sporeofchange"])).toBe(10);
    expect(mutationBonus(["sporeofchange", "livingamber", "primordialseed"])).toBe(65);
    // Three of six slots is a half; a tenth of the other half on top.
    expect(mutationChance([])).toBeCloseTo(0.5);
    expect(mutationChance(["sporeofchange"])).toBeCloseTo(0.55);
    expect(mutationChance(["heirloom", "primordialseed"])).toBeCloseTo(5 / 6 + (1 / 6) * 0.35);

    const first = wild("bulbasaur", 1, "E2");
    const second = wild("oddish", 2, "E2");
    const total = (applied: BreedingItem[]) =>
      expectedIvs(first, second, applied).reduce((sum, row) => sum + row.gain, 0);
    expect(total(["livingamber"])).toBeGreaterThan(total([]));
    expect(total(["livingamber", "primordialseed"])).toBeGreaterThan(total(["livingamber"]));
    expect(generationsToMax(["primordialseed"])).toBeLessThan(generationsToMax());
  });

  it("BR22: pairing items cut the wait flat first, then by a percentage", () => {
    expect(eggSteps([])).toBe(STEPS_PER_EGG);
    expect(eggSteps(["pairingbell"])).toBe(STEPS_PER_EGG - 50);
    expect(eggSteps(["roseincense"])).toBe(Math.round(STEPS_PER_EGG * 0.8));
    // The percentage is taken off what the flat cuts leave, not off the base.
    expect(eggSteps(["pairingbell", "courtingsong", "roseincense"])).toBe(Math.round((STEPS_PER_EGG - 150) * 0.8));
    expect(eggSteps(["pairingbell", "courtingsong", "roseincense", "moonlitcharm"])).toBe(
      Math.max(EGG_STEPS_MIN, Math.round((STEPS_PER_EGG - 150) * 0.4)),
    );

    // And the daycare lays on the shorter count.
    const world = testWorld("PKMFEVER1");
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const applied = ["pairingbell"];
    const pair = {
      ...base,
      daycare: {
        ...pairing(creature("bulbasaur", { uid: 92, gender: "female" }), creature("oddish", { uid: 93, gender: "male" }), eggSteps(applied) - 1),
        applied,
      },
    };
    expect(applyInput(world, pair, { t: "move", dir: "n" }).daycare.eggReady).toBe(true);
  });

  it("BR23: hatching items shorten the eggs taken while they are applied", () => {
    expect(hatchReduction(["warmblanket"])).toBe(15);
    expect(hatchReduction(["warmblanket", "embercradle"])).toBe(45);
    expect(reducedHatch(1000, ["warmblanket", "embercradle"])).toBe(550);

    const world = testWorld("PKMFEVER1");
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const ready = (applied: string[]) =>
      standInside(world, {
        ...base,
        daycare: {
          ...pairing(creature("bulbasaur", { uid: 92, gender: "female" }), creature("oddish", { uid: 93, gender: "male" }), 0),
          eggReady: true,
          applied,
        },
      }, "daycare");
    const plain = applyInput(world, ready([]), { t: "collectEgg" }).eggs.at(-1)!;
    const warm = applyInput(world, ready(["embercradle"]), { t: "collectEgg" }).eggs.at(-1)!;
    expect(warm.total).toBe(reducedHatch(plain.total, ["embercradle"]));
  });

  it("BR24: an incubated egg hatches as you walk anywhere, into the box", () => {
    expect(incubatorSlots([])).toBe(0);
    expect(incubatorSlots(["incubator", "broodlamp", "hatcherystone"])).toBe(4);

    const world = testWorld("PKMFEVER1");
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const five = Array.from({ length: 5 }, (_, at) => creature("machop", { uid: 100 + at }));
    const ready = standInside(world, {
      ...base,
      party: [...base.party, ...five],
      bag: { ...base.bag, incubator: 1 },
      daycare: {
        ...pairing(creature("bulbasaur", { uid: 92, gender: "female" }), creature("oddish", { uid: 93, gender: "male" }), 0),
        eggReady: true,
        applied: [],
      },
    }, "daycare");

    // Full party, and no incubator applied: nowhere for the egg to go.
    expect(collectRefusal(world, ready, "party")).toMatch(/party is full/);
    expect(collectRefusal(world, ready, "incubator")).toBe("no incubator applied");

    // Applying the incubator gives the egg somewhere to go — but it does not
    // go there by itself while you are standing at the counter, because the
    // choice between the incubator and your own hands is yours to make.
    const applied = applyInput(world, ready, { t: "toggleItem", item: "incubator" });
    expect(applied.daycare.eggReady).toBe(true);
    expect(applied.daycare.incubating).toHaveLength(0);

    const kept = applyInput(world, applied, { t: "collectEgg", to: "incubator" });
    expect(kept.daycare.eggReady).toBe(false);
    expect(kept.eggs).toHaveLength(0);
    expect(kept.daycare.incubating).toHaveLength(1);
    expect(collectRefusal(world, { ...kept, daycare: { ...kept.daycare, eggReady: true } }, "incubator")).toBe("every incubator is taken");

    // The incubator cannot be taken off from under the egg.
    expect(() => applyInput(world, kept, { t: "toggleItem", item: "incubator" })).toThrow(/still in/);

    // Walk it down from anywhere — here, one step from ready.
    const nearly = { ...kept, daycare: { ...kept.daycare, incubating: [{ ...kept.daycare.incubating[0], steps: 1 }] } };
    let walked = nearly;
    for (const dir of ["n", "s", "e", "w"] as const) {
      try {
        walked = applyInput(world, nearly, { t: "move", dir });
        break;
      } catch {
        /* walled */
      }
    }
    expect(readyEgg(walked)).toMatchObject({ index: 0, from: "incubator" });

    const boxBefore = walked.box.length;
    const hatched = applyInput(world, walked, { t: "hatch", index: 0, from: "incubator" });
    expect(hatched.daycare.incubating).toHaveLength(0);
    expect(hatched.party).toHaveLength(walked.party.length);
    expect(hatched.box).toHaveLength(boxBefore + 1);
    expect(hatched.box.at(-1)!.speciesId).toBe("bulbasaur");
    expect(hatched.notice).toMatchObject({ t: "hatched", boxed: true });
  });

  it("BR24b: a ready egg goes into a free incubator by itself, and a carried one on request", () => {
    const world = testWorld("PKMFEVER1");
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const inside = standInside(world, {
      ...base,
      bag: { ...base.bag, incubator: 1 },
      daycare: {
        ...pairing(creature("bulbasaur", { uid: 92, gender: "female" }), creature("oddish", { uid: 93, gender: "male" }), 0),
        applied: ["incubator"],
      },
    }, "daycare");
    const oneStep = (from: typeof inside) => {
      for (const dir of ["n", "s", "e", "w"] as const) {
        try {
          return applyInput(world, from, { t: "move", dir });
        } catch {
          /* walled */
        }
      }
      throw new Error("boxed in");
    };

    // One step short of an egg. Standing in the daycare it simply waits, so
    // you can decide whether to carry it — an egg in your hands is the only
    // kind you can show anybody, and Gus buys them.
    const almost = { ...inside, daycare: { ...inside.daycare, steps: eggSteps(inside.daycare.applied) - 1 } };
    const waiting = oneStep(almost);
    expect(waiting.daycare.eggReady).toBe(true);
    expect(waiting.daycare.incubating).toHaveLength(0);
    expect(collectRefusal(world, waiting, "party")).toBeNull();

    // A step taken anywhere else puts it in the free incubator by itself.
    const outside = { ...waiting, route: base.route, x: base.x, y: base.y };
    const laid = oneStep(outside);
    expect(laid.daycare.eggReady).toBe(false);
    expect(laid.daycare.incubating).toHaveLength(1);
    expect(laid.daycare.eggIndex).toBe(1);
    expect(laid.eggs).toHaveLength(0);

    // And it can be picked back up at the counter, which is what makes the
    // automatic incubator a convenience rather than a one-way door.
    const back = applyInput(world, { ...laid, route: inside.route, x: inside.x, y: inside.y }, { t: "uncubateEgg", index: 0 });
    expect(back.eggs).toHaveLength(1);
    expect(back.daycare.incubating).toHaveLength(0);
    expect(uncubateRefusal(world, back, 0)).toBe("no such egg");

    // The only incubator is taken: the next one waits for you as before.
    const again = oneStep({ ...laid, route: base.route, x: base.x, y: base.y, daycare: { ...laid.daycare, steps: eggSteps(laid.daycare.applied) - 1 } });
    expect(again.daycare.eggReady).toBe(true);
    expect(again.daycare.incubating).toHaveLength(1);

    // Hatching the first frees the incubator, and the waiting egg moves in.
    const due = { ...again, daycare: { ...again.daycare, incubating: [{ ...again.daycare.incubating[0], steps: 0 }] } };
    const hatched = applyInput(world, due, { t: "hatch", index: 0, from: "incubator" });
    expect(hatched.daycare.eggReady).toBe(false);
    expect(hatched.daycare.incubating).toHaveLength(1);
    expect(hatched.notice).toMatchObject({ t: "hatched" });

    // A carried egg can be handed over too, freeing its party slot.
    const carried = { ...inside, eggs: [laid.daycare.incubating[0]] };
    expect(incubateRefusal(world, { ...carried, daycare: laid.daycare }, 0)).toBe("every incubator is taken");
    const handed = applyInput(world, carried, { t: "incubateEgg", index: 0 });
    expect(handed.eggs).toHaveLength(0);
    expect(handed.daycare.incubating).toHaveLength(1);
    expect(handed.notice).toEqual({ t: "eggIncubated" });
  });

  it("BR14c: the rarer what is inside, the longer the walk", () => {
    const common = creature("rattata", { uid: 1, level: 1 });
    const rare = creature("dratini", { uid: 2, level: 1 });
    expect(hatchRarity(rare)).toBeGreaterThan(hatchRarity(common));

    const parents = [creature("rattata", { uid: 10 }), creature("rattata", { uid: 11 })] as const;
    for (let egg = 0; egg < 40; egg++) {
      const quick = hatchSteps(SEED, parents[0], parents[1], egg, common);
      const slow = hatchSteps(SEED, parents[0], parents[1], egg, rare);
      for (const steps of [quick, slow]) {
        expect(steps).toBeGreaterThanOrEqual(HATCH_MIN);
        expect(steps).toBeLessThanOrEqual(HATCH_MAX);
      }
      expect(slow).toBeGreaterThan(quick);
      // The same egg always takes the same walk.
      expect(hatchSteps(SEED, parents[0], parents[1], egg, rare)).toBe(slow);
    }
  });

  it("BR16: you can deposit from the box, which is the only route with one creature left", () => {
    // Breeding used to be unreachable in practice. The engine refused a party
    // deposit that would leave nothing able to fight, which is right — but the
    // UI offered no box deposit at all, so a player who boxed their spares had
    // a party of one, no legal party deposit, and no other way in.
    const world = testWorld("PKMFEVER1");
    const base = standInside(world, applyInput(world, initialState(world), { t: "pickStarter", index: 0 }), "daycare");
    const state = {
      ...base,
      party: [creature("machop", { uid: 90 })],
      box: [creature("bulbasaur", { uid: 91 }), creature("oddish", { uid: 92 })],
    };

    // The party route is correctly refused: it is the last thing that can fight.
    expect(() => applyInput(world, state, { t: "deposit", from: "party", index: 0 })).toThrow();

    const after = applyInput(world, state, { t: "deposit", from: "box", index: 0 });
    expect(after.daycare.slots[0]).not.toBeNull();
    expect(after.box).toHaveLength(1);
  });

  it("BR17: the button's rule and the engine's rule are the same rule", () => {
    // They were not. HubPanel disabled on `party.length <= 1` while the engine
    // refused on the count that can still *fight*, so a party of three with two
    // fainted offered a button that threw. One predicate, two callers.
    const world = testWorld("PKMFEVER1");
    const base = standInside(world, applyInput(world, initialState(world), { t: "pickStarter", index: 0 }), "daycare");
    const state = {
      ...base,
      party: [
        creature("machop", { uid: 90 }),
        { ...creature("bulbasaur", { uid: 91 }), hp: 0 },
        { ...creature("oddish", { uid: 92 }), hp: 0 },
      ],
      box: [creature("squirtle", { uid: 93 })],
    };

    for (const from of ["party", "box"] as const) {
      const source = from === "party" ? state.party : state.box;
      for (let index = 0; index < source.length; index++) {
        const refusal = depositRefusal(world, state, from, index);
        let threw = false;
        try {
          applyInput(world, state, { t: "deposit", from, index });
        } catch {
          threw = true;
        }
        expect(threw).toBe(Boolean(refusal));
      }
    }
  });

  it("BR15: an incompatible pair never produces anything", () => {
    const world = testWorld("PKMFEVER1");
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    let state = {
      ...base,
      daycare: pairing(creature("mewtwo", { uid: 92 }), creature("ditto", { uid: 93 }), 0),
    };

    for (let i = 0; i < 40; i++) {
      state = applyInput(world, state, { t: "move", dir: i % 2 === 0 ? "n" : "s" });
    }
    expect(state.daycare.steps).toBe(0);
    expect(state.daycare.eggReady).toBe(false);
  });
});

describe("gender", () => {
  it("BR18: the split is 49 / 49 / 2", () => {
    // Sampled rather than asserted exactly: the roll is uniform over a
    // hundred, so a large sample should land close to the stated split.
    const counts = { male: 0, female: 0, trans: 0 };
    const runs = 20000;
    for (let i = 0; i < runs; i++) counts[rollGender(rngFor("gender", i))]++;

    expect(counts.male / runs).toBeCloseTo(0.49, 1);
    expect(counts.female / runs).toBeCloseTo(0.49, 1);
    expect(counts.trans / runs).toBeGreaterThan(0.01);
    expect(counts.trans / runs).toBeLessThan(0.03);
    expect(counts.male + counts.female + counts.trans).toBe(runs);
  });

  it("BR19: opposites pair, matches do not, and Trans pairs with anyone", () => {
    expect(gendersPair("male", "female")).toBe(true);
    expect(gendersPair("female", "male")).toBe(true);
    expect(gendersPair("male", "male")).toBe(false);
    expect(gendersPair("female", "female")).toBe(false);

    // "Works with both genders" has no reason to stop short of itself.
    for (const other of GENDERS) {
      expect(gendersPair("trans", other)).toBe(true);
      expect(gendersPair(other, "trans")).toBe(true);
    }
  });

  it("BR20: the daycare refuses a pair that cannot, and says why", () => {
    const male = creature("bulbasaur", { uid: 1, gender: "male" });
    const otherMale = creature("oddish", { uid: 2, gender: "male" });
    const female = creature("oddish", { uid: 3, gender: "female" });
    const trans = creature("oddish", { uid: 4, gender: "trans" });

    expect(breedingRefusal(male, otherMale)).toBe("these two genders do not pair");
    expect(breedingRefusal(male, female)).toBeNull();
    expect(breedingRefusal(male, trans)).toBeNull();
    expect(compatible(male, otherMale)).toBe(false);

    // A Ditto ignores egg groups and nothing else: two males are still two males.
    expect(breedingRefusal(male, creature("ditto", { uid: 5, gender: "female" }))).toBeNull();
    expect(breedingRefusal(male, creature("ditto", { uid: 5, gender: "male" }))).toBe(
      "these two genders do not pair",
    );
    // And an egg group mismatch still reads as an egg group mismatch.
    expect(breedingRefusal(male, creature("machop", { uid: 6, gender: "female" }))).toBe(
      "these two share no egg group",
    );
  });

  it("BR21: everything the world deals has a gender, and the same one every time", () => {
    const world = testWorld("PKMFEVER1");
    for (let slot = 0; slot < 20; slot++) {
      const wild = wildAt(world, ALL_SPECIES, "meadow-1", slot, 1);
      expect(GENDERS).toContain(wild.gender);
      expect(wildAt(world, ALL_SPECIES, "meadow-1", slot, 1).gender).toBe(wild.gender);
    }
  });

  it("BR22: an egg's gender is its own roll, not a parent's", () => {
    const mother = creature("bulbasaur", { uid: 1, gender: "female" });
    const father = creature("bulbasaur", { uid: 2, gender: "male" });

    const seen = new Set<string>();
    for (let egg = 0; egg < 60; egg++) seen.add(breed(SEED, mother, father, egg, []).gender);
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("the shine ladder", () => {
  const roll = (a: number, b: number, applied: BreedingItem[] = [], count = 20000) => {
    const seen = new Array(TIER_COUNT).fill(0);
    for (let i = 0; i < count; i++) seen[inheritTier(rngFor("ladder", a, b, i), a, b, applied)]++;
    return seen.map((n) => (n / count) * 1000);
  };

  it("BR17: two true shinies always make a true shiny", () => {
    for (let i = 0; i < 500; i++) {
      expect(inheritTier(rngFor("pair", i), TOP_TIER, TOP_TIER, [])).toBe(TOP_TIER);
    }
  });

  it("BR18: a shiny and an ordinary make something half way", () => {
    // Five rungs cannot be halved onto a rung, so it falls either side with
    // even odds rather than rounding one way every time — which would make
    // the matrix asymmetric and quietly punish one parent order.
    const odds = roll(TOP_TIER, 0);
    expect(odds[2]).toBeGreaterThan(430);
    expect(odds[3]).toBeGreaterThan(430);
    expect(odds[0] + odds[1]).toBe(0);
  });

  it("BR19: an ordinary pair still climbs, at one percent and a tenth of that", () => {
    // The Factorio-shaped floor: 1% of children climb at all, and a tenth of
    // those climb again. Nothing is ever permanently locked out of the ladder.
    const odds = tierMatrix(0, 0);
    expect(odds[1]).toBeCloseTo(9, 1);
    expect(odds[2]).toBeCloseTo(0.9, 2);
    expect(odds[3]).toBeCloseTo(0.09, 3);
    expect(odds.reduce((total, n) => total + n, 0)).toBeCloseTo(1000, 6);
  });

  it("BR20: the matrix agrees with the rule it describes", () => {
    // A published matrix that can drift from the code is worse than none.
    for (const [a, b] of [[0, 0], [1, 3], [2, 2], [4, 5], [5, 0]]) {
      const measured = roll(a, b);
      const predicted = tierMatrix(a, b);
      for (let tier = 0; tier < TIER_COUNT; tier++) {
        expect(Math.abs(measured[tier] - predicted[tier])).toBeLessThan(15);
      }
    }
  });

  it("BR21: the prism multiplies the climb by five", () => {
    expect(tierMatrix(0, 0, ["prism"])[1]).toBeCloseTo(45, 1);
    expect(tierMatrix(2, 2, ["prism"])[3]).toBeCloseTo(45, 1);
  });

  it("BR22: nothing ever climbs past the top rung", () => {
    for (let i = 0; i < 2000; i++) {
      expect(inheritTier(rngFor("cap", i), 4, 5, ["prism"])).toBeLessThanOrEqual(TOP_TIER);
    }
    expect(tierMatrix(5, 5).reduce((total, n) => total + n, 0)).toBeCloseTo(1000, 6);
  });
});

describe("colour", () => {
  const rollChroma = (a: string | null, b: string | null, applied: BreedingItem[] = [], count = 20000) => {
    const seen = new Map<string, number>();
    for (let i = 0; i < count; i++) {
      const got = inheritChroma(rngFor("colour", a ?? "-", b ?? "-", i), a, b, applied) ?? "none";
      seen.set(got, (seen.get(got) ?? 0) + 1);
    }
    return (id: string) => ((seen.get(id) ?? 0) / count) * 1000;
  };

  it("BR23: two of a colour always breed that colour", () => {
    for (let i = 0; i < 500; i++) {
      expect(inheritChroma(rngFor("same", i), "tide", "tide", [])).toBe("tide");
    }
  });

  it("BR24: one of a colour is a coin flip", () => {
    const share = rollChroma("tide", null);
    expect(share("tide")).toBeGreaterThan(450);
    expect(share("none")).toBeGreaterThan(450);
  });

  it("BR25: two different colours favour the parents but leave room to drift", () => {
    // 40% each parent, and a fifth spread over every colour — so a line can
    // arrive somewhere neither parent came from without being bred for it.
    const share = rollChroma("tide", "ember");
    expect(share("tide")).toBeGreaterThan(400);
    expect(share("ember")).toBeGreaterThan(400);
    expect(share("onyx")).toBeGreaterThan(15);
    expect(share("none")).toBe(0);
  });

  it("BR26: a lens is the only way to aim, and it is one chance in ten", () => {
    const plain = rollChroma(null, null);
    expect(plain("none")).toBe(1000);

    const lensed = rollChroma(null, null, ["lens-onyx"]);
    expect(lensed("onyx")).toBeGreaterThan(80);
    expect(lensed("onyx")).toBeLessThan(120);

    // On top of parents rather than instead of them.
    const both = rollChroma("tide", "tide", ["lens-onyx"]);
    expect(both("onyx")).toBeGreaterThan(80);
    expect(both("tide")).toBeGreaterThan(820);
  });

  it("BR27: two lenses are two chances, not one shared one", () => {
    const share = rollChroma(null, null, ["lens-onyx", "lens-teal"]);
    // 10%, then 10% of the remaining 90%.
    expect(share("none")).toBeGreaterThan(780);
    expect(share("none")).toBeLessThan(840);
    expect(share("onyx")).toBeGreaterThan(75);
    expect(share("teal")).toBeGreaterThan(65);
  });
});

describe("levels feed the climb", () => {
  it("BR28: a twentieth of a percent per level, on top of the base one percent", () => {
    // Basis points, because 0.05% is not a whole number of per mille and the
    // rest of the pipeline is integers on purpose.
    expect(climbChance([], 0)).toBe(100);
    expect(climbChance([], 100)).toBe(600);
    expect(climbChance([], 200)).toBe(1100);

    // The prism raises the floor, not the slope.
    expect(climbChance(["prism"], 0)).toBe(500);
    expect(climbChance(["prism"], 200)).toBe(1500);
  });

  it("BR29: and it cannot run past certainty", () => {
    expect(climbChance(["prism"], 100_000)).toBe(10_000);
    expect(climbChance([], -50)).toBe(100);
  });

  it("BR30: well-raised parents really do climb more often", () => {
    const roll = (levelSum: number, count = 40000) => {
      let climbed = 0;
      for (let i = 0; i < count; i++) {
        if (inheritTier(rngFor("levels", levelSum, i), 0, 0, [], levelSum) > 0) climbed++;
      }
      return (climbed / count) * 10_000;
    };

    // A pair of level ones against a pair of hundreds: 1.1% against 11%.
    expect(roll(2)).toBeGreaterThan(50);
    expect(roll(2)).toBeLessThan(200);
    expect(roll(200)).toBeGreaterThan(950);
    expect(roll(200)).toBeLessThan(1250);
  });

  it("BR31: the matrix the daycare shows agrees with the roll it describes", () => {
    // The panel quoting odds the engine does not use would be worse than
    // quoting none, so this is checked at the levels a real pair would have.
    for (const levelSum of [0, 60, 200]) {
      const predicted = tierMatrix(0, 0, [], levelSum);

      const seen = new Array(TIER_COUNT).fill(0);
      const count = 40000;
      for (let i = 0; i < count; i++) {
        seen[inheritTier(rngFor("agree", levelSum, i), 0, 0, [], levelSum)]++;
      }

      for (let tier = 0; tier < TIER_COUNT; tier++) {
        const measured = (seen[tier] / count) * 1000;
        expect(Math.abs(measured - predicted[tier]), `tier ${tier} at ${levelSum}`).toBeLessThan(12);
      }
    }
  });
});

describe("the odds on a colour", () => {
  const measure = (a: string | null, b: string | null, applied: BreedingItem[] = [], count = 30000) => {
    const seen = new Map<string, number>();
    for (let i = 0; i < count; i++) {
      const got = inheritChroma(rngFor("odds", a ?? "-", b ?? "-", i), a, b, applied) ?? "none";
      seen.set(got, (seen.get(got) ?? 0) + 1);
    }
    return (id: string | null) => ((seen.get(id ?? "none") ?? 0) / count) * 1000;
  };

  const predicted = (rows: { id: string | null; share: number }[]) => (id: string | null) =>
    rows.find((row) => row.id === id)?.share ?? 0;

  it("BR32: computed odds match rolled ones, for every shape of pairing", () => {
    const cases: [string | null, string | null, BreedingItem[]][] = [
      [null, null, []],
      ["tide", null, []],
      ["tide", "tide", []],
      ["tide", "ember", []],
      [null, null, ["lens-onyx"]],
      ["tide", "ember", ["lens-onyx", "lens-teal"]],
    ];

    for (const [a, b, applied] of cases) {
      const rolled = measure(a, b, applied);
      const shown = predicted(chromaOdds(a, b, applied));

      for (const id of [null, ...CHROMA_IDS]) {
        expect(
          Math.abs(rolled(id) - shown(id)),
          `${a}/${b} ${applied.join("+")} -> ${id}`,
        ).toBeLessThan(20);
      }
    }
  });

  it("BR33: and they always add up to one", () => {
    for (const applied of [[], ["lens-onyx"], ["lens-onyx", "lens-teal", "lens-ember"]]) {
      const total = chromaOdds("tide", "ember", applied).reduce((sum, row) => sum + row.share, 0);
      expect(total).toBeCloseTo(1000, 6);
    }
  });
});
