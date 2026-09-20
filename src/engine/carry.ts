import type { AbilityEffect } from "./abilities";
import { ALL_SPECIES, TYPE_NAMES } from "./dex";
import type { StatusId } from "./types";

/**
 * Held items: what a creature is carrying, and what carrying it does.
 *
 * The whole design is one observation. **A held item is an ability you can
 * take off.** Adaptability doubles the same-type bonus; a Choice Band raises
 * Attack by half; Sturdy leaves you on one hit point and so does a Focus Sash.
 * These are not similar mechanics, they are the same mechanic reached by a
 * different road — so they share the vocabulary rather than each getting their
 * own hooks in the battle.
 *
 * That is why `AbilityEffect` is the shape here too, and why most of this file
 * is a table rather than code. Sixty-odd held items were added and the battle
 * grew about a dozen new questions, because the other fifty were answers to
 * questions it was already asking. A Charcoal is `power` with a type on it. A
 * Scope Lens is `luck`. An Assault Vest is `stat`. None of those cost a line
 * in battle.ts.
 *
 * Two things an ability does not have and an item does:
 *
 *   **It can be spent.** A Sitrus Berry is gone once eaten, and the creature
 *   that ate it is holding nothing. Nothing has to carry that news out of the
 *   battle: the party *is* `battle.sides[0].team`, so clearing `heldItem`
 *   inside the battle is already clearing it in the save.
 *
 *   **It can have more than one effect.** A Life Orb hits harder *and* costs
 *   health; a Choice Band raises a stat *and* locks a move. So `effects` is a
 *   list, where an ability has exactly one.
 *
 * What is deliberately *not* here is in docs/items-deferred.md, with the one
 * mechanic each is waiting on. The rule is the same one abilities follow: an
 * item that half works teaches a player that items are unreliable, which is a
 * much more expensive lesson than "that one is not in yet".
 */

export interface HoldSpec {
  /** Everything carrying it does. A list, because items stack effects. */
  effects: readonly AbilityEffect[];
  /**
   * Spent when its trigger fires, rather than carried indefinitely.
   *
   * Only meaningful for the shapes that have a moment: `endure`, `cure`,
   * `snack`, `pinch`, `policy`, `barb` and a resist berry's `soften`. A `stat`
   * cannot be "spent" because there is no instant at which it happened, which
   * is why `tests/hold.test.ts` pins the two lists against each other.
   */
  consumed?: boolean;
}

/** What one held item does, or null if holding it does nothing. */
export function holdOf(itemId: string | null): HoldSpec | null {
  return itemId ? (HOLDS.get(itemId) ?? null) : null;
}

/** Every effect a creature's held item contributes. */
export function heldEffects(itemId: string | null): readonly AbilityEffect[] {
  return holdOf(itemId)?.effects ?? [];
}

/** Whether this item is spent the moment it does its job. */
export function isConsumedOnUse(itemId: string | null): boolean {
  return holdOf(itemId)?.consumed === true;
}

// ---------------------------------------------------------------- the table

/**
 * The eighteen type-enhancing items, one per type.
 *
 * A complete family with no holes, the same way the ability families are
 * complete: the games shipped seventeen of these and then needed a Fairy one
 * and invented the Fairy Feather two generations later, which is exactly the
 * shape of hole worth not having. Twenty percent, which is the multiplier
 * every one of them has carried since Generation IV.
 *
 * "stellar" is excluded for the same reason the ability families exclude it —
 * it is not a type anything is.
 */
const TYPE_ITEM_NAMES: Record<string, string> = {
  normal: "Silk Scarf",
  fire: "Charcoal",
  water: "Mystic Water",
  electric: "Magnet",
  grass: "Miracle Seed",
  ice: "Never-Melt Ice",
  fighting: "Black Belt",
  poison: "Poison Barb",
  ground: "Soft Sand",
  flying: "Sharp Beak",
  psychic: "Twisted Spoon",
  bug: "Silver Powder",
  rock: "Hard Stone",
  ghost: "Spell Tag",
  dragon: "Dragon Fang",
  dark: "Black Glasses",
  steel: "Metal Coat",
  fairy: "Fairy Feather",
};

export const TYPE_ITEM_TYPES: readonly string[] = TYPE_NAMES.filter(
  (type) => type !== "stellar" && TYPE_ITEM_NAMES[type],
);

/** Twenty percent, in per-mille. */
const TYPE_ITEM_MILLE = 1200;

export interface HeldItemSeed {
  id: string;
  name: string;
  blurb: string;
  price: number;
  /** What a Mart pays, when it is not the usual half. */
  sell?: number;
  hold: HoldSpec;
}

function typeItems(): HeldItemSeed[] {
  return TYPE_ITEM_TYPES.map((type) => ({
    id: `hold-${type}`,
    name: TYPE_ITEM_NAMES[type],
    blurb: `Its ${type} moves do 20% more damage.`,
    price: 2400,
    hold: { effects: [{ t: "power", when: "typed", type, mille: TYPE_ITEM_MILLE }] },
  }));
}

