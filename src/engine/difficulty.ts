import { WILD_ABILITY_ODDS, type AbilityOdds } from "./abilities";
import { EV_MAX_PER_STAT, EV_MAX_TOTAL } from "./stats";
import { STAT_IDS, type StatTable } from "./types";

/**
 * How hard the world is, chosen once and then never again.
 *
 * Five presets rather than a row of switches, because every switch is a
 * question the player has to answer before they have played, and four of the
 * six interesting ones only make sense together. What a preset holds is a set
 * of numbers the rest of the engine already reads: levels, effort, IVs, held
 * items, abilities, purses, catch odds and what a whiteout costs.
 * No new system, and nothing that changes what a move does — a Brutal run is
 * the same game against people who trained.
 *
 * It is the first input of the run and it lives in the log, so a save replays
 * on the difficulty it was played at and cannot be turned down halfway.
 *
 * The one knob that is *not* here is experience. Slowing the curve makes a
 * run longer rather than harder, and this game is long enough.
 */
export interface Difficulty {
  id: string;
  name: string;
  /** One line, for the card on the start screen. */
  blurb: string;

  // --- gym leaders
  /** Added to every gym's base level. */
  gymBase: number;
  /** What each badge already won adds to every gym still standing. */
  gymPerBadge: number;
  /** Extra creatures beyond the gym's own team size. */
  gymTeam: number;
  /** Every IV of everything a gym fields. */
  gymIv: number;
  /** Effort points a gym's creatures have spent, out of 510. */
  gymEv: number;
  /** Whether a gym's creatures carry something. */
  gymHeld: boolean;
  /**
   * What a gym's creatures are born with — see `rollAbilities`.
   *
   * The one knob here that is not a number going up: a leader on Fever Dream
   * fields nothing without an ability and mostly things with two. It is also
   * the knob with the widest blast radius, because an ability can change what
   * a matchup *is* rather than how long it takes, which is why it climbs from
   * the wild odds rather than starting somewhere ambitious.
   */
  gymAbilities: AbilityOdds;

  // --- the people on the routes, and the rival
  /** Added to every route trainer's levels. */
  trainerLevels: number;
  /** Extra creatures beyond the team the world dealt them. */
  trainerTeam: number;
  trainerIv: number;
  /** Effort points a route trainer's creatures have spent, out of 510. */
  trainerEv: number;
  trainerHeld: boolean;

  // --- the rest of the world
  /** Added to every wild level. */
  wildLevels: number;
  /** What a purse is worth, in per-mille. */
  moneyMille: number;
  /** What a ball is worth, in per-mille. */
  catchMille: number;
  /**
   * What waking up at the Centre costs, as per-mille of your money.
   *
   * Money, and never a fee at the counter: a Centre that charged would be a
   * Centre a broke player with a fainted party could not use, and that is a
   * softlock rather than a difficulty.
   */
  whiteoutMille: number;
}

/**
 * The five, hardest last.
 *
 * Normal is every number the game shipped with, so a Normal run is bit-for-bit
 * the game as it was before difficulty existed — which is what makes it safe
 * to be the default for every save that never chose.
 *
 * The step from Brutal upwards is mostly effort and IVs rather than levels.
 * Levels are a wall you climb by grinding; a fully trained team is a wall you
 * climb by building one of your own, and that is the harder and the better
 * question. By Fever Dream everything you meet is spread like a Cup entrant.
 */
