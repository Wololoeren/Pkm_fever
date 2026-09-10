import { TILE } from "./terrain";

/**
 * The twenty places, and what makes each one somewhere rather than a palette.
 *
 * This used to be three tables in two files: a terrain profile and a list of
 * types in world.ts, and a colour scheme in render/tiles.ts. That is fine for
 * four biomes and hopeless for twenty — adding one meant three edits in two
 * layers, and forgetting the third gave you a place that generated correctly,
 * held the right creatures, and was drawn in meadow green.
 *
 * So the engine's half lives here, in one row per biome, and the renderer's
 * half stays in the renderer where it belongs. `tests/biomes.test.ts` holds
 * the two together: every biome named here must have a palette, a gap in the
 * town wall and somewhere to hang off, and every palette must name a biome.
 *
 * ## What makes them different
 *
 * Four knobs, and each biome is built to be the *most* something on at least
 * one of them. That is the whole design brief: twenty biomes that differ only
 * in colour are one biome with twenty coats.
 *
 *   **How wide the ways are.** `corridor` 2 is a passage you meet things in;
 *   7 is a field you can see across. The floor is 2 — a route narrows by one
 *   tile every three rings, so a corridor of 2 is 2 everywhere.
 *
 *   **How much of it loops.** `loops` is extra joins beyond the spanning tree.
 *   Low is dead ends and getting lost; high is a plaza you can circle. The
 *   floor is 2 here too, for the same reason.
 *
 *   **How much of it bites.** `grass` is the share of open ground given to
 *   tall grass, per mille. Nothing below about a tenth, or the route has
 *   nowhere to hunt; 900 is a place that is almost entirely undergrowth.
 *
 *   **What the walls are made of.** Three answers, and the third is the
 *   interesting one. `TREE` is a forest, `ROCK` is broken country — and
 *   `WATER` is an archipelago, because water is an obstacle answered by Surf
 *   and never cleared. A water-walled route has a walkable skeleton carved
 *   through it and everything between the corridors is swimmable, so the same
 *   map is a maze before you have Surf and an open sea after.
 */

export interface BiomeProfile {
  /** What fills everything not carved out. */
  wall: number;
  /** The floor of a carved room. */
  ground: number;
  /** Tiles across a corridor. Narrow is claustrophobic; wide is a field. */
  corridor: number;
  /** How far a room is shrunk inside its cell. Bigger is tighter. */
  roomInset: [number, number];
  /** Extra joins beyond the spanning tree — loops rather than dead ends. */
  loops: number;
  /** Share of the open ground given over to tall grass, per mille. */
  grass: number;
  /** Pools of water dropped into rooms. */
  pools: number;
  /** Loose rock and flowers scattered over the open ground. */
  clutter: number;
}

export interface BiomeSpec {
  id: string;
  /** What the HUD calls it. */
  name: string;
  /** One line, for a reader deciding whether to walk there. */
  blurb: string;
  /**
   * How ordinary it is, 0 to 3, and therefore how many of it there are.
   *
   * Tier 0 is the countryside you would walk through without remarking on it,
   * and there are four of each; tier 3 is somewhere you would tell somebody
   * about, and there is one of each. Fifty places out of twenty kinds, and the
   * shape of that is the point — you should meet a meadow four times over and
   * a Crystal Vault once ever.
   *
   * It also decides roughly *where* each one goes: `dealBiomes` ranks nodes by
   * distance from town and slots by tier, so the ordinary places cluster near
   * home and the strange ones sit out past them. A tendency rather than a
   * rule, with jitter, so the world is not a set of concentric bands.
   */
  tier: 0 | 1 | 2 | 3;
  /**
   * The types that live here.
   *
   * This is what actually makes a biome a different place to hunt: the
   * encounter table is every species of these types whose base stat total
   * fits the ring. Between two and four each — one type is a novelty route
   * with six creatures on it, and five is "most things".
   */
  types: readonly string[];
  profile: BiomeProfile;
}

