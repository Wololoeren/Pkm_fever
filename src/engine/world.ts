import { rollAbilities } from "./abilities";
import { SCHOOL_LABEL } from "./school";
import { ALL_SPECIES, species as speciesById, STARTER_TYPES, startersOfType } from "./dex";
import { INKS, ITEMS, MACHINE_ITEMS } from "./items";
import { rollGender } from "./gender";
import { BIOME_IDS, nameOf, placesWanted, profileFor, typesFor } from "./biomes";
import { CRITTERS, idleLine, idlersFor, type CritterSpec } from "./critters";
import { TOWNS, TOWN_TRAINERS } from "./towns";
import { dealHints } from "./hints";
import { CUP_BIOME, CUP_IDS, CUP_NTH } from "./cup";
import { ARENAS } from "./arenas";
import { GYMS, gym, type GymSpec } from "./gyms";
import {
  bandOf,
  copyOf,
  HUB,
  opposite,
  OUTER_TOWNS,
  planWorld,
  type Bearing,
  type PlanNode,
  type WorldPlan,
} from "./layout";
import { NPCS, type NpcPlacement, type NpcSpec } from "./npc";
import { furnish, PROPS, type PropPlacement } from "./props";
import { NATURE_IDS } from "./natures";
import {
  building,
  carve,
  carveLine,
  clump,
  Grid,
  joined,
  maze,
  hidesEncounters,
  passable,
  reachable,
  reachableWith,
  sealUnreachable,
  speckle,
  TILE,
  walkable,
} from "./terrain";
import { intBelow, intBetween, rngFor, shuffle, weighted, type Rng } from "./rng";
import { clampIvs, WILD_IV_MAX } from "./stats";
import { STAT_IDS, type Individual, type SpeciesEntry, type StatTable, type WorldConfig } from "./types";
import { appearanceId, CENSUS_PLAN, CHROMA_IDS, TOP_TIER } from "./variants";

/**
 * The world is a pure function of (config, seed). Nothing here is stored in a
 * save file; a save carries the seed and the player's inputs, and the world
 * is rebuilt identically on every load and on every other player's machine.
 *
 * The shape is a graph: fifty places on an irregular lattice around one town,
 * joined with loops and a few blind ends. See layout.ts for how it is grown.
 *
 * Difficulty is still one-dimensional, and that is still the point — a
 * designer tunes one curve rather than fifty routes. What changed is what the
 * one dimension *is*: it used to be an arm's ring index, which was also the
 * route's name and also its direction, three facts wearing one number. It is
 * now distance from town in hops, normalised onto `config.rings` bands, so a
 * route carries three separate numbers that mean three separate things:
 * `depth` (how far you walked), `ring` (how hard it is) and `nth` (which copy
 * of its biome it is, which is how anything hand-placed addresses it).
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
export const ROUTE_WIDTH = 88;
export const ROUTE_HEIGHT = 68;

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
export type InteriorRole = "daycare" | "centre" | "mart" | "gym" | "house" | "cup";

/** What the board outside each kind of building says. */
const SIGN_TEXT: Record<InteriorRole, string> = {
  daycare: "Daycare",
  centre: "Poké Center",
  mart: "Mart",
  gym: "Gym",
  house: "House",
  cup: "The Cup",
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
  /**
   * How hard it is: one of `config.rings` bands, 0 for the town and interiors.
   *
   * Not the same as `depth` on purpose. See `bandOf` in layout.ts — worlds
   * come out different sizes, and reading the level curve straight off hops
   * would make the same curve reach further on some seeds than others.
   */
  ring: number;
  /** Hops from town. What the region map draws, and what `ring` is made of. */
  depth: number;
  /**
   * Which copy of its biome this is, counted outward from town: 1 is the
   * nearest. Zero for the town and for interiors.
   *
   * This is the half of a route's identity that hand-placed things address.
   * `{ biome: "marsh", nth: 1 }` resolves in every world; `{ biome: "marsh",
   * ring: 1 }` did not once rings stopped being names.
   */
  nth: number;
  /** Where it sits on the lattice, so the region map can draw the truth. */
  cell: { x: number; y: number };
  width: number;
  height: number;
  /** Row-major, one of the TILE values. */
  tiles: number[];
  /** Where the player arrives when entering from the ring below. */
  entry: { x: number; y: number };
  /** Doors on this map, keyed by the tile you step on. */
  doors: Door[];
  /**
   * A gap in the wall per neighbour, and which way that neighbour lies.
   *
   * There used to be exactly two — `inGate` west, `outGate` east — because
   * the world was a star and a route had a way in and a way on and nothing
   * else. A graph node has as many neighbours as it has, up to one a side.
   *
   * This also retired the rotation. Routes were generated running west to east
   * and turned afterwards to face the way their arm ran, which is a transform
   * and a whole class of bug with it (a cabin's doorstep written down before
   * the turn and read after it). Gates are cut on the real edges now, so there
   * is nothing left to turn.
   */
  gates: { bearing: Bearing; x: number; y: number }[];
  /** Border crossings, wired once every route exists. */
  borders: Door[];
  /** Boards standing beside a door, and what each one says. */
  signs: Sign[];
  /** Furniture standing on this map. Interiors only, in practice. */
  props: PropPlacement[];
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
  /**
   * The one thing this person knows, by id. See `hints.ts`.
   *
   * On the *world* rather than on the state, like an NPC's lines and for the
   * same reason: it is a fact about who is standing there, decided when the
   * world was made, not something a playthrough accumulates. So it costs no
   * save bytes, does not enter the state hash, and two players on one seed get
   * the same person saying the same thing.
   *
   * Optional because the town trainers do not have one. They are the written
   * cast — the joke is their team — and a fact about the crit ladder coming
   * out of the cryptid hunter would be a fact standing where a joke was.
   */
  hintId?: string;
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
  /** People who are not trying to fight you, by route. */
  npcs: Map<string, NpcSpec[]>;
  /** Things on the floor, by route. Picked up by walking onto them. */
  pickups: Map<string, PickupSpec[]>;
  /**
   * Creatures standing where you can see them, by route.
   *
   * A roamer's *loop* is here, in the world, because it is a fact about the
   * place; how far along it the creature has walked is in the save, because
   * that is a fact about the playthrough. See critters.ts.
   */
  critters: Map<string, CritterSpec[]>;
}

/**
 * A place's name: its biome, and which copy of it this is.
 *
 * `meadow-1` through `meadow-4`, because there are four meadows. The second
 * number used to be the ring, which was also the difficulty and also the
 * direction; it is a plain counter now, and how far out a place is lives on
 * the route as `depth`.
 */
export function routeId(biome: string, copy: number): string {
  return `${biome}-${copy}`;
}

/**
 * Which species may appear at this ring. A band over base stat total, rising
 * and widening as the player walks outward.
 *
 * The bands **overlap**, and by half a band rather than a little. That is the
 * one number here worth explaining: a band's job is to hold enough different
 * creatures to be worth walking into, and how many difficulty grades the world
 * is cut into is a *difficulty* decision that should not quietly also decide
 * how thin the bestiary is. Going from six grades to eight narrowed every band
 * by a quarter and left the ash flats with three species to offer at the first
 * grade — two of which were the same line. Reaching half a band further up
 * restores that without moving the floor, so what changed is how much a place
 * *may* hold, not how strong the weakest thing in it is.
 */
function ringBand(ring: number, rings: number): { min: number; max: number } {
  const span = (620 - 190) / rings;
  return {
    min: Math.round(190 + span * (ring - 1) * 0.75),
    max: Math.min(620, Math.round(190 + span * (ring + 0.5))),
  };
}

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
    // Both filled by the caller, which runs them through `withMoves`.
    pp: [],
    // Rolled after gender, for the same reason gender was added last: every
    // draw above these was made before they existed.
    abilities: rollAbilities(rng),
    heldItem: null,
    nickname: null,
    traded: false,
    prize: false,
    cheat: false,
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
  const affinity = typesFor(biome);

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
/**
 * What one biome is made of, and how hard it is to get through.
 *
 * The routes used to differ only in palette and in what lived in the grass,
 * which meant four biomes were one biome wearing four coats. These are the
 * knobs that make a marsh feel unlike a pinewood to *walk* through: what the
 * walls are made of, how wide the ways between them run, how many loops there
 * are to take a wrong turn around, and how much of the open ground bites.
 */
/**
 * The terrain knobs, and the type lists, moved to biomes.ts.
 *
 * They were two tables here and a third in render/tiles.ts, which is workable
 * for four biomes and hopeless for twenty: adding one meant three edits in two
 * layers, and forgetting the third gave you a place that generated correctly,
 * held the right creatures, and was painted meadow green. One row per biome
 * now, with a test holding the engine's half and the renderer's together.
 *
 * The `grass` share is worth repeating here because it is the one number that
 * is not obvious: it is a share of the open ground rather than a number of
 * clumps. The old figure was "how many clumps to drop", which meant coverage
 * depended on how much of the route the maze happened to carve, and nobody
 * could say what any of the numbers meant. Measured, the four original biomes
 * were coming out at five to thirteen percent — nothing like enough for a
 * route whose whole business is what lives in the grass.
 */

/**
 * Routes that must have a cabin, because the roster puts somebody inside one.
 *
 * Read off the roster rather than listed here, so moving a person moves their
 * roof with them. A door somebody is written to be standing behind is not
 * scenery, and it does not get to depend on a die.
 */
const CABIN_ROUTES = new Set(
  NPCS.flatMap((who) => (who.where.at === "cabin" ? [`${who.where.biome}:${who.where.nth}`] : [])),
);

/**
 * What a particular place has to hold, worked out before it is built.
 *
 * `buildRoute` used to look these up itself, by biome and ring. It cannot any
 * more: a route's address is its biome and *which copy* it is, and only the
 * plan knows that. So the answers are gathered in `generateWorld` and handed
 * down — which is better anyway, because a route is now told what it is for
 * rather than reaching into three rosters to find out.
 */
interface Duty {
  /** The difficulty band, 1 up to `config.rings`. */
  ring: number;
  /** Which copy of its biome this is, counted outward. */
  nth: number;
  cabin: boolean;
  gym: GymSpec | null;
  cup: boolean;
}

/**
 * What is written on the board outside the Cup's house, and on the HUD once
 * you are inside it.
 *
 * One string, because the sign and the room label are the same fact and a
 * house whose door says one thing and whose inside says another is a bug
 * nobody would think to look for.
 */
export const CUP_LABEL = "The Cup";

/** How coarse the maze is. Eight tiles a cell over 88x68 gives 10x8 rooms. */
const CELL = 8;

/**
 * The thinnest wall a room may keep, and the widest doorway one may have.
 *
 * Both exist because the maze was not a maze. A room is carved inset from its
 * cell, and the inset *is* the wall between it and its neighbours — so an inset
 * of nought carves the whole cell and the two rooms simply merge. Five of the
 * twenty biomes were written `[0, 0]`, which made their routes one open field
 * eighty cells across: you walked in one side and out the other without ever
 * meeting a wall, and the maze plan underneath decided nothing at all.
 *
 * The profiles are retuned to respect these, and these are here so that a new
 * biome written in a hurry cannot bring the field back. `X8` holds the data to
 * the same numbers, so the two cannot drift apart quietly.
 */
