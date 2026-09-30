import { describe, expect, it } from "vitest";
import {
  activeOf,
  maxHp,
  resolveTurn,
  startBattle,
  WILD_RULES,
  type BattleState,
  type SideIndex,
} from "@/engine/battle";
import { isForm, formOf, species as speciesById } from "@/engine/dex";
import { FIELD_TURNS } from "@/engine/field";
import { FORM_RULES, changesShape, formNow, formRule, formSpeciesExist, formsOf } from "@/engine/forms";
import FORM_DATA from "../src/data/forms.json";
import { creature } from "./helpers";

/**
 * The shapes a creature takes during a fight.
 *
 * The property under all of it: **a form is a state, not a species.** It has
 * its own stats and types while it is out, it cannot be caught, bred, bought
 * or hatched, and nobody ever leaves a battle wearing one.
 */

const SEED = "FORMS1";
const TAG = "wild:test:0";

function fought(ours: ReturnType<typeof creature>, theirs: ReturnType<typeof creature>): BattleState {
  return startBattle(SEED, TAG, [ours], [theirs]);
}

function turn(battle: BattleState, ours: number, theirs: number) {
  return resolveTurn(battle, [{ t: "fight", moveIndex: ours }, { t: "fight", moveIndex: theirs }], WILD_RULES, 10).battle;
}

const shapeOf = (battle: BattleState, side: SideIndex = 0) => activeOf(battle, side).speciesId;

describe("the table", () => {
  it("FM1: every shape a rule names is one the dex can find, and none is in the roster", () => {
    expect(FORM_RULES.length).toBeGreaterThan(0);
    for (const rule of FORM_RULES) {
      expect(formSpeciesExist(rule), rule.species).toBe(true);
      expect(rule.says.length, rule.species).toBeGreaterThan(4);

      // The base is a real species; every other shape is a form of it.
      expect(isForm(rule.species), rule.species).toBe(false);
      for (const id of formsOf(rule)) {
        if (id === rule.species) continue;
        expect(isForm(id), id).toBe(true);
        expect(formOf(id), id).toBe(rule.species);
        /*
          * And it is a shape worth taking.
          *
          * Stats, types *or* picture: Mimikyu-Busted has the numbers of a
          * Mimikyu and the look of a torn one, and the thing that changed is
          * that the rag is spent. What is not allowed is a form that differs
          * in none of the three — that is a lie dressed as a feature, and it
          * is why Cherrim is not in this table.
          */
        const base = speciesById(rule.species);
        const form = speciesById(id);
        const same =
          form.types.join() === base.types.join() &&
          JSON.stringify(form.base) === JSON.stringify(base.base) &&
          form.spriteNum === base.spriteNum;
        expect(same, `${id} is indistinguishable from ${rule.species}`).toBe(false);
      }
    }

    // And no orphans the other way: every shape in the data is one some rule
    // can actually reach, or it is a file nobody reads.
    const reachable = new Set(FORM_RULES.flatMap((rule) => formsOf(rule)));
    for (const id of Object.keys(FORM_DATA)) expect(reachable.has(id), `${id} has no rule`).toBe(true);

    // Asked with a form's own id, a rule still answers — the sky has to be
    // able to find a Castform-Rainy's rule to put it back.
    expect(formRule("castformrainy")?.species).toBe("castform");
    expect(changesShape("aegislashblade")).toBe(true);
    expect(changesShape("rattata")).toBe(false);
  });

  it("FM2: the state decides the weather and health shapes, and nothing else", () => {
    const whole = { hp: 100, maxHp: 100 };
    expect(formNow("castform", 50, { weather: "rain", ...whole })).toBe("castformrainy");
    expect(formNow("castform", 50, { weather: "sand", ...whole })).toBe("castform");
    expect(formNow("castformrainy", 50, { weather: null, ...whole })).toBe("castform");
    // Cherrim is not in the table at all: its sunshine shape is the same
    // creature with the same picture. See the note in forms.ts.
    expect(formRule("cherrim")).toBeNull();

    // Health: over the line is the one shape, the line itself is the other.
    expect(formNow("darmanitan", 50, { weather: null, hp: 51, maxHp: 100 })).toBe("darmanitan");
    expect(formNow("darmanitan", 50, { weather: null, hp: 50, maxHp: 100 })).toBe("darmanitanzen");
    expect(formNow("minior", 50, { weather: null, hp: 60, maxHp: 100 })).toBe("miniormeteor");
    expect(formNow("minior", 50, { weather: null, hp: 40, maxHp: 100 })).toBe("minior");

    // A young Wishiwashi cannot gather anybody, however healthy it is.
    expect(formNow("wishiwashi", 25, { weather: null, hp: 100, maxHp: 100 })).toBe("wishiwashischool");
    expect(formNow("wishiwashi", 19, { weather: null, hp: 100, maxHp: 100 })).toBe("wishiwashi");

    // The rest answer something that happened, so the state has nothing to say.
    expect(formNow("mimikyu", 50, { weather: null, ...whole })).toBeNull();
    expect(formNow("aegislash", 50, { weather: null, ...whole })).toBeNull();
    expect(formNow("rattata", 50, { weather: null, ...whole })).toBeNull();
  });
});

