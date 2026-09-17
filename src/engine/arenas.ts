import { ALL_SPECIES } from "./dex";
import type { StatTable } from "./types";
import { STAT_IDS } from "./types";

/**
 * Six people running eight-player brackets out of a field.
 *
 * One for each format the game has — 1v1 up to 6v6 — so the thing you want to
 * practise is a place you can walk to rather than three other people you have
 * to find. `PvP → Tournament` is the same bracket with humans in it; this is
 * the same bracket with the machine in it, and the same prize at the end.
 *
 * ## Why eight, always
 *
 * Because the size of the field is what the *prize* is priced on, and a
 * knockout you can enter alone should not also be the one that pays best.
 * Eight is three rounds and the middle rung: worth more than a four, less than
 * a sixteen, and the sixteen stays something you need fifteen other people
 * for.
 *
 * ## Why they scale like a gym
 *
 * A tournament with a number written down when the world was made is a wall at
 * hour two and a formality at hour twenty — which is the argument `gyms.ts`
 * makes at length, and it is the same argument. So the field reads the same
 * two things a gym does: moves taken and badges won. Somebody who has cleared
 * six gyms walks into a bracket that has been paying attention.
 *
 * The teams themselves are *not* typed the way a gym's are. A gym is one type
 * and a lesson about it; a bracket is eight strangers, and eight mono-type
 * teams would be eight gyms in a row. They are drawn from the whole roster at
 * a strength band, which is what makes the format the interesting variable
 * rather than the matchup.
 */

export interface ArenaSpec {
  id: string;
  /** Who runs it. */
  name: string;
  /** What it is called on the sign. */
  title: string;
  /** Creatures a side. One of these per format the game has. */
  teamSize: number;
  /** Which map, and which copy of that biome counted outward from town. */
  biome: string;
  nth: number;
  /** Where it starts from before moves and badges move it. */
  baseLevel: number;
  lines: string[];
}

/**
 * The six.
 *
 * Spread across biomes and distances so that the small formats are near town
 * and the big ones are not: a 6v6 needs six creatures worth bringing, and
 * putting it four rings out is the cheapest way to say so without a rule that
 * refuses you at the door.
 */
export const ARENAS: readonly ArenaSpec[] = [
  {
    id: "arena-1",
    name: "Odds",
    title: "The Singles Ladder",
    teamSize: 1,
    biome: "meadow",
    nth: 2,
    baseLevel: 14,
    lines: [
      "One each. Eight of us. Seven of them are the machine, which is the honest way to run a bracket with three people in the field.",
      "Three wins takes it. Lose one and you are out — that is what a knockout is, and I will not be talked into a repechage.",
    ],
  },
  {
    id: "arena-2",
    name: "Pell",
    title: "The Pairs",
    teamSize: 2,
    biome: "bramblewood",
    nth: 2,
    baseLevel: 20,
    lines: [
      "Two apiece. Everybody thinks the second one is a spare. Everybody is wrong about that exactly once.",
      "Eight in the draw, three rounds, and the machine does not get tired between them.",
    ],
  },
  {
    id: "arena-3",
    name: "Trice",
    title: "The Threes",
    teamSize: 3,
    biome: "ashflats",
    nth: 2,
    baseLevel: 28,
    lines: [
      "Three is where a bracket starts being about what you brought rather than what you brought *first*.",
      "Win three and there is something at the end of it. Lose one and there is the walk home.",
    ],
  },
  {
    id: "arena-4",
    name: "Quarry",
    title: "The Fours",
    teamSize: 4,
    biome: "duskhollow",
    nth: 2,
    baseLevel: 36,
    lines: [
      "Four. Long enough that a bad matchup is survivable and short enough that a bad team is not.",
      "The machine has been beaten here. Not often, and not by anybody who turned up with four of the same idea.",
    ],
  },
  {
    id: "arena-5",
    name: "Quint",
    title: "The Fives",
    teamSize: 5,
    biome: "pinewood",
    nth: 3,
    baseLevel: 44,
    lines: [
      "Five out of six, which means you left one behind. I have always found that the interesting part.",
      "Three rounds. Everybody watches, and there is nobody here but us, so that is mostly me.",
    ],
  },
  {
    id: "arena-6",
    name: "Sixer",
    title: "The Full Six",
    teamSize: 6,
    biome: "fellgarden",
    // Two, not three: a biome's tier decides how many copies a world holds
    // and fellgarden holds two, so `nth: 3` was an address that resolves in no
    // world at all. `W28` is the guard that says so now.
    nth: 2,
    baseLevel: 52,
    lines: [
      "Everything you own against everything they own, three times over. Bring the box if you have to.",
      "Nobody walks into this one by accident. If you did, walk back out — it will still be here.",
    ],
  },
];

