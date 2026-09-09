import { MACHINE_MOVES, move as moveById } from "./dex";
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

export type ItemKind = "ball" | "medicine" | "rod" | "breeding" | "treasure" | "hm" | "key" | "lure" | "tm";

export interface ItemSpec {
  id: string;
  name: string;
  kind: ItemKind;
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
  /** Lures: what draws, and how far down the route's census it can reach. */
  lure?: LureSpec;
  /** Machines: the move it teaches. */
  teaches?: string;
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
    blurb: "The ordinary one.",
    stacks: true,
    ballMult: 1000,
  },
  {
    id: "greatball",
    name: "Great Ball",
    kind: "ball",
    price: 600,
    sell: 300,
    blurb: "Half again as likely to hold.",
    stacks: true,
    ballMult: 1500,
  },
  {
    id: "ultraball",
    name: "Ultra Ball",
    kind: "ball",
    price: 1200,
    sell: 600,
    blurb: "Twice as likely to hold.",
    stacks: true,
    ballMult: 2000,
  },

  // ------------------------------------------------------------ medicine
  {
    id: "potion",
    name: "Potion",
    kind: "medicine",
    price: 300,
    sell: 150,
    blurb: "Returns 20 health.",
    stacks: true,
    heals: 20,
  },
  {
    id: "superpotion",
    name: "Super Potion",
    kind: "medicine",
    price: 700,
    sell: 350,
    blurb: "Returns 60 health.",
    stacks: true,
    heals: 60,
  },
  {
    id: "hyperpotion",
    name: "Hyper Potion",
    kind: "medicine",
    price: 1500,
    sell: 750,
    blurb: "Returns 150 health.",
    stacks: true,
    heals: 150,
  },
  {
    id: "fullrestore",
    name: "Full Restore",
    kind: "medicine",
    price: 3000,
    sell: 1500,
    blurb: "Full health, and clears what ails it.",
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
    blurb: "Clears a status condition.",
    stacks: true,
    cures: true,
  },
  {
    id: "revive",
    name: "Revive",
    kind: "medicine",
    price: 2000,
    sell: 1000,
    blurb: "Brings a fainted creature back at half health.",
    stacks: true,
    revives: 2,
  },
  {
    id: "rarecandy",
    name: "Rare Candy",
    kind: "medicine",
    price: 6000,
    sell: 2400,
    blurb: "One level, instantly. Priced so that fighting stays the cheaper road.",
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
    blurb: "Fishes the shallows. Whatever bites, bites close in.",
    stacks: false,
    reach: 1,
  },
  {
    id: "goodrod",
    name: "Good Rod",
    kind: "rod",
    price: 3000,
    sell: 1500,
    blurb: "Reaches deeper water, and what lives in it.",
    stacks: false,
    reach: 2,
  },
  {
    id: "superrod",
    name: "Super Rod",
    kind: "rod",
    price: 9000,
    sell: 4500,
    blurb: "Reaches the bottom. Nothing in the water is out of range.",
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
    blurb: `Draws anything with shine on it, for ${LURE_MOVES} moves.`,
    stacks: true,
    lure: { shine: true, pull: LURE_PULL },
  },
  ...CHROMA_IDS.map((id) => ({
    id: `lure-${id}`,
    name: `${chroma(id).name} Lure`,
    kind: "lure" as const,
    price: 6000,
    sell: 2000,
    blurb: `Draws anything wearing ${chroma(id).name.toLowerCase()}, for ${LURE_MOVES} moves.`,
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
    blurb: "Worth nothing to you and a great deal to a Mart. Sell it.",
    stacks: true,
  },
  {
    id: "pearl",
    name: "Pearl",
    kind: "treasure",
    price: 0,
    sell: 1400,
    blurb: "Pretty, and worth carrying to a counter.",
    stacks: true,
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
    id: "hm-cut",
    name: "Cut",
    kind: "hm",
    price: 0,
    sell: 0,
    blurb: "Takes down a bush. It stays down.",
    stacks: false,
    field: "clear",
  },
  {
    id: "hm-strength",
    name: "Strength",
    kind: "hm",
    price: 0,
    sell: 0,
    blurb: "Shoulders a boulder out of the way, permanently.",
    stacks: false,
    field: "clear",
  },
  {
    id: "hm-rocksmash",
    name: "Rock Smash",
    kind: "hm",
    price: 0,
    sell: 0,
    blurb: "Breaks cracked rock apart. It does not come back.",
    stacks: false,
    field: "clear",
  },
  {
    id: "hm-surf",
    name: "Surf",
    kind: "hm",
    price: 0,
    sell: 0,
    blurb: "Crosses open water while you carry it.",
    stacks: false,
    field: "cross",
  },
  {
    id: "hm-waterfall",
    name: "Waterfall",
    kind: "hm",
    price: 0,
    sell: 0,
    blurb: "Climbs falling water. Bring Surf as well, or you cannot reach one.",
    stacks: false,
    field: "cross",
  },
  {
    id: "hm-whirlpool",
    name: "Whirlpool",
    kind: "hm",
    price: 0,
    sell: 0,
    blurb: "Rides through a whirlpool instead of round it.",
    stacks: false,
    field: "cross",
  },
  {
    id: "hm-dive",
    name: "Dive",
    kind: "hm",
    price: 0,
    sell: 0,
    blurb: "Goes under deep water rather than over it.",
    stacks: false,
    field: "cross",
  },
  {
    id: "hm-rockclimb",
    name: "Rock Climb",
    kind: "hm",
    price: 0,
    sell: 0,
    blurb: "Goes up a cliff face.",
    stacks: false,
    field: "cross",
  },
  {
    id: "hm-flash",
    name: "Flash",
    kind: "hm",
    price: 0,
    sell: 0,
    blurb: "Lights the outer rings. Without it you see three paces and no more.",
    stacks: false,
    field: "light",
  },
  {
    id: "hm-fly",
    name: "Fly",
    kind: "hm",
    price: 0,
    sell: 0,
    blurb: "Goes straight to anywhere you have already walked to.",
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
    }. Keeps, so it can be used again.`,
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
    blurb: "Eight badges, and somebody finally wants to see you play.",
    stacks: false,
  },
];

/**
 * Five ways to buy the climb outright, in ascending order of how far you have
 * to walk for one.
 *
 * A light word each, because they are the same thing at five strengths and a
 * family of names says that faster than a table would. The last two sit on the
 * outermost ring, which is the hardest thing this world has to ask for.
 */
const CLIMB_ITEMS: { id: string; name: string; blurb: string; climbBonus: number }[] = [
  { id: "glint", name: "Glint", blurb: "One percent onto the climb, permanently.", climbBonus: 100 },
  { id: "gleam", name: "Gleam", blurb: "Two percent onto the climb, permanently.", climbBonus: 200 },
  { id: "lustre", name: "Lustre", blurb: "Three percent onto the climb, permanently.", climbBonus: 300 },
  { id: "radiance", name: "Radiance", blurb: "Five percent onto the climb. Kept at the far end of the world.", climbBonus: 500 },
  {
    id: "brilliance",
    name: "Brilliance",
    blurb: "Ten percent onto the climb. There is one, and it is as far out as anything gets.",
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
  { id: "heirloom", name: "Heirloom", blurb: "Passes down five of the parents' stat slots instead of three." },
  { id: "talisman", name: "Talisman", blurb: "The child always inherits the first parent's nature." },
  { id: "catalyst", name: "Catalyst", blurb: "Strengthens the mutation on every inherited stat." },
  { id: "prism", name: "Prism", blurb: "Five times the chance a child climbs the shine ladder." },
  ...CHROMA_IDS.map((id) => ({
    id: `lens-${id}`,
    name: `${id.charAt(0).toUpperCase()}${id.slice(1)} Lens`,
    blurb: `One chance in five that the child takes the ${id} colour, whatever its parents wore.`,
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
  blurb: "Ten percent onto the climb, spent the moment the egg appears.",
  stacks: true,
  climbBonus: 1000,
  consumed: true,
};

export const ITEMS: readonly ItemSpec[] = [
  ...ITEM_LIST,
  ...TOOLS,
  ...KEYS,
  ...BREEDING_ITEMS,
  GLITTER,
  ...MACHINES,
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

/** What a Mart stocks, cheapest first. Anything with a price is for sale. */
export const MART_STOCK: readonly ItemSpec[] = ITEMS.filter((entry) => entry.price > 0).sort(
  (a, b) => a.price - b.price || a.id.localeCompare(b.id),
);

/** Every ball, weakest first — the order a battle menu should offer them in. */
export const BALLS: readonly ItemSpec[] = ITEMS.filter((entry) => entry.kind === "ball").sort(
  (a, b) => (a.ballMult ?? 0) - (b.ballMult ?? 0),
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
