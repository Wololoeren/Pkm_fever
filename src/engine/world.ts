import { STARTER_TYPES, startersOfType } from "./dex";
import { rollGender } from "./gender";
import { NATURE_IDS } from "./natures";
import { building, clump, Grid, meander, speckle, TILE } from "./terrain";
import { intBelow, intBetween, rngFor, shuffle, weighted, type Rng } from "./rng";
import { clampIvs, WILD_IV_MAX } from "./stats";
import { STAT_IDS, type Individual, type SpeciesEntry, type StatTable, type WorldConfig } from "./types";
import { appearanceId, CENSUS_PLAN, CHROMA_IDS, TOP_TIER } from "./variants";

/**
 * The world is a pure function of (config, seed). Nothing here is stored in a
 * save file; a save carries the seed and the player's inputs, and the world
 * is rebuilt identically on every load and on every other player's machine.
 *
 * The shape is a hub with biome corridors running outward, and difficulty is
 * one-dimensional: everything is a function of ring index. That is not a
 * simplification, it is the point — a designer tunes one curve instead of
 * three hundred routes.
 */

/**
 * Kept as aliases so the rest of the engine did not have to be rewritten
 * alongside the terrain. TILE_BLOCK is gone: "blocked" is a property of a tile
 * now rather than a kind of tile, because a tree, a rock, a pond and a wall
 * all stop you and none of them look alike.
 */
export const TILE_PATH = TILE.PATH;
export const TILE_GRASS = TILE.GRASS;

/**
 * Routes are about four times the area they were, which is what the camera in
 * GameCanvas exists to make possible: a window onto a place, rather than the
 * whole of a small box at once.
 */
export const ROUTE_WIDTH = 44;
export const ROUTE_HEIGHT = 34;

/** Towns are wider than they are tall, the way a street is. */
export const TOWN_WIDTH = 40;
export const TOWN_HEIGHT = 28;

/** Interiors are one room. */
export const ROOM_WIDTH = 13;
export const ROOM_HEIGHT = 10;

/** How far into a route's encounter sequence world generation will place a
 * variant. Placing one at slot 900 would be the same as not placing it, so
 * the census lives inside the range a thorough player actually reaches. */
const CENSUS_SLOT_RANGE = 120;

/** One step in tall grass triggers an encounter this often, per mille. */
const ENCOUNTER_RATE = 118;

/** What a map is for, which decides what you can do standing in it. */
export type RouteKind = "town" | "route" | "interior";

/** What a building is for. A house is somewhere to look at. */
export type InteriorRole = "daycare" | "centre" | "mart" | "house";

/** What the board outside each kind of building says. */
const SIGN_TEXT: Record<InteriorRole, string> = {
  daycare: "Daycare",
  centre: "Trainers Centre",
  mart: "Mart",
  house: "House",
};

/** A board beside a door, saying what the building behind it is for. */
export interface Sign {
  x: number;
  y: number;
  text: string;
}

/** A tile that takes you somewhere else when you step on it. */
export interface Door {
  x: number;
  y: number;
  to: string;
  /** Where you arrive on the other side. */
  at: { x: number; y: number };
}

export interface Route {
  id: string;
  kind: RouteKind;
  biome: string;
  ring: number;
  width: number;
  height: number;
  /** Row-major, one of the TILE values. */
  tiles: number[];
  /** Where the player arrives when entering from the ring below. */
  entry: { x: number; y: number };
  /** Doors on this map, keyed by the tile you step on. */
  doors: Door[];
  /** Boards standing beside a door, and what each one says. */
  signs: Sign[];
  /** For an interior: what it is for, and which map it belongs to. */
  role?: InteriorRole;
  parent?: string;
  /** Shown in the HUD. */
  label: string;
}

/**
 * Somebody standing on a route who will fight you.
 *
 * Stored as species and levels rather than as creatures: an Individual needs a
 * uid, and uids belong to game state rather than to the world. The engine
 * materialises the team when the battle actually starts.
 */
export interface TrainerSpec {
  id: string;
  routeId: string;
  x: number;
  y: number;
  name: string;
  team: { speciesId: string; level: number }[];
}

