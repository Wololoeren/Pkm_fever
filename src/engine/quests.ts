import { CUP_IDS } from "./cup";
import { effortSpent } from "./effort";
import { item as itemSpec } from "./items";
import { species as speciesById } from "./dex";
import type { Bag } from "./items";
import type { Individual } from "./types";
import { variant } from "./variants";

/**
 * Quests, and the reason they need almost no state.
 *
 * Progress is *derived* rather than counted. Nothing increments when you catch
 * something; `progressOf` looks at the save and works out where you are. That
 * falls straight out of the rest of the design — the whole state is a pure
 * function of the input log — and it means a quest can be added, retuned or
 * removed without invalidating a single save, because there is no counter
 * stored anywhere that could disagree with the world it was counting.
 *
 * Only two things are recorded: which quests you have taken, and which you
 * have been paid for. Everything else is a question asked of the save.
 */

export type QuestGoal =
  | { t: "own"; count: number }
  | { t: "beatTrainers"; count: number }
  | { t: "reachRing"; ring: number }
  | { t: "ownChroma"; count: number }
  | { t: "ownTier"; tier: number }
  | { t: "ownSpecies"; speciesId: string }
  | { t: "ownType"; type: string; count: number }
  | { t: "carryItem"; item: string; count: number }
  | { t: "effort"; amount: number }
  | { t: "level"; level: number }
  | { t: "badges"; count: number }
  /**
   * The five in the house at the end of the ash flats.
   *
   * Named as a goal of its own rather than as `beatTrainers: 5`, because the
   * five it means are five particular people. A count would be satisfied by
   * any five trainers on any route, which is a different job entirely and one
   * the player has already done by the time anybody mentions the Cup.
   */
  | { t: "beatCup" };

export interface QuestSpec {
  id: string;
  name: string;
  /** What the giver says when you take it. */
  blurb: string;
  /** What to do. */
  goal: QuestGoal;
  reward: { money?: number; item?: string };
  /**
   * An item you must be carrying before anybody will hand this over.
   *
   * A gate on *taking* the job, not on finishing it, and it is never spent —
   * the one that uses it is the Cup, and the Steward at the door wants to see
   * an invitation rather than collect one. Kept as an item rather than as
   * "quest X is done" so the requirement is a thing in your bag that you can
   * look at, which is the same reason the invitation is an item at all.
   */
  needs?: string;
}

