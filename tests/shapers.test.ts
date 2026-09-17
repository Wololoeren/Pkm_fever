import { describe, expect, it } from "vitest";
import { ABILITIES, MAX_ABILITIES } from "@/engine/abilities";
import {
  applyInput,
  chromaTradeRefusal,
  giftSwapRefusal,
  initialState,
  tutorLeaveRefusal,
  tutorTakeRefusal,
  type GameState,
} from "@/engine/engine";
import { countOf, isItem, item } from "@/engine/items";
import {
  CHROMA_CANDY,
  chromaCandyFor,
  GIFT_RARE_PERCENT,
  giftContents,
  SECRET_GIFT,
  TUTOR_OFFERS,
  TUTOR_STAY,
  TUTOR_STEP,
  tutorBoard,
  type TutorOffer,
} from "@/engine/tutor";
import { appearanceId, TOP_TIER } from "@/engine/variants";
import { creature, testWorld } from "./helpers";

/**
 * The three who shape abilities: the Colour Collector, the Ability Tutor and
 * the Gift Swapper. See tutor.ts.
 */

const SEED = "SHAPE1";

/** Standing in front of the person with this id, with this party. */
function facing(id: string, party: GameState["party"], extra: Partial<GameState> = {}) {
  const world = testWorld(SEED);
  const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  const where = [...world.npcs].find(([, here]) => here.some((one) => one.id === id));
  expect(where, `${id} is not placed`).toBeDefined();
  const [routeId, here] = where!;
  const them = here.find((one) => one.id === id)!;
  const state: GameState = { ...start, route: routeId, x: them.x, y: them.y - 1, talking: id, party, ...extra };
  return { world, state };
}

const coloured = (uid: number, tier = 0) =>
  creature("rattata", { uid, level: 10, variantId: appearanceId(tier, "ember") });
const plain = (uid: number) => creature("pidgey", { uid, level: 10 });

describe("the three are in the world", () => {
  it("SH1: each is placed on every seed", () => {
    for (const seed of ["SHAPE1", "SHAPE2", "SHAPE3"]) {
      const everyone = [...testWorld(seed).npcs.values()].flat().map((one) => one.id);
      for (const id of ["colour-collector", "ability-tutor", "gift-swapper"]) {
        expect(everyone, `${id} on ${seed}`).toContain(id);
      }
    }
    expect(isItem(CHROMA_CANDY) && isItem(SECRET_GIFT)).toBe(true);
  });
});

describe("the Colour Collector", () => {
  it("SH2: a colour is one candy, and every shine rung on top is one more", () => {
    expect(chromaCandyFor(plain(1))).toBe(0);
    expect(chromaCandyFor(coloured(1))).toBe(1);
    expect(chromaCandyFor(coloured(1, TOP_TIER))).toBe(1 + TOP_TIER);
  });

  it("SH3: takes a coloured one, pays candy, and hands back what it was holding", () => {
    const holding = { ...coloured(20, 2), heldItem: "hold-choiceband" };
    const { world, state } = facing("colour-collector", [plain(10), holding]);
    const after = applyInput(world, state, { t: "chromaTrade", index: 1, confirm: 20 });
    expect(after.party.map((one) => one.uid)).toEqual([10]);
    expect(countOf(after.bag, CHROMA_CANDY)).toBe(3);
    expect(countOf(after.bag, "hold-choiceband")).toBe(1);
  });

  it("SH4: refuses one with no colour, your last one, and the wrong one", () => {
    const { world, state } = facing("colour-collector", [plain(10), coloured(20)]);
    expect(chromaTradeRefusal(world, state, 0, 10)).toBe("it is not wearing a colour");
    expect(chromaTradeRefusal(world, state, 1, 99)).toBe("that is not the one you were shown");
    expect(chromaTradeRefusal(world, { ...state, party: [coloured(20)] }, 0, 20)).toBe("keep something that can fight");
  });
});