export interface World {
  config: WorldConfig;
  seed: string;
  /** The starters this world offers, drawn from every starter in the dex. */
  starters: string[];
  routes: Map<string, Route>;
  /** Who is standing where, by route. Derived from the seed like everything
   * else, so two players on one seed meet the same people. */
  trainers: Map<string, TrainerSpec[]>;
  /**
   * Which encounter slots hold something unusual: "routeId:slot" -> variantId.
   *
   * This is the whole "census, not lottery" idea. A variant is a property of a
   * *place*, decided when the world is made, not a die rolled when the player
   * steps into grass. Nothing can be reset for, every world contains exactly
   * the same census, and hunting becomes exploration.
   */
  census: Map<string, string>;
}

export function routeId(biome: string, ring: number): string {
  return `${biome}-${ring}`;
}

/** Which species may appear at this ring. A band over base stat total, rising
 * and widening as the player walks outward. */
function ringBand(ring: number, rings: number): { min: number; max: number } {
  const span = (620 - 190) / rings;
  return { min: Math.round(190 + span * (ring - 1) * 0.75), max: Math.round(190 + span * ring) };
}

const BIOME_TYPES: Record<string, string[]> = {
  meadow: ["normal", "grass", "bug", "flying", "fairy"],
  pinewood: ["grass", "bug", "poison", "ghost", "dark"],
  ashflats: ["fire", "rock", "ground", "steel"],
  marsh: ["water", "poison", "ground", "bug"],
};

function bst(base: StatTable): number {
  return STAT_IDS.reduce((total, stat) => total + base[stat], 0);
}

/**
 * Everything that can be met on one route, with weights.
 *
 * Derived rather than authored: a species belongs here if its power fits the
 * ring and one of its types fits the biome. Adding a species to the manifest
 * therefore populates the world without anybody editing a table, which is what
 * makes "ship the full dex, populate outward" practical.
 */
/**
 * What a rod pulls up, at a given reach.
 *
 * The water table is the same idea as the grass one turned sideways: type
 * affinity is water rather than the biome's, and reach stands in for ring, so
 * a Super Rod on ring one still finds better things than an Old Rod does. That
 * is the point of buying one — depth is a second axis of progress that does
 * not require walking further out.
 */
export function fishingTable(
  allSpecies: readonly SpeciesEntry[],
  ring: number,
  reach: number,
  rings: number,
): { speciesId: string; weight: number }[] {
  // A rod's reach is worth two rings, so the Super Rod in the shallows is
  // about as good as walking to the far edge of the map.
  const effective = Math.min(rings, ring + (reach - 1) * 2);
  const band = ringBand(effective, rings);

  const table = allSpecies
    .filter((species) => {
      const power = bst(species.base);
      if (power < band.min || power > band.max) return false;
      return species.types.includes("water");
    })
    .map((species) => ({
      speciesId: species.id,
      weight: Math.max(1, band.max - bst(species.base) + 10),
    }));

  if (table.length) return table.sort((a, b) => a.speciesId.localeCompare(b.speciesId));

  // Nothing in band: rather than an empty pond, take every water creature.
  return allSpecies
    .filter((species) => species.types.includes("water"))
    .map((species) => ({ speciesId: species.id, weight: 1 }))
    .sort((a, b) => a.speciesId.localeCompare(b.speciesId));
}

/**
 * The creature on the end of the line.
 *
 * Named off the tile you fished from and how many times you have fished it, so
 * a pond is as unrerollable as a patch of grass: casting again from the same
 * spot gives the next one along, never a second roll at the last.
 */
