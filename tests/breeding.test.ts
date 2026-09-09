import { describe, expect, it } from "vitest";
import {
  breed,
  breedingRefusal,
  compatible,
  chromaOdds,
  climbChance,
  generationsToMax,
  inheritChroma,
  inheritTier,
  STEPS_PER_EGG,
  tierMatrix,
  type BreedingItem,
  type DaycareState,
} from "@/engine/breeding";
import { ALL_SPECIES } from "@/engine/dex";
import { applyInput, depositRefusal, initialState, inTown } from "@/engine/engine";
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
  return { slots: [first, second], steps, eggIndex: 0, eggReady: false, applied: [] };
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

  it("BR8: a Ditto lends a slot, not a species", () => {
    const ditto = creature("ditto", { uid: 1 });
    const partner = creature("charmander", { uid: 2 });
    expect(breed(SEED, ditto, partner, 0, []).speciesId).toBe("charmander");
    expect(breed(SEED, partner, ditto, 0, []).speciesId).toBe("charmander");
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
    expect(compatible(creature("ditto", { uid: 1 }), creature("bulbasaur", { uid: 2 }))).toBe(true);
    // Two Dittos have nothing to work from.
    expect(compatible(creature("ditto", { uid: 1 }), creature("ditto", { uid: 2 }))).toBe(false);
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

    // Collecting means going back to the daycare itself.
    const collected = applyInput(world, standInside(world, walked, "daycare"), { t: "collectEgg" });
    const hatchling = [...collected.party, ...collected.box].at(-1)!;
    expect(hatchling.level).toBe(1);
    expect(hatchling.speciesId).toBe("bulbasaur");
    expect(collected.daycare.eggReady).toBe(false);
    expect(collected.daycare.eggIndex).toBe(1);
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

    // Ditto still ignores gender, as it ignores species.
    expect(breedingRefusal(male, creature("ditto", { uid: 5, gender: "male" }))).toBeNull();
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

  it("BR26: a lens is the only way to aim, and it is one chance in five", () => {
    const plain = rollChroma(null, null);
    expect(plain("none")).toBe(1000);

    const lensed = rollChroma(null, null, ["lens-onyx"]);
    expect(lensed("onyx")).toBeGreaterThan(180);
    expect(lensed("onyx")).toBeLessThan(220);

    // On top of parents rather than instead of them.
    const both = rollChroma("tide", "tide", ["lens-onyx"]);
    expect(both("onyx")).toBeGreaterThan(180);
    expect(both("tide")).toBeGreaterThan(760);
  });

  it("BR27: two lenses are two chances, not one shared one", () => {
    const share = rollChroma(null, null, ["lens-onyx", "lens-teal"]);
    // 20%, then 20% of the remaining 80%.
    expect(share("none")).toBeGreaterThan(610);
    expect(share("none")).toBeLessThan(670);
    expect(share("onyx")).toBeGreaterThan(150);
    expect(share("teal")).toBeGreaterThan(130);
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