describe("the Gift Swapper", () => {
  it("SH5: any creature for a Secret Gift, and opening it swaps the gift for what is inside", () => {
    const { world, state } = facing("gift-swapper", [plain(10), plain(11)]);
    expect(giftSwapRefusal(world, state, 1, 11)).toBeNull();
    const swapped = applyInput(world, state, { t: "giftSwap", index: 1, confirm: 11 });
    expect(swapped.party).toHaveLength(1);
    expect(countOf(swapped.bag, SECRET_GIFT)).toBe(1);

    const opened = applyInput(world, { ...swapped, talking: null }, { t: "useItem", item: SECRET_GIFT, index: 0 });
    expect(countOf(opened.bag, SECRET_GIFT)).toBe(0);
    const contents = giftContents(world.seed, swapped.tick);
    expect(opened.notice).toEqual({ t: "giftOpened", contents });
    for (const part of contents) {
      expect(countOf(opened.bag, part.what)).toBe(countOf(swapped.bag, part.what) + part.count);
    }
  });

  it("SH6: about four in five are ordinary, and every one is a real item", () => {
    const common = new Set(["potion", "superpotion", "hyperpotion"]);
    let rare = 0;
    const N = 4000;
    for (let tick = 0; tick < N; tick++) {
      const contents = giftContents(SEED, tick);
      expect(contents.length).toBeGreaterThan(0);
      for (const part of contents) expect(isItem(part.what), part.what).toBe(true);
      const ordinary = contents.every((part) => common.has(part.what) || item(part.what).kind === "berry");
      if (!ordinary) rare++;
    }
    expect(Math.abs((rare / N) * 100 - GIFT_RARE_PERCENT)).toBeLessThan(3);
  });
});

describe("the Ability Tutor", () => {
  it("SH7: eight on the board; one leaves and one arrives every thousand steps", () => {
    const now = tutorBoard(SEED, 4200);
    const later = tutorBoard(SEED, 4200 + TUTOR_STEP);
    expect(now).toHaveLength(TUTOR_OFFERS);
    expect(later.slice(0, TUTOR_OFFERS - 1).map((one) => one.n)).toEqual(now.slice(1).map((one) => one.n));
    for (const offer of now) {
      expect(ABILITIES.some((one) => one.id === offer.abilityId)).toBe(true);
      expect(offer.price[0].what).toBe("money");
      expect(offer.price).toHaveLength(4);
      for (const part of offer.price.slice(1)) expect(isItem(part.what), part.what).toBe(true);
      expect(offer.closesAt).toBeGreaterThan(4200);
    }
  });

  /** A bag and a purse that pay for this offer exactly. */
  function paying(offer: TutorOffer): Partial<GameState> {
    const bag: Record<string, number> = {};
    let money = 0;
    for (const part of offer.price) {
      if (part.what === "money") money = part.count;
      else bag[part.what] = part.count;
    }
    return { bag, money };
  }

  it("SH8: leaving a pupil pays the price, and it comes back knowing the ability after 2,500 steps", () => {
    const offer = tutorBoard(SEED, 0)[0];
    const pupil = { ...plain(11), abilities: [] };
    const { world, state } = facing("ability-tutor", [plain(10), pupil], paying(offer));

    const left = applyInput(world, state, { t: "tutorLeave", n: offer.n, index: 1, confirm: 11 });
    expect(left.party).toHaveLength(1);
    expect(left.money).toBe(0);
    expect(Object.keys(left.bag)).toHaveLength(0);
    expect(left.tutoring).toMatchObject({ abilityId: offer.abilityId, since: 0 });

    expect(tutorTakeRefusal(world, { ...left, stepsTaken: TUTOR_STAY - 1 })).toMatch(/still learning — 1 steps/);
    const back = applyInput(world, { ...left, stepsTaken: TUTOR_STAY }, { t: "tutorTake" });
    expect(back.tutoring).toBeNull();
    expect(back.party.at(-1)!.uid).toBe(11);
    expect(back.party.at(-1)!.abilities).toEqual([offer.abilityId]);
  });

  it("SH9: refuses a pupil it cannot teach, a price you cannot pay, and a second pupil", () => {
    const offer = tutorBoard(SEED, 0)[1];
    const other = ABILITIES.filter((one) => one.id !== offer.abilityId).map((one) => one.id);
    const knows = { ...plain(11), abilities: [offer.abilityId] };
    const full = { ...plain(12), abilities: other.slice(0, MAX_ABILITIES) };
    const { world, state } = facing("ability-tutor", [plain(10), knows, full], paying(offer));

    expect(tutorLeaveRefusal(world, state, offer.n, 1, 11)).toBe("it already has that one");
    expect(tutorLeaveRefusal(world, state, offer.n, 2, 12)).toBe(`nobody learns more than ${MAX_ABILITIES}`);
    expect(tutorLeaveRefusal(world, { ...state, money: 0 }, offer.n, 0, 10)).toMatch(/^you need ¤/);
    expect(tutorLeaveRefusal(world, state, 9999, 0, 10)).toBe("that one is not on the board any more");
    expect(tutorLeaveRefusal(world, state, offer.n, 0, 10)).toBeNull();

    const busy = { ...state, tutoring: { creature: plain(50), abilityId: offer.abilityId, since: 0 } };
    expect(tutorLeaveRefusal(world, busy, offer.n, 0, 10)).toBe("he already has a pupil");
  });
});
