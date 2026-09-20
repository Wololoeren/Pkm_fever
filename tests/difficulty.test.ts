import { describe, expect, it } from "vitest";
import { applyInput, gymTeam, initialState, offerRefusal, type GameState } from "@/engine/engine";
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  difficulty,
  difficultyRank,
  effortFor,
  isDifficulty,
} from "@/engine/difficulty";
import { GYMS, gymBreakdown, gymLevel } from "@/engine/gyms";
import { packInputs, unpackInputs } from "@/lib/pack";
import { EV_MAX_PER_STAT, EV_MAX_TOTAL } from "@/engine/stats";
import { STAT_IDS } from "@/engine/types";
import { trainerAt, wildAt } from "@/engine/world";
import { hidesEncounters, walkable } from "@/engine/terrain";
import { isAbility, WILD_ABILITY_ODDS } from "@/engine/abilities";
import { ALL_SPECIES } from "@/engine/dex";
import { creature, testWorld } from "./helpers";

/**
 * Difficulty: five presets, chosen once, and nothing but numbers.
 *
 * The property underneath all of it is that **Normal is the game as it
 * shipped**. Every save written before presets existed replays without one,
 * and if Normal moved a single number those saves would quietly become a
 * different game.
 */

const SEED = "DIFF1";

function started(seed = SEED, hard = DEFAULT_DIFFICULTY): { world: ReturnType<typeof testWorld>; state: GameState } {
  const world = testWorld(seed);
  let state = initialState(world);
  if (hard !== DEFAULT_DIFFICULTY) state = applyInput(world, state, { t: "setDifficulty", id: hard });
  return { world, state: applyInput(world, state, { t: "pickStarter", index: 0 }) };
}

