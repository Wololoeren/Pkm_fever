import { ABILITIES } from "./abilities";
import { ITEMS } from "./items";
import { intBelow, intBetween, rngFor } from "./rng";
import type { Individual } from "./types";
import { variant } from "./variants";

/**
 * The three people who shape abilities.
 *
 * - **The Colour Collector** takes a creature wearing a colour and pays in
 *   Chroma Candy, which is worth nothing anywhere else.
 * - **The Ability Tutor** keeps a board of eight abilities, one replaced every
 *   thousand steps like the auction's lots, each priced in a mix of money and
 *   materials — Chroma Candy among them. Leave a creature with him and it
 *   learns the ability 2,500 steps later.
 * - **The Gift Swapper** takes any creature for a Secret Gift, which opens
 *   into something ordinary most of the time and something good now and then.
 *
 * Everything here is pure: named from the seed and a number, so a replay and
 * another player on the same seed see the same board and open the same gifts.
 */

/** The Chroma Candy item. */
export const CHROMA_CANDY = "chromacandy";
/** The Secret Gift item. */
export const SECRET_GIFT = "secretgift";

/**
 * What the Colour Collector pays for this creature, in candy. Nothing for one
 * with no colour; otherwise one, and one more for every shine rung it has —
 * a shiny in a colour is six.
 */
export function chromaCandyFor(creature: Individual): number {
  const form = variant(creature.variantId);
  return form.chromaId ? 1 + form.tier : 0;
}

/** Steps between one offer leaving the board and the next arriving. */
export const TUTOR_STEP = 1000;
/** How many abilities are on the board at once. */
export const TUTOR_OFFERS = 8;
/** How long a creature stays with the tutor to learn, in steps. */
export const TUTOR_STAY = 2500;

/** One line of what an offer costs: an item and how many, or money. */
export interface PricePart {
  /** An item id, or "money". */
  what: string;
  count: number;
}

export interface TutorOffer {
  /** Its number, which is also its name. */
  n: number;
  abilityId: string;
  /** Money first, then items. Always money and three materials. */
  price: PricePart[];
  /** The step count it leaves the board at. */
  closesAt: number;
}

const STONES: readonly string[] = ITEMS.filter((spec) => spec.kind === "stone").map((spec) => spec.id).sort();
const BERRIES: readonly string[] = ITEMS.filter((spec) => spec.kind === "berry").map((spec) => spec.id).sort();
const MACHINES: readonly string[] = ITEMS.filter((spec) => spec.kind === "tm").map((spec) => spec.id).sort();

/** Offer `n`, as it always is. */
export function tutorOffer(seed: string, n: number): TutorOffer {
  const rng = rngFor(seed, "tutor", n);
  const abilityId = ABILITIES[intBelow(rng, ABILITIES.length)].id;

  const materials: PricePart[] = [
    { what: "pearl", count: intBetween(rng, 1, 3) },
    { what: CHROMA_CANDY, count: intBetween(rng, 1, 4) },
    { what: "glitter", count: intBetween(rng, 1, 3) },
    { what: STONES[intBelow(rng, STONES.length)], count: 1 },
    { what: BERRIES[intBelow(rng, BERRIES.length)], count: intBetween(rng, 2, 5) },
  ];
  // Three of the five, in a fixed order so the price reads the same way every time.
  const kept = new Set<number>();
  while (kept.size < 3) kept.add(intBelow(rng, materials.length));

  return {
    n,
    abilityId,
    price: [
      { what: "money", count: intBetween(rng, 10, 40) * 500 },
      ...materials.filter((_, at) => kept.has(at)),
    ],
    closesAt: TUTOR_STEP * (n + 1),
  };
}

/** The eight offers on the board at this step count, soonest to leave first. */
export function tutorBoard(seed: string, stepsTaken: number): TutorOffer[] {
  const first = Math.floor(stepsTaken / TUTOR_STEP);
  return Array.from({ length: TUTOR_OFFERS }, (_, at) => tutorOffer(seed, first + at));
}

/** The chance a Secret Gift is one of the good ones, in percent: one in five. */
export const GIFT_RARE_PERCENT = 20;

/**
 * What the Secret Gift opened on this tick holds.
 *
 * Four in five: potions or berries. One in five: a stone, pearls, Chroma
 * Candy, Glitter or a machine.
 */
export function giftContents(seed: string, tick: number): PricePart[] {
  const rng = rngFor(seed, "secret-gift", tick);
  if (intBelow(rng, 100) >= GIFT_RARE_PERCENT) {
    switch (intBelow(rng, 4)) {
      case 0:
        return [{ what: "potion", count: intBetween(rng, 2, 3) }];
      case 1:
        return [{ what: "superpotion", count: 1 }];
      case 2:
        return [{ what: "hyperpotion", count: 1 }];
      default:
        return [{ what: BERRIES[intBelow(rng, BERRIES.length)], count: intBetween(rng, 2, 4) }];
    }
  }
  switch (intBelow(rng, 5)) {
    case 0:
      return [{ what: STONES[intBelow(rng, STONES.length)], count: 1 }];
    case 1:
      return [{ what: "pearl", count: intBetween(rng, 1, 2) }];
    case 2:
      return [{ what: CHROMA_CANDY, count: intBetween(rng, 1, 2) }];
    case 3:
      return [{ what: "glitter", count: 1 }];
    default:
      return [{ what: MACHINES[intBelow(rng, MACHINES.length)], count: 1 }];
  }
}
