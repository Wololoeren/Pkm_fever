import { species as speciesById } from "./dex";
import { ITEMS } from "./items";
import { intBelow, rngFor } from "./rng";
import type { Individual } from "./types";

/**
 * The berry farm.
 *
 * Three jobs, one type each: a Water type on the watering, a Ground type on
 * the ploughing, a Grass type on the pollinating. None of them is optional —
 * a field that is watered and never ploughed grows nothing — so the farm
 * stands idle until all three are working, and then it produces on its own
 * while you walk, like everything else in this game that takes time.
 *
 * What it grows is up to you. Five beds; plant a berry in one and that bed
 * grows that berry. A bed you have left empty grows whatever it likes, out of
 * every berry in the game — which is the only way to see some of them, and the
 * reason to leave a bed fallow rather than filling all five with Orans.
 *
 * The three workers set the pace: `FARM_BASE` steps between harvests, less
 * their levels added together. Three level-fifties bring a harvest every two
 * hundred steps; three level-hundreds would bring one every `FARM_FASTEST`,
 * which is the floor, because a farm that harvested every step would be a
 * button rather than a farm.
 */

export type FarmJob = "water" | "ground" | "grass";

export const FARM_JOBS: readonly FarmJob[] = ["water", "ground", "grass"];

/** What each of them is doing, for the panel. */
export const FARM_WORK: Record<FarmJob, string> = {
  water: "watering the beds",
  ground: "ploughing the beds",
  grass: "pollinating the beds",
};

/** How many beds there are. */
export const FARM_BEDS = 5;

/** How many berries one harvest brings. */
export const FARM_YIELD = 5;

/** The steps between harvests, before the workers' levels come off it. */
export const FARM_BASE = 350;

/** However good the workers, a harvest is never quicker than this. */
export const FARM_FASTEST = 25;

/** Every berry the game has, sorted, for a bed left to its own devices. */
export const ALL_BERRIES: readonly string[] = ITEMS.filter((spec) => spec.kind === "berry")
  .map((spec) => spec.id)
  .sort();

export interface FarmState {
  /** Who is on each job, or null. */
  hands: Record<FarmJob, { creature: Individual } | null>;
  /** What is planted in each bed: a berry id, or null for a fallow one. */
  beds: (string | null)[];
  /** Steps since the last harvest. */
  steps: number;
  /** How many harvests this farm has brought in, which names each one's roll. */
  harvests: number;
  /** What is waiting to be collected. It piles up until you come for it. */
  basket: Record<string, number>;
}

export function emptyFarm(): FarmState {
  return {
    hands: { water: null, ground: null, grass: null },
    beds: Array.from({ length: FARM_BEDS }, () => null),
    steps: 0,
    harvests: 0,
    basket: {},
  };
}

/** Whether all three jobs are filled, which is when anything grows at all. */
export function farmWorking(farm: FarmState): boolean {
  return FARM_JOBS.every((job) => farm.hands[job]);
}

/** The three workers' levels added together. */
export function farmHands(farm: FarmState): number {
  return FARM_JOBS.reduce((sum, job) => sum + (farm.hands[job]?.creature.level ?? 0), 0);
}

/** How many steps one harvest takes with the hands it has. */
export function farmEvery(farm: FarmState): number {
  return Math.max(FARM_FASTEST, FARM_BASE - farmHands(farm));
}

/** How many steps until the next harvest, or null when nothing is growing. */
export function farmLeft(farm: FarmState): number | null {
  return farmWorking(farm) ? Math.max(0, farmEvery(farm) - farm.steps) : null;
}

/** Which berry the next harvest brings: a bed's own, or anything at all from a fallow one. */
export function farmPicks(seed: string, farm: FarmState): string {
  const rng = rngFor(seed, "farm", farm.harvests);
  const bed = farm.beds[intBelow(rng, Math.max(1, farm.beds.length))] ?? null;
  return bed ?? ALL_BERRIES[intBelow(rng, ALL_BERRIES.length)];
}

/** Whether this creature is the right sort for this job. */
export function farmSuits(creature: Individual, job: FarmJob): boolean {
  return speciesById(creature.speciesId).types.includes(job);
}

/** How much is waiting, in total. */
export function basketCount(basket: Record<string, number>): number {
  return Object.values(basket).reduce((sum, count) => sum + count, 0);
}