/**
 * The status berries, one per condition the game has.
 *
 * Cleared the moment it lands, which is the one thing that makes them worth a
 * slot: a Lum Berry is not "cures paralysis", it is "the paralysis that was
 * going to cost you the battle costs you a berry instead".
 */
const CURE_BERRIES: { id: string; name: string; status: StatusId; what: string }[] = [
  { id: "cheri", name: "Cheri Berry", status: "par", what: "paralysis" },
  { id: "chesto", name: "Chesto Berry", status: "slp", what: "sleep" },
  { id: "pecha", name: "Pecha Berry", status: "psn", what: "poison" },
  { id: "rawst", name: "Rawst Berry", status: "brn", what: "a burn" },
  { id: "aspear", name: "Aspear Berry", status: "frz", what: "a freeze" },
];

/**
 * The eighteen resist berries, one per type.
 *
 * Halve one super-effective hit and then they are gone. The canon has exactly
 * eighteen of these and they are already a complete family, which is a rare
 * piece of luck: no diversifying needed.
 */
const RESIST_BERRY_NAMES: Record<string, string> = {
  normal: "Chilan Berry",
  fire: "Occa Berry",
  water: "Passho Berry",
  electric: "Wacan Berry",
  grass: "Rindo Berry",
  ice: "Yache Berry",
  fighting: "Chople Berry",
  poison: "Kebia Berry",
  ground: "Shuca Berry",
  flying: "Coba Berry",
  psychic: "Payapa Berry",
  bug: "Tanga Berry",
  rock: "Charti Berry",
  ghost: "Kasib Berry",
  dragon: "Haban Berry",
  dark: "Colbur Berry",
  steel: "Babiri Berry",
  fairy: "Roseli Berry",
};

function resistBerries(): HeldItemSeed[] {
  return TYPE_ITEM_TYPES.map((type) => ({
    id: `berry-${type}`,
    name: RESIST_BERRY_NAMES[type],
    blurb: `Halves one ${type} hit that would have been super effective, then it is gone.`,
    price: 0,
    hold: { effects: [{ t: "soften", types: [type], mille: 500 }], consumed: true },
  }));
}

/**
 * The pinch berries: a stage, once, when things are going badly.
 *
 * A quarter of maximum health is the trigger the canon uses, and it is the
 * right one — high enough that it fires in a fight you are losing rather than
 * one you have lost.
 */
const PINCH = 4;

