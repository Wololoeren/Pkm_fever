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
 * that version's rules or is refused, never silently reinterpreted.
 *
 * 24 is the seventeen moves that carry a cost to their own user — Close
 * Combat, Superpower, Overheat and fourteen more. They had none, so any
 * recorded battle in which one of them landed resolves differently from here.
 *
 * 23 is multi-strike. Thirty-one moves that landed once now land two to five
 * times, three of them roll accuracy for every blow, and five always crit — so
 * a recorded battle with a Fury Swipes in it resolves differently, and one
 * with a Frost Breath in it resolves differently even where the count has not
 * changed. The per-blow rolls are suffixed tags, so the *first* blow of
 * everything rolls exactly what it always rolled; that is what keeps the
 * change to the thirty-one rather than to every move in the game.
 *
 * 22 is the Grey Line. Nothing about the *rules* changed — but people are
 * solid, and twenty-four new ones standing on the map move the tiles every
 * other person was placed on and block ground that used to be open, so a
 * recorded walk can step into a conversation where it used to take a step.
 * That is a log that replays differently, which is exactly what this number
 * is for: without the bump an old save falls through the corrupt-log path and
 * quietly starts a new game, which is the silent reinterpretation the comment
 * above promises never happens. Adding anybody to the roster is a bump.
 *
 * 25 is the trainer school: four people in Hearth's house, which is the rule
 * above applied.
 *
 * 26 is the field. Twenty-four abilities joined the roll, and a roll that
 * lands on Drought today landed on something else yesterday.
 *
 * 27 is the move flags. Two-turn moves now spend a turn charging, beams spend
 * the turn after recovering, twenty-eight moves flinch, ten bind, four
 * rampage, Rollout doubles and Bide gives back what it took. Every one of
 * those changes what a recorded turn comes to — a Hyper Beam that used to hit
 * every turn now hits every other one — so a log recorded before this replays
 * to a different battle, which is precisely what this number exists to
 * refuse. It also adds named rolls (`-bind`, `-rage`), and a battle that draws
 * one more number from the stream diverges from that point on whatever else
 * agrees.
 *
 * 28 is the trainer's policy. Everybody who is not the grass now picks a move
 * by searching for it rather than by rolling for one, and a trainer battle in a
 * log recorded under 27 is a battle against a different opponent — same
 * team, different choices, different result. The grass still rolls, so a
 * save that never fought a person would replay; the version cannot tell
 * which saves those are, so it refuses all of them.
 *
 * 29 is the evolution being asked about. Growth reports what is *ready* and
 * stops; the answer is an input; a save carries the unanswered ones. So a log
 * recorded under 28 is a log with no answers in it, and replaying it would
 * evolve everything it ever grew past — which is exactly the silent
 * reinterpretation this number exists to refuse. It is also the trainers
 * moving: route trainers now stand clear of doorways and of anywhere they
 * would wall a route off, and a recorded walk steps into a battle where it
 * used to take a step. And Explosion, Self-Destruct and Memento now take
 * their user down with them, which decides battles that used to be won.
 *
 * 30 is the rival gaining on you. He was a flat three levels above your party
 * average every time; he is now level with you the first time he catches you
 * and two further ahead at each meeting after. Every recorded rival battle
 * from the second one on is therefore a battle against a different team, and
 * the first one is a battle against a weaker one.
 *
 * 31 is the two new marks a creature can carry — `prize` and `cheat` — and
 * the `prize` input that puts a bracket's reward in a save. Neither mark is in
 * the state hash and an old log contains no prize input, so a save written
 * under 30 replays to exactly the same game. The bump is for the *file*: a
 * save from 30 has no `cheat` field on anything in it, so every creature in it
 * would read as honestly earned — including one conjured out of the menu
 * before the mark existed. Refusing them is the only reading that does not
 * quietly launder the saves this was built to catch.
 *
 * 32 is three things that all add state a save from 31 does not carry: the
 * printer (`lastWild` and `printedAt`), the six brackets out in the fields
 * (`arena`), and the seven inks now lying in cabins. The inks are the reason
 * this is not optional — they are placed during world generation, so a world
 * built under 31 has different things in its cabins and a recorded walk picks
 * up something else.
 *
 * 33 is experience being shared. Everybody who stood opposite the creature
 * that went down takes a cut of what it was worth, so every battle a save ever
 * recorded in which anything was switched out ends with a differently levelled
 * party — which is most of them.
 *
 * Folded into the same number, unreleased: Brenn the smith. Adding anybody to
 * the roster is a bump by the rule above — people are solid and move the tiles
 * everyone else was placed on — and 33 had not reached anybody's saves yet.
 *
 * Also folded in: the testing bench's prize draw now reads the world seed, so
 * a recorded `prize` cheat takes a different creature than it did.
 *
 * 34 changes what several recorded inputs do. An egg takes three hundred steps
 * rather than a hundred and twenty, and taking one puts it in the bag to walk
 * for 250–2500 steps and be opened with the new `hatch` input, rather than
 * putting the creature straight into the party. The rival first comes at move
 * 500 rather than on the first step. Running from a wild creature is rolled on
 * the level gap rather than on speed. And a thrown Great or Ultra Ball uses its
 * own catch rate instead of a Poké Ball's. Any one of these replays a 33 log
 * into a different game.
 *
 * 35 is sleep costing the turns it says. The counter woke a creature when it
 * reached one and let it move, so every sleep was a turn shorter than rolled
 * and a third of them were nothing; a recorded battle with a sleep in it
 * resolves differently now. Folded in, unreleased: Hex and Infernal Parade
 * doubling against a target with a condition, and Transform being undone when
 * the creature leaves the field or the battle ends (a caught or owned Ditto
 * used to keep whatever it had copied). Also folded in: the box's named tabs
 * (`boxNames`, `boxOf` and three inputs), and three found breeding items that
 * raise the mutation rate — found on arrival at places that used to give
 * nothing, so a recorded walk now picks them up. And the daycare kit: pairing
 * and hatching items that shorten both waits, incubators, and five more
 * found places. And thirty-odd moves that read the situation — Venoshock,
 * Facade, Brine, Knock Off, Revenge, Payback, Eruption, Stored Power, the
 * terrain moves, False Swipe, Freeze-Dry, Flying Press, Foul Play, Body Press,
 * Psyshock, Sacred Sword, Dream Eater, Sucker Punch and more — every one of
 * which used to be its flat base power or always worked. And the Exp. Share,
 * handed over when anybody first reaches level 40, which changes who levels in
 * any battle fought after. */
export const ENGINE_VERSION = 35;

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
  /**
   * Whether this was won in a bracket rather than raised.
   *
   * The same hole as `traded` and marked for the same reason: the three on
   * offer are rolled from the tournament that produced them, and a tournament
   * happened in other people's browsers. The save records which of the three
   * was taken, carried whole, because there is no seed here it could be
   * derived from.
   *
   * A separate field rather than a second meaning for `traded`, because they
   * are different claims about where a creature came from and a check-in desk
   * may well feel differently about them: a trade is somebody else's raising,
   * and a prize is the game's own.
   */
  prize: boolean;
  /**
   * Whether a testing shortcut made or altered this one.
   *
   * `GameState.cheated` already says a save touched the menu, and that is a
   * fact about the *log*: it cannot say which creature. Trading a cheated
   * level 50 into a clean save carries the creature and leaves the flag
   * behind, so the receiving log is honestly not cheated and the team is
   * still impossible.
   *
   * This is the half that travels with the thing. Set by `give`, and by every
   * shortcut that edits one in place — a wild creature whose level was set to
   * 100 was not caught at 100. Like `traded` and `prize` it is never cleared:
   * an origin that could be washed off by passing a creature between two
   * saves would not be worth recording.
   */
  cheat: boolean;
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