describe("choosing how hard it is", () => {
  it("DF1: five presets, ordered, and Normal is the game as it shipped", () => {
    expect(DIFFICULTIES.map((one) => one.id)).toEqual(["normal", "hard", "brutal", "merciless", "fever"]);
    expect(DEFAULT_DIFFICULTY).toBe("normal");
    expect(difficultyRank("fever")).toBe(4);
    expect(isDifficulty("nope")).toBe(false);
    // An unknown id is Normal rather than an error: it arrives from a save.
    expect(difficulty("nope").id).toBe("normal");
    expect(difficulty(null).id).toBe("normal");

    const normal = difficulty("normal");
    expect(normal.gymPerBadge).toBe(3);
    expect([normal.gymEv, normal.trainerEv, normal.wildLevels, normal.whiteoutMille]).toEqual([0, 0, 0, 0]);
    // A Centre is free on every preset: see the comment on `whiteoutMille`.
    expect(normal.gymAbilities).toEqual(WILD_ABILITY_ODDS);
    expect([normal.moneyMille, normal.catchMille]).toEqual([1000, 1000]);
    // And the gym curve with no preset given is the one Normal names.
    const gym = GYMS[0];
    expect(gymLevel(gym, 5_000, 2)).toBe(gymLevel(gym, 5_000, 2, normal));

    // Every knob moves one way as the list goes on, or stays put.
    for (let at = 1; at < DIFFICULTIES.length; at++) {
      const under = DIFFICULTIES[at - 1];
      const over = DIFFICULTIES[at];
      for (const knob of ["gymBase", "gymPerBadge", "gymIv", "gymEv", "trainerLevels", "trainerIv", "trainerEv", "wildLevels", "whiteoutMille"] as const) {
        expect(over[knob], `${over.id}.${knob}`).toBeGreaterThanOrEqual(under[knob]);
      }
      expect(over.moneyMille).toBeLessThanOrEqual(under.moneyMille);
      expect(over.catchMille).toBeLessThanOrEqual(under.catchMille);
      // Abilities climb by how often a leader fields one at all.
      const any = (one: typeof over) => one.gymAbilities.one + one.gymAbilities.two + one.gymAbilities.three;
      expect(any(over)).toBeGreaterThan(any(under));
      expect(any(over)).toBeLessThanOrEqual(1000);
    }
  });

  it("DF2: effort is spent on what the species is best at, and never over the cap", () => {
    const base = { hp: 60, atk: 130, def: 60, spa: 40, spd: 70, spe: 100 };

    expect(effortFor(base, 0)).toEqual({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
    expect(effortFor(base, 120)).toEqual({ hp: 0, atk: 120, def: 0, spa: 0, spd: 0, spe: 0 });
    // Past one stat's ceiling it runs on to the next best.
    expect(effortFor(base, 300)).toEqual({ hp: 0, atk: 252, def: 0, spa: 0, spd: 0, spe: 48 });

    const full = effortFor(base, EV_MAX_TOTAL);
    expect(full).toEqual({ hp: 0, atk: 252, def: 0, spa: 0, spd: 6, spe: 252 });
    expect(STAT_IDS.reduce((sum, stat) => sum + full[stat], 0)).toBe(EV_MAX_TOTAL);
    // A budget nobody should be able to ask for is still a legal spread.
    const over = effortFor(base, 9_999);
    expect(STAT_IDS.reduce((sum, stat) => sum + over[stat], 0)).toBe(EV_MAX_TOTAL);
    expect(Math.max(...STAT_IDS.map((stat) => over[stat]))).toBeLessThanOrEqual(EV_MAX_PER_STAT);
  });

  it("DF3: it is the first input of the run and cannot be changed after it", () => {
    const world = testWorld(SEED);
    const chosen = applyInput(world, initialState(world), { t: "setDifficulty", id: "brutal" });
    expect(chosen.difficulty).toBe("brutal");
    // Out of the tick, like the trainer name.
    expect(chosen.tick).toBe(0);

    expect(() => applyInput(world, chosen, { t: "setDifficulty", id: "nope" })).toThrow();

    const playing = applyInput(world, chosen, { t: "pickStarter", index: 0 });
    expect(playing.difficulty).toBe("brutal");
    expect(() => applyInput(world, playing, { t: "setDifficulty", id: "normal" })).toThrow();

    // And it survives the codec, like every other input.
    const packed = packInputs([{ t: "setDifficulty", id: "fever" }]);
    expect(unpackInputs(packed)).toEqual([{ t: "setDifficulty", id: "fever" }]);
  });
});

describe("what it does to the people you fight", () => {
  it("DF4: a gym leader grows, trains, and picks something up", () => {
    const { world, state } = started();
    const id = GYMS[0].id;
    const grown: GameState = { ...state, tick: 5_000, badges: ["x", "y"] };

    const easy = gymTeam(world, grown, id);
    const brutal = gymTeam(world, { ...grown, difficulty: "brutal" }, id);
    const fever = gymTeam(world, { ...grown, difficulty: "fever" }, id);

    // More of them, and further up.
    expect(brutal.length).toBe(easy.length + difficulty("brutal").gymTeam);
    expect(brutal.at(-1)!.level).toBeGreaterThan(easy.at(-1)!.level);

    // Untrained on Normal, trained above it — and the effort is spent on what
    // each creature is actually good at rather than spread evenly.
    for (const one of easy) {
      expect(STAT_IDS.reduce((sum, stat) => sum + one.evs[stat], 0)).toBe(0);
      expect(one.heldItem).toBeNull();
      expect(one.ivs.atk).toBe(20);
    }
    for (const one of brutal) {
      expect(STAT_IDS.reduce((sum, stat) => sum + one.evs[stat], 0)).toBe(252);
      expect(one.heldItem).not.toBeNull();
      expect(one.ivs.atk).toBe(27);
    }
    for (const one of fever) {
      expect(STAT_IDS.reduce((sum, stat) => sum + one.evs[stat], 0)).toBe(EV_MAX_TOTAL);
      expect(STAT_IDS.every((stat) => one.ivs[stat] === 31)).toBe(true);
    }

    // The panel that quotes the level before you walk in quotes the same one.
    const sums = gymBreakdown(GYMS[0], 5_000, 2, difficulty("brutal"));
    expect(sums.total).toBe(gymLevel(GYMS[0], 5_000, 2, difficulty("brutal")));
    expect(sums.fromBadges).toBe(2 * difficulty("brutal").gymPerBadge);
  });

  it("DF5: the people on the routes train too", () => {
    const world = testWorld("A1");
    let walking = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    for (let step = 0; step < 60 && world.routes.get(walking.route)!.kind !== "route"; step++) {
      walking = applyInput(world, walking, { t: "move", dir: "e" });
    }
    expect(world.routes.get(walking.route)!.kind).toBe("route");

    const trainer = world.trainers.get(walking.route)![0];
    const route = world.routes.get(walking.route)!;
    const sides = [
      { x: trainer.x - 1, y: trainer.y, dir: "e" as const },
      { x: trainer.x + 1, y: trainer.y, dir: "w" as const },
      { x: trainer.x, y: trainer.y - 1, dir: "s" as const },
      { x: trainer.x, y: trainer.y + 1, dir: "n" as const },
    ].filter(
      (side) =>
        walkable(route.tiles[side.y * route.width + side.x]) && !trainerAt(world, route.id, side.x, side.y),
    );
    const spot = sides.find((side) => !hidesEncounters(route.tiles[side.y * route.width + side.x])) ?? sides[0];

    const beside = { ...walking, x: spot.x, y: spot.y, party: [creature("machamp", { uid: 99, level: 60 })] };
    const easy = applyInput(world, beside, { t: "move", dir: spot.dir });
    const fever = applyInput(world, { ...beside, difficulty: "fever" }, { t: "move", dir: spot.dir });

    const theirs = (state: GameState) => state.battle!.sides[1].team;
    expect(theirs(fever).length).toBe(theirs(easy).length + difficulty("fever").trainerTeam);
    expect(theirs(fever)[0].level).toBe(theirs(easy)[0].level + difficulty("fever").trainerLevels);
    expect(theirs(easy)[0].ivs.spe).toBe(8);
    expect(theirs(fever)[0].ivs.spe).toBe(31);
    expect(STAT_IDS.reduce((sum, stat) => sum + theirs(easy)[0].evs[stat], 0)).toBe(0);
    expect(STAT_IDS.reduce((sum, stat) => sum + theirs(fever)[0].evs[stat], 0)).toBe(460);
    expect(theirs(easy)[0].heldItem).toBeNull();
    expect(theirs(fever)[0].heldItem).not.toBeNull();
    // Same person, same species, whatever the preset: only the training moved.
    expect(theirs(fever)[0].speciesId).toBe(theirs(easy)[0].speciesId);
  });

  it("DF6: the grass grows with it, and the same creature is in it", () => {
    const world = testWorld(SEED);
    const route = [...world.routes.values()].find((one) => one.kind === "route" && one.ring >= 2)!;

    const easy = wildAt(world, ALL_SPECIES, route.id, 0, 1);
    const fever = wildAt(world, ALL_SPECIES, route.id, 0, 1, 0, difficulty("fever").wildLevels);
    expect(fever.speciesId).toBe(easy.speciesId);
    expect(fever.level).toBe(easy.level + difficulty("fever").wildLevels);
    expect(fever.ivs).toEqual(easy.ivs);
  });
  it("DF7: a gym's creatures are born with abilities the harder it gets", () => {
    const { world, state } = started();
    const grown: GameState = { ...state, tick: 5_000, badges: ["x", "y"] };

    /*
     * Across every gym rather than one, because a single leader's five draws
     * are a sample of five and would make this a test of one seed's luck.
     * Eight gyms is enough for the trend to be the trend.
     */
    const carrying = (hard: string) => {
      let withOne = 0;
      let all = 0;
      for (const gym of GYMS) {
        for (const one of gymTeam(world, { ...grown, difficulty: hard }, gym.id)) {
          all += 1;
          if (one.abilities.length) withOne += 1;
        }
      }
      return withOne / all;
    };

    const normal = carrying("normal");
    expect(normal).toBeLessThan(0.3);
    expect(carrying("brutal")).toBeGreaterThan(normal);
    // By the last preset everything a leader fields has at least one.
    expect(carrying("fever")).toBe(1);

    // And they are real abilities, not ids nothing can look up.
    for (const one of gymTeam(world, { ...grown, difficulty: "fever" }, GYMS[0].id)) {
      expect(one.abilities.length).toBeGreaterThanOrEqual(1);
      expect(one.abilities.every(isAbility)).toBe(true);
    }
  });

});

describe("what it costs", () => {
  it("DF8: fainting costs a share of your money above Normal", () => {
    const world = testWorld("A1");
    const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    /*
     * Lost properly rather than reached into: a whiteout is only reachable
     * through a battle that ends with nothing standing. A level one Magikarp
     * that knows Splash runs out of Splash and Struggles itself to death.
     */
    const beaten = (hard: string, money: number): GameState => {
      const [routeId, here] = [...world.trainers].find(([, group]) => group.length > 0)!;
      let live: GameState = {
        ...start,
        difficulty: hard,
        money,
        route: routeId,
        x: here[0].x - 1,
        y: here[0].y,
        party: [creature("magikarp", { uid: 1, level: 1, moves: ["splash"] })],
      };
      live = applyInput(world, live, { t: "move", dir: "e" });
      for (let turn = 0; turn < 300 && live.phase === "battle"; turn++) {
        for (const input of [{ t: "fight", moveIndex: 0 } as const, { t: "struggle" } as const]) {
          try {
            live = applyInput(world, live, input);
            break;
          } catch {
            /* nothing left of that sort */
          }
        }
      }
      expect(live.notice?.t, "the fixture did not actually lose").toBe("whiteout");
      return live;
    };

    const normal = beaten("normal", 10_000);
    expect(normal.money).toBe(10_000);
    expect(normal.notice).toMatchObject({ t: "whiteout", lost: 0 });

    const brutal = beaten("brutal", 10_000);
    expect(brutal.money).toBe(7_500);
    expect(brutal.notice).toMatchObject({ t: "whiteout", lost: 2_500 });

    // Half of nothing is nothing: being broke cannot go further into the red.
    expect(beaten("fever", 0).money).toBe(0);
  });
});
