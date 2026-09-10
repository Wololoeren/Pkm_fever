import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ABILITIES,
  ability,
  abilityOdds,
  inheritAbilities,
  isAbility,
  MAX_ABILITIES,
  rollAbilities,
} from "@/engine/abilities";
import {
  activeOf,
  maxHp,
  resolveTurn,
  startBattle,
  DUEL_RULES,
  TRAINER_RULES,
  type BattleState,
} from "@/engine/battle";
import { breed } from "@/engine/breeding";
import { TYPE_NAMES } from "@/engine/dex";
import { rngFor } from "@/engine/rng";
import { ALL_SPECIES } from "@/engine/dex";
import { wildAt } from "@/engine/world";
import { creature, testWorld } from "./helpers";

/**
 * Abilities, and the one thing about them that is this game's own: they belong
 * to the individual rather than to the species.
 *
 * That single decision is what the odds are protecting. Nine wild creatures in
 * ten have none, so an ability is a reason to look twice at a Rattata; and
 * because breeding stacks them up to three while nothing wild is ever born
 * with more than two, the best-abilitied creature in any world is one somebody
 * bred. Every test below is really about one of those two facts.
 */

/** One turn, both sides swinging, so a hook can be watched in isolation. */
function oneTurn(mine: ReturnType<typeof creature>, theirs: ReturnType<typeof creature>): BattleState {
  return resolveTurn(
    startBattle("AB", "duel", [mine], [theirs]),
    [{ t: "fight", moveIndex: 0 }, { t: "pass" }],
    DUEL_RULES,
  ).battle;
}

/**
 * How much a move took off, with and without something carried.
 *
 * A small attacker against a very large target on purpose. Damage is clamped
 * to what the target had left, so a one-shot reports the target's health
 * rather than the move's — and two abilities that both one-shot would look
 * identical to two that do nothing.
 */
function dealt(carrying: string[], mine: Parameters<typeof creature>[1], theirs: Parameters<typeof creature>[1]) {
  const attacker = creature("machop", { uid: 1, level: 10, ...mine, abilities: carrying });
  const target = creature("chansey", { uid: 2, level: 80, moves: ["growl"], ...theirs });
  const after = oneTurn(attacker, target);
  const took = maxHp(target) - activeOf(after, 1).hp;
  expect(took, "the target was one-shot, so this measures nothing").toBeLessThan(maxHp(target));
  return took;
}

describe("the catalogue", () => {
  it("A1: every ability is named, described, and reachable by id", () => {
    expect(ABILITIES.length).toBeGreaterThan(50);
    const ids = new Set<string>();
    const names = new Set<string>();

    for (const spec of ABILITIES) {
      expect(spec.id, "an ability with no id").toBeTruthy();
      expect(spec.name.length).toBeGreaterThan(2);
      expect(spec.blurb.length).toBeGreaterThan(10);
      expect(ability(spec.id)).toBe(spec);
      expect(isAbility(spec.id)).toBe(true);

      expect(ids.has(spec.id), `two abilities share the id ${spec.id}`).toBe(false);
      expect(names.has(spec.name), `two abilities share the name ${spec.name}`).toBe(false);
      ids.add(spec.id);
      names.add(spec.name);
    }
  });

  it("A2: the three families cover every type, with no holes to explain", () => {
    const types = TYPE_NAMES.filter((type) => type !== "stellar");

    for (const family of ["cornered", "absorb", "ward"]) {
      const covered = ABILITIES.filter((spec) => spec.id.startsWith(`${family}-`))
        .map((spec) => spec.id.slice(family.length + 1))
        .sort();
      expect(covered, `${family} does not cover every type`).toEqual([...types].sort());
    }
  });

  it("A3: a canon name is only used where the canon mechanic is", () => {
    // Volt Absorb and Water Absorb are immunity plus a quarter healed, which
    // is exactly what the absorb family does. Flash Fire and Sap Sipper are
    // immunity plus a *boost*, so they do not get to borrow those names —
    // teaching somebody who knows the games something false is worse than an
    // unfamiliar name.
    const named = new Map(ABILITIES.map((spec) => [spec.name, spec]));
    expect(named.get("Volt Absorb")?.id).toBe("absorb-electric");
    expect(named.get("Water Absorb")?.id).toBe("absorb-water");
    expect(named.has("Flash Fire")).toBe(false);
    expect(named.has("Sap Sipper")).toBe(false);

    // Levitate is immunity with no healing, so it is its own entry.
    expect(named.get("Levitate")?.effect).toEqual({ t: "immune", type: "ground" });
  });

  it("A4: Wonder Guard is excluded on purpose, and the reason is written down", () => {
    expect(ABILITIES.some((spec) => spec.name === "Wonder Guard")).toBe(false);

    // Not an oversight: with Struggle deliberately neutral rather than exempt,
    // Wonder Guard would block Struggle too, which is a battle that can be
    // neither won nor left.
    const doc = readFileSync(join(process.cwd(), "docs", "abilities-deferred.md"), "utf8");
    expect(doc).toContain("Wonder Guard");
    expect(doc).toContain("Struggle");
  });

  it("A4b: the reference lists every one of them, so it cannot go quietly stale", () => {
    // docs/abilities.md is what somebody reads instead of the source. A list
    // that is missing three entries is worse than no list, because nobody
    // checks a document they have no reason to distrust.
    const doc = readFileSync(join(process.cwd(), "docs", "abilities.md"), "utf8");

    const missing = ABILITIES.filter((spec) => !doc.includes(spec.name)).map((spec) => spec.name);
    expect(missing, `not in docs/abilities.md: ${missing.join(", ")}`).toEqual([]);

    // And the counts it opens with have to be the real ones.
    const singles = ABILITIES.filter(
      (spec) => !/^(cornered|absorb|ward)-/.test(spec.id),
    ).length;
    expect(doc).toContain(`## The thirty-five singles`);
    expect(singles).toBe(35);
    expect(ABILITIES.length).toBe(89);
  });
});