const BY_ID = new Map(ARENAS.map((one) => [one.id, one]));

export function arena(id: string): ArenaSpec {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`unknown arena: ${id}`);
  return found;
}

export function isArena(id: string): boolean {
  return BY_ID.has(id);
}

/** How many are in the draw. Always eight — see the note at the top. */
export const ARENA_SIZE = 8;

/** How many rounds that is. */
export const ARENA_ROUNDS = 3;

/** The same two dials a gym reads, and the same caps. */
export const ARENA_MOVE_CAP = 30;
// The gyms' pace, so a bracket and a gym at the same point in a run are the
// same sort of fight. Were a thousand and five, which made the brackets the
// hardest thing in the game long before they were meant to be.
export const ARENA_MOVES_PER_LEVEL = 2500;
export const ARENA_PER_BADGE = 3;
/** Every opponent's IV in every stat. Good, not perfect: that is the Cup. */
export const ARENA_IV = 18;

/**
 * What this bracket is fielding right now.
 *
 * Read off the save every time rather than stored, for the same reason a gym's
 * is: a number written when the world was made would be a second copy of how
 * far you have come, free to disagree with the first.
 */
export function arenaLevel(spec: ArenaSpec, moves: number, badges: number): number {
  const drift = Math.min(ARENA_MOVE_CAP, Math.floor(moves / ARENA_MOVES_PER_LEVEL));
  return Math.min(100, spec.baseLevel + drift + badges * ARENA_PER_BADGE);
}

/** How it was arrived at, for the panel to show before you commit. */
export function arenaBreakdown(
  spec: ArenaSpec,
  moves: number,
  badges: number,
): { base: number; fromMoves: number; fromBadges: number; total: number } {
  const fromMoves = Math.min(ARENA_MOVE_CAP, Math.floor(moves / ARENA_MOVES_PER_LEVEL));
  return {
    base: spec.baseLevel,
    fromMoves,
    fromBadges: badges * ARENA_PER_BADGE,
    total: arenaLevel(spec, moves, badges),
  };
}

/**
 * The roster an opponent is drawn from, ranked.
 *
 * Sorted by what the species is worth in a fight, so a band can be taken out
 * of the middle of it — a bracket at level fifteen should not be fielding the
 * same creature as one at level eighty, and "how strong is this species" is a
 * question the manifest can answer without anybody writing a tier list.
 *
 * Computed once at module load. It is a sort of eleven hundred rows and it
 * does not change.
 */
const RANKED: readonly string[] = (() => {
  const power = (base: StatTable) => STAT_IDS.reduce((sum, stat) => sum + base[stat], 0);
  return [...ALL_SPECIES]
    .sort((a, b) => power(a.base) - power(b.base) || a.id.localeCompare(b.id))
    .map((entry) => entry.id);
})();

/**
 * The slice of the roster a bracket at this level draws from.
 *
 * A window rather than a floor, so the far end of the game is not eight teams
 * of the same six giants: the window slides up as the level does and the
 * bottom of it slides with it. Returned as a pair of indices into `RANKED`.
 */
export function arenaBand(level: number): [number, number] {
  // Level 1 sits at the bottom of the list and level 100 at the top, with the
  // window about a fifth of the roster wide.
  const width = Math.floor(RANKED.length / 5);
  const centre = Math.floor((RANKED.length - width) * (Math.min(100, Math.max(1, level)) / 100));
  return [centre, Math.min(RANKED.length - 1, centre + width)];
}

/** The ranked roster, for the team builder and for the test that keeps this
 * honest — a band of one is not a draw. */
export const ARENA_POOL = RANKED;