export const QUESTS: readonly QuestSpec[] = [
  {
    id: "first-steps",
    name: "Something to Walk With",
    blurb:
      "You cannot go far out there on one. Bring me word that you have three of them and I will pay for the trouble.",
    goal: { t: "own", count: 3 },
    reward: { money: 1200, item: "potion" },
  },
  {
    id: "the-rounds",
    name: "The Rounds",
    blurb: "Five people out on the routes reckon they are better than you. Prove otherwise.",
    goal: { t: "beatTrainers", count: 5 },
    reward: { money: 3000, item: "tm-bodyslam" },
  },
  {
    id: "far-enough",
    name: "Far Enough Out",
    blurb: "Nobody local has seen the fourth ring in years. Go and stand on it.",
    goal: { t: "reachRing", ring: 4 },
    reward: { money: 5000, item: "tm-earthquake" },
  },
  {
    id: "colour-theory",
    name: "Colour Theory",
    blurb:
      "There are creatures out there wearing colours they were not born with. Find two and I will make it worth your while.",
    goal: { t: "ownChroma", count: 2 },
    reward: { money: 8000, item: "greatball" },
  },
  {
    id: "the-shine",
    name: "The Shine",
    blurb:
      "Somewhere in this world there is exactly one true shiny. One. Bring it to me and I will not ask how.",
    goal: { t: "ownTier", tier: 5 },
    reward: { money: 25000, item: "superrod" },
  },
  {
    id: "a-ditto",
    name: "Shapeless",
    blurb: "I have never seen a Ditto up close. Get one and come back.",
    goal: { t: "ownSpecies", speciesId: "ditto" },
    reward: { money: 4000, item: "prism" },
  },
  {
    id: "the-drenched",
    name: "The Drenched",
    blurb: "Four things out of the water, and I will teach you what a rod is really for.",
    goal: { t: "ownType", type: "water", count: 4 },
    reward: { money: 3500, item: "goodrod" },
  },
  {
    id: "deep-pockets",
    name: "Deep Pockets",
    blurb: "Bring me three Nuggets. Do not ask what for.",
    goal: { t: "carryItem", item: "nugget", count: 3 },
    reward: { money: 12000 },
  },
  {
    id: "the-work",
    name: "The Work",
    blurb:
      "Anyone can catch a thing. Train one — properly, two hundred points of effort into it — and I will know you are serious.",
    goal: { t: "effort", amount: 200 },
    reward: { money: 7000, item: "rarecandy" },
  },
  {
    id: "world-cup",
    name: "The Invitation",
    blurb:
      "Eight badges. Not seven, not seven and a good story. Bring me eight and there is a seat with your name on it.",
    goal: { t: "badges", count: 8 },
    reward: { money: 100000, item: "worldcup" },
  },
  {
    id: "the-cup",
    name: "The Cup",
    needs: "worldcup",
    blurb:
      "Five of them, six each, and not one of them scaled to you. No bed in this house, so nothing here gives a move back once it is spent. Say the word and I will write you down.",
    goal: { t: "beatCup" },
    reward: { money: 300000, item: "thecup" },
  },
  {
    id: "the-climb",
    name: "The Climb",
    blurb: "Get one of them to level forty. It takes longer than you think.",
    goal: { t: "level", level: 40 },
    reward: { money: 6000, item: "ultraball" },
  },

  // ================================================= the three outer towns
  //
  // One or two apiece, and each is the shape of its town's joke told as a job
  // rather than as a line of dialogue. A homage you can only read is set
  // dressing; a homage you have to *do something about* is a quest.

  // Southpass. A business plan with a hole in the middle of it, and a cryptid
  // that is three animals, fetched as three animals.
  {
    id: "phase-two",
    name: "Phase Two",
    blurb:
      "Phase one is collecting. Phase three is profit. We are extremely confident about phase three. Bring us ten of anything and we will call that phase one completed.",
    goal: { t: "carryItem", item: "gnomepants", count: 3 },
    reward: { money: 4000, item: "cheesypuffs" },
  },
  {
    id: "the-cryptid",
    name: "Half Man, Half Bear, Half Pig",
    blurb:
      "Nobody doubts a bear. Nobody doubts a pig. It is the man half people get funny about. Bring me three of the man-ish sorts \u2014 three Fighting ones \u2014 and the man half is established, and after that it is simply arithmetic.",
    goal: { t: "ownType", type: "fighting", count: 3 },
    reward: { money: 6000, item: "tm-bodyslam" },
  },

  // New Willow. A job the professor is very cheerful about, which is itself
  // the warning.
  {
    id: "good-news",
    name: "Splendid News",
    blurb:
      "The delivery is straightforward! You will need to be roughly level forty to survive it, which I mention only in passing and certainly not as a condition.",
    goal: { t: "level", level: 40 },
    reward: { money: 9000, item: "slurm" },
  },
  {
    id: "the-inventory",
    name: "The Crew Replacement Programme",
    blurb:
      "Form nine-b, in triplicate: twenty people out on the routes, beaten, by you, in that order. The professor upstairs will sign off one of his devices as scrap once it is filed, and you may keep the scrap.",
    goal: { t: "beatTrainers", count: 20 },
    reward: { money: 12000, item: "doomsdaydevice" },
  },

  // Sanchford. One adventure, which is never one adventure, and a sauce.
  {
    id: "one-more-adventure",
    name: "One More Adventure",
    blurb:
      "Eight badges. That is the whole ask. Do not look at me like that — I need somebody the local authorities already take seriously, and badges are what passes for that here.",
    goal: { t: "badges", count: 6 },
    reward: { money: 15000, item: "meeseeksbox" },
  },
  {
    id: "the-sauce",
    name: "The Sauce",
    blurb:
      "Bring me something genuinely valuable and I will tell you where the last packet went. I am aware of how this sounds. I have made my peace with it.",
    goal: { t: "carryItem", item: "pearl", count: 2 },
    reward: { money: 20000, item: "szechuansauce" },
  },

  // ============================================ the survey's standing orders
  //
  // Seven, handed out by the officers scattered one to a route. Each is the
  // shape of a thing that programme did over and over: a miracle asked of
  // engineering with no time to do it in, a soft creature that multiplies, an
  // order to observe and not interfere, and a test nobody is meant to win.

  {
    id: "the-miracle",
    name: "The Miracle",
    blurb:
      "Everyone wants the miracle. Nobody wants the six hours of maintenance that make one possible. Get something of yours to level forty-five and I will show you the difference.",
    goal: { t: "level", level: 45 },
    reward: { money: 9000, item: "hyperpotion" },
  },
  {
    id: "the-tribbles",
    name: "They Multiply",
    blurb:
      "Five of the soft ones, in your party, at once. They are pleasant and they are harmless and there are more of them every time I look away. I would like a second opinion before I file anything.",
    goal: { t: "ownType", type: "normal", count: 5 },
    reward: { money: 7000, item: "ultraball" },
  },
  {
    id: "the-record",
    name: "The Honest History",
    blurb:
      "Whatever happened under this ash, everybody involved lost. Beat thirty of the people out on the routes and bring me the count. Numbers are the only history nobody can flatter.",
    goal: { t: "beatTrainers", count: 30 },
    reward: { money: 11000, item: "tm-earthquake" },
  },
  {
    id: "the-directive",
    name: "Observe, Do Not Interfere",
    blurb:
      "The standing order is that we watch and we keep our hands behind our backs. I have watched a great deal of salt. Go and do something notable so that I have something to put in the report.",
    goal: { t: "badges", count: 4 },
    reward: { money: 10000, item: "greatball" },
  },
  {
    id: "no-win",
    name: "The Morning After",
    blurb:
      "The sea gives you an unwinnable afternoon about once a week. The test was never the afternoon. Get out to the sixth band and come back, and we will talk about the morning after.",
    goal: { t: "reachRing", ring: 6 },
    reward: { money: 13000, item: "revive" },
  },
  {
    id: "the-shine-trade",
    name: "No Good Deed",
    blurb:
      "Something with real shine on it — the third rung or better. I will pay properly, I will not ask where it came from, and I will feel nothing about any of it.",
    goal: { t: "ownTier", tier: 3 },
    reward: { money: 16000, item: "nugget" },
  },
  {
    id: "behind-glass",
    name: "Behind Glass",
    blurb:
      "Two of the colours. Not the shine — the *colours*, the ones that were never born that way. Bring me two and I will tell you which half of my life's sentence I settled on.",
    goal: { t: "ownChroma", count: 2 },
    reward: { money: 14000, item: "heartscale" },
  },
];