export function fishAt(
  world: World,
  allSpecies: readonly SpeciesEntry[],
  route: string,
  reach: number,
  index: number,
  uid: number,
): Individual {
  const target = world.routes.get(route);
  if (!target) throw new Error(`unknown route: ${route}`);

  const rng = rngFor(world.seed, "fish", route, reach, index);
  const table = fishingTable(allSpecies, target.ring, reach, world.config.rings);
  const speciesId = weighted(rng, table, (row) => row.weight).speciesId;

  const level = Math.max(2, levelForRing(target.ring) + (reach - 1) * 4 + intBetween(rng, -2, 2));

  return {
    uid,
    speciesId,
    level,
    exp: level * level * level,
    ivs: rollWildIvs(rng),
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    natureId: pickNature(rng),
    // Ordinary, always. The census is placed in grass slots, and a pond that
    // could also hold the world's one shiny would make the count a lie. What
    // fishing pays instead is access: water species the grass never offers,
    // at a level a rod rather than a walk decides.
    variantId: "normal",
    hp: 0,
    status: null,
    sleepTurns: 0,
    moves: [],
    nickname: null,
    traded: false,
    parents: null,
    gender: rollGender(rng),
  };
}

export function encounterTable(
  allSpecies: readonly SpeciesEntry[],
  biome: string,
  ring: number,
  rings: number,
): { speciesId: string; weight: number }[] {
  const band = ringBand(ring, rings);
  const affinity = BIOME_TYPES[biome] ?? [];

  const table = allSpecies
    .filter((species) => {
      const power = bst(species.base);
      if (power < band.min || power > band.max) return false;
      return species.types.some((type) => affinity.includes(type));
    })
    .map((species) => ({
      speciesId: species.id,
      // Weaker things are commoner. Integer weights keep the pick exact.
      weight: Math.max(1, band.max - bst(species.base) + 10),
    }));

  // A band that caught nothing would soft-lock a route, so widen to the whole
  // biome rather than leaving the grass empty.
  if (!table.length) {
    return allSpecies
      .filter((species) => species.types.some((type) => affinity.includes(type)))
      .map((species) => ({ speciesId: species.id, weight: 1 }));
  }

  return table.sort((a, b) => (a.speciesId < b.speciesId ? -1 : 1));
}

/**
 * One route: a way through, and a lot of somewhere either side of it.
 *
 * Built in layers, and the order is the design. Ground first, then the way
 * through, then the things that grow, then the things somebody built — so a
 * cabin is never inside a wood and the path is never under a pond.
 */
function buildRoute(seed: string, biome: string, ring: number): { route: Route; interiors: Route[] } {
  const rng = rngFor(seed, "route", biome, ring);
  const grid = new Grid(ROUTE_WIDTH, ROUTE_HEIGHT, TILE.MEADOW);
  const doors: Door[] = [];
  const signs: Sign[] = [];
  const interiors: Route[] = [];
  const id = routeId(biome, ring);

  const entryY = Math.floor(ROUTE_HEIGHT / 2) + intBetween(rng, -4, 4);
  const exitY = Math.floor(ROUTE_HEIGHT / 2) + intBetween(rng, -4, 4);

  // Trees round the edge. The two ways through are cut back in at the end,
  // after everything that could have covered them has run.
  grid.rect(0, 0, ROUTE_WIDTH, 1, TILE.TREE);
  grid.rect(0, ROUTE_HEIGHT - 1, ROUTE_WIDTH, 1, TILE.TREE);
  grid.rect(0, 0, 1, ROUTE_HEIGHT, TILE.TREE);
  grid.rect(ROUTE_WIDTH - 1, 0, 1, ROUTE_HEIGHT, TILE.TREE);

  const spine = meander(grid, rng, entryY, exitY, 3);

  // Woodland, thicker the further out you go, so the outer rings close in.
  for (let i = 0; i < 4 + ring; i++) {
    clump(grid, rng, intBetween(rng, 2, ROUTE_WIDTH - 3), intBetween(rng, 2, ROUTE_HEIGHT - 3),
      40 + ring * 12, TILE.TREE, [TILE.MEADOW, TILE.GRASS]);
  }

  // Tall grass, the only thing out here that bites.
  for (let i = 0; i < 7; i++) {
    clump(grid, rng, intBetween(rng, 2, ROUTE_WIDTH - 3), intBetween(rng, 2, ROUTE_HEIGHT - 3),
      70, TILE.GRASS, [TILE.MEADOW]);
  }

  // A pond with a rim of sand, so it does not look stamped on.
  if (rng() < 0.55) {
    const px = intBetween(rng, 6, ROUTE_WIDTH - 7);
    const py = intBetween(rng, 5, ROUTE_HEIGHT - 6);
    clump(grid, rng, px, py, 30, TILE.SAND, [TILE.MEADOW, TILE.GRASS]);
    clump(grid, rng, px, py, 18, TILE.WATER, [TILE.SAND]);
  }

  speckle(grid, rng, TILE.ROCK, 10 + ring * 2, [TILE.MEADOW]);
  speckle(grid, rng, TILE.FLOWER, 24, [TILE.MEADOW]);

  // A cabin beside the path, sometimes. Against the way through rather than
  // dropped in a field, so it reads as somewhere a person would live.
  if (rng() < 0.5) {
    const x = intBetween(rng, 5, ROUTE_WIDTH - 11);
    const y = Math.max(2, spine[x] - 6);
    const door = building(grid, x, y, 5, 4, [TILE.MEADOW, TILE.GRASS, TILE.FLOWER]);
    if (door) {
      const cabin = `${id}:cabin`;
      const back = { x: door.x, y: door.y + 1 };
      // `back` is where the room's own door returns you to out here; where
      // the room puts you when you walk in is the room's business, and asking
      // it is what stops a town coordinate being used as a room coordinate.
      const inside = buildInterior(cabin, id, "house", "A cabin", back);
      doors.push({ x: door.x, y: door.y, to: cabin, at: inside.entry });
      if (door.sign) signs.push({ ...door.sign, text: "Cabin" });
      interiors.push(inside);
    }
  }

  grid.set(0, spine[0], TILE.PATH);
  grid.set(ROUTE_WIDTH - 1, spine[ROUTE_WIDTH - 1], TILE.PATH);

  return {
    route: {
      id,
      kind: "route",
      biome,
      ring,
      width: ROUTE_WIDTH,
      height: ROUTE_HEIGHT,
      tiles: grid.tiles,
      entry: { x: 1, y: spine[1] },
      doors,
      signs,
      label: `${biome[0].toUpperCase()}${biome.slice(1)} · ring ${ring}`,
    },
    interiors,
  };
}

