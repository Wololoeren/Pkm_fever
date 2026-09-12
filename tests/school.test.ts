import { describe, expect, it } from "vitest";
import { NATURE_MAGNITUDE } from "@/engine/natures";
import { NPCS } from "@/engine/npc";
import { SCHOOL, SCHOOL_LABEL } from "@/engine/school";
import { EV_MAX_PER_STAT, EV_MAX_TOTAL, IV_MAX, WILD_IV_MAX } from "@/engine/stats";
import { TOP_TIER } from "@/engine/variants";
import { testWorld } from "./helpers";

/**
 * The trainer school.
 *
 * Four people in Hearth's house, and the property worth guarding is the same
 * one the route hints keep: every number a teacher says is the engine's. Here
 * it is kept by construction — the lines are built from the constants — so
 * these check that the construction still reaches the text.
 */

const SEED = "SCHOOL1";

describe("the trainer school", () => {
  it("SC1: four teachers, all on the roster, all in Hearth's house", () => {
    expect(SCHOOL).toHaveLength(4);
    for (const teacher of SCHOOL) {
      expect(NPCS.some((one) => one.id === teacher.id)).toBe(true);
      expect(teacher.where).toEqual({ at: "interior", role: "house", town: "hub-0" });
    }
  });

  it("SC2: each lesson says its own number, and the number is the engine's", () => {
    const says = (id: string, phrase: string) => {
      const teacher = SCHOOL.find((one) => one.id === id)!;
      expect(teacher.lines.join(" "), `${id} does not say "${phrase}"`).toContain(phrase);
    };
    says("teacher-iv", `nought to ${IV_MAX}`);
    says("teacher-iv", `nought to ${WILD_IV_MAX}`);
    says("teacher-nature", `adds ${NATURE_MAGNITUDE} to one stat`);
    says("teacher-effort", `${EV_MAX_PER_STAT} in any one stat, ${EV_MAX_TOTAL} in all`);
    says("teacher-shine", `${TOP_TIER + 1} rungs`);
  });

  it("SC3: the world puts them in a room that is Hearth's house, and calls it the school", () => {
    const world = testWorld(SEED);
    const room = [...world.routes.values()].find((route) => route.role === "house" && route.parent === "hub-0");
    expect(room).toBeDefined();
    expect(room!.label).toBe(SCHOOL_LABEL);

    const inside = (world.npcs.get(room!.id) ?? []).filter((npc) => npc.id.startsWith("teacher-"));
    expect(inside).toHaveLength(4);

    // And the other towns keep a house.
    const elsewhere = [...world.routes.values()].filter((route) => route.role === "house" && route.parent !== "hub-0");
    for (const house of elsewhere) expect(house.label).not.toBe(SCHOOL_LABEL);
  });
});