const MIN_INSET = 1;
const MOST_CORRIDOR = CELL - 3;

/**
 * A route, with a gap in its wall on every side that has a neighbour.
 *
 * Carved rather than drawn: the map starts solid and a maze over a coarse grid
 * of rooms decides what opens. That is what makes a route somewhere to find
 * your way through rather than a field with a path across it, and it is why
 * connectivity is structural — every room sits on a spanning tree, so
 * generation cannot seal a route off no matter what is scattered afterwards.
 */
function buildRoute(seed: string, node: PlanNode, duty: Duty): { route: Route; interiors: Route[] } {
  const { biome, id } = node;
  const ring = duty.ring;
  const rng = rngFor(seed, "route", id);
  const profile = profileFor(biome);

  const grid = new Grid(ROUTE_WIDTH, ROUTE_HEIGHT, profile.wall);
  const cols = Math.floor((ROUTE_WIDTH - 2) / CELL);
  const rows = Math.floor((ROUTE_HEIGHT - 2) / CELL);
  const originX = Math.floor((ROUTE_WIDTH - cols * CELL) / 2);
  const originY = Math.floor((ROUTE_HEIGHT - rows * CELL) / 2);

  // Further out is tighter: the outer rings close in without needing a profile
  // of their own, and the first ring of a biome stays the friendly version.
  // Capped as well as floored: a doorway wider than five leaves less than
  // three tiles of wall along the edge two rooms share, which stops reading as
  // a wall with a door in it and starts reading as a wall with a hole.
  const corridor = Math.min(
    MOST_CORRIDOR,
    Math.max(2, profile.corridor - Math.floor(ring / 3)),
  );
  const plan = maze(rng, cols, rows, Math.max(2, profile.loops - ring));

  const centreOf = (cx: number, cy: number) => ({
    x: originX + cx * CELL + Math.floor(CELL / 2),
    y: originY + cy * CELL + Math.floor(CELL / 2),
  });

  const midRow = Math.floor(rows / 2);
  const midCol = Math.floor(cols / 2);

  /**
   * A room to head for on each side that has a neighbour, and the tile in the
   * wall it opens through.
   *
   * The middle room along that side, so a gate opens onto the maze rather than
   * into a corner, and the gap lines up with the room so the corridor out to
   * it is short and straight.
   */
  const gateFor = (bearing: Bearing) => {
    switch (bearing) {
      case "w": {
        const room = centreOf(0, midRow);
        return { room, wall: { x: 0, y: room.y }, approach: { x: 1, y: room.y } };
      }
      case "e": {
        const room = centreOf(cols - 1, midRow);
        return {
          room,
          wall: { x: ROUTE_WIDTH - 1, y: room.y },
          approach: { x: ROUTE_WIDTH - 2, y: room.y },
        };
      }
      case "n": {
        const room = centreOf(midCol, 0);
        return { room, wall: { x: room.x, y: 0 }, approach: { x: room.x, y: 1 } };
      }
      default: {
        const room = centreOf(midCol, rows - 1);
        return {
          room,
          wall: { x: room.x, y: ROUTE_HEIGHT - 1 },
          approach: { x: room.x, y: ROUTE_HEIGHT - 2 },
        };
      }
    }
  };

  const ways = node.links.map((link) => ({ ...link, ...gateFor(link.bearing) }));

  /**
   * The middle of the map, and what every reachability check here is measured
   * from.
   *
   * It used to be a pair — first room to last — because there were only ever
   * two ways out and "is the way through still open" was one question. With up
   * to four gates it is one place against many, which is both simpler and the
   * only version that catches a pool sealing the third of three exits.
   */
  const heart = centreOf(midCol, midRow);

  /**
   * Does something to the map, and takes it back if it closed the way through.
   *
   * The cabin and the gym already worked this way; the water and the loose
   * rock did not, and got away with it only because the dice had not yet
   * dealt a pond across a corridor. Growing the grass reshuffled them and one
   * promptly sealed marsh ring four end to end.
   *
   * Checked from the middle to the gate rooms, not between the edge tiles:
   * the corridors out to the map edge are cut later, so a walk from the edge
   * at this point starts on solid wall and reaches nothing — which quietly
   * reverted every pool in the world the first time this ran.
   */
  const keepingOpen = (change: () => void): boolean => {
    const before = [...grid.tiles];
    change();

    const seen = reachableWith(grid, heart, walkable);
    if (ways.every((way) => seen[way.room.y * ROUTE_WIDTH + way.room.x] === 1)) return true;

    grid.tiles.splice(0, grid.tiles.length, ...before);
    return false;
  };

  // Rooms first, then the ways between them.
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const inset = Math.max(
        MIN_INSET,
        intBetween(rng, profile.roomInset[0], profile.roomInset[1]),
      );
      carve(
        grid,
        originX + cx * CELL + inset,
        originY + cy * CELL + inset,
        CELL - inset * 2,
        CELL - inset * 2,
        profile.ground,
      );
    }
  }

  // A room is walled off again unless the maze joined it to something, which
  // is where the dead ends come from: a leaf of the tree has one way in.
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const open = [
        { cx: cx - 1, cy },
        { cx: cx + 1, cy },
        { cx, cy: cy - 1 },
        { cx, cy: cy + 1 },
      ]
        .filter((next) => next.cx >= 0 && next.cy >= 0 && next.cx < cols && next.cy < rows)
        .some((next) => joined(plan, { cx, cy }, next));
      if (!open) carve(grid, originX + cx * CELL, originY + cy * CELL, CELL, CELL, profile.wall);
    }
  }

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      for (const next of [
        { cx: cx + 1, cy },
        { cx, cy: cy + 1 },
      ]) {
        if (next.cx >= cols || next.cy >= rows) continue;
        if (!joined(plan, { cx, cy }, next)) continue;
        carveLine(grid, centreOf(cx, cy), centreOf(next.cx, next.cy), corridor, profile.ground);
      }
    }
  }

  // Tall grass, the only thing out here that bites. Grown until the route is
  // as overgrown as its biome asks for, rather than a fixed number of blobs
  // over however much ground the maze happened to open up.
  //
  // The guard is not decoration: a route whose rooms are nearly all grass
  // already will never reach a high target, and without a stop this walks the
  // whole plan forever looking for ground that is not there.
  const openGround = grid.tiles.filter(walkable).length;
  const wantGrass = Math.round((openGround * profile.grass) / 1000);

  let grown = 0;
  for (let guard = 0; grown < wantGrass && guard < 600; guard++) {
    const cell = plan.order[intBetween(rng, 0, plan.order.length - 1)];
    const at = centreOf(cell.cx, cell.cy);
    grown += clump(grid, rng, at.x, at.y, 26 + intBelow(rng, 24), TILE.GRASS, [profile.ground]);
  }

  // Water, with a rim so it does not look stamped on.
  for (let i = 0; i < profile.pools; i++) {
    const cell = plan.order[intBetween(rng, 0, plan.order.length - 1)];
    const at = centreOf(cell.cx, cell.cy);
    keepingOpen(() => {
      clump(grid, rng, at.x, at.y, 22, TILE.SAND, [profile.ground, TILE.GRASS]);
      clump(grid, rng, at.x, at.y, 12, TILE.WATER, [TILE.SAND]);
    });
  }

  keepingOpen(() => speckle(grid, rng, TILE.ROCK, profile.clutter, [profile.ground]));
  // Flowers are walkable, so they can never close anything.
  speckle(grid, rng, TILE.FLOWER, profile.clutter, [profile.ground]);

  // The ways through: a short tunnel from each gap in the wall into the room
  // behind it, and nothing else.
  //
  // Each of those rooms is a room of the maze, and the maze is a spanning tree
  // with a handful of extra joins, so they are already connected to each other
  // and to everywhere else. Nothing more needs cutting — and cutting more is
  // exactly the mistake this replaced.
  //
  // Every gate used to be joined to the middle of the map as well, on the
  // reasoning that a place with three neighbours should be a junction rather
  // than three corridors sharing a map. It made every route four wide corridors
  // meeting in the centre, straight through whatever the maze had drawn: you
  // walked in one side and out the other as though a path had been cleared,
  // and the maze underneath was scenery you never had to enter. A junction is
  // what the maze is *for*; it does not need one bulldozed through it.
  for (const way of ways) {
    carveLine(grid, way.approach, way.room, corridor, profile.ground);
    grid.set(way.wall.x, way.wall.y, TILE.PATH);
  }

  const doors: Door[] = [];
  const signs: Sign[] = [];
  const interiors: Route[] = [];

  // Only the cabin's doorstep is kept: it is the one that has a fallback if it
  // turns out to open onto nothing (the person waits outside instead), so it is
  // the one worth checking afterwards. A gym or the Cup's house has no
  // fallback — eight badges and a five-stage quest are promises — which is why
  // those two search every room rather than trying one.
  let cabinBack: { x: number; y: number } | null = null;

  /**
   * Puts a building up in the first room that will take one.
   *
   * Three callers wanted the same forty lines — the cabin, the gym hall and
   * the Cup's house — and the third copy is what made this worth naming. The
   * order of operations is the load-bearing part, and every step of it is
   * something that went wrong once:
   *
   *   *Ask before copying.* Snapshotting six thousand tiles for a room that
   *   was never going to fit is the whole of what made generation slow.
   *
   *   *Check the doorstep as well as the way through.* Checking only the way
   *   through left doors opening onto ground `sealUnreachable` then filled in,
   *   which is a building you can see and cannot enter.
   *
   *   *Put it back if it sealed anything.* Dropped into one of pinewood's
   *   small rooms a building genuinely did cost an arm of the world its own
   *   exit tile, and putting one up and taking it down again is cheaper than
   *   reasoning about which rooms are wide enough.
   *
   * Returns the doorstep out here, or null if no room would take it.
   */
  const raise = (
    key: string,
    role: InteriorRole,
    label: string,
    sign: string,
    rooms: readonly { cx: number; cy: number }[],
  ): { x: number; y: number } | null => {
    const over = [profile.ground, TILE.GRASS, TILE.FLOWER];

    for (const cell of rooms) {
      const at = centreOf(cell.cx, cell.cy);
      if (!grid.clear(at.x - 2, at.y - 2, 5, 4, over)) continue;

      const before = [...grid.tiles];
      const door = building(grid, at.x - 2, at.y - 2, 5, 4, over);
      const open = door ? reachable(grid, heart) : null;
      const stillOpen =
        door !== null &&
        ways.every((way) => open![way.room.y * ROUTE_WIDTH + way.room.x] === 1) &&
        open![(door.y + 1) * ROUTE_WIDTH + door.x] === 1;

      if (!stillOpen || !door) {
        grid.tiles.splice(0, grid.tiles.length, ...before);
        continue;
      }

      const back = { x: door.x, y: door.y + 1 };
      const inside = buildInterior(key, id, role, label, back, rng);
      doors.push({ x: door.x, y: door.y, to: key, at: inside.entry });
      if (door.sign) signs.push({ ...door.sign, text: sign });
      interiors.push(inside);
      return back;
    }

    return null;
  };

  /**
   * A cabin in one of the rooms — always where somebody is meant to be living
   * in one, and otherwise about three routes in five.
   *
   * A route somebody *lives* on tries every room in turn rather than one at
   * random. Pinewood's rooms are the small ones, and one random attempt
   * succeeded on one pinewood route in forty-eight — so a person written to
   * be standing in a cabin in the north was, in practice, always standing
   * outside in the rain instead. Eight gyms became a promise the same way.
   */
  const cabinWanted = duty.cabin;
  if (cabinWanted || rng() < 0.6) {
    cabinBack = raise(
      `${id}:cabin`,
      "house",
      "A cabin",
      "Cabin",
      cabinWanted
        ? shuffle(rng, [...plan.order])
        : [plan.order[intBetween(rng, 1, plan.order.length - 1)]],
    );
  }

  // A cabin cut off by that pass is a door onto nothing, so it goes with it.
  if (cabinBack && !walkable(grid.get(cabinBack.x, cabinBack.y))) {
    doors.length = 0;
    signs.length = 0;
    interiors.length = 0;
    cabinBack = null;
  }

  // The gym, if one belongs on this route. Every room in turn, because picking
  // rooms at random found space for only half of the eight — pinewood and
  // marsh rooms are small, and a gym that silently does not exist is worse
  // than one in an awkward corner.
  const mine = duty.gym;
  if (mine) {
    raise(`${id}:gym`, "gym", mine.name, mine.name, shuffle(rng, [...plan.order]));
  }

  // And the Cup, which belongs on exactly one route in the world. The same
  // promise as a gym, and the same every-room search for the same reason: six
  // people are written to be standing in that room, and a house the seed can
  // decline to build is a quest that cannot be finished.
  if (duty.cup) {
    raise(`${id}:cup`, "cup", CUP_LABEL, CUP_LABEL, shuffle(rng, [...plan.order]));
  }


  // Gates: obstacles that need a tool. Placed before the seal, and the seal
  // is told to walk through them, or the first bush on a route would delete
  // everything behind it.
  placeGates(grid, rng, ring, heart, ways.map((way) => way.room));

  // The last word on the route, and it has to come after everything that is
  // built on it: anything the walk in cannot reach is filled back in.
  //
  // It used to run before the gym went up, so a hall that stranded a corner
  // left those tiles walkable and unreachable — and then nobody could be
  // placed on that route at all, because the check that asks "would standing
  // here cut the map in two" compares reachable tiles against walkable ones
  // and the two had already stopped matching.
  sealUnreachable(grid, heart, profile.wall, (tile) => passable(tile, () => true));

  const gates = ways.map((way) => ({ bearing: way.bearing, x: way.wall.x, y: way.wall.y }));

  return {
    route: {
      id,
      kind: "route",
      biome,
      ring,
      depth: node.depth,
      nth: duty.nth,
      cell: { ...node.cell },
      width: ROUTE_WIDTH,
      height: ROUTE_HEIGHT,
      tiles: grid.tiles,
      // Somewhere to stand if a caller has not said which gate it came
      // through. Every real crossing carries its own landing; this is the
      // fallback, and every node has at least one gate or it is not a node.
      entry: insideOf(gates[0] ?? heart, ROUTE_WIDTH, ROUTE_HEIGHT),
      gates,
      borders: [],
      doors,
      signs,
      props: [],
      label: `${nameOf(biome)} · ring ${ring}`,
    },
    interiors,
  };
}