/** The room behind a door. Small, plain, and one way out. */
function buildInterior(
  id: string,
  parent: string,
  role: InteriorRole,
  label: string,
  back: { x: number; y: number },
): Route {
  const grid = new Grid(ROOM_WIDTH, ROOM_HEIGHT, TILE.FLOOR);
  grid.rect(0, 0, ROOM_WIDTH, 1, TILE.WALL);
  grid.rect(0, ROOM_HEIGHT - 1, ROOM_WIDTH, 1, TILE.WALL);
  grid.rect(0, 0, 1, ROOM_HEIGHT, TILE.WALL);
  grid.rect(ROOM_WIDTH - 1, 0, 1, ROOM_HEIGHT, TILE.WALL);

  const exitX = Math.floor(ROOM_WIDTH / 2);
  grid.set(exitX, ROOM_HEIGHT - 1, TILE.EXIT);

  return {
    id,
    kind: "interior",
    biome: "indoors",
    ring: 0,
    width: ROOM_WIDTH,
    height: ROOM_HEIGHT,
    tiles: grid.tiles,
    entry: { x: exitX, y: ROOM_HEIGHT - 2 },
    doors: [{ x: exitX, y: ROOM_HEIGHT - 1, to: parent, at: back }],
    // Nothing to sign-post indoors: you are already in the building.
    signs: [],
    role,
    parent,
    label,
  };
}

/** Every species that begins an evolution line of three, which is what a
 * starter is. Drawn from the manifest rather than a hardcoded list, so a
 * different roster still offers a sensible three. */
export function starterPool(allSpecies: readonly SpeciesEntry[]): SpeciesEntry[] {
  const byId = new Map(allSpecies.map((s) => [s.id, s]));
  return allSpecies.filter((species) => {
    if (species.evolvesTo.length !== 1) return false;
    // At least one final form, not exactly one: Quilava evolves into both
    // Typhlosion and Typhlosion-Hisui, and demanding a single one quietly
    // disqualified three real starters.
    const middle = byId.get(species.evolvesTo[0].id);
    if (!middle || middle.evolvesTo.length < 1) return false;
    const power = bst(species.base);
    return power >= 280 && power <= 330;
  });
}