const SINGLES: HeldItemSeed[] = [
  // ------------------------------------------------------- what it deals
  {
    id: "hold-choiceband",
    name: "Choice Band",
    blurb: "Attack by half again, and only one move for as long as it stays out.",
    price: 6000,
    hold: {
      effects: [
        { t: "stat", stat: "atk", when: "always", mille: 1500 },
        { t: "locked" },
      ],
    },
  },
  {
    id: "hold-choicespecs",
    name: "Choice Specs",
    blurb: "Sp. Atk by half again, and only one move for as long as it stays out.",
    price: 6000,
    hold: {
      effects: [
        { t: "stat", stat: "spa", when: "always", mille: 1500 },
        { t: "locked" },
      ],
    },
  },
  {
    id: "hold-choicescarf",
    name: "Choice Scarf",
    blurb: "Speed by half again, and only one move for as long as it stays out.",
    price: 6000,
    hold: {
      effects: [
        { t: "stat", stat: "spe", when: "always", mille: 1500 },
        { t: "locked" },
      ],
    },
  },
  {
    id: "hold-lifeorb",
    name: "Life Orb",
    blurb: "Its moves do 30% more damage, but it loses 10% of its max HP each time it attacks.",
    price: 6500,
    hold: {
      effects: [
        { t: "power", when: "always", mille: 1300 },
        { t: "toll", share: 10 },
      ],
    },
  },
  {
    id: "hold-expertbelt",
    name: "Expert Belt",
    blurb: "Super-effective hits do 20% more damage.",
    price: 5000,
    hold: { effects: [{ t: "sharp", mille: 1200 }] },
  },
  {
    id: "hold-muscleband",
    name: "Muscle Band",
    blurb: "Its physical moves do 10% more damage.",
    price: 3600,
    hold: { effects: [{ t: "power", when: "physical", mille: 1100 }] },
  },
  {
    id: "hold-wiseglasses",
    name: "Wise Glasses",
    blurb: "Its special moves do 10% more damage.",
    price: 3600,
    hold: { effects: [{ t: "power", when: "special", mille: 1100 }] },
  },

  // ------------------------------------------------------- what it takes
  {
    id: "hold-assaultvest",
    name: "Assault Vest",
    blurb: "Sp. Def by half again, and it will not use a status move at all.",
    price: 5500,
    hold: {
      effects: [
        { t: "stat", stat: "spd", when: "always", mille: 1500 },
        { t: "silent" },
      ],
    },
  },
  {
    id: "hold-eviolite",
    name: "Eviolite",
    blurb: "Defense and Sp. Def ×1.5 while the holder still has an evolution left — any level, any species, and a Pokémon that only evolves by trade or by an item counts. It does nothing at all once it is fully evolved.",
    price: 5500,
    hold: {
      effects: [
        { t: "stat", stat: "def", when: "unfinished", mille: 1500 },
        { t: "stat", stat: "spd", when: "unfinished", mille: 1500 },
      ],
    },
  },
  {
    id: "hold-focussash",
    name: "Focus Sash",
    blurb: "From full health, it survives one hit that would have finished it. Then it is gone.",
    price: 4000,
    hold: { effects: [{ t: "endure" }], consumed: true },
  },
  {
    id: "hold-weaknesspolicy",
    name: "Weakness Policy",
    blurb: "A super-effective hit raises both attacks two stages. Then it is gone.",
    price: 4500,
    hold: { effects: [{ t: "policy", stats: ["atk", "spa"], delta: 2 }], consumed: true },
  },
  {
    id: "hold-brightpowder",
    name: "Bright Powder",
    blurb: "Whatever is aiming at it is a tenth less accurate.",
    price: 3000,
    hold: { effects: [{ t: "graze", mille: 900 }] },
  },

  // ------------------------------------------------------ what it mends
  {
    id: "hold-leftovers",
    name: "Leftovers",
    blurb: "Restores 1/16 of its max HP at the end of every turn.",
    price: 5000,
    hold: { effects: [{ t: "tick", share: 16 }] },
  },
  {
    id: "hold-blacksludge",
    name: "Black Sludge",
    blurb: "An eighth back every turn to a poison type, and an eighth off anything else.",
    price: 3000,
    hold: { effects: [{ t: "tick", share: 8, only: ["poison"] }] },
  },
  {
    id: "hold-shellbell",
    name: "Shell Bell",
    blurb: "It heals 1/8 of the damage it deals.",
    price: 4000,
    hold: { effects: [{ t: "siphon", share: 8 }] },
  },

  // --------------------------------------------- aim, luck and going first
  {
    id: "hold-scopelens",
    name: "Scope Lens",
    blurb: "Critical hits come one stage more often.",
    price: 4000,
    hold: { effects: [{ t: "luck", stages: 1 }] },
  },
  {
    id: "hold-widelens",
    name: "Wide Lens",
    blurb: "Its moves are 10% more accurate.",
    price: 3000,
    hold: { effects: [{ t: "aim", mille: 1100 }] },
  },
  {
    id: "hold-quickclaw",
    name: "Quick Claw",
    blurb: "20% chance each turn to move first, whatever its Speed.",
    price: 3500,
    hold: { effects: [{ t: "gamble", mille: 200 }] },
  },

  // ------------------------------------------------ what it does to itself
  {
    id: "hold-flameorb",
    name: "Flame Orb",
    blurb: "Burns whatever is holding it. Which is the point, for the right holder.",
    price: 3000,
    hold: { effects: [{ t: "afflict", status: "brn" }] },
  },
  {
    id: "hold-toxicorb",
    name: "Toxic Orb",
    blurb: "Poisons whatever is holding it. Also the point.",
    price: 3000,
    hold: { effects: [{ t: "afflict", status: "psn" }] },
  },

  // ---------------------------------------------- outside a battle entirely
  {
    id: "hold-expshare",
    name: "Exp. Share",
    blurb:
      "If it did not fight, it still gets half the experience of every creature your team beats, and the effort points too — as long as it has not fainted. Given once, when one of yours first reaches level 40, and never again.",
    price: 0,
    sell: 2000,
    hold: { effects: [{ t: "share", mille: 500 }] },
  },
  {
    id: "hold-luckyegg",
    name: "Lucky Egg",
    blurb: "It gains 1.5× experience from battles.",
    price: 8000,
    hold: { effects: [{ t: "study", mille: 1500 }] },
  },
  {
    id: "hold-amuletcoin",
    name: "Amulet Coin",
    blurb: "2× prize money from any trainer battle it takes part in.",
    price: 6000,
    hold: { effects: [{ t: "purse", mille: 2000 }] },
  },
  {
    id: "hold-everstone",
    name: "Everstone",
    blurb: "It will not evolve while it holds this, by any road at all.",
    price: 1800,
    hold: { effects: [{ t: "anchor" }] },
  },
  {
    id: "hold-machobrace",
    name: "Macho Brace",
    blurb: "Twice the effort from everything it beats, and half its speed while it wears it.",
    price: 3600,
    hold: {
      effects: [
        { t: "regimen", mille: 2000 },
        { t: "stat", stat: "spe", when: "always", mille: 500 },
      ],
    },
  },
  {
    id: "hold-destinyknot",
    name: "Destiny Knot",
    blurb: "At the daycare: 5 of each egg's 6 IVs mutate upward instead of 3.",
    price: 4800,
    hold: { effects: [{ t: "lineage", slots: 5 }] },
  },

  // ------------------------------------------------------------ the berries
  {
    id: "berry-oran",
    name: "Oran Berry",
    blurb: "Ten health back when it drops below half. Then it is gone.",
    price: 200,
    hold: { effects: [{ t: "snack", below: 2, amount: 10 }], consumed: true },
  },
  {
    id: "berry-sitrus",
    name: "Sitrus Berry",
    blurb: "A quarter of its health back when it drops below half. Then it is gone.",
    price: 900,
    hold: { effects: [{ t: "snack", below: 2, share: 4 }], consumed: true },
  },
  {
    id: "berry-figy",
    name: "Figy Berry",
    blurb: "A third of its health back when it drops below a quarter. Then it is gone.",
    price: 700,
    hold: { effects: [{ t: "snack", below: PINCH, share: 3 }], consumed: true },
  },
  {
    id: "berry-lum",
    name: "Lum Berry",
    blurb: "Clears whatever ails it, the moment it lands. Then it is gone.",
    price: 1200,
    hold: { effects: [{ t: "cure" }], consumed: true },
  },
  {
    id: "berry-liechi",
    name: "Liechi Berry",
    blurb: "Attack up a stage when it drops below a quarter. Then it is gone.",
    price: 1500,
    hold: { effects: [{ t: "pinch", below: PINCH, stat: "atk", delta: 1 }], consumed: true },
  },
  {
    id: "berry-ganlon",
    name: "Ganlon Berry",
    blurb: "Defence up a stage when it drops below a quarter. Then it is gone.",
    price: 1500,
    hold: { effects: [{ t: "pinch", below: PINCH, stat: "def", delta: 1 }], consumed: true },
  },
  {
    id: "berry-petaya",
    name: "Petaya Berry",
    blurb: "Sp. Atk up a stage when it drops below a quarter. Then it is gone.",
    price: 1500,
    hold: { effects: [{ t: "pinch", below: PINCH, stat: "spa", delta: 1 }], consumed: true },
  },
  {
    id: "berry-apicot",
    name: "Apicot Berry",
    blurb: "Sp. Def up a stage when it drops below a quarter. Then it is gone.",
    price: 1500,
    hold: { effects: [{ t: "pinch", below: PINCH, stat: "spd", delta: 1 }], consumed: true },
  },
  {
    id: "berry-salac",
    name: "Salac Berry",
    blurb: "Speed up a stage when it drops below a quarter. Then it is gone.",
    price: 1500,
    hold: { effects: [{ t: "pinch", below: PINCH, stat: "spe", delta: 1 }], consumed: true },
  },
  {
    id: "berry-jaboca",
    name: "Jaboca Berry",
    blurb: "Whatever hits it physically loses an eighth of its own health. Then it is gone.",
    price: 1200,
    hold: { effects: [{ t: "barb", share: 8, category: "physical" }], consumed: true },
  },
  {
    id: "berry-rowap",
    name: "Rowap Berry",
    blurb: "Whatever hits it specially loses an eighth of its own health. Then it is gone.",
    price: 1200,
    hold: { effects: [{ t: "barb", share: 8, category: "special" }], consumed: true },
  },
];

