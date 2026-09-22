import { ALL_SPECIES, MACHINE_MOVES, move as moveById } from "./dex";
import { HELD_ITEMS, holdOf } from "./carry";
import { NATURE_MAGNITUDE, NATURES } from "./natures";
import type { StatId } from "./types";
import { chroma, CHROMA_IDS } from "./variants";

/**
 * The bag, and what is in it.
 *
 * One catalogue, because a Mart price, a battle effect and the label on a
 * button are three views of the same fact and keeping them in three places is
 * how a shop ends up selling something the engine cannot use.
 *
 * Everything a player owns lives in one `bag` of counts now — balls, medicine,
 * rods and the breeding equipment together. Balls used to be a loose number on
 * the state and breeding gear a list of ids, which meant "how many of this do
 * I have" had two different answers depending on what you asked about.
 */

export type ItemKind =
  | "ball"
  | "medicine"
  | "rod"
  | "breeding"
  | "treasure"
  | "hm"
  | "key"
  | "lure"
  | "tm"
  /** Used on a creature to change it into another one. */
  | "stone"
  /** Used on a creature to move a number on its stat screen. */
  | "tonic"
  /** Used on the world rather than on a creature. */
  | "field"
  /**
   * Carried to a printer, which reads it and keeps printing.
   *
   * Not spent, which is the whole shape of it: an ink is a *key*, and the
   * colour it opens stays open. A consumable would make the seven a currency
   * to hoard and the printer a shop; a key makes finding one the event, which
   * is what a thing hidden in a cabin at the far end of the world should be.
   */
  | "ink"
  /** Given to a creature to carry, and it does something while carried. */
  | "hold"
  /** The same, but eaten and gone the moment it does it. */
  | "berry";

export interface ItemSpec {
  id: string;
  name: string;
  kind: ItemKind;
  /** Something you open and read from the bag, and which screen it opens. Nothing in the engine reads it. */
  reads?: "handbook" | "feed";
  /** Opened from the bag into other items, like a Secret Gift. See `giftContents` in tutor.ts. */
  opens?: boolean;
  /** What a Mart charges. Zero means it is not for sale at any price. */
  price: number;
  /** What a Mart pays for one. Never above `price`, or a bag is a mint. */
  sell: number;
  blurb: string;
  /**
   * Equipment is held once and kept; everything else stacks. A second Old Rod
   * is not twice the rod.
   */
  stacks: boolean;
  /** Balls: catch multiplier in per-mille, against `catchOdds`. */
  ballMult?: number;
  /** Balls: a condition that changes the multiplier. See `ballMultiplier`. */
  ballRule?: "master" | "quick" | "timer" | "net" | "nest" | "level" | "fast" | "dive";
  /** Medicine: how much health it returns. `Infinity` is a full heal. */
  heals?: number;
  /** Medicine: whether it clears a status condition. */
  cures?: boolean;
  /** Medicine: whether it works on something already fainted, and to what. */
  revives?: number;
  /** Rare Candy: levels granted. */
  levels?: number;
  /** HMs: what the tool does out in the world, for the bag to describe. */
  field?: "clear" | "cross" | "light" | "travel";
  /** Rods: how far out the water they reach — a higher number fishes deeper
   * tables, the same way a further ring holds better things. */
  reach?: number;
  /**
   * Breeding: what this adds to the climb, in basis points.
   *
   * Flat rather than a multiplier, and additive with every other one held,
   * because a stack of multipliers is a number nobody can predict from the
   * labels. A hundred basis points is one percent.
   */
  climbBonus?: number;
  /** Breeding: spent when the egg is produced rather than kept. */
  consumed?: boolean;
  /**
   * Breeding: percentage points of chance that each IV not already mutating
   * mutates anyway. Additive across items; see `mutationBonus`.
   */
  mutationBonus?: number;
  /** Daycare: steps taken off the pair's wait for an egg, before any percentage. */
  pairFlat?: number;
  /** Daycare: percent off the pair's wait, applied after the flat cuts. */
  pairPercent?: number;
  /** Daycare: percent off the hatch steps of an egg taken while applied. */
  hatchPercent?: number;
  /** Daycare: incubators it adds, where eggs wait and hatch into the box. */
  incubatorSlots?: number;
  /** Lures: what draws, and how far down the route's census it can reach. */
  lure?: LureSpec;
  /** Machines: the move it teaches. */
  teaches?: string;
  /**
   * Stones: that this is one. *Which* species it changes is not listed here.
   *
   * The manifest already carries every item evolution — sixty-eight of them,
   * each naming the item as a display string — and `species.ts` says in as
   * many words that it kept them "so that the item system does not need the
   * manifest regenerated to arrive". So the relation is read from there,
   * matched on `name`, and a stone knows nothing about what it is for. Listing
   * twenty-two stones against sixty-eight species here would be a second copy
   * of a table the manifest already has, free to disagree with it.
   */
  evolves?: true;
  /**
   * Tonics: what it does to one stat's effort, and which stat.
   *
   * Positive for a vitamin, negative for the berries that take it back out
   * again. Both go through `gainEffort`'s caps, so nothing here can mint an
   * illegal creature.
   */
  effort?: { stat: StatId; delta: number };
  /** Mints: the nature it settles on. */
  natureId?: string;
  /**
   * Repels: how many moves of quiet grass it buys.
   *
   * The same shape as a lure, and for the same reason: an expiry written down
   * once beats a counter decremented on every step. A repel is a lure run
   * backwards, so it lives in the same record.
   */
  repel?: number;
  /** Escape Rope: that using it puts you back in town. */
  escape?: true;
  /** Heart Scale: that it offers back a move the creature has grown past. */
  relearn?: true;
}

/**
 * What a lure attracts.
 *
 * `pull` is a number of encounter slots, not a probability, because a variant
 * in this world is a property of a place rather than a die roll: there is no
 * chance to raise, only a distance to close.
 */
export interface LureSpec {
  /** Anything above the bottom rung of the shine ladder. */
  shine?: boolean;
  /** One particular colour. */
  chromaId?: string;
  /** How many encounters ahead it can reach. */
  pull: number;
}

/** How long a lure burns for, in moves. */
export const LURE_MOVES = 500;

/** How many encounters ahead a lure can reach. */
const LURE_PULL = 6;

