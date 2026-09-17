import { contender as cupSpec, CUP_ROSTER } from "./cup";
import { species as speciesById } from "./dex";
import { item as itemSpec } from "./items";
import { quest as questSpec } from "./quests";
import { SCHOOL } from "./school";
import type { Gender, Individual } from "./types";
import { variant } from "./variants";

/**
 * The people who are not trying to fight you.
 *
 * The split is by what talking to one *does* rather than by what they are:
 * somebody who says a useful thing, somebody who hands you something once,
 * somebody who patches you up, somebody who wants a swap, somebody with a job,
 * somebody who runs a gym, and somebody who buys. A person with no effect is a
 * hint-giver, which is why that kind exists rather than one that does nothing.
 *
 * They are authored, not generated. A procedural villager says procedural
 * things, and the whole point of a person standing in a doorway is that
 * somebody decided what they would say.
 */

export type NpcKind =
  | "hint"
  | "gift"
  | "heal"
  | "trade"
  | "quest"
  | "gym"
  | "buy"
  | "cup"
  /** The Grey Line: talk to one and pick another you have already walked to. */
  | "travel"
  /** The man with the 3D printer. See `engine/printer.ts`. */
  | "print"
  /** Somebody running an eight-player bracket against the machine. */
  | "arena"
  /** The man who takes one off your hands and pays in candy. */
  | "shred"
  /** And the one who turns one into a stone of its type. */
  | "cut"
  /** The smith, who changes a nature with a hammer. */
  | "forge"
  /** The pawnbroker, who buys creatures by the level and needs time to sell each one on. */
  | "pawn"
  /** The egg buyer in New Willow, who pays for eggs unopened and will not say why. */
  | "eggbuy"
  /** The Colour Collector: a coloured creature for Chroma Candy. See tutor.ts. */
  | "chromabuy"
  /** The Ability Tutor: eight abilities on a rotating board, taught over 2,500 steps. */
  | "tutor"
  /** The Gift Swapper: any creature for a Secret Gift. */
  | "giftswap"
  /** The Therapist: a traded creature rehabilitated, a prize redeemed. */
  | "therapy"
  /** The Egg Insurance salesman. */
  | "insure"
  /** The Influencer, who makes a special creature famous. */
  | "influence"
  /** The Streamer, who streams a famous creature's battles for money. */
  | "stream"
  /** The pageant host: fifteen contestants and a Ribbon. */
  | "pageant"
  /** The paparazzo, who buys a Ribbon winner's exclusive photoshoot. */
  | "photoshoot"
  /** The auctioneer: six rare lots on a board, closing on a step count. */
  | "auction"
  /** The workshop, where an Ice, a Fire and a Water type can be left to work. */
  | "workshop";

/**
 * What a buyer pays for one rung of the shine ladder.
 *
 * Per rung, not per creature, so a Faded is worth a fifth of a true shiny and
 * the ladder means the same thing at the counter as it does everywhere else.
 * Five thousand for a true shiny is deliberately close to a Nugget: shine is
 * worth real money, and it is not worth *only* money.
 */
export const SHINE_PRICE = 1000;

/** And how much Glitter, if you would rather have that. One rung, one dust. */
export const SHINE_GLITTER = 1;

/** What a trader will accept. Every field named must match. */
export interface TradeWant {
  chromaId?: string;
  /** Minimum rung on the shine ladder. */
  tier?: number;
  speciesId?: string;
  type?: string;
  minLevel?: number;
}

export interface NpcSpec {
  id: string;
  name: string;
  kind: NpcKind;
  /** Where they stand. The route is the map they belong to. */
  route: string;
  x: number;
  y: number;
  /** What they say. Shown in order, one paragraph each. */
  lines: string[];
  /** gift: what they hand over, once ever. */
  item?: string;
  /** trade: what they will take, and what they give for it. */
  wants?: TradeWant;
  gives?: { speciesId: string; variantId: string; gender: Gender; level: number; nickname?: string };
  /**
   * trade: what actually changes hands, when it is not what they said.
   *
   * `gives` is what they show you and what the panel promises; this is what is
   * in the ball. Only a crook has one.
   */
  delivers?: { speciesId: string; variantId: string; gender: Gender; level: number; nickname?: string };
  /** What they say once they have already done business with you, if it is different. */
  afterLines?: string[];
  /** quest: which one. */
  questId?: string;
  /** gym: which one. */
  gymId?: string;
  /** cup: which of the five. */
  cupId?: string;
  /** arena: which bracket they run. */
  arenaId?: string;
}

/** Whether a creature satisfies what a trader is asking for. */
export function matchesWant(creature: Individual, want: TradeWant): boolean {
  const form = variant(creature.variantId);
  if (want.chromaId && form.chromaId !== want.chromaId) return false;
  if (want.tier !== undefined && form.tier < want.tier) return false;
  if (want.speciesId && creature.speciesId !== want.speciesId) return false;
  if (want.type && !speciesById(creature.speciesId).types.some((one) => one === want.type)) return false;
  if (want.minLevel !== undefined && creature.level < want.minLevel) return false;
  return true;
}

/** What a trader is asking for, in a sentence. */
export function wantText(want: TradeWant): string {
  const parts: string[] = [];
  if (want.tier !== undefined) parts.push(want.tier >= 5 ? "a true shiny" : `something at least ${want.tier} rungs up the shine ladder`);
  if (want.chromaId) parts.push(`anything wearing ${want.chromaId}`);
  if (want.speciesId) parts.push(`a ${speciesById(want.speciesId).name}`);
  if (want.type) parts.push(`a ${want.type} type`);
  if (want.minLevel !== undefined) parts.push(`level ${want.minLevel} or better`);
  return parts.join(", ") || "anything at all";
}

/** What a trader is offering, in a sentence. */
export function givesText(gives: NonNullable<NpcSpec["gives"]>): string {
  const form = variant(gives.variantId);
  const dress = form.tier > 0 || form.chromaId ? `${form.name} ` : "";
  return `a level ${gives.level} ${dress}${speciesById(gives.speciesId).name}`;
}

/**
 * The roster.
 *
 * Positions are given as a hint rather than a coordinate: the world places
 * each of these on the nearest open ground it can find to the spot asked for,
 * because a route is carved differently on every seed and a hard coordinate
 * would put half of them inside a tree.
 */
export interface NpcPlacement extends Omit<NpcSpec, "x" | "y" | "route"> {
  /** Which map, and roughly where on it. */
  where:
    /**
     * In a town square: which town, and roughly where in it.
     *
     * `town` was not here while there was one town. There are four, three of
     * them with a cast of their own, and "the town" stopped being an address
     * the moment the second one was founded. Left off it still means home,
     * so the original roster reads the same as it always did.
     */
    | { at: "town"; town?: string; x: number; y: number }
    /**
     * Somewhere the seed picks: any town, or any route no further out than
     * `maxRing`.
     *
     * For the people with a machine and a trade rather than a story tied to
     * one street. Four of them in one town made New Willow the only stop that
     * mattered and every other town a place you walked through; scattered,
     * finding the printer is part of a run rather than a fact about the map.
     * Near home on purpose — none of them is worth anything to somebody who
     * cannot reach them before the midgame.
     */
    | { at: "wander"; maxRing: number }
    | {
        at: "interior";
        role: "centre" | "mart" | "daycare" | "house";
        /**
         * Which town's one, when it matters.
         *
         * `index` picks among the *houses*, which are the only rooms there
         * used to be several of. Every town has a Center and a Mart now, and
         * without this a person written for the shop in one town stands behind
         * the counter in Hearth: the joke with the setup removed.
         */
        town?: string;
        index?: number;
        /**
         * There is one of these in *every* building of the kind.
         *
         * For the two people whose job is the building itself: a Center with
         * no nurse in it is a room with a bed, and a Mart with nobody behind
         * the counter is a room. There are four towns, so there are four
         * nurses and four shopkeepers, and the roster says so once rather
         * than four times.
         *
         * Everybody else indoors is a person who happens to be inside, and
         * there is one of them. Four commissioners handing out the same job in
         * four towns would be one job and three redundant people.
         */
        staff?: true;
        /** Which room, filled in when the roster is expanded. */
        roomId?: string;
      }
    /**
     * Out on a route: which biome, and which copy of it counted outward from
     * town.
     *
     * This used to name a ring, and the ring was both the name of the route
     * and how hard it was. Neither survived the world becoming a graph.
     * `nth` is the part that can still be written down by hand: every world
     * has exactly four marshes, so "the nearest marsh" is an address, and it
     * means what a designer means by it — near town is
     * early. See `placeIndex` in layout.ts.
     */
    | { at: "route"; biome: string; nth: number }
    /**
     * A Grey Line post: one on every kind of place there is.
     *
     * Written once and expanded by the world, the way the nurse is — there is
     * one Grey Line rather than twenty-four people who coincidentally do the
     * same job, and twenty-four near-identical roster entries would be the
     * same person written out twenty-four times. `routeId` is filled in by the
     * expansion; see `placeNpcs`.
     *
     * They stand at the route's entry rather than tucked away like the rest of
     * the people out on a route. Two reasons, and both are about the walking
     * being the point: a post you have to hunt for is a post you will walk
     * past, and arriving somewhere puts you on the entry tile, so stepping off
     * one coach leaves you standing beside the next.
     */
    | { at: "station"; routeId?: string }
    /** Inside the cabin on that route — or, on a seed that grew no cabin
     * there, outside on the route itself. A person who exists on some seeds
     * and not others is not a person, it is a bug with a name. */
    | { at: "cabin"; biome: string; nth: number }
    /**
     * The social media cabin: one cabin the seed picks from all of them, and
     * which of its two spots. Both people in it stand in the same one.
     */
    | { at: "socialCabin"; spot: 0 | 1 }
    /** The pageant cabin: another cabin the seed picks, never the social media one. */
    | { at: "pageantCabin"; spot: 0 | 1 }
    | { at: "gym"; gymId: string }
    /**
     * Inside the house at the end of the ash flats.
     *
     * Six people share one room, which is why this is a place rather than a
     * coordinate: the room is thirteen by ten with furniture in it, and six
     * hand-written positions would be six chances to stand somebody inside a
     * bookcase on the seed where the furniture landed differently.
     */
    | { at: "cup" };
}