/** How many partners a world deals — one of each starter type. */
export const STARTER_COUNT = STARTER_TYPES.length;

/**
 * The starters this world offers: one grass, one fire, one water.
 *
 * Drawn from the real starter trios rather than from a heuristic. The first
 * cut asked the manifest for three-stage lines with a base stat total between
 * 280 and 330 and dealt Beldum, Klink and Solosis — all three of which are
 * three-stage lines with a base stat total between 280 and 330, and none of
 * which is a starter. There is no signature to derive; it is a list, and it
 * lives in scripts/build-dex.mjs.
 *
 * Each type is drawn independently, so a world can offer Charmander beside
 * Rowlet beside Quaxly — 729 combinations rather than the nine a fixed trio
 * per world would give. Returned in type order, so the offer reads the same
 * way every time.
 *
 * The fallback matters: point the build script at a different bestiary with no
 * starter list and this returns to the old heuristic, because a roster that
 * cannot be swapped is not a swappable roster.
 */
/**
 * What the starter you are offered looks like.
 *
 * Twenty times the wild rate, on both axes, rolled independently. The wild
 * census works out at about 1.4% for a rung of the tint ladder, 0.17% for a
 * colour and 0.035% for a true shiny per encounter inside the census window;
 * this is that, times twenty, in per-mille integers. The tint ladder is *not*
 * multiplied — the ladder is common enough already, and the thing worth
 * rerolling a seed for is a colour or a shine, not a Faded Squirtle.
 *
 * Independence is the point. A shiny colour starter is 7 in 10,000 times
 * 35 in 1,000, which is about one seed in four thousand — a real jackpot
 * rather than a thing the opening screen hands out.
 */
const STARTER_SHINY = 7;
const STARTER_TINT = [6, 4, 3, 1];
const STARTER_CHROMA = 35;

export function starterAppearance(seed: string, index: number): string {
  const rng = rngFor(seed, "starterLook", index);

  const shine = rng() * 1000;
  let tier = 0;
  if (shine < STARTER_SHINY) {
    tier = TOP_TIER;
  } else {
    let floor = STARTER_SHINY;
    for (let rung = 0; rung < STARTER_TINT.length; rung++) {
      floor += STARTER_TINT[rung];
      if (shine < floor) {
        tier = rung + 1;
        break;
      }
    }
  }

  const colour =
    rng() * 1000 < STARTER_CHROMA ? CHROMA_IDS[intBelow(rng, CHROMA_IDS.length)] : null;

  return appearanceId(tier, colour);
}

export function pickStarters(seed: string, allSpecies: readonly SpeciesEntry[]): string[] {
  const chosen = STARTER_TYPES.map((type) => {
    const options = startersOfType(type);
    if (!options.length) return null;
    return options[intBelow(rngFor(seed, "starter", type), options.length)];
  }).filter((id): id is string => id !== null);

  if (chosen.length === STARTER_TYPES.length) return chosen;

  // No curated list for this roster. Spread the heuristic pool over distinct
  // primary types instead, so the first choice the game asks is still a choice.
  const shuffled = shuffle(rngFor(seed, "starters"), starterPool(allSpecies));
  const fallback: SpeciesEntry[] = [];
  const taken = new Set<string>();
  for (const species of shuffled) {
    if (fallback.length >= STARTER_COUNT) break;
    if (taken.has(species.types[0])) continue;
    taken.add(species.types[0]);
    fallback.push(species);
  }
  for (const species of shuffled) {
    if (fallback.length >= STARTER_COUNT) break;
    if (!fallback.includes(species)) fallback.push(species);
  }

  return fallback.map((species) => species.id).sort();
}

/**
 * Hearth: the one town, and the shape every later town should take.
 *
 * Hand-laid rather than generated, because it is the first thing anybody sees
 * and because its buildings have jobs. The daycare and the centre are places
 * you walk into now, rather than a panel that followed you everywhere — which
 * is most of what makes a town somewhere rather than a menu.
 */