/**
 * The four that were here first, unchanged.
 *
 * Their profiles are exactly what they were, deliberately: they are the four
 * arms the gyms, the people, the Cup and every one-off breeding item are
 * placed on, and every balance number in the game was measured against them.
 * The sixteen below are wilderness hung off the same town.
 */
const SETTLED: BiomeSpec[] = [
  {
    id: "meadow",
    tier: 0,
    name: "Meadow",
    blurb: "Open and forgiving. Wide ways, plenty of loops, grass everywhere.",
    types: ["normal", "grass", "bug", "flying", "fairy"],
    profile: {
      wall: TILE.TREE, ground: TILE.MEADOW, corridor: 5, roomInset: [0, 1],
      loops: 14, grass: 650, pools: 2, clutter: 40,
    },
  },
  {
    id: "pinewood",
    tier: 0,
    name: "Pinewood",
    blurb: "The maze proper. Narrow, few loops, mostly dead ends.",
    types: ["grass", "bug", "poison", "ghost", "dark"],
    profile: {
      wall: TILE.TREE, ground: TILE.MEADOW, corridor: 3, roomInset: [1, 2],
      loops: 4, grass: 550, pools: 0, clutter: 18,
    },
  },
  {
    id: "ashflats",
    tier: 1,
    name: "Ashflats",
    blurb: "Broken rather than dense. Wide rooms, little cover, nothing to drink.",
    types: ["fire", "rock", "ground", "steel"],
    profile: {
      wall: TILE.ROCK, ground: TILE.SAND, corridor: 6, roomInset: [0, 0],
      loops: 10, grass: 250, pools: 0, clutter: 55,
    },
  },
  {
    id: "marsh",
    tier: 0,
    name: "Marsh",
    blurb: "Water does the walling. The way through is the dry ground between pools.",
    types: ["water", "poison", "ground", "bug"],
    profile: {
      wall: TILE.TREE, ground: TILE.MEADOW, corridor: 4, roomInset: [0, 2],
      loops: 8, grass: 600, pools: 7, clutter: 25,
    },
  },
];

/**
 * The sixteen wild ones.
 *
 * Each is the extreme of something, and the notes say which. Between them they
 * cover all eighteen types — the settled four leave Electric, Ice, Fighting,
 * Psychic and Dragon with nowhere to live, which is the clearest possible sign
 * that four biomes is not enough for a bestiary of eleven hundred.
 */
