import { contender as cupSpec, CUP_ROSTER } from "./cup";
import { species as speciesById } from "./dex";
import { item as itemSpec } from "./items";
import { quest as questSpec } from "./quests";
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

export type NpcKind = "hint" | "gift" | "heal" | "trade" | "quest" | "gym" | "buy" | "cup";

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
  /** quest: which one. */
  questId?: string;
  /** gym: which one. */
  gymId?: string;
  /** cup: which of the five. */
  cupId?: string;
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
    /** Inside the cabin on that route — or, on a seed that grew no cabin
     * there, outside on the route itself. A person who exists on some seeds
     * and not others is not a person, it is a bug with a name. */
    | { at: "cabin"; biome: string; nth: number }
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

export const NPCS: readonly NpcPlacement[] = [
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
export function dialogueOf(npc: NpcSpec): string[] {
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