/**
 * The four ways out of town, in the order the biomes are listed.
 *
 * Exported because two places need to agree about them: the generator that
 * cuts the gaps, and the movement code that decides where you reappear when
 * you walk back in. They did not agree — every return from ring one arrived
 * at the western gap, whichever arm you had come from, so leaving east and
 * coming back put you on the far side of town.
 */
export function townExits(width: number, height: number): { x: number; y: number }[] {
  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);
  return [
    { x: 0, y: midY },
    { x: midX, y: 0 },
    { x: width - 1, y: midY },
    { x: midX, y: height - 1 },
  ];
}

/** The tile just inside one of those gaps — where you stand on arrival. */
export function townArrival(width: number, height: number, side: number): { x: number; y: number } {
  const exit = townExits(width, height)[side];
  return {
    x: exit.x === 0 ? 1 : exit.x === width - 1 ? width - 2 : exit.x,
    y: exit.y === 0 ? 1 : exit.y === height - 1 ? height - 2 : exit.y,
  };
}

function buildTown(): { town: Route; interiors: Route[] } {
  const grid = new Grid(TOWN_WIDTH, TOWN_HEIGHT, TILE.MEADOW);
  const midY = Math.floor(TOWN_HEIGHT / 2);
  const midX = Math.floor(TOWN_WIDTH / 2);

  grid.rect(0, 0, TOWN_WIDTH, 1, TILE.TREE);
  grid.rect(0, TOWN_HEIGHT - 1, TOWN_WIDTH, 1, TILE.TREE);
  grid.rect(0, 0, 1, TOWN_HEIGHT, TILE.TREE);
  grid.rect(TOWN_WIDTH - 1, 0, 1, TOWN_HEIGHT, TILE.TREE);

  // A crossroads, because a town is where the ways meet.
  grid.rect(1, midY - 1, TOWN_WIDTH - 2, 3, TILE.PATH);
  grid.rect(midX - 1, 1, 3, TOWN_HEIGHT - 2, TILE.PATH);

  const doors: Door[] = [];
  const signs: Sign[] = [];
  const interiors: Route[] = [];
  const plots: { x: number; y: number; role: InteriorRole; label: string }[] = [
    { x: 5, y: midY - 9, role: "daycare", label: "Daycare" },
    { x: 24, y: midY - 9, role: "centre", label: "Trainers Centre" },
    { x: 7, y: midY + 4, role: "mart", label: "Mart" },
    { x: 26, y: midY + 4, role: "house", label: "A house" },
  ];

  for (const plot of plots) {
    const door = building(grid, plot.x, plot.y, 6, 5, [TILE.MEADOW, TILE.FLOWER]);
    if (!door) continue;

    const id = `${HUB_ID}:${plot.role}${plot.x}`;
    const back = { x: door.x, y: door.y + 1 };
    const inside = buildInterior(id, HUB_ID, plot.role, plot.label, back);
    doors.push({ x: door.x, y: door.y, to: id, at: inside.entry });
    // What the sign says is the building's job, not its name: "Daycare" is
    // useful from across the square, "A house" is at least honest.
    if (door.sign) signs.push({ ...door.sign, text: SIGN_TEXT[plot.role] });
    interiors.push(inside);
  }

  // A fenced garden, so the middle of town is not only paving.
  //
  // Painted only over ground that is still bare. The first cut sat at
  // midX + 5 and quietly covered the whole south-east house — roof, door and
  // doorstep — leaving a building that worked but could not be seen. Asking
  // first is what stops decoration eating architecture.
  const gardenX = midX - 6;
  const gardenY = midY + 4;
  if (grid.clear(gardenX, gardenY, 5, 6, [TILE.MEADOW])) {
    grid.rect(gardenX, gardenY, 5, 6, TILE.FLOWER);
    grid.rect(gardenX, gardenY, 5, 1, TILE.FENCE);
  }

  // Four ways out, from the one table that also decides where walking back in
  // puts you.
  for (const exit of townExits(TOWN_WIDTH, TOWN_HEIGHT)) grid.set(exit.x, exit.y, TILE.PATH);

  return {
    town: {
      id: HUB_ID,
      kind: "town",
      biome: "hearth",
      ring: 0,
      width: TOWN_WIDTH,
      height: TOWN_HEIGHT,
      tiles: grid.tiles,
      entry: { x: midX, y: midY },
      doors,
      signs,
      label: "Hearth",
    },
    interiors,
  };
}