function cureBerries(): HeldItemSeed[] {
  return CURE_BERRIES.map((entry) => ({
    id: `berry-${entry.id}`,
    name: entry.name,
    blurb: `Clears ${entry.what} the moment it lands. Then it is gone.`,
    price: 500,
    hold: { effects: [{ t: "cure", status: entry.status }], consumed: true },
  }));
}


/**
 * The six Power items: effort, steered.
 *
 * A Macho Brace doubles whatever the loser was going to teach; these double it
 * *and* decide what it teaches, which is what turns effort from something that
 * happens to a creature into something you aim. The same `regimen` shape, with
 * a stat named.
 */
const POWER_ITEMS: { id: string; name: string; stat: "hp" | "atk" | "def" | "spa" | "spd" | "spe"; what: string }[] = [
  { id: "powerweight", name: "Power Weight", stat: "hp", what: "health" },
  { id: "powerbracer", name: "Power Bracer", stat: "atk", what: "attack" },
  { id: "powerbelt", name: "Power Belt", stat: "def", what: "defence" },
  { id: "powerlens", name: "Power Lens", stat: "spa", what: "special attack" },
  { id: "powerband", name: "Power Band", stat: "spd", what: "special defence" },
  { id: "poweranklet", name: "Power Anklet", stat: "spe", what: "speed" },
];

/** How far one IV scale moves each of its two stats. */
export const SCALE_AMOUNT = 5;

const SCALE_STATS = [
  { stat: "hp", short: "HP", long: "HP" },
  { stat: "atk", short: "Atk", long: "Attack" },
  { stat: "def", short: "Def", long: "Defence" },
  { stat: "spa", short: "SpA", long: "Sp. Atk" },
  { stat: "spd", short: "SpD", long: "Sp. Def" },
  { stat: "spe", short: "Spe", long: "Speed" },
] as const;

/**
 * The IV scales: one for every ordered pair of stats, thirty in all.
 *
 * Carried by a parent at the daycare, a scale moves five IV points from one
 * stat into another on every egg — after everything else about the egg is
 * rolled, so a pairing draws exactly the numbers it always drew and the scale
 * only moves them. Both parents can carry one, and two scales add.
 *
 * Every pair rather than six fixed ones, because the stat a build wants low
 * and the stat it would rather have the points in are two separate choices,
 * and a scale that made the second one for you would be the wrong scale half
 * the time.
 */