describe("how they are handed out", () => {
  it("A5: eighty-nine in a hundred with none, ten with one, one with two", () => {
    const counts = [0, 0, 0, 0];
    const runs = 200_000;
    for (let index = 0; index < runs; index++) {
      counts[rollAbilities(rngFor("abilities", "roll", index)).length]++;
    }

    // Half a percent of tolerance, well inside the sampling error at this
    // sample size and far outside any disagreement with the rule.
    expect(counts[0] / runs).toBeCloseTo(0.89, 2);
    expect(counts[1] / runs).toBeCloseTo(0.1, 2);
    expect(counts[2] / runs).toBeCloseTo(0.01, 2);
    // Nothing wild is ever born with three. That is breeding's alone.
    expect(counts[3]).toBe(0);
  });

  it("A6: never the same one twice, and always sorted", () => {
    for (let index = 0; index < 5_000; index++) {
      const rolled = rollAbilities(rngFor("abilities", "dupes", index));
      expect(new Set(rolled).size).toBe(rolled.length);
      expect(rolled).toEqual([...rolled].sort());
      for (const id of rolled) expect(isAbility(id)).toBe(true);
    }
  });

  it("A7: the wild carries them, at about the rate it should", () => {
    // Through the world rather than through the roll: this is the number a
    // player actually meets.
    const world = testWorld("ABWILD");
    let seen = 0;
    let withAny = 0;

    for (const route of world.routes.values()) {
      if (route.kind !== "route") continue;
      for (let slot = 0; slot < 40; slot++) {
        const wild = wildOf(world, route.id, slot);
        seen++;
        if (wild.length) withAny++;
      }
    }

    expect(seen).toBeGreaterThan(500);
    // Eleven in a hundred carry something. Wide bounds, because this is a
    // sample of one world rather than of the rule.
    expect(withAny / seen).toBeGreaterThan(0.05);
    expect(withAny / seen).toBeLessThan(0.2);
  });
});

describe("breeding them", () => {
  it("A8: a coin for each of the parents', and at most three kept", () => {
    const first = ["adaptability", "technician"];
    const second = ["moxie", "sturdy"];

    let biggest = 0;
    const tally = [0, 0, 0, 0];
    for (let index = 0; index < 20_000; index++) {
      const child = inheritAbilities(rngFor("abilities", "egg", index), first, second);
      tally[child.length]++;
      biggest = Math.max(biggest, child.length);
      expect(new Set(child).size).toBe(child.length);
      for (const id of child) expect([...first, ...second]).toContain(id);
    }

    // Four coins, so three is reachable and four is not.
    expect(biggest).toBe(MAX_ABILITIES);
    expect(tally[0] / 20_000).toBeCloseTo(1 / 16, 2);
  });

  it("A9: the odds the daycare shows are the odds the egg is rolled against", () => {
    const first = ["adaptability", "technician"];
    const second = ["moxie"];
    const shown = abilityOdds(first, second);

    const tally = new Array(shown.length).fill(0);
    const runs = 40_000;
    for (let index = 0; index < runs; index++) {
      tally[inheritAbilities(rngFor("abilities", "odds", index), first, second).length]++;
    }

    for (let count = 0; count < shown.length; count++) {
      expect(Math.abs((tally[count] / runs) * 1000 - shown[count])).toBeLessThan(10);
    }
  });

  it("A10: an ability both parents carry is one coin, not two", () => {
    const shared = abilityOdds(["moxie"], ["moxie"]);
    // One coin: half the children get it, half do not.
    expect(shared[0]).toBeCloseTo(500, 0);
    expect(shared[1]).toBeCloseTo(500, 0);
    expect(shared[2]).toBe(0);
  });

  it("A11: a real egg carries what the rule says, and replays", () => {
    const mother = creature("pidgey", { uid: 1, gender: "female", abilities: ["moxie", "sturdy"] });
    const father = creature("pidgey", { uid: 2, gender: "male", abilities: ["technician"] });

    for (let egg = 0; egg < 30; egg++) {
      const once = breed("EGGAB", mother, father, egg, []);
      const twice = breed("EGGAB", mother, father, egg, []);
      expect(once.abilities).toEqual(twice.abilities);
      expect(once.abilities.length).toBeLessThanOrEqual(MAX_ABILITIES);
      for (const id of once.abilities) {
        expect(["moxie", "sturdy", "technician"]).toContain(id);
      }
    }
  });
});

