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

/** The chance a bid wins, in percent. */
export const AUCTION_WIN_PERCENT = 50;

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

/** Whether a bid on lot `n` won. Decided the moment it closes, and the same forever. */
export function bidWins(seed: string, n: number): boolean {
  return intBelow(rngFor(seed, "auction-win", n), 100) < AUCTION_WIN_PERCENT;
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
