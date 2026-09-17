import { TYPE_NAMES, type StageStat } from "./dex";
import type { TerrainId, WeatherId } from "./field";
import { intBelow, type Rng } from "./rng";
import type { StatusId } from "./types";

/**
 * Abilities, and the one decision that makes them this game's rather than
 * borrowed: they are not a property of a species.
 *
 * Everywhere else, an ability is the third thing a Pokédex entry tells you —
 * Charizard has Blaze, and that is that. Here it is a property of the
 * individual, rolled when the creature is made, and almost nothing has one.
 * Eighty-nine in a hundred wild creatures have none at all, ten have one, and
 * one in a hundred has two. That does three things the species-linked version
 * cannot:
 *
 *  - It makes a wild catch worth *looking* at. A Rattata is a Rattata, until
 *    the one you just caught turns out to carry Adaptability.
 *  - It gives breeding a second axis to work on, beside stats and appearance,
 *    and one that stacks: half of each parent's abilities pass down, up to
 *    three, so a line can be built toward a combination nothing in the world
 *    was born with.
 *  - It keeps the census honest. Rarity here is already a property of a place
 *    rather than a die roll; an ability is the one thing that is genuinely
 *    rolled, and holding it to one in ten is what stops that undermining
 *    everything else.
 *
 * The effects are a small closed set of shapes rather than a function each.
 * A callback per ability is how a battle engine becomes a place where anything
 * might happen; a shape means the battle asks a handful of questions — "does
 * anything change this multiplier?" — and every ability answers one of them.
 * Anything that needs a shape this game does not have is written down in
 * docs/abilities-deferred.md rather than approximated, because an ability that
 * half works is worse than one that visibly does not exist yet.
 */

/**
 * Everything an ability or a held item can do, as a closed set of shapes.
 *
 * `AbilityEffect` is this intersected with an optional condition, below, so
 * any shape may be narrowed to particular species without eighteen of them
 * having to declare a field they will never use.
 */
