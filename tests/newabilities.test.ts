import { describe, expect, it } from "vitest";
import { ABILITIES, FORAGE_EVERY, typesWith } from "@/engine/abilities";
import { activeOf, maxHp, resolveTurn, startBattle, DUEL_RULES, TRAINER_RULES } from "@/engine/battle";
import { move as moveById, species as speciesById } from "@/engine/dex";
import { applyInput, initialState, type GameState } from "@/engine/engine";
import { countOf, isItem } from "@/engine/items";
import { computeStats } from "@/engine/stats";
import { creature, testWorld } from "./helpers";

/**
 * The second wave: the twelve classes, a type lost and a type gained for every
 * type, effort, natures felt harder, and things found on the walk.
 */

type Made = ReturnType<typeof creature>;

/** What one attack took off a big target, both sides otherwise identical. */
function took(attacker: Made, target: Made): number {
  const after = resolveTurn(
    startBattle("NEWAB", "duel", [attacker], [target]),
    [{ t: "fight", moveIndex: 0 }, { t: "pass" }],
    DUEL_RULES,
  ).battle;
  return maxHp(target) - activeOf(after, 1).hp;
}

const ids = (prefix: string) => ABILITIES.filter((spec) => spec.id.startsWith(prefix));

describe("the classes", () => {
  it("NA1: twelve, each built on a real low-to-mid attack (30 to 80 power a hit)", () => {
    const classes = ids("class-");
    expect(classes).toHaveLength(12);
    for (const spec of classes) {
      if (spec.effect.t !== "power" || spec.effect.when !== "signature") throw new Error(spec.id);
      const move = moveById(spec.effect.move!);
      // Double Kick is 30 a hit, twice.
      expect(move.power).toBeGreaterThanOrEqual(30);
      expect(move.power).toBeLessThanOrEqual(80);
      expect(spec.blurb).toContain(move.name);
    }
  });

  it("NA2: the signature move does double, and nothing else does", () => {
    const target = () => creature("chansey", { uid: 2, level: 90, moves: ["growl"] });
    const plain = took(creature("charmander", { uid: 1, level: 20, moves: ["ember"] }), target());
    const sorcerer = took(creature("charmander", { uid: 1, level: 20, moves: ["ember"], abilities: ["class-sorcerer"] }), target());
    expect(sorcerer).toBeGreaterThanOrEqual(plain * 2 - 2);
    expect(sorcerer).toBeLessThanOrEqual(plain * 2 + 2);

    const scratch = took(creature("charmander", { uid: 1, level: 20, moves: ["scratch"] }), target());
    const offClass = took(creature("charmander", { uid: 1, level: 20, moves: ["scratch"], abilities: ["class-sorcerer"] }), target());
    expect(offClass).toBe(scratch);
  });
});

describe("deficiency and affinity", () => {
  it("NA3: one of each for every type", () => {
    expect(ids("lack-")).toHaveLength(18);
    expect(ids("affinity-")).toHaveLength(18);
    expect(ABILITIES.find((spec) => spec.id === "lack-grass")?.name).toBe("Grass Deficiency");
    expect(ABILITIES.find((spec) => spec.id === "affinity-grass")?.name).toBe("Grass Affinity");
  });

  it("NA4: the types it has, lost before gained, typeless when nothing is left", () => {
    expect(typesWith(["lack-grass"], ["grass", "poison"])).toEqual(["poison"]);
    expect(typesWith(["lack-normal"], ["normal"])).toEqual([]);
    expect(typesWith(["affinity-fire"], ["grass"])).toEqual(["grass", "fire"]);
    expect(typesWith(["affinity-grass"], ["grass"])).toEqual(["grass"]);
    expect(typesWith(["lack-fire"], ["water"])).toEqual(["water"]);
  });

  it("NA5: a lost type stops counting on the chart", () => {
    // Fighting is super effective on a pure Normal Chansey, and neutral once
    // it is typeless.
    const hit = (abilities: string[]) =>
      took(creature("machop", { uid: 1, level: 15, moves: ["karatechop"] }), creature("chansey", { uid: 2, level: 90, moves: ["growl"], abilities }));
    expect(hit(["lack-normal"])).toBeLessThan(hit([]));
  });

  it("NA6: a gained type brings its immunity and its same-type bonus", () => {
    const ghostly = took(
      creature("rattata", { uid: 1, level: 30, moves: ["tackle"] }),
      creature("chansey", { uid: 2, level: 90, moves: ["growl"], abilities: ["affinity-ghost"] }),
    );
    expect(ghostly).toBe(0);

    const target = () => creature("machamp", { uid: 2, level: 90, moves: ["growl"] });
    const plain = took(creature("rattata", { uid: 1, level: 70, moves: ["ember"] }), target());
    const fiery = took(creature("rattata", { uid: 1, level: 70, moves: ["ember"], abilities: ["affinity-fire"] }), target());
    expect(fiery).toBeGreaterThan(plain);
  });
});

