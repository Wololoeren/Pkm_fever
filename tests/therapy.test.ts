import { describe, expect, it } from "vitest";
import { resolveTurn, startBattle, TRAINER_RULES, type BattleState } from "@/engine/battle";
import { chromaOdds, EGG_INSURANCE } from "@/engine/breeding";
import {
  applyInput,
  buyRefusal,
  disobeys,
  highestLevel,
  initialState,
  insuranceRefusal,
  INSURANCE_PRICE,
  martGateRefusal,
  THERAPY_PRICE,
  THERAPY_STEPS,
  therapyLeaveRefusal,
  therapyTakeRefusal,
  type GameState,
} from "@/engine/engine";
import { teamFlags } from "@/engine/integrity";
import { countOf, hasItem, item } from "@/engine/items";
import { appearanceId } from "@/engine/variants";
import { creature, standInside, testWorld } from "./helpers";

/**
 * Dr. Couch, the Egg Insurance salesman, the Mart's shelves by progress, and
 * the halved Chroma Lens.
 */

const SEED = "COUCH1";

function facing(id: string, extra: Partial<GameState> = {}) {
  const world = testWorld(SEED);
  const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  const [routeId, here] = [...world.npcs].find(([, people]) => people.some((one) => one.id === id))!;
  const them = here.find((one) => one.id === id)!;
  const state: GameState = { ...start, route: routeId, x: them.x, y: them.y - 1, talking: id, ...extra };
  return { world, state };
}

/** One knockout: the experience and effort the winner came away with. */
function earned(winner: ReturnType<typeof creature>): { exp: number; evs: number } {
  const before = startBattle(SEED, "trainer:couch", [winner], [creature("magikarp", { uid: 2, level: 3, moves: ["splash"] })]);
  const after: BattleState = resolveTurn(before, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], TRAINER_RULES).battle;
  const grown = after.sides[0].team[0];
  return { exp: grown.exp - winner.exp, evs: Object.values(grown.evs).reduce((a, b) => a + b, 0) };
}

describe("Dr. Couch", () => {
  it("TH1: a traded creature comes back Rehabilitated after a thousand steps: it obeys, and is no longer traded", () => {
    const traded = { ...creature("machamp", { uid: 20, level: 60, moves: ["karatechop"] }), traded: true };
    const { world, state } = facing("therapist", { party: [creature("pidgey", { uid: 10 }), traded], money: THERAPY_PRICE });
    expect(disobeys(state, traded)).toBe(true);
    expect(therapyLeaveRefusal(world, state, 0, 10)).toMatch(/nothing to work through/);

    const left = applyInput(world, state, { t: "therapyLeave", index: 1, confirm: 20 });
    expect(left.money).toBe(0);
    expect(left.therapy?.creature.uid).toBe(20);
    expect(therapyTakeRefusal(world, { ...left, stepsTaken: THERAPY_STEPS - 1 })).toMatch(/still in session/);

    const back = applyInput(world, { ...left, stepsTaken: THERAPY_STEPS }, { t: "therapyTake" });
    const healed = back.party.at(-1)!;
    expect(healed).toMatchObject({ uid: 20, traded: false, rehabilitated: true });
    expect(disobeys(back, healed)).toBe(false);
    expect(back.notice).toMatchObject({ t: "therapyTaken", became: "Rehabilitated" });
    // A tournament still hears where it came from.
    expect(teamFlags([healed]).traded).toBe(1);
  });

  it("TH2: a prize comes back Redeemed", () => {
    const prize = { ...creature("machamp", { uid: 21, level: 30 }), prize: true };
    const { world, state } = facing("therapist", { party: [creature("pidgey", { uid: 10 }), prize], money: THERAPY_PRICE });
    const left = applyInput(world, state, { t: "therapyLeave", index: 1, confirm: 21 });
    const back = applyInput(world, { ...left, stepsTaken: THERAPY_STEPS }, { t: "therapyTake" });
    expect(back.party.at(-1)).toMatchObject({ prize: false, redeemed: true });
    expect(teamFlags([back.party.at(-1)!]).prize).toBe(1);
  });

  it("TH3: Rehabilitated earns double experience; Redeemed triple experience and triple effort", () => {
    const base = creature("machamp", { uid: 1, level: 20, moves: ["karatechop"] });
    const plain = earned(base);
    const rehab = earned({ ...base, rehabilitated: true });
    const redeemed = earned({ ...base, redeemed: true });
    expect(rehab.exp).toBe(plain.exp * 2);
    expect(rehab.evs).toBe(plain.evs);
    expect(redeemed.exp).toBe(plain.exp * 3);
    expect(redeemed.evs).toBe(plain.evs * 3);
  });
});

