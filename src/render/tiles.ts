import { TILE_BLOCK, TILE_GRASS, TILE_PATH } from "@/engine/world";

/** How big one tile is drawn. The engine has no idea this number exists. */
export const TILE_PX = 26;

interface BiomePalette {
  path: string;
  grass: string;
  grassAlt: string;
  block: string;
  blockAlt: string;
}

/**
 * A palette per biome, so a route reads as somewhere rather than as a grid.
 * `grassAlt` and `blockAlt` are used on a checker so large fields of one tile
 * do not turn into a flat slab of colour.
 */
const PALETTES: Record<string, BiomePalette> = {
  hub: { path: "#c8b78d", grass: "#c8b78d", grassAlt: "#c2b087", block: "#6d6047", blockAlt: "#5e5340" },
  meadow: { path: "#c2ac78", grass: "#4e8443", grassAlt: "#477a3d", block: "#2e5531", blockAlt: "#274a2b" },
  pinewood: { path: "#94875f", grass: "#336548", grassAlt: "#2d5c41", block: "#1d4230", blockAlt: "#183828" },
  ashflats: { path: "#a1937a", grass: "#7f6f58", grassAlt: "#776850", block: "#4c4136", blockAlt: "#413830" },
  marsh: { path: "#83906f", grass: "#437069", grassAlt: "#3c6862", block: "#2b4d48", blockAlt: "#254340" },
};

export function paletteFor(biome: string): BiomePalette {
  return PALETTES[biome] ?? PALETTES.meadow;
}

export function tileColor(biome: string, tile: number, x: number, y: number): string {
  const palette = paletteFor(biome);
  const checker = (x + y) % 2 === 0;

  if (tile === TILE_BLOCK) return checker ? palette.block : palette.blockAlt;
  if (tile === TILE_GRASS) return checker ? palette.grass : palette.grassAlt;
  if (tile === TILE_PATH) return palette.path;
  return palette.path;
}

/** A readable label for a route id, for the HUD. */
export function routeLabel(id: string): string {
  if (id === "hub-0") return "Hearth — the hub town";
  const [biome, ring] = id.split("-");
  const name = biome.charAt(0).toUpperCase() + biome.slice(1);
  return `${name} · ring ${ring}`;
}