describe("in a fight", () => {
  it("FM3: Castform takes the weather's shape, and gives it back when the sky clears", () => {
    const ours = creature("castform", { level: 50, moves: ["raindance", "splash"] });
    // Something with enough health to stand there while the rain runs out.
    const theirs = creature("chansey", { level: 60, moves: ["splash"], uid: 2 });

    const rained = turn(fought(ours, theirs), 0, 0);
    expect(rained.field?.weather?.id).toBe("rain");
    expect(shapeOf(rained)).toBe("castformrainy");
    // Its type went with it, which is the whole reason it matters.
    expect(speciesById(shapeOf(rained)).types).toEqual(["water"]);
    expect(rained.events.some((event) => event.t === "reshaped" && event.into === "castformrainy")).toBe(true);

    // Five turns of rain, and then it is a Castform again.
    let live = rained;
    for (let at = 0; at < FIELD_TURNS; at++) live = turn(live, 1, 0);
    expect(live.field?.weather).toBeUndefined();
    expect(shapeOf(live)).toBe("castform");
  });

  it("FM4: Darmanitan goes Zen when it is hurt enough, and Minior loses its shell", () => {
    for (const [id, form] of [
      ["darmanitan", "darmanitanzen"],
      ["minior", "miniormeteor"],
    ] as const) {
      const ours = creature(id, { level: 50, moves: ["splash"] });
      const theirs = creature("machamp", { level: 80, moves: ["karatechop"], uid: 2 });
      const battle = fought(ours, theirs);

      // Minior wears its shell from the off; Darmanitan is itself until hurt.
      expect(shapeOf(battle) === id || shapeOf(battle) === form).toBe(true);

      let live = battle;
      for (let at = 0; at < 6 && !live.outcome; at++) {
        live = turn(live, 0, 0);
        const who = activeOf(live, 0);
        if (who.hp > 0 && who.hp * 2 <= maxHp(who)) break;
      }

      const hurt = activeOf(live, 0);
      if (hurt.hp > 0) {
        expect(shapeOf(live), `${id} at ${hurt.hp}/${maxHp(hurt)}`).toBe(id === "minior" ? "minior" : "darmanitanzen");
      }
    }
  });

  it("FM5: Mimikyu's disguise eats the first hit, and only the first", () => {
    const ours = creature("mimikyu", { level: 50, moves: ["splash"] });
    // Ghost, so the thing hitting it has to be something a Ghost can feel.
    const theirs = creature("machamp", { level: 50, moves: ["shadowball"], uid: 2 });

    const first = turn(fought(ours, theirs), 0, 0);
    expect(shapeOf(first)).toBe("mimikyubusted");
    // The blow was refused: it is still whole.
    expect(activeOf(first, 0).hp).toBe(maxHp(activeOf(first, 0)));

    const second = turn(first, 0, 0);
    expect(shapeOf(second)).toBe("mimikyubusted");
    expect(activeOf(second, 0).hp).toBeLessThan(maxHp(activeOf(second, 0)));
  });

  it("FM6: Aegislash draws when it attacks and guards when it shields", () => {
    const ours = creature("aegislash", { level: 50, moves: ["ironhead", "kingsshield"] });
    const theirs = creature("chansey", { level: 60, moves: ["splash"], uid: 2 });

    const swung = turn(fought(ours, theirs), 0, 0);
    expect(shapeOf(swung)).toBe("aegislashblade");
    // The blade is the attacking shape: its Attack is the higher of the two.
    expect(speciesById("aegislashblade").base.atk).toBeGreaterThan(speciesById("aegislash").base.atk);

    const guarded = turn(swung, 1, 0);
    expect(shapeOf(guarded)).toBe("aegislash");
  });

  it("FM7: Morpeko alternates every turn, whatever else is happening", () => {
    const ours = creature("morpeko", { level: 50, moves: ["splash"] });
    const theirs = creature("chansey", { level: 60, moves: ["splash"], uid: 2 });

    const one = turn(fought(ours, theirs), 0, 0);
    expect(shapeOf(one)).toBe("morpekohangry");
    const two = turn(one, 0, 0);
    expect(shapeOf(two)).toBe("morpeko");
  });

  it("FM8: nobody walks out of a battle wearing a form", () => {
    const ours = creature("castform", { level: 50, moves: ["raindance", "splash"] });
    // Hard enough to finish it, slow enough that the rain goes up first.
    const theirs = creature("machamp", { level: 30, moves: ["karatechop"], uid: 2 });

    let live = turn(fought(ours, theirs), 0, 0);
    expect(shapeOf(live)).toBe("castformrainy");

    // Beaten to the end: the team handed back to the save is a Castform.
    for (let at = 0; at < 12 && !live.outcome; at++) live = turn(live, 1, 0);
    expect(live.outcome).not.toBeNull();
    expect(live.sides[0].team[0].speciesId).toBe("castform");
    expect(live.sides[0].team[0].hp).toBeLessThanOrEqual(maxHp(live.sides[0].team[0]));
  });
});
