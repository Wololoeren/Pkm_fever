import { pickAbilities } from "./abilities";
import { ALL_SPECIES, baseFormOf, species as speciesById } from "./dex";
import { rollGender } from "./gender";
import { NATURE_IDS } from "./natures";
import { intBelow, intBetween, rngFor } from "./rng";
import type { Individual } from "./types";

/**
 * The auction house.
 *
 * Six lots on the board at once, each closing on a step count. Lot `n` closes
 * when the player has taken `AUCTION_STEP · (n + 1)` steps and goes up on the
 * board `AUCTION_OPEN` steps before that — so at any moment the board holds
 * six, closing about a thousand steps apart, and whenever the soonest one
 * closes a new one appears with the full six thousand to run.
 *
 * Everything about a lot is named from the seed and its number, so two players
 * on the same seed see the same board at the same step count, and a replay
 * sees the same one again. Winning is a coin, named the same way.
 */

/** Steps between one lot closing and the next. */
export const AUCTION_STEP = 1000;

/** How long a lot is on the board, in steps. */
export const AUCTION_OPEN = 6000;

/** How many lots are up at once. */
export const AUCTION_LOTS = AUCTION_OPEN / AUCTION_STEP;

/**
 * The room, in four numbers.
 *
 * A lot opens at `AUCTION_OPENING` of what it is worth and creeps upward:
 * every `AUCTION_TICK` steps somebody in the room may raise by
 * `AUCTION_RAISE`, and the chance they do is `AUCTION_KEEN * price / ask` —
 * so the cheaper the lot looks, the likelier somebody wants it.
 *
 * That shape is chosen rather than a flat chance, and it is worth saying why:
 * the expected *gain* per tick is `chance * raise * ask`, and with the chance
 * inversely proportional to the ask the two cancel. So the ask walks up a
 * straight line, at `AUCTION_DRIFT` of the lot's worth per tick, whatever it
 * has already reached — and the four numbers are chosen to make that line
 * arrive: thirty ticks is the six thousand steps a lot is on the board, and
 * 30% + 30 x (70/30)% is the full price at the hammer.
 *
 * Which makes bidding a question about timing rather than about money. Bid
 * early and it is a third of the price and somebody will certainly outbid you
 * before it closes; bid late and it costs near what the thing is worth, with
 * no time left for the room to answer. The median lot hammers at about 94% of
 * its price and one in ten goes over it, because a room that could never
 * exceed the number on the tag would be a shop with a countdown.
 */
export const AUCTION_OPENING = 30;
export const AUCTION_TICK = 200;
export const AUCTION_RAISE = 10;
/**
 * The keenness of the room, in tenths of a percent of the price, per tick:
 * the chance of a raise is this much of `price / ask`. 233 with a raise of a
 * tenth is a drift of 70/30 of a percent a tick, which is the whole 70 points
 * from the opening to the price across a lot's life.
 */
export const AUCTION_KEEN = 233;
/** What that works out to per tick, in hundredths of a percent of the price. */
export const AUCTION_DRIFT = (AUCTION_KEEN * AUCTION_RAISE) / 10;

/**
 * What a board holds. The manifest's catch rates are not the classic ones
 * (Dratini is 194 here), so "hard to catch" cannot pick these out. Instead:
 *
 * - **exotic**: the first form of a line that grows into something strong —
 *   a final form with a base total of 530 or more. The starters, the
 *   pseudo-legendaries, Dratini, Larvitar, Gible and their like.
 * - **legendary**: a first form in the Undiscovered egg group with a base
 *   total of 570 or more, which is the legends and the mythicals and not the
 *   babies.
 */
const total = (id: string) => Object.values(speciesById(id).base).reduce((sum, stat) => sum + stat, 0);
const peak = (id: string, depth = 0): number =>
  depth > 6 ? 0 : Math.max(total(id), ...speciesById(id).evolvesTo.map((step) => peak(step.id, depth + 1)));
const FIRST_FORMS = ALL_SPECIES.filter((entry) => baseFormOf(entry.id) === entry.id);
const EXOTIC: readonly string[] = FIRST_FORMS.filter(
  (entry) => !entry.eggGroups.includes("Undiscovered") && entry.evolvesTo.length > 0 && peak(entry.id) >= 530,
)
  .map((entry) => entry.id)
  .sort();