/**
 * Joins the routes to each other, and to town.
 *
 * Run once, after every route exists, because a route cannot know where the
 * next ring out landed until that ring has been built. Both directions of a
 * crossing are written from the same pair of gates, which is what makes
 * stepping out and stepping back a round trip *structurally* rather than
 * because two separate pieces of arithmetic happened to agree — they did not,
 * and every return from ring one used to arrive at the same gap in town.
 */
function wireBorders(routes: Map<string, Route>, plan: WorldPlan): void {
  for (const node of plan.nodes) {
    const here = routes.get(node.id);
    if (!here) continue;

    for (const link of node.links) {
      const gate = here.gates.find((each) => each.bearing === link.bearing);
      if (!gate) continue;

      // Only this side of the crossing is written here; the other side is
      // written when the walk reaches that node's own links, and the two agree
      // because the plan's links are symmetric.
      //
      // A town used to be a special case in here, because a town was not a
      // node. It is one now, and the arithmetic that joined a route to Hearth
      // turned out to be the arithmetic that joins anything to anything: a
      // gate pairs with the gate on the wall facing it. Three more towns cost
      // this function nothing at all.
      const there = routes.get(link.to);
      const back = there?.gates.find((each) => each.bearing === opposite(link.bearing));
      if (!there || !back) continue;

      here.borders.push({
        x: gate.x,
        y: gate.y,
        to: there.id,
        at: insideOf(back, there.width, there.height),
      });
    }
  }
}

/** The furniture standing on a tile, if any. */
export function propAt(route: Route, x: number, y: number): PropPlacement | null {
  return route.props.find((prop) => prop.x === x && prop.y === y) ?? null;
}

/** Whether furniture is in the way here. */
export function propBlocks(route: Route, x: number, y: number): boolean {
  const prop = propAt(route, x, y);
  return prop ? !PROPS[prop.kind].walkable : false;
}

/**
 * Which obstacle a ring is allowed to hold, roughly in the order the badges
 * that answer them are won.
 */
const GATES_BY_RING: Record<number, number[]> = {
  1: [TILE.BUSH],
  2: [TILE.BUSH, TILE.RUBBLE],
  3: [TILE.BUSH, TILE.RUBBLE],
  4: [TILE.RUBBLE, TILE.BOULDER],
  5: [TILE.RUBBLE, TILE.BOULDER],
  6: [TILE.BOULDER, TILE.CLIFF],
  7: [TILE.BOULDER, TILE.CLIFF],
  8: [TILE.BOULDER, TILE.CLIFF],
};

/**
 * The water gates, which are deepenings of water rather than things dropped
 * on land. Water is already impassable without Surf, so turning some of it
 * into a waterfall asks for a second tool and can never close a way that was
 * open — which is why these need no reachability check at all.
 */
const DEEP_BY_RING: Record<number, number> = {
  3: TILE.WATERFALL,
  4: TILE.WATERFALL,
  5: TILE.WATERFALL,
  6: TILE.WHIRLPOOL,
  7: TILE.WHIRLPOOL,
  8: TILE.DEEP,
};

/**
 * Drops obstacles onto the route, and never onto the way through.
 *
 * Each one is placed and then checked by walking from the entrance to the exit
 * *without any tools at all*: if the walk still works, the obstacle only ever
 * gated an optional pocket and it stays. If it does not, it comes straight
 * back up.
 *
 * That is the whole rule, and it is what makes the tools rewards rather than
 * tolls. Nothing in this world can put a bush between you and the next ring.
 */
function placeGates(
  grid: Grid,
  rng: Rng,
  ring: number,
  from: { x: number; y: number },
  to: readonly { x: number; y: number }[],
): void {
  const kinds = GATES_BY_RING[ring] ?? GATES_BY_RING[1];
  const open = (tile: number) => walkable(tile);

  const spots: { x: number; y: number }[] = [];
  for (let y = 2; y < grid.height - 2; y++) {
    for (let x = 2; x < grid.width - 2; x++) {
      if (!walkable(grid.get(x, y))) continue;
      // Corridor-ish tiles only: a gate in the middle of a wide room gates
      // nothing and just looks like litter.
      const ways = [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ].filter(([dx, dy]) => walkable(grid.get(x + dx, y + dy))).length;
      if (ways !== 2) continue;
      spots.push({ x, y });
    }
  }

  let placed = 0;
  const wanted = 4 + intBelow(rng, 4);

  for (const at of shuffle(rng, spots)) {
    if (placed >= wanted) break;

    const was = grid.get(at.x, at.y);
    const kind = kinds[intBelow(rng, kinds.length)];
    grid.set(at.x, at.y, kind);

    const seen = reachableWith(grid, from, open);
    const stillOpen = to.every((room) => seen[room.y * grid.width + room.x] === 1);
    if (stillOpen) placed++;
    else grid.set(at.x, at.y, was);
  }

  // And the water, deepened in place.
  const deeper = DEEP_BY_RING[ring];
  if (!deeper) return;

  const pools: { x: number; y: number }[] = [];
  for (let y = 1; y < grid.height - 1; y++) {
    for (let x = 1; x < grid.width - 1; x++) {
      if (grid.get(x, y) === TILE.WATER) pools.push({ x, y });
    }
  }
  for (const at of shuffle(rng, pools).slice(0, Math.ceil(pools.length / 4))) {
    grid.set(at.x, at.y, deeper);
  }
}

/** How far from the spot asked for somebody may end up standing. */
const SEARCH_RADIUS = 24;

/** One item lying on the ground, waiting to be walked onto. */
export interface PickupSpec {
  /** Stable across a whole world, so a save records what it has taken. */
  id: string;
  x: number;
  y: number;
  item: string;
}

/**
 * Whether standing here would cut the map in two.
 *
 * People are solid: walking into one starts a conversation rather than a step.
 * That is fine in the open and disastrous in a doorway, and three of the town
 * roster landed squarely on the crossroads and walled off three of the four
 * ways out. Rather than hand-place around it — which lasts until the next
 * change to the town — every candidate tile is checked by walking the map
 * without it.
 */
/**
 * Every tile you could walk to from the way in, **with no tools at all**.
 *
 * On foot rather than with the tools, and that is the point of it: somebody
 * standing behind a bush is somebody you cannot talk to until you have Cut, and
 * a person is not a reward for a badge. A boulder is allowed to gate an item in
 * a pocket; it is not allowed to gate a conversation.
 */
function reachedFrom(route: Route, blocked: Set<string>): Uint8Array {
  const seen = new Uint8Array(route.width * route.height);
  const start = route.entry;
  if (blocked.has(`${start.x},${start.y}`)) return seen;
  if (!walkable(route.tiles[start.y * route.width + start.x])) return seen;

  const queue = [start];
  seen[start.y * route.width + start.x] = 1;

  for (let head = 0; head < queue.length; head++) {
    const here = queue[head];
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      const x = here.x + dx;
      const y = here.y + dy;
      if (x < 0 || y < 0 || x >= route.width || y >= route.height) continue;
      if (blocked.has(`${x},${y}`)) continue;

      const index = y * route.width + x;
      if (seen[index] || !walkable(route.tiles[index])) continue;
      seen[index] = 1;
      queue.push({ x, y });
    }
  }

  return seen;
}

function reachableCount(route: Route, blocked: Set<string>): number {
  const seen = reachedFrom(route, blocked);
  let reached = 0;
  for (let at = 0; at < seen.length; at++) reached += seen[at];

  return reached;
}

/**
 * Whether standing here would cut the map in two.
 *
 * People are solid: walking into one starts a conversation rather than a step.
 * That is fine in the open and disastrous in a doorway, and three of the town
 * roster once landed squarely on the crossroads and walled off three of the
 * four ways out. Rather than hand-place around it — which lasts until the next
 * change to the town — every candidate is checked by walking the map without
 * it.
 *
 * Against a *baseline* rather than against the number of walkable tiles.
 * Furniture can strand a pocket of floor behind a bookcase and a gym hall can
 * strand a corner of a route, so "reachable" and "walkable" are not the same
 * number to begin with; comparing to the wrong one rejected every tile in a
 * room and left a gym leader with nowhere to stand.
 */