function ivScales(): HeldItemSeed[] {
  return SCALE_STATS.flatMap((up) =>
    SCALE_STATS.filter((down) => down.stat !== up.stat).map((down) => ({
      id: `hold-scale-${up.stat}-${down.stat}`,
      name: `Scale: +${up.short} −${down.short}`,
      blurb: `Held by a parent at the daycare: every egg gets +${SCALE_AMOUNT} ${up.long} IV and −${SCALE_AMOUNT} ${down.long} IV, never below 0 or above the cap. Two scales on the pair add.`,
      price: 3000,
      hold: { effects: [{ t: "tilt" as const, up: up.stat, down: down.stat, amount: SCALE_AMOUNT }] },
    })),
  );
}

/** The pageant items: carried on stage, they add their bonus when the carrier is one of their types. See pageant.ts. */
export const PAGEANT_ITEMS: readonly { id: string; name: string; types: readonly string[]; bonus: number }[] = [
  { id: "hold-silksash", name: "Silk Sash", types: ["normal", "fairy"], bonus: 120 },
  { id: "hold-embertiara", name: "Ember Tiara", types: ["fire"], bonus: 90 },
  { id: "hold-pearlnecklace", name: "Pearl Necklace", types: ["water", "ice"], bonus: 110 },
  { id: "hold-flowercrown", name: "Flower Crown", types: ["grass", "bug"], bonus: 100 },
  { id: "hold-stormbrooch", name: "Stormglass Brooch", types: ["electric", "flying"], bonus: 130 },
  { id: "hold-moonveil", name: "Moonstone Veil", types: ["psychic", "ghost"], bonus: 150 },
  { id: "hold-obsidianchoker", name: "Obsidian Choker", types: ["dark", "poison"], bonus: 140 },
  { id: "hold-gildedgauntlet", name: "Gilded Gauntlet", types: ["fighting", "steel"], bonus: 160 },
  { id: "hold-geodecrown", name: "Geode Crown", types: ["rock", "ground"], bonus: 50 },
  { id: "hold-dragonscalecape", name: "Dragonscale Cape", types: ["dragon"], bonus: 200 },
];

function pageantItems(): HeldItemSeed[] {
  return PAGEANT_ITEMS.map((entry) => ({
    id: entry.id,
    name: entry.name,
    blurb: `Beauty pageant: +${entry.bonus} to the score of a ${entry.types.map((type) => type[0].toUpperCase() + type.slice(1)).join(" or ")} type wearing it. Does nothing in battle.`,
    price: 4000 + entry.bonus * 20,
    hold: { effects: [{ t: "pageant" as const, types: [...entry.types], bonus: entry.bonus }] },
  }));
}

function powerItems(): HeldItemSeed[] {
  return POWER_ITEMS.map((entry) => ({
    id: `hold-${entry.id}`,
    name: entry.name,
    blurb: `Twice the effort from everything it beats, all of it into ${entry.what}.`,
    price: 4200,
    hold: { effects: [{ t: "regimen", mille: 2000, stat: entry.stat }] },
  }));
}

/**
 * The four remaining flavour berries.
 *
 * The canon has five of these and they are the same item five times over: a
 * third of your health back at a quarter remaining. In the games they differ
 * only by which nature dislikes the taste, and there is no taste here, so they
 * are five names for one effect — which is fine. A player who finds a Mago
 * Berry should get something, and "you already have this one" is a worse answer
 * than five that stack in the bag.
 */
const FLAVOUR: { id: string; name: string }[] = [
  { id: "wiki", name: "Wiki Berry" },
  { id: "mago", name: "Mago Berry" },
  { id: "aguav", name: "Aguav Berry" },
  { id: "iapapa", name: "Iapapa Berry" },
];

function flavourBerries(): HeldItemSeed[] {
  return FLAVOUR.map((entry) => ({
    id: `berry-${entry.id}`,
    name: entry.name,
    blurb: "A third of its health back when it drops below a quarter. Then it is gone.",
    price: 700,
    hold: { effects: [{ t: "snack", below: PINCH, share: 3 }], consumed: true },
  }));
}

/**
 * Every species whose id starts with one of these, from the bestiary.
 *
 * The species-specific items name a *creature*, not an id, and this manifest
 * has eleven Pikachus and three Marowaks. Writing the ids out by hand meant a
 * Light Ball that did nothing for a Pikachu-Kalos and a Griseous Orb that
 * named `giratinaorigin`, which does not exist here at all — both silent,
 * because an effect with a condition nothing matches is simply an effect that
 * never applies. Read from the data instead, and `tests/hold.test.ts` checks
 * that every name still resolves.
 */
function formsOf(...prefixes: string[]): string[] {
  return ALL_SPECIES.filter((entry) => prefixes.some((prefix) => entry.id.startsWith(prefix)))
    .map((entry) => entry.id)
    .sort();
}