export const HUB_ID = "hub-0";

export function generateWorld(
  config: WorldConfig,
  seed: string,
  allSpecies: readonly SpeciesEntry[],
): World {
  const routes = new Map<string, Route>();

  const hearth = buildTown();
  routes.set(hearth.town.id, hearth.town);
  for (const room of hearth.interiors) routes.set(room.id, room);

  for (const biome of config.biomes) {
    for (let ring = 1; ring <= config.rings; ring++) {
      const built = buildRoute(seed, biome, ring);
      routes.set(built.route.id, built.route);
      for (const room of built.interiors) routes.set(room.id, room);
    }
  }

  const starters = pickStarters(seed, allSpecies);

  // Place the census. Rarer forms are placed further out, so the true shiny
  // is never sitting in the first patch of grass outside Hearth.
  const census = new Map<string, string>();
  const routeIds = [...routes.values()].filter((route) => route.kind === "route").map((route) => route.id).sort();

  const place = (id: string, rng: Rng, minRing: number) => {
    const eligible = routeIds.filter((route) => (routes.get(route)?.ring ?? 0) >= minRing);
    if (!eligible.length) return;

    // A slot already spoken for goes to the next one along rather than
    // overwriting, so the census total is exact rather than approximate.
    let key = "";
    for (let attempt = 0; attempt < 64; attempt++) {
      const route = eligible[intBetween(rng, 0, eligible.length - 1)];
      const slot = intBetween(rng, 0, CENSUS_SLOT_RANGE - 1);
      key = `${route}:${slot}`;
      if (!census.has(key)) break;
    }
    census.set(key, id);
  };

  const depthRing = (depth: number) =>
    depth === 1 ? 1 : depth === 2 ? Math.max(1, config.rings - 2) : config.rings;

  for (const entry of CENSUS_PLAN) {
    for (let copy = 0; copy < entry.count; copy++) {
      place(entry.id, rngFor(seed, "census", entry.id, copy), depthRing(entry.depth));
    }
  }

  // The crown: one shiny wearing a colour, the rarest thing in the world, on
  // the outermost ring. Which colour is the seed's to choose, so two players
  // sharing a seed are hunting the same one and no two seeds hunt the same.
  const crownRng = rngFor(seed, "census", "crown");
  const crown = appearanceId(TOP_TIER, CHROMA_IDS[intBetween(crownRng, 0, CHROMA_IDS.length - 1)]);
  place(crown, crownRng, depthRing(3));

  const trainers = new Map<string, TrainerSpec[]>();
  for (const route of routes.values()) {
    if (route.kind !== "route") continue;
    const here = buildTrainers(seed, route, allSpecies, config.rings);
    if (here.length) trainers.set(route.id, here);
  }

  return { config, seed, starters, routes, census, trainers };
}

/**
 * How strong things are at this distance from the hub.
 *
 * Ring 1 has to sit *below* the level 5 starter, or the first patch of grass
 * outside the hub is unwinnable and the game opens by killing you. Each ring
 * out is worth another eight levels, which puts the outermost in the forties.
 */
export function levelForRing(ring: number): number {
  return 3 + (ring - 1) * 8;
}

/** Names for the people standing on routes. Deliberately plain: a trainer is
 * furniture with a team, and inventing lore for each one is a different job. */
const TRAINER_NAMES = [
  "Alder", "Briony", "Cass", "Dov", "Esme", "Fen", "Greta", "Hal",
  "Ida", "Jem", "Kit", "Lore", "Mira", "Nils", "Orla", "Pike",
  "Quill", "Rune", "Sable", "Tor", "Uma", "Vero", "Wren", "Zosia",
];

/**
 * Who stands on a route, and what they bring.
 *
 * Placed on the path rather than in the grass, so they are visible and
 * avoidable: walking into one starts a fight, walking around one does not.
 * Their teams are drawn from the same encounter table the route uses, a couple
 * of levels above the wild creatures, which makes a trainer the reason to
 * come back to a route rather than a wall across it.
 */