const ITEM_LIST: ItemSpec[] = [
  // --------------------------------------------------------------- balls
  {
    id: "pokeball",
    name: "Poké Ball",
    kind: "ball",
    price: 200,
    sell: 100,
    blurb: "Throw at a wild creature to try to catch it. Normal catch rate (×1). B throws one.",
    stacks: true,
    ballMult: 1000,
  },
  {
    id: "greatball",
    name: "Great Ball",
    kind: "ball",
    price: 600,
    sell: 300,
    blurb: "Throw at a wild creature to try to catch it. 1.5× the catch rate of a Poké Ball.",
    stacks: true,
    ballMult: 1500,
  },
  {
    id: "ultraball",
    name: "Ultra Ball",
    kind: "ball",
    price: 1200,
    sell: 600,
    blurb: "Throw at a wild creature to try to catch it. 2× the catch rate of a Poké Ball.",
    stacks: true,
    ballMult: 2000,
  },
  {
    id: "quickball",
    name: "Quick Ball",
    kind: "ball",
    price: 1000,
    sell: 500,
    blurb: "5× the catch rate of a Poké Ball if thrown on the first turn of a battle; 1× after that.",
    stacks: true,
    ballMult: 1000,
    ballRule: "quick",
  },
  {
    id: "timerball",
    name: "Timer Ball",
    kind: "ball",
    price: 1000,
    sell: 500,
    blurb: "1× on the first turn, +0.3× for every turn the battle has gone on, up to 4×.",
    stacks: true,
    ballMult: 1000,
    ballRule: "timer",
  },
  {
    id: "netball",
    name: "Net Ball",
    kind: "ball",
    price: 1000,
    sell: 500,
    blurb: "3.5× the catch rate of a Poké Ball against Water and Bug types; 1× against anything else.",
    stacks: true,
    ballMult: 1000,
    ballRule: "net",
  },
  {
    id: "nestball",
    name: "Nest Ball",
    kind: "ball",
    price: 1000,
    sell: 500,
    blurb: "Better the lower the wild creature's level: 4× at level 1, falling to 1.2× at level 29, 1× from level 30.",
    stacks: true,
    ballMult: 1000,
    ballRule: "nest",
  },
  {
    id: "levelball",
    name: "Level Ball",
    kind: "ball",
    price: 1000,
    sell: 500,
    blurb: "2× if your creature out is a higher level than the wild one, 4× if double its level, 8× if four times.",
    stacks: true,
    ballMult: 1000,
    ballRule: "level",
  },
  {
    id: "fastball",
    name: "Fast Ball",
    kind: "ball",
    price: 1000,
    sell: 500,
    blurb: "4× the catch rate of a Poké Ball against a species with base Speed 100 or more; 1× otherwise.",
    stacks: true,
    ballMult: 1000,
    ballRule: "fast",
  },
  {
    id: "diveball",
    name: "Dive Ball",
    kind: "ball",
    price: 1000,
    sell: 500,
    blurb: "3.5× the catch rate of a Poké Ball against something you hooked with a rod; 1× otherwise.",
    stacks: true,
    ballMult: 1000,
    ballRule: "dive",
  },
  {
    id: "masterball",
    name: "Master Ball",
    kind: "ball",
    price: 50000,
    sell: 25000,
    blurb: "Catches any wild creature without fail.",
    stacks: true,
    ballMult: 1000,
    ballRule: "master",
  },

  // ------------------------------------------------------------ medicine
  {
    id: "potion",
    name: "Potion",
    kind: "medicine",
    price: 300,
    sell: 150,
    blurb: "Restores 20 HP to one creature.",
    stacks: true,
    heals: 20,
  },
  {
    id: "superpotion",
    name: "Super Potion",
    kind: "medicine",
    price: 700,
    sell: 350,
    blurb: "Restores 60 HP to one creature.",
    stacks: true,
    heals: 60,
  },
  {
    id: "hyperpotion",
    name: "Hyper Potion",
    kind: "medicine",
    price: 1500,
    sell: 750,
    blurb: "Restores 150 HP to one creature.",
    stacks: true,
    heals: 150,
  },
  {
    id: "fullrestore",
    name: "Full Restore",
    kind: "medicine",
    price: 3000,
    sell: 1500,
    blurb: "Restores all HP and cures burn, poison, paralysis, sleep or freeze.",
    stacks: true,
    heals: Number.POSITIVE_INFINITY,
    cures: true,
  },
  {
    id: "fullheal",
    name: "Full Heal",
    kind: "medicine",
    price: 600,
    sell: 300,
    blurb: "Cures burn, poison, paralysis, sleep or freeze. Restores no HP.",
    stacks: true,
    cures: true,
  },
  {
    id: "revive",
    name: "Revive",
    kind: "medicine",
    price: 2000,
    sell: 1000,
    blurb: "Revives a fainted creature with half its max HP.",
    stacks: true,
    revives: 2,
  },
  {
    id: "rarecandy",
    name: "Rare Candy",
    kind: "medicine",
    price: 6000,
    sell: 2400,
    blurb: "Raises a creature one level. It learns moves and evolves as if it had levelled by fighting.",
    stacks: true,
    levels: 1,
  },

  // ---------------------------------------------------------------- rods
  {
    id: "oldrod",
    name: "Old Rod",
    kind: "rod",
    price: 500,
    sell: 250,
    blurb: "Fish from beside water. Reaches only the shallow-water table (reach 1 of 3). Never used up.",
    stacks: false,
    reach: 1,
  },
  {
    id: "goodrod",
    name: "Good Rod",
    kind: "rod",
    price: 3000,
    sell: 1500,
    blurb: "Fish from beside water. Reaches the shallow and middle tables (reach 2 of 3). Never used up.",
    stacks: false,
    reach: 2,
  },
  {
    id: "superrod",
    name: "Super Rod",
    kind: "rod",
    price: 9000,
    sell: 4500,
    blurb: "Fish from beside water. Reaches every water table (reach 3 of 3). Never used up.",
    stacks: false,
    reach: 3,
  },

  // --------------------------------------------------------------- lures
  //
  // A lure does not make a shiny. Nothing does: this world decides what is
  // rare and where it stands when it is generated, and an item that could
  // roll one into existence would take the census apart. What a lure does is
  // close the distance — while it is burning, the next unusual thing on this
  // route comes to you sooner, and the ordinary encounters between here and
  // there are what you pay for it.
  //
  // It will never walk you past something rare to reach something rarer. A
  // Chroma Lure that found a true shiny two slots ahead simply does not fire,
  // because a hunting aid that can burn the thing you were hunting is a trap
  // wearing an item's clothes.
  {
    id: "lure-shiny",
    name: "Shiny Lure",
    kind: "lure",
    price: 12000,
    sell: 4000,
    blurb: `For ${LURE_MOVES} moves, a shiny creature up to ${LURE_PULL} encounters ahead on this route comes to you sooner. It does not create shinies.`,
    stacks: true,
    lure: { shine: true, pull: LURE_PULL },
  },
  ...CHROMA_IDS.map((id) => ({
    id: `lure-${id}`,
    name: `${chroma(id).name} Lure`,
    kind: "lure" as const,
    price: 6000,
    sell: 2000,
    blurb: `For ${LURE_MOVES} moves, a ${chroma(id).name.toLowerCase()} creature up to ${LURE_PULL} encounters ahead on this route comes to you sooner. It does not create colours.`,
    stacks: true,
    lure: { chromaId: id, pull: LURE_PULL },
  })),

  // ------------------------------------------------------------ treasure
  {
    id: "nugget",
    name: "Nugget",
    kind: "treasure",
    price: 0,
    sell: 5000,
    blurb: "No use. Sells to a Mart for 5,000.",
    stacks: true,
  },
  {
    id: "pearl",
    name: "Pearl",
    kind: "treasure",
    price: 0,
    sell: 1400,
    blurb: "Part of the Ability Tutor's price, now and then. Otherwise sells to a Mart for 1,400.",
    stacks: true,
  },
  {
    id: "chromacandy",
    name: "Chroma Candy",
    kind: "treasure",
    price: 0,
    sell: 0,
    blurb: "The Colour Collector pays it for creatures wearing a colour; the Ability Tutor takes it as part of a price. Worth nothing to a Mart.",
    stacks: true,
  },
  {
    id: "secretgift",
    name: "Secret Gift",
    kind: "treasure",
    price: 0,
    sell: 0,
    blurb: "From the Gift Swapper. Open it from the bag: usually potions or berries, sometimes a stone, pearls, Chroma Candy, Glitter or a machine.",
    stacks: true,
    opens: true,
  },
];


