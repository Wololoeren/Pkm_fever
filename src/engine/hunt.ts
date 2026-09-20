import { pickAbilities } from "./abilities";
import { ALL_SPECIES, species as speciesById } from "./dex";
import { rollGender } from "./gender";
import { levelForRing } from "./levels";
import { NATURE_IDS } from "./natures";
import { intBelow, intBetween, rngFor } from "./rng";
import { clampIvs, IV_MAX } from "./stats";
import { STAT_IDS, type Individual, type StatTable } from "./types";

/**
 * The hunter, and the thing he points you at.
 *
 * He keeps a board of five: a creature worth having, and where it was last
 * seen. Take one and it is *out there* — a real animal walking a real loop on
 * that route, which you have eight hundred steps to reach before it moves on
 * and the board forgets it. One at a time, because a hunt you can stack is a
 * shopping list.
 *
 * What makes it worth the walk is the breeding: every one of his is bred
 * rather than dealt, `HUNT_IV_MIN` to the cap in every stat, which is better
 * than anything the grass will ever hand you.
 */

/** How many are on the board. */
export const HUNT_OFFERS = 5;

/** How long the board holds the same five. */
export const HUNT_ROTATION = 1500;

/** How long you have, once you have taken one. */
export const HUNT_STEPS = 800;

/** The worst IV one of his can have. */
export const HUNT_IV_MIN = 20;

/** Out of how many steps the quarry moves rather than hesitating, per mille. */
export const QUARRY_CHANCE = 900;

export interface HuntOffer {
  /** Which of the five, for the input that takes it. */
  index: number;
  speciesId: string;
  level: number;
  ivs: StatTable;
  abilities: string[];
  natureId: string;
  /** Where it was last seen. */
  routeId: string;
}

/** Which board this is: the five turn over every `HUNT_ROTATION` steps. */
export function huntRound(stepsTaken: number): number {
  return Math.floor(stepsTaken / HUNT_ROTATION);
}

/** Five, from the seed and the round, so two players on a seed see the same board. */
export function huntBoard(seed: string, round: number, routes: readonly { id: string; ring: number }[]): HuntOffer[] {
  const open = routes.filter((route) => route.ring >= 1).sort((a, b) => a.id.localeCompare(b.id));
  if (!open.length) return [];

  return Array.from({ length: HUNT_OFFERS }, (_, index) => {
    const rng = rngFor(seed, "hunt", round, index);
    const route = open[intBelow(rng, open.length)];
    const kind = ALL_SPECIES[intBelow(rng, ALL_SPECIES.length)];
    // Around what the route holds, a little above it: he does not find you
    // something you could have walked into yourself.
    const level = Math.max(3, levelForRing(route.ring) + intBetween(rng, 0, 4));
    const ivs = {} as StatTable;
    for (const stat of STAT_IDS) ivs[stat] = intBetween(rng, HUNT_IV_MIN, IV_MAX);

    return {
      index,
      speciesId: kind.id,
      level,
      ivs: clampIvs(ivs),
      abilities: pickAbilities(rng, intBetween(rng, 1, 2)),
      natureId: NATURE_IDS[intBelow(rng, NATURE_IDS.length)],
      routeId: route.id,
    };
  });
}

/** The creature an offer is, bare: the engine fills in uid, moves and health. */
export function huntCreature(offer: HuntOffer, uid: number): Individual {
  return {
    uid,
    speciesId: offer.speciesId,
    level: offer.level,
    exp: offer.level * offer.level * offer.level,
    ivs: { ...offer.ivs },
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    natureId: offer.natureId,
    variantId: "normal",
    hp: 0,
    status: null,
    sleepTurns: 0,
    moves: [],
    pp: [],
    abilities: [...offer.abilities],
    heldItem: null,
    nickname: null,
    caughtBy: null,
    traded: false,
    prize: false,
    cheat: false,
    parents: null,
    gender: rollGender(rngFor("hunt-gender", offer.speciesId, offer.index, offer.level)),
  };
}

/** A hunt in progress. The creature is rebuilt from the offer, never stored twice. */
export interface Hunt {
  offer: HuntOffer;
  /** The step count it was taken on: the clock, and the seed of its path. */
  since: number;
  /** How far along its loop it is. It walks away from you; see `quarryAt`. */
  walked: number;
}

/** How many steps are left, or 0 when it has gone. */
export function huntLeft(hunt: Hunt | null, stepsTaken: number): number {
  return hunt ? Math.max(0, hunt.since + HUNT_STEPS - stepsTaken) : 0;
}

/** Whether the quarry moves on this step rather than hesitating. */
export function quarryMoves(seed: string, hunt: Hunt, tick: number): boolean {
  return intBelow(rngFor(seed, "quarry", hunt.since, tick), 1000) < QUARRY_CHANCE;
}

/** A line for the board: what it is and where. */
export function huntLine(offer: HuntOffer, routeLabel: string): string {
  const total = STAT_IDS.reduce((sum, stat) => sum + offer.ivs[stat], 0);
  return `${speciesById(offer.speciesId).name} Lv${offer.level} · ${total}/186 IVs · ${routeLabel}`;
}
