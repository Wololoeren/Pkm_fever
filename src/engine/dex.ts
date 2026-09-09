import learnsetData from "../data/learnsets.json";
import moveData from "../data/moves.json";
import speciesData from "../data/species.json";
import starterData from "../data/starters.json";
import typeData from "../data/types.json";
import type { SpeciesEntry, StatusId } from "./types";

/**
 * The generated manifest, and the only place the engine touches it.
 *
 * Everything downstream asks this module rather than importing the JSON, so
 * swapping the roster — a different generation, a different bestiary entirely —
 * is a change to scripts/build-dex.mjs and nothing else.
 */

export type StageStat = "atk" | "def" | "spa" | "spd" | "spe";
export type Boosts = Partial<Record<StageStat, number>>;

export interface Secondary {
  /** Percent. */
  chance: number;
  status: StatusId | null;
  boosts: Boosts | null;
  /** Whether the boosts land on the user rather than the target. */
  self: boolean;
}

export interface MoveEntry {
  id: string;
  name: string;
  type: string;
  category: "physical" | "special" | "status";
  power: number;
  /** 0 means "never misses". */
  accuracy: number;
  pp: number;
  priority: number;
  critRatio: number;
  target: string;
  status: StatusId | null;
  boosts: Boosts | null;
  secondary: Secondary | null;
  /** [numerator, denominator] of damage dealt, healed back. */
  drain: [number, number] | null;
  /** [numerator, denominator] of damage dealt, taken as recoil. */
  recoil: [number, number] | null;
  /** [numerator, denominator] of max HP restored. */
  heal: [number, number] | null;
}

export const ALL_SPECIES = speciesData as unknown as SpeciesEntry[];
export const ALL_MOVES = moveData as unknown as MoveEntry[];

const LEARNSETS = learnsetData as unknown as Record<string, [number, string][]>;

/**
 * Attacker type against defender type, in quarters: 4 is neutral, 8 super
 * effective, 2 resisted, 0 immune. Inverted from Showdown's defender-side
 * table at build time so the engine asks it the way the question arises.
 */
const TYPE_CHART = typeData as unknown as Record<string, Record<string, number>>;

/**
 * How much a move of `attackType` is multiplied against a defender, in
 * quarters. Two types multiply, and the smallest result two types can produce
 * is 1 — a quarter — so the arithmetic stays exact in integers.
 */
export function effectiveness(attackType: string, defenderTypes: readonly string[]): number {
  const row = TYPE_CHART[attackType];
  if (!row) return 4;

  let quarters = 4;
  for (const defending of defenderTypes) {
    quarters = Math.floor((quarters * (row[defending] ?? 4)) / 4);
  }
  return quarters;
}

const SPECIES_BY_ID = new Map(ALL_SPECIES.map((entry) => [entry.id, entry]));
const MOVES_BY_ID = new Map(ALL_MOVES.map((entry) => [entry.id, entry]));

export function species(id: string): SpeciesEntry {
  const found = SPECIES_BY_ID.get(id);
  if (!found) throw new Error(`unknown species: ${id}`);
  return found;
}

export function move(id: string): MoveEntry {
  const found = MOVES_BY_ID.get(id);
  if (!found) throw new Error(`unknown move: ${id}`);
  return found;
}

export function learnset(speciesId: string): [number, string][] {
  return LEARNSETS[speciesId] ?? [];
}

/**
 * Child to parent, inverted once from the manifest's evolvesTo.
 *
 * The manifest records evolution the way the game asks it — what does this
 * become — so breeding, which asks the opposite, needs the reverse. Built
 * here rather than stored, because two representations of one relation drift.
 */
const PREVO = new Map<string, string>();
for (const entry of ALL_SPECIES) {
  for (const evolution of entry.evolvesTo) {
    if (!PREVO.has(evolution.id)) PREVO.set(evolution.id, entry.id);
  }
}

/**
 * The starter trios, one row per generation, one column per type.
 *
 * Curated in scripts/build-dex.mjs, because "is a starter" is a designer's
 * decision rather than anything derivable: a heuristic over three-stage lines
 * and base stat totals offers Beldum and Klink, which are neither.
 */
export const STARTER_TYPES: readonly string[] = starterData.types;
export const STARTER_TRIOS: readonly (readonly string[])[] = starterData.trios;

/** Every starter of one type, across every generation. */
export function startersOfType(type: string): string[] {
  const column = STARTER_TYPES.indexOf(type);
  if (column < 0) return [];
  return STARTER_TRIOS.map((trio) => trio[column]).filter((id) => SPECIES_BY_ID.has(id));
}

/** The bottom of this species' evolution line — what an egg hatches into. */
export function baseFormOf(speciesId: string): string {
  let current = speciesId;
  // Cycles are not supposed to exist, but a malformed manifest should not hang
  // the game; the line is never deeper than a handful of stages.
  for (let step = 0; step < 8; step++) {
    const previous = PREVO.get(current);
    if (!previous) break;
    current = previous;
  }
  return current;
}

/**
 * The four moves a creature of this species and level knows.
 *
 * The last four it would have learned, which is what a wild encounter and a
 * freshly given starter both want. Deterministic and order-stable: the
 * learnset is sorted at build time, so this is the same list everywhere.
 */
export function movesAtLevel(speciesId: string, level: number): string[] {
  const known = learnset(speciesId)
    .filter(([at]) => at <= level)
    .map(([, moveId]) => moveId);

  // Nothing learnable this early happens for a handful of species; a creature
  // with no moves at all would be a soft-lock in a battle, so fall back to the
  // earliest thing it ever learns.
  if (!known.length) {
    const first = learnset(speciesId)[0];
    return first ? [first[1]] : [];
  }
  return known.slice(-4);
}