/**
 * The tools.
 *
 * Every one of them is a key shaped like a verb: somewhere out there is ground
 * you cannot cross, and this is the thing that answers it. They are found and
 * kept rather than bought, they never run out, and they are used from the bag
 * like anything else — there is no separate move slot to spend on carrying the
 * world's plumbing around.
 *
 * Three of them take an obstacle away for good and write that to the save.
 * Five are something you are *doing* rather than something you did: step off
 * the water and it is water again, so those are a question asked of the bag
 * every time you move rather than a change to the map.
 */
const TOOLS: ItemSpec[] = [
  {
    // Carried, never used: while it is in the bag every egg shows its exact
    // steps instead of a guess.
    id: "eggometer",
    name: "Egg-o-meter",
    kind: "hm",
    price: 0,
    sell: 0,
    blurb: "Tool. While you carry it, every egg shows exactly how many steps it has left. Given for hatching fifteen eggs.",
    stacks: false,
  },
  {
    id: "hm-cut",
    name: "Cut",
    kind: "hm",
    price: 0,
    sell: 0,
    blurb: "Use from the bag beside a bush to remove it for good. Never used up.",
    stacks: false,
    field: "clear",
  },
  {
    id: "hm-strength",
    name: "Strength",
    kind: "hm",
    price: 0,
    sell: 0,
    blurb: "Use from the bag beside a boulder to remove it for good. Never used up.",
    stacks: false,
    field: "clear",
  },
  {
    id: "hm-rocksmash",
    name: "Rock Smash",
    kind: "hm",
    price: 0,
    sell: 0,
    blurb: "Use from the bag beside cracked rock to remove it for good. Never used up.",
    stacks: false,
    field: "clear",
  },
  {
    id: "hm-surf",
    name: "Surf",
    kind: "hm",
    price: 0,
    sell: 0,
    blurb: "While it is in your bag, you can walk across open water.",
    stacks: false,
    field: "cross",
  },
  {
    id: "hm-waterfall",
    name: "Waterfall",
    kind: "hm",
    price: 0,
    sell: 0,
    blurb: "While it is in your bag, you can climb waterfalls. You need Surf as well to reach one.",
    stacks: false,
    field: "cross",
  },
  {
    id: "hm-whirlpool",
    name: "Whirlpool",
    kind: "hm",
    price: 0,
    sell: 0,
    blurb: "While it is in your bag, you can pass through whirlpools.",
    stacks: false,
    field: "cross",
  },
  {
    id: "hm-dive",
    name: "Dive",
    kind: "hm",
    price: 0,
    sell: 0,
    blurb: "While it is in your bag, you can cross deep water by diving under it.",
    stacks: false,
    field: "cross",
  },
  {
    id: "hm-rockclimb",
    name: "Rock Climb",
    kind: "hm",
    price: 0,
    sell: 0,
    blurb: "While it is in your bag, you can climb cliff faces.",
    stacks: false,
    field: "cross",
  },
  {
    id: "hm-flash",
    name: "Flash",
    kind: "hm",
    price: 0,
    sell: 0,
    blurb: "While it is in your bag, the dark outer rings are lit. Without it you see three tiles around you.",
    stacks: false,
    field: "light",
  },
  {
    id: "hm-fly",
    name: "Fly",
    kind: "hm",
    price: 0,
    sell: 0,
    blurb: "Use from the bag to travel instantly to any place you have already visited. Never used up.",
    stacks: false,
    field: "travel",
  },
];

/**
 * One machine per move a machine can teach.
 *
 * Named after the move rather than numbered. Every real game numbers its own
 * hundred and renumbers them the next generation, and the data ships no
 * numbering at all — so "TM Flamethrower" is the one name that cannot quietly
 * disagree with a game somebody remembers, and it sorts and searches the way
 * a player actually looks for one.
 *
 * They are kept rather than spent. There are three hundred of them and they
 * are found rather than sold, so a machine that vanished after one use would
 * be a thing you could not afford to use on anything but your best creature —
 * which is the opposite of what a shelf of teachable moves is for.
 *
 * Not stocked anywhere: a Mart list three hundred rows long is not a shop.
 * They come off the floor, out of people's hands, and out of finished jobs.
 */