type EffectShape =
  /** Same-type attack bonus becomes this instead of 1.5, in per-mille. */
  | { t: "stab"; mille: number }
  /** Its own attacks are multiplied, under a condition. */
  | { t: "power"; when: PowerWhen; mille: number; type?: string; move?: string }
  /** Immune to a type, and healed by a share of its own maximum. */
  | { t: "absorb"; type: string; share: number }
  /** Immune to a type, full stop. */
  | { t: "immune"; type: string }
  /** Damage from these types is multiplied. */
  | { t: "ward"; types: readonly string[]; mille: number }
  /** Damage from anything super effective is multiplied. */
  | { t: "cushion"; mille: number }
  /** Its own attacks that are resisted are multiplied. */
  | { t: "pierce"; mille: number }
  /** A stat is multiplied, under a condition. */
  | { t: "stat"; stat: StatKey; when: StatWhen; mille: number }
  /** These stages cannot be lowered by anybody else. */
  | { t: "hold"; stats: readonly StageStat[] }
  /** This status never sticks. */
  | { t: "ignore"; status: StatusId }
  /** Secondary effects of moves used on it never fire. */
  | { t: "unfazed" }
  /** Its own accuracy is multiplied; 0 means it cannot miss. A `when` of
   * "late" is the Zoom Lens: worth having only when it moves second. */
  | { t: "aim"; mille: number; when?: "always" | "late" }
  /** Critical hit ratio, raised by this many stages. */
  | { t: "luck"; stages: number }
  /** Status moves go this much earlier. */
  | { t: "quick"; plus: number }
  /**
   * One hit that would have finished it leaves it standing.
   *
   * `mille` makes it a chance rather than a certainty, and `whole` is whether
   * it has to have been at full health to begin with. Sturdy and a Focus Sash
   * are the certain, full-health kind; a Focus Band is the one that might.
   */
  | { t: "endure"; mille?: number; whole?: boolean }
  /** Knocking something out raises a stage. */
  | { t: "spoils"; stat: StageStat; delta: number }
  /** Coming out lowers a stage of whatever is across from it. */
  | { t: "arrival"; stat: StageStat; delta: number }
  /** Switching out heals a share of its maximum. */
  | { t: "mend"; share: number }
  /** Switching out clears whatever ails it. */
  | { t: "shake" }
  /** Recoil never applies to it. */
  | { t: "reckless" }
  /** Normal and Fighting reach Ghost. */
  | { t: "reach" }
  // -------------------------------------------------------------------------
  // The shapes below arrived with held items. Nothing forbids an ability from
  // using one — the vocabulary is shared on purpose — but none does yet,
  // and every one of them is here because an item asked a question the battle
  // was not already asking.
  // -------------------------------------------------------------------------
  /** Its own attacks that are super effective are multiplied. The mirror of
   * `cushion`, which scales them coming the other way. */
  | { t: "sharp"; mille: number }
  /** The *other* side's accuracy against it is multiplied. Not `aim`, which
   * is about its own. */
  | { t: "graze"; mille: number }
  /**
   * A share of its maximum, at the end of every turn.
   *
   * One over `share`, healed. `only` narrows it to a list of types and turns
   * it into damage for everything else, which is the whole of what separates
   * Black Sludge from Leftovers.
   */
  | { t: "tick"; share: number; only?: readonly string[] }
  /** A share of the damage it just dealt, healed back. */
  | { t: "siphon"; share: number }
  /** A share of its own maximum, paid every time it attacks. */
  | { t: "toll"; share: number }
  /** Whatever damages it with a move of this category loses a share of its
   * own maximum. Not contact — the manifest carries no contact flag, so the
   * only honest version of this is the one that reads a category. */
  | { t: "barb"; share: number; category: "physical" | "special" }
  /** This often, in per-mille, it moves first regardless of speed. */
  | { t: "gamble"; mille: number }
  /** At the end of the turn, it gives itself this. */
  | { t: "afflict"; status: StatusId }
  /** Taking a super-effective hit raises these stages. */
  | { t: "policy"; stats: readonly StageStat[]; delta: number }
  /** It cannot use status moves at all. */
  | { t: "silent" }
  /** One move only, for as long as it stays out. */
  | { t: "locked" }
  /** Experience it earns is multiplied. */
  | { t: "study"; mille: number }
  /**
   * A share of what a beaten creature was worth, for sitting it out: the
   * Exp. Share. Paid to a holder that did not fight, in per-mille of the
   * whole prize, with the effort that goes with it.
   */
  | { t: "share"; mille: number }
  /** Money won from a trainer is multiplied. */
  | { t: "purse"; mille: number }
  /** It will not evolve, by any road. */
  | { t: "anchor" }
  /** Effort it earns is multiplied, and which stat it is steered into. */
  | { t: "regimen"; mille: number; stat?: StageStat | "hp" }
  /** Inherited stat slots, for a pairing — the Heirloom's shape, as an item
   * something can carry rather than one applied to the daycare. */
  | { t: "lineage"; slots: number }
  /** Nothing in battle: a perk read by the social media cabin, the pageant, the paparazzo or Dr. Couch. See `hasPerk`. */
  | { t: "perk"; perk: SocialPerk }
  /** Its attacks of one of these two types become the other: a Grass move goes out Fire, a Fire move Grass. */
  | { t: "swap"; types: [string, string] }
  /** A pageant item: this much on stage for a carrier of one of these types. Nothing in battle. */
  | { t: "pageant"; types: string[]; bonus: number }
  /**
   * An IV scale, for a pairing: every egg gets `amount` more in `up` and
   * `amount` less in `down`, kept inside nought and the cap. For builds that
   * want a stat as low as it will go — a slow Trick Room sweeper, a Foul Play
   * target with no Attack — as much as for ones that want it high.
   */
  | { t: "tilt"; up: "hp" | "atk" | "def" | "spa" | "spd" | "spe"; down: "hp" | "atk" | "def" | "spa" | "spd" | "spe"; amount: number }
  /**
   * Health back, once, when it falls below one over `below` of its maximum.
   *
   * `share` heals one over that many of its maximum; `amount` heals a flat
   * number. Exactly one of the two, because an Oran Berry is ten points and a
   * Sitrus Berry is a quarter, and expressing the flat one as a share would
   * make it a different item on every creature.
   */
  | { t: "snack"; below: number; share?: number; amount?: number }
  /** A stage, once, when it falls below one over `below` of its maximum. */
  | { t: "pinch"; below: number; stat: StageStat; delta: number }
  /** Clears a condition the moment it lands. Without `status`, any of them. */
  | { t: "cure"; status?: StatusId }
  /**
   * One super-effective hit of these types is multiplied, and that is that.
   *
   * Not `ward`, which scales a type *always* and is what Thick Fat and
   * Heatproof are. The eighteen resist berries are the other thing: they wait
   * for the hit that was going to hurt, take the edge off that one, and are
   * gone. Expressing them as `ward` made them permanent halves that were
   * never spent, which is two bugs wearing one shape.
   */
  | { t: "soften"; types: readonly string[]; mille: number }
  /** Whatever damages it with a move of this category raises these stages.
   * Kee and Maranga: `barb` with a boost instead of a bite. */
  | { t: "brace"; stats: readonly StageStat[]; delta: number; category: "physical" | "special" }
  /** A super-effective hit heals it a share of its maximum. The Enigma Berry,
   * which is the only thing here that is *paid* for being hit. */
  | { t: "solace"; share: number }
  /** Running from a wild battle always works. */
  | { t: "bolt" }
  /** Drain moves return this much more, in per-mille. */
  | { t: "roots"; mille: number }
  // -------------------------------------------------------------------------
  // The field. Weather and terrain arrived as one feature, and these are the
  // questions it added: setting one on arrival, and reading one for a stat,
  // a heal, a cure, a miss, a multiplier or a refusal.
  // -------------------------------------------------------------------------
  /** Coming out brings a weather or a terrain with it. */
  | { t: "summon"; weather?: WeatherId; terrain?: TerrainId }
  /** A stat multiplied while one of these weathers is up. */
  | { t: "weatherStat"; weather: readonly WeatherId[]; stat: StageStat; mille: number }
  /** A stat multiplied while this terrain is up and it is grounded. */
  | { t: "terrainStat"; terrain: TerrainId; stat: StageStat; mille: number }
  /** A share of its maximum back at the end of every turn in these weathers. */
  | { t: "weatherMend"; weather: readonly WeatherId[]; share: number }
  /** Its condition cleared at the end of every turn in these weathers. */
  | { t: "weatherCure"; weather: readonly WeatherId[] }
  /** The other side's accuracy against it multiplied in these weathers. */
  | { t: "weatherGraze"; weather: readonly WeatherId[]; mille: number }
  /** Its own attacks of these types multiplied in these weathers. */
  | { t: "weatherPower"; weather: readonly WeatherId[]; types: readonly string[]; mille: number }
  /** No condition sticks to it in these weathers. */
  | { t: "weatherGuard"; weather: readonly WeatherId[] }
  /** While it is in battle, weather has no effect. */
  | { t: "calm" }
  /** Every stage change to it counts double. */
  | { t: "simple" }
  // -------------------------------------------------------------------------
  // Who it is rather than what it does in a turn: a type lost or gained, a
  // nature felt harder, and something turned up on the walk.
  // -------------------------------------------------------------------------
  /** In battle it does not have this type. */
  | { t: "lack"; type: string }
  /** In battle it has this type as well as its own. */
  | { t: "affinity"; type: string }
  /**
   * Its nature counts for more, in per-mille of the usual term.
   *
   * `plus` scales the raised stat's bonus and `minus` the lowered stat's
   * cost, so a nature can be felt harder in one direction only.
   */
  | { t: "temper"; plus: number; minus: number }
  /** Every `FORAGE_EVERY` steps walked in the party, it turns up one of these items, each equally likely. */
  | { t: "forage"; items: readonly string[]; rare?: { item: string; perMille: number } };

/**
 * One shape, plus who it is for.
 *
 * The condition is on the union rather than inside it because it is orthogonal
 * to what the effect does — a Thick Club is `stat` for a Cubone and a Light
 * Ball is `power` for a Pikachu, and neither shape should have to know that
 * some items are species-specific.
 */
export type AbilityEffect = EffectShape & { for?: EffectFor };

/** When a `power` effect applies. */
export type PowerWhen =
  /** Always. */
  | "always"
  /** The move's own power is 60 or less. */
  | "weak"
  /** The move costs its user recoil. */
  | "costly"
  /** Below a third of its maximum health, and the move matches `type`. */
  | "cornered"
  /** It is the last to move this turn. */
  | "late"
  /** The move matches `type`, whatever its health. Every type-enhancing item
   * is this shape, which is why they needed no new question asked. */
  | "typed"
  /** The move is physical. */
  | "physical"
  /** The move is special. */
  | "special"
  /** The move is exactly `move`. The class abilities, each built around one attack. */
  | "signature";

