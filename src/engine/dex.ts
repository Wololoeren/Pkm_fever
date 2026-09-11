import { actsOnSomething } from "./statusmoves";
import learnsetData from "../data/learnsets.json";
import machineData from "../data/machines.json";
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
  /**
   * How many times it lands: [least, most], inclusive, or null for once.
   *
   * A fixed count comes through as a pair with both halves equal, so the
   * engine reads one shape rather than two — Double Kick is `[2, 2]` and Fury
   * Swipes is `[2, 5]`. Null rather than `[1, 1]` for the other seven hundred
   * and eighty-nine, because absent is how everything optional in this
   * manifest says "nothing to see", and a field that said `[1, 1]` on every
   * row would be a field nobody reads.
   */
  multihit: [number, number] | null;
  /**
   * Whether accuracy is checked again for every blow rather than once.
   *
   * Three moves: Triple Kick, Triple Axel and Population Bomb. It is what
   * stops a ten-hit move at ninety percent accuracy from being two hundred
   * base power every single time — the chance of all ten landing is 0.9^10,
   * which is about one swing in three.
   */
  multiaccuracy: boolean;
  /**
   * Whether it always lands a critical hit.
   *
   * Five moves: Frost Breath, Storm Throw, Wicked Blow, Flower Trick and
   * Surging Strikes. Their whole identity, and until this field existed they
   * critted one time in twenty-four like anything else.
   */
  alwaysCrit: boolean;
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

/** Every type in the chart, sorted. The ability families are built over it, so
 * a chart with a new type in it grows them without being edited. */
export const TYPE_NAMES: readonly string[] = Object.keys(TYPE_CHART).sort();

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

/**
 * What this species learns, and when — minus anything that would do nothing.
 *
 * The one gate, because every road to a moveset comes through here:
 * `movesAtLevel` deals a wild encounter and a trainer's team, `learnableAt`
 * offers the player their four, `progression.ts` walks it on level-up, the Cup
 * builds from it and the Inspect panel lists it. Filtering in five places is
 * five places to forget.
 *
 * What it removes is measured in statusmoves.ts: 129 of the manifest's status
 * moves carry an effect this engine has no machinery for — weather, terrain,
 * hazards, move restriction, move calling, item swapping, or a second ally to
 * aim at — and every one of them used to be dealt out anyway. **635 of 1134
 * species walked around with at least one slot that did nothing**, and
 * Togekiss's four were Wish, Yawn, Encore and Bestow: a creature whose entire
 * moveset was scenery, which could do nothing at all but Struggle.
 *
 * A move is not dropped for being *weak* or situational, only for being unable
 * to change the battle at all. Splash stays, because doing nothing is what
 * Splash is for and `statusmoves.ts` says so out loud.
 *
 * Cached per species: the filter asks `actsOnSomething` once per entry, and a
 * save asks about the same handful of species thousands of times.
 */
const liveLearnsets = new Map<string, [number, string][]>();

export function learnset(speciesId: string): [number, string][] {
  const held = liveLearnsets.get(speciesId);
  if (held) return held;

  const all = LEARNSETS[speciesId] ?? [];
  const live = all.filter(([, moveId]) => {
    const found = MOVES_BY_ID.get(moveId);
    return found !== undefined && actsOnSomething(found);
  });

  // The floor. Nothing in the dex actually needs it now that Transform and
  // Sketch are honoured — Ditto and Smeargle were the only two species whose
  // whole learnset was a single inert move — but a creature with no moves at
  // all is a battle nobody can act in, and that is not a thing to leave
  // depending on a table in another file staying the way it is.
  const kept = live.length ? live : all;
  liveLearnsets.set(speciesId, kept);
  return kept;
}

/** Everything the manifest lists, filter and all. For the guard that measures
 * what the filter is doing. */
export function rawLearnset(speciesId: string): [number, string][] {
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
 * Everything this species has naturally learned by this level.
 *
 * The pool a player chooses their four from. Level-up moves only — a move
 * tutor or a machine is a different system with a different economy, and
 * neither exists yet.
 */
export function learnableAt(speciesId: string, level: number): string[] {
  const seen = new Set<string>();
  for (const [at, moveId] of learnset(speciesId)) {
    if (at <= level) seen.add(moveId);
  }
  return [...seen];
}

/**
 * Moves that exist only on a machine, and which species will take each one.
 *
 * Stored as one sorted table of moves plus a bitset per species, because the
 * relation is sixty-nine thousand pairs — several megabytes as lists of
 * strings, and seventy-eight kilobytes as bits. Decoded lazily: a save only
 * ever asks about the handful of species it is carrying.
 */
const MACHINES = machineData as { moves: string[]; learners: Record<string, string> };

/**
 * Every move a machine can teach, sorted. This is the TM list.
 *
 * Filtered the same way a learnset is, and it has to be: `items.ts` builds one
 * purchasable item per entry, so an unhonoured move here is a machine on the
 * Mart's shelf, at four thousand a go, that teaches a creature to waste a turn.
 */
export const MACHINE_MOVES: readonly string[] = MACHINES.moves.filter((id) => {
  const found = MOVES_BY_ID.get(id);
  return found !== undefined && actsOnSomething(found);
});

const MACHINE_INDEX = new Map(MACHINES.moves.map((id, at) => [id, at]));
const decodedBits = new Map<string, Uint8Array>();

function machineBits(speciesId: string): Uint8Array | null {
  const held = decodedBits.get(speciesId);
  if (held) return held;

  const packed = MACHINES.learners[speciesId];
  if (packed === undefined) return null;

  const binary = atob(packed);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
  decodedBits.set(speciesId, bytes);
  return bytes;
}

/** Whether a machine will teach this move to this species. */
export function canLearnMachine(speciesId: string, moveId: string): boolean {
  // Asked before the bitset, so the answer agrees with MACHINE_MOVES: a list
  // that offers a machine and a predicate that refuses it is a purchase the
  // player cannot use.
  const spec = MOVES_BY_ID.get(moveId);
  if (!spec || !actsOnSomething(spec)) return false;

  const at = MACHINE_INDEX.get(moveId);
  if (at === undefined) return false;

  const bits = machineBits(speciesId);
  if (!bits) return false;
  return (bits[at >> 3] & (1 << (at & 7))) !== 0;
}

/** Every machine move this species will take, sorted. */
export function machinesFor(speciesId: string): string[] {
  return MACHINE_MOVES.filter((moveId) => canLearnMachine(speciesId, moveId));
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