function wouldSever(route: Route, at: { x: number; y: number }, others: Set<string>, baseline: number): boolean {
  const blocked = new Set(others);
  blocked.add(`${at.x},${at.y}`);
  return reachableCount(route, blocked) < baseline - 1;
}

/**
 * The nearest tile somebody could actually stand on.
 *
 * Roster positions are hints: a route is carved differently on every seed, and
 * a hard coordinate would put half the cast inside a tree. This spirals out
 * from the spot asked for until it finds open ground that is not tall grass
 * and not already spoken for.
 */
function nearestSpot(
  route: Route,
  wish: { x: number; y: number },
  taken: Set<string>,
): { x: number; y: number } | null {
  // What is reachable before anybody stands anywhere new. Computed once per
  // person rather than per tile considered.
  const solid = new Set(taken);
  for (const prop of route.props) {
    if (!PROPS[prop.kind].walkable) solid.add(`${prop.x},${prop.y}`);
  }
  const reached = reachedFrom(route, solid);
  let baseline = 0;
  for (let at = 0; at < reached.length; at++) baseline += reached[at];

  // Bounded: a spiral that can cross a whole 88x68 route is a spiral that
  // will, on the one seed where the first thousand tiles all fail.
  for (let radius = 0; radius < SEARCH_RADIUS; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;

        const x = wish.x + dx;
        const y = wish.y + dy;
        if (x < 1 || y < 1 || x >= route.width - 1 || y >= route.height - 1) continue;
        if (taken.has(`${x},${y}`)) continue;

        const tile = route.tiles[y * route.width + x];
        if (!walkable(tile) || hidesEncounters(tile)) continue;
        // Somewhere you can actually get to on foot. `wouldSever` below asks
        // whether standing here *breaks* the route; this asks whether you could
        // ever have arrived, which is a different question and was not being
        // asked at all. A Quarryman ended up in a pocket of the slag behind a
        // boulder, with a gift for anybody who had already earned the badge
        // that would let them reach him.
        if (reached[y * route.width + x] !== 1) continue;
        if (propBlocks(route, x, y)) continue;
        if (route.doors.some((door) => door.x === x && door.y === y)) continue;
        if (route.borders.some((border) => border.x === x && border.y === y)) continue;
        if (x === route.entry.x && y === route.entry.y) continue;
        // Cheap first, and only cheap: two ways off a tile is enough to be
        // walked around in a two-wide corridor, which is what the outer
        // pinewood rings are made of. Asking for three left three of the cast
        // with nowhere to stand at all. The real guarantee is the walk below.
        const ways = [
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
        ].filter(
          ([dx, dy]) =>
            walkable(route.tiles[(y + dy) * route.width + (x + dx)]) &&
            !propBlocks(route, x + dx, y + dy),
        ).length;
        if (ways < 2) continue;

        if (wouldSever(route, { x, y }, solid, baseline)) continue;

        return { x, y };
      }
    }
  }
  return null;
}

/**
 * How far into a zone somebody standing "on a ring" is put.
 *
 * They all used to wish for the route's entry tile, which put every one of
 * them within a step of the door — an Angler you meet before you have seen the
 * water, a Cartographer waiting at the gate to tell you about the far rings.
 * Somebody out on a route should be *found*.
 */
const HIDDEN_FROM_ENTRY = 30;

/** A seeded spot well away from the way in, or the entry if there is none. */
function hiddenSpot(rng: Rng, route: Route): { x: number; y: number } {
  const far: { x: number; y: number }[] = [];
  let best = route.entry;
  let bestAway = -1;

  for (let y = 1; y < route.height - 1; y++) {
    for (let x = 1; x < route.width - 1; x++) {
      const tile = route.tiles[y * route.width + x];
      if (!walkable(tile) || hidesEncounters(tile)) continue;

      const away = Math.abs(x - route.entry.x) + Math.abs(y - route.entry.y);
      if (away > bestAway) {
        bestAway = away;
        best = { x, y };
      }
      if (away >= HIDDEN_FROM_ENTRY) far.push({ x, y });
    }
  }

  // The furthest tile there is, when the whole route is smaller than the
  // distance asked for — better than silently falling back to the doorstep.
  if (!far.length) return best;
  return far[intBetween(rng, 0, far.length - 1)];
}

/** Puts the roster on the map, each as near their spot as the ground allows. */
function placeNpcs(seed: string, routes: Map<string, Route>): Map<string, NpcSpec[]> {
  const placed = new Map<string, NpcSpec[]>();
  const taken = new Map<string, Set<string>>();
  const houses = [...routes.values()].filter((route) => route.role === "house");

  const roster: NpcPlacement[] = [
    ...NPCS,
    ...GYMS.map(
      (spec): NpcPlacement => ({
        id: `leader-${spec.id}`,
        name: spec.leader,
        kind: "gym",
        gymId: spec.id,
        lines: spec.lines,
        where: { at: "gym", gymId: spec.id },
      }),
    ),
    // Six people running brackets out of a field, one per format. Expanded
    // from `arenas.ts` the way the gym leaders are expanded from `gyms.ts`:
    // the spec is the address and the difficulty, and the person standing at
    // it is derived rather than written down twice.
    ...ARENAS.map(
      (spec): NpcPlacement => ({
        id: `host-${spec.id}`,
        name: spec.name,
        kind: "arena",
        arenaId: spec.id,
        lines: spec.lines,
        where: { at: "route", biome: spec.biome, nth: spec.nth },
      }),
    ),
  ];

  /**
   * One of the roster, expanded to one of them in every building of the kind.
   *
   * Only for the people marked `staff`, which is the nurse and the shopkeeper.
   * With one town this did nothing; with four it is the difference between
   * three Centers you can heal at and three rooms with a bed in them.
   *
   * The first keeps its plain id, so `nurse` is still the nurse in Hearth and
   * a save that remembers talking to her still does. The rest are named after
   * the town they stand in.
   */
  const staffed: NpcPlacement[] = roster.flatMap((entry) => {
    if (entry.where.at !== "interior" || !entry.where.staff) return [entry];
    const where = entry.where;

    const rooms = [...routes.values()].filter((route) => route.role === where.role);
    return rooms.map((room, index) => ({
      ...entry,
      id: index === 0 ? entry.id : `${entry.id}@${room.parent ?? room.id}`,
      where: { ...where, roomId: room.id },
    }));
  });

  /**
   * The Grey Line, expanded to one post per kind of place.
   *
   * Twenty-four of them: the nearest copy of each of the twenty biomes, and
   * each of the four towns.
   *
   * The *nearest* copy rather than an arbitrary one, and that does the
   * spreading for free. A biome's tier decides both how many copies it has and
   * roughly how far out it sits — four meadows near home, one Crystal Vault a
   * long way past them — so "the first of each" is already a set of stops
   * running from the doorstep to the edge of the map. Picking a copy at random
   * would have bunched them.
   *
   * The towns are in it because a travel network that cannot reach a town is a
   * network that skips the only places worth travelling *to*. The other roads
   * home — an Escape Rope, Teleport — both go to Hearth or the last Center you
   * used, which is not the same as being able to name the town you meant.
   */
  const posted: NpcPlacement[] = staffed.flatMap((entry) => {
    if (entry.where.at !== "station") return [entry];
    const where = entry.where;

    const stops = [
      ...BIOME_IDS.map((biome) => routeId(biome, 1)),
      ...TOWNS.map((town) => town.id),
    ].filter((id) => routes.has(id));

    return stops.map((id) => ({
      ...entry,
      id: `${entry.id}@${id}`,
      where: { ...where, routeId: id },
    }));
  });

  for (const entry of posted) {
    const target = (() => {
      switch (entry.where.at) {
        case "town":
          return {
            route: routes.get(entry.where.town ?? HUB_ID),
            wish: { x: entry.where.x, y: entry.where.y },
          };
        case "interior": {
          const role = entry.where.role;
          const town = entry.where.town;
          const room = entry.where.roomId
            ? routes.get(entry.where.roomId)
            : town
              ? [...routes.values()].find(
                  (route) => route.role === role && route.parent === town,
                )
              : role === "house"
                ? houses[(entry.where.index ?? 0) % Math.max(1, houses.length)]
                : [...routes.values()].find((route) => route.role === role);
          return room ? { route: room, wish: { x: Math.floor(room.width / 2), y: 3 } } : null;
        }
        case "route": {
          const route = routes.get(routeId(entry.where.biome, entry.where.nth));
          if (!route) return null;
          return { route, wish: hiddenSpot(rngFor(seed, "npcSpot", entry.id), route) };
        }
        case "station": {
          // At the entry, not hidden away like everybody else out on a route.
          // Both halves of that matter: it is the tile you arrive on, so
          // getting off one coach leaves you beside the next, and it is the
          // tile you walk in on, so the post is the first thing you meet
          // rather than something you find on the way back.
          const route = entry.where.routeId ? routes.get(entry.where.routeId) : undefined;
          return route ? { route, wish: route.entry } : null;
        }
        case "cabin": {
          const outside = routes.get(routeId(entry.where.biome, entry.where.nth));
          const inside = routes.get(`${routeId(entry.where.biome, entry.where.nth)}:cabin`);
          // A cabin grows on about three routes in five, so the one asked for
          // is sometimes not there. The person still is: they wait outside
          // instead, the same way a gym leader whose hall could not be built
          // stands on the route. Somebody the seed can delete is not somebody.
          if (inside) return { route: inside, wish: { x: Math.floor(inside.width / 2), y: 3 } };
          return outside ? { route: outside, wish: hiddenSpot(rngFor(seed, "npcSpot", entry.id), outside) } : null;
        }
        case "cup": {
          const house = routes.get(`${routeId(CUP_BIOME, CUP_NTH)}:cup`);
          if (house) {
            // The Steward keeps the door and the five stand across the back of
            // the room, so the first person you meet is the one who explains
            // what the room is. Wishing all six at the middle of it put them in
            // a huddle you could talk to in any order, which reads as six
            // people who happen to be standing there.
            const slot = CUP_IDS.indexOf(entry.id);
            return {
              route: house,
              wish:
                slot < 0
                  ? { x: Math.floor(house.width / 2), y: house.height - 4 }
                  : { x: 2 + slot * 2, y: 2 },
            };
          }
          // The house is not optional — buildRoute tries every room on that
          // one route for it — but the same fallback as a gym is kept rather
          // than a throw. Six people standing on the route outside is a bad
          // afternoon; six people who do not exist is a quest with no end.
          const outside = routes.get(routeId(CUP_BIOME, CUP_NTH));
          return outside ? { route: outside, wish: hiddenSpot(rngFor(seed, "npcSpot", entry.id), outside) } : null;
        }
        case "gym": {
          const spec = gym(entry.where.gymId);
          const hall = routes.get(`${routeId(spec.biome, spec.nth)}:gym`);
          // A hall that could not be built leaves its leader standing on the
          // route instead: eight gyms is a promise, and a generator that
          // sometimes cannot find room for a door does not get to break it.
          if (hall) return { route: hall, wish: { x: Math.floor(hall.width / 2), y: 3 } };
          const outside = routes.get(routeId(spec.biome, spec.nth));
          return outside ? { route: outside, wish: outside.entry } : null;
        }
      }
    })();

    if (!target?.route) continue;
    const route = target.route;

    const used = taken.get(route.id) ?? new Set<string>();
    const spot = nearestSpot(route, target.wish, used);
    if (!spot) continue;

    used.add(`${spot.x},${spot.y}`);
    taken.set(route.id, used);

    // `where` was a hint for placement; what goes on the map is a position.
    const rest = { ...entry, where: undefined };
    delete (rest as { where?: unknown }).where;
    placed.set(route.id, [
      ...(placed.get(route.id) ?? []),
      { ...rest, route: route.id, x: spot.x, y: spot.y },
    ]);
  }

  return placed;
}