/**
 * What the egg buyer says once he has two.
 *
 * Never the word itself. He gets as close as he can without saying it, which
 * is the joke: one egg is a collection, and a second is a pan being warmed.
 */
export const EGG_BUYER_AFTER_TWO: readonly string[] = [
  "(He is holding a whisk. He puts it down very quickly.)",
  "Two now. Two is a good number. You can do things with two that you could not do with one. Display them. Side by side. Folded, perhaps. On a plate.",
  "Do you happen to know whether the cheese goes in before the fold or after? I am asking about something else entirely.",
];

export const NPCS: readonly NpcPlacement[] = [
  // The four teachers in Hearth's house. Their lines are built from the
  // constants they are about, which is why they live in their own file.
  ...SCHOOL,

  // ------------------------------------------------------------- in town
  {
    id: "nurse",
    name: "Nurse",
    kind: "heal",
    where: { at: "interior", role: "centre", staff: true },
    lines: [
      "You look like you have been walking a while.",
      "There. All of them, back on their feet — and it costs nothing, before you ask. It never has.",
    ],
  },
  {
    id: "clerk",
    name: "Shopkeeper",
    kind: "hint",
    where: { at: "interior", role: "mart", staff: true },
    lines: [
      "Balls are cheap, and the good ones are not.",
      "A Great Ball is worth half again what an ordinary one is, and an Ultra twice. Whether that is worth three times the money depends entirely on what is standing in front of you.",
      "Treasure is for selling. That is the whole of it. Nuggets, pearls — I pay, you walk out richer, everybody is happy.",
    ],
  },
  {
    id: "breeder",
    name: "Breeder",
    kind: "hint",
    where: { at: "interior", role: "daycare" },
    lines: [
      "Wild things are born weak. Nought to six in a stat, and that is the ceiling out there.",
      "Which is why you breed. Every stat comes down from one parent or the other, and a few of them climb — that climb is the only reason the ceiling moves at all.",
      "Ten generations to perfect one stat. Fifteen if the dice hate you. It is a project, not an afternoon.",
    ],
  },
  {
    id: "quest-elder",
    name: "Elder",
    kind: "quest",
    questId: "first-steps",
    where: { at: "town", x: 20, y: 10 },
    lines: ["Sit down. No — stand, you are in a hurry, I can tell."],
  },
  {
    id: "quest-warden",
    name: "Warden",
    kind: "quest",
    questId: "the-rounds",
    where: { at: "town", x: 20, y: 19 },
    lines: ["You want work? There is always work."],
  },
  {
    id: "gift-neighbour",
    name: "Neighbour",
    kind: "gift",
    item: "potion",
    where: { at: "interior", role: "house" },
    lines: [
      "Oh — you are the one who just set off, aren't you.",
      "Take this. I have a drawer full and nowhere left to walk to.",
    ],
  },
  {
    id: "quest-commissioner",
    name: "Commissioner",
    kind: "quest",
    questId: "world-cup",
    where: { at: "interior", role: "centre" },
    lines: [
      "I am not here for the beds. I am here because this is where everyone eventually comes through.",
      "There is a tournament. It is not local and it is not friendly.",
    ],
  },
  {
    id: "trade-swindler",
    name: "Mr. Vane",
    kind: "trade",
    where: { at: "town", x: 6, y: 22 },
    wants: { speciesId: "pikachu", minLevel: 10 },
    gives: { speciesId: "mew", variantId: "normal", gender: "trans", level: 1 },
    delivers: { speciesId: "metapod", variantId: "normal", gender: "male", level: 1, nickname: "Mew" },
    lines: [
      "Closer. No — closer. The walls in this town have ears, and the ears have friends.",
      "I have something in this ball you will not find in any grass. Pink. Small. Older than your grandmother's grandmother's grandmother. A Mew, child. A real one.",
      "All I ask in return is a Pikachu. Level ten, no younger. I like them with a little spark still left in them.",
      "Don't look at the ball. Look at me. There. Isn't that better? Do we have an arrangement?",
    ],
    afterLines: [
      "Oh, it's you again. How is our little friend? Growing, I hope. They do grow, you know. Eventually.",
      "No refunds. You looked me in the eye and you said yes, and I remember every yes I have ever been given.",
      "Run along now. Somebody else is coming up the lane, and they have a Pikachu too.",
    ],
  },
  /*
   * The egg buyer.
   *
   * New Willow, where nobody thinks about anything too hard. He pays well and
   * he is very clear that it is a collection. The first egg gets you nothing
   * but thanks; `EGG_BUYER_AFTER_TWO` is what he lets slip once he has two,
   * which is the point at which a collection becomes a recipe.
   */
  {
    id: "egg-buyer",
    name: "Gus",
    kind: "eggbuy",
    where: { at: "town", town: "town-2", x: 20, y: 14 },
    lines: [
      "Eggs! I buy eggs. Unopened, mind. Once it has hatched it is a pet, and I do not want a pet.",
      "A thousand for an ordinary one. More if there is something shiny in there, or something a nice colour — up to three thousand. I can tell. Do not ask me how I can tell.",
      "It is a collection. I collect them. That is all it is.",
    ],
  },
  /*
   * The three who shape abilities — see tutor.ts. Two in Sanchford, where the
   * tutor keeps his board and the collector who pays in his currency stands
   * across the square; the swapper in Southpass, where nobody asks where a
   * creature came from.
   */
  {
    id: "colour-collector",
    name: "Colour Collector",
    kind: "chromabuy",
    where: { at: "town", town: "town-3", x: 8, y: 8 },
    lines: [
      "Colours! I collect the colours. Not the creatures — the colours. The creature is how the colour gets here.",
      "Chroma Candy for anything wearing one. One for the colour, and one more for every rung of shine on top of it.",
      "The candy is no good to a shop. The tutor across the way takes it, though. Funny, that.",
    ],
  },
  {
    id: "ability-tutor",
    name: "Ability Tutor",
    kind: "tutor",
    where: { at: "town", town: "town-3", x: 28, y: 8 },
    lines: [
      "Eight on the board. One comes off and a new one goes up every thousand steps, so if you see what you want, do not wander off to think about it.",
      "The price is the price: money and materials, and I do not haggle. Leave the one who is learning with me — two and a half thousand steps, and it goes home knowing something new.",
      "One pupil at a time. And nobody learns a fourth, or something they already know.",
    ],
  },
  {
    id: "therapist",
    name: "Dr. Couch",
    kind: "therapy",
    where: { at: "town", town: "town-1", x: 12, y: 20 },
    lines: [
      "Come in, lie down. Not you — them. The one somebody else raised.",
      "A creature that has been traded carries it around. Who am I to you? Why should I listen? A thousand steps on my couch and we work through it: it listens to you after that, whatever its level, and it throws itself into its training twice as hard.",
      "Prizes are worse. Won, handed over, never chosen. Those I call redeemed when we are done, and they train three times as hard, effort and all. It is very moving. It is also ten thousand, up front.",
      "And how did it make you feel when he traded you for a Metapod? Take your time.",
    ],
  },
  {
    id: "egg-insurance",
    name: "Egg Insurance Salesman",
    kind: "insure",
    where: { at: "town", x: 10, y: 7 },
    lines: [
      "Friend! Have you ever hatched an egg, and it was just... a normal one? No shine? No colour? Just a creature?",
      "Tragic. And completely insurable. Apply one policy at the daycare, and every ordinary egg hatching in an incubator pays out — a Glitter or a Chroma Candy, our choice, no questions.",
      "Fifty thousand. One payment, covered forever. Terms and conditions apply. The terms are that it is fifty thousand.",
    ],
  },
  {
    id: "influencer",
    name: "Skye (@skye.irl)",
    kind: "influence",
    where: { at: "socialCabin", spot: 0 },
    lines: [
      "OMG hi!! Welcome to the content cabin 📸 don't touch the ring light.",
      "Leave me something with a bit of sparkle — a shine, a colour, an ability — and I'll post it until it's famous. Famous 1, then 2, all the way to 5. The more special it is, the faster the algorithm loves it.",
      "Plain ones don't trend, babe. I don't make the rules. The algorithm makes the rules.",
    ],
  },
  {
    id: "streamer",
    name: "xX_Stream_Xx",
    kind: "stream",
    where: { at: "socialCabin", spot: 1 },
    lines: [
      "CHAT. CHAT. Somebody walked in. Hi, walked-in person. Say hi to chat.",
      "Register one famous creature and I stream every battle it's in. Ten thousand up front for the pool, and the stream costs one a step — bandwidth isn't free. Every foe your team knocks out pays by its level; the famous one fainting costs us.",
      "If the pool goes negative I pull the plug, no hard feelings. Come back and cash out when you like. The mic is not plugged in. Chat doesn't know that.",
    ],
  },
  {
    id: "pageant-host",
    name: "Pageant Host",
    kind: "pageant",
    where: { at: "pageantCabin", spot: 0 },
    lines: [
      "Welcome, welcome, WELCOME to the pageant! Fifteen of the loveliest on the circuit, and a new line-up every two and a half thousand steps.",
      "The judges score it plainly: level, shine, colour, abilities, every IV, and a pageant accessory if it suits the wearer's type. Look them over — they are all on the board.",
      "One entry per line-up, darling. Beat every one of them and you walk out with a Ribbon, and a Ribbon walks out onto a battlefield like it owns the place.",
    ],
  },
  {
    id: "paparazzo",
    name: "Paparazzo",
    kind: "photoshoot",
    where: { at: "pageantCabin", spot: 1 },
    lines: [
      "Well, well — a Ribbon. Don't look at the camera, look at the money. A hundred thousand. Cash. Today.",
      "Seventy-two hours, tops. Maybe a little longer. They always come back. Mostly the same.",
      "Paperwork? Sure, sure. Sign here, and here, and — don't worry about that bit. Nobody reads that bit.",
      "The Ribbon? Oh, that stays with the photos. Everyone knows that. You knew that.",
    ],
  },
  {
    id: "gift-swapper",
    name: "Gift Swapper",
    kind: "giftswap",
    where: { at: "town", town: "town-1", x: 28, y: 18 },
    lines: [
      "A creature for a gift. Any creature. I do not look at them and you do not look in the box until you have walked away.",
      "Usually it is something useful. Potions, berries. Every so often it is something rather better than you gave me. That is the game.",
    ],
  },
  {
    id: "pawn-broker",
    name: "Pawnbroker",
    kind: "pawn",
    where: { at: "town", town: "town-1", x: 20, y: 16 },
    lines: [
      "Creatures bought. Fifty a level, cash, no questions asked and none answered.",
      "One at a time, mind. I need to walk each one to a buyer before I take the next, and the buyers do not live close.",
      "Whatever it is holding comes back to you. I buy the animal, not its pockets.",
    ],
  },
  {
    id: "auctioneer",
    name: "Auctioneer",
    kind: "auction",
    where: { at: "wander", maxRing: 2 },
    lines: [
      "Lots! Rare lots! Nothing on this board was caught by anybody who will admit to it.",
      "Six at a time, each closing on the step. Bid, and your money sits with me until the hammer comes down.",
      "Half the bids win. The other half get every coin back — I am an auctioneer, not a thief. Come back when the lot has closed and I will settle up either way.",
    ],
  },
  {
    id: "workshop-foreman",
    name: "Workshop Foreman",
    kind: "workshop",
    where: { at: "town", town: "town-3", x: 12, y: 13 },
    lines: [
      "Short-handed, as ever. Three jobs going and nobody to do them.",
      "An Ice type on the churn makes ice cream. A Fire type on the spit roasts the chickens. A Water type does the garden, and the garden needs it.",
      "Leave one with me and it learns by doing — a little experience for every step you take, wherever you are. It will not pick up any new moves here, mind, and nobody evolves on my shift. Come and fetch it whenever you like.",
    ],
  },
  /*
   * The librarian, who gives you the handbook.
   *
   * Everything the game knows about shine, colour, abilities and items, in one
   * key item — handed over in Hearth, before anybody has walked anywhere,
   * because a reference you only get once you no longer need it is a trophy.
   */
  {
    id: "gift-librarian",
    name: "Librarian",
    kind: "gift",
    item: "handbook",
    where: { at: "town", x: 12, y: 20 },
    lines: [
      "Shh. No — it is fine, it is outdoors, I just say it.",
      "Here. The Pokémon Handbook. Every shine, every colour and what it does to a stat, every ability anybody has written down, every item on every shelf.",
      "It is not a story. Nobody reads it front to back. You look things up in it, and then you are right about them.",
    ],
  },
  {
    id: "hint-child",
    name: "Child",
    kind: "hint",
    where: { at: "town", x: 14, y: 14 },
    lines: [
      "Did you know the whole world is just a number?",
      "Dad says if you tell someone the seed they get the exact same three starters and the exact same everything. Even where the shiny is.",
      "I told him that means the shiny is already decided and he said yes, that is the point.",
    ],
  },

  {
    id: "gift-tutor",
    name: "Move Tutor",
    kind: "gift",
    item: "tm-facade",
    where: { at: "interior", role: "house", index: 1 },
    lines: [
      "Machines. That is what I do. Not moves — anybody can teach a move — machines.",
      "The difference is that a machine keeps. Use it, and it is still a machine. Half the people out there are hoarding theirs like they are eggs.",
      "Take this one. Facade. It hits twice as hard when the thing holding it is burned or poisoned or paralysed, which is a strange thing to want until the first time you want it very badly.",
    ],
  },
  {
    id: "gift-quarry",
    name: "Quarryman",
    kind: "gift",
    item: "tm-rockslide",
    where: { at: "route", biome: "slagheap", nth: 1 },
    lines: [
      "You are standing on about four hundred tons of loose rock. I would not linger.",
      "Here — I have three of these and one back. Rock Slide. Take it and let me get on.",
    ],
  },

  // ----------------------------------------------------- behind a door
  {
    id: "buy-appraiser",
    name: "Appraiser",
    kind: "buy",
    where: { at: "cabin", biome: "fellgarden", nth: 1 },
    lines: [
      "Shut the door. Thank you. The light in here is mine and I would like to keep it.",
      "I buy shine. Not colour — colour is somebody else's trade — shine. A thousand a rung, so five for a true one, and I do not argue about the arithmetic because the arithmetic is not mine.",
      "Or you take it in Glitter. Same count, one for a rung. Put it in with a pair at the daycare and the next egg is ten percent more likely to come up a rung — and then the Glitter is gone, because that is what it is for.",
      "(He does not look up while you decide. He has done this a great many times.)",
    ],
  },

  // ------------------------------------------------------ out on the map
  {
    id: "trade-onyx",
    name: "Collector",
    kind: "trade",
    where: { at: "route", biome: "duskhollow", nth: 1 },
    wants: { chromaId: "onyx" },
    gives: { speciesId: "ditto", variantId: "shiny", gender: "trans", level: 25, nickname: "Smudge" },
    lines: [
      "Black ones. That is what I am after. Onyx — the dark drained ones, you will know it when you see it.",
      "I have a Ditto. Shiny, properly shiny, and it takes to anything you put it with — either way round, no fuss.",
      "One Onyx and it is yours. I will not haggle and I will not explain.",
    ],
  },
  {
    id: "trade-angler",
    name: "Angler",
    kind: "trade",
    where: { at: "route", biome: "marsh", nth: 1 },
    wants: { type: "water", minLevel: 12 },
    gives: { speciesId: "magikarp", variantId: "tint4:tide", gender: "female", level: 20 },
    lines: [
      "You have been in the water, I can smell it.",
      "Give me something wet and grown — level twelve, no younger — and I will give you this. Nearly shiny, and Tide on top of it.",
      "It is a Magikarp. Yes. I know what it is. Look at it, though.",
    ],
  },
  {
    id: "quest-cartographer",
    name: "Cartographer",
    kind: "quest",
    questId: "far-enough",
    where: { at: "route", biome: "ashflats", nth: 1 },
    lines: ["I map what people bring back. Lately people bring back very little."],
  },
  {
    id: "quest-chromatic",
    name: "Chromatic",
    kind: "quest",
    questId: "colour-theory",
    where: { at: "route", biome: "mycelia", nth: 1 },
    lines: ["Colour is not decoration. Colour is a stat line with a coat on."],
  },
  {
    id: "quest-hunter",
    name: "Hunter",
    kind: "quest",
    questId: "the-shine",
    where: { at: "route", biome: "crystalvault", nth: 1 },
    lines: ["I have been out here eleven years. Ask me what I am looking for."],
  },
  {
    id: "quest-angler-master",
    name: "Old Angler",
    kind: "quest",
    questId: "the-drenched",
    where: { at: "route", biome: "stormcoast", nth: 2 },
    lines: ["A rod is not for catching things. A rod is for reaching."],
  },
  {
    id: "quest-trainer-coach",
    name: "Coach",
    kind: "quest",
    questId: "the-work",
    where: { at: "route", biome: "pinewood", nth: 3 },
    lines: ["Everyone wants the rare one. Nobody wants to do the work on the common one."],
  },
  {
    id: "quest-climber",
    name: "Climber",
    kind: "quest",
    questId: "the-climb",
    where: { at: "route", biome: "cloudreach", nth: 1 },
    lines: ["Levels are the one thing nobody can hand you."],
  },
  {
    id: "quest-jeweller",
    name: "Jeweller",
    kind: "quest",
    questId: "deep-pockets",
    where: { at: "route", biome: "dunes", nth: 2 },
    lines: ["Everything out here is worth something to somebody. I am the somebody."],
  },
  {
    id: "quest-shapeless",
    name: "Naturalist",
    kind: "quest",
    questId: "a-ditto",
    where: { at: "route", biome: "sunkenreach", nth: 1 },
    lines: ["There is a creature that is all of them and none of them. I want to see it."],
  },
  {
    id: "gift-ranger",
    name: "Ranger",
    kind: "gift",
    item: "oldrod",
    where: { at: "route", biome: "marsh", nth: 2 },
    lines: [
      "You have walked past four ponds and not looked at one of them.",
      "Here. It is old and it is short, but stand at the water's edge with it and something will bite.",
    ],
  },
  {
    id: "gift-prospector",
    name: "Prospector",
    kind: "gift",
    item: "nugget",
    where: { at: "route", biome: "saltpan", nth: 3 },
    lines: [
      "Found two. Only need one.",
      "Do not carry it around admiring it — it does nothing. Sell it.",
    ],
  },
  {
    id: "gift-herbalist",
    name: "Herbalist",
    kind: "gift",
    item: "revive",
    where: { at: "route", biome: "frostmire", nth: 2 },
    lines: [
      "Everything faints eventually. Out here that is a long walk home.",
      "Take it. And do not use it on something that is merely tired — it only works on the ones that have already gone down.",
    ],
  },
  {
    id: "heal-camp",
    name: "Camper",
    kind: "heal",
    where: { at: "route", biome: "glacier", nth: 2 },
    lines: [
      "Fire is lit. Sit for a minute.",
      "There — that is the best I can do out here, but it is enough to get you home.",
    ],
  },
  {
    id: "heal-hermit",
    name: "Hermit",
    kind: "heal",
    where: { at: "route", biome: "boneyard", nth: 1 },
    lines: [
      "You are a long way from a Center.",
      "I have nothing to sell and nothing to ask. Go on.",
    ],
  },
  {
    id: "hint-veteran",
    name: "Veteran",
    kind: "hint",
    where: { at: "route", biome: "meadow", nth: 1 },
    lines: [
      "Nothing out here is rolled when you meet it. It was decided when the world was made.",
      "Which means running away does not reroll it — it spends it. That slot is gone. I have lost two shinies that way and I think about them daily.",
    ],
  },
  {
    id: "hint-tactician",
    name: "Tactician",
    kind: "hint",
    where: { at: "route", biome: "bramblewood", nth: 1 },
    lines: [
      "Hover anything in a battle and it will tell you everything — its stats, its effort, what it knows.",
      "There is no hidden information in this world. There is only information you did not look at.",
    ],
  },
  {
    id: "hint-effort",
    name: "Trainer",
    kind: "hint",
    where: { at: "route", biome: "thunderplain", nth: 2 },
    lines: [
      "What you fight is what you become. Beat attackers and you get attack.",
      "Five hundred and ten points, total, and no more. Spend them on purpose or something else will spend them for you.",
    ],
  },
  {
    id: "hint-lost",
    name: "Lost Walker",
    kind: "hint",
    where: { at: "route", biome: "pinewood", nth: 1 },
    lines: [
      "Do not trust the trees. They all look like that.",
      "Use the small map. The way through is drawn on it, and it is drawn correctly, which is more than I can say for my sense of direction.",
    ],
  },



  // ============================================ the survey, one to a route
  //
  // Fifty of them, one on every route in the world, and between them they are
  // a long-range expedition that fanned out across it — officers by
  // department, the odd diplomat, and the merchants who followed the fleet
  // because merchants always do.
  //
  // One to a route rather than a scattering, because "somewhere out there is a
  // trader" is a rumour and "there is somebody on every route" is a *reason to
  // walk down one*. A route with a maze, a handful of trainers and nobody to
  // talk to is a corridor with encounters in it.
  //
  // The merchants number their rules, which is the joke worth spending fifty
  // entries on: it gives every one of them a distinct opening line that is
  // also a small piece of a coherent philosophy, and the philosophy gets worse
  // the further out you go.
  //
  // Where each stands is `biome:nth`, and the fifty addresses cover the fifty
  // routes exactly once. `S1` checks that, because it is the sort of thing that
  // is obviously true right up until somebody adds a biome.

  {
    id: "trek-ensign-red",
    name: "Ensign Torvald",
    kind: "trade",
    where: { at: "route", biome: "meadow", nth: 1 },
    wants: { type: "normal", minLevel: 8 },
    gives: { speciesId: "growlithe", variantId: "normal", gender: "male", level: 10 },
    lines: [
      "Away team, first survey, and they gave me the red tunic. I have read the reports. I know what the red tunic means.",
      "I am staying here, by this rock, where it is flat and I can see everything coming.",
      "Bring me something ordinary and I will give you something with teeth. I would like something with teeth between me and the rest of this.",
    ],
  },
  {
    id: "trek-science-blue",
    name: "Lieutenant Sarek-Vaal",
    kind: "trade",
    where: { at: "route", biome: "meadow", nth: 2 },
    wants: { type: "grass", minLevel: 14 },
    gives: { speciesId: "abra", variantId: "normal", gender: "female", level: 16 },
    lines: [
      "Curious. You are emotional about a field of grass.",
      "I am cataloguing. Bring me a Grass specimen of level fourteen or better and I shall log it properly.",
      "In exchange, this one. It teleports when startled, which I find efficient rather than cowardly. There is a distinction.",
    ],
  },
  {
    id: "trek-counsellor",
    name: "Counsellor Deneb",
    kind: "trade",
    where: { at: "route", biome: "meadow", nth: 3 },
    wants: { type: "fairy", minLevel: 20 },
    gives: { speciesId: "ralts", variantId: "tint2", gender: "female", level: 22, nickname: "Empath" },
    lines: [
      "I sense that you are... carrying a great many creatures. That is my read. I am very good at this.",
      "Bring me a Fairy one, level twenty or above. I want something that feels what I feel, so I have somebody to compare notes with.",
      "This one already does. It is exhausting for us both and I would like a rest.",
    ],
  },
  {
    id: "trek-quartermaster",
    name: "Quartermaster Vell",
    kind: "trade",
    where: { at: "route", biome: "meadow", nth: 4 },
    wants: { type: "bug", minLevel: 26 },
    gives: { speciesId: "scyther", variantId: "normal", gender: "male", level: 28 },
    lines: [
      "Requisition, form and function, in and out. I have run this store nineteen years and lost precisely one thing.",
      "A Bug one, level twenty-six or better. Do not ask why. It is on the manifest and the manifest is not a conversation.",
      "Sign here. And here. This one is yours and I never want to hear about it again.",
    ],
  },
  {
    id: "trek-rule-one",
    name: "Grand Nagus Quom",
    kind: "trade",
    where: { at: "route", biome: "pinewood", nth: 1 },
    wants: { type: "normal", minLevel: 10 },
    gives: { speciesId: "meowth", variantId: "tint1", gender: "male", level: 12, nickname: "Latinum" },
    lines: [
      "The First Rule of Acquisition: once you have their money, never give it back.",
      "I am not asking for money. I am asking for a creature, which is money that walks.",
      "Something Normal, level ten or better, and this one is yours. It finds coins. I have never once regretted owning it.",
    ],
  },
  {
    id: "trek-rule-nine",
    name: "Trader Brek",
    kind: "trade",
    where: { at: "route", biome: "pinewood", nth: 2 },
    wants: { type: "flying", minLevel: 18 },
    gives: { speciesId: "murkrow", variantId: "normal", gender: "female", level: 20 },
    lines: [
      "Ninth Rule: opportunity plus instinct equals profit. You have the instinct. I am the opportunity.",
      "Something that flies, level eighteen or over. Nothing sentimental about it — flying things see more, and seeing more is worth more.",
      "This one collects shiny objects and gives me none of them. Perhaps it will like you better.",
    ],
  },
  {
    id: "trek-rule-thirty",
    name: "Trader Nol",
    kind: "trade",
    where: { at: "route", biome: "pinewood", nth: 3 },
    wants: { type: "ghost", minLevel: 26 },
    gives: { speciesId: "misdreavus", variantId: "tint3", gender: "female", level: 28, nickname: "Dividend" },
    lines: [
      "Thirty-Fourth Rule: war is good for business. Thirty-Fifth: peace is good for business. I have never had a bad quarter.",
      "A Ghost one, twenty-six or better. They are hard to inventory, which drives the price up beautifully.",
      "Take this. It is worth more than it looks and I am telling you that, which should worry you.",
    ],
  },
  {
    id: "trek-engineer-pine",
    name: "Chief Scott-Mairi",
    kind: "quest",
    questId: "the-miracle",
    where: { at: "route", biome: "pinewood", nth: 4 },
    lines: [
      "I cannae give you more power. I can give you *slightly* more power, in about six hours, if you stop asking.",
      "Here is the thing about miracles: they are just maintenance somebody did in advance.",
      "Do the work. Come back when you have. Then we will talk about miracles.",
    ],
  },
  {
    id: "trek-botanist",
    name: "Botanist Ch'rell",
    kind: "trade",
    where: { at: "route", biome: "bramblewood", nth: 1 },
    wants: { type: "grass", minLevel: 10 },
    gives: { speciesId: "hoppip", variantId: "normal", gender: "female", level: 12 },
    lines: [
      "Do not step there. Or there. Honestly, stand still and let me draw a box around you.",
      "A Grass one, level ten or above, and I will log it as a donation rather than as a theft, which is what I am currently writing.",
      "Take this in exchange. It goes where the wind goes and it has never once made a decision.",
    ],
  },
  {
    id: "trek-rule-fortyseven",
    name: "Trader Gaint",
    kind: "trade",
    where: { at: "route", biome: "bramblewood", nth: 2 },
    wants: { type: "poison", minLevel: 18 },
    gives: { speciesId: "koffing", variantId: "normal", gender: "male", level: 20 },
    lines: [
      "Forty-Seventh Rule: never trust anyone wearing a better suit than your own. Look at us both. I feel we can proceed.",
      "Poison, level eighteen or better. There is enormous money in things nobody else will handle.",
      "This one is entirely safe as long as it stays exactly that far away from you.",
    ],
  },
  {
    id: "trek-security",
    name: "Lieutenant Worv",
    kind: "trade",
    where: { at: "route", biome: "bramblewood", nth: 3 },
    wants: { type: "dark", minLevel: 26 },
    gives: { speciesId: "houndoom", variantId: "normal", gender: "male", level: 29 },
    lines: [
      "You approached without announcing yourself. On my world that is a challenge. On this one I am told it is a hello.",
      "Bring me something Dark, level twenty-six or better. A creature that fights honourably is a creature that has not been tested.",
      "This one has been tested. Today is a good day to hand it over.",
    ],
  },
  {
    id: "trek-archivist",
    name: "Archivist Thal",
    kind: "trade",
    where: { at: "route", biome: "bramblewood", nth: 4 },
    wants: { type: "psychic", minLevel: 32 },
    gives: { speciesId: "kadabra", variantId: "tint2", gender: "trans", level: 34, nickname: "Index" },
    lines: [
      "Everything gets written down. Everything. Including this conversation, and including the pause you just left.",
      "A Psychic one, thirty-two or better. I want something that can read the record back to me when my eyes go.",
      "This one already tried. It read the record back to me and then looked at me differently. Take it.",
    ],
  },
  {
    id: "trek-medic-marsh",
    name: "Doctor Beaux",
    kind: "trade",
    where: { at: "route", biome: "marsh", nth: 1 },
    wants: { type: "water", minLevel: 10 },
    gives: { speciesId: "psyduck", variantId: "normal", gender: "male", level: 12 },
    lines: [
      "I am a doctor, not a naturalist. I have said this eleven times today and the log now simply reads *as usual*.",
      "Bring me something Water, level ten or better, and I will stop being asked to catch one myself.",
      "This one has a headache. It always has a headache. We understand each other and it is going with you.",
    ],
  },
  {
    id: "trek-rule-sixtytwo",
    name: "Trader Sarn",
    kind: "trade",
    where: { at: "route", biome: "marsh", nth: 2 },
    wants: { type: "water", minLevel: 18 },
    gives: { speciesId: "lombre", variantId: "normal", gender: "female", level: 20 },
    lines: [
      "Sixty-Second Rule: the riskier the road, the greater the profit. I have never seen a road this wet.",
      "Water, level eighteen or over. The market for damp things is unaccountably strong this year.",
      "Here. It floats, it dances, and it has cost me a fortune in dry socks.",
    ],
  },
  {
    id: "trek-helm",
    name: "Helmsman Su-Lin",
    kind: "trade",
    where: { at: "route", biome: "marsh", nth: 3 },
    wants: { type: "poison", minLevel: 26 },
    gives: { speciesId: "croagunk", variantId: "normal", gender: "male", level: 28 },
    lines: [
      "Oh my. You came through the reeds. Most people go round. I approve enormously.",
      "Something Poison, level twenty-six or better. I collect things that are more dangerous than they look. It is a hobby.",
      "This one is exactly as dangerous as it looks, which makes it the honest one of the pair.",
    ],
  },
  {
    id: "trek-exo-marsh",
    name: "Exobiologist Tam",
    kind: "quest",
    questId: "the-tribbles",
    where: { at: "route", biome: "marsh", nth: 4 },
    lines: [
      "There is a thing out here that multiplies. I logged four of them on Tuesday. There are now rather more than four.",
      "They are soft. They are pleasant. They are, and I want to be precise, *a problem*.",
      "Help me count them and I will make it worth your while, assuming there is still a me by then.",
    ],
  },
  {
    id: "trek-engineer-thunder",
    name: "Engineer Ba'rat",
    kind: "trade",
    where: { at: "route", biome: "thunderplain", nth: 1 },
    wants: { type: "electric", minLevel: 10 },
    gives: { speciesId: "magnemite", variantId: "normal", gender: "trans", level: 12 },
    lines: [
      "Do not touch the pylon. Everyone touches the pylon. There is a form for it now.",
      "An Electric one, level ten or better. I am building something and it needs a heart with a temper.",
      "Take this in exchange. It hums. After a week you stop hearing it, and then you cannot sleep without it.",
    ],
  },
  {
    id: "trek-rule-ninetyfour",
    name: "Trader Dosk",
    kind: "trade",
    where: { at: "route", biome: "thunderplain", nth: 2 },
    wants: { type: "electric", minLevel: 18 },
    gives: { speciesId: "electabuzz", variantId: "normal", gender: "male", level: 21 },
    lines: [
      "Ninety-Fourth Rule: females and finances do not mix. My sister runs the accounts and has asked me to stop saying that.",
      "Electric, eighteen or better. Storms are free and I have found a way to bottle one.",
      "This is the bottle. It is not happy about it.",
    ],
  },
  {
    id: "trek-astrometrics",
    name: "Cadet Uhora",
    kind: "trade",
    where: { at: "route", biome: "thunderplain", nth: 3 },
    wants: { type: "flying", minLevel: 26 },
    gives: { speciesId: "xatu", variantId: "tint1", gender: "female", level: 28 },
    lines: [
      "Hailing on all frequencies. Nothing is answering. There is a great deal of *sky* here and none of it wants to talk.",
      "Bring me something that flies, twenty-six or better, and I will get a message out one way or another.",
      "This one stares at the horizon all day. If anything is coming, it already knows.",
    ],
  },
  {
    id: "trek-tactical",
    name: "Commander Riken",
    kind: "trade",
    where: { at: "route", biome: "thunderplain", nth: 4 },
    wants: { type: "fighting", minLevel: 32 },
    gives: { speciesId: "machoke", variantId: "normal", gender: "male", level: 35 },
    lines: [
      "I sat down on that rock. You are going to want to know why I sat down like that. Everyone does.",
      "Something Fighting, thirty-two or better. I like a creature that leads from the front and complains about it afterwards.",
      "This one does both, magnificently.",
    ],
  },
  {
    id: "trek-geologist",
    name: "Geologist Pell",
    kind: "trade",
    where: { at: "route", biome: "ashflats", nth: 1 },
    wants: { type: "rock", minLevel: 12 },
    gives: { speciesId: "geodude", variantId: "normal", gender: "trans", level: 14 },
    lines: [
      "Every rock here has been on fire at least once. You can tell. They have the look.",
      "A Rock one, level twelve or better. I want a sample that can walk to the lab by itself.",
      "This one can. It also rolls downhill without warning, which I should have mentioned first.",
    ],
  },
  {
    id: "trek-rule-onezero",
    name: "Trader Frin",
    kind: "trade",
    where: { at: "route", biome: "ashflats", nth: 2 },
    wants: { type: "fire", minLevel: 22 },
    gives: { speciesId: "magmar", variantId: "normal", gender: "male", level: 25 },
    lines: [
      "Hundred-and-Second Rule: nature decays, but latinum lasts forever. So does a good grudge, but that is not on the list.",
      "Fire, level twenty-two or over. Ash is cheap. Anything that *makes* ash is not.",
      "This one costs me a fortune in insurance and I am delighted to make it your problem.",
    ],
  },
  {
    id: "trek-historian",
    name: "Historian Corda",
    kind: "quest",
    questId: "the-record",
    where: { at: "route", biome: "ashflats", nth: 3 },
    lines: [
      "This was a battlefield. Not this ash — under it. Three metres down there is a very bad afternoon.",
      "I am trying to establish who won, which is harder than it sounds when everybody involved lost.",
      "Fight enough of the people out here and bring me the count. Numbers are the only honest history.",
    ],
  },
  {
    id: "trek-survey-dunes",
    name: "Surveyor Nix",
    kind: "trade",
    where: { at: "route", biome: "dunes", nth: 1 },
    wants: { type: "ground", minLevel: 12 },
    gives: { speciesId: "sandshrew", variantId: "normal", gender: "female", level: 14 },
    lines: [
      "Sixty grid squares. All sand. I have named nine of them out of sheer loneliness.",
      "A Ground one, twelve or better, and I will put your name on square forty-one.",
      "This one digs. It is the only company I have had for a month and it has never once dug where I asked.",
    ],
  },
  {
    id: "trek-rule-hundred",
    name: "Trader Zek",
    kind: "trade",
    where: { at: "route", biome: "dunes", nth: 2 },
    wants: { type: "ground", minLevel: 22 },
    gives: { speciesId: "hippowdon", variantId: "normal", gender: "male", level: 26 },
    lines: [
      "Hundred-and-Sixth Rule: there is no honour in poverty. There is a great deal of sand, however, and it is free.",
      "Ground, level twenty-two or better. Everybody out here needs one and only I have any.",
      "Cartel is such an ugly word. Take this and let us both be vague about it.",
    ],
  },
  {
    id: "trek-navigator-dunes",
    name: "Navigator Chek",
    kind: "trade",
    where: { at: "route", biome: "dunes", nth: 3 },
    wants: { type: "dragon", minLevel: 32 },
    gives: { speciesId: "vibrava", variantId: "normal", gender: "female", level: 35 },
    lines: [
      "The dunes move. The map does not. I have raised this with the cartography department and they have raised it with a drawer.",
      "Something Dragon, thirty-two or better. Only a dragon can hold a straight line out here.",
      "This one hums as it flies. You can navigate by the noise, which is more than the map ever did.",
    ],
  },
  {
    id: "trek-medic-frost",
    name: "Nurse Chapek",
    kind: "trade",
    where: { at: "route", biome: "frostmire", nth: 1 },
    wants: { type: "ice", minLevel: 12 },
    gives: { speciesId: "swinub", variantId: "normal", gender: "female", level: 14 },
    lines: [
      "Frostbite, frostbite, hypothermia, and a man who ate a berry I specifically labelled.",
      "Bring me an Ice one, level twelve or better. I want something that thinks this weather is *fine*.",
      "This one does. It has been asleep in a snowdrift for a week and it is thriving.",
    ],
  },
  {
    id: "trek-rule-onetwo",
    name: "Trader Imm",
    kind: "trade",
    where: { at: "route", biome: "frostmire", nth: 2 },
    wants: { type: "ice", minLevel: 22 },
    gives: { speciesId: "sneasel", variantId: "normal", gender: "female", level: 25 },
    lines: [
      "Hundred-and-Eleventh Rule: treat people in your debt like family — exploit them. My cousin taught me that. I owe him nothing.",
      "Ice, twenty-two or better. Cold keeps. Cold stores. Cold is a warehouse that costs nothing to run.",
      "This one steals. From me, mostly. Consider it a transfer of liabilities.",
    ],
  },
  {
    id: "trek-holo-frost",
    name: "Programmer Barkley",
    kind: "trade",
    where: { at: "route", biome: "frostmire", nth: 3 },
    wants: { type: "psychic", minLevel: 32 },
    gives: { speciesId: "gothorita", variantId: "tint2", gender: "female", level: 34, nickname: "Program" },
    lines: [
      "The safeties are off. That is not a threat, it is a status report, and I have filed it four times.",
      "A Psychic one, thirty-two or over. I need something that can tell what is real. I have lost the knack.",
      "This one knows. It has looked at me and it knows, and I would rather it went with you.",
    ],
  },
  {
    id: "trek-chemist",
    name: "Chemist Odo-Vek",
    kind: "trade",
    where: { at: "route", biome: "saltpan", nth: 1 },
    wants: { type: "rock", minLevel: 12 },
    gives: { speciesId: "nosepass", variantId: "normal", gender: "male", level: 15 },
    lines: [
      "Salt. Salt as far as the instruments go. I came here for the salt and I have got exactly what I asked for.",
      "A Rock one, level twelve or better. I want to know what this place does to a thing that stands in it.",
      "This one has stood in it for a while. It points north now, permanently, and nobody knows why.",
    ],
  },
  {
    id: "trek-rule-onethree",
    name: "Trader Quill",
    kind: "trade",
    where: { at: "route", biome: "saltpan", nth: 2 },
    wants: { type: "steel", minLevel: 22 },
    gives: { speciesId: "magneton", variantId: "normal", gender: "trans", level: 26 },
    lines: [
      "Hundred-and-Twenty-First Rule: everything is for sale, including good will. Mine is on offer at a very reasonable rate.",
      "Steel, level twenty-two or better. Metal keeps its value out here, which is more than can be said for anybody's word.",
      "Three heads. Three opinions. Best of three. It has never once agreed with itself and it has never once been wrong.",
    ],
  },
  {
    id: "trek-diplomat",
    name: "Ambassador Sarn-Tal",
    kind: "quest",
    questId: "the-directive",
    where: { at: "route", biome: "saltpan", nth: 3 },
    lines: [
      "I am here to open relations. With whom is not yet established, which has made the first fortnight quiet.",
      "The standing order is that we observe and do not interfere. I have observed a great deal of salt.",
      "Do something notable and I will have something to put in the report. Please. It is a very short report.",
    ],
  },
  {
    id: "trek-navigator-storm",
    name: "Navigator Prilla",
    kind: "trade",
    where: { at: "route", biome: "stormcoast", nth: 1 },
    wants: { type: "water", minLevel: 12 },
    gives: { speciesId: "wingull", variantId: "normal", gender: "female", level: 14 },
    lines: [
      "Wind from everywhere at once. The instruments have given up and are simply spinning now, companionably.",
      "Something Water, twelve or better. I want a second opinion on where the sea is.",
      "This one always knows. It is unbearable about it.",
    ],
  },
  {
    id: "trek-rule-onefour",
    name: "Trader Vosk",
    kind: "trade",
    where: { at: "route", biome: "stormcoast", nth: 2 },
    wants: { type: "water", minLevel: 22 },
    gives: { speciesId: "tentacruel", variantId: "normal", gender: "male", level: 26 },
    lines: [
      "Hundred-and-Thirty-Fifth Rule: listen to secrets, but never repeat them. Repeating is free. Listening is where the money is.",
      "Water, twenty-two or better. Half the fleet is down there and half the fleet had cargo.",
      "This one helped me look. It has kept most of what it found and I have decided not to raise it.",
    ],
  },
  {
    id: "trek-captain-storm",
    name: "Captain Jean-Lu",
    kind: "quest",
    questId: "no-win",
    where: { at: "route", biome: "stormcoast", nth: 3 },
    lines: [
      "There are days when the correct order is *hold*, and the correct order is the hardest one to give.",
      "Out here the sea gives you a no-win scenario roughly weekly. The test is not whether you win it.",
      "The test is what you do the morning after. Take this on and show me the morning after.",
    ],
  },
  {
    id: "trek-glaciologist",
    name: "Glaciologist Ren",
    kind: "trade",
    where: { at: "route", biome: "glacier", nth: 1 },
    wants: { type: "ice", minLevel: 16 },
    gives: { speciesId: "snorunt", variantId: "normal", gender: "trans", level: 18 },
    lines: [
      "Nine hundred years of weather, stacked up like paperwork. I am reading it backwards.",
      "An Ice one, level sixteen or better. I want to see what it makes of the deep layers.",
      "Take this. It is nine hundred years younger than the ice and considerably more talkative.",
    ],
  },
  {
    id: "trek-rule-onefive",
    name: "Trader Ghen",
    kind: "trade",
    where: { at: "route", biome: "glacier", nth: 2 },
    wants: { type: "steel", minLevel: 30 },
    gives: { speciesId: "beartic", variantId: "normal", gender: "male", level: 34, nickname: "Coldstore" },
    lines: [
      "Hundred-and-Sixty-Second Rule: even in the worst of times, someone turns a profit. Look around. Is this not the worst of times?",
      "Steel, thirty or better. Nothing rusts here. Everything I own is in perfect condition and worth nothing to anybody.",
      "Except this. This is worth a great deal, and I want it out of my sight before I grow fond of it.",
    ],
  },
  {
    id: "trek-volcanologist",
    name: "Volcanologist Kesh",
    kind: "trade",
    where: { at: "route", biome: "emberfields", nth: 1 },
    wants: { type: "fire", minLevel: 16 },
    gives: { speciesId: "slugma", variantId: "normal", gender: "trans", level: 19 },
    lines: [
      "The readings say this is stable. The readings have said that for six weeks and the readings are new here.",
      "A Fire one, sixteen or better. I want a thermometer with opinions.",
      "This one is nine hundred degrees and extremely affectionate. Wear the gloves.",
    ],
  },
  {
    id: "trek-rule-onesix",
    name: "Trader Tarn",
    kind: "trade",
    where: { at: "route", biome: "emberfields", nth: 2 },
    wants: { type: "fire", minLevel: 30 },
    gives: { speciesId: "magcargo", variantId: "tint3", gender: "male", level: 34, nickname: "Overhead" },
    lines: [
      "Two Hundred and Second Rule: the justification for profit is profit. I did not write it. I do agree with it.",
      "Fire, thirty or better. There is a market for warmth in a world with a glacier in it. I am that market.",
      "This one is the last of the stock. Everything else melted the shelving.",
    ],
  },
  {
    id: "trek-security-dusk",
    name: "Ensign Vell'ka",
    kind: "trade",
    where: { at: "route", biome: "duskhollow", nth: 1 },
    wants: { type: "ghost", minLevel: 18 },
    gives: { speciesId: "shuppet", variantId: "normal", gender: "female", level: 21 },
    lines: [
      "Something moved. I am not saying it was a creature. I am saying something moved and my instruments say nothing did.",
      "A Ghost one, level eighteen or better. I want to know what my instruments are missing.",
      "This one is what they are missing. Look at the readout. Now look at the creature. Now look at the readout.",
    ],
  },
  {
    id: "trek-counsellor-dusk",
    name: "Counsellor Ilya",
    kind: "trade",
    where: { at: "route", biome: "duskhollow", nth: 2 },
    wants: { type: "dark", minLevel: 30 },
    gives: { speciesId: "mightyena", variantId: "tint1", gender: "female", level: 33 },
    lines: [
      "I sense great hostility. From the hollow, from the trees, and now a little from you, which is fair.",
      "Something Dark, level thirty or over. I would like to sit with it and find out whether it is unhappy or simply built that way.",
      "This one is simply built that way. It was a relief to us both.",
    ],
  },
  {
    id: "trek-xenobio",
    name: "Xenobiologist Phlox-Ir",
    kind: "trade",
    where: { at: "route", biome: "mycelia", nth: 1 },
    wants: { type: "grass", minLevel: 18 },
    gives: { speciesId: "paras", variantId: "normal", gender: "male", level: 21 },
    lines: [
      "Ah! Marvellous! Do you know, in my culture we would eat several of these and consider the evening a success.",
      "Bring me something Grass, eighteen or better, and I shall put it in a jar and be delighted about it.",
      "Take this in exchange. It is already two organisms and neither is complaining.",
    ],
  },
  {
    id: "trek-rule-oneseven",
    name: "Trader Muk-Ka",
    kind: "trade",
    where: { at: "route", biome: "mycelia", nth: 2 },
    wants: { type: "bug", minLevel: 30 },
    gives: { speciesId: "parasect", variantId: "normal", gender: "trans", level: 33 },
    lines: [
      "Two Hundred and Eighth Rule: sometimes the only thing more dangerous than a question is an answer. I sell both.",
      "Bug, thirty or better. Everything here is a bug or is about to be one.",
      "This one is about to be one. I would move it along briskly.",
    ],
  },
  {
    id: "trek-medic-fell",
    name: "Doctor Krell",
    kind: "trade",
    where: { at: "route", biome: "fellgarden", nth: 1 },
    wants: { type: "poison", minLevel: 18 },
    gives: { speciesId: "gloom", variantId: "normal", gender: "female", level: 21 },
    lines: [
      "I am a doctor, not a gardener. Although I have now been both for three weeks and the garden is winning.",
      "A Poison one, eighteen or better. Everything here is poisonous and I would like one that admits it.",
      "This one admits it. Loudly. From some distance.",
    ],
  },
  {
    id: "trek-rule-oneeight",
    name: "Trader Prin",
    kind: "quest",
    questId: "the-shine-trade",
    where: { at: "route", biome: "fellgarden", nth: 2 },
    lines: [
      "Two Hundred and Eighty-Fifth Rule: no good deed ever goes unpunished. I have tested it. Repeatedly. It holds.",
      "So here is a bad deed dressed as a good one, which is the only kind I trust.",
      "Bring me something with real *shine* on it. The rare sort. I will pay properly and I will not ask where.",
    ],
  },
  {
    id: "trek-archaeologist",
    name: "Archaeologist Dax-Or",
    kind: "trade",
    where: { at: "route", biome: "boneyard", nth: 1 },
    wants: { type: "ground", minLevel: 34 },
    gives: { speciesId: "marowak", variantId: "normal", gender: "trans", level: 38, nickname: "Predecessor" },
    lines: [
      "I have had eight lifetimes and I still cannot walk past a bone without picking it up. It is becoming a problem.",
      "Something Ground, thirty-four or better. Whatever is under this place, it went under it a long time ago.",
      "This one is carrying a bone it did not start with. I have decided not to ask whose.",
    ],
  },
  {
    id: "trek-astro",
    name: "Astrometrics Chief Ilaan",
    kind: "trade",
    where: { at: "route", biome: "cloudreach", nth: 1 },
    wants: { type: "flying", minLevel: 36 },
    gives: { speciesId: "altaria", variantId: "tint2", gender: "female", level: 40, nickname: "Nebula" },
    lines: [
      "From up here the whole world is a map, and the map is finally right, and nobody down there will believe me.",
      "Something that flies, thirty-six or better. I want to send it further out than I can see.",
      "This one has been further out than I can see. It has not said what is there and I have stopped asking.",
    ],
  },
  {
    id: "trek-collector",
    name: "Curator Vashti",
    kind: "quest",
    questId: "behind-glass",
    where: { at: "route", biome: "crystalvault", nth: 1 },
    lines: [
      "Everything in here is behind glass, and everything behind glass is safe, and nothing behind glass is *alive*.",
      "I have spent my life on that sentence and I am no longer sure which half I believe.",
      "Bring me the rarest thing you can find, and I will tell you which half I settled on.",
    ],
  },
  {
    id: "trek-salvage",
    name: "Salvage Chief Torres-Bel",
    kind: "trade",
    where: { at: "route", biome: "slagheap", nth: 1 },
    wants: { type: "steel", minLevel: 34 },
    gives: { speciesId: "scizor", variantId: "normal", gender: "female", level: 38 },
    lines: [
      "Everything here was something else first. That is not sad. That is the whole business.",
      "Steel, thirty-four or better. Give me something that has already been through it once.",
      "This one has been through it twice. It runs better than anything that came out of a factory.",
    ],
  },
  {
    id: "trek-deepwater",
    name: "Commander Data-Vel",
    kind: "trade",
    where: { at: "route", biome: "sunkenreach", nth: 1 },
    wants: { type: "water", minLevel: 36 },
    gives: { speciesId: "lapras", variantId: "tint1", gender: "female", level: 40, nickname: "Andante" },
    lines: [
      "I have attempted humour four times this expedition. The results are recorded and I would rather not discuss them.",
      "A Water one, thirty-six or better. I wish to compare its behaviour underwater with the model I have built of it.",
      "The model is wrong. It has been wrong for eleven months. I find that I have begun to prefer the creature.",
    ],
  },

  // ================================================= the three outer towns
  //
  // Each is an homage, and everything in it leans the same way: the people, what
  // they say, the jobs they hand out, the shelf in the Mart and the creatures
  // pottering about. A town whose cast is a joke and whose shop is generic is a
  // set with a shop painted on it.
  //
  // Recognisable rather than transcribed. The situations are the programmes';
  // the words are this game's. That is the better joke anyway — a line lifted
  // whole is somebody else's, and a line that lands because you know what it is
  // *doing* is a joke you and the game are making together.

  /*
   * The man with the printer.
   *
   * Somewhere near home the seed decides — a town, or a route in the first two
   * rings. The Slurm he hands over is New Willow's, wherever he has set up: a
   * failed print has to hand over *something*, and there was already a can of
   * it on that town's shelf.
   *
   * See `engine/printer.ts` for the whole shape of him. He is the one NPC in
   * the game whose stock is decided by where you have just been walking.
   */
  {
    id: "print-ivo",
    name: "Ivo",
    kind: "print",
    where: { at: "wander", maxRing: 2 },
    lines: [
      "Additive chromatic reconstruction. It is a printer. It prints them in colour.",
      "Only one specimen on file at a time, and it is whatever the scanner last picked up out in the grass — so if you want a copy of something, go and stand in front of it first.",
      "Ivory is all I have loaded. Ran the rest dry months ago and the supplier has stopped answering. If you turn up a cartridge out there I will take it and the colour stays unlocked.",
      "Three thousand a go, up front. Fair warning: about one in four comes out as sludge. You get a can of Slurm and my sympathies, the money stays spent, and the machine needs a good long while before it will go again.",
    ],
  },

  /*
   * The man who takes them off your hands.
   *
   * He never says what the machine does. He says everything *around* what the
   * machine does — the noise, the paperwork, the drum, the fact that you would
   * rather not see it — and lets you assemble it yourself, which is both
   * funnier and the only way a joke like this is bearable.
   *
   * Wherever the seed puts him, near home — no longer two doors down from the
   * man with the printer, though they are still the same joke told from
   * opposite ends: one turns
   * a scan into a creature and one turns a creature into a resource, and
   * neither will be drawn on the middle step.
   */
  {
    id: "shred-marv",
    name: "Marv",
    kind: "shred",
    where: { at: "wander", maxRing: 2 },
    lines: [
      "Bring me one you are finished with and I will see you right. One Rare Candy for every three levels it managed. Cash terms, no haggling, no receipts.",
      "What do I do with them? Reclamation. It is a reclamation business. There is a drum, and the drum turns, and I would honestly rather you waited outside while it does.",
      "Do not think about it too hard. Nobody in this town thinks about anything too hard and we are all perfectly happy, look at us.",
      "One a day, near enough. The machine gets hot, and when it gets hot it gets — well. It gets loud. Come back in a thousand steps or so.",
    ],
  },

  /*
   * The lapidary.
   *
   * Third of the three who will take a creature off you, and the
   * only one who is entirely candid about what happens to it. The printer
   * makes them, the shredder will not say, and she tells you exactly: it goes
   * on the wheel and it comes off as a stone.
   *
   * Which type of stone is not hers to choose and she says so — it is whatever
   * the creature *is*, and a two-type creature is a coin toss. See
   * `engine/lapidary.ts` for where that table comes from.
   */
  {
    id: "cut-hessa",
    name: "Hessa",
    kind: "cut",
    where: { at: "wander", maxRing: 2 },
    lines: [
      "Bring me one and it comes back a stone. Not a metaphor. It goes on the wheel and what comes off the wheel is a stone.",
      "Which stone is not up to me and it is not up to you either — it is whatever the thing was. Fire comes off fire. Water comes off water.",
      "Two types, two answers, and the wheel picks. I have never seen it favour one over the other and I have watched it a great deal more than is healthy.",
      "One at a time. The wheel takes a thousand steps to cool and I have learned not to hurry it.",
    ],
  },

  /*
   * The smith.
   *
   * In Sanchford rather than New Willow with the other three, because he is
   * not in their trade: they take a creature off you and he hands it straight
   * back, just not quite as it was. See `engine/smith.ts` for why he is random,
   * why he never lands on the nature it started with, and why he has no gate.
   *
   * He is completely at peace with the method. That is the joke.
   */
  {
    id: "forge-brenn",
    name: "Brenn",
    kind: "forge",
    where: { at: "town", town: "town-3", x: 18, y: 16 },
    lines: [
      "Temperament is just shape, and shape is just metal that has not been hit properly yet. Put it on the anvil.",
      "I use the hammer. I have always used the hammer. People ask whether there is a gentler way and the answer is that there is a Mint, and it is expensive, and it is not a hammer.",
      "It gets up different. Not the way you want, necessarily — the hammer does not take requests — but never the way it went down.",
      "Costs it a little something. One point, somewhere in the breeding, wherever the blow lands. You cannot swing a hammer without leaving a mark.",
    ],
  },

  // ---------------------------------------------------------- Southpass
  //
  // A small mountain town where appalling things happen weekly and nobody
  // remarks on it, chiefly because the people who would remark are eight.
  {
    id: "sp-hooded",
    name: "Hooded Boy",
    kind: "hint",
    where: { at: "town", town: "town-1", x: 14, y: 12 },
    lines: [
      "(You cannot make out a word of it. He is entirely inside the coat.)",
      "(He gestures at the hills, then at himself, then draws a finger across his throat, then shrugs.)",
      "(You get the impression this has happened before and will happen again on Thursday.)",
    ],
  },
  {
    id: "sp-witness",
    name: "Boy in a Bobble Hat",
    kind: "hint",
    where: { at: "town", town: "town-1", x: 17, y: 12 },
    lines: [
      "You did not see that. Nobody saw that.",
      "They have done it again. The absolute swines.",
      "He will be at school on Monday. He is always at school on Monday. Do not ask him about it, he gets funny.",
    ],
  },
  {
    id: "sp-gnome",
    name: "Small Person",
    kind: "quest",
    questId: "phase-two",
    where: { at: "town", town: "town-1", x: 10, y: 20 },
    lines: [
      "Phase one: collect underpants. That part is going extremely well.",
      "Phase three: profit.",
      "Phase two is under review. It has been under review for some years. We would rather talk about phase three.",
    ],
  },
  {
    id: "sp-cook",
    name: "The Cook",
    kind: "gift",
    item: "schoolgruel",
    where: { at: "interior", role: "mart", town: "town-1" },
    lines: [
      "Hello there, children.",
      "You look like somebody with a question, and I have got exactly one answer and it is soup.",
      "Take a ladleful. And if anybody in this town gives you advice, check who is holding the puppet first.",
    ],
  },
  {
    id: "sp-teacher",
    name: "Schoolmaster",
    kind: "hint",
    where: { at: "town", town: "town-1", x: 22, y: 8 },
    lines: [
      "Good morning. I shall let my colleague take this one.",
      "(He raises his left hand, which is wearing a small felt hat, and it addresses you directly.)",
      "\"Types beat types, children. Write it down. He never writes it down.\"",
    ],
  },
  {
    id: "sp-moral",
    name: "Boy in an Orange Coat",
    kind: "hint",
    where: { at: "town", town: "town-1", x: 25, y: 22 },
    lines: [
      "Look, I know it has been a strange week.",
      "But if you think about it, the real thing worth having was the six creatures we walked in with.",
      "...and I think we all learned something today. Right. I am going home. Forget the lot of you.",
    ],
  },
  {
    id: "sp-scout",
    name: "Bus Stop Regular",
    kind: "quest",
    questId: "the-cryptid",
    where: { at: "town", town: "town-1", x: 8, y: 14 },
    lines: [
      "There is a thing up in those hills and it is three animals at once. I have been saying so for years.",
      "Everybody nods and then changes the subject to the weather. I am not mad. It is half man, and half bear, and half pig.",
      "Bring me one of each and I will consider the point proven.",
    ],
  },

  // --------------------------------------------------------- New Willow
  //
  // The future arrived. It turned out to be a job, with a professor upstairs
  // who keeps inventing ways for everyone to die.
  {
    id: "nw-thawed",
    name: "Delivery Boy",
    kind: "hint",
    where: { at: "town", town: "town-2", x: 14, y: 12 },
    lines: [
      "I got shut in a freezer. I would rather not say how long for. It was a while.",
      "Everyone I knew is gone and there is a robot in my kitchen drinking my things.",
      "Anyway. I deliver parcels now. It is going fine. It is going absolutely fine.",
    ],
  },
  {
    id: "nw-professor",
    name: "The Professor",
    kind: "quest",
    questId: "good-news",
    where: { at: "town", town: "town-2", x: 18, y: 9 },
    lines: [
      "Splendid news, everybody! I have invented a job that will almost certainly kill you.",
      "Nothing to worry about. The last crew were all replaced very promptly.",
      "Off you go. Take something strong. Take several somethings strong.",
    ],
  },
  {
    id: "nw-doctor",
    name: "The Doctor",
    kind: "heal",
    where: { at: "interior", role: "centre", town: "town-2" },
    lines: [
      "A patient! Oh, this is wonderful. Nobody comes to see me.",
      "I am a doctor, you understand. Of a sort. Not that sort. A related sort.",
      "(Your creatures are, against every reasonable expectation, completely fine.)",
    ],
  },
  {
    id: "nw-captain",
    name: "The Captain",
    kind: "trade",
    where: { at: "town", town: "town-2", x: 26, y: 20 },
    wants: { type: "flying", minLevel: 30 },
    gives: { speciesId: "elgyem", variantId: "tint3", gender: "male", level: 38, nickname: "Cadet" },
    lines: [
      "You there! I am the captain and this is my ship and I have exactly one working eye, so do not try anything.",
      "I want something that flies. Level thirty or better. I have crashed everything else.",
      "You may have this in exchange. It came aboard on its own and it has been extremely polite about it.",
    ],
  },
  {
    id: "nw-clerk",
    name: "Bureaucrat",
    kind: "quest",
    questId: "the-inventory",
    where: { at: "town", town: "town-2", x: 10, y: 18 },
    lines: [
      "You want form nine-b. Everybody wants form nine-b.",
      "Form nine-b is obtained by filing form nine-a, which requires form nine-b. I have raised this. It has been noted.",
      "I have been Grade Thirty-Six for eleven years and I am *thriving*. Now. Would you like some work?",
    ],
  },
  {
    id: "nw-lucky",
    name: "Lucky Clover",
    kind: "gift",
    item: "slurm",
    where: { at: "town", town: "town-2", x: 22, y: 22 },
    lines: [
      "Drink this. Everyone drinks this. It is the finest drink in the world and it is made in a way nobody will discuss.",
      "There was a competition. I won a tour of the factory. I would rather I had not.",
      "It does put you right back on your feet. That part is true. I would leave the rest of it alone.",
    ],
  },

  // ----------------------------------------------------------- Sanchford
  //
  // One garage, one hole in reality, and a great deal of trouble.
  {
    id: "sf-grandfather",
    name: "The Grandfather",
    kind: "quest",
    questId: "one-more-adventure",
    where: { at: "town", town: "town-3", x: 15, y: 11 },
    lines: [
      "(He is drinking something and it is not water. There is a green hole in the wall of his garage.)",
      "Right. You look competent. Competent-ish. You have a bag and a pulse, which puts you ahead.",
      "One job. Do not ask what it is for. If you ask what it is for I will tell you, and then you will be *involved*.",
    ],
  },
  {
    id: "sf-grandson",
    name: "The Grandson",
    kind: "hint",
    where: { at: "town", town: "town-3", x: 18, y: 11 },
    lines: [
      "Oh geez. Please do not encourage him.",
      "He says it is one adventure. It is never one adventure. There is always a second thing, and the second thing has teeth.",
      "If a version of me turns up and tells you I am dead, that one is lying. Probably. Mostly.",
    ],
  },
  {
    id: "sf-birdman",
    name: "The Bird Man",
    kind: "hint",
    where: { at: "town", town: "town-3", x: 24, y: 9 },
    lines: [
      "In my language, the word for what you are doing translates as *a small hurt, repeated on purpose*.",
      "Your friend is not being difficult. Your friend is in a great deal of pain and has made it everybody else's.",
      "That was not a criticism. It was an observation. In my culture, they are the same thing.",
    ],
  },
  {
    id: "sf-squanch",
    name: "Squanchy Sort",
    kind: "gift",
    item: "plumbus",
    where: { at: "town", town: "town-3", x: 11, y: 19 },
    lines: [
      "Hey! Squanch on in, take a squanch, get squanchy.",
      "You want a plumbus? Everyone squanching well needs a plumbus.",
      "(You do not know what most of that meant. You are also fairly sure some of it was rude.)",
    ],
  },
  {
    id: "sf-television",
    name: "Someone Watching Television",
    kind: "hint",
    where: { at: "town", town: "town-3", x: 27, y: 21 },
    lines: [
      "Eight hundred million channels. Every one of them is somewhere else's.",
      "This one is a man reviewing a chair for forty minutes. He does not like the chair.",
      "Do not look for a plot. There is no plot. That is the point and it took me a long time to enjoy it.",
    ],
  },
  {
    id: "sf-sauce",
    name: "Fast Food Historian",
    kind: "quest",
    questId: "the-sauce",
    where: { at: "town", town: "town-3", x: 20, y: 22 },
    lines: [
      "There was a sauce. It was available for a fortnight. Decades ago.",
      "A man in this town has built nine years of plans around getting another packet of it. Nine *years*.",
      "Bring me something worth a fortune and I will tell you where the last one is. That is the deal and I am not proud of it.",
    ],
  },

  // --------------------------------------------------------- the Grey Line
  //
  // One person, written once, standing in twenty-four places — the twenty
  // biomes and the four towns. See `{ at: "station" }` above for why it is one
  // entry rather than twenty-four, and `placeNpcs` for the expansion.
  //
  // They are grey on purpose, in the fiction before the palette: the coat is
  // the uniform of a service, and a service is exactly what this is. Every
  // other colour on the map means "something happens here" — a gift, a job, a
  // gym. Grey means "this is how you get somewhere else", which is the one
  // thing on the map that is infrastructure rather than an event.
  {
    id: "greyline",
    name: "Greycoat",
    kind: "travel",
    where: { at: "station" },
    lines: [
      "(Grey coat, grey hat, leaning on a post they look older than.)",
      "Grey Line. We keep somebody at every sort of place there is, and we walk the long way so you do not have to.",
      "Anywhere you have already been, we will take you back to. Somewhere you have not, you walk — that part is not ours to sell.",
    ],
  },

  // ------------------------------------------- the house at the far end
  //
  // The Steward keeps the door and the other five stand behind him. He is an
  // ordinary quest-giver with one unusual thing about him: the job he hands
  // out asks to see the invitation first, which is what the eight badges were
  // ever for.
  {
    id: "cup-steward",
    name: "Steward",
    kind: "quest",
    questId: "the-cup",
    where: { at: "cup" },
    lines: [
      "You found it. Most people who come this far were looking for something else.",
      "This is the Cup. Five of them, six each, and every one of those six bred the way a serious person breeds — perfect where it counts, every point of effort spent on purpose, and two abilities apiece.",
      "Two things before you say yes. There is no bed in this house, so nothing here gives your creatures their uses back — five battles on one tank, and when a move is spent it is spent. Whatever you brought in your bag is another matter. Bring more than you think you need.",
      "And if you go down you wake up in town, healed, having walked a very long way for nothing. The five you got past stay got past. That is the only mercy in the building.",
    ],
  },
  ...cupContenders(),
];