const LEGENDARY: readonly string[] = FIRST_FORMS.filter(
  (entry) => entry.eggGroups.includes("Undiscovered") && total(entry.id) >= 570,
)
  .map((entry) => entry.id)
  .sort();

/** How often a lot is a legend, in percent. */
export const AUCTION_LEGEND_PERCENT = 30;

export interface Lot {
  /** Its number, which is also its name. */
  n: number;
  speciesId: string;
  /** What it looks like. Plain today; here so the board never has to assume. */
  variantId: string;
  level: number;
  price: number;
  /** The step count it closes at. */
  closesAt: number;
}

/** Lot `n`, as it always is. */
export function lot(seed: string, n: number): Lot {
  const rng = rngFor(seed, "auction", n);
  const legendary = intBelow(rng, 100) < AUCTION_LEGEND_PERCENT;
  const pool = legendary ? LEGENDARY : EXOTIC;
  const speciesId = pool[intBelow(rng, pool.length)];
  const level = intBetween(rng, 10, 30);
  // Very expensive, and two and a half times that for a legend.
  const raw = (20000 + level * 1500) * (legendary ? 2.5 : 1);
  return {
    n,
    speciesId,
    variantId: "normal",
    level,
    price: Math.round(raw / 500) * 500,
    closesAt: AUCTION_STEP * (n + 1),
  };
}

/** The six lots on the board at this step count, soonest first. */
export function board(seed: string, stepsTaken: number): Lot[] {
  const first = Math.floor(stepsTaken / AUCTION_STEP);
  return Array.from({ length: AUCTION_LOTS }, (_, at) => lot(seed, first + at));
}

/** The step a lot goes up on the board. */
export function opensAt(spec: Lot): number {
  return Math.max(0, spec.closesAt - AUCTION_OPEN);
}

/** How many times the room has had a chance to raise this lot by now. */
export function ticksOf(spec: Lot, stepsTaken: number): number {
  const until = Math.min(stepsTaken, spec.closesAt);
  return Math.max(0, Math.floor((until - opensAt(spec)) / AUCTION_TICK));
}

/**
 * What lot `n` is going for at this step count.
 *
 * Walked forward from the opening rather than solved, because each raise
 * changes the odds of the next one: thirty steps of arithmetic at most, all
 * of it named off the seed, so the board reads the same on every machine and
 * the same again in a replay.
 */
export function askingPrice(seed: string, n: number, stepsTaken: number): number {
  const spec = lot(seed, n);
  let ask = Math.round((spec.price * AUCTION_OPENING) / 100);
  const ticks = ticksOf(spec, stepsTaken);
  for (let tick = 0; tick < ticks; tick++) {
    if (!raises(seed, n, tick, spec.price, ask)) continue;
    ask = Math.round((ask * (100 + AUCTION_RAISE)) / 100);
  }
  return ask;
}

/** Whether the room raised on this tick. */
function raises(seed: string, n: number, tick: number, price: number, ask: number): boolean {
  const keen = Math.min(1000, Math.floor((AUCTION_KEEN * price) / Math.max(1, ask)));
  return intBelow(rngFor(seed, "auction-raise", n, tick), 1000) < keen;
}

/** The chance, in per mille, that the room raises in the next `AUCTION_TICK` steps. */
export function keenness(price: number, ask: number): number {
  return Math.min(1000, Math.floor((AUCTION_KEEN * price) / Math.max(1, ask)));
}

/**
 * The creature in lot `n`, bare: no moves, no health, no uid. The engine fills
 * those in on delivery, the way it does for every arrival.
 */
export function lotCreature(seed: string, n: number): Individual {
  const spec = lot(seed, n);
  const rng = rngFor(seed, "auction-creature", n);
  const iv = () => intBetween(rng, 8, 20);
  return {
    uid: 0,
    speciesId: spec.speciesId,
    level: spec.level,
    exp: spec.level * spec.level * spec.level,
    ivs: { hp: iv(), atk: iv(), def: iv(), spa: iv(), spd: iv(), spe: iv() },
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    natureId: NATURE_IDS[intBelow(rng, NATURE_IDS.length)],
    variantId: spec.variantId,
    hp: 0,
    status: null,
    sleepTurns: 0,
    moves: [],
    pp: [],
    // Something worth the money: always one ability.
    abilities: pickAbilities(rng, 1),
    heldItem: null,
    nickname: null,
    caughtBy: "Auction House",
    traded: true,
    prize: false,
    cheat: false,
    parents: null,
    gender: rollGender(rng),
  };
}