/**
 * A machine, rather than any one machine.
 *
 * The table names item ids, and there are three hundred machines — listing
 * them all here would drown everything else in it. This stands for "one of
 * them", and which one is decided by the route, below.
 */
const ANY_MACHINE = "*machine";

/**
 * A stone nobody stocks, rather than any one of them.
 *
 * Ten of the twenty-two stones open more than one door and are on the Mart
 * shelf; the other twelve open exactly one, and a shop row for "the thing that
 * turns a Poltchageist into a Sinistcha" is a row nobody reads. Those are
 * found. Which means they are the only way those twelve species can ever
 * change, so they had to come from somewhere — an item evolution with no
 * item in the world is a species with a locked door and no key cut.
 */
const ANY_STONE = "*stone";

/**
 * A berry, rather than any one berry.
 *
 * Thirty-odd of them, and most are worth nothing at a counter, so the floor is
 * where they belong: a berry is the sort of thing you find in long grass, and
 * a shop row for each of eighteen resist berries is eighteen rows nobody
 * reads. The priced ones are on the shelf as well.
 */
const ANY_BERRY = "*berry";

/**
 * Which machines this far out may hold.
 *
 * The list is ranked by the power of what it teaches, and a route may hold
 * anything in the first `ring/rings` of it. So the first ring turns up status
 * moves and small attacks, and Hyper Beam is only ever lying about at the far
 * end of the world. Distance is the only currency this game has for "better",
 * and it is the one the census and the breeding items already spend.
 *
 * Exported so a test can ask the same question the generator asked, rather
 * than restating the arithmetic beside it and drifting.
 */
export function machinesUpTo(ring: number, rings: number): readonly string[] {
  const reach = Math.max(1, Math.ceil((MACHINE_ITEMS.length * ring) / Math.max(1, rings)));
  return MACHINE_ITEMS.slice(0, reach).map((entry) => entry.id);
}

/** What is lying about out there, and roughly how good it is. */
const PICKUP_TABLE: readonly { item: string; weight: number }[] = [
  { item: "pokeball", weight: 30 },
  { item: "potion", weight: 24 },
  { item: "greatball", weight: 12 },
  { item: "superpotion", weight: 12 },
  { item: "fullheal", weight: 8 },
  { item: "pearl", weight: 6 },
  { item: "revive", weight: 4 },
  { item: "hyperpotion", weight: 3 },
  { item: "ultraball", weight: 2 },
  { item: "lure-shiny", weight: 2 },
  { item: ANY_MACHINE, weight: 12 },
  { item: ANY_STONE, weight: 4 },
  { item: ANY_BERRY, weight: 10 },
  { item: "heartscale", weight: 4 },
  { item: "repel", weight: 4 },
  { item: "nugget", weight: 1 },
  // Somebody is stealing these from the whole world, and you keep finding
  // them. The recurrence is the joke, so the weight is high on purpose — and
  // it is what makes the gnomes' errand a job you can actually finish rather
  // than a token that only exists because a quest asked for one.
  { item: "gnomepants", weight: 8 },
];

/**
 * The stones worth finding, in a stable order.
 *
 * The specialists: the ones that open exactly one door. Defined by how many
 * doors rather than by price, which is the mistake this replaced — it read
 * `price === 0`, every stone was then given a price, and the list silently
 * became empty, so the drop table resolved this family to `undefined` and the
 * world scattered items that did not exist. Door count is a fact about the
 * bestiary; a price is a decision somebody can change on a whim.
 */
/** Every berry, in a stable order. */
const FOUND_BERRIES: readonly string[] = ITEMS.filter((spec) => spec.kind === "berry")
  .map((spec) => spec.id)
  .sort();

const FOUND_STONES: readonly string[] = ITEMS.filter((spec) => {
  if (!spec.evolves) return false;
  const doors = ALL_SPECIES.filter((entry) =>
    entry.evolvesTo.some((step) => step.method === "useItem" && step.item === spec.name),
  ).length;
  return doors === 1;
})
  .map((spec) => spec.id)
  .sort();

/**
 * Items on the floor, placed once when the world is made.
 *
 * Placed rather than rolled, like everything else: the same seed leaves the
 * same things in the same corners, so finding one is exploration and not luck.
 * Deliberately biased into the dead ends — a maze whose only reward for taking
 * the wrong turn is walking back is a maze nobody explores twice.
 */
function placePickups(
  seed: string,
  routes: Map<string, Route>,
  npcs: Map<string, NpcSpec[]>,
  rings: number,
): Map<string, PickupSpec[]> {
  const placed = new Map<string, PickupSpec[]>();

  for (const route of routes.values()) {
    if (route.kind !== "route") continue;

    const rng = rngFor(seed, "pickups", route.id);
    const busy = new Set((npcs.get(route.id) ?? []).map((who) => `${who.x},${who.y}`));

    // Somewhere open, and out of the way: a tile with only one walkable
    // neighbour is the end of a dead end, which is exactly where a reward for
    // going the wrong way belongs.
    const corners: { x: number; y: number }[] = [];
    for (let y = 2; y < route.height - 2; y++) {
      for (let x = 2; x < route.width - 2; x++) {
        const tile = route.tiles[y * route.width + x];
        if (!walkable(tile) || hidesEncounters(tile)) continue;
        if (busy.has(`${x},${y}`)) continue;

        const open = [
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
        ].filter(([dx, dy]) => walkable(route.tiles[(y + dy) * route.width + (x + dx)])).length;
        if (open <= 2) corners.push({ x, y });
      }
    }
    if (!corners.length) continue;

    const count = 3 + intBelow(rng, 3);
    const chosen = shuffle(rng, corners).slice(0, count);

    placed.set(
      route.id,
      chosen.map((at, index) => {
        const rolled = weighted(rng, PICKUP_TABLE, (row) => row.weight).item;

        // The two sentinels stand for a family rather than a thing. Machines
        // are gated by distance, because the list is ranked by what it teaches
        // and Hyper Beam belongs at the far end of the world; the odd stones
        // are not, because there is no ranking to gate them by — a Cracked
        // Pot is not a better item than a Sweet Apple, it is a different door.
        const family =
          rolled === ANY_MACHINE
            ? machinesUpTo(route.ring, rings)
            : rolled === ANY_STONE
              ? FOUND_STONES
              : rolled === ANY_BERRY
                ? FOUND_BERRIES
                : null;

        // An empty family would resolve to `undefined` and scatter items that
        // do not exist, which is what happened the first time this shipped.
        // Falling back to the roll itself keeps the world well-formed even if
        // a family is emptied by a change somewhere else entirely.
        const drawn = family?.length ? family[intBelow(rng, family.length)] : null;

        return {
          id: `${route.id}:${index}`,
          x: at.x,
          y: at.y,
          item: drawn ?? (family ? "pokeball" : rolled),
        };
      }),
    );
  }

  return placed;
}

/**
 * One ink in each of the first seven cabins, so all seven colours exist.
 *
 * Scattered rather than placed by hand, and *guaranteed* rather than rolled:
 * a colour the seed happened not to deal would be a door in the printer that
 * no playthrough could ever open, and the printer's whole shape is that the
 * colours arrive one at a time as you get further out.
 *
 * Cabins in distance order, so the near ones hold the first inks and the far
 * ones the last — which makes the printer's list fill up as the world does.
 * A world with fewer than seven cabins simply holds fewer inks; the ones it
 * does hold are still the nearest ones, and the printer still says what it is
 * missing.
 */
function placeInks(
  seed: string,
  routes: Map<string, Route>,
  pickups: Map<string, PickupSpec[]>,
): Map<string, PickupSpec[]> {
  const cabins = [...routes.values()]
    .filter((route) => route.kind === "interior" && route.id.endsWith(":cabin"))
    // By the ring of the route the cabin belongs to, then by id, so the order
    // is the world's rather than the map's insertion order.
    .sort((a, b) => {
      const ringA = routes.get(a.parent ?? "")?.ring ?? 0;
      const ringB = routes.get(b.parent ?? "")?.ring ?? 0;
      return ringA - ringB || a.id.localeCompare(b.id);
    });

  const inks = INKS.map((one) => one.id);
  const next = new Map(pickups);

  for (let at = 0; at < Math.min(inks.length, cabins.length); at++) {
    const cabin = cabins[at];
    const rng = rngFor(seed, "ink", cabin.id);

    // Anywhere walkable that is not the way out. A cabin is one small room, so
    // this is a handful of tiles and the ink is never hard to *see* — the
    // finding is in opening the cabin at all.
    const open: { x: number; y: number }[] = [];
    for (let y = 1; y < cabin.height - 1; y++) {
      for (let x = 1; x < cabin.width - 1; x++) {
        if (!walkable(cabin.tiles[y * cabin.width + x])) continue;
        if (x === cabin.entry.x && y === cabin.entry.y) continue;
        if (cabin.doors.some((door) => door.x === x && door.y === y)) continue;
        if (propBlocks(cabin, x, y)) continue;
        open.push({ x, y });
      }
    }
    if (!open.length) continue;

    const spot = open[intBelow(rng, open.length)];
    next.set(cabin.id, [
      ...(next.get(cabin.id) ?? []),
      { id: `${cabin.id}:ink`, x: spot.x, y: spot.y, item: inks[at] },
    ]);
  }

  return next;
}

/** The walkable tile just inside a border gate. */
function insideOf(
  gate: { x: number; y: number },
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: gate.x === 0 ? 1 : gate.x === width - 1 ? width - 2 : gate.x,
    y: gate.y === 0 ? 1 : gate.y === height - 1 ? height - 2 : gate.y,
  };
}