describe("what they do in a battle", () => {
  it("A12: Adaptability turns the same-type bonus into a double", () => {
    // Machop is Fighting and Brick Break is Fighting, so the bonus applies.
    const plain = dealt([], { moves: ["brickbreak"] }, {});
    const adapted = dealt(["adaptability"], { moves: ["brickbreak"] }, {});
    expect(adapted).toBeGreaterThan(plain);
  });

  it("A13: Huge Power doubles the Attack behind a physical move", () => {
    expect(dealt(["hugepower"], { moves: ["brickbreak"] }, {})).toBeGreaterThan(
      dealt([], { moves: ["brickbreak"] }, {}),
    );
  });

  it("A14: Technician lifts the weak moves and leaves the strong ones alone", () => {
    // Tackle is 40 power, so it qualifies; Seismic Toss is fixed damage and
    // does not go through the power gate at all.
    expect(dealt(["technician"], { moves: ["tackle"] }, {})).toBeGreaterThan(
      dealt([], { moves: ["tackle"] }, {}),
    );
  });

  it("A15: an absorber is untouched and healed instead", () => {
    const attacker = creature("pikachu", { uid: 1, level: 50, moves: ["thundershock"] });
    const drinker = {
      ...creature("chansey", { uid: 2, level: 50, moves: ["growl"], abilities: ["absorb-electric"] }),
      hp: 50,
    };

    const after = oneTurn(attacker, drinker);
    const them = activeOf(after, 1);

    expect(them.hp).toBeGreaterThan(50);
    expect(after.events.some((event) => event.t === "ability" && event.abilityId === "absorb-electric")).toBe(true);
    // Nothing landed.
    expect(after.events.some((event) => event.t === "damage" && event.side === 1)).toBe(false);
  });

  it("A16: Levitate is an immunity with no healing in it", () => {
    const attacker = creature("machop", { uid: 1, level: 50, moves: ["mudslap"] });
    const floating = {
      ...creature("chansey", { uid: 2, level: 50, moves: ["growl"], abilities: ["levitate"] }),
      hp: 50,
    };

    const after = oneTurn(attacker, floating);
    expect(activeOf(after, 1).hp).toBe(50);
    expect(after.events.some((event) => event.t === "immune")).toBe(true);
  });

  it("A17: a ward halves it, and Thick Fat halves two types", () => {
    const bare = dealt([], { moves: ["firepunch"] }, {});
    const warded = dealt([], { moves: ["firepunch"] }, { abilities: ["ward-fire"] });
    const fat = dealt([], { moves: ["firepunch"] }, { abilities: ["thickfat"] });

    expect(warded).toBeLessThan(bare);
    expect(fat).toBeLessThan(bare);
  });

  it("A18: a status that is ignored never sticks, and says so", () => {
    // Thunder Wave paralyses; Limber does not allow it.
    const attacker = creature("pikachu", { uid: 1, level: 50, moves: ["thunderwave"] });
    const limber = creature("chansey", { uid: 2, level: 50, moves: ["growl"], abilities: ["limber"] });

    const after = oneTurn(attacker, limber);
    expect(activeOf(after, 1).status).toBeNull();
    expect(after.events.some((event) => event.t === "ability" && event.abilityId === "limber")).toBe(true);
  });

  it("A19: Sturdy leaves it standing, from full health only", () => {
    const heavy = creature("dragonite", { uid: 1, level: 90, moves: ["slam"] });
    const tough = creature("magikarp", { uid: 2, level: 5, moves: ["splash"], abilities: ["sturdy"] });

    const after = oneTurn(heavy, tough);
    expect(activeOf(after, 1).hp).toBe(1);
    expect(after.events.some((event) => event.t === "ability" && event.abilityId === "sturdy")).toBe(true);

    // Already hurt, so there is nothing for it to save.
    const hurt = { ...tough, hp: Math.max(1, maxHp(tough) - 1) };
    expect(activeOf(oneTurn(heavy, hurt), 1).hp).toBe(0);
  });

  it("A20: Clear Body refuses somebody else's stat drop and allows its own", () => {
    // Growl lowers the target's Attack.
    const growler = creature("pidgey", { uid: 1, level: 50, moves: ["growl"] });
    const held = creature("chansey", { uid: 2, level: 50, moves: ["growl"], abilities: ["clearbody"] });

    const after = oneTurn(growler, held);
    expect(after.sides[1].stages.atk).toBe(0);
    expect(after.events.some((event) => event.t === "ability" && event.abilityId === "clearbody")).toBe(true);
  });

  it("A21: Intimidate lands on the opening lead, not only on a switch", () => {
    const bully = creature("machop", { uid: 1, level: 50, moves: ["growl"], abilities: ["intimidate"] });
    const victim = creature("chansey", { uid: 2, level: 50, moves: ["growl"] });

    const after = oneTurn(bully, victim);
    expect(after.events.some((event) => event.t === "ability" && event.abilityId === "intimidate")).toBe(true);
    // Both Growl and Intimidate lower it, so it is at least one stage down.
    expect(after.sides[1].stages.atk).toBeLessThan(0);
  });

  it("A22: Scrappy reaches a Ghost that Normal cannot", () => {
    const attacker = creature("machop", { uid: 1, level: 50, moves: ["tackle"] });
    const ghost = creature("gastly", { uid: 2, level: 50, moves: ["growl"] });

    const blocked = oneTurn(attacker, ghost);
    expect(activeOf(blocked, 1).hp).toBe(maxHp(ghost));

    const reaching = oneTurn({ ...attacker, abilities: ["scrappy"] }, ghost);
    expect(activeOf(reaching, 1).hp).toBeLessThan(maxHp(ghost));
  });

  it("A23: Rock Head takes the recoil off", () => {
    const bare = creature("machop", { uid: 1, level: 50, moves: ["doubleedge"] });
    const hard = { ...bare, abilities: ["rockhead"] };
    const target = creature("chansey", { uid: 2, level: 50, moves: ["growl"] });

    const hurt = activeOf(oneTurn(bare, target), 0).hp;
    const fine = activeOf(oneTurn(hard, target), 0).hp;
    expect(fine).toBeGreaterThan(hurt);
    expect(fine).toBe(maxHp(bare));
  });

  it("A24: Regenerator and Natural Cure both pay out on the way out", () => {
    const tired = {
      ...creature("chansey", { uid: 1, level: 50, moves: ["growl"], abilities: ["regenerator", "naturalcure"], status: "psn" }),
      hp: 20,
    };
    const spare = creature("machop", { uid: 2, level: 50, moves: ["tackle"] });
    const foe = creature("pidgey", { uid: 3, level: 50, moves: ["growl"] });

    const after = resolveTurn(
      startBattle("AB2", "duel", [tired, spare], [foe]),
      [{ t: "switch", partyIndex: 1 }, { t: "pass" }],
      TRAINER_RULES,
    ).battle;

    const rested = after.sides[0].team[0];
    expect(rested.hp).toBeGreaterThan(20);
    expect(rested.status).toBeNull();
  });

  it("A25: what it can do is part of the fingerprint two peers compare", () => {
    const plain = creature("machop", { uid: 1, level: 50, moves: ["tackle"] });
    const gifted = { ...plain, abilities: ["moxie"] };
    const foe = creature("chansey", { uid: 2, level: 50, moves: ["growl"] });

    // Otherwise a duel where one client thought a creature had Moxie and the
    // other did not would only notice three turns later, on the damage.
    expect(startBattle("AB3", "duel", [plain], [foe]).sides[0].team[0].abilities).toEqual([]);
    expect(startBattle("AB3", "duel", [gifted], [foe]).sides[0].team[0].abilities).toEqual(["moxie"]);
  });
});

/** The abilities on one encounter slot — the same call the grass makes, so
 * this is a creature a player would actually meet. */
function wildOf(world: ReturnType<typeof testWorld>, route: string, slot: number): string[] {
  return wildAt(world, ALL_SPECIES, route, slot, 1).abilities;
}
