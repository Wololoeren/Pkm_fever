import type { NpcKind } from "@/engine/npc";

/**
 * What sort of person this is, in one colour.
 *
 * Every kind needs an entry. A missing one is not a default — `person` sets
 * `ctx.fillStyle` to it, and assigning an invalid value to a canvas context is
 * *ignored*, so the figure keeps whatever colour was set last. That was the
 * shadow ellipse drawn a line earlier, which is why gym leaders and the
 * Appraiser were being painted in near-black instead of failing loudly.
 * `tests/palette.test.ts` now asks every NpcKind for its colour.
 */
export const NPC_COLOURS: Record<NpcKind, string> = {
  hint: "#8a7fc4",
  /** Oiled leather, for a man who is mostly outdoors. */
  hunt: "#7a6a4a",
  /** Furrow brown, for a man who is mostly kneeling in one. */
  farm: "#8f7a3f",
  /** Ledger green, for a woman with a ledger. */
  lost: "#5f8f6a",
  /** Board chalk, for a man who owns a board. */
  post: "#c9b06a",
  fightclub: "#a5453f",
  gift: "#4f9e7a",
  heal: "#4a9ec9",
  trade: "#c98a4a",
  quest: "#c9a83a",
  gym: "#c95a7a",
  buy: "#b09a5a",
  // Yolk.
  eggbuy: "#e0b83c",
  // The three who shape abilities: a candy pink, a chalk-board green and wrapping-paper red.
  chromabuy: "#d67fb8",
  tutor: "#5fae8f",
  giftswap: "#c9504f",
  // A consulting-room teal, and an insurance-brochure navy.
  therapy: "#4fa3a8",
  insure: "#3f5c8c",
  // Ring-light pink and gamer-chair green.
  influence: "#e87fc9",
  stream: "#6bdc7a",
  // Sash gold and flashbulb white.
  pageant: "#e0c048",
  photoshoot: "#e8e8e8",
  // A dull brass, for a man who buys anything.
  pawn: "#8c7a4e",
  // Gavel mahogany.
  auction: "#9b3d2e",
  // Apron blue.
  workshop: "#4e7fa8",
  // The machine, and the man running a bracket out of a field.
  print: "#7ab0c9",
  arena: "#c97a4a",
  // A colour you would not want to look at for long, which is the idea.
  shred: "#9a5a5a",
  cut: "#8a8ac4",
  // Forge-coloured, which is to say the colour of something that has just been hit.
  forge: "#c9844a",
  // The five at the end of the world, and the one who keeps their door.
  cup: "#a55ac9",
  // Grey, and grey is the point. Every other colour here says something
  // happens at this tile; the Grey Line is how you get to a different tile, so
  // it is the one sort of person on the map who is infrastructure rather than
  // an event. Light enough to read against a rock wall, which is where a good
  // few of them stand.
  travel: "#9aa4b0",
};