/** The room behind a door. Small, plain, and one way out. */
function buildInterior(
  id: string,
  parent: string,
  role: InteriorRole,
  label: string,
  back: { x: number; y: number },
  rng?: Rng,
): Route {
  const grid = new Grid(ROOM_WIDTH, ROOM_HEIGHT, TILE.FLOOR);
  grid.rect(0, 0, ROOM_WIDTH, 1, TILE.WALL);
  grid.rect(0, ROOM_HEIGHT - 1, ROOM_WIDTH, 1, TILE.WALL);
  grid.rect(0, 0, 1, ROOM_HEIGHT, TILE.WALL);
  grid.rect(ROOM_WIDTH - 1, 0, 1, ROOM_HEIGHT, TILE.WALL);

  const exitX = Math.floor(ROOM_WIDTH / 2);
  grid.set(exitX, ROOM_HEIGHT - 1, TILE.EXIT);

  // The way out, and the tile in front of it, stay clear: a bookcase across
  // the door would be a room you can enter and not leave.
  const props = rng
    ? furnish(rng, ROOM_WIDTH, ROOM_HEIGHT, role, [
        { x: exitX, y: ROOM_HEIGHT - 1 },
        { x: exitX, y: ROOM_HEIGHT - 2 },
        { x: exitX, y: ROOM_HEIGHT - 3 },
      ])
    : [];

  return {
    id,
    kind: "interior",
    biome: "indoors",
    // A room behind a door is not anywhere on the lattice: no hops, no copy
    // number, no walls with neighbours behind them. Zeroes rather than
    // optional fields, so nothing downstream has to ask whether a route has
    // a distance.
    ring: 0,
    depth: 0,
    nth: 0,
    cell: { x: 0, y: 0 },
    gates: [],
    width: ROOM_WIDTH,
    height: ROOM_HEIGHT,
    tiles: grid.tiles,
    entry: { x: exitX, y: ROOM_HEIGHT - 2 },
    doors: [{ x: exitX, y: ROOM_HEIGHT - 1, to: parent, at: back }],
    props,
    borders: [],
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
 * The four ways out of town: one gap in the middle of each wall.
 *
 * Twenty gaps, once, five to a wall, because twenty arms hung off the town.
 * The town is one cell of the lattice now, so it has four neighbours at most
 * and each of them lies in a compass direction — which means the gap is the
 * middle of that wall, where the crossroads already runs to.
 *
 * Exported because two places need to agree about them: the generator that
 * cuts the gaps, and the movement code that decides where you reappear when
 * you walk back in. They did not agree — every return from ring one arrived
 * at the western gap, whichever arm you had come from, so leaving east and
 * coming back put you on the far side of town.
 */
export function townExits(width: number, height: number): Record<Bearing, { x: number; y: number }> {
  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);

  return {
    n: { x: midX, y: 0 },
    e: { x: width - 1, y: midY },
    s: { x: midX, y: height - 1 },
    w: { x: 0, y: midY },
  };
}

/** The tile just inside one of those gaps — where you stand on arrival. */
export function townArrival(
  width: number,
  height: number,
  wall: Bearing,
): { x: number; y: number } {
  const exit = townExits(width, height)[wall];
  return {
    x: exit.x === 0 ? 1 : exit.x === width - 1 ? width - 2 : exit.x,
    y: exit.y === 0 ? 1 : exit.y === height - 1 ? height - 2 : exit.y,
  };
}

/**
 * A town, laid out by hand rather than generated.
 *
 * It is the first thing anybody sees and its buildings have jobs, so a die has
 * no business in it. What varies between the four is the name, which cell it
 * sits in, how far out it is, which of its four walls has a road through it,
 * and which buildings it keeps.
 */
function buildTown(node: PlanNode, spec: (typeof TOWNS)[number]): {
  town: Route;
  interiors: Route[];
} {
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
  // The four corners of the crossroads, and which building stands in which.
  // A town with three buildings leaves one corner to the garden.
  const corners: Record<InteriorRole, { x: number; y: number; label: string }> = {
    daycare: { x: 5, y: midY - 9, label: "Daycare" },
    centre: { x: 24, y: midY - 9, label: "Poké Center" },
    mart: { x: 7, y: midY + 4, label: "Mart" },
    // Hearth's house is the trainer school: four people, one idea each. The
    // other towns keep a house, because a school in every town would be the
    // same four people four times.
    house: { x: 26, y: midY + 4, label: spec.id === HUB_ID ? SCHOOL_LABEL : "A house" },
    gym: { x: 5, y: midY - 9, label: "Gym" },
    cup: { x: 5, y: midY - 9, label: CUP_LABEL },
  };

  const plots = spec.roles.map((role) => ({ role, ...corners[role] }));

  for (const plot of plots) {
    const door = building(grid, plot.x, plot.y, 6, 5, [TILE.MEADOW, TILE.FLOWER]);
    if (!door) continue;

    const id = `${spec.id}:${plot.role}${plot.x}`;
    const back = { x: door.x, y: door.y + 1 };
    const inside = buildInterior(id, spec.id, plot.role, plot.label, back, rngFor("furnish", id));
    doors.push({ x: door.x, y: door.y, to: id, at: inside.entry });
    // What the sign says is the building's job, not its name: "Daycare" is
    // useful from across the square, "A house" is at least honest.
    if (door.sign) {
      signs.push({
        ...door.sign,
        text: plot.role === "house" && spec.id === HUB_ID ? "School" : SIGN_TEXT[plot.role],
      });
    }
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

  // Every way out, from the one table that also decides where walking back in
  // puts you — and a road inward from each, so a gap in the wall reads as
  // somewhere a road goes rather than a hole.
  //
  // Only the walls that have somewhere on the other side of them. Cutting all
  // four regardless left up to three gaps that went nowhere: a hole in the
  // trees you could stand in, with nothing beyond it.
  const ways = node.links.map((link) => link.bearing);
  const gaps = townExits(TOWN_WIDTH, TOWN_HEIGHT);

  for (const exit of ways.map((bearing) => gaps[bearing])) {
    grid.set(exit.x, exit.y, TILE.PATH);

    const inward =
      exit.x === 0 ? [1, 0] : exit.x === TOWN_WIDTH - 1 ? [-1, 0] : exit.y === 0 ? [0, 1] : [0, -1];

    let x = exit.x + inward[0];
    let y = exit.y + inward[1];
    for (let step = 0; step < Math.max(TOWN_WIDTH, TOWN_HEIGHT); step++) {
      if (!grid.inside(x, y) || grid.get(x, y) !== TILE.MEADOW) break;
      grid.set(x, y, TILE.PATH);
      x += inward[0];
      y += inward[1];
    }
  }

  return {
    town: {
      id: spec.id,
      kind: "town",
      biome: "hearth",
      // A town is never graded: nothing lives in it and nothing fights you in
      // it, so there is no curve for it to sit on. How far out it is, is
      // `depth`, and that is a real number even for a town three hops from
      // anywhere.
      ring: 0,
      depth: node.depth,
      nth: 0,
      cell: { ...node.cell },
      width: TOWN_WIDTH,
      height: TOWN_HEIGHT,
      tiles: grid.tiles,
      entry: { x: midX, y: midY },
      doors,
      signs,
      props: [],
      gates: ways.map((bearing) => ({ bearing, ...gaps[bearing] })),
      borders: [],
      label: spec.name,
    },
    interiors,
  };
}


/**
 * The loop a roamer walks.
 *
 * A ring of waypoints joined by shortest paths through open ground, and then
 * the last joined back to the first — which is the step that makes it a loop
 * rather than a there-and-back, and the step that makes the whole mechanic
 * work: chasing a roamer round its own loop never catches it, and walking the
 * loop the other way meets it head on.
 *
 * Built tile by tile at generation, never at runtime. Two reasons. A path
 * recomputed while walking would need the maze solved on every step, and more
 * importantly the loop has to be *the same loop* on every machine and every
 * reload, because a roamer's position is derived from how many steps you have
 * taken along it. A path that differed by one tile would put the creature
 * somewhere else entirely fifty steps later.
 *
 * Returns null when the route will not take one — a maze with no room for a
 * ring of this size, most often. A roamer with no loop simply stands still,
 * which is a worse creature but not a broken one.
 */
function roamPath(
  route: Route,
  rng: Rng,
  centre: { x: number; y: number },
  radius: number,
  free: (x: number, y: number) => boolean,
): { x: number; y: number }[] | null {
  const open = (x: number, y: number) => {
    // Around anybody already standing there. A loop that ran through a trainer
    // would be a loop the player cannot walk, and the chase is the whole point
    // of the loop.
    if (!free(x, y)) return false;
    if (x < 1 || y < 1 || x >= route.width - 1 || y >= route.height - 1) return false;
    const tile = route.tiles[y * route.width + x];
    if (!walkable(tile)) return false;
    if (propBlocks(route, x, y)) return false;
    // Never through a door or a border: a loop that crossed one would walk the
    // creature off the map, and the map is where it lives.
    if (route.doors.some((door) => door.x === x && door.y === y)) return false;
    if (route.borders.some((border) => border.x === x && border.y === y)) return false;
    return true;
  };

  // Eight waypoints on the ring, each snapped to the nearest open tile. Eight
  // rather than four because four corners joined by shortest paths is a
  // diamond that cuts straight through the middle, which is not a loop you can
  // get behind.
  const SPOKES = 8;
  const waypoints: { x: number; y: number }[] = [];

  for (let spoke = 0; spoke < SPOKES; spoke++) {
    // Integer trigonometry, from a table, so nothing here depends on Math.sin
    // agreeing to the last bit across engines.
    const [dx, dy] = RING_STEPS[spoke];
    const wish = {
      x: centre.x + Math.round((dx * radius) / 100),
      y: centre.y + Math.round((dy * radius) / 100),
    };

    const found = nearestOpen(wish, open, route);
    if (!found) return null;
    // Two spokes snapping to one tile is a loop with a pinch in it, which is
    // fine, but an empty stretch is not: skip the duplicate.
    if (!waypoints.some((at) => at.x === found.x && at.y === found.y)) waypoints.push(found);
  }

  if (waypoints.length < 4) return null;

  // Join them up, and the last back to the first.
  const loop: { x: number; y: number }[] = [];
  for (let at = 0; at < waypoints.length; at++) {
    const leg = shortestWalk(route, open, waypoints[at], waypoints[(at + 1) % waypoints.length]);
    if (!leg) return null;
    // The leg includes both ends; drop the first so the joins do not double up.
    for (const step of leg.slice(1)) loop.push(step);
  }

  // A loop has to be long enough to be a chase rather than a shuffle, and it
  // has to actually close.
  if (loop.length < 24) return null;
  const first = loop[loop.length - 1];
  const start = waypoints[0];
  if (first.x !== start.x || first.y !== start.y) return null;

  // Rotated by the seed, so two roamers on one route do not start in step and
  // the same route does not always begin at the same corner.
  const offset = intBelow(rng, loop.length);
  return [...loop.slice(offset), ...loop.slice(0, offset)];
}

/**
 * Eight compass points, times a hundred.
 *
 * A table rather than trigonometry: `Math.cos` is not specified to the last
 * bit and this decides where a creature stands for the life of a save.
 */
/**
 * The longest loop worth walking.
 *
 * Half a loop is roughly how far you walk to meet a roamer head on, so this is
 * a hundred and fifty moves at the outside. Loops are generated by joining a
 * ring of waypoints through a maze, and a maze can turn a circle of radius
 * sixteen into a six-hundred-tile ramble — which is a tour, not a circuit.
 */
const ROAM_LOOP_MAX = 300;

const RING_STEPS: readonly (readonly [number, number])[] = [
  [100, 0],
  [71, 71],
  [0, 100],
  [-71, 71],
  [-100, 0],
  [-71, -71],
  [0, -100],
  [71, -71],
];

/** The open tile nearest a wish, spiralling out. */
function nearestOpen(
  wish: { x: number; y: number },
  open: (x: number, y: number) => boolean,
  route: Route,
): { x: number; y: number } | null {
  for (let radius = 0; radius < Math.max(route.width, route.height); radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = wish.x + dx;
        const y = wish.y + dy;
        if (open(x, y)) return { x, y };
      }
    }
  }
  return null;
}