function buildTrainers(seed: string, route: Route, allSpecies: readonly SpeciesEntry[], rings: number): TrainerSpec[] {
  if (route.ring < 1) return [];

  const rng = rngFor(seed, "trainers", route.id);
  const table = encounterTable(allSpecies, route.biome, route.ring, rings);
  if (!table.length) return [];

  // Path tiles only, so a trainer is always visible and always avoidable.
  // The path wanders now, so where somebody can stand is asked of the map
  // rather than assumed from a shape it no longer has.
  const onPath: { x: number; y: number }[] = [];
  for (let y = 2; y < route.height - 2; y++) {
    for (let x = 6; x < route.width - 6; x++) {
      if (route.tiles[y * route.width + x] === TILE.PATH) onPath.push({ x, y });
    }
  }
  if (!onPath.length) return [];

  const chosen = shuffle(rng, onPath).slice(0, 1 + intBelow(rng, 3));

  return chosen.map((spot, index) => {
    const size = 1 + intBelow(rng, Math.min(3, route.ring));
    const team = [];
    for (let member = 0; member < size; member++) {
      team.push({
        speciesId: weighted(rng, table, (row) => row.weight).speciesId,
        level: Math.max(2, levelForRing(route.ring) + 2 + intBetween(rng, -1, 1)),
      });
    }
    return {
      id: `${route.id}:${index}`,
      routeId: route.id,
      x: spot.x,
      y: spot.y,
      name: TRAINER_NAMES[intBelow(rng, TRAINER_NAMES.length)],
      team,
    };
  });
}

/** Whoever is standing on this tile, if anyone. */
export function trainerAt(world: World, routeId: string, x: number, y: number): TrainerSpec | null {
  const here = world.trainers.get(routeId);
  return here?.find((trainer) => trainer.x === x && trainer.y === y) ?? null;
}

/** Does a step in grass start an encounter? Derived from the step counter, so
 * walking back and forth over the same tile cannot be used to fish for one. */
export function encounterTriggers(seed: string, route: string, stepsInGrass: number): boolean {
  return rngFor(seed, "step", route, stepsInGrass)() * 1000 < ENCOUNTER_RATE;
}

/**
 * The creature waiting in slot `index` of a route's encounter sequence.
 *
 * Pure in (world, species table, route, index): the same slot always holds the
 * same creature, with the same IVs, nature and variant, forever.
 */
export function wildAt(
  world: World,
  allSpecies: readonly SpeciesEntry[],
  route: string,
  index: number,
  uid: number,
): Individual {
  const target = world.routes.get(route);
  if (!target) throw new Error(`unknown route: ${route}`);

  const rng = rngFor(world.seed, "encounter", route, index);
  const table = encounterTable(allSpecies, target.biome, target.ring, world.config.rings);
  const speciesId = weighted(rng, table, (row) => row.weight).speciesId;

  const level = Math.max(2, levelForRing(target.ring) + intBetween(rng, -2, 2));
  const exp = level * level * level;
  const ivs = rollWildIvs(rng);
  const natureId = pickNature(rng);
  const variantId = world.census.get(`${route}:${index}`) ?? "normal";
  // Drawn last on purpose. Every roll above it was made before gender
  // existed, and inserting a draw ahead of them would deal a different
  // creature into every encounter slot in every world already saved.
  const gender = rollGender(rng);

  return {
    uid,
    speciesId,
    level,
    exp,
    ivs,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    natureId,
    variantId,
    hp: 0, // filled by the caller, which has the stat table
    status: null,
    sleepTurns: 0,
    moves: [],
    nickname: null,
    traded: false,
    parents: null,
    gender,
  };
}

function rollWildIvs(rng: Rng): StatTable {
  const ivs = {} as StatTable;
  for (const stat of STAT_IDS) ivs[stat] = intBetween(rng, 0, WILD_IV_MAX);
  return clampIvs(ivs);
}

function pickNature(rng: Rng): string {
  return NATURE_IDS[intBetween(rng, 0, NATURE_IDS.length - 1)];
}
