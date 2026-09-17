import { describe, expect, it } from "vitest";
import { ABILITIES } from "@/engine/abilities";
import { resolveTurn, RIBBON_CHARM, startBattle, TRAINER_RULES } from "@/engine/battle";
import { PAGEANT_ITEMS } from "@/engine/carry";
import {
  applyInput,
  initialState,
  pageantEnterRefusal,
  PHOTOSHOOT_PAY,
  photoshootRefusal,
  THERAPY_PRICE,
  THERAPY_STEPS,
  type GameState,
} from "@/engine/engine";
import { item } from "@/engine/items";
import {
  CHROMA_SCORE,
  PAGEANT_FIELD,
  PAGEANT_ROUND,
  pageantField,
  pageantScore,
  pageantToBeat,
} from "@/engine/pageant";
import { STAT_IDS } from "@/engine/types";
import { appearanceId, CHROMA_IDS } from "@/engine/variants";
import { creature, testWorld } from "./helpers";

/**
 * The beauty pageant cabin: the line-up, the score, the pageant items, the
 * Ribbon's charm, and the paparazzo who buys a winner's photoshoot.
 */

const SEED = "PAGEANT1";

function facing(id: string, extra: Partial<GameState> = {}) {
  const world = testWorld(SEED);
  const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  const [routeId, here] = [...world.npcs].find(([, people]) => people.some((one) => one.id === id))!;
  const them = here.find((one) => one.id === id)!;
  const state: GameState = { ...start, route: routeId, x: them.x, y: them.y + 1, talking: id, ...extra };
  return { world, state };
}

/** Something that beats any field: level 100, a true shiny in Ivory, three abilities, perfect IVs. */
function stunner(uid: number) {
  const ivs = Object.fromEntries(STAT_IDS.map((stat) => [stat, 31])) as GameState["party"][number]["ivs"];
  return {
    ...creature("gardevoir", { uid, level: 100, moves: ["psychic"], variantId: appearanceId(5, "ivory") }),
    ivs,
    abilities: ABILITIES.slice(0, 3).map((one) => one.id),
  };
}

describe("the cabin and the field", () => {
  it("PA1: both people share a cabin, never the social media one, on every seed", () => {
    for (const seed of ["PAGEANT1", "PAGEANT2", "PAGEANT3"]) {
      const world = testWorld(seed);
      const where = (id: string) => [...world.npcs].find(([, people]) => people.some((one) => one.id === id))?.[0];
      expect(where("pageant-host"), seed).toMatch(/:cabin$/);
      expect(where("paparazzo")).toBe(where("pageant-host"));
      expect(where("pageant-host")).not.toBe(where("influencer"));
    }
  });

  it("PA2: fifteen contestants at levels one to seventy-five, a new line-up every 2,500 steps", () => {
    const field = pageantField(SEED, 0);
    expect(field).toHaveLength(PAGEANT_FIELD);
    for (const one of field) {
      expect(one.level).toBeGreaterThanOrEqual(1);
      expect(one.level).toBeLessThanOrEqual(75);
    }
    expect(pageantField(SEED, 0)).toEqual(field);
    expect(pageantField(SEED, 1)).not.toEqual(field);
    expect(PAGEANT_ROUND).toBe(2500);
  });
});

describe("the score", () => {
  it("PA3: level + 40 a rung + the colour + 20 an ability + IVs + a matching item", () => {
    const plain = { ...creature("pikachu", { uid: 1, level: 10, iv: 0 }), abilities: [] };
    expect(pageantScore(plain)).toBe(10);
    expect(pageantScore({ ...plain, variantId: appearanceId(2, null) })).toBe(10 + 80);
    expect(pageantScore({ ...plain, variantId: appearanceId(0, "ivory") })).toBe(10 + 100);
    expect(pageantScore({ ...plain, variantId: appearanceId(0, "onyx") })).toBe(10 + 90);
    expect(pageantScore({ ...plain, abilities: [ABILITIES[0].id] })).toBe(10 + 20);
    expect(pageantScore({ ...plain, ivs: { ...plain.ivs, hp: 31 } })).toBe(10 + 31);

    // Every colour is worth 30 to 100, and Ivory and Onyx are the top two.
    for (const id of CHROMA_IDS) {
      expect(CHROMA_SCORE[id]).toBeGreaterThanOrEqual(30);
      expect(CHROMA_SCORE[id]).toBeLessThanOrEqual(100);
    }

    // The Stormglass Brooch counts on an Electric type, not on a Fire type.
    const brooch = PAGEANT_ITEMS.find((one) => one.id === "hold-stormbrooch")!;
    expect(pageantScore({ ...plain, heldItem: brooch.id })).toBe(10 + brooch.bonus);
    expect(pageantScore({ ...creature("charmander", { uid: 2, level: 10, iv: 0 }), abilities: [], heldItem: brooch.id })).toBe(10);
  });

  it("PA4: ten pageant items, one or two types each, worth 50 to 200", () => {
    expect(PAGEANT_ITEMS).toHaveLength(10);
    for (const one of PAGEANT_ITEMS) {
      expect(one.types.length).toBeGreaterThanOrEqual(1);
      expect(one.types.length).toBeLessThanOrEqual(2);
      expect(one.bonus).toBeGreaterThanOrEqual(50);
      expect(one.bonus).toBeLessThanOrEqual(200);
      expect(item(one.id).kind).toBe("hold");
    }
  });
});