/** Shortest walk between two open tiles, both ends included, or null. */
function shortestWalk(
  route: Route,
  open: (x: number, y: number) => boolean,
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number }[] | null {
  if (from.x === to.x && from.y === to.y) return [from];

  const width = route.width;
  const came = new Int32Array(width * route.height).fill(-1);
  const start = from.y * width + from.x;
  const goal = to.y * width + to.x;
  came[start] = start;

  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    if (at === goal) break;

    const x = at % width;
    const y = (at - x) / width;
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (!open(nx, ny)) continue;
      const next = ny * width + nx;
      if (came[next] !== -1) continue;
      came[next] = at;
      queue.push(next);
    }
  }

  if (came[goal] === -1) return null;

  const walk: { x: number; y: number }[] = [];
  for (let at = goal; ; at = came[at]) {
    walk.push({ x: at % width, y: (at - (at % width)) / width });
    if (at === start) break;
  }
  return walk.reverse();
}

/**
 * The creatures standing about, per route.
 *
 * Three sources, in the order they claim ground: the authored ones (the
 * roamers and the gifts), then the generated idlers drawn from the route's own
 * encounter table, then nothing. Authored first because those are promises —
 * a creature written to be circling the ashflats has to be circling the
 * ashflats.
 */
/**
 * A line for a generated creature that nothing else on this route is doing.
 *
 * The pool for a type holds three, so it tries each in turn from a seeded
 * start and takes the first nobody has used here. A route holds at most three
 * generated creatures, so there is always one left — and if there somehow is
 * not, a repeat is better than nothing.
 */
function freshLine(
  said: Map<string, Set<string>>,
  routeId: string,
  speciesId: string,
  rng: Rng,
): string {
  const spec = speciesById(speciesId);
  const here = said.get(routeId) ?? new Set<string>();
  const from = intBelow(rng, 64);

  for (let tried = 0; tried < 16; tried++) {
    const line = idleLine(spec.name, spec.types, from + tried);
    if (!here.has(line)) return line;
  }
  return idleLine(spec.name, spec.types, from);
}

function placeCritters(
  seed: string,
  routes: Map<string, Route>,
  npcs: Map<string, NpcSpec[]>,
  trainers: Map<string, TrainerSpec[]>,
  allSpecies: readonly SpeciesEntry[],
  rings: number,
): Map<string, CritterSpec[]> {
  const placed = new Map<string, CritterSpec[]>();

  // Nothing stands where somebody already is, so the map never has two things
  // on one tile and walking into one is never ambiguous.
  const busy = new Map<string, Set<string>>();
  const claim = (routeId: string, x: number, y: number) => {
    const here = busy.get(routeId) ?? new Set<string>();
    here.add(`${x},${y}`);
    busy.set(routeId, here);
  };
  const taken = (routeId: string, x: number, y: number) =>
    busy.get(routeId)?.has(`${x},${y}`) ?? false;

  for (const [routeId, here] of npcs) for (const who of here) claim(routeId, who.x, who.y);
  for (const [routeId, here] of trainers) for (const who of here) claim(routeId, who.x, who.y);

  /**
   * What has already been said on each route, so nothing is said twice there.
   *
   * Per route rather than per world: three idlers on one map drawing from a
   * pool of three will collide often enough to notice, and two creatures a
   * continent apart doing the same thing is not a repeat anybody experiences.
   */
  const said = new Map<string, Set<string>>();

  const add = (routeId: string, spec: CritterSpec) => {
    const here = said.get(routeId) ?? new Set<string>();
    here.add(spec.line);
    said.set(routeId, here);
    placed.set(routeId, [...(placed.get(routeId) ?? []), spec]);
  };

  /**
   * Somewhere to stand, through the same routine the people use.
   *
   * `nearestSpot` is not just "an open tile near here": it refuses any tile
   * with fewer than two ways off it and any tile whose occupant would cut the
   * map in two. Placing critters with a weaker test — which the first cut
   * did — put six of them around the middle of town, one of them across the
   * only way out, and every walking fixture in the test suite got stuck in
   * Hearth. Nine tests failed and all nine said the same thing: "expected
   * 'town' to be 'route'".
   *
   * A creature standing in a doorway is exactly as bad as a person standing
   * in one, so it goes through exactly the same door.
   */
  const spotFor = (route: Route, wish: { x: number; y: number }) =>
    nearestSpot(route, wish, busy.get(route.id) ?? new Set<string>());

  // ------------------------------------------------------------- authored
  for (const entry of CRITTERS) {
    const route =
      entry.where.at === "town"
        ? routes.get(entry.where.town ?? HUB_ID)
        : routes.get(routeId(entry.where.biome, entry.where.nth));
    if (!route) continue;

    const rng = rngFor(seed, "critter", entry.id);
    // Left bare exactly as `wildAt` leaves one: no moves, no health, and a
    // uid of zero. The engine runs it through `withMoves` and `atFullHealth`
    // at the moment it is needed, which is the one place that knows the stat
    // table — and means a creature standing about and a creature met in the
    // grass are built by the same rule rather than by two.
    const built: Individual = {
      pp: [],
      abilities: rollAbilities(rng),
      uid: 0,
      speciesId: entry.speciesId,
      level: entry.level,
      exp: entry.level * entry.level * entry.level,
      ivs: rolledIvs(rng),
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      natureId: NATURE_IDS[intBelow(rng, NATURE_IDS.length)],
      variantId: entry.variantId ?? "normal",
      hp: 0,
      status: null,
      sleepTurns: 0,
      moves: [],
      heldItem: null,
      nickname: null,
      traded: false,
      prize: false,
      cheat: false,
      parents: null,
      gender: rollGender(rng),
    };

    let path: { x: number; y: number }[] | null = null;
    if (entry.roams) {
      // The middle of the map, not `route.entry` — the entry tile is one step
      // inside the gate, which is on the *edge*, so a ring around it is half
      // off the map and snaps into a shape that is not a ring at all. That
      // mistake produced loops of nine hundred and sixty tiles: a tour of the
      // whole route rather than a circle on it.
      const middle = { x: Math.floor(route.width / 2), y: Math.floor(route.height / 2) };

      // Tried large first and shrinking, and each radius from three centres.
      // A maze that will not take a wide loop may take a narrower one, and a
      // ring that sprawls around the middle of the map may close neatly a few
      // tiles off it — pinewood's rooms are the tightest in the game and it
      // was the one route that kept producing eight-hundred-tile rambles.
      // A grid of centres, tried from the middle of the map outward, because a
      // loop only has to fit *somewhere* on an eighty-eight by sixty-eight
      // route and there is no reason it has to be the middle.
      //
      // Two centres were enough while the routes were half-open fields. Once
      // the maze became a real maze, a ring of waypoints joined by the
      // shortest walk between them started wandering: one seed produced a loop
      // of eight hundred and sixteen tiles, which is a four-hundred-step chase.
      // Twelve centres and four radii is forty-eight tries, it stops at the
      // first one under the cap, and it only runs for the four roamers in a
      // world.
      const centres: { x: number; y: number }[] = [];
      for (let gy = 1; gy <= 3; gy++) {
        for (let gx = 1; gx <= 4; gx++) {
          centres.push({
            x: Math.round((route.width * gx) / 5),
            y: Math.round((route.height * gy) / 4),
          });
        }
      }
      const from = (at: { x: number; y: number }) =>
        Math.abs(at.x - middle.x) + Math.abs(at.y - middle.y);
      centres.sort((a, b) => from(a) - from(b));

      for (const radius of [14, 11, 8, 6]) {
        for (const centre of centres) {
          const tried = roamPath(
            route,
            rngFor(seed, "roampath", entry.id, radius, centre.x),
            centre,
            radius,
            (x, y) => !taken(route.id, x, y),
          );
          if (!tried) continue;

          // Long enough to be a chase, short enough to be one you can win.
          // Walking a loop the other way to meet a roamer head on is about
          // half its length in steps, so three hundred tiles is a hundred and
          // fifty moves, which is the outside edge of reasonable.
          if (tried.length <= ROAM_LOOP_MAX) {
            path = tried;
            break;
          }
          // Keep the shortest over-long one as a last resort: a sprawling loop
          // is a worse chase than a tight one, and none at all is worse still.
          if (!path || tried.length < path.length) path = tried;
        }
        if (path && path.length <= ROAM_LOOP_MAX) break;
      }
    }

    const start = path?.[0] ?? spotFor(route, seededWish(rng, route));
    if (!start) continue;

    // The whole loop is claimed, not just where it starts. An idler standing on
    // a roamer's path is an obstacle in the middle of the chase, and worse: the
    // roamer walks *onto* it, and then two creatures share a tile and only one
    // of them can be walked into.
    if (path) for (const step of path) claim(route.id, step.x, step.y);
    else claim(route.id, start.x, start.y);

    add(route.id, {
      id: entry.id,
      routeId: route.id,
      kind: entry.kind,
      x: start.x,
      y: start.y,
      creature: built,
      // Written by hand for these twelve, because each of them stands
      // somewhere particular. The fallback is the generated one, so a roster
      // entry added without a line is still not the same as every other.
      line:
        entry.line ??
        idleLine(
          speciesById(entry.speciesId).name,
          speciesById(entry.speciesId).types,
          intBelow(rngFor(seed, "critterline", entry.id), 64),
        ),
      path,
    });
  }

  // ------------------------------------------------------------ generated
  for (const route of routes.values()) {
    const inTown = route.id === HUB_ID;
    if (!inTown && route.kind !== "route") continue;

    const table = inTown ? [] : encounterTable(allSpecies, route.biome, route.ring, rings);
    if (!inTown && !table.length) continue;

    const wanted = inTown ? 0 : idlersFor(route.ring);
    const rng = rngFor(seed, "idlers", route.id);

    for (let index = 0; index < wanted; index++) {
      const spot = spotFor(route, seededWish(rng, route));
      if (!spot) continue;

      const speciesId = weighted(rng, table, (row) => row.weight).speciesId;
      const level = Math.max(2, levelForRing(route.ring) - 1);
      const built: Individual = {
        pp: [],
        abilities: rollAbilities(rng),
        uid: 0,
        speciesId,
        level,
        exp: level * level * level,
        ivs: rolledIvs(rng),
        evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        natureId: NATURE_IDS[intBelow(rng, NATURE_IDS.length)],
        variantId: "normal",
        hp: 0,
        status: null,
        sleepTurns: 0,
        moves: [],
        heldItem: null,
        nickname: null,
        traded: false,
        prize: false,
        cheat: false,
        parents: null,
        gender: rollGender(rng),
      };

      claim(route.id, spot.x, spot.y);
      const id = `${route.id}:idle${index}`;
      add(route.id, {
        id,
        routeId: route.id,
        // Drawn from what it is, and from its own name, so it is the same
        // creature doing the same thing every time you walk past.
        //
        // And never a line already used on this route. Two of a species share
        // a pool of three, so a pair of them collided about one route in
        // thirty — which is exactly where a repeat is noticed, because both of
        // them are on the same small map. Anywhere else in the world it does
        // not matter and is not worth the arithmetic.
        line: freshLine(said, route.id, speciesId, rngFor(seed, "critterline", id)),
        // A third of the generated ones will fight you, which is what stops
        // walking up to one being a free look every time.
        kind: intBelow(rng, 3) === 0 ? "wild" : "idle",
        x: spot.x,
        y: spot.y,
        creature: built,
        path: null,
      });
    }
  }

  return placed;
}