const WILD: BiomeSpec[] = [
  {
    id: "glacier",
    tier: 2,
    name: "Glacier",
    blurb: "The coldest. Ice walls, almost nothing growing, and three still pools.",
    types: ["ice", "water", "dragon"],
    profile: {
      wall: TILE.ROCK, ground: TILE.SAND, corridor: 4, roomInset: [0, 1],
      loops: 6, grass: 180, pools: 3, clutter: 30,
    },
  },
  {
    id: "stormcoast",
    tier: 1,
    name: "Stormcoast",
    blurb: "An archipelago. Walk the spits or bring Surf and cross the whole thing.",
    types: ["electric", "water", "flying"],
    profile: {
      // Water walls: the most interesting thing a biome can be made of. Before
      // Surf this is a handful of connected spits; after it, open sea.
      wall: TILE.WATER, ground: TILE.SAND, corridor: 5, roomInset: [0, 1],
      loops: 12, grass: 300, pools: 0, clutter: 20,
    },
  },
  {
    id: "dunes",
    tier: 1,
    name: "Dunes",
    blurb: "The widest. You can see across it, and there is nothing to see.",
    types: ["ground", "rock", "dragon"],
    profile: {
      wall: TILE.ROCK, ground: TILE.SAND, corridor: 7, roomInset: [0, 0],
      loops: 16, grass: 130, pools: 1, clutter: 45,
    },
  },
  {
    id: "boneyard",
    tier: 3,
    name: "Boneyard",
    blurb: "The most desolate. Narrow, nearly no loops, and strewn with what is left.",
    types: ["ghost", "rock", "fighting"],
    profile: {
      wall: TILE.ROCK, ground: TILE.SAND, corridor: 3, roomInset: [1, 2],
      loops: 2, grass: 160, pools: 0, clutter: 70,
    },
  },
  {
    id: "mycelia",
    tier: 2,
    name: "Mycelia",
    blurb: "The most overgrown. Nine tenths of the floor is something you push through.",
    types: ["grass", "poison", "bug"],
    profile: {
      wall: TILE.TREE, ground: TILE.MEADOW, corridor: 2, roomInset: [1, 2],
      loops: 3, grass: 900, pools: 0, clutter: 60,
    },
  },
  {
    id: "thunderplain",
    tier: 0,
    name: "Thunderplain",
    blurb: "The most open. Twenty ways round everything and nowhere to hide.",
    types: ["electric", "normal", "flying"],
    profile: {
      wall: TILE.ROCK, ground: TILE.MEADOW, corridor: 7, roomInset: [0, 0],
      loops: 20, grass: 500, pools: 0, clutter: 15,
    },
  },
  {
    id: "crystalvault",
    tier: 3,
    name: "Crystal Vault",
    blurb: "The most barren. Almost nothing lives here, and what does is strange.",
    types: ["psychic", "steel", "fairy"],
    profile: {
      wall: TILE.ROCK, ground: TILE.SAND, corridor: 4, roomInset: [0, 0],
      loops: 8, grass: 140, pools: 2, clutter: 40,
    },
  },
  {
    id: "emberfields",
    tier: 2,
    name: "Emberfields",
    blurb: "Burnt ground and standing heat. Everything here is already scarred.",
    types: ["fire", "fighting", "dark"],
    profile: {
      wall: TILE.ROCK, ground: TILE.SAND, corridor: 5, roomInset: [0, 1],
      loops: 9, grass: 350, pools: 0, clutter: 50,
    },
  },
  {
    id: "cloudreach",
    tier: 3,
    name: "Cloudreach",
    blurb: "Peaks above the weather. Thin ways, thin air, and very little of either.",
    types: ["flying", "dragon", "psychic"],
    profile: {
      wall: TILE.ROCK, ground: TILE.MEADOW, corridor: 3, roomInset: [1, 2],
      loops: 5, grass: 240, pools: 0, clutter: 35,
    },
  },
  {
    id: "sunkenreach",
    tier: 3,
    name: "Sunken Reach",
    blurb: "The other archipelago, and the drowned one. Twelve pools and rising.",
    types: ["water", "steel", "dark"],
    profile: {
      wall: TILE.WATER, ground: TILE.MEADOW, corridor: 4, roomInset: [0, 2],
      loops: 7, grass: 400, pools: 12, clutter: 25,
    },
  },
  {
    id: "bramblewood",
    tier: 0,
    name: "Bramblewood",
    blurb: "The most tangled. Two tiles wide, no loops at all, and thorns.",
    types: ["grass", "dark", "bug"],
    profile: {
      wall: TILE.TREE, ground: TILE.MEADOW, corridor: 2, roomInset: [1, 2],
      loops: 2, grass: 750, pools: 0, clutter: 40,
    },
  },
  {
    id: "saltpan",
    tier: 1,
    name: "Saltpan",
    blurb: "Cracked flat and white. The most cluttered ground in the world.",
    types: ["ground", "water", "steel"],
    profile: {
      wall: TILE.ROCK, ground: TILE.SAND, corridor: 6, roomInset: [0, 0],
      loops: 14, grass: 150, pools: 4, clutter: 85,
    },
  },
  {
    id: "fellgarden",
    tier: 2,
    name: "Fellgarden",
    blurb: "Cultivated by somebody, a long time ago, and still growing to plan.",
    types: ["fairy", "psychic", "grass"],
    profile: {
      wall: TILE.TREE, ground: TILE.MEADOW, corridor: 4, roomInset: [0, 1],
      loops: 11, grass: 600, pools: 2, clutter: 80,
    },
  },
  {
    id: "slagheap",
    tier: 3,
    name: "Slagheap",
    blurb: "Somebody built this and left. Paved floors, rust, and standing water.",
    types: ["steel", "fire", "poison"],
    profile: {
      // The only biome floored with trodden path rather than anything growing:
      // it reads as a place that was made rather than one that grew.
      wall: TILE.ROCK, ground: TILE.PATH, corridor: 5, roomInset: [0, 1],
      loops: 8, grass: 260, pools: 1, clutter: 55,
    },
  },
  {
    id: "frostmire",
    tier: 1,
    name: "Frostmire",
    blurb: "A bog that froze and thawed and froze. Nine pools of it, none inviting.",
    types: ["ice", "poison", "water"],
    profile: {
      wall: TILE.TREE, ground: TILE.MEADOW, corridor: 3, roomInset: [0, 2],
      loops: 6, grass: 520, pools: 9, clutter: 30,
    },
  },
  {
    id: "duskhollow",
    tier: 2,
    name: "Duskhollow",
    blurb: "The darkest. Narrow, unlit, and the things in it were waiting.",
    types: ["dark", "ghost", "fighting"],
    profile: {
      wall: TILE.TREE, ground: TILE.MEADOW, corridor: 2, roomInset: [1, 2],
      loops: 4, grass: 450, pools: 0, clutter: 25,
    },
  },
];

