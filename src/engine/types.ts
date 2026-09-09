import type { Gender } from "./gender";

/**
 * The vocabulary the whole engine is written in.
 *
 * Two rules hold everywhere below, and both exist to keep replay bit-exact:
 * every number is an integer, and nothing here carries a reference to
 * anything that renders. If a type in this file ever needs a DOM node or a
 * timestamp, something has gone wrong upstream of it.
 */

/** Bumped whenever a rule changes in a way that would replay an old save
 * differently. Saves record it; a save from a different version replays under
 * that version's rules or is refused, never silently reinterpreted. */
export const ENGINE_VERSION = 9;

// ------------------------------------------------------------------ stats

export type StatId = "hp" | "atk" | "def" | "spa" | "spd" | "spe";

/** Fixed order. Iterate this rather than Object.keys anywhere the result
 * feeds a hash — key order is stable in practice, but leaning on it is the
 * kind of assumption that breaks a save file two years from now. */
export const STAT_IDS: readonly StatId[] = ["hp", "atk", "def", "spa", "spd", "spe"];

/** The five stats a nature may move. HP is never one of them. */
export const BATTLE_STAT_IDS: readonly Exclude<StatId, "hp">[] = ["atk", "def", "spa", "spd", "spe"];

export type StatTable = Record<StatId, number>;

export function zeroStats(): StatTable {
  return { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
}

// ------------------------------------------------------------------ species

export type TypeId =
  | "normal" | "fire" | "water" | "electric" | "grass" | "ice"
  | "fighting" | "poison" | "ground" | "flying" | "psychic" | "bug"
  | "rock" | "ghost" | "dragon" | "dark" | "steel" | "fairy";

/**
 * One row of the species manifest.
 *
 * Nothing in the engine ever names a species literally — everything goes
 * through this table, loaded from generated data. That indirection is what
 * makes the roster a swappable file rather than a rewrite.
 */
export interface SpeciesEntry {
  /** Stable key, e.g. "bulbasaur". */
  id: string;
  /** National dex number, for ordering and display only. */
  num: number;
  name: string;
  types: TypeId[];
  base: StatTable;
  /**
   * What this species can become. `method` is the dex's own evolution type —
   * "level" for a plain level-up, "useItem", "levelFriendship" and so on.
   * Only "level" is acted on today; the rest are carried so that the item
   * system does not need the manifest regenerated to arrive.
   */
  evolvesTo: { id: string; level: number; method: string; item: string | null }[];
  /** Egg groups, for breeding compatibility. */
  eggGroups: string[];
  /** Move ids learnable by level-up, as [level, moveId] pairs, sorted. */
  learnset: [number, string][];
  /** Both derived at build time — see scripts/build-dex.mjs for why neither
   * can simply be copied from the dex. */
  catchRate: number;
  baseExp: number;
  /** PokeAPI's sprite id, which is the dex number except for regional forms.
   * Rendering asks for this, never `num`. */
  spriteNum: number;
}

export type { Gender };

/** The five conditions the battle system models. */
export type StatusId = "brn" | "psn" | "par" | "slp" | "frz";

// ------------------------------------------------------------------ individuals

/**
 * One creature, as it exists in a party or a box.
 *
 * `uid` is assigned from the world seed plus a monotonic counter, never from
 * a clock or a random source, so two clients replaying the same log give the
 * same creature the same identity — which is what lets breeding derive its
 * roll from parent identity.
 */
export interface Individual {
  uid: number;
  speciesId: string;
  level: number;
  /** Total experience earned, not progress toward the next level. Storing the
   * total means a level is always recomputable from one number, so a change to
   * the curve cannot leave a creature stranded between two levels. */
  exp: number;
  ivs: StatTable;
  evs: StatTable;
  natureId: string;
  variantId: string;
  /** Current HP. Full stats are derived, never stored — see stats.ts. */
  hp: number;
  /** Persists outside battle, as it does in the games it resembles. */
  status: StatusId | null;
  /** Turns of sleep left to serve. Meaningless unless status is "slp". */
  sleepTurns: number;
  moves: string[];
  /** Nickname, or null to display the species name. */
  nickname: string | null;
  /** Which egg produced it, or null for a wild catch. Breeding reads this. */
  parents: [number, number] | null;
  gender: Gender;
  /**
   * Whether this arrived from another player's world.
   *
   * A save is a seed and a list of inputs, and replaying it is what proves a
   * team was earned. A traded creature cannot be derived from *your* seed — it
   * came from somebody else's — so the trade input carries it whole. The save
   * still replays; it just no longer proves this one. Marked so a tournament
   * can decide whether it cares.
   */
  traded: boolean;
}

// ------------------------------------------------------------------ world

export interface WorldConfig {
  engineVersion: number;
  /** How many rings out from the hub the world extends. */
  rings: number;
  /** Biome corridors radiating from the hub. */
  biomes: string[];
}

export const DEFAULT_WORLD: WorldConfig = {
  engineVersion: ENGINE_VERSION,
  rings: 6,
  biomes: ["meadow", "pinewood", "ashflats", "marsh"],
};