/** When a `stat` effect applies. */
export type StatWhen =
  | "always"
  | "statused"
  | "hurt"
  /** It still has somewhere to evolve to. Eviolite's question, and the reason
   * "fully evolved" is asked of the bestiary rather than stored. */
  | "unfinished";

/** Attack and Special Attack together are "offence"; the rest are their own. */
export type StatKey = StageStat | "offence";

/**
 * A condition an effect can carry, narrowing who it works for.
 *
 * Only held items use it, and only because a whole family of them is built
 * this way: a Thick Club does nothing at all unless a Cubone is holding it,
 * and a Light Ball is a Pikachu's item. Expressing that as a condition on the
 * effect keeps it one shape — the alternatives are a dozen near-identical
 * shapes or a dozen special cases in battle.ts, and both are worse than a list
 * of names on the effect that wants one.
 */
export interface EffectFor {
  /** Only these species. Ids, as the bestiary spells them. */
  species?: readonly string[];
}

/**
 * Whether an effect carrying a condition applies to this species.
 *
 * Lives here rather than in battle.ts so there is one answer: the condition is
 * part of the vocabulary, and a second reading of it elsewhere is a second
 * reading to keep in step. An effect with no condition always applies, which
 * is nearly all of them.
 */
export function effectApplies(effect: { for?: EffectFor }, speciesId: string): boolean {
  const only = effect.for?.species;
  return !only || only.includes(speciesId);
}

export interface AbilitySpec {
  id: string;
  name: string;
  blurb: string;
  effect: AbilityEffect;
}

/**
 * The three families, one entry per type.
 *
 * This is the diversifying the brief invited, and it is the part that turns a
 * borrowed list into a system. Blaze, Torrent, Overgrow and Swarm are the same
 * ability wearing four types, and the games only ever shipped four of them
 * because only four starters needed one. With abilities rolled rather than
 * assigned there is no reason for the other fourteen types to go without, and
 * every reason not to: a Rock type that gets stronger when cornered is exactly
 * as interesting as a Fire one, and a table that covers every type is a table
 * with no arbitrary holes in it to explain.
 *
 * Names follow the canon where the canon has one, so somebody who knows Blaze
 * finds Blaze. The rest are built to the same pattern.
 */
const CORNERED_NAMES: Record<string, string> = {
  fire: "Blaze",
  water: "Torrent",
  grass: "Overgrow",
  bug: "Swarm",
};

/**
 * A canon name is used only where the canon *mechanic* is the same.
 *
 * Volt Absorb and Water Absorb are immunity plus a quarter healed, which is
 * exactly this shape. Flash Fire and Sap Sipper are immunity plus a boost, and
 * Dry Skin is immunity to one type and a weakness to another — different
 * things, so they do not get to borrow those names. Calling a plain absorber
 * "Flash Fire" would teach somebody who knows the games something false, which
 * is worse than an unfamiliar name.
 */
const ABSORB_NAMES: Record<string, string> = {
  electric: "Volt Absorb",
  water: "Water Absorb",
};

const WARD_NAMES: Record<string, string> = {
  fire: "Heatproof",
};

/** Every type an ability family covers. Stellar is not a type anything wears. */
const FAMILY_TYPES: readonly string[] = TYPE_NAMES.filter((type) => type !== "stellar");