describe("effort and natures", () => {
  it("NA7: Hard Worker doubles the effort from a win", () => {
    const beat = (abilities: string[]) => {
      const winner = creature("machamp", { uid: 1, level: 20, moves: ["karatechop"], abilities });
      const after = resolveTurn(
        startBattle("NEWAB", "ev", [winner], [creature("magikarp", { uid: 2, level: 3, moves: ["splash"] })]),
        [{ t: "fight", moveIndex: 0 }, { t: "pass" }],
        TRAINER_RULES,
      ).battle;
      return activeOf(after, 0).evs;
    };
    const total = (evs: Record<string, number>) => Object.values(evs).reduce((a, b) => a + b, 0);
    const plain = beat([]);
    expect(total(plain)).toBeGreaterThan(0);
    expect(total(beat(["hardworker"]))).toBe(total(plain) * 2);
    // Steered: all of it into Speed, doubled.
    const sprinter = beat(["sprinter"]);
    expect(sprinter.spe).toBe(total(plain) * 2);
  });

  it("NA8: Strong-Willed doubles the raised stat's bonus; Headstrong the cost too", () => {
    // Adamant: Attack up, Sp. Atk down.
    const stats = (abilities: string[]) =>
      computeStats(speciesById("machamp"), creature("machamp", { uid: 1, level: 100, natureId: "adamant", abilities }));
    const plain = stats([]);
    const strong = stats(["strongwilled"]);
    const fervent = stats(["fervent"]);
    const headstrong = stats(["headstrong"]);

    expect(strong.atk - plain.atk).toBe(24);
    expect(fervent.atk - plain.atk).toBe(48);
    expect(strong.spa).toBe(plain.spa);
    expect(headstrong.atk).toBe(strong.atk);
    expect(plain.spa - headstrong.spa).toBe(24);
    expect(strong.def).toBe(plain.def);
  });
});

describe("foraging", () => {
  it("NA9: every pool is real items", () => {
    const foragers = ABILITIES.filter((spec) => spec.effect.t === "forage");
    expect(foragers.length).toBeGreaterThanOrEqual(5);
    for (const spec of foragers) {
      if (spec.effect.t !== "forage") continue;
      for (const id of spec.effect.items) expect(isItem(id), `${spec.id}: ${id}`).toBe(true);
    }
  });

  it("NA10: a find every 500 steps, for a forager in the party only", () => {
    const world = testWorld("PKMFEVER1");
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const walkOnce = (state: GameState) => applyInput(world, state, { t: "move", dir: "n" });

    const hunter: GameState = {
      ...base,
      party: [{ ...base.party[0], abilities: ["treasurehunter"] }],
      forageWalk: FORAGE_EVERY - 2,
    };
    const early = walkOnce(hunter);
    expect(countOf(early.bag, "nugget") + countOf(early.bag, "pearl")).toBe(0);

    const found = applyInput(world, early, { t: "move", dir: "s" });
    expect(countOf(found.bag, "nugget") + countOf(found.bag, "pearl")).toBe(1);
    expect(found.forageWalk).toBe(0);
    expect(found.notice?.t).toBe("foraged");

    const idle = walkOnce(walkOnce({ ...base, forageWalk: FORAGE_EVERY - 2 }));
    expect(idle.notice).toBeNull();
    expect(idle.forageWalk).toBe(0);
  });
});
