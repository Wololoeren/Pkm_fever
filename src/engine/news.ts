import { species as speciesById } from "./dex";
import { intBelow, rngFor } from "./rng";
import type { Individual } from "./types";
import { variant } from "./variants";

/**
 * The feed: a channel that comments on your own game.
 *
 * Not a notification system — the game already has notices, and they say what
 * happened. This says something *about* what happened, in the voice of a feed
 * that has nothing better to do: half a dex entry, half a joke at the expense
 * of whatever just walked past. The point is the tone. A notice tells you a
 * Zubat was caught; the feed tells you the Zubat is having a difficult week.
 *
 * Every line is picked from the seed and the step it was written on, so a
 * replay writes the same feed word for word — it is state, not decoration,
 * and it survives a save like everything else.
 */

export interface NewsItem {
  /** The step count it was written on. */
  at: number;
  /** What sort of thing happened. The feed tab groups by nothing, but a kind is useful to test against. */
  kind: NewsKind;
  text: string;
}

export type NewsKind =
  | "caught"
  | "shiny"
  | "hatched"
  | "evolved"
  | "level"
  | "badge"
  | "beaten"
  /** Somebody standing on a route, beaten. */
  | "trainer"
  /** The grass, beaten — reported once in a while rather than every time. */
  | "wild"
  /** A creature swapped for another. */
  | "traded"
  /** A creature won rather than caught: a bracket, a lot, a pageant. */
  | "prize"
  | "idle";

/** How many the feed keeps. Older ones scroll off, as they do everywhere else. */
export const NEWS_KEPT = 40;

/** How many steps of quiet before the feed says something unprompted. */
export const NEWS_QUIET = 400;

/**
 * How many wild fights it takes before the feed mentions one.
 *
 * Every wild win used to be a post, which is thirty posts crossing one route
 * and a feed nobody can read — and they were filed under `trainer`, so the
 * grass was reported as "a trainer has been beaten" besides. A feed that
 * comments on everything says nothing; this is a running tally with a line at
 * the end of it.
 */
export const NEWS_WILD_EVERY = 30;

/** The levels worth remarking on. The same list the friend feed will use. */
export const NEWS_LEVELS: readonly number[] = [50, 60, 70, 80, 90, 100];

/** One of these, picked from the seed and the step. */
function pick(seed: string, at: number, kind: string, lines: readonly string[]): string {
  return lines[intBelow(rngFor(seed, "news", kind, at), lines.length)];
}

/** What to call it: its nickname if it has one, else its species. */
function nameOf(creature: Individual): string {
  return creature.nickname ?? speciesById(creature.speciesId).name;
}

/** The first of its types, capitalised, for a line that wants to say what it is. */
function typeOf(creature: Individual): string {
  const [type] = speciesById(creature.speciesId).types;
  return type ? `${type[0].toUpperCase()}${type.slice(1)}` : "unknowable";
}

const CAUGHT = [
  "{name} has been taken into custody. It is not clear that it noticed.",
  "BREAKING: local {type} type enters a ball voluntarily, sources say, possibly.",
  "{name} was doing perfectly well out here, thank you, and now look at it.",
  "New arrival: {name}. Reportedly having a really bad morning.",
  "{name} joins the roster. Nobody asked {name} about this.",
  "A wild {name} has been reclassified as a personal possession.",
  "{name}, caught at level {level}, which experts are calling 'a level'.",
  "Field note: {name} is a {type} type, which explains the smell.",
  "{name} was last seen entering a small red and white sphere of its own accord. Questions remain.",
];

const SHINY = [
  "A shiny {name}. Somewhere, a statistician is weeping.",
  "{name} turned up in the wrong colour and is refusing to apologise.",
  "RARE: {name} caught wearing something nobody else has. Expect imitators.",
  "{name} came out of the grass already dressed for something.",
];

const HATCHED = [
  "{name} has hatched and is already disappointed.",
  "It's a {name}! Congratulations to the two creatures in the daycare, who have not been told.",
  "{name} emerged after a long walk that it did not do any of.",
  "New life: {name}. Level one. Zero achievements. Universally beloved.",
];

const EVOLVED = [
  "{name} has changed and would prefer you did not bring up the old photographs.",
  "{name} evolved. Same creature, worse temperament, better numbers.",
  "LOCAL {type} TYPE GROWS: witnesses describe the process as 'a lot'.",
  "{name} is now legally a different animal.",
];