function titleCase(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** Cornered: below a third of its health, its own moves of one type hit harder. */
const CORNERED: AbilitySpec[] = FAMILY_TYPES.map((type) => ({
  id: `cornered-${type}`,
  name: CORNERED_NAMES[type] ?? `${titleCase(type)} Fury`,
  blurb: `Its ${titleCase(type)} moves do 50% more damage while its HP is at or below 1/3 of its maximum.`,
  effect: { t: "power", when: "cornered", type, mille: 1500 },
}));

/** Absorb: immune to a type, and healed a quarter by it. */
const ABSORB: AbilitySpec[] = FAMILY_TYPES.map((type) => ({
  id: `absorb-${type}`,
  name: ABSORB_NAMES[type] ?? `${titleCase(type)} Drinker`,
  blurb: `Damaging ${titleCase(type)} moves do nothing to it and instead restore 1/4 of its max HP (at least 1). ${titleCase(type)} status moves still affect it.`,
  effect: { t: "absorb", type, share: 4 },
}));

/** Ward: a type does half. */
const WARD: AbilitySpec[] = FAMILY_TYPES.map((type) => ({
  id: `ward-${type}`,
  name: WARD_NAMES[type] ?? `${titleCase(type)} Guard`,
  blurb: `It takes 50% less damage from ${titleCase(type)} moves.`,
  effect: { t: "ward", types: [type], mille: 500 },
}));

/**
 * The ones that are their own idea rather than a type with a coat on.
 *
 * Kept to shapes the battle already understands. Each is named after the
 * canon ability it is, so the knowledge somebody already has is worth
 * something here.
 */
const SINGLES: AbilitySpec[] = [
  {
    id: "adaptability",
    name: "Adaptability",
    blurb: "Its same-type attack bonus is ×2 instead of ×1.5.",
    effect: { t: "stab", mille: 2000 },
  },
  {
    id: "technician",
    name: "Technician",
    blurb: "Its moves with 60 power or less, as used, do 50% more damage. Counts each blow of a multi-hit move and a stand-in power, and includes Struggle.",
    effect: { t: "power", when: "weak", mille: 1500 },
  },
  {
    id: "reckless",
    name: "Reckless",
    blurb: "Its moves that have recoil do 20% more damage.",
    effect: { t: "power", when: "costly", mille: 1200 },
  },
  {
    id: "analytic",
    name: "Analytic",
    blurb: "Its moves do 30% more damage on turns it moves after the foe.",
    effect: { t: "power", when: "late", mille: 1300 },
  },
  {
    id: "tintedlens",
    name: "Tinted Lens",
    blurb: "Its not-very-effective hits do double damage: a ×0.5 hit becomes ×1 and a ×0.25 hit becomes ×0.5.",
    effect: { t: "pierce", mille: 2000 },
  },
  {
    id: "filter",
    name: "Filter",
    blurb: "Super-effective hits against it do 25% less damage (×0.75).",
    effect: { t: "cushion", mille: 750 },
  },
  {
    id: "solidrock",
    name: "Solid Rock",
    blurb: "Super-effective hits against it do about 33% less damage (×0.667).",
    effect: { t: "cushion", mille: 667 },
  },
  {
    id: "hugepower",
    name: "Huge Power",
    blurb: "Its Attack stat is doubled.",
    effect: { t: "stat", stat: "atk", when: "always", mille: 2000 },
  },
  {
    id: "hustle",
    name: "Hustle",
    blurb: "Its Attack stat is 50% higher, but its physical moves' accuracy is multiplied by 0.8.",
    effect: { t: "stat", stat: "atk", when: "always", mille: 1500 },
  },
  {
    id: "guts",
    name: "Guts",
    blurb: "While it has a status condition (burn, poison, paralysis, sleep or freeze), its Attack stat is 50% higher, and a burn no longer halves its physical damage.",
    effect: { t: "stat", stat: "atk", when: "statused", mille: 1500 },
  },
  {
    id: "marvelscale",
    name: "Marvel Scale",
    blurb: "While it has a status condition (burn, poison, paralysis, sleep or freeze), its Defence stat is 50% higher.",
    effect: { t: "stat", stat: "def", when: "statused", mille: 1500 },
  },
  {
    id: "quickfeet",
    name: "Quick Feet",
    blurb: "While it has a status condition (burn, poison, paralysis, sleep or freeze), its Speed stat is 50% higher. Paralysis still halves Speed first, so while paralysed it is at 75%.",
    effect: { t: "stat", stat: "spe", when: "statused", mille: 1500 },
  },
  {
    id: "defeatist",
    name: "Defeatist",
    blurb: "While its HP is at or below half its maximum, its Attack and Sp. Atk stats are halved.",
    effect: { t: "stat", stat: "offence", when: "hurt", mille: 500 },
  },
  {
    id: "clearbody",
    name: "Clear Body",
    blurb: "Stat drops caused by the foe (its moves, Intimidate) are blocked. Drops from its own moves still happen.",
    effect: { t: "hold", stats: ["atk", "def", "spa", "spd", "spe"] },
  },
  {
    id: "hypercutter",
    name: "Hyper Cutter",
    blurb: "Attack drops caused by the foe (its moves, Intimidate) are blocked. Drops from its own moves still happen.",
    effect: { t: "hold", stats: ["atk"] },
  },
  {
    id: "bigpecks",
    name: "Big Pecks",
    blurb: "Defence drops caused by the foe are blocked. Drops from its own moves still happen.",
    effect: { t: "hold", stats: ["def"] },
  },
  {
    id: "immunity",
    name: "Immunity",
    blurb: "It cannot be poisoned. Poison it already has is not cured.",
    effect: { t: "ignore", status: "psn" },
  },
  {
    id: "limber",
    name: "Limber",
    blurb: "It cannot be paralysed. Paralysis it already has is not cured.",
    effect: { t: "ignore", status: "par" },
  },
  {
    id: "waterveil",
    name: "Water Veil",
    blurb: "It cannot be burned. A burn it already has is not cured.",
    effect: { t: "ignore", status: "brn" },
  },
  {
    id: "insomnia",
    name: "Insomnia",
    blurb: "It cannot fall asleep. Sleep it is already in is not cured.",
    effect: { t: "ignore", status: "slp" },
  },
  {
    id: "magmaarmor",
    name: "Magma Armor",
    blurb: "It cannot be frozen. Being frozen already is not cured.",
    effect: { t: "ignore", status: "frz" },
  },
  {
    id: "shielddust",
    name: "Shield Dust",
    blurb: "The chance-based extra effects of the foe's moves (burns, flinches, stat drops) never happen to it. A move's main effect, like Thunder Wave's paralysis, still works.",
    effect: { t: "unfazed" },
  },
  {
    id: "compoundeyes",
    name: "Compound Eyes",
    blurb: "Its moves' accuracy is multiplied by 1.3, up to 100%.",
    effect: { t: "aim", mille: 1300 },
  },
  {
    id: "noguard",
    name: "No Guard",
    blurb: "Its moves never miss. Moves used against it can still miss.",
    effect: { t: "aim", mille: 0 },
  },
  {
    id: "superluck",
    name: "Super Luck",
    blurb: "Its critical-hit ratio is one stage higher.",
    effect: { t: "luck", stages: 1 },
  },
  {
    id: "prankster",
    name: "Prankster",
    blurb: "Its status moves get +1 priority, except when the foe is a Dark type.",
    effect: { t: "quick", plus: 1 },
  },
  {
    id: "sturdy",
    name: "Sturdy",
    blurb: "At full HP, a hit that would knock it out leaves it at 1 HP instead.",
    effect: { t: "endure" },
  },
  {
    id: "moxie",
    name: "Moxie",
    blurb: "Its Attack rises one stage each time one of its damaging moves knocks out the foe.",
    effect: { t: "spoils", stat: "atk", delta: 1 },
  },
  // Moxie for the other four stats. Grim Neigh is the games' own; the other
  // three are this game's, so a knockout can feed whatever the build runs on.
  {
    id: "grimneigh",
    name: "Grim Neigh",
    blurb: "Its Sp. Atk rises one stage each time one of its damaging moves knocks out the foe.",
    effect: { t: "spoils", stat: "spa", delta: 1 },
  },
  {
    id: "trophyhide",
    name: "Trophy Hide",
    blurb: "Its Defense rises one stage each time one of its damaging moves knocks out the foe.",
    effect: { t: "spoils", stat: "def", delta: 1 },
  },
  {
    id: "victorscalm",
    name: "Victor's Calm",
    blurb: "Its Sp. Def rises one stage each time one of its damaging moves knocks out the foe.",
    effect: { t: "spoils", stat: "spd", delta: 1 },
  },
  {
    id: "bloodrush",
    name: "Bloodrush",
    blurb: "Its Speed rises one stage each time one of its damaging moves knocks out the foe.",
    effect: { t: "spoils", stat: "spe", delta: 1 },
  },
  {
    id: "intimidate",
    name: "Intimidate",
    blurb: "When it enters battle, the foe's Attack falls one stage. Blocked by Scrappy, Clear Body, Hyper Cutter and Mist.",
    effect: { t: "arrival", stat: "atk", delta: -1 },
  },
  {
    id: "regenerator",
    name: "Regenerator",
    blurb: "When it switches out without having fainted, it restores 1/3 of its max HP.",
    effect: { t: "mend", share: 3 },
  },
  {
    id: "naturalcure",
    name: "Natural Cure",
    blurb: "When it switches out without having fainted, its status condition is cured.",
    effect: { t: "shake" },
  },
  {
    id: "rockhead",
    name: "Rock Head",
    blurb: "It takes no recoil from its own moves. Struggle's HP cost still applies.",
    effect: { t: "reckless" },
  },
  {
    id: "levitate",
    name: "Levitate",
    blurb: "Damaging Ground moves have no effect on it, and it does not count as grounded, so terrain does not affect it.",
    effect: { t: "immune", type: "ground" },
  },
  {
    id: "thickfat",
    name: "Thick Fat",
    blurb: "It takes 50% less damage from Fire and Ice moves.",
    effect: { t: "ward", types: ["fire", "ice"], mille: 500 },
  },
  {
    id: "scrappy",
    name: "Scrappy",
    blurb: "Its Normal and Fighting moves hit Ghost types normally, and Intimidate does not affect it.",
    effect: { t: "reach" },
  },
];

/**
 * The field family: twenty-three abilities that set or read weather and
 * terrain, which arrived with the field itself and were deferred until it
 * did. Dry Skin and Solar Power are not here — each is two or three effects
 * under one name, and a spec carries one.
 */
const FIELD_ABILITIES: AbilitySpec[] = [
  { id: "simple", name: "Simple", blurb: "Every stat stage change it receives is doubled: +1 becomes +2 and −1 becomes −2, still capped at ±6. Applies to its own moves and the foe's.", effect: { t: "simple" } },
  { id: "drought", name: "Drought", blurb: "When it enters battle, starts harsh sunlight for 5 turns, unless it is already sunny.", effect: { t: "summon", weather: "sun" } },
  { id: "drizzle", name: "Drizzle", blurb: "When it enters battle, starts rain for 5 turns, unless it is already raining.", effect: { t: "summon", weather: "rain" } },
  { id: "sandstream", name: "Sand Stream", blurb: "When it enters battle, starts a sandstorm for 5 turns, unless one is already blowing.", effect: { t: "summon", weather: "sand" } },
  { id: "snowwarning", name: "Snow Warning", blurb: "When it enters battle, starts snow for 5 turns, unless it is already snowing.", effect: { t: "summon", weather: "snow" } },
  { id: "electricsurge", name: "Electric Surge", blurb: "When it enters battle, starts Electric Terrain for 5 turns, unless it is already up.", effect: { t: "summon", terrain: "electric" } },
  { id: "grassysurge", name: "Grassy Surge", blurb: "When it enters battle, starts Grassy Terrain for 5 turns, unless it is already up.", effect: { t: "summon", terrain: "grassy" } },
  { id: "mistysurge", name: "Misty Surge", blurb: "When it enters battle, starts Misty Terrain for 5 turns, unless it is already up.", effect: { t: "summon", terrain: "misty" } },
  { id: "psychicsurge", name: "Psychic Surge", blurb: "When it enters battle, starts Psychic Terrain for 5 turns, unless it is already up.", effect: { t: "summon", terrain: "psychic" } },
  { id: "chlorophyll", name: "Chlorophyll", blurb: "Its Speed stat is doubled while harsh sunlight is active.", effect: { t: "weatherStat", weather: ["sun"], stat: "spe", mille: 2000 } },
  { id: "swiftswim", name: "Swift Swim", blurb: "Its Speed stat is doubled while it is raining.", effect: { t: "weatherStat", weather: ["rain"], stat: "spe", mille: 2000 } },
  { id: "sandrush", name: "Sand Rush", blurb: "Its Speed stat is doubled during a sandstorm.", effect: { t: "weatherStat", weather: ["sand"], stat: "spe", mille: 2000 } },
  { id: "slushrush", name: "Slush Rush", blurb: "Its Speed stat is doubled during hail or snow.", effect: { t: "weatherStat", weather: ["hail", "snow"], stat: "spe", mille: 2000 } },
  { id: "surgesurfer", name: "Surge Surfer", blurb: "Its Speed stat is doubled on Electric Terrain while it is grounded.", effect: { t: "terrainStat", terrain: "electric", stat: "spe", mille: 2000 } },
  { id: "grasspelt", name: "Grass Pelt", blurb: "Its Defence stat is 50% higher on Grassy Terrain while it is grounded.", effect: { t: "terrainStat", terrain: "grassy", stat: "def", mille: 1500 } },
  { id: "raindish", name: "Rain Dish", blurb: "At the end of each turn in rain, it restores 1/16 of its max HP (at least 1).", effect: { t: "weatherMend", weather: ["rain"], share: 16 } },
  { id: "icebody", name: "Ice Body", blurb: "At the end of each turn in hail or snow, it restores 1/16 of its max HP (at least 1).", effect: { t: "weatherMend", weather: ["hail", "snow"], share: 16 } },
  { id: "hydration", name: "Hydration", blurb: "At the end of each turn in rain, its status condition is cured.", effect: { t: "weatherCure", weather: ["rain"] } },
  { id: "sandveil", name: "Sand Veil", blurb: "During a sandstorm, the accuracy of moves used against it is multiplied by 0.8.", effect: { t: "weatherGraze", weather: ["sand"], mille: 800 } },
  { id: "snowcloak", name: "Snow Cloak", blurb: "During hail or snow, the accuracy of moves used against it is multiplied by 0.8.", effect: { t: "weatherGraze", weather: ["hail", "snow"], mille: 800 } },
  { id: "sandforce", name: "Sand Force", blurb: "During a sandstorm, its Rock, Ground and Steel moves do 30% more damage. It still takes sandstorm damage unless its type is immune.", effect: { t: "weatherPower", weather: ["sand"], types: ["rock", "ground", "steel"], mille: 1300 } },
  { id: "leafguard", name: "Leaf Guard", blurb: "In harsh sunlight it cannot get a new status condition. One it already has stays.", effect: { t: "weatherGuard", weather: ["sun"] } },
  { id: "cloudnine", name: "Cloud Nine", blurb: "While it is in battle and not fainted, every effect of the weather is ignored for both sides. The weather's remaining turns still count down.", effect: { t: "calm" } },
  { id: "airlock", name: "Air Lock", blurb: "While it is in battle and not fainted, every effect of the weather is ignored for both sides. The weather's remaining turns still count down.", effect: { t: "calm" } },
];

/**
 * The twelve classes: each one built around a single common attack.
 *
 * Moves picked from the ones most creatures meet early — 40 to 80 power, and
 * each learned by dozens of species — so a class ability is something a
 * player can build around rather than a lottery ticket for one line.
 */
const CLASSES: AbilitySpec[] = [
  ["barbarian", "Barbarian", "bite", "Bite"],
  ["bard", "Bard", "disarmingvoice", "Disarming Voice"],
  ["cleric", "Cleric", "dazzlinggleam", "Dazzling Gleam"],
  ["druid", "Druid", "razorleaf", "Razor Leaf"],
  ["fighter", "Fighter", "quickattack", "Quick Attack"],
  ["monk", "Monk", "doublekick", "Double Kick"],
  ["paladin", "Paladin", "metalclaw", "Metal Claw"],
  ["ranger", "Ranger", "aerialace", "Aerial Ace"],
  ["rogue", "Rogue", "feintattack", "Feint Attack"],
  ["sorcerer", "Sorcerer", "ember", "Ember"],
  ["warlock", "Warlock", "hex", "Hex"],
  ["wizard", "Wizard", "swift", "Swift"],
].map(([id, name, move, moveName]) => ({
  id: `class-${id}`,
  name,
  blurb: `Its ${moveName} does double damage (every hit, for a multi-hit move). No effect on its other moves.`,
  effect: { t: "power" as const, when: "signature" as const, move, mille: 2000 },
}));

/**
 * A type lost, and a type gained, one of each per type.
 *
 * Both only in battle: out on the map a Grass type is still a Grass type to
 * anybody asking for one. Losing every type leaves it typeless — no same-type
 * bonus, and every attack neutral against it.
 */
const LACK: AbilitySpec[] = FAMILY_TYPES.map((type) => ({
  id: `lack-${type}`,
  name: `${titleCase(type)} Deficiency`,
  blurb:
    `In battle it is not ${titleCase(type)} type: ${titleCase(type)} moves get no same-type bonus from it, and the type chart ignores ${titleCase(type)} when it is hit. ` +
    `A pure ${titleCase(type)} type becomes typeless. No effect if it is not ${titleCase(type)}.`,
  effect: { t: "lack" as const, type },
}));

const AFFINITY: AbilitySpec[] = FAMILY_TYPES.map((type) => ({
  id: `affinity-${type}`,
  name: `${titleCase(type)} Affinity`,
  blurb:
    `In battle it is also ${titleCase(type)} type: its ${titleCase(type)} moves get the same-type bonus, and it takes and resists hits as a ${titleCase(type)} type too. ` +
    `No effect if it is already ${titleCase(type)}.`,
  effect: { t: "affinity" as const, type },
}));

/**
 * The swaps: two types trade places on its own attacks.
 *
 * Not a change to the creature — it is still its own types, takes hits as
 * them and gets its same-type bonus for them — only to what its moves are
 * when they leave it. So a Grass type with Green Fire loses the bonus on its
 * Grass moves, now Fire, unless it is Fire too; and that is the build: a Fire
 * type whose best moves are Grass ones.
 */
const SWAP_PAIRS: [string, string, string, string][] = [
  ["greenfire", "Green Fire", "grass", "fire"],
  ["boilingtide", "Boiling Tide", "fire", "water"],
  ["frozenspark", "Frozen Spark", "electric", "ice"],
  ["fallingstone", "Falling Stone", "rock", "flying"],
  ["ironbrawl", "Iron Brawl", "fighting", "steel"],
  ["hauntedmind", "Haunted Mind", "ghost", "psychic"],
  ["nightbloom", "Night Bloom", "dark", "fairy"],
  ["taintedsoil", "Tainted Soil", "poison", "ground"],
  ["dragonfrost", "Dragon Frost", "dragon", "ice"],
  ["hivemind", "Hive Mind", "bug", "normal"],
  ["chargedsurf", "Charged Surf", "electric", "water"],
  ["quicksilver", "Quicksilver", "steel", "psychic"],
  ["wildwind", "Wild Wind", "grass", "flying"],
  ["spiritfist", "Spirit Fist", "ghost", "fighting"],
  ["sweetvenom", "Sweet Venom", "poison", "fairy"],
];

const SWAPS: AbilitySpec[] = SWAP_PAIRS.map(([id, name, first, second]) => ({
  id: `swap-${id}`,
  name,
  blurb: `Its ${titleCase(first)} attacks become ${titleCase(second)}, and its ${titleCase(second)} attacks become ${titleCase(first)} — for damage, same-type bonus and how they land.`,
  effect: { t: "swap" as const, types: [first, second] as [string, string] },
}));

/** What type a move of `type` is when this creature uses it, after its swaps. */
export function swappedType(abilityIds: readonly string[], type: string): string {
  let out = type;
  for (const spec of abilitiesOf(abilityIds)) {
    if (spec.effect.t !== "swap") continue;
    const [first, second] = spec.effect.types;
    if (out === first) out = second;
    else if (out === second) out = first;
  }
  return out;
}

/** The perks the social media cabin, the pageant, the paparazzo and Dr. Couch read. */
export type SocialPerk = "celebrity" | "renowned" | "pretty" | "dramaqueen" | "viral" | "photogenic" | "stagepresence" | "thickskin" | "trendsetter" | "colourcoordinated" | "lowbandwidth" | "humblebrag" | "comebackstory" | "paparazzimagnet";

/**
 * The social family: fourteen abilities that do nothing in a fight and a great
 * deal around one — on stream, on stage, in front of a camera and on a couch.
 */
const SOCIAL_PERKS: [SocialPerk, string, string][] = [
  ["celebrity", "Celebrity", "Everything it earns on stream is multiplied by 5. The larger of this and Renowned, never both."],
  ["renowned", "Renowned", "Everything it earns on stream is doubled."],
  ["pretty", "Pretty", "At the beauty pageant its IVs count five times over."],
  ["dramaqueen", "Drama Queen", "When it faints on stream, the pool loses nothing — the crowd loves it more."],
  ["viral", "Viral", "At the Influencer every step counts twice towards its fame."],
  ["photogenic", "Photogenic", "At the beauty pageant it scores 150 more."],
  ["stagepresence", "Stage Presence", "A Ribbon on it charms twice as often (60%) and drops the foe's Attack two stages instead of one."],
  ["thickskin", "Thick Skin", "The paparazzo's photoshoot still takes its Ribbon, but it never comes back Burned Out."],
  ["trendsetter", "Trendsetter", "At the beauty pageant each shine rung is worth 80 instead of 40."],
  ["colourcoordinated", "Colour Coordinated", "At the beauty pageant its colour scores double."],
  ["lowbandwidth", "Low Bandwidth", "While it is on stream, walking costs the pool nothing."],
  ["humblebrag", "Humblebrag", "At the beauty pageant its pageant item's bonus counts whatever its type."],
  ["comebackstory", "Comeback Story", "Dr. Couch sees it for free, and its course takes a tenth of the steps."],
  ["paparazzimagnet", "Paparazzi Magnet", "The paparazzo pays three times as much for its photoshoot."],
];

const SOCIAL: AbilitySpec[] = SOCIAL_PERKS.map(([perk, name, blurb]) => ({
  id: `social-${perk}`,
  name,
  blurb,
  effect: { t: "perk" as const, perk },
}));

/** Whether a creature has this social perk. */
export function hasPerk(creature: { abilities: readonly string[] }, perk: SocialPerk): boolean {
  return abilitiesOf(creature.abilities).some((spec) => spec.effect.t === "perk" && spec.effect.perk === perk);
}

/** Effort: more of it, and some of it aimed. */
const EFFORT_STATS: [string, string, StageStat | "hp"][] = [
  ["marathoner", "Marathoner", "hp"],
  ["weightlifter", "Weightlifter", "atk"],
  ["bulwark", "Bulwark Drill", "def"],
  ["scholar", "Scholar", "spa"],
  ["stoic", "Stoic", "spd"],
  ["sprinter", "Sprinter", "spe"],
];
const STAT_WORDS: Record<string, string> = { hp: "HP", atk: "Attack", def: "Defence", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed" };
const CAPS = "The limits of 252 per stat and 510 in total still apply.";

const EFFORT: AbilitySpec[] = [
  { id: "diligent", name: "Diligent", blurb: `The EVs it earns from each defeated foe are multiplied by 1.5 (rounded down). ${CAPS}`, effect: { t: "regimen", mille: 1500 } },
  { id: "hardworker", name: "Hard Worker", blurb: `The EVs it earns from each defeated foe are doubled. ${CAPS}`, effect: { t: "regimen", mille: 2000 } },
  { id: "workaholic", name: "Workaholic", blurb: `The EVs it earns from each defeated foe are tripled. ${CAPS}`, effect: { t: "regimen", mille: 3000 } },
  ...EFFORT_STATS.map(([id, name, stat]) => ({
    id,
    name,
    blurb: `All the EVs it earns from each defeated foe go into ${STAT_WORDS[stat]}, doubled, whatever the foe would normally teach. A held Macho Brace or Power item that picks a stat overrides which stat. ${CAPS}`,
    effect: { t: "regimen" as const, mille: 2000, stat },
  })),
];

/** Natures, felt harder. */
const NATURE_NOTE = "A neutral nature is unaffected.";
const TEMPER: AbilitySpec[] = [
  { id: "strongwilled", name: "Strong-Willed", blurb: `Its nature's bonus to the raised stat is doubled (about +20% instead of +10%). The lowered stat is lowered as usual. ${NATURE_NOTE}`, effect: { t: "temper", plus: 2000, minus: 1000 } },
  { id: "fervent", name: "Fervent", blurb: `Its nature's bonus to the raised stat is tripled (about +30% instead of +10%). The lowered stat is lowered as usual. ${NATURE_NOTE}`, effect: { t: "temper", plus: 3000, minus: 1000 } },
  { id: "headstrong", name: "Headstrong", blurb: `Its nature counts double both ways: the raised stat about +20% and the lowered stat about −20%, instead of 10% each. ${NATURE_NOTE}`, effect: { t: "temper", plus: 2000, minus: 2000 } },
  { id: "extremist", name: "Extremist", blurb: `Its nature counts triple both ways: the raised stat about +30% and the lowered stat about −30%, instead of 10% each. ${NATURE_NOTE}`, effect: { t: "temper", plus: 3000, minus: 3000 } },
];

/** How many steps walked between one find and the next. */
export const FORAGE_EVERY = 500;

/** Something turned up on the walk. */
const FORAGE_NOTE = `Every ${FORAGE_EVERY} steps you walk with it in your party, it finds one item, picked at random with equal odds from:`;
const FORAGE: AbilitySpec[] = [
  ["scavenger", "Scavenger", ["potion", "superpotion", "pokeball", "greatball", "repel", "superrepel", "escaperope", "fullheal", "revive", "ultraball"], "Potion, Super Potion, Poké Ball, Great Ball, Repel, Super Repel, Escape Rope, Full Heal, Revive, Ultra Ball"],
  ["berrypicker", "Berry Picker", ["berry-oran", "berry-sitrus", "berry-figy", "berry-wiki", "berry-mago", "berry-aguav", "berry-iapapa", "berry-cheri", "berry-chesto", "berry-pecha", "berry-rawst", "berry-aspear", "berry-lum"], "Oran, Sitrus, Figy, Wiki, Mago, Aguav, Iapapa, Cheri, Chesto, Pecha, Rawst, Aspear and Lum Berries"],
  ["ballcollector", "Ball Collector", ["pokeball", "greatball", "ultraball", "quickball", "timerball", "netball", "nestball", "levelball", "fastball", "diveball"], "Poké, Great, Ultra, Quick, Timer, Net, Nest, Level, Fast and Dive Balls"],
  ["herbalist", "Herbalist", ["potion", "superpotion", "hyperpotion", "fullheal", "revive"], "Potion, Super Potion, Hyper Potion, Full Heal, Revive"],
  ["treasurehunter", "Treasure Hunter", ["nugget", "pearl"], "Nugget, Pearl"],
  ["rockhound", "Rockhound", ["stone-leafstone", "stone-firestone", "stone-waterstone", "stone-thunderstone", "stone-icestone", "stone-moonstone", "stone-sunstone", "stone-duskstone", "stone-dawnstone", "stone-shinystone"], "Leaf, Fire, Water, Thunder, Ice, Moon, Sun, Dusk, Dawn and Shiny Stones"],
  ["gymrat", "Gym Rat", ["hpup", "protein", "iron", "calcium", "zinc", "carbos"], "HP Up, Protein, Iron, Calcium, Zinc, Carbos"],
].map(([id, name, items, listed]) => {
  // Ball Collector's jackpot: rolled first, and the ordinary list only if it misses.
  const rare = id === "ballcollector" ? { item: "masterball", perMille: 5 } : undefined;
  return {
    id: id as string,
    name: name as string,
    blurb:
      `${FORAGE_NOTE} ${listed as string}.` +
      (rare ? " Each find has a 0.5% chance to be a Master Ball instead." : "") +
      " Eggs and creatures in the box find nothing.",
    effect: { t: "forage" as const, items: items as string[], ...(rare ? { rare } : {}) },
  };
});

export const ABILITIES: readonly AbilitySpec[] = [
  ...SINGLES,
  ...FIELD_ABILITIES,
  ...CORNERED,
  ...ABSORB,
  ...WARD,
  ...CLASSES,
  ...EFFORT,
  ...TEMPER,
  ...FORAGE,
  ...LACK,
  ...AFFINITY,
  ...SWAPS,
  ...SOCIAL,
];

/**
 * The types it has in battle: its own, less any it lacks, plus any it has an
 * affinity for, in that order. A move that sets types (Soak and the rest)
 * replaces this for as long as it lasts.
 */
export function typesWith(abilityIds: readonly string[], own: readonly string[]): readonly string[] {
  const specs = abilitiesOf(abilityIds);
  const lacking = new Set(specs.flatMap((spec) => (spec.effect.t === "lack" ? [spec.effect.type] : [])));
  const adding = specs.flatMap((spec) => (spec.effect.t === "affinity" ? [spec.effect.type] : []));
  if (!lacking.size && !adding.length) return own;
  const out = own.filter((type) => !lacking.has(type));
  for (const type of adding) if (!out.includes(type)) out.push(type);
  return out;
}

/**
 * The nature term for one stat, as its abilities scale it. `term` is what the
 * nature alone gives (+24, −24 or 0).
 */
export function temperedNature(abilityIds: readonly string[], term: number): number {
  if (term === 0) return 0;
  let out = term;
  for (const spec of abilitiesOf(abilityIds)) {
    if (spec.effect.t !== "temper") continue;
    out = Math.trunc((out * (term > 0 ? spec.effect.plus : spec.effect.minus)) / 1000);
  }
  return out;
}

const BY_ID = new Map(ABILITIES.map((entry) => [entry.id, entry]));

export function ability(id: string): AbilitySpec {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`unknown ability: ${id}`);
  return found;
}

export function isAbility(id: string): boolean {
  return BY_ID.has(id);
}

/** Every ability a creature carries, as specs, in a stable order. */
export function abilitiesOf(ids: readonly string[]): AbilitySpec[] {
  return ids.filter(isAbility).map(ability);
}

/**
 * How many a wild creature is born with.
 *
 * Eighty-nine in a hundred with none, ten with one, one with two. Per mille
 * because everything else in this engine is integers, and because "ten
 * percent" and "one percent" are exactly representable there.
 */
const NONE_UP_TO = 890;
const ONE_UP_TO = 990;

/** The most any creature can carry, however it came by them. */
export const MAX_ABILITIES = 3;

/**
 * What this creature was born with.
 *
 * Drawn from the same named stream as everything else about it, so the
 * abilities on the creature in encounter slot forty of the marsh's third ring
 * are as fixed as its nature and as unrerollable as its IVs.
 */
export function rollAbilities(rng: Rng, odds: AbilityOdds = WILD_ABILITY_ODDS): string[] {
  const roll = intBelow(rng, 1000);
  // Counted down from the top: the last `three` per mille get three, the
  // `two` below them two, and so on. One draw whatever the odds, so a
  // different table moves nothing else rolled after it.
  const threeFrom = 1000 - odds.three;
  const twoFrom = threeFrom - odds.two;
  const oneFrom = twoFrom - odds.one;
  return pickAbilities(rng, roll < oneFrom ? 0 : roll < twoFrom ? 1 : roll < threeFrom ? 2 : 3);
}

/** Per mille chances of being born with one, two and three abilities. */
export interface AbilityOdds {
  one: number;
  two: number;
  three: number;
}

/** Everything in the world: ten percent one, one percent two. */
export const WILD_ABILITY_ODDS: AbilityOdds = { one: ONE_UP_TO - NONE_UP_TO, two: 1000 - ONE_UP_TO, three: 0 };

/** A starter: thirty percent one, six percent two, one percent three. */
export const STARTER_ABILITY_ODDS: AbilityOdds = { one: 300, two: 60, three: 10 };

/**
 * Exactly this many, drawn distinct.
 *
 * Split out from the roll above because the Cup does not roll: everybody in
 * that house has two, which is a one-in-a-hundred creature in the wild. Two
 * callers, one draw order — a second copy of this loop beside the Cup's team
 * builder would be a second place for "the same ability twice" to creep back
 * in.
 */
export function pickAbilities(rng: Rng, count: number): string[] {
  const wanted = Math.min(Math.max(0, count), Math.min(MAX_ABILITIES, ABILITIES.length));

  const picked: string[] = [];
  while (picked.length < wanted) {
    const candidate = ABILITIES[intBelow(rng, ABILITIES.length)].id;
    // Two of the same is one ability, and a creature listed as carrying it
    // twice would be lying about what it has.
    if (!picked.includes(candidate)) picked.push(candidate);
  }

  return picked.sort();
}

/**
 * What an egg inherits.
 *
 * A coin for each of its parents' abilities, and up to three kept. That makes
 * an ability the one thing in breeding that *accumulates* — stats climb toward
 * a ceiling and appearance is a ladder with rungs, but a pair carrying two
 * apiece can produce a child with three, and no wild creature is ever born
 * with three. The best-abilitied creature in a world is therefore always one
 * somebody bred, which is the point.
 *
 * The order matters and is fixed: the first parent's are considered first, so
 * a pair produces the same child on every machine. The cap bites late rather
 * than early, so a fourth coin coming up heads is simply lost.
 */
export function inheritAbilities(
  rng: Rng,
  first: readonly string[],
  second: readonly string[],
): string[] {
  const kept: string[] = [];

  for (const id of [...first, ...second]) {
    if (rng() >= 0.5) continue;
    if (kept.includes(id) || !isAbility(id)) continue;
    if (kept.length >= MAX_ABILITIES) continue;
    kept.push(id);
  }

  return kept.sort();
}

/**
 * The odds a child ends up with each count, as per mille.
 *
 * Computed from the same coins `inheritAbilities` flips rather than tabulated
 * beside them, because the daycare shows this and a panel that can disagree
 * with the engine is worse than no panel. Duplicates between the two parents
 * collapse — an ability both carry is one ability, and one coin.
 */
export function abilityOdds(
  first: readonly string[],
  second: readonly string[],
): number[] {
  const coins = new Set([...first, ...second].filter(isAbility)).size;
  const odds = new Array<number>(MAX_ABILITIES + 1).fill(0);

  // Every subset of the coins is equally likely at one in two each, so the
  // distribution is binomial, capped at three.
  for (let heads = 0; heads <= coins; heads++) {
    const ways = choose(coins, heads);
    const share = (ways / 2 ** coins) * 1000;
    odds[Math.min(MAX_ABILITIES, heads)] += share;
  }

  return odds;
}

function choose(n: number, k: number): number {
  let out = 1;
  for (let step = 0; step < k; step++) out = (out * (n - step)) / (step + 1);
  return Math.round(out);
}