/**
 * The species-specific family.
 *
 * Every one of these does nothing at all in the wrong hands, which is the
 * whole point: they exist to prop up something that needs propping. A Thick
 * Club on a Cubone is the difference between an unusable creature and a
 * genuinely frightening one, and on anything else it is a rock.
 *
 * Named against base forms only, deliberately. Marowak does not need the club
 * and Raichu does not need the ball; the canon agrees, and it is the reading
 * that keeps them interesting rather than simply strong.
 */
const SPECIES_ITEMS: HeldItemSeed[] = [
  {
    id: "hold-thickclub",
    name: "Thick Club",
    blurb: "Twice the Attack, for a Cubone or a Marowak and nobody else.",
    price: 3000,
    hold: {
      effects: [
        {
          t: "stat",
          stat: "atk",
          when: "always",
          mille: 2000,
          for: { species: formsOf("cubone", "marowak") },
        },
      ],
    },
  },
  {
    id: "hold-lightball",
    name: "Light Ball",
    blurb: "Twice both attacks, for a Pikachu and nobody else.",
    price: 3000,
    hold: {
      effects: [
        {
          t: "stat",
          stat: "offence",
          when: "always",
          mille: 2000,
          for: { species: formsOf("pikachu") },
        },
      ],
    },
  },
  {
    id: "hold-metalpowder",
    name: "Metal Powder",
    blurb: "Twice the Defence, for a Ditto and nobody else.",
    price: 2400,
    hold: {
      effects: [
        { t: "stat", stat: "def", when: "always", mille: 2000, for: { species: formsOf("ditto") } },
      ],
    },
  },
  {
    id: "hold-quickpowder",
    name: "Quick Powder",
    blurb: "Twice the Speed, for a Ditto and nobody else.",
    price: 2400,
    hold: {
      effects: [
        { t: "stat", stat: "spe", when: "always", mille: 2000, for: { species: formsOf("ditto") } },
      ],
    },
  },
  {
    id: "hold-luckypunch",
    name: "Lucky Punch",
    blurb: "Two stages of critical hits, for a Chansey and nobody else.",
    price: 2400,
    hold: { effects: [{ t: "luck", stages: 2, for: { species: formsOf("chansey") } }] },
  },
  {
    id: "hold-leek",
    name: "Leek",
    blurb: "Two stages of critical hits, for a Farfetch'd and nobody else.",
    price: 2400,
    hold: {
      effects: [
        {
          t: "luck",
          stages: 2,
          for: { species: formsOf("farfetchd", "sirfetchd") },
        },
      ],
    },
  },
  {
    id: "hold-deepseatooth",
    name: "Deep Sea Tooth",
    blurb: "Twice the Sp. Atk, for a Clamperl and nobody else.",
    price: 2400,
    hold: {
      effects: [
        { t: "stat", stat: "spa", when: "always", mille: 2000, for: { species: formsOf("clamperl") } },
      ],
    },
  },
  {
    id: "hold-deepseascale",
    name: "Deep Sea Scale",
    blurb: "Twice the Sp. Def, for a Clamperl and nobody else.",
    price: 2400,
    hold: {
      effects: [
        { t: "stat", stat: "spd", when: "always", mille: 2000, for: { species: formsOf("clamperl") } },
      ],
    },
  },
  {
    id: "hold-souldew",
    name: "Soul Dew",
    blurb: "Its Psychic and Dragon moves hit a fifth harder, for a Latias or a Latios.",
    price: 5000,
    hold: {
      effects: [
        { t: "power", when: "typed", type: "psychic", mille: 1200, for: { species: formsOf("latias", "latios") } },
        { t: "power", when: "typed", type: "dragon", mille: 1200, for: { species: formsOf("latias", "latios") } },
      ],
    },
  },
  {
    id: "hold-adamantorb",
    name: "Adamant Orb",
    blurb: "Its Dragon and Steel moves hit a fifth harder, for Dialga.",
    price: 5000,
    hold: {
      effects: [
        { t: "power", when: "typed", type: "dragon", mille: 1200, for: { species: formsOf("dialga") } },
        { t: "power", when: "typed", type: "steel", mille: 1200, for: { species: formsOf("dialga") } },
      ],
    },
  },
  {
    id: "hold-lustrousorb",
    name: "Lustrous Orb",
    blurb: "Its Dragon and Water moves hit a fifth harder, for Palkia.",
    price: 5000,
    hold: {
      effects: [
        { t: "power", when: "typed", type: "dragon", mille: 1200, for: { species: formsOf("palkia") } },
        { t: "power", when: "typed", type: "water", mille: 1200, for: { species: formsOf("palkia") } },
      ],
    },
  },
  {
    id: "hold-griseousorb",
    name: "Griseous Orb",
    blurb: "Its Dragon and Ghost moves hit a fifth harder, for Giratina.",
    price: 5000,
    hold: {
      effects: [
        { t: "power", when: "typed", type: "dragon", mille: 1200, for: { species: formsOf("giratina") } },
        { t: "power", when: "typed", type: "ghost", mille: 1200, for: { species: formsOf("giratina") } },
      ],
    },
  },
];