const MACHINES: ItemSpec[] = MACHINE_MOVES.map((moveId) => {
  const move = moveById(moveId);
  return {
    id: `tm-${moveId}`,
    name: `TM ${move.name}`,
    kind: "tm" as const,
    price: 0,
    sell: 1200,
    blurb: `Teaches ${move.name} — ${move.type}, ${
      move.category === "status" ? "status" : `${move.power} power`
    }. Never used up: teach it to as many creatures as you like.`,
    stacks: false,
    teaches: moveId,
  };
});

/** Things that are not for using, selling or throwing — only for having. */
const KEYS: ItemSpec[] = [
  {
    id: "worldcup",
    name: "World Cup Invitation",
    kind: "key",
    price: 0,
    sell: 0,
    blurb: "Key item. Given for eight badges; it lets you enter the World Cup.",
    stacks: false,
  },
  {
    id: "handbook",
    name: "Pokémon Handbook",
    kind: "key",
    price: 0,
    sell: 0,
    blurb: "Key item. Every shine rung and colour and what each does to a stat, every ability, and every item. Open it from the bag.",
    stacks: false,
    reads: "handbook",
  },
  {
    // A feed of every clock in the game, which is a joke about a thing you
    // cannot stop checking, told by a thing you cannot stop checking.
    id: "doomscroller",
    name: "Doomscroller",
    kind: "key",
    price: 0,
    sell: 0,
    blurb: "Key item. A feed of every countdown you have running — the printer, the wheel, the shredder, the pawnbroker, the tutor, the workshop, the auction and your eggs — and posts when a lot you bid on has closed. Given once you have met six of the people who run something.",
    stacks: false,
    reads: "feed",
  },
];

/**
 * Ways to buy the climb outright, in ascending order of how far you have to
 * walk for one.
 *
 * A light word each, because they are the same thing at several strengths and
 * a family of names says that faster than a table would. The last two of the
 * five sit on the outermost ring, which is the hardest thing this world has to
 * ask for — and then there is the Cup, which is not on the floor anywhere and
 * is the largest of them by half again. It is the only one that is won.
 */
const CLIMB_ITEMS: { id: string; name: string; blurb: string; climbBonus: number }[] = [
  {
    id: "thecup",
    name: "The Cup",
    blurb:
      "Daycare: +15 percentage points on each egg's chance to gain a shine rung while it is applied. Never used up. There is only one, won at the Cup.",
    climbBonus: 1500,
  },
  { id: "glint", name: "Glint", blurb: "Daycare: +1 percentage point on each egg's chance to gain a shine rung while it is applied. Never used up.", climbBonus: 100 },
  { id: "gleam", name: "Gleam", blurb: "Daycare: +2 percentage points on each egg's chance to gain a shine rung while it is applied. Never used up.", climbBonus: 200 },
  { id: "lustre", name: "Lustre", blurb: "Daycare: +3 percentage points on each egg's chance to gain a shine rung while it is applied. Never used up.", climbBonus: 300 },
  { id: "radiance", name: "Radiance", blurb: "Daycare: +5 percentage points on each egg's chance to gain a shine rung while it is applied. Never used up.", climbBonus: 500 },
  {
    id: "brilliance",
    name: "Brilliance",
    blurb: "Daycare: +10 percentage points on each egg's chance to gain a shine rung while it is applied. Never used up.",
    climbBonus: 1000,
  },
];

/**
 * The breeding equipment, folded into the same catalogue.
 *
 * They were a separate list with their own names and blurbs, which meant the
 * bag had to know about two kinds of thing. They are items; they are found
 * rather than sold, so their price is zero and a Mart will not stock them.
 */
const BREEDING_ITEMS: ItemSpec[] = [
  { id: "heirloom", name: "Heirloom", blurb: "Daycare: 5 of each egg's 6 IVs mutate upward instead of 3. Never used up." },
  { id: "talisman", name: "Talisman", blurb: "Daycare: each egg always gets the first parent's nature. Never used up." },
  { id: "catalyst", name: "Catalyst", blurb: "Daycare: IVs that mutate go up by 2–5 points instead of 1–3. Never used up." },
  // The rare three. They stack with each other, with the Heirloom and with the
  // Catalyst: the Heirloom decides how many IVs are sure to mutate, these give
  // the rest a chance, and the Catalyst decides how far each one goes.
  {
    id: "sporeofchange",
    name: "Spore of Change",
    blurb: "Daycare: each IV that would not mutate gets a 10% chance to mutate anyway. Stacks with the other two. Never used up.",
    mutationBonus: 10,
  },
  {
    id: "livingamber",
    name: "Living Amber",
    blurb: "Daycare: each IV that would not mutate gets a 20% chance to mutate anyway. Stacks with the other two. Never used up.",
    mutationBonus: 20,
  },
  {
    id: "primordialseed",
    name: "Primordial Seed",
    blurb: "Daycare: each IV that would not mutate gets a 35% chance to mutate anyway. Stacks with the other two. Never used up.",
    mutationBonus: 35,
  },
  { id: "prism", name: "Prism", blurb: "Daycare: each egg's base chance to gain a shine rung goes from 1% to 5%. Never used up." },
  ...CHROMA_IDS.map((id) => ({
    id: `lens-${id}`,
    name: `${id.charAt(0).toUpperCase()}${id.slice(1)} Lens`,
    blurb: `Daycare: each egg has a 10% chance to be ${id}, whatever colour its parents are. Never used up.`,
  })),
  // The light family: five flat additions to the climb, sitting further and
  // further out. They add to each other and to everything else, which is the
  // point of stating them flat — a player holding three of them can work out
  // what they are worth without running the engine in their head.
  ...CLIMB_ITEMS,
].map((entry) => ({
  ...entry,
  kind: "breeding" as const,
  price: 0,
  // Found, never sold: a player who sells the only Prism in their world has
  // not made a trade, they have lost something the world contains once.
  sell: 0,
  stacks: false,
}));

/**
 * The daycare's working kit: a shorter wait for the pair, a shorter hatch, and
 * incubators. The first of each kind is on the Mart's shelf, because these
 * change how long breeding takes rather than how good it is, and waiting less
 * is something money can fairly buy. The stronger ones are out in the world.
 *
 * All of them are applied at the daycare like the rest and never used up.
 */
