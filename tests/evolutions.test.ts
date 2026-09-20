import { describe, expect, it } from "vitest";
import { ALL_SPECIES, canLearnMachine, FORM_BASE, learnset, move as moveById, species as speciesById } from "@/engine/dex";
import { applyInput, initialState, type GameState } from "@/engine/engine";
import {
  EVOLUTION_RULES,
  evolutionHoldItems,
  evolutionUseItems,
  ruleSpeciesExist,
  specialEvolutionAt,
} from "@/engine/evolutions";
import { ITEMS } from "@/engine/items";
import { awardExp, evolutionAt, evolutionByItem, evolve, expForLevel } from "@/engine/progression";
import { creature, testWorld } from "./helpers";

/**
 * Every evolution that is not a plain level or a plain stone: trades, held
 * items, friendship, moves and the rest, each given a rule this game can check.
 */

const byName = (name: string) => ITEMS.find((spec) => spec.name === name);

describe("the table", () => {
  it("EV1: every such evolution in the manifest has a rule, and every rule is one of them", () => {
    const wanted = new Set<string>();
    for (const entry of ALL_SPECIES) {
      for (const step of entry.evolvesTo) {
        if (step.method === "useItem" || (step.method === "level" && step.level > 0)) continue;
        wanted.add(`${entry.id}>${step.id}`);
      }
    }
    const covered = new Set(EVOLUTION_RULES.map((rule) => `${rule.from}>${rule.to}`));
    expect([...wanted].filter((key) => !covered.has(key))).toEqual([]);
    expect([...covered].filter((key) => !wanted.has(key))).toEqual([]);
    for (const rule of EVOLUTION_RULES) expect(ruleSpeciesExist(rule), `${rule.from}>${rule.to}`).toBe(true);
  });

  it("EV2: every item a rule names exists — held ones to hold, used ones to use — and every move is learnable", () => {
    for (const name of evolutionHoldItems()) {
      const spec = byName(name);
      expect(spec, name).toBeDefined();
      expect(spec!.kind, name).toBe("hold");
      expect(spec!.price, name).toBeGreaterThan(0);
    }
    for (const name of evolutionUseItems()) {
      const spec = byName(name);
      expect(spec, name).toBeDefined();
      expect(spec!.evolves, name).toBe(true);
    }
    for (const rule of EVOLUTION_RULES) {
      for (const need of rule.needs) {
        if (need.t !== "move") continue;
        expect(moveById(need.move), need.move).toBeDefined();
        const byLevel = learnset(rule.from).some(([, moveId]) => moveId === need.move);
        expect(byLevel || canLearnMachine(rule.from, need.move), `${rule.from} learns ${need.move}`).toBe(true);
      }
    }
  });

  it("EV9: an event form evolves the way the form it is a costume of does", () => {
    /*
     * A spiky-eared Pichu, ten Pikachus in hats, the partner Eevee and AZ's
     * Floette are one species wearing something. The games make them one-offs
     * that cannot evolve at all, which in a game about raising things is a
     * creature you can catch and never finish.
     */
    expect(FORM_BASE.get("pichuspikyeared")).toBe("pichu");
    expect(FORM_BASE.get("pikachualola")).toBe("pikachu");
    expect(FORM_BASE.get("eeveestarter")).toBe("eevee");
    expect(FORM_BASE.get("floetteeternal")).toBe("floette");

    for (const [form, base] of FORM_BASE) {
      expect(speciesById(form).evolvesTo, form).toEqual(speciesById(base).evolvesTo);
      expect(speciesById(form).evolvesTo.length, form).toBeGreaterThan(0);
    }

    // The rules travel with them: a spiky-eared Pichu wants the same Soothe
    // Bell an ordinary one does, and nothing else.
    const bare = creature("pichuspikyeared", { uid: 1, level: 20 });
    expect(specialEvolutionAt(bare)).toBeNull();
    expect(specialEvolutionAt({ ...bare, heldItem: "hold-soothebell" })).toBe("pikachu");

    // A cap Pikachu takes a Thunder Stone like any other, through the plain
    // manifest path rather than the table.
    expect(evolutionByItem(creature("pikachuoriginal", { uid: 2, level: 20 }), "Thunder Stone")).toBe("raichu");

    // And the other direction is left alone: a Kantonian Farfetch'd has no
    // evolution while its Galarian cousin does, and that is the games being
    // interesting rather than an omission.
    for (const id of ["farfetchd", "mrmime", "qwilfish", "corsola", "linoone", "basculin"]) {
      expect(speciesById(id).evolvesTo, id).toEqual([]);
      expect(FORM_BASE.has(id), id).toBe(false);
    }
  });

  it("EV10: none of the world's pools move because of it", () => {
    /*
     * `evolvesTo` is read by the auction's pools, the starter pool and the
     * prize bench, so filling one in is a change to what a *seed* deals. Every
     * form here is either in the Undiscovered egg group or grows into
     * something those pools already weighed, so none of them moves — and this
     * is the test that says so out loud, because the day one does is the day a
     * save stops replaying.
     */
    const forms = new Set(FORM_BASE.keys());
    for (const id of forms) {
      const entry = speciesById(id);
      const peak = Math.max(
        ...[entry, ...entry.evolvesTo.map((step) => speciesById(step.id))].map((one) =>
          Object.values(one.base).reduce((sum, stat) => sum + stat, 0),
        ),
      );
      const undiscovered = entry.eggGroups.includes("Undiscovered");
      // Out of the auction's exotics: either it is not for sale at all, or the
      // line it grows into is under the bar.
      expect(undiscovered || peak < 530, id).toBe(true);
      // And out of the starter pool, which wants a three-stage line at 280-330.
      const own = Object.values(entry.base).reduce((sum, stat) => sum + stat, 0);
      expect(entry.evolvesTo.length !== 1 || own < 280 || own > 330, id).toBe(true);
    }

    // Nothing became somebody's only way in: every form's targets were already
    // reachable from the ordinary form.
    for (const [form, base] of FORM_BASE) {
      const theirs = new Set(speciesById(base).evolvesTo.map((step) => step.id));
      for (const step of speciesById(form).evolvesTo) expect(theirs.has(step.id), `${form}>${step.id}`).toBe(true);
    }
  });
});