export const BIOMES: readonly BiomeSpec[] = [...SETTLED, ...WILD];

const BY_ID = new Map(BIOMES.map((entry) => [entry.id, entry]));

export function biome(id: string): BiomeSpec {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`unknown biome: ${id}`);
  return found;
}

export function isBiome(id: string): boolean {
  return BY_ID.has(id);
}

/** Every biome id, in the order the arms hang off town. */
export const BIOME_IDS: readonly string[] = BIOMES.map((entry) => entry.id);

/**
 * Which of a biome's rules the generator asks for, with a fallback.
 *
 * The fallback is the meadow, and it exists for the town and for interiors:
 * both carry a `biome` string ("hearth", "indoors") that is not a biome at
 * all, and neither is ever passed through the route generator.
 */
export function profileFor(id: string): BiomeProfile {
  return BY_ID.get(id)?.profile ?? BIOMES[0].profile;
}

/** The types that live in a biome, or none for somewhere nothing lives. */
export function typesFor(id: string): readonly string[] {
  return BY_ID.get(id)?.types ?? [];
}

/**
 * The biomes by tier, tier 0 first.
 *
 * Read rather than written down, so the counts in `dealBiomes` and the tiers
 * on the rows above cannot come apart.
 */
export function tiersOf(): string[][] {
  const out: string[][] = [[], [], [], []];
  for (const spec of BIOMES) out[spec.tier].push(spec.id);
  return out;
}

/**
 * How many copies of a biome of this tier the world holds.
 *
 * Four of each of the five most ordinary, three of the next five, two, then
 * one. Twenty kinds, fifty places.
 */
export function copiesOf(tier: number): number {
  return Math.max(1, 4 - tier);
}

/** How many places a world holds: 5x4 + 5x3 + 5x2 + 5x1. */
export function placesWanted(): number {
  return tiersOf().reduce((total, ids, tier) => total + ids.length * copiesOf(tier), 0);
}

/**
 * The name to show a player, or a capitalised id for somewhere that is not a
 * biome — the town and the interiors both carry a `biome` string that is not
 * in this table.
 */
export function nameOf(id: string): string {
  return BY_ID.get(id)?.name ?? `${id[0].toUpperCase()}${id.slice(1)}`;
}