const BY_ID = new Map(QUESTS.map((quest) => [quest.id, quest]));

export function quest(id: string): QuestSpec {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`unknown quest: ${id}`);
  return found;
}

export function isQuest(id: string): boolean {
  return BY_ID.has(id);
}

/** Everything the questing rules are allowed to look at. */
export interface QuestView {
  party: readonly Individual[];
  box: readonly Individual[];
  beaten: readonly string[];
  badges: readonly string[];
  visited: readonly string[];
  bag: Bag;
  ringOf: (routeId: string) => number;
}

export interface QuestProgress {
  have: number;
  need: number;
  done: boolean;
}

/**
 * How far along a quest is, asked of the save rather than remembered.
 *
 * Every branch counts something already there, which is the point: no quest
 * can drift out of step with the world, because the world is the only record.
 */
export function progressOf(view: QuestView, goal: QuestGoal): QuestProgress {
  const all = [...view.party, ...view.box];
  const done = (have: number, need: number): QuestProgress => ({
    have: Math.min(have, need),
    need,
    done: have >= need,
  });

  switch (goal.t) {
    case "own":
      return done(all.length, goal.count);

    case "beatTrainers":
      return done(view.beaten.length, goal.count);

    case "reachRing":
      return done(Math.max(0, ...view.visited.map(view.ringOf)), goal.ring);

    case "ownChroma":
      return done(all.filter((one) => variant(one.variantId).chromaId !== null).length, goal.count);

    case "ownTier":
      return done(Math.max(0, ...all.map((one) => variant(one.variantId).tier)), goal.tier);

    case "ownSpecies":
      return done(all.filter((one) => one.speciesId === goal.speciesId).length, 1);

    case "ownType":
      return done(
        all.filter((one) => speciesById(one.speciesId).types.some((type) => type === goal.type)).length,
        goal.count,
      );

    case "carryItem":
      return done(view.bag[goal.item] ?? 0, goal.count);

    case "effort":
      return done(Math.max(0, ...all.map((one) => effortSpent(one.evs))), goal.amount);

    case "level":
      return done(Math.max(0, ...all.map((one) => one.level)), goal.level);

    case "badges":
      return done(view.badges.length, goal.count);

    case "beatCup":
      return done(CUP_IDS.filter((id) => view.beaten.includes(id)).length, CUP_IDS.length);
  }
}

/** What a quest asks for, in a sentence, for the panel. */
export function goalText(goal: QuestGoal): string {
  switch (goal.t) {
    case "own":
      return `Have ${goal.count} creatures`;
    case "beatTrainers":
      return `Beat ${goal.count} trainers`;
    case "reachRing":
      return `Stand on ring ${goal.ring}`;
    case "ownChroma":
      return `Hold ${goal.count} wearing a colour`;
    case "ownTier":
      return `Hold a true shiny`;
    case "ownSpecies":
      return `Hold a ${speciesById(goal.speciesId).name}`;
    case "ownType":
      return `Hold ${goal.count} ${goal.type} types`;
    case "carryItem":
      return `Carry ${goal.count} x ${itemSpec(goal.item).name}`;
    case "effort":
      return `Train ${goal.amount} effort into one`;
    case "level":
      return `Raise one to level ${goal.level}`;
    case "badges":
      return `Win ${goal.count} gym badges`;
    case "beatCup":
      return `Beat all ${CUP_IDS.length} of them in the house`;
  }
}

/** What a quest pays, in a sentence. */
export function rewardText(reward: QuestSpec["reward"]): string {
  const parts: string[] = [];
  if (reward.money) parts.push(`¤${reward.money.toLocaleString()}`);
  if (reward.item) parts.push(itemSpec(reward.item).name);
  return parts.join(" and ") || "nothing at all";
}
