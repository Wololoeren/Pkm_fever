import { TILE } from "@/engine/terrain";

/** How big one tile is drawn. The engine has no idea this number exists. */
export const TILE_PX = 26;

/**
 * How many tiles the camera shows.
 *
 * Routes are 44x34 now, which at 26px would be a 1144px map — too wide for the
 * page and too much of a place to see at once anyway. The window is what makes
 * a bigger world feel bigger rather than merely more zoomed out.
 */
export const VIEW_TILES_X = 23;
export const VIEW_TILES_Y = 17;

interface BiomePalette {
  /** Trodden ground. */
  path: string;
  /** Tall grass, in two shades so a field is not a slab. */
  grass: string;
  grassAlt: string;
  /** Short grass — most of the ground. */
  meadow: string;
  meadowAlt: string;
  tree: string;
  treeAlt: string;
  rock: string;
  water: string;
  sand: string;
  flower: string;
}

/**
 * A palette per biome, so a route reads as somewhere rather than as a grid.
 *
 * Every biome names every tile, rather than falling back: an ashflats pond
 * should not be the same blue as a marsh one, and a shared default is how
 * that sort of thing quietly stops being true.
 */
const PALETTES: Record<string, BiomePalette> = {
  hearth: {
    path: "#c8b78d", grass: "#4e8443", grassAlt: "#477a3d",
    meadow: "#5d9450", meadowAlt: "#568c4a",
    tree: "#2e5531", treeAlt: "#274a2b", rock: "#7d7566",
    water: "#3f6f9e", sand: "#d3c49b", flower: "#c96f8e",
  },
  meadow: {
    path: "#c2ac78", grass: "#4e8443", grassAlt: "#477a3d",
    meadow: "#619a53", meadowAlt: "#5a914d",
    tree: "#2e5531", treeAlt: "#274a2b", rock: "#7d7566",
    water: "#3f7fae", sand: "#d8c89c", flower: "#d4738f",
  },
  pinewood: {
    path: "#94875f", grass: "#336548", grassAlt: "#2d5c41",
    meadow: "#3d7050", meadowAlt: "#376849",
    tree: "#1d4230", treeAlt: "#183828", rock: "#6b6b60",
    water: "#33607e", sand: "#a89d78", flower: "#b98ac0",
  },
  ashflats: {
    path: "#a1937a", grass: "#7f6f58", grassAlt: "#776850",
    meadow: "#8d7c62", meadowAlt: "#85745b",
    tree: "#4c4136", treeAlt: "#413830", rock: "#8a7f6d",
    water: "#5b7f86", sand: "#cbb890", flower: "#c98a5e",
  },
  marsh: {
    path: "#83906f", grass: "#437069", grassAlt: "#3c6862",
    meadow: "#4f7d6f", meadowAlt: "#487566",
    tree: "#2b4d48", treeAlt: "#254340", rock: "#6d7a72",
    water: "#2f6a6a", sand: "#9fa87f", flower: "#8fbf87",
  },
  indoors: {
    path: "#8a7358", grass: "#8a7358", grassAlt: "#8a7358",
    meadow: "#a08560", meadowAlt: "#9a805c",
    tree: "#4a3a2c", treeAlt: "#423426", rock: "#6b5a48",
    water: "#4a6f8a", sand: "#b39a72", flower: "#c08a6a",
  },
};

export function paletteFor(biome: string): BiomePalette {
  return PALETTES[biome] ?? PALETTES.meadow;
}

/**
 * The colour of one tile, given where it is.
 *
 * The checker on grass and trees is what keeps a large field from reading as
 * a single flat rectangle, which was the main thing wrong with the small maps.
 */
export function tileColor(biome: string, tile: number, x: number, y: number): string {
  const palette = paletteFor(biome);
  const checker = (x + y) % 2 === 0;

  switch (tile) {
    case TILE.PATH:
      return palette.path;
    case TILE.GRASS:
      return checker ? palette.grass : palette.grassAlt;
    case TILE.MEADOW:
      return checker ? palette.meadow : palette.meadowAlt;
    case TILE.TREE:
      return checker ? palette.tree : palette.treeAlt;
    case TILE.ROCK:
      return palette.rock;
    case TILE.WATER:
      return palette.water;
    case TILE.SAND:
      return palette.sand;
    case TILE.FLOWER:
      return palette.flower;
    case TILE.WALL:
      return "#8d6f55";
    case TILE.ROOF:
      return "#a4433f";
    case TILE.DOOR:
      return "#4a3527";
    case TILE.FENCE:
      return "#9c8560";
    case TILE.FLOOR:
      return checker ? "#a08560" : "#9a805c";
    case TILE.EXIT:
      return "#4a3527";
    case TILE.SIGN:
      return palette.path;
    default:
      return palette.meadow;
  }
}

/**
 * What to call a map.
 *
 * Routes carry their own label now, because a town, a ring and a room inside a
 * cabin have nothing in common to derive one from. This is the fallback for
 * the handful of places holding only an id.
 */
export function routeLabel(id: string): string {
  if (id === "hub-0") return "Hearth";
  const [biome, ring] = id.split(":")[0].split("-");
  const name = biome.charAt(0).toUpperCase() + biome.slice(1);
  const inside = id.includes(":") ? " · indoors" : "";
  return ring ? `${name} · ring ${ring}${inside}` : name + inside;
}