const DAYCARE_GEAR: ItemSpec[] = [
  {
    id: "pairingbell",
    name: "Pairing Bell",
    price: 6000,
    sell: 3000,
    blurb: "Daycare: the pair lays an egg 50 steps sooner. Flat cuts come off before any percentage. Never used up.",
    pairFlat: 50,
  },
  {
    id: "courtingsong",
    name: "Courting Song",
    price: 0,
    sell: 0,
    blurb: "Daycare: the pair lays an egg 100 steps sooner. Flat cuts come off before any percentage. Never used up.",
    pairFlat: 100,
  },
  {
    id: "roseincense",
    name: "Rose Incense",
    price: 10000,
    sell: 5000,
    blurb: "Daycare: the pair's wait for an egg is 20% shorter, taken after any flat cuts. Never used up.",
    pairPercent: 20,
  },
  {
    id: "moonlitcharm",
    name: "Moonlit Charm",
    price: 0,
    sell: 0,
    blurb: "Daycare: the pair's wait for an egg is 40% shorter, taken after any flat cuts. Never used up.",
    pairPercent: 40,
  },
  {
    id: "warmblanket",
    name: "Warm Blanket",
    price: 8000,
    sell: 4000,
    blurb: "Daycare: eggs taken while this is applied hatch in 15% fewer steps. Stacks, up to 75%. Never used up.",
    hatchPercent: 15,
  },
  {
    id: "embercradle",
    name: "Ember Cradle",
    price: 0,
    sell: 0,
    blurb: "Daycare: eggs taken while this is applied hatch in 30% fewer steps. Stacks, up to 75%. Never used up.",
    hatchPercent: 30,
  },
  {
    id: "incubator",
    name: "Incubator",
    price: 15000,
    sell: 7500,
    blurb: "Daycare: one incubator. An egg left in it hatches as you walk, without a party slot, and goes to the box. Never used up.",
    incubatorSlots: 1,
  },
  {
    id: "broodlamp",
    name: "Brood Lamp",
    price: 0,
    sell: 0,
    blurb: "Daycare: one more incubator. Eggs left in it hatch as you walk and go to the box. Never used up.",
    incubatorSlots: 1,
  },
  {
    id: "hatcherystone",
    name: "Hatchery Stone",
    price: 0,
    sell: 0,
    blurb: "Daycare: two more incubators, up to four in all. Eggs left in them hatch as you walk and go to the box. Never used up.",
    incubatorSlots: 2,
  },
  {
    // Sold by one man in Hearth for fifty thousand, never at a Mart.
    id: "egginsurance",
    name: "Egg Insurance",
    price: 0,
    sell: 0,
    blurb: "Daycare: while applied, an ordinary egg — no shine, no colour — hatching in an incubator pays out a Glitter or a Chroma Candy. Never used up. Sold by the Egg Insurance salesman in Hearth.",
  },
].map((entry) => ({ ...entry, kind: "breeding" as const, stacks: false }));

/**
 * Glitter, which is the other half of what the Appraiser in the north pays.
 *
 * Alone among the breeding equipment it is a consumable: it is spent the
 * moment the egg is produced, whatever the egg turned out to be. That is what
 * keeps a pile of it from becoming a permanent ten percent — it buys attempts,
 * not a better world, and the only way to get more is to give up more shine.
 */
const GLITTER: ItemSpec = {
  id: "glitter",
  name: "Glitter",
  kind: "breeding",
  price: 0,
  sell: 800,
  blurb: "Daycare: +10 percentage points on the next egg's chance to gain a shine rung. Used up when that egg appears.",
  stacks: true,
  climbBonus: 1000,
  consumed: true,
};


/**
 * The stones, read off the manifest rather than listed.
 *
 * Every item evolution the bestiary carries names its item as a display
 * string, so the set of stones that exist is exactly the set of names those
 * evolutions mention — twenty-two of them, covering sixty-seven species. Hand
 * a different bestiary to the build script and the shelf restocks itself.
 *
 * Priced by how many doors it opens, and *all* of them priced. The first cut
 * left the twelve one-door stones off the shelf entirely, to be found instead
 * — which read well and was wrong: with twelve of them sharing one slot in the
 * drop table, a given one turned up in fewer than one world in twelve, so the
 * only way a Sinistea could ever become a Polteageist was a die roll made
 * before the player existed. A locked door with no key cut is worse than a
 * boring shop row, and the shop has shelves now, so the row is not even
 * boring.
 *
 * The specialist ones cost double. A Fire Stone is on every shelf in every
 * game ever made; a Masterpiece Teacup is a thing you go in asking for.
 */
const STONE_PRICE = 2100;
const SPECIALIST_STONE_PRICE = 4200;

function stoneItems(): ItemSpec[] {
  const opens = new Map<string, string[]>();
  for (const entry of ALL_SPECIES) {
    for (const step of entry.evolvesTo) {
      if (step.method !== "useItem" || !step.item) continue;
      const already = opens.get(step.item) ?? [];
      // A species can have two doors behind one stone — Pikachu takes a
      // Thunder Stone to either Raichu — and naming it twice reads as a bug.
      if (!already.includes(entry.name)) opens.set(step.item, [...already, entry.name]);
    }
  }

  return [...opens.entries()]
    .sort(([a, one], [b, two]) => two.length - one.length || a.localeCompare(b))
    .map(([name, who]) => {
      const common = who.length > 1;
      const price = common ? STONE_PRICE : SPECIALIST_STONE_PRICE;
      return {
        id: `stone-${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}`,
        name,
        kind: "stone" as const,
        price,
        sell: Math.floor(price / 2),
        blurb:
          who.length > 3
            ? `Evolves ${who.slice(0, 3).join(", ")} and ${who.length - 3} more. Used up when it works.`
            : `Evolves ${who.join(" and ")}. Used up when it works.`,
        stacks: true,
        evolves: true as const,
      };
    });
}

/**
 * Used like a stone, for the evolutions that were not a stone: the trades, and
 * a few that wanted something this game has no other way to give. The rules
 * are in evolutions.ts, matched on these names.
 */
