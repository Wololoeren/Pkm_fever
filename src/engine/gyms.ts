/**
 * Gyms.
 *
 * Eight of them, one type each, and none of them wait for you. A gym's level
 * is not a number somebody chose when the world was made — it is read off how
 * far you have come, which is what stops the eighth being a wall at hour two
 * and a formality at hour twenty.
 *
 * Two things move it. **Moves**: one level per thousand steps taken, capped at
 * thirty, so a gym drifts up while you are away and stops drifting long before
 * it becomes silly. **Badges**: five levels each, so the order you take them in
 * is a real decision — the eighth gym you challenge is forty levels above the
 * first, whichever one it happens to be.
 */

export interface GymSpec {
  id: string;
  name: string;
  leader: string;
  /** The only type its team is built from. */
  type: string;
  /** Which map it stands on. */
  biome: string;
  ring: number;
  /** Where it starts from before anything scales it. */
  baseLevel: number;
  /** How many it brings. */
  team: number;
  /** The tool that comes with the badge. Beating a gym is how the world opens
   * up, which is more interesting than a reward you could have bought. */
  tool: string;
  lines: string[];
}

export const GYMS: readonly GymSpec[] = [
  {
    id: "gym-bug",
    tool: "hm-cut",
    name: "Thicket Gym",
    leader: "Wren",
    type: "bug",
    biome: "meadow",
    ring: 1,
    baseLevel: 12,
    team: 3,
    lines: [
      "Small things first. Everybody starts here and everybody underestimates it.",
      "Bug types. Three of them. Off you go.",
    ],
  },
  {
    id: "gym-water",
    tool: "hm-surf",
    name: "Millpond Gym",
    leader: "Doria",
    type: "water",
    biome: "marsh",
    ring: 1,
    baseLevel: 16,
    team: 3,
    lines: [
      "You will have got wet on the way in. That was deliberate.",
      "Water types. Nothing clever, just a great deal of it.",
    ],
  },
  {
    id: "gym-rock",
    tool: "hm-rocksmash",
    name: "Quarry Gym",
    leader: "Ferrous",
    type: "rock",
    biome: "ashflats",
    ring: 2,
    baseLevel: 20,
    team: 4,
    lines: ["Rock does not move. That is the entire lesson and it takes most people twice."],
  },
  {
    id: "gym-grass",
    tool: "hm-flash",
    name: "Greenhouse Gym",
    leader: "Sorrel",
    type: "grass",
    biome: "meadow",
    ring: 3,
    baseLevel: 26,
    team: 4,
    lines: ["Everything in here grew slowly and on purpose. Recognise the approach?"],
  },
  {
    id: "gym-fire",
    tool: "hm-strength",
    name: "Kiln Gym",
    leader: "Ash",
    type: "fire",
    biome: "ashflats",
    ring: 4,
    baseLevel: 32,
    team: 5,
    lines: ["Four badges in. You will have noticed I am not where I was when you started."],
  },
  {
    id: "gym-electric",
    tool: "hm-rockclimb",
    name: "Pylon Gym",
    leader: "Static",
    type: "electric",
    biome: "pinewood",
    ring: 4,
    baseLevel: 38,
    team: 5,
    lines: ["Speed is the only stat that decides who gets to use the others."],
  },
  {
    id: "gym-ghost",
    tool: "hm-fly",
    name: "Hollow Gym",
    leader: "Vesper",
    type: "ghost",
    biome: "pinewood",
    ring: 6,
    baseLevel: 44,
    team: 6,
    lines: ["Seven people have got this far. Two came back for the eighth."],
  },
  {
    id: "gym-dragon",
    tool: "hm-waterfall",
    name: "Headwater Gym",
    leader: "Cirra",
    type: "dragon",
    biome: "marsh",
    ring: 6,
    baseLevel: 50,
    team: 6,
    lines: [
      "The last one. You have seven badges and every one of them made me harder.",
      "That was the arrangement. Nobody made you take them in that order.",
    ],
  },
];

const BY_ID = new Map(GYMS.map((gym) => [gym.id, gym]));

export function gym(id: string): GymSpec {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`unknown gym: ${id}`);
  return found;
}

export function isGym(id: string): boolean {
  return BY_ID.has(id);
}

/** One level per thousand moves, and never more than this many. */
export const MOVE_LEVELS_CAP = 30;
export const MOVES_PER_LEVEL = 1000;
/** What each badge already won adds to every gym still standing. */
export const LEVELS_PER_BADGE = 5;

/**
 * What this gym is fielding right now.
 *
 * Read off the save every time rather than stored, for the same reason quest
 * progress is: a number written down when the world was made would be a second
 * copy of the truth, free to drift from the one that matters.
 */
export function gymLevel(spec: GymSpec, moves: number, badges: number): number {
  const drift = Math.min(MOVE_LEVELS_CAP, Math.floor(moves / MOVES_PER_LEVEL));
  return Math.min(100, spec.baseLevel + drift + badges * LEVELS_PER_BADGE);
}

/** How the level was arrived at, for the panel to show before you commit. */
export function gymBreakdown(
  spec: GymSpec,
  moves: number,
  badges: number,
): { base: number; fromMoves: number; fromBadges: number; total: number } {
  const fromMoves = Math.min(MOVE_LEVELS_CAP, Math.floor(moves / MOVES_PER_LEVEL));
  return {
    base: spec.baseLevel,
    fromMoves,
    fromBadges: badges * LEVELS_PER_BADGE,
    total: gymLevel(spec, moves, badges),
  };
}
