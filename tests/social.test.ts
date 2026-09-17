import { describe, expect, it } from "vitest";
import { ABILITIES } from "@/engine/abilities";
import { startBattle } from "@/engine/battle";
import {
  applyInput,
  fameLevel,
  fameToNext,
  fameWorth,
  initialState,
  influenceLeaveRefusal,
  STREAM_EARN,
  STREAM_FAINT,
  STREAM_STAKE,
  streamCashRefusal,
  streamRegisterRefusal,
  type GameState,
} from "@/engine/engine";
import { tutorBoard, TUTOR_STAY } from "@/engine/tutor";
import { appearanceId } from "@/engine/variants";
import { creature, testWorld } from "./helpers";

/**
 * The social media cabin: Skye the Influencer and xX_Stream_Xx.
 */

const SEED = "SOCIAL1";

function facing(id: string, extra: Partial<GameState> = {}) {
  const world = testWorld(SEED);
  const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  const [routeId, here] = [...world.npcs].find(([, people]) => people.some((one) => one.id === id))!;
  const them = here.find((one) => one.id === id)!;
  const state: GameState = { ...start, route: routeId, x: them.x, y: them.y + 1, talking: id, ...extra };
  return { world, state };
}

const shiny = (uid: number, fameSteps = 0) => ({
  ...creature("pikachu", { uid, level: 30, moves: ["thunderbolt"], variantId: appearanceId(1, null) }),
  abilities: [],
  fameSteps,
});

describe("the cabin", () => {
  it("SO1: both of them stand in one cabin the seed picks", () => {
    for (const seed of ["SOCIAL1", "SOCIAL2", "SOCIAL3"]) {
      const world = testWorld(seed);
      const where = (id: string) => [...world.npcs].find(([, people]) => people.some((one) => one.id === id))?.[0];
      const cabin = where("influencer");
      expect(cabin, seed).toMatch(/:cabin$/);
      expect(where("streamer"), seed).toBe(cabin);
    }
  });
});

describe("fame", () => {
  it("SO2: worth is a rung per shine, two for a colour, one per ability — and each level needs more on top", () => {
    expect(fameWorth(creature("pidgey", { uid: 1 }))).toBe(0);
    expect(fameWorth(shiny(1))).toBe(1);
    expect(fameWorth({ ...shiny(1), variantId: appearanceId(2, "ember"), abilities: [ABILITIES[0].id] })).toBe(5);

    // Worth one: 10,000, then 20,000 more, then 30,000 more…
    expect(fameLevel(shiny(1, 9_999))).toBe(0);
    expect(fameLevel(shiny(1, 10_000))).toBe(1);
    expect(fameLevel(shiny(1, 29_999))).toBe(1);
    expect(fameLevel(shiny(1, 30_000))).toBe(2);
    expect(fameLevel(shiny(1, 60_000))).toBe(3);
    expect(fameLevel(shiny(1, 100_000))).toBe(4);
    expect(fameLevel(shiny(1, 150_000))).toBe(5);
    expect(fameLevel(shiny(1, 900_000))).toBe(5);
    expect(fameToNext(shiny(1, 10_000))).toBe(20_000);
    expect(fameToNext(shiny(1, 150_000))).toBeNull();

    // Worth two gets there in half the steps.
    const twice = { ...shiny(1, 5_000), variantId: appearanceId(2, null) };
    expect(fameLevel(twice)).toBe(1);
  });

  it("SO3: left with Skye, a special one comes back with the steps it spent — a plain one is refused", () => {
    const { world, state } = facing("influencer", { party: [creature("pidgey", { uid: 10 }), shiny(20)] });
    expect(influenceLeaveRefusal(world, state, 0, 10)).toMatch(/will not trend/);

    const left = applyInput(world, state, { t: "influenceLeave", index: 1, confirm: 20 });
    expect(left.influencing?.creature.uid).toBe(20);
    const back = applyInput(world, { ...left, stepsTaken: left.stepsTaken + 12_000 }, { t: "influenceTake" });
    const famous = back.party.at(-1)!;
    expect(famous.fameSteps).toBe(12_000);
    expect(fameLevel(famous)).toBe(1);
    expect(back.notice).toMatchObject({ t: "influenceTaken", fame: 1 });
  });
});

describe("the stream", () => {
  it("SO4: going live takes the stake from a famous one, and every step costs one", () => {
    const { world, state } = facing("streamer", { party: [shiny(20, 10_000), creature("pidgey", { uid: 10 })], money: STREAM_STAKE });
    expect(streamRegisterRefusal(world, state, 1, 10)).toMatch(/not famous/);
    const live = applyInput(world, state, { t: "streamRegister", index: 0, confirm: 20 });
    expect(live.money).toBe(0);
    expect(live.stream).toEqual({ uid: 20, pool: STREAM_STAKE });
    expect(streamCashRefusal(world, live, false)).toMatch(/nothing above the stake/);

    // Walk until something moves.
    let walked: GameState = { ...live, talking: null };
    for (const dir of ["s", "n", "e", "w"] as const) {
      try {
        walked = applyInput(world, walked, { t: "move", dir });
        break;
      } catch {
        /* walled */
      }
    }
    expect(walked.stream?.pool).toBe(STREAM_STAKE - 1);

    // Nearly empty: one more step and the plug is pulled.
    let broke: GameState = { ...live, talking: null, stream: { uid: 20, pool: 0 } };
    for (const dir of ["s", "n", "e", "w"] as const) {
      try {
        broke = applyInput(world, broke, { t: "move", dir });
        break;
      } catch {
        /* walled */
      }
    }
    expect(broke.stream).toBeNull();
  });

  it("SO5: a knockout while the famous one is on the team pays by the foe's level; collecting takes what is above the stake", () => {
    const { world, state } = facing("streamer");
    const star = shiny(20, 30_000); // Famous 2
    const foe = creature("magikarp", { uid: 99, level: 7, moves: ["splash"] });
    const fighting: GameState = {
      ...state,
      talking: null,
      phase: "battle",
      party: [star],
      stream: { uid: 20, pool: STREAM_STAKE },
      battle: startBattle(world.seed, "wild:meadow-1:0", [star], [foe]),
    };
    const after = applyInput(world, fighting, { t: "fight", moveIndex: 0 });
    expect(after.stream?.pool).toBe(STREAM_STAKE + STREAM_EARN[1] * 7);

    const back = { ...after, phase: "field" as const, battle: null, talking: "streamer", money: 0 };
    const collected = applyInput(world, back, { t: "streamCollect" });
    expect(collected.money).toBe(STREAM_EARN[1] * 7);
    expect(collected.stream?.pool).toBe(STREAM_STAKE);

    const ended = applyInput(world, collected, { t: "streamUnregister" });
    expect(ended.money).toBe(collected.money + STREAM_STAKE);
    expect(ended.stream).toBeNull();
    expect(STREAM_FAINT[1]).toBe(1000);
  });
});

describe("a regression", () => {
  it("SO6: fetching a pupil from the Ability Tutor leaves the Therapist's couch alone", () => {
    const { world, state } = facing("ability-tutor");
    const offer = tutorBoard(world.seed, 0)[0];
    const busy: GameState = {
      ...state,
      stepsTaken: TUTOR_STAY,
      tutoring: { creature: creature("pidgey", { uid: 30 }), abilityId: offer.abilityId, since: 0 },
      therapy: { creature: creature("rattata", { uid: 31 }), since: 0 },
    };
    const took = applyInput(world, busy, { t: "tutorTake" });
    expect(took.therapy?.creature.uid).toBe(31);
  });
});
