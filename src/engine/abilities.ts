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
  | { t: "power"; when: PowerWhen; mille: number; type?: string }
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
  /** Money won from a trainer is multiplied. */
  | { t: "purse"; mille: number }
  /** It will not evolve, by any road. */
  | { t: "anchor" }
  /** Effort it earns is multiplied, and which stat it is steered into. */
  | { t: "regimen"; mille: number; stat?: StageStat | "hp" }
  /** Inherited stat slots, for a pairing — the Heirloom's shape, as an item
   * something can carry rather than one applied to the daycare. */
  | { t: "lineage"; slots: number }
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
  /** While it stands there, there is no weather. */
  | { t: "calm" };

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
  | "special";

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
  blurb: `Below a third of its health, its ${type} moves hit half again as hard.`,
  effect: { t: "power", when: "cornered", type, mille: 1500 },
}));

/** Absorb: immune to a type, and healed a quarter by it. */
const ABSORB: AbilitySpec[] = FAMILY_TYPES.map((type) => ({
  id: `absorb-${type}`,
  name: ABSORB_NAMES[type] ?? `${titleCase(type)} Drinker`,
  blurb: `Untouched by ${type} moves, and healed a quarter of its health by one.`,
  effect: { t: "absorb", type, share: 4 },
}));

/** Ward: a type does half. */
const WARD: AbilitySpec[] = FAMILY_TYPES.map((type) => ({
  id: `ward-${type}`,
  name: WARD_NAMES[type] ?? `${titleCase(type)} Guard`,
  blurb: `${titleCase(type)} moves do half as much to it.`,
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
    blurb: "Its same-type bonus is double rather than half again.",
    effect: { t: "stab", mille: 2000 },
  },
  {
    id: "technician",
    name: "Technician",
    blurb: "Moves of 60 power or less hit half again as hard. Struggle included.",
    effect: { t: "power", when: "weak", mille: 1500 },
  },
  {
    id: "reckless",
    name: "Reckless",
    blurb: "Moves that cost it recoil hit a fifth harder.",
    effect: { t: "power", when: "costly", mille: 1200 },
  },
  {
    id: "analytic",
    name: "Analytic",
    blurb: "Moving last is worth a third more damage.",
    effect: { t: "power", when: "late", mille: 1300 },
  },
  {
    id: "tintedlens",
    name: "Tinted Lens",
    blurb: "What it should barely scratch, it hits twice as hard.",
    effect: { t: "pierce", mille: 2000 },
  },
  {
    id: "filter",
    name: "Filter",
    blurb: "Anything super effective against it does three quarters.",
    effect: { t: "cushion", mille: 750 },
  },
  {
    id: "solidrock",
    name: "Solid Rock",
    blurb: "Anything super effective against it does two thirds.",
    effect: { t: "cushion", mille: 667 },
  },
  {
    id: "hugepower",
    name: "Huge Power",
    blurb: "Twice the Attack. Nothing subtle about it.",
    effect: { t: "stat", stat: "atk", when: "always", mille: 2000 },
  },
  {
    id: "hustle",
    name: "Hustle",
    blurb: "Attack half again as high, and every physical move a fifth likelier to miss.",
    effect: { t: "stat", stat: "atk", when: "always", mille: 1500 },
  },
  {
    id: "guts",
    name: "Guts",
    blurb: "Poisoned, burned or worse, it hits half again as hard.",
    effect: { t: "stat", stat: "atk", when: "statused", mille: 1500 },
  },
  {
    id: "marvelscale",
    name: "Marvel Scale",
    blurb: "Ailing, its Defence is half again as high.",
    effect: { t: "stat", stat: "def", when: "statused", mille: 1500 },
  },
  {
    id: "quickfeet",
    name: "Quick Feet",
    blurb: "Ailing, it moves half again as fast.",
    effect: { t: "stat", stat: "spe", when: "statused", mille: 1500 },
  },
  {
    id: "defeatist",
    name: "Defeatist",
    blurb: "Below half health it stops trying: both attacking stats halved.",
    effect: { t: "stat", stat: "offence", when: "hurt", mille: 500 },
  },
  {
    id: "clearbody",
    name: "Clear Body",
    blurb: "Nobody else lowers any of its stats.",
    effect: { t: "hold", stats: ["atk", "def", "spa", "spd", "spe"] },
  },
  {
    id: "hypercutter",
    name: "Hyper Cutter",
    blurb: "Its Attack cannot be lowered by anybody else.",
    effect: { t: "hold", stats: ["atk"] },
  },
  {
    id: "bigpecks",
    name: "Big Pecks",
    blurb: "Its Defence cannot be lowered by anybody else.",
    effect: { t: "hold", stats: ["def"] },
  },
  {
    id: "immunity",
    name: "Immunity",
    blurb: "Poison does not take.",
    effect: { t: "ignore", status: "psn" },
  },
  {
    id: "limber",
    name: "Limber",
    blurb: "Paralysis does not take.",
    effect: { t: "ignore", status: "par" },
  },
  {
    id: "waterveil",
    name: "Water Veil",
    blurb: "It cannot be burned.",
    effect: { t: "ignore", status: "brn" },
  },
  {
    id: "insomnia",
    name: "Insomnia",
    blurb: "It does not sleep.",
    effect: { t: "ignore", status: "slp" },
  },
  {
    id: "magmaarmor",
    name: "Magma Armor",
    blurb: "It cannot be frozen.",
    effect: { t: "ignore", status: "frz" },
  },
  {
    id: "shielddust",
    name: "Shield Dust",
    blurb: "The side effects of moves used on it never land.",
    effect: { t: "unfazed" },
  },
  {
    id: "compoundeyes",
    name: "Compound Eyes",
    blurb: "Its moves are a third more accurate.",
    effect: { t: "aim", mille: 1300 },
  },
  {
    id: "noguard",
    name: "No Guard",
    blurb: "Its moves never miss.",
    effect: { t: "aim", mille: 0 },
  },
  {
    id: "superluck",
    name: "Super Luck",
    blurb: "Critical hits come one stage more often.",
    effect: { t: "luck", stages: 1 },
  },
  {
    id: "prankster",
    name: "Prankster",
    blurb: "Its status moves go first.",
    effect: { t: "quick", plus: 1 },
  },
  {
    id: "sturdy",
    name: "Sturdy",
    blurb: "From full health, one hit will never finish it.",
    effect: { t: "endure" },
  },
  {
    id: "moxie",
    name: "Moxie",
    blurb: "Every knockout raises its Attack.",
    effect: { t: "spoils", stat: "atk", delta: 1 },
  },
  {
    id: "intimidate",
    name: "Intimidate",
    blurb: "Coming out lowers whatever is across from it.",
    effect: { t: "arrival", stat: "atk", delta: -1 },
  },
  {
    id: "regenerator",
    name: "Regenerator",
    blurb: "Switching out mends a third of its health.",
    effect: { t: "mend", share: 3 },
  },
  {
    id: "naturalcure",
    name: "Natural Cure",
    blurb: "Switching out shakes off whatever ails it.",
    effect: { t: "shake" },
  },
  {
    id: "rockhead",
    name: "Rock Head",
    blurb: "Recoil never touches it.",
    effect: { t: "reckless" },
  },
  {
    id: "levitate",
    name: "Levitate",
    blurb: "Ground moves cannot reach it at all.",
    effect: { t: "immune", type: "ground" },
  },
  {
    id: "thickfat",
    name: "Thick Fat",
    blurb: "Fire and Ice both do half as much to it.",
    effect: { t: "ward", types: ["fire", "ice"], mille: 500 },
  },
  {
    id: "scrappy",
    name: "Scrappy",
    blurb: "Its Normal and Fighting moves reach Ghosts.",
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
  { id: "drought", name: "Drought", blurb: "Brings the sun out when it arrives.", effect: { t: "summon", weather: "sun" } },
  { id: "drizzle", name: "Drizzle", blurb: "Brings the rain when it arrives.", effect: { t: "summon", weather: "rain" } },
  { id: "sandstream", name: "Sand Stream", blurb: "Whips up a sandstorm when it arrives.", effect: { t: "summon", weather: "sand" } },
  { id: "snowwarning", name: "Snow Warning", blurb: "Brings the snow when it arrives.", effect: { t: "summon", weather: "snow" } },
  { id: "electricsurge", name: "Electric Surge", blurb: "Lays Electric Terrain when it arrives.", effect: { t: "summon", terrain: "electric" } },
  { id: "grassysurge", name: "Grassy Surge", blurb: "Lays Grassy Terrain when it arrives.", effect: { t: "summon", terrain: "grassy" } },
  { id: "mistysurge", name: "Misty Surge", blurb: "Lays Misty Terrain when it arrives.", effect: { t: "summon", terrain: "misty" } },
  { id: "psychicsurge", name: "Psychic Surge", blurb: "Lays Psychic Terrain when it arrives.", effect: { t: "summon", terrain: "psychic" } },
  { id: "chlorophyll", name: "Chlorophyll", blurb: "Twice as fast in the sun.", effect: { t: "weatherStat", weather: ["sun"], stat: "spe", mille: 2000 } },
  { id: "swiftswim", name: "Swift Swim", blurb: "Twice as fast in the rain.", effect: { t: "weatherStat", weather: ["rain"], stat: "spe", mille: 2000 } },
  { id: "sandrush", name: "Sand Rush", blurb: "Twice as fast in a sandstorm.", effect: { t: "weatherStat", weather: ["sand"], stat: "spe", mille: 2000 } },
  { id: "slushrush", name: "Slush Rush", blurb: "Twice as fast in hail or snow.", effect: { t: "weatherStat", weather: ["hail", "snow"], stat: "spe", mille: 2000 } },
  { id: "surgesurfer", name: "Surge Surfer", blurb: "Twice as fast on Electric Terrain.", effect: { t: "terrainStat", terrain: "electric", stat: "spe", mille: 2000 } },
  { id: "grasspelt", name: "Grass Pelt", blurb: "Defence half again on Grassy Terrain.", effect: { t: "terrainStat", terrain: "grassy", stat: "def", mille: 1500 } },
  { id: "raindish", name: "Rain Dish", blurb: "A sixteenth back every turn in the rain.", effect: { t: "weatherMend", weather: ["rain"], share: 16 } },
  { id: "icebody", name: "Ice Body", blurb: "A sixteenth back every turn in hail or snow.", effect: { t: "weatherMend", weather: ["hail", "snow"], share: 16 } },
  { id: "hydration", name: "Hydration", blurb: "Any condition washes off at the end of a turn in the rain.", effect: { t: "weatherCure", weather: ["rain"] } },
  { id: "sandveil", name: "Sand Veil", blurb: "Harder to hit in a sandstorm.", effect: { t: "weatherGraze", weather: ["sand"], mille: 800 } },
  { id: "snowcloak", name: "Snow Cloak", blurb: "Harder to hit in hail or snow.", effect: { t: "weatherGraze", weather: ["hail", "snow"], mille: 800 } },
  { id: "sandforce", name: "Sand Force", blurb: "Rock, Ground and Steel moves ×1.3 in a sandstorm.", effect: { t: "weatherPower", weather: ["sand"], types: ["rock", "ground", "steel"], mille: 1300 } },
  { id: "leafguard", name: "Leaf Guard", blurb: "No condition takes in the sun.", effect: { t: "weatherGuard", weather: ["sun"] } },
  { id: "cloudnine", name: "Cloud Nine", blurb: "While it stands there, there is no weather.", effect: { t: "calm" } },
  { id: "airlock", name: "Air Lock", blurb: "While it stands there, there is no weather.", effect: { t: "calm" } },
];

export const ABILITIES: readonly AbilitySpec[] = [...SINGLES, ...FIELD_ABILITIES, ...CORNERED, ...ABSORB, ...WARD];

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
export function rollAbilities(rng: Rng): string[] {
  const roll = intBelow(rng, 1000);
  return pickAbilities(rng, roll < NONE_UP_TO ? 0 : roll < ONE_UP_TO ? 1 : 2);
}

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
