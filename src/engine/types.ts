import type { Gender } from "./gender";

import { BIOME_IDS } from "./biomes";

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
export const ENGINE_VERSION = 19;

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
  /**
   * Uses left in each move slot, in step with `moves`.
   *
   * Spent by attacking and restored only by a full restore of the party. See
   * pp.ts for why there is no bottle that refills it.
   */
  pp: number[];
  /**
   * What this individual can do that its species cannot, sorted.
   *
   * A property of the creature rather than of the species, and almost always
   * empty — see abilities.ts for why that is the whole design and not a
   * placeholder.
   */
  abilities: string[];
  /**
   * What it is carrying, or null.
   *
   * One item, and it belongs to the creature rather than to the bag — which
   * is what makes a held item a decision. The bag is where things wait; this
   * is where one of them is doing something.
   *
   * Kept as an id rather than a spec for the same reason `moves` and
   * `abilities` are ids: the save is a log of inputs replayed through the
   * rules, and an embedded copy of an item's numbers would be a second
   * version of the catalogue that a rules change could not reach.
   *
   * A berry taken during a battle sets this to null on the creature *inside*
   * the battle, and the party comes back out of the battle, so it is gone
   * afterwards without anything having to carry the news across.
   */
  heldItem: string | null;
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
  /**
   * How many difficulty bands the world is graded into.
   *
   * This used to be how many rings out the world extended, which was the same
   * number as "how hard the far edge is" because the world was a star and
   * distance was the only axis it had. It is a graph now: how far out anywhere
   * is varies with the seed, so difficulty is that distance stretched onto a
   * fixed number of bands — the nearest hop is always band 1 and the furthest
   * place in any world is always the last one. See `bandOf` in layout.ts.
   */
  rings: number;
  /**
   * The kinds of place the world is built out of.
   *
   * Not corridors any more, and not one each: how many copies of each the
   * world holds is the biome's tier, and fifty places are dealt out of these
   * twenty kinds. See `placesWanted` in biomes.ts.
   */
  biomes: string[];
}

export const DEFAULT_WORLD: WorldConfig = {
  engineVersion: ENGINE_VERSION,
  /**
   * Eight bands, because a world comes out seven to ten hops across and eight
   * is the middle of that — so a band is about one hop, and the curve is not
   * being stretched or squashed hard on any seed.
   */
  rings: 8,
  /**
   * Twenty kinds of place, dealt into fifty, and the list lives in biomes.ts
   * so that a place is one row rather than three.
   *
   * Every one of the twenty is settled now. It used to be four with everything
   * on them and sixteen empty, which was honest about how they arrived and a
   * waste of sixteen places: the gyms, the people, the one-off items and the
   * Cup are spread across the whole roster, so a biome you have not seen is a
   * biome that might have somebody in it.
   */
  biomes: [...BIOME_IDS],
};
