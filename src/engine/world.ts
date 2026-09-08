import { NATURE_IDS } from "./natures";
import { intBetween, rngFor, shuffle, weighted, type Rng } from "./rng";
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

export interface World {
  config: WorldConfig;
  seed: string;
  /** The six starters this world offers, drawn from every starter in the dex. */
  starters: string[];
  routes: Map<string, Route>;
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
 * different roster still offers a sensible six. */
export function starterPool(allSpecies: readonly SpeciesEntry[]): SpeciesEntry[] {
  const byId = new Map(allSpecies.map((s) => [s.id, s]));
  return allSpecies.filter((species) => {
    if (species.evolvesTo.length !== 1) return false;
    const middle = byId.get(species.evolvesTo[0].id);
    if (!middle || middle.evolvesTo.length !== 1) return false;
    const power = bst(species.base);
    return power >= 280 && power <= 330;
  });
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

  const starters = shuffle(rngFor(seed, "starters"), starterPool(allSpecies))
    .slice(0, 6)
    .map((species) => species.id)
    .sort();

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

  return { config, seed, starters, routes, census };
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

  // Ring 1 has to sit *below* the level 5 starter, or the first patch of grass
  // outside the hub is unwinnable and the game opens by killing you. Ring 1
  // lands on 1-5, and each ring out is worth another eight levels, which puts
  // the outermost ring in the low forties.
  const level = Math.max(2, 3 + (target.ring - 1) * 8 + intBetween(rng, -2, 2));
  const exp = level * level * level;
  const ivs = rollWildIvs(rng);
  const natureId = pickNature(rng);
  const variantId = world.census.get(`${route}:${index}`) ?? "normal";

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
    parents: null,
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
