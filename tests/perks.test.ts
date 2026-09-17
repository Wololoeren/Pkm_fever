import { describe, expect, it } from "vitest";
import { ABILITIES, hasPerk } from "@/engine/abilities";
import { resolveTurn, startBattle, TRAINER_RULES } from "@/engine/battle";
import {
  applyInput,
  fameLevel,
  initialState,
  PHOTOSHOOT_PAY,
  STREAM_EARN,
  STREAM_FAINT,
  STREAM_STAKE,
  therapyPrice,
  THERAPY_PRICE,
  THERAPY_STEPS,
  therapyWait,
  type GameState,
} from "@/engine/engine";
import { pageantScore } from "@/engine/pageant";
import { appearanceId } from "@/engine/variants";
import { creature, testWorld } from "./helpers";

/**
 * The social perks: fourteen abilities for the stream, the stage, the camera and the couch.
 */

const SEED = "PERKS1";
const perk = (id: string) => `social-${id}`;

function facing(id: string, extra: Partial<GameState> = {}) {
  const world = testWorld(SEED);
  const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  const [routeId, here] = [...world.npcs].find(([, people]) => people.some((one) => one.id === id))!;
  const them = here.find((one) => one.id === id)!;
  const state: GameState = { ...start, route: routeId, x: them.x, y: them.y + 1, talking: id, ...extra };
  return { world, state };
}

/** One knockout on stream with this famous star, and one turn where the star faints: what the pool did. */
function onStream(abilities: string[]) {
  const { world, state } = facing("streamer");
  const star = {
    ...creature("pikachu", { uid: 20, level: 50, moves: ["thunderbolt"], variantId: appearanceId(1, null) }),
    abilities,
    // Famous 5 with or without an ability, so a perk changes nothing but itself.
    fameSteps: 150_000,
  };
  const foe = creature("magikarp", { uid: 99, level: 7, moves: ["splash"] });
  const fighting: GameState = {
    ...state,
    talking: null,
    phase: "battle",
    party: [star],
    stream: { uid: 20, pool: STREAM_STAKE },
    battle: startBattle(world.seed, "wild:meadow-1:0", [star], [foe]),
  };
  const won = applyInput(world, fighting, { t: "fight", moveIndex: 0 });

  const brute = creature("machamp", { uid: 98, level: 100, moves: ["closecombat"] });
  const weak = { ...star, level: 2, hp: 1 };
  const losing: GameState = { ...fighting, party: [weak], battle: startBattle(world.seed, "wild:meadow-1:1", [weak], [brute]) };
  const lost = applyInput(world, losing, { t: "fight", moveIndex: 0 });
  return { earned: (won.stream?.pool ?? 0) - STREAM_STAKE, fainted: lost.stream ? lost.stream.pool - STREAM_STAKE : null, fame: fameLevel(star) };
}