/**
 * The five, as people standing in a room.
 *
 * Read off the Cup's own roster rather than written out again here, so their
 * names, their order and what they say live in one file and the placement
 * lives in this one. A gym leader is assembled the same way, in placeNpcs.
 */
function cupContenders(): NpcPlacement[] {
  return CUP_ROSTER.map((spec) => ({
    id: spec.id,
    name: spec.name,
    kind: "cup" as const,
    cupId: spec.id,
    lines: spec.lines,
    where: { at: "cup" as const },
  }));
}

/** Everything an NPC says, plus whatever the offer is. */
export function dialogueOf(npc: NpcSpec, helped = false): string[] {
  // Somebody you have already dealt with may have a different story now.
  if (helped && npc.afterLines) return [...npc.afterLines];
  const lines = [...npc.lines];

  if (npc.kind === "gift" && npc.item) lines.push(`(${itemSpec(npc.item).name})`);
  if (npc.kind === "quest" && npc.questId) lines.push(questSpec(npc.questId).blurb);
  if (npc.kind === "cup" && npc.cupId) {
    const spec = cupSpec(npc.cupId);
    lines.push(
      `(Six${spec.slant ? ` ${spec.slant} types` : ""}, all at level ${spec.level}.)`,
    );
  }
  if (npc.kind === "trade" && npc.wants && npc.gives) {
    lines.push(`Wants ${wantText(npc.wants)} — gives ${givesText(npc.gives)}.`);
  }

  return lines;
}