export const DIFFICULTIES: readonly Difficulty[] = [
  {
    id: "normal",
    name: "Normal",
    blurb: "The world as it is. Gyms grow with your badges, everybody else stands where they were dealt.",
    gymBase: 0,
    gymPerBadge: 3,
    gymTeam: 0,
    gymIv: 20,
    gymEv: 0,
    gymAbilities: WILD_ABILITY_ODDS,
    gymHeld: false,
    trainerLevels: 0,
    trainerTeam: 0,
    trainerIv: 8,
    trainerEv: 0,
    trainerHeld: false,
    wildLevels: 0,
    moneyMille: 1000,
    catchMille: 1000,
    whiteoutMille: 0,
  },
  {
    id: "hard",
    name: "Hard",
    blurb: "Everyone is a few levels above you and has done some training. Purses are thinner and balls catch less.",
    gymBase: 3,
    gymPerBadge: 5,
    gymTeam: 1,
    gymIv: 24,
    gymEv: 120,
    gymAbilities: { one: 400, two: 80, three: 0 },
    gymHeld: false,
    trainerLevels: 4,
    trainerTeam: 1,
    trainerIv: 14,
    trainerEv: 60,
    trainerHeld: false,
    wildLevels: 2,
    moneyMille: 600,
    catchMille: 800,
    whiteoutMille: 100,
  },
  {
    id: "brutal",
    name: "Brutal",
    blurb: "Gym leaders field a full trained team with abilities and items, the grass is four levels up, and losing costs a quarter of your money.",
    gymBase: 6,
    gymPerBadge: 7,
    gymTeam: 1,
    gymIv: 27,
    gymEv: 252,
    gymAbilities: { one: 550, two: 200, three: 20 },
    gymHeld: true,
    trainerLevels: 6,
    trainerTeam: 1,
    trainerIv: 20,
    trainerEv: 160,
    trainerHeld: false,
    wildLevels: 4,
    moneyMille: 350,
    catchMille: 600,
    whiteoutMille: 250,
  },
  {
    id: "merciless",
    name: "Merciless",
    blurb: "Two extra bodies on every team, near-perfect stats, abilities and items on everything, and a third of your money gone every time you go down.",
    gymBase: 9,
    gymPerBadge: 8,
    gymTeam: 2,
    gymIv: 29,
    gymEv: 380,
    gymAbilities: { one: 500, two: 350, three: 100 },
    gymHeld: true,
    trainerLevels: 8,
    trainerTeam: 2,
    trainerIv: 26,
    trainerEv: 300,
    trainerHeld: true,
    wildLevels: 5,
    moneyMille: 250,
    catchMille: 500,
    whiteoutMille: 350,
  },
  {
    id: "fever",
    name: "Fever Dream",
    blurb: "Perfect IVs, the full 510 spent, an ability on everything a gym fields, ten levels up, and half your money every time you go down. Nobody out there is playing.",
    gymBase: 12,
    gymPerBadge: 10,
    gymTeam: 2,
    gymIv: 31,
    gymEv: 510,
    gymAbilities: { one: 300, two: 450, three: 250 },
    gymHeld: true,
    trainerLevels: 10,
    trainerTeam: 2,
    trainerIv: 31,
    trainerEv: 460,
    trainerHeld: true,
    wildLevels: 6,
    moneyMille: 150,
    catchMille: 400,
    whiteoutMille: 500,
  },
];

export const DEFAULT_DIFFICULTY = "normal";

const BY_ID = new Map(DIFFICULTIES.map((one) => [one.id, one]));

/** The preset, or Normal for anything that does not name one. */
export function difficulty(id: string | null | undefined): Difficulty {
  return BY_ID.get(id ?? DEFAULT_DIFFICULTY) ?? BY_ID.get(DEFAULT_DIFFICULTY)!;
}

export function isDifficulty(id: string): boolean {
  return BY_ID.has(id);
}

/** Where a preset sits in the list, for anything that wants to compare two. */
export function difficultyRank(id: string | null | undefined): number {
  const at = DIFFICULTIES.findIndex((one) => one.id === (id ?? DEFAULT_DIFFICULTY));
  return at < 0 ? 0 : at;
}

/**
 * A budget of effort, spent the way somebody who meant it would spend it.
 *
 * The same shape as the Cup's spread — everything into the two stats the
 * species is best at, the remainder into the third — but taking a budget,
 * because the difference between Hard and Fever Dream is how much training
 * the thing across the field has actually done. Derived from base stats
 * rather than authored, so it stays true for every species in the dex and
 * for whatever is added to it later.
 *
 * Ties break on the canonical stat order, so the same species is built the
 * same way on every machine.
 */
export function effortFor(base: StatTable, budget: number): StatTable {
  const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } as StatTable;
  let left = Math.max(0, Math.min(EV_MAX_TOTAL, Math.floor(budget)));
  if (!left) return evs;

  const ranked = [...STAT_IDS].sort(
    (a, b) => base[b] - base[a] || STAT_IDS.indexOf(a) - STAT_IDS.indexOf(b),
  );

  for (const stat of ranked) {
    if (left <= 0) break;
    const give = Math.min(EV_MAX_PER_STAT, left);
    evs[stat] = give;
    left -= give;
  }
  return evs;
}

/**
 * What a gym leader or a trained route trainer is carrying.
 *
 * A short list of the things that actually change a fight rather than the
 * whole holdable shelf: nothing here evolves anything, and nothing here is
 * worth stealing a run over, so a Thief off a Brutal gym is a fair prize
 * rather than a reason to farm one.
 */
export const FOE_HELD_ITEMS: readonly string[] = [
  "hold-leftovers",
  "hold-focussash",
  "hold-quickclaw",
  "hold-scopelens",
  "hold-muscleband",
  "hold-wiseglasses",
  "hold-expertbelt",
  "hold-shellbell",
  "berry-sitrus",
  "berry-lum",
];