const LEVEL = [
  "{name} reaches level {level} and has started giving advice.",
  "Level {level} for {name}. The other five are pretending to be pleased.",
  "{name} hits level {level}. Somebody get it a cake it cannot eat.",
  "At level {level}, {name} is now stronger than most things it will ever meet.",
];

const BADGE = [
  "A badge. That is {badges} of them, if anybody is counting, and the feed is counting.",
  "Gym leader defeated. The gym is fine. The gym leader is fine. Everything is fine.",
  "You beat a gym, which is the sort of thing that gets a person talked about.",
  "Badge acquired. The other leaders have been notified and are unbothered.",
];

const BEATEN = [
  "Everything fainted. The feed was there. The feed saw.",
  "A brave showing by a party that is now horizontal.",
  "You have woken up somewhere clean and white, which is never a good sign.",
  "Analysts are calling that one 'a learning experience'.",
];

const TRAINER = [
  "A trainer has been beaten and is telling everyone it was close.",
  "Another one down. The route is quieter now, and poorer.",
  "You beat somebody who had been standing in that exact spot for weeks.",
  "Reports of a brief, decisive fight. Witnesses: nobody. Source: the winner.",
];

const WILD = [
  "{name} has been through the grass {count} times now and is starting to take it personally.",
  "That is {count} wild fights. The grass has filed a complaint.",
  "Sources close to {name} confirm another {count} in the books and no plans to stop.",
  "Local grass reports {count} incidents involving {name} and requests a word.",
  "{count} scraps deep. Nobody out there has learned anything yet.",
];

const TRADED = [
  "{name} has changed hands. The paperwork is somewhere.",
  "A trade! {name} is somebody else's problem now, and their {name} is yours.",
  "{name} left with a stranger and did not look back.",
  "Sources confirm a swap has taken place. Both parties believe they won.",
];

const PRIZE = [
  "{name} has been won rather than caught, which is a nicer word for the same thing.",
  "Prize collected: {name}, handed over by somebody who was smiling too much.",
  "{name} arrives with a certificate nobody will ever ask to see.",
  "{name} was a prize. {name} knows it was a prize. Be gentle.",
];

const IDLE = [
  "{name} has been staring at the same patch of ground for some time now.",
  "Nothing is happening. {name} seems fine with this.",
  "Dex fact: a {type} type such as {name} is, by definition, a {type} type.",
  "{name} would like you to know that it could carry more than it is currently carrying.",
  "Reminder: you have walked {steps} steps. That is a lot of steps.",
  "{name} is thinking about the daycare again.",
  "Nobody has fought anybody in a while. The feed is not judging. The feed is simply noting.",
  "Sources close to {name} describe it as 'ready'.",
  "{name} ({type}) remains undefeated at standing still.",
  "This is a slow news day and {name} is not helping.",
];

const LINES: Record<NewsKind, readonly string[]> = {
  caught: CAUGHT,
  shiny: SHINY,
  hatched: HATCHED,
  evolved: EVOLVED,
  level: LEVEL,
  badge: BADGE,
  beaten: BEATEN,
  trainer: TRAINER,
  wild: WILD,
  traded: TRADED,
  prize: PRIZE,
  idle: IDLE,
};

/** Fills a line's blanks. Anything not given is simply not mentioned. */
function fill(
  line: string,
  about: { creature?: Individual; level?: number; badges?: number; steps?: number; count?: number },
): string {
  return line
    .replaceAll("{name}", about.creature ? nameOf(about.creature) : "somebody")
    .replaceAll("{type}", about.creature ? typeOf(about.creature) : "unlabelled")
    .replaceAll("{level}", String(about.level ?? about.creature?.level ?? 1))
    .replaceAll("{badges}", String(about.badges ?? 0))
    .replaceAll("{steps}", (about.steps ?? 0).toLocaleString())
    .replaceAll("{count}", (about.count ?? 0).toLocaleString());
}

/** One item for the feed, written from the seed so a replay writes the same one. */
export function newsItem(
  seed: string,
  at: number,
  kind: NewsKind,
  about: { creature?: Individual; level?: number; badges?: number; steps?: number; count?: number } = {},
): NewsItem {
  // A shiny catch is a catch the feed cares about; the caller decides which.
  const shiny = kind === "caught" && about.creature && variant(about.creature.variantId).tier >= 5;
  const which = shiny ? "shiny" : kind;
  return { at, kind: which, text: fill(pick(seed, at, which, LINES[which]), about) };
}