/**
 * The ones that are another item wearing a different name.
 *
 * Kept rather than collapsed. Somebody who finds a Lax Incense has found
 * something, and telling them it is a Bright Powder they already have is a
 * worse answer than letting them hold one on a second creature.
 */
const SECOND_NAMES: HeldItemSeed[] = [
  {
    id: "hold-razorclaw",
    name: "Razor Claw",
    blurb: "Critical hits come one stage more often.",
    price: 4000,
    hold: { effects: [{ t: "luck", stages: 1 }] },
  },
  {
    id: "hold-laxincense",
    name: "Lax Incense",
    blurb: "Whatever is aiming at it is a tenth less accurate.",
    price: 3000,
    hold: { effects: [{ t: "graze", mille: 900 }] },
  },
  {
    id: "hold-luckincense",
    name: "Luck Incense",
    blurb: "2× prize money from any trainer battle it takes part in.",
    price: 6000,
    hold: { effects: [{ t: "purse", mille: 2000 }] },
  },
];

/** The rest of the second wave: shapes that already existed, unused. */
const LATE: HeldItemSeed[] = [
  {
    id: "hold-zoomlens",
    name: "Zoom Lens",
    blurb: "A fifth more accurate, but only on the turns it moves second.",
    price: 3200,
    hold: { effects: [{ t: "aim", mille: 1200, when: "late" }] },
  },
  {
    id: "hold-focusband",
    name: "Focus Band",
    blurb: "One time in ten it survives a hit that would have finished it, from any health at all.",
    price: 3000,
    hold: { effects: [{ t: "endure", mille: 100, whole: false }] },
  },
  {
    id: "hold-clearamulet",
    name: "Clear Amulet",
    blurb: "Nobody else lowers any of its stats.",
    price: 5000,
    hold: { effects: [{ t: "hold", stats: ["atk", "def", "spa", "spd", "spe"] }] },
  },
  {
    id: "hold-covertcloak",
    name: "Covert Cloak",
    blurb: "The secondary effects of moves used on it never fire.",
    price: 5000,
    hold: { effects: [{ t: "unfazed" }] },
  },
  {
    id: "hold-bigroot",
    name: "Big Root",
    blurb: "Draining moves return half again as much.",
    price: 3600,
    hold: { effects: [{ t: "roots", mille: 1500 }] },
  },
  {
    id: "hold-smokeball",
    name: "Smoke Ball",
    blurb: "Running from a wild creature always works, whatever its level.",
    price: 2000,
    hold: { effects: [{ t: "bolt" }] },
  },
  {
    id: "berry-enigma",
    name: "Enigma Berry",
    blurb: "A quarter of its health back when something hits it super effectively. Then it is gone.",
    price: 1500,
    hold: { effects: [{ t: "solace", share: 4 }], consumed: true },
  },
  {
    id: "berry-kee",
    name: "Kee Berry",
    blurb: "Defence up a stage when something hits it physically. Then it is gone.",
    price: 1200,
    hold: { effects: [{ t: "brace", stats: ["def"], delta: 1, category: "physical" }], consumed: true },
  },
  {
    id: "berry-maranga",
    name: "Maranga Berry",
    blurb: "Sp. Def up a stage when something hits it specially. Then it is gone.",
    price: 1200,
    hold: { effects: [{ t: "brace", stats: ["spd"], delta: 1, category: "special" }], consumed: true },
  },
];

/**
 * Carried to evolve, and nothing else. The rules that read them are in
 * evolutions.ts, which matches on the name — so the names here are the ones
 * that table uses, and `tests/evolutions.test.ts` holds the two together.
 */