describe("evolving", () => {
  it("EV3: a Feebas levelling up holding a Prism Scale is offered Milotic, and the scale is used up", () => {
    const plain = creature("feebas", { uid: 1, level: 20 });
    expect(awardExp(plain, expForLevel(21) - plain.exp).evolveTo).toBeNull();

    const holding = { ...plain, heldItem: "hold-prismscale" };
    const grown = awardExp(holding, expForLevel(21) - holding.exp);
    expect(grown.evolveTo).toBe("milotic");
    const milotic = evolve(grown.individual, "milotic");
    expect(milotic.speciesId).toBe("milotic");
    expect(milotic.heldItem).toBeNull();
  });

  it("EV4: a Kadabra takes a Linking Cord like a stone; an Onix needs the Metal Coat as well", () => {
    expect(evolutionByItem(creature("kadabra", { uid: 1 }), "Linking Cord")).toBe("alakazam");
    expect(evolutionByItem(creature("onix", { uid: 1 }), "Linking Cord")).toBeNull();
    expect(evolutionByItem(creature("onix", { uid: 1, heldItem: "hold-steel" }), "Linking Cord")).toBe("steelix");

    const world = testWorld("EVOLVE1");
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const state: GameState = {
      ...base,
      party: [creature("onix", { uid: 1, level: 30, heldItem: "hold-steel" })],
      bag: { ...base.bag, "stone-linkingcord": 1 },
    };
    const after = applyInput(world, state, { t: "useItem", item: "stone-linkingcord", index: 0 });
    expect(after.party[0].speciesId).toBe("steelix");
    expect(after.party[0].heldItem).toBeNull();
    expect(after.bag["stone-linkingcord"] ?? 0).toBe(0);
  });

  it("EV5: a Soothe Bell stands in for friendship, is kept, and Eevee's move picks which one", () => {
    const golbat = creature("golbat", { uid: 1, level: 30, heldItem: "hold-soothebell" });
    expect(evolutionAt(golbat)).toBe("crobat");
    expect(evolve(golbat, "crobat").heldItem).toBe("hold-soothebell");
    expect(evolutionAt({ ...golbat, heldItem: null })).toBeNull();

    const eevee = creature("eevee", { uid: 1, level: 30, heldItem: "hold-soothebell", moves: ["tackle"] });
    expect(evolutionAt(eevee)).toBeNull();
    expect(evolutionAt({ ...eevee, moves: ["tackle", "confusion"] })).toBe("espeon");
    expect(evolutionAt({ ...eevee, moves: ["tackle", "bite"] })).toBe("umbreon");
    expect(evolutionAt({ ...eevee, moves: ["tackle", "babydolleyes"] })).toBe("sylveon");
  });

  it("EV6: knowing a move, and the pickier of two doors first", () => {
    expect(specialEvolutionAt(creature("piloswine", { uid: 1, moves: ["ancientpower"] }))).toBe("mamoswine");
    expect(specialEvolutionAt(creature("piloswine", { uid: 1, moves: ["tackle"] }))).toBeNull();
    expect(specialEvolutionAt(creature("dunsparce", { uid: 7, moves: ["hyperdrill"] }))).toBe("dudunsparce");
    expect(specialEvolutionAt(creature("dunsparce", { uid: 300, moves: ["hyperdrill"] }))).toBe("dudunsparcethreesegment");
    expect(specialEvolutionAt(creature("mimejr", { uid: 1, moves: ["mimic", "icywind"] }))).toBe("mrmimegalar");
  });

  it("EV7: an offer lapses if what it needed was taken away before it was accepted", () => {
    const world = testWorld("EVOLVE1");
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const state: GameState = {
      ...base,
      party: [creature("feebas", { uid: 1, level: 21 })],
      pendingEvolutions: [{ uid: 1, to: "milotic" }],
    };
    expect(() => applyInput(world, state, { t: "evolve", uid: 1, to: "milotic", accept: true })).toThrow(/Prism Scale/);
  });
});
