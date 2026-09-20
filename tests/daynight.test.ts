import { describe, expect, it } from "vitest";
import { ABILITIES } from "@/engine/abilities";
import { resolveTurn, startBattle, TRAINER_RULES } from "@/engine/battle";
import {
  darkness,
  isNightish,
  timeOf,
  untilNext,
  DAY_LENGTH,
  DAY_PHASES,
  PHASE_STEPS,
  TWILIGHT,
} from "@/engine/daynight";
import { ALL_SPECIES } from "@/engine/dex";
import { wildAt } from "@/engine/world";
import { variant } from "@/engine/variants";
import { creature, testWorld } from "./helpers";

/**
 * Ten thousand steps from one morning to the next, and the thousand-step
 * slopes at each end of the night.
 */

describe("the cycle", () => {
  it("DN1: four phases, ten thousand steps, and the twilights are a thousand each", () => {
    expect(DAY_LENGTH).toBe(10_000);
    expect(TWILIGHT).toBe(1_000);
    expect(DAY_PHASES.reduce((sum, phase) => sum + PHASE_STEPS[phase], 0)).toBe(DAY_LENGTH);
    expect(PHASE_STEPS.dusk).toBe(TWILIGHT);
    expect(PHASE_STEPS.dawn).toBe(TWILIGHT);

    expect(timeOf(0)).toBe("day");
    expect(timeOf(PHASE_STEPS.day)).toBe("dusk");
    expect(timeOf(PHASE_STEPS.day + TWILIGHT)).toBe("night");
    expect(timeOf(DAY_LENGTH - 1)).toBe("dawn");
    // And it comes round again, on the same step of every cycle.
    expect(timeOf(DAY_LENGTH * 7 + 10)).toBe("day");
    expect(untilNext(0)).toBe(PHASE_STEPS.day);
  });

  it("DN2: the light slides rather than snapping", () => {
    expect(darkness(0)).toBe(0);
    expect(darkness(PHASE_STEPS.day - 1)).toBe(0);

    // Across the thousand steps of dusk, a thousandth at a time.
    expect(darkness(PHASE_STEPS.day)).toBe(0);
    expect(darkness(PHASE_STEPS.day + TWILIGHT / 2)).toBe(500);
    expect(darkness(PHASE_STEPS.day + TWILIGHT - 1)).toBe(999);
    expect(darkness(PHASE_STEPS.day + TWILIGHT)).toBe(1000);

    // No step ever moves it more than a thousandth.
    let last = darkness(0);
    for (let step = 1; step <= DAY_LENGTH; step++) {
      const now = darkness(step);
      expect(Math.abs(now - last), `step ${step}`).toBeLessThanOrEqual(1);
      last = now;
    }

    // The night, and the darker half of each twilight, run the night table.
    expect(isNightish(0)).toBe(false);
    expect(isNightish(PHASE_STEPS.day + TWILIGHT / 2)).toBe(true);
    expect(isNightish(PHASE_STEPS.day + PHASE_STEPS.dusk + 10)).toBe(true);
  });

  it("DN3: the night deals commoner things, carrying more", () => {
    const world = testWorld("NIGHT1");
    const route = "meadow-1";
    const noon = 0;
    const midnight = PHASE_STEPS.day + PHASE_STEPS.dusk + 500;

    let dayAbilities = 0;
    let nightAbilities = 0;
    let nightColours = 0;
    let dayColours = 0;
    const slots = 400;

    for (let slot = 0; slot < slots; slot++) {
      const byDay = wildAt(world, ALL_SPECIES, route, slot, 1, noon);
      const byNight = wildAt(world, ALL_SPECIES, route, slot, 1, midnight);
      dayAbilities += byDay.abilities.length;
      nightAbilities += byNight.abilities.length;
      if (variant(byDay.variantId).chromaId) dayColours++;
      if (variant(byNight.variantId).chromaId) nightColours++;
    }

    // Three times the abilities, near enough, and colours the day does not deal.
    expect(nightAbilities).toBeGreaterThan(dayAbilities * 2);
    expect(nightColours).toBeGreaterThan(dayColours);

    // And the same slot is the same creature every time it is asked.
    expect(wildAt(world, ALL_SPECIES, route, 3, 1, midnight)).toEqual(
      wildAt(world, ALL_SPECIES, route, 3, 1, midnight),
    );
  });

  it("DN4: ten abilities read the sky, and a battle keeps the hour it began at", () => {
    const hours = ABILITIES.filter((spec) => spec.effect.t === "hour");
    expect(hours).toHaveLength(10);

    const night = PHASE_STEPS.day + PHASE_STEPS.dusk + 100;
    const hit = (abilities: string[], steps: number) => {
      const mine = { ...creature("machamp", { uid: 1, level: 50, moves: ["tackle"] }), abilities };
      const foe = creature("snorlax", { uid: 2, level: 50, moves: ["splash"] });
      const battle = startBattle("HOUR1", "trainer:hour", [mine], [foe], 0, steps);
      const after = resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], TRAINER_RULES).battle;
      const damage = after.events.find((event) => event.t === "damage" && event.side === 1);
      return damage && damage.t === "damage" ? damage.amount : 0;
    };

    const plain = hit([], night);
    expect(hit(["hour-nightstalker"], night)).toBeGreaterThan(plain);
    // The same ability in daylight does nothing at all.
    expect(hit(["hour-nightstalker"], 0)).toBe(hit([], 0));
    // And the day's own is the other way round.
    expect(hit(["hour-sunbather"], 0)).toBeGreaterThan(hit([], 0));
    expect(hit(["hour-sunbather"], night)).toBe(plain);

    // The hour is written down once, at the top of the battle.
    expect(startBattle("HOUR1", "t", [creature("pidgey", { uid: 1 })], [creature("rattata", { uid: 2 })], 0, night).hour).toBe("night");
  });
});