describe("the social perks", () => {
  it("PK1: fourteen of them, and they are all in the roll", () => {
    expect(ABILITIES.filter((spec) => spec.id.startsWith("social-"))).toHaveLength(14);
    expect(hasPerk({ abilities: [perk("celebrity")] }, "celebrity")).toBe(true);
  });

  it("PK2: Celebrity earns ×5, Renowned ×2, and Drama Queen loses nothing when it faints", () => {
    const plain = onStream([]);
    expect(plain.fame).toBe(5);
    expect(plain.earned).toBe(STREAM_EARN[4] * 7);
    expect(plain.fainted).toBe(-STREAM_FAINT[4]);
    expect(onStream([perk("celebrity")]).earned).toBe(plain.earned * 5);
    expect(onStream([perk("renowned")]).earned).toBe(plain.earned * 2);
    expect(onStream([perk("celebrity"), perk("renowned")]).earned).toBe(plain.earned * 5);
    expect(onStream([perk("dramaqueen")]).fainted).toBe(0);
  });

  it("PK3: Low Bandwidth walks for free on stream", () => {
    const { world, state } = facing("streamer");
    const star = { ...creature("pikachu", { uid: 20, level: 30 }), abilities: [perk("lowbandwidth")] };
    let walked: GameState = { ...state, talking: null, party: [star], stream: { uid: 20, pool: STREAM_STAKE } };
    for (const dir of ["s", "n", "e", "w"] as const) {
      try {
        walked = applyInput(world, walked, { t: "move", dir });
        break;
      } catch {
        /* walled */
      }
    }
    expect(walked.stream?.pool).toBe(STREAM_STAKE);
  });

  it("PK4: Pretty, Photogenic, Trendsetter, Colour Coordinated and Humblebrag on stage", () => {
    const base = { ...creature("charmander", { uid: 1, level: 10, iv: 10, variantId: appearanceId(1, "tide") }), abilities: [] };
    const score = (abilities: string[], extra = {}) => pageantScore({ ...base, abilities, ...extra });
    const plain = score([]);
    // Each of these has one ability, which is itself worth 20.
    expect(score([perk("pretty")])).toBe(plain + 20 + 60 * 4);
    expect(score([perk("photogenic")])).toBe(plain + 20 + 150);
    expect(score([perk("trendsetter")])).toBe(plain + 20 + 40);
    expect(score([perk("colourcoordinated")])).toBe(plain + 20 + 50);
    // A Stormglass Brooch does nothing for a Fire type — unless it is a Humblebrag.
    expect(score([], { heldItem: "hold-stormbrooch" })).toBe(plain);
    expect(score([perk("humblebrag")], { heldItem: "hold-stormbrooch" })).toBe(plain + 20 + 130);
  });

  it("PK5: Viral doubles fame, Comeback Story is free and quick, Thick Skin and Paparazzi Magnet at the shoot", () => {
    const shiny = { ...creature("pikachu", { uid: 1, variantId: appearanceId(1, null) }), fameSteps: 15_000 };
    // Any one ability makes it worth two; Viral on top doubles the steps as well.
    expect(fameLevel({ ...shiny, abilities: [ABILITIES[0].id] })).toBe(2);
    expect(fameLevel({ ...shiny, abilities: [perk("viral")] })).toBe(3);

    const patient = { ...creature("pidgey", { uid: 5 }), traded: true, abilities: [perk("comebackstory")] };
    expect(therapyPrice(patient)).toBe(0);
    expect(therapyPrice({ ...patient, abilities: [] })).toBe(THERAPY_PRICE);
    const couch = { ...facing("therapist").state, stepsTaken: THERAPY_STEPS / 10, therapy: { creature: patient, since: 0 } };
    expect(therapyWait(couch)).toBe(0);

    const winner = (abilities: string[]) => ({ ...creature("gardevoir", { uid: 20, level: 50 }), ribbon: true, abilities });
    const shoot = (abilities: string[]) => {
      const { world, state } = facing("paparazzo", { party: [winner(abilities), creature("pidgey", { uid: 10 })], money: 0 });
      return applyInput(world, state, { t: "photoshoot", index: 0, confirm: 20 });
    };
    expect(shoot([perk("thickskin")]).party[0]).toMatchObject({ ribbon: false, burnedOut: false });
    expect(shoot([perk("paparazzimagnet")]).money).toBe(PHOTOSHOOT_PAY * 3);
  });

  it("PK6: Stage Presence charms twice as often and two stages deep", () => {
    let charmed = 0;
    const N = 300;
    for (let tag = 0; tag < N; tag++) {
      const star = { ...creature("gardevoir", { uid: 1, level: 50, moves: ["splash"] }), ribbon: true, abilities: [perk("stagepresence")] };
      const foe = creature("machamp", { uid: 2, level: 50, moves: ["splash"] });
      const after = resolveTurn(startBattle(SEED, `trainer:presence${tag}`, [star], [foe]), [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], TRAINER_RULES).battle;
      if (after.events.some((event) => event.t === "ribbon")) {
        charmed++;
        expect(after.sides[1].stages.atk).toBe(-2);
      }
    }
    expect(Math.abs(charmed / N - 0.6)).toBeLessThan(0.1);
  });
});
