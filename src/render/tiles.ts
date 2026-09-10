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

  // ------------------------------------------------------------ the wild ones
  //
  // Sixteen more, and the palette is doing most of the work of telling them
  // apart. The terrain profile decides the *shape* of a place — how wide the
  // ways are, how much of it bites — and eleven colours decide what it looks
  // like standing in it. A biome with the same profile as another and a
  // different palette still reads as somewhere else, which is why this table
  // is worth its length.
  //
  // Two of them wall with water rather than trees or rock, so their `water`
  // is the loudest colour they have: it is most of what you see.

  // Ice, and almost nothing living. The walls are ice, so `tree` is pale.
  glacier: {
    path: "#c3d2dd", grass: "#7fa8ab", grassAlt: "#769fa3",
    meadow: "#d3e2ea", meadowAlt: "#c7d8e2",
    tree: "#9dc0d4", treeAlt: "#8db2c8", rock: "#a9c2d0",
    water: "#2f6c96", sand: "#e2ecf2", flower: "#a8d8e4",
  },
  // An archipelago under weather. Slate spits, surf between them.
  stormcoast: {
    path: "#9aa2a8", grass: "#5d8a86", grassAlt: "#547f7c",
    meadow: "#8d9aa0", meadowAlt: "#849197",
    tree: "#41525c", treeAlt: "#394852", rock: "#6e7a82",
    water: "#37698c", sand: "#b6bcbc", flower: "#7fb8c4",
  },
  // The widest and the emptiest. Gold, and more gold.
  dunes: {
    path: "#dcc489", grass: "#b39a63", grassAlt: "#aa915b",
    meadow: "#d8bc7e", meadowAlt: "#cfb374",
    tree: "#8a6f45", treeAlt: "#7a613c", rock: "#b59a67",
    water: "#4f8fa0", sand: "#e8d29a", flower: "#d69a5e",
  },
  // Bleached and strewn. Grey with the violet of something long dead.
  boneyard: {
    path: "#b0a99c", grass: "#8e8778", grassAlt: "#857e70",
    meadow: "#a49c8e", meadowAlt: "#9a9285",
    tree: "#5c5560", treeAlt: "#514b55", rock: "#c0b8ab",
    water: "#4a5a68", sand: "#c8c1b2", flower: "#9c86a8",
  },
  // Nine tenths undergrowth, and none of it looks well.
  mycelia: {
    path: "#7a6a58", grass: "#5c4a6a", grassAlt: "#544362",
    meadow: "#6b5a48", meadowAlt: "#635340",
    tree: "#39294a", treeAlt: "#312342", rock: "#6a5f5a",
    water: "#3f5a52", sand: "#8a7a62", flower: "#b06fa8",
  },
  // Open to the horizon, under a bruise.
  thunderplain: {
    path: "#c0b070", grass: "#8a9a48", grassAlt: "#819040",
    meadow: "#9aa855", meadowAlt: "#919f4d",
    tree: "#5a5f3a", treeAlt: "#4f5432", rock: "#8a8470",
    water: "#4a7a96", sand: "#cbbe86", flower: "#e0d05a",
  },
  // Glass and geometry, and nearly nothing growing on it.
  crystalvault: {
    path: "#b0a8c8", grass: "#7a7aa8", grassAlt: "#71719e",
    meadow: "#a49cc0", meadowAlt: "#9a92b6",
    tree: "#5a4a86", treeAlt: "#4f4078", rock: "#8f86b8",
    water: "#4a6ac0", sand: "#c4bcda", flower: "#8fe0e4",
  },
  // Burnt through. Char, and the orange still in it.
  emberfields: {
    path: "#8a6a52", grass: "#7a4a34", grassAlt: "#70422e",
    meadow: "#6a4a3a", meadowAlt: "#614332",
    tree: "#3a2620", treeAlt: "#31201b", rock: "#7a5a48",
    water: "#5a5a52", sand: "#a8724a", flower: "#e08a3a",
  },
  // Above the weather. Thin ways, thin air, thin colour.
  cloudreach: {
    path: "#c8ccd4", grass: "#7f96a8", grassAlt: "#768c9e",
    meadow: "#a8b4c0", meadowAlt: "#9eaab6",
    tree: "#6a7688", treeAlt: "#5f6a7c", rock: "#b4bcc8",
    water: "#5a86b0", sand: "#d4d8de", flower: "#c8a8d4",
  },
  // The drowned archipelago. Deep green-blue, and twelve pools of it.
  sunkenreach: {
    path: "#6a7a74", grass: "#2f5a56", grassAlt: "#28524e",
    meadow: "#3f6a60", meadowAlt: "#386258",
    tree: "#1d3a40", treeAlt: "#183238", rock: "#5a6a68",
    water: "#1f4a5c", sand: "#7f8a7a", flower: "#6aa8a0",
  },
  // Two tiles wide and no way round. Bruised green, going black.
  bramblewood: {
    path: "#6a6a4a", grass: "#2a4a2f", grassAlt: "#244228",
    meadow: "#39543a", meadowAlt: "#324c33",
    tree: "#16281c", treeAlt: "#122217", rock: "#54544a",
    water: "#2a4a48", sand: "#7a7a5a", flower: "#8a6a9a",
  },
  // Cracked flat and white, and the most strewn ground anywhere.
  saltpan: {
    path: "#d8d4c8", grass: "#a8a898", grassAlt: "#9f9f8f",
    meadow: "#cbc8ba", meadowAlt: "#c2bfb0",
    tree: "#8a8a80", treeAlt: "#7c7c72", rock: "#e2e0d4",
    water: "#6a96a0", sand: "#e8e6da", flower: "#c8b8d0",
  },
  // Planted by somebody, a long time ago, and still growing to plan.
  fellgarden: {
    path: "#c8a8b8", grass: "#6a8a5a", grassAlt: "#618152",
    meadow: "#7f9a68", meadowAlt: "#769160",
    tree: "#4a5a48", treeAlt: "#41503f", rock: "#a89aa0",
    water: "#6a8ab0", sand: "#d4bcc4", flower: "#e88fc0",
  },
  // Made rather than grown. Paving, rust, and standing water.
  slagheap: {
    path: "#8a8278", grass: "#7a6a4a", grassAlt: "#716142",
    meadow: "#6a6258", meadowAlt: "#615a50",
    tree: "#4a4038", treeAlt: "#413830", rock: "#9a8a70",
    water: "#5a6a5a", sand: "#a89a80", flower: "#c07a4a",
  },
  // A bog that froze and thawed and froze again.
  frostmire: {
    path: "#8a9a98", grass: "#4a6a6a", grassAlt: "#426262",
    meadow: "#5f7a78", meadowAlt: "#577270",
    tree: "#33504f", treeAlt: "#2c4746", rock: "#7f8a88",
    water: "#3a6a78", sand: "#a4aeaa", flower: "#a8c8d4",
  },
  // The darkest. Indigo, going to nothing.
  duskhollow: {
    path: "#4a4a5a", grass: "#25283f", grassAlt: "#202338",
    meadow: "#32354a", meadowAlt: "#2c2f42",
    tree: "#14162a", treeAlt: "#101224", rock: "#40404f",
    water: "#1f2a48", sand: "#54546a", flower: "#6a5a9a",
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

    // The obstacles. Each reads as a harder version of the ground it sits on,
    // so "there is something in the way" is legible before you know which tool
    // it wants.
    case TILE.BUSH:
      return "#3f7a3c";
    case TILE.BOULDER:
      return "#6f6a60";
    case TILE.RUBBLE:
      return "#8a7f70";
    case TILE.WATERFALL:
      return "#7fb6d8";
    case TILE.WHIRLPOOL:
      return "#2f5f7f";
    case TILE.CLIFF:
      return "#5c5148";
    case TILE.DEEP:
      return "#1f4a6b";
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