const EVOLUTION_HELD: HeldItemSeed[] = [
  {
    id: "hold-kingsrock",
    name: "King's Rock",
    blurb: "Evolves Poliwhirl into Politoed, Slowpoke into Slowking when it levels up holding it (or is given a Linking Cord, for a trade one). Used up.",
    price: 3000,
    hold: { effects: [] },
  },
  {
    id: "hold-protector",
    name: "Protector",
    blurb: "Evolves Rhydon into Rhyperior when it levels up holding it (or is given a Linking Cord, for a trade one). Used up.",
    price: 3000,
    hold: { effects: [] },
  },
  {
    id: "hold-dragonscale",
    name: "Dragon Scale",
    blurb: "Evolves Seadra into Kingdra when it levels up holding it (or is given a Linking Cord, for a trade one). Used up.",
    price: 3000,
    hold: { effects: [] },
  },
  {
    id: "hold-electirizer",
    name: "Electirizer",
    blurb: "Evolves Electabuzz into Electivire when it levels up holding it (or is given a Linking Cord, for a trade one). Used up.",
    price: 3000,
    hold: { effects: [] },
  },
  {
    id: "hold-magmarizer",
    name: "Magmarizer",
    blurb: "Evolves Magmar into Magmortar when it levels up holding it (or is given a Linking Cord, for a trade one). Used up.",
    price: 3000,
    hold: { effects: [] },
  },
  {
    id: "hold-upgrade",
    name: "Up-Grade",
    blurb: "Evolves Porygon into Porygon2 when it levels up holding it (or is given a Linking Cord, for a trade one). Used up.",
    price: 3000,
    hold: { effects: [] },
  },
  {
    id: "hold-dubiousdisc",
    name: "Dubious Disc",
    blurb: "Evolves Porygon2 into Porygon-Z when it levels up holding it (or is given a Linking Cord, for a trade one). Used up.",
    price: 3000,
    hold: { effects: [] },
  },
  {
    id: "hold-prismscale",
    name: "Prism Scale",
    blurb: "Evolves Feebas into Milotic when it levels up holding it (or is given a Linking Cord, for a trade one). Used up.",
    price: 3000,
    hold: { effects: [] },
  },
  {
    id: "hold-reapercloth",
    name: "Reaper Cloth",
    blurb: "Evolves Dusclops into Dusknoir when it levels up holding it (or is given a Linking Cord, for a trade one). Used up.",
    price: 3000,
    hold: { effects: [] },
  },
  {
    id: "hold-sachet",
    name: "Sachet",
    blurb: "Evolves Spritzee into Aromatisse when it levels up holding it (or is given a Linking Cord, for a trade one). Used up.",
    price: 3000,
    hold: { effects: [] },
  },
  {
    id: "hold-whippeddream",
    name: "Whipped Dream",
    blurb: "Evolves Swirlix into Slurpuff when it levels up holding it (or is given a Linking Cord, for a trade one). Used up.",
    price: 3000,
    hold: { effects: [] },
  },
  {
    id: "hold-razorfang",
    name: "Razor Fang",
    blurb: "Evolves Gligar into Gliscor when it levels up holding it. Used up.",
    price: 3000,
    hold: { effects: [] },
  },
  {
    id: "hold-ovalstone",
    name: "Oval Stone",
    blurb: "Evolves Happiny into Chansey when it levels up holding it. Used up.",
    price: 3000,
    hold: { effects: [] },
  },
  {
    id: "hold-leaderscrest",
    name: "Leader's Crest",
    blurb: "Evolves Bisharp into Kingambit when it levels up holding it. Used up.",
    price: 3000,
    hold: { effects: [] },
  },
  {
    id: "hold-soothebell",
    name: "Soothe Bell",
    blurb: "Friendship, as far as this game has it: a Golbat, Chansey, Pichu, Riolu and the rest evolve when they level up holding it (Eevee also needs a Psychic, Dark or Fairy move). Kept.",
    price: 5000,
    hold: { effects: [] },
  },
];

/** The held items that do nothing in a battle: they are for evolving. */
export const EVOLUTION_ONLY_HELD: ReadonlySet<string> = new Set(EVOLUTION_HELD.map((entry) => entry.id));

/** Everything that can be held, in one list, for items.ts to fold into the bag. */
export const HELD_ITEMS: readonly HeldItemSeed[] = [
  ...SINGLES,
  ...EVOLUTION_HELD,
  ...LATE,
  ...SECOND_NAMES,
  ...SPECIES_ITEMS,
  ...powerItems(),
  ...pageantItems(),
  ...ivScales(),
  ...typeItems(),
  ...cureBerries(),
  ...flavourBerries(),
  ...resistBerries(),
];

const HOLDS = new Map(HELD_ITEMS.map((entry) => [entry.id, entry.hold]));

/**
 * What a creature is born holding, now and then.
 *
 * Wild ones: one in a hundred holds a common berry, a Nugget or a Pearl, so a
 * catch is sometimes worth a second look in the bag. Starters: one in ten
 * holds something better, the kind of item a shop charges thousands for.
 * Every entry equally likely. The roll is its own named stream at each call
 * site, so it never shifts the creature's other rolls.
 */
export const WILD_HELD_PER_MILLE = 10;
export const WILD_HELD_ITEMS: readonly string[] = [
  "berry-oran", "berry-sitrus", "berry-figy", "berry-wiki", "berry-mago", "berry-aguav", "berry-iapapa",
  "berry-cheri", "berry-chesto", "berry-pecha", "berry-rawst", "berry-aspear", "berry-lum",
  "nugget", "pearl",
];

export const STARTER_HELD_PER_MILLE = 300;
export const STARTER_HELD_ITEMS: readonly string[] = [
  "hold-leftovers", "hold-shellbell", "hold-quickclaw", "hold-scopelens", "hold-muscleband", "hold-wiseglasses",
  "hold-expertbelt", "hold-focussash", "hold-luckyegg", "hold-amuletcoin", "hold-eviolite", "berry-sitrus", "berry-lum",
];

/** A held item from `pool` at `perMille` odds, or null. */
export function rollHeld(rng: () => number, pool: readonly string[], perMille: number): string | null {
  if (Math.floor(rng() * 1000) >= perMille || !pool.length) return null;
  return pool[Math.floor(rng() * pool.length)];
}