describe("entering", () => {
  it("PA5: beating the top score wins a Ribbon; one entry per line-up", () => {
    const { world, state } = facing("pageant-host", { party: [stunner(20), creature("pidgey", { uid: 10 })] });
    expect(pageantScore(stunner(20))).toBeGreaterThan(pageantToBeat(world.seed, 0));

    const entered = applyInput(world, state, { t: "pageantEnter", index: 0, confirm: 20 });
    expect(entered.party[0].ribbon).toBe(true);
    expect(entered.notice).toMatchObject({ t: "pageant", won: true });
    expect(pageantEnterRefusal(world, entered, 1, 10)).toMatch(/one entry per line-up/);

    // The next line-up takes a new entry.
    expect(pageantEnterRefusal(world, { ...entered, stepsTaken: PAGEANT_ROUND }, 1, 10)).toBeNull();
    const lost = applyInput(world, { ...entered, stepsTaken: PAGEANT_ROUND }, { t: "pageantEnter", index: 1, confirm: 10 });
    expect(lost.party[1].ribbon).toBeFalsy();
    expect(lost.notice).toMatchObject({ won: false });
  });

  it("PA6: a Ribbon sometimes charms the foe on arrival, lowering its Attack", () => {
    let charmed = 0;
    const N = 400;
    for (let tag = 0; tag < N; tag++) {
      const star = { ...creature("gardevoir", { uid: 1, level: 50, moves: ["splash"] }), ribbon: true };
      const foe = creature("machamp", { uid: 2, level: 50, moves: ["splash"] });
      const battle = startBattle(SEED, `trainer:ribbon${tag}`, [star], [foe]);
      const after = resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], TRAINER_RULES).battle;
      if (after.events.some((event) => event.t === "ribbon")) {
        charmed++;
        expect(after.sides[1].stages.atk).toBe(-1);
      }
    }
    expect(Math.abs(charmed / N - RIBBON_CHARM)).toBeLessThan(0.08);
  });
});

describe("the paparazzo", () => {
  it("PA7: a Ribbon winner's photoshoot pays 100,000 and leaves it Burned Out, which only Dr. Couch mends", () => {
    const winner = { ...stunner(20), ribbon: true };
    const { world, state } = facing("paparazzo", { party: [winner, creature("pidgey", { uid: 10 })], money: 0 });
    expect(photoshootRefusal(world, state, 1, 10)).toMatch(/Ribbon winner/);

    const shot = applyInput(world, state, { t: "photoshoot", index: 0, confirm: 20 });
    expect(shot.money).toBe(PHOTOSHOOT_PAY);
    expect(shot.party[0]).toMatchObject({ ribbon: false, burnedOut: true });

    // Burned out: a tenth of the experience.
    const beat = (one: GameState["party"][number]) => {
      const battle = startBattle(SEED, "trainer:shoot", [{ ...one, moves: ["psychic"] }], [creature("magikarp", { uid: 99, level: 5, moves: ["splash"] })]);
      const after = resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], TRAINER_RULES).battle;
      return after.sides[0].team[0].exp - one.exp;
    };
    const fresh = { ...stunner(20), level: 30, exp: 27000 };
    expect(beat({ ...fresh, burnedOut: true })).toBe(Math.max(1, Math.floor(beat(fresh) / 10)));

    // The couch mends it.
    const couch = facing("therapist", { party: [shot.party[0], creature("pidgey", { uid: 10 })], money: THERAPY_PRICE });
    const left = applyInput(couch.world, couch.state, { t: "therapyLeave", index: 0, confirm: 20 });
    const back = applyInput(couch.world, { ...left, stepsTaken: THERAPY_STEPS }, { t: "therapyTake" });
    expect(back.party.at(-1)).toMatchObject({ burnedOut: false });
    expect(back.notice).toMatchObject({ became: "Recovered" });
  });
});