const EVOLUTION_USE_ITEMS: ItemSpec[] = [
  {
    id: "stone-linkingcord",
    name: "Linking Cord",
    kind: "stone",
    price: SPECIALIST_STONE_PRICE,
    sell: Math.floor(SPECIALIST_STONE_PRICE / 2),
    blurb: "Stands in for a trade: evolves Kadabra, Machoke, Graveler, Haunter and the rest of the trade evolutions — and the ones that wanted an item, if it is holding that item. Used up when it works.",
    stacks: true,
    evolves: true,
  },
  {
    id: "stone-peatblock",
    name: "Peat Block",
    kind: "stone",
    price: SPECIALIST_STONE_PRICE,
    sell: Math.floor(SPECIALIST_STONE_PRICE / 2),
    blurb: "Evolves Ursaring into Ursaluna. Used up when it works.",
    stacks: true,
    evolves: true,
  },
  {
    id: "stone-blackaugurite",
    name: "Black Augurite",
    kind: "stone",
    price: SPECIALIST_STONE_PRICE,
    sell: Math.floor(SPECIALIST_STONE_PRICE / 2),
    blurb: "Evolves Scyther into Kleavor. Used up when it works.",
    stacks: true,
    evolves: true,
  },
  {
    id: "stone-strawberrysweet",
    name: "Strawberry Sweet",
    kind: "stone",
    price: SPECIALIST_STONE_PRICE,
    sell: Math.floor(SPECIALIST_STONE_PRICE / 2),
    blurb: "Evolves Milcery into Alcremie. Used up when it works.",
    stacks: true,
    evolves: true,
  },
  {
    id: "stone-scrollofdarkness",
    name: "Scroll of Darkness",
    kind: "stone",
    price: SPECIALIST_STONE_PRICE,
    sell: Math.floor(SPECIALIST_STONE_PRICE / 2),
    blurb: "Evolves Kubfu into Single Strike Urshifu. Used up when it works.",
    stacks: true,
    evolves: true,
  },
  {
    id: "stone-scrollofwaters",
    name: "Scroll of Waters",
    kind: "stone",
    price: SPECIALIST_STONE_PRICE,
    sell: Math.floor(SPECIALIST_STONE_PRICE / 2),
    blurb: "Evolves Kubfu into Rapid Strike Urshifu. Used up when it works.",
    stacks: true,
    evolves: true,
  },
  {
    id: "stone-gimmighoulcoin",
    name: "Gimmighoul Coin",
    kind: "stone",
    price: SPECIALIST_STONE_PRICE,
    sell: Math.floor(SPECIALIST_STONE_PRICE / 2),
    blurb: "Evolves Gimmighoul into Gholdengo. Used up when it works.",
    stacks: true,
    evolves: true,
  },
];

const STONES: ItemSpec[] = [...stoneItems(), ...EVOLUTION_USE_ITEMS];

/**
 * The vitamins, and the berries that undo them.
 *
 * Effort is the one stat input a player controls completely, and until now the
 * only way to move it was to go and fight the right thing — which meant a
 * misspent creature was misspent for good. Ten points a bottle in one
 * direction and ten a berry in the other makes the 510 budget something you
 * can change your mind about, which is what makes spending it a decision
 * rather than a risk.
 *
 * Both go through `gainEffort`, so the per-stat 252 and the total 510 are
 * enforced in one place and no bottle can mint an illegal creature.
 */
const EFFORT_STEP = 10;

const VITAMINS: { id: string; name: string; stat: StatId; what: string }[] = [
  { id: "hpup", name: "HP Up", stat: "hp", what: "health" },
  { id: "protein", name: "Protein", stat: "atk", what: "attack" },
  { id: "iron", name: "Iron", stat: "def", what: "defence" },
  { id: "calcium", name: "Calcium", stat: "spa", what: "special attack" },
  { id: "zinc", name: "Zinc", stat: "spd", what: "special defence" },
  { id: "carbos", name: "Carbos", stat: "spe", what: "speed" },
];

/** One berry per stat, named as the games name them. */
const EFFORT_BERRIES: { id: string; name: string; stat: StatId; what: string }[] = [
  { id: "pomeg", name: "Pomeg Berry", stat: "hp", what: "health" },
  { id: "kelpsy", name: "Kelpsy Berry", stat: "atk", what: "attack" },
  { id: "qualot", name: "Qualot Berry", stat: "def", what: "defence" },
  { id: "hondew", name: "Hondew Berry", stat: "spa", what: "special attack" },
  { id: "grepa", name: "Grepa Berry", stat: "spd", what: "special defence" },
  { id: "tamato", name: "Tamato Berry", stat: "spe", what: "speed" },
];

const TONICS: ItemSpec[] = [
  ...VITAMINS.map((entry) => ({
    id: entry.id,
    name: entry.name,
    kind: "tonic" as const,
    price: 1400,
    sell: 700,
    blurb: `+10 ${entry.what} EVs. Stops at 252 in one stat and 510 in total.`,
    stacks: true,
    effort: { stat: entry.stat, delta: EFFORT_STEP },
  })),
  ...EFFORT_BERRIES.map((entry) => ({
    id: entry.id,
    name: entry.name,
    kind: "tonic" as const,
    price: 600,
    sell: 300,
    blurb: `−10 ${entry.what} EVs, so they can be spent on another stat.`,
    stacks: true,
    effort: { stat: entry.stat, delta: -EFFORT_STEP },
  })),
];

/**
 * The mints: twenty-five of them, one per nature.
 *
 * Natures here are additive vectors rather than multipliers, which makes a
 * mint unusually honest — it moves a stat screen by exactly twenty-four
 * points in one direction and twenty-four in the other, and the screen says
 * so. The five neutral natures get a mint too, because "take this creature's
 * nature off it" is a thing somebody will want and there is no reason to make
 * them hunt for which of the five is the neutral one.
 *
 * Priced above a vitamin. A nature is the one thing breeding cannot reliably
 * aim at without a Talisman, so a mint is the shortcut and shortcuts cost.
 */
/** Stat names as the stat screen prints them, for the mint labels. */
const STAT_WORDS: Record<StatId, string> = {
  hp: "HP",
  atk: "Attack",
  def: "Defence",
  spa: "Sp. Atk",
  spd: "Sp. Def",
  spe: "Speed",
};

const MINTS: ItemSpec[] = NATURES.map((entry) => ({
  id: `mint-${entry.id}`,
  name: `${entry.name} Mint`,
  kind: "tonic" as const,
  price: 4800,
  sell: 2400,
  blurb:
    entry.plus && entry.minus
      ? `Changes a creature's nature to ${entry.name}: +${NATURE_MAGNITUDE} ${STAT_WORDS[entry.plus]}, −${NATURE_MAGNITUDE} ${STAT_WORDS[entry.minus]}.`
      : `Changes a creature's nature to ${entry.name}, which raises and lowers nothing.`,
  stacks: true,
  natureId: entry.id,
}));