describe("Egg Insurance", () => {
  it("EI1: fifty thousand from the salesman in Hearth, once", () => {
    const { world, state } = facing("egg-insurance", { money: INSURANCE_PRICE });
    expect(item(EGG_INSURANCE).price).toBe(0);
    expect(insuranceRefusal(world, { ...state, money: INSURANCE_PRICE - 1 })).toMatch(/50,000/);
    const bought = applyInput(world, state, { t: "buyInsurance" });
    expect(bought.money).toBe(0);
    expect(hasItem(bought.bag, EGG_INSURANCE)).toBe(true);
    expect(insuranceRefusal(world, { ...bought, money: INSURANCE_PRICE })).toBe("you are already covered");
  });

  it("EI2: an ordinary incubated egg pays out a Glitter or a Chroma Candy; a special one does not", () => {
    const world = testWorld(SEED);
    const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const insured = standInside(world, {
      ...start,
      bag: { ...start.bag, [EGG_INSURANCE]: 1 },
      daycare: { ...start.daycare, applied: [EGG_INSURANCE, "incubator"] },
    }, "daycare");

    const hatch = (variantId: string, uid: number) => {
      const egg = { creature: creature("togepi", { uid: 0, level: 1, variantId }), steps: 0, total: 300 };
      return applyInput(world, { ...insured, nextUid: uid, daycare: { ...insured.daycare, incubating: [egg] } }, { t: "hatch", index: 0, from: "incubator" });
    };

    const kinds = new Set<string>();
    for (let uid = 100; uid < 140; uid++) {
      const after = hatch(appearanceId(0, null), uid);
      const payout = after.notice?.t === "hatched" ? after.notice.payout : undefined;
      expect(payout, `uid ${uid}`).toBeDefined();
      kinds.add(payout!);
      expect(countOf(after.bag, payout!)).toBe(countOf(insured.bag, payout!) + 1);
    }
    expect([...kinds].sort()).toEqual(["chromacandy", "glitter"]);

    const shiny = hatch(appearanceId(1, null), 200);
    expect(shiny.notice?.t === "hatched" && shiny.notice.payout).toBeFalsy();
    const coloured = hatch(appearanceId(0, "ember"), 201);
    expect(coloured.notice?.t === "hatched" && coloured.notice.payout).toBeFalsy();
  });
});

describe("the Mart's shelves", () => {
  it("MG1: dearer shelves open with the highest level you have raised, or with badges", () => {
    const world = testWorld(SEED);
    const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const mart = standInside(world, { ...start, money: 1_000_000 }, "mart");

    expect(highestLevel(mart)).toBe(5);
    expect(martGateRefusal(mart, 500)).toBeNull();
    expect(martGateRefusal(mart, 5000)).toMatch(/level 30 or won 3 badges/);
    expect(buyRefusal(world, mart, "masterball", 1)).toMatch(/level 60 or won 7 badges/);

    const raised = { ...mart, party: [{ ...mart.party[0], level: 60 }] };
    expect(buyRefusal(world, raised, "masterball", 1)).toBeNull();
    const badged = { ...mart, badges: ["a", "b", "c"] };
    expect(martGateRefusal(badged, 5000)).toBeNull();
    expect(martGateRefusal(badged, 15000)).not.toBeNull();
  });
});

describe("the Chroma Lens", () => {
  it("CL1: halved — a lens on its own now makes one egg in ten its colour", () => {
    const odds = chromaOdds(null, null, ["lens-ember"]);
    const ember = odds.find((row) => row.id === "ember")!;
    expect(ember.share / 1000).toBeCloseTo(0.1, 2);
  });
});