/**
 * A spot to wish for, well away from the middle.
 *
 * Anything that spirals out from one point puts everything it places in a
 * heap around that point. In town that heap sat on the player's own starting
 * tile and across the way out; on a route it would put every idler in one
 * corner. A seeded wish spreads them, and `nearestSpot` does the rest.
 */
function seededWish(rng: Rng, route: Route): { x: number; y: number } {
  return {
    x: intBetween(rng, 2, route.width - 3),
    y: intBetween(rng, 2, route.height - 3),
  };
}

/** Wild IVs, rolled the same way `wildAt` rolls them. */
function rolledIvs(rng: Rng): StatTable {
  const ivs = {} as StatTable;
  for (const stat of STAT_IDS) ivs[stat] = intBetween(rng, 0, WILD_IV_MAX);
  return ivs;
}

/**
 * The town's id, which is also what the plan calls it in a link.
 *
 * One constant rather than two strings that happened to match: layout.ts has
 * to name the hub in its links, and world.ts has to name the route.
 */
export const HUB_ID = HUB;

export function generateWorld(
  config: WorldConfig,
  seed: string,
  allSpecies: readonly SpeciesEntry[],
): World {
  const routes = new Map<string, Route>();

  /**
   * The shape of the world, before anything is built on it.
   *
   * Grown first because everything else needs to know it: which places exist,
   * how far out each one is, and which of its four sides has a neighbour. A
   * route cannot be carved until its gates are known, and a gym cannot be
   * assigned until it is known which marsh is the nearest one.
   *
   * It grows the fifty routes *and* the four towns, because a town is a cell
   * like any other and the towns have to be spread over the lattice by the
   * same graph the routes are joined by.
   */
  const plan = planWorld(rngFor(seed, "plan"), placesWanted() + OUTER_TOWNS);

  for (const node of plan.nodes) {
    if (node.kind === "town") {
      const spec = TOWNS.find((each) => each.id === node.id);
      if (!spec) continue;
      const built = buildTown(node, spec);
      routes.set(built.town.id, built.town);
      for (const room of built.interiors) routes.set(room.id, room);
      continue;
    }

    // Which copy of its biome this is, straight off its name — the plan
    // numbers them by distance from town for exactly this reason.
    const nth = copyOf(node.id);

    const built = buildRoute(seed, node, {
      ring: bandOf(node.depth, plan.maxDepth, config.rings),
      nth,
      cabin: CABIN_ROUTES.has(`${node.biome}:${nth}`),
      gym: GYMS.find((entry) => entry.biome === node.biome && entry.nth === nth) ?? null,
      cup: node.biome === CUP_BIOME && nth === CUP_NTH,
    });

    routes.set(built.route.id, built.route);
    for (const room of built.interiors) routes.set(room.id, room);
  }

  wireBorders(routes, plan);

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

  const npcs = placeNpcs(seed, routes);
  const pickups = placeInks(seed, routes, placePickups(seed, routes, npcs, config.rings));

  const trainers = new Map<string, TrainerSpec[]>();
  for (const route of routes.values()) {
    if (route.kind !== "route") continue;
    // The roster is already down, and a trainer has to be placed knowing it:
    // two people who each leave the route walkable can still wall it off
    // between them.
    const here = buildTrainers(
      seed,
      route,
      allSpecies,
      config.rings,
      new Set((npcs.get(route.id) ?? []).map((who) => `${who.x},${who.y}`)),
    );
    if (here.length) trainers.set(route.id, here);
  }

  /**
   * One thing each of them knows, dealt from a shuffled deck.
   *
   * Dealt here rather than inside `buildTrainers` because the deck has to span
   * the whole world. A route builds four to seven people; dealing per route
   * would reshuffle every time and hand the same opening line to somebody on
   * the next route over, which is exactly the repetition a deck is for
   * avoiding.
   *
   * The order is sorted rather than whatever the map happens to iterate in.
   * Route insertion order is deterministic today, and a deal that silently
   * changed because somebody reordered a loop elsewhere would give every
   * trainer in the world a different line — which is not a bug anything would
   * catch, merely a world that quietly stopped being the same world.
   */
  const dealt = dealHints(
    rngFor(seed, "trainer-hints"),
    [...trainers.values()].reduce((total, here) => total + here.length, 0),
  );
  let nextHint = 0;
  for (const routeId of [...trainers.keys()].sort()) {
    trainers.set(
      routeId,
      trainers.get(routeId)!.map((who) => ({ ...who, hintId: dealt[nextHint++] })),
    );
  }

  // And the ones written by hand, who stand in the towns.
  //
  // The same `TrainerSpec` the routes use, so walking into one starts a battle
  // through exactly the same door — what is different is that their teams are
  // written down rather than drawn from the route's table, because the joke is
  // usually the team.
  for (const spec of TOWN_TRAINERS) {
    const route = routes.get(spec.town);
    if (!route) continue;

    const busy = new Set([
      ...(npcs.get(route.id) ?? []).map((who) => `${who.x},${who.y}`),
      ...(trainers.get(route.id) ?? []).map((who) => `${who.x},${who.y}`),
    ]);
    const spot = nearestSpot(route, { x: spec.x, y: spec.y }, busy);
    if (!spot) continue;

    trainers.set(route.id, [
      ...(trainers.get(route.id) ?? []),
      {
        id: spec.id,
        routeId: route.id,
        x: spot.x,
        y: spot.y,
        name: spec.name,
        team: spec.team,
      },
    ]);
  }

  const critters = placeCritters(seed, routes, npcs, trainers, allSpecies, config.rings);

  return { config, seed, starters, routes, census, trainers, npcs, pickups, critters };
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
function buildTrainers(
  seed: string,
  route: Route,
  allSpecies: readonly SpeciesEntry[],
  rings: number,
  /**
   * Who is already standing here, as "x,y".
   *
   * The roster is placed before this runs and the critters after it, and both
   * of those go through `nearestSpot`, which refuses a tile that would cut the
   * route off. This one did not know about either, so it was the one pass that
   * could put somebody in a corridor an idler was already half-blocking —
   * neither of them severing the route alone, the two of them together walling
   * off everything past it. On one measured seed that was **1,155 tiles of
   * duskhollow-2 reachable out of 2,583**.
   */
  busy: ReadonlySet<string>,
): TrainerSpec[] {
  if (route.ring < 1) return [];

  const rng = rngFor(seed, "trainers", route.id);
  const table = encounterTable(allSpecies, route.biome, route.ring, rings);
  if (!table.length) return [];

  /*
   * Open ground only, never tall grass, so a trainer is always visible and
   * always avoidable. There is barely any TILE.PATH left on a route now — the
   * corridors between rooms are the biome's own floor, sand in the ashflats
   * and grass-cropped meadow elsewhere — so what counts as somewhere to stand
   * is asked of the tile rather than assumed from one id.
   *
   * **And not in a doorway.** This is the one placement in the world that did
   * not go through `nearestSpot`, and so it was the one that had none of
   * `nearestSpot`'s standards: a route trainer took any walkable tile at all.
   * `TILE.DOOR` is walkable — it has to be, you walk through it — so a
   * trainer could stand *in* a gym door, and more often stand on the single
   * step in front of one, which is the only way in. Either way the building
   * cannot be entered, and a gym you cannot enter is a badge you cannot earn.
   *
   * Every neighbour of a door is refused rather than just the step below it.
   * A door faces south today and the step is the only walkable tile beside
   * it, so the two rules pick out the same tile — but the broader one does
   * not quietly stop working if a building is ever drawn facing another way,
   * and standing clear of a doorway reads better regardless.
   */
  const doorish = new Set<string>();
  for (let y = 0; y < route.height; y++) {
    for (let x = 0; x < route.width; x++) {
      if (route.tiles[y * route.width + x] !== TILE.DOOR) continue;
      doorish.add(`${x},${y}`);
      for (const [dx, dy] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        doorish.add(`${x + dx},${y + dy}`);
      }
    }
  }

  const open: { x: number; y: number }[] = [];
  for (let y = 2; y < route.height - 2; y++) {
    for (let x = 2; x < route.width - 2; x++) {
      const tile = route.tiles[y * route.width + x];
      if (!walkable(tile) || hidesEncounters(tile)) continue;
      if (doorish.has(`${x},${y}`)) continue;
      if (busy.has(`${x},${y}`)) continue;
      // Nor on the way in, nor inside a boulder somebody else put there.
      if (x === route.entry.x && y === route.entry.y) continue;
      if (propBlocks(route, x, y)) continue;
      open.push({ x, y });
    }
  }
  if (!open.length) return [];

  // Four to six of them, and one more again out past the halfway band.
  //
  // It was one to three, chosen when a route was 44x34. A route is 88x68 now —
  // four times the ground, a real maze through it, and a walk from one side to
  // the other of about eighty steps — so one or two people on it read as a
  // corridor with encounters rather than as somewhere anybody lives. Doubling
  // them is the difference between "there might be somebody" and "there is
  // somebody round most corners", which is what makes a route worth combing
  // rather than crossing.
  const wanted = 4 + intBelow(rng, 3) + (route.ring >= 5 ? 1 : 0);

  /*
   * And nobody standing where they would wall the route off.
   *
   * The other standard `nearestSpot` has and this did not. A route is a real
   * maze now, with one-wide corridors between its rooms, and a person is
   * solid — so a trainer dealt the wrong tile is a wall across the only way
   * through, with everything past it unreachable for the rest of the save.
   *
   * Checked against the ones already standing rather than against an empty
   * map, because two trainers either side of a corridor are a wall that
   * neither of them is on their own.
   *
   * Walked in shuffled order and taking the first that pass, rather than
   * taking `wanted` and testing them: a rejection has to be replaced by
   * *another* candidate, or a route with one bad tile in it quietly ends up
   * with fewer people on it than the line above asks for.
   */
  // Seeded with the roster, not just the props. Keeping them out of `open`
  // stops a trainer standing *on* an idler; it is having them in here that
  // stops the two of them walling a corridor between them, which is the
  // failure that is invisible one person at a time.
  const standing = new Set<string>(busy);
  for (const prop of route.props) {
    if (!PROPS[prop.kind].walkable) standing.add(`${prop.x},${prop.y}`);
  }
  const chosen: { x: number; y: number }[] = [];
  let baseline = reachableCount(route, standing);
  for (const spot of shuffle(rng, open)) {
    if (chosen.length >= wanted) break;
    if (wouldSever(route, spot, standing, baseline)) continue;
    standing.add(`${spot.x},${spot.y}`);
    chosen.push(spot);
    // Measured again rather than decremented by one. A spot in a pocket the
    // entry cannot reach costs nothing when it is blocked, so "one fewer each
    // time" drifts low — and a baseline that is too low is a severance test
    // that passes everything, which is the failure mode that put seven people
    // across one corridor.
    baseline = reachableCount(route, standing);
  }

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
  const abilities = rollAbilities(rng);

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
    // Both filled by the caller, which runs them through `withMoves`.
    pp: [],
    abilities,
    heldItem: null,
    nickname: null,
    traded: false,
    prize: false,
    cheat: false,
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