/**
 * The things used on the world rather than on a creature.
 *
 * A repel is a lure run backwards and shares its machinery exactly: an expiry
 * written down when it is lit, swept when the next one is, and never a counter
 * decremented on every step. Which means the answer to "is the grass quiet"
 * is derived from the same record that answers "is anything being drawn", and
 * the two can never disagree about what move it is.
 */
const FIELD_ITEMS: ItemSpec[] = [
  {
    id: "repel",
    name: "Repel",
    kind: "field",
    price: 400,
    sell: 200,
    blurb:
      "No wild encounters in grass for 200 moves. Whatever you skipped is still there, in the same order, when it wears off.",
    stacks: true,
    repel: 200,
  },
  {
    id: "superrepel",
    name: "Super Repel",
    kind: "field",
    price: 700,
    sell: 350,
    blurb: "No wild encounters in grass for 500 moves.",
    stacks: true,
    repel: 500,
  },
  {
    id: "maxrepel",
    name: "Max Repel",
    kind: "field",
    price: 900,
    sell: 450,
    blurb: "No wild encounters in grass for 1,000 moves.",
    stacks: true,
    repel: 1000,
  },
  {
    id: "escaperope",
    name: "Escape Rope",
    kind: "field",
    price: 550,
    sell: 275,
    blurb: "Teleports you back to Hearth from anywhere. Used up.",
    stacks: true,
    escape: true,
  },
  {
    id: "heartscale",
    name: "Heart Scale",
    kind: "field",
    price: 0,
    sell: 900,
    blurb:
      "Gives a creature back one level-up move it has forgotten. Used up.",
    stacks: true,
    relearn: true,
  },
];

/**
 * The things a creature carries, folded in from carry.ts.
 *
 * What each one *does* lives there, beside the vocabulary the battle reads;
 * what it costs and what shelf it sits on lives here, beside every other
 * thing a bag can hold. Two files, one catalogue, and neither has to know the
 * other's job: items.ts never imports the battle, and carry.ts never needs a
 * price.
 *
 * Berries are their own kind rather than "medicine you hold", because the bag
 * has to sort them apart: a Potion is a thing you use and an Oran Berry is a
 * thing you give to somebody to keep.
 */
const HOLDABLE: ItemSpec[] = HELD_ITEMS.map((entry) => ({
  id: entry.id,
  name: entry.name,
  kind: entry.id.startsWith("berry-") ? ("berry" as const) : ("hold" as const),
  price: entry.price,
  // Half, like everything else with a price; the ones nobody stocks are worth
  // something at the counter anyway, because they are found.
  sell: entry.sell ?? (entry.price > 0 ? Math.floor(entry.price / 2) : 400),
  blurb: entry.blurb,
  // Held items stack in the bag: two Leftovers is two creatures with
  // Leftovers, which is not the same claim as "a second rod is not twice the
  // rod". Only one can be held at a time, and that is enforced on the
  // creature rather than on the bag.
  stacks: true,
}));


/**
 * The things the three outer towns sell, hand out and leave lying about.
 *
 * Each town is an homage to a programme and everything in it leans the same
 * way, down to the shelf in the Mart — a town whose people are a joke and whose
 * shop is generic is a set with a shop painted on it.
 *
 * They are real items rather than souvenirs: the snack heals, the soda spends
 * effort, the box is a full heal that goes away when it has done its one job.
 * A reference you cannot use is a label, and this game does not have labels.
 */
const TOWN_ITEMS: readonly ItemSpec[] = [
  // ---------------------------------------------------- Southpass, up in the
  // mountains, where the children are unsupervised and it is nobody's fault.
  {
    id: "cheesypuffs",
    name: "Cheesy Puffs",
    kind: "medicine",
    price: 250,
    sell: 60,
    blurb: "Returns 25 health. There is no nutrition in here at all and everybody involved knows it.",
    stacks: true,
    heals: 25,
  },
  {
    id: "schoolgruel",
    name: "School Gruel",
    kind: "medicine",
    price: 120,
    sell: 30,
    blurb:
      "Returns 12 health and clears a status condition. Served by a large man who sings while he ladles.",
    stacks: true,
    heals: 12,
    cures: true,
  },
  {
    id: "gnomepants",
    name: "Stolen Underpants",
    kind: "treasure",
    price: 0,
    sell: 40,
    blurb:
      "Phase one of a three-phase business plan. Phase three is profit. Nobody will be drawn on phase two.",
    stacks: true,
  },

  // ------------------------------------------------------- New Willow, where
  // the future arrived and turned out to be a job.
  {
    id: "slurm",
    name: "Slurm",
    kind: "medicine",
    price: 900,
    sell: 220,
    blurb:
      "Returns 50 health. Wildly addictive, and you are very much better off not knowing where it comes from.",
    stacks: true,
    heals: 50,
  },
  {
    id: "bachelorchow",
    name: "Bachelor Chow",
    kind: "medicine",
    price: 400,
    sell: 100,
    blurb: "Returns 40 health. Now with flavour.",
    stacks: true,
    heals: 40,
  },
  {
    id: "doomsdaydevice",
    name: "Doomsday Device",
    kind: "treasure",
    price: 0,
    sell: 6000,
    blurb:
      "A professor's, and one of several. He would like it back, but not urgently, and not in person.",
    stacks: true,
  },

  // ---------------------------------------------------------- Sanchford, one
  // garage, one hole in reality, and a great deal of trouble.
  {
    id: "meeseeksbox",
    name: "Meeseeks Box",
    kind: "medicine",
    price: 0,
    sell: 800,
    blurb:
      "Press the button and something cheerful appears, restores a creature completely, and stops existing. It seems glad to go.",
    stacks: true,
    heals: Infinity,
  },
  {
    id: "plumbus",
    name: "Plumbus",
    kind: "treasure",
    price: 0,
    sell: 1800,
    blurb:
      "Everyone has one. First they take the dinglebop and smooth it out with a bunch of schleem. You know how a plumbus is made.",
    stacks: true,
  },
  {
    id: "szechuansauce",
    name: "Szechuan Sauce",
    kind: "treasure",
    price: 0,
    sell: 9000,
    blurb:
      "One packet, from a promotion that ran for a fortnight decades ago. A man in a garage has built nine years of plans around getting more.",
    stacks: true,
  },
];

/**
 * The printer's inks: one per colour, minus the one it already has.
 *
 * Generated from `CHROMA_IDS` rather than written out, so a ninth colour
 * added to the ladder brings its ink with it and there is no second list to
 * keep in step. Ivory is skipped because the printer never ran out of it —
 * that is the joke, and it is also why the first thing it prints for anybody
 * is white.
 *
 * Never for sale at any price. A cartridge you could buy is a shop with eight
 * rows in it; one you have to find at the back of a cabin at the far end of
 * the world is a reason to open every cabin.
 */
