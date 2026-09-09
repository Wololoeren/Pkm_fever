import { STARTER_TYPES, startersOfType } from "./dex";
import { rollGender } from "./gender";
import { NATURE_IDS } from "./natures";
import { intBelow, intBetween, rngFor, shuffle, weighted, type Rng } from "./rng";
import { clampIvs, WILD_IV_MAX } from "./stats";
import { STAT_IDS, type Individual, type SpeciesEntry, type StatTable, type WorldConfig } from "./types";
import { PLACED_VARIANTS } from "./variants";

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

export const TILE_PATH = 0;
export const TILE_GRASS = 1;
export const TILE_BLOCK = 2;

export const ROUTE_WIDTH = 24;
export const ROUTE_HEIGHT = 18;

/** How far into a route's encounter sequence world generation will place a
 * variant. Placing one at slot 900 would be the same as not placing it, so
 * the census lives inside the range a thorough player actually reaches. */
const CENSUS_SLOT_RANGE = 120;

/** One step in tall grass triggers an encounter this often, per mille. */
const ENCOUNTER_RATE = 118;

export interface Route {
  id: string;
  biome: string;
  ring: number;
  width: number;
  height: number;
  /** Row-major, one of the TILE_* constants. */
  tiles: number[];
  /** Where the player arrives when entering from the ring below. */
  entry: { x: number; y: number };
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

function buildRoute(seed: string, biome: string, ring: number): Route {
  const rng = rngFor(seed, "route", biome, ring);
  const tiles = new Array<number>(ROUTE_WIDTH * ROUTE_HEIGHT).fill(TILE_GRASS);
  const at = (x: number, y: number) => y * ROUTE_WIDTH + x;

  const midY = Math.floor(ROUTE_HEIGHT / 2);
  const midX = Math.floor(ROUTE_WIDTH / 2);

  // Scatter cover first, then carve the paths through it, so a path is never
  // blocked by a tree that landed on it.
  for (let i = 0; i < tiles.length; i++) {
    if (rng() < 0.09) tiles[i] = TILE_BLOCK;
  }
  for (let x = 0; x < ROUTE_WIDTH; x++) tiles[at(x, midY)] = TILE_PATH;
  for (let y = 0; y < ROUTE_HEIGHT; y++) tiles[at(midX, y)] = TILE_PATH;

  // Solid border, with a gap where the corridor continues.
  for (let x = 0; x < ROUTE_WIDTH; x++) {
    tiles[at(x, 0)] = TILE_BLOCK;
    tiles[at(x, ROUTE_HEIGHT - 1)] = TILE_BLOCK;
  }
  for (let y = 0; y < ROUTE_HEIGHT; y++) {
    tiles[at(0, y)] = TILE_BLOCK;
    tiles[at(ROUTE_WIDTH - 1, y)] = TILE_BLOCK;
  }
  tiles[at(0, midY)] = TILE_PATH;
  tiles[at(ROUTE_WIDTH - 1, midY)] = TILE_PATH;

  return {
    id: routeId(biome, ring),
    biome,
    ring,
    width: ROUTE_WIDTH,
    height: ROUTE_HEIGHT,
    tiles,
    entry: { x: 1, y: midY },
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

/** The hub: no grass, no encounters, four ways out. Hand-shaped rather than
 * generated, because it is the one place every player sees first. */
function buildHub(): Route {
  const tiles = new Array<number>(ROUTE_WIDTH * ROUTE_HEIGHT).fill(TILE_PATH);
  const at = (x: number, y: number) => y * ROUTE_WIDTH + x;
  const midY = Math.floor(ROUTE_HEIGHT / 2);
  const midX = Math.floor(ROUTE_WIDTH / 2);

  for (let x = 0; x < ROUTE_WIDTH; x++) {
    tiles[at(x, 0)] = TILE_BLOCK;
    tiles[at(x, ROUTE_HEIGHT - 1)] = TILE_BLOCK;
  }
  for (let y = 0; y < ROUTE_HEIGHT; y++) {
    tiles[at(0, y)] = TILE_BLOCK;
    tiles[at(ROUTE_WIDTH - 1, y)] = TILE_BLOCK;
  }
  tiles[at(0, midY)] = TILE_PATH;
  tiles[at(ROUTE_WIDTH - 1, midY)] = TILE_PATH;
  tiles[at(midX, 0)] = TILE_PATH;
  tiles[at(midX, ROUTE_HEIGHT - 1)] = TILE_PATH;

  return {
    id: HUB_ID,
    biome: "hub",
    ring: 0,
    width: ROUTE_WIDTH,
    height: ROUTE_HEIGHT,
    tiles,
    entry: { x: midX, y: midY },
  };
}

export const HUB_ID = "hub-0";

export function generateWorld(
  config: WorldConfig,
  seed: string,
  allSpecies: readonly SpeciesEntry[],
): World {
  const routes = new Map<string, Route>();
  routes.set(HUB_ID, buildHub());
  for (const biome of config.biomes) {
    for (let ring = 1; ring <= config.rings; ring++) {
      const route = buildRoute(seed, biome, ring);
      routes.set(route.id, route);
    }
  }

  const starters = pickStarters(seed, allSpecies);

  // Place the census. Rarer variants are placed further out, so the true
  // shiny is never sitting in the first patch of grass outside the hub.
  const census = new Map<string, string>();
  const routeIds = [...routes.keys()].sort();
  for (const placed of PLACED_VARIANTS) {
    for (let copy = 0; copy < placed.census; copy++) {
      const rng = rngFor(seed, "census", placed.id, copy);
      const minRing = placed.kind === "tint" ? 1 : Math.max(1, config.rings - 2);
      const eligible = routeIds.filter((id) => (routes.get(id)?.ring ?? 0) >= minRing);

      // A slot already spoken for goes to the next one along rather than
      // overwriting, so the census total is exact rather than approximate.
      let key = "";
      for (let attempt = 0; attempt < 64; attempt++) {
        const route = eligible[intBetween(rng, 0, eligible.length - 1)];
        const slot = intBetween(rng, 0, CENSUS_SLOT_RANGE - 1);
        key = `${route}:${slot}`;
        if (!census.has(key)) break;
      }
      census.set(key, placed.id);
    }
  }

  const trainers = new Map<string, TrainerSpec[]>();
  for (const route of routes.values()) {
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

  const midY = Math.floor(route.height / 2);
  const midX = Math.floor(route.width / 2);

  // Path tiles only, and never the two entry tiles: arriving on a route
  // already inside a battle reads as a bug rather than an ambush.
  const spots: { x: number; y: number }[] = [];
  for (let x = 4; x < route.width - 4; x++) {
    if (x !== midX) spots.push({ x, y: midY });
  }
  for (let y = 3; y < route.height - 3; y++) {
    if (y !== midY) spots.push({ x: midX, y });
  }

  const chosen = shuffle(rng, spots).slice(0, 1 + intBelow(rng, 3));

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