export const PRINTER_STOCK = "ivory";

export const INKS: readonly ItemSpec[] = CHROMA_IDS.filter((id) => id !== PRINTER_STOCK).map(
  (id): ItemSpec => ({
    id: `ink-${id}`,
    name: `${chroma(id).name} Ink`,
    kind: "ink",
    price: 0,
    sell: 1200,
    blurb: `A sealed cartridge of ${chroma(id).name.toLowerCase()}. Somebody somewhere is waiting for this.`,
    stacks: false,
  }),
);

/** The ink that opens one colour, or null for the one that needs none. */
export function inkFor(chromaId: string): string | null {
  return chromaId === PRINTER_STOCK ? null : `ink-${chromaId}`;
}

export const ITEMS: readonly ItemSpec[] = [
  ...INKS,
  ...ITEM_LIST,
  ...TOOLS,
  ...KEYS,
  ...BREEDING_ITEMS,
  ...DAYCARE_GEAR,
  GLITTER,
  ...STONES,
  ...TONICS,
  ...MINTS,
  ...FIELD_ITEMS,
  ...HOLDABLE,
  ...MACHINES,
  ...TOWN_ITEMS,
];

const BY_ID = new Map(ITEMS.map((entry) => [entry.id, entry]));

export function item(id: string): ItemSpec {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`unknown item: ${id}`);
  return found;
}

export function isItem(id: string): boolean {
  return BY_ID.has(id);
}

/**
 * What pressing this item in the bag does.
 *
 * One predicate, because the bag had its own opinion and the opinion went
 * stale. It read:
 *
 *     const usable = spec.kind === "medicine" || spec.kind === "lure" ||
 *       Boolean(spec.teaches) || spec.field === "clear" || spec.field === "travel";
 *
 * — a hand-written list of the kinds that existed when it was written. Every
 * kind added since was a row that rendered, with the right name and the right
 * blurb, greyed out and titled "Nothing to use this on": all twenty-two
 * stones, all thirty-seven tonics, the repels, the rope, the Heart Scale, and
 * then a hundred and eleven held items and berries. Nothing failed, nothing
 * looked broken, and none of it could be pressed.
 *
 * So the question is asked of the item now. A kind that answers `null` here is
 * a kind that genuinely does nothing from the bag, and there is exactly one:
 * treasure, which is for selling.
 */
export type BagUse =
  /** Pick a creature, then it happens to that creature. */
  | "creature"
  /** Pick a creature, and it goes on to carry this. */
  | "hold"
  /** Pressing it is using it. */
  | "light"
  /** Pick a direction, or a place. */
  | "world"
  /** Open it and read it. */
  | "read"
  /** Nothing at all, from the bag. */
  | null;

export function bagUse(spec: ItemSpec): BagUse {
  if (spec.reads) return "read";
  if (spec.opens) return "light";
  if (spec.lure) return "light";
  if (spec.repel || spec.escape) return "light";
  if (spec.field === "clear" || spec.field === "travel") return "world";
  if (holdOf(spec.id)) return "hold";
  if (spec.kind === "medicine") return "creature";
  if (spec.teaches || spec.evolves || spec.effort || spec.natureId || spec.relearn) return "creature";
  return null;
}

/** What a Mart stocks, cheapest first. Anything with a price is for sale. */
export const MART_STOCK: readonly ItemSpec[] = ITEMS.filter((entry) => entry.price > 0).sort(
  (a, b) => a.price - b.price || a.id.localeCompare(b.id),
);

/** Every ball, cheapest first — the order a battle menu should offer them in, so
 * the Master Ball is always the last button and never the one pressed by habit. */
export const BALLS: readonly ItemSpec[] = ITEMS.filter((entry) => entry.kind === "ball").sort(
  (a, b) => a.price - b.price || a.id.localeCompare(b.id),
);

/** Every tool, in the order they are usually found. */
export const TOOLS_LIST: readonly ItemSpec[] = ITEMS.filter((entry) => entry.kind === "hm");

/** Every rod, shortest first. */
export const RODS: readonly ItemSpec[] = ITEMS.filter((entry) => entry.kind === "rod").sort(
  (a, b) => (a.reach ?? 0) - (b.reach ?? 0),
);

/**
 * Every machine, in move order.
 *
 * Ranked by what it teaches rather than by name, so "how good is this one" is
 * a position in the list. A status move has no power and sits at the bottom,
 * which is roughly right: the moves worth walking to the sixth ring for are
 * the ones that hit hardest.
 */
export const MACHINE_ITEMS: readonly ItemSpec[] = [...MACHINES].sort(
  (a, b) =>
    (moveById(a.teaches!).power ?? 0) - (moveById(b.teaches!).power ?? 0) ||
    a.id.localeCompare(b.id),
);

/** Every lure, cheapest first. */
export const LURES: readonly ItemSpec[] = ITEMS.filter((entry) => entry.kind === "lure").sort(
  (a, b) => a.price - b.price || a.id.localeCompare(b.id),
);

export type Bag = Record<string, number>;

export function countOf(bag: Bag, id: string): number {
  return bag[id] ?? 0;
}

export function hasItem(bag: Bag, id: string): boolean {
  return countOf(bag, id) > 0;
}

/**
 * Adds to the bag, returning a new one.
 *
 * Equipment is capped at one: picking up a second Prism is picking up nothing,
 * and a bag showing "Prism x2" would be claiming the world holds two.
 */
export function addItem(bag: Bag, id: string, count = 1): Bag {
  const spec = item(id);
  const held = countOf(bag, id);
  const next = spec.stacks ? held + count : Math.min(1, held + count);
  if (next === held) return bag;
  return { ...bag, [id]: next };
}

/** Removes from the bag. Removing what is not there is a caller's mistake. */
export function removeItem(bag: Bag, id: string, count = 1): Bag {
  const held = countOf(bag, id);
  if (held < count) throw new Error(`not enough ${id}`);

  const next = { ...bag };
  if (held === count) delete next[id];
  else next[id] = held - count;
  return next;
}

/** The bag as sorted pairs, so a panel and a state hash see the same order. */
export function bagEntries(bag: Bag): [string, number][] {
  return Object.entries(bag)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b));
}
