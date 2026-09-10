import type { Individual } from "./types";

/**
 * Creatures standing about in the world, rather than waiting inside the grass.
 *
 * Everything wild in this game is an *encounter*: a slot in a route's fixed
 * list, met by walking through tall grass, invisible until it happens. That is
 * the whole census idea and it is worth keeping — but it does mean the world is
 * a place where you never see a creature until it is already fighting you,
 * which is a strange thing for a world full of them to be.
 *
 * So some of them stand where you can see them. They are drawn on the map,
 * they are in the way, and walking into one does something. What it does is
 * the only thing that varies:
 *
 *   **idle** — nothing. It looks up and goes back to what it was doing. Most
 *   of them are this, and that is the point: a town with six creatures
 *   pottering about in it reads as somewhere creatures live.
 *
 *   **joins** — it comes with you. Once, and then it is yours, so these are
 *   authored rather than generated: which creature is standing outside your
 *   own front door is not a thing to leave to a die.
 *
 *   **wild** — it fights you, as itself. Not a slot from the route's list: a
 *   particular creature standing in a particular place, which is the one kind
 *   of encounter you can walk *up* to and decide about first.
 *
 * And orthogonal to all three: **roaming**. A roamer walks a closed loop that
 * was decided when the world was made, and every step you take it has nine
 * chances in ten of moving one tile further along it, away from you.
 *
 * That last rule has a counterplay nobody had to design. Chase a roamer around
 * its own loop and you will never catch it — it moves exactly as often as you
 * do, and only the one time in ten it hesitates do you gain a tile. Walk the
 * loop the *other* way and you meet it head on. The loop is what makes that
 * true, so the loop is the mechanic.
 */

export type CritterKind =
  /** Scenery with a heartbeat. */
  | "idle"
  /** Comes with you, once ever. */
  | "joins"
  /** Fights you as itself. */
  | "wild";

/**
 * One of them, as the world records it.
 *
 * The creature is stored whole rather than as a species and a level, unlike a
 * trainer's team — because unlike a trainer's team it is a *particular*
 * creature, and the whole appeal of a roamer is that the one circling the
 * ashflats is the one circling the ashflats. Its uid is filled in when it
 * actually enters a battle, the same way a wild one's is.
 */
export interface CritterSpec {
  id: string;
  routeId: string;
  kind: CritterKind;
  /** Where it starts. For a roamer, this is `path[0]`. */
  x: number;
  y: number;
  /** What it is. Built at world generation, so it never changes. */
  creature: Individual;
  /**
   * The closed loop it walks, or null if it stands still.
   *
   * Tile by tile and every step adjacent, so it never appears to jump. Built
   * by joining a ring of waypoints with shortest paths through open ground and
   * then joining the last back to the first, which is what makes it a loop
   * rather than a there-and-back.
   */
  path: readonly { x: number; y: number }[] | null;
}

/** Nine chances in ten, per step you take. */
export const ROAM_CHANCE = 900;

/**
 * How far along its loop a roamer is, given what the save remembers.
 *
 * Absent means the beginning, so a world that has never been walked in has
 * every roamer at `path[0]` — which is where the map drew it before
 * anybody moved.
 */
export function roamIndex(progress: Record<string, number>, spec: CritterSpec): number {
  if (!spec.path?.length) return 0;
  const at = progress[spec.id] ?? 0;
  // Modulo rather than clamp: the path is a loop, so walking off the end of it
  // is walking back to the start of it.
  return ((at % spec.path.length) + spec.path.length) % spec.path.length;
}

/** Where it is standing right now. */
export function critterAt(
  progress: Record<string, number>,
  spec: CritterSpec,
): { x: number; y: number } {
  if (!spec.path?.length) return { x: spec.x, y: spec.y };
  return spec.path[roamIndex(progress, spec)];
}

/**
 * Which way along the loop is away from where you are standing.
 *
 * Returns +1 or -1. Ties go forward, so two players standing in the same place
 * see the same thing — and so a roamer at the exact opposite point of its
 * own loop does not dither.
 *
 * Manhattan distance, like every other distance in this engine, because the
 * player moves in four directions and a diagonal is two steps.
 */
export function awayFrom(
  spec: CritterSpec,
  index: number,
  from: { x: number; y: number },
): 1 | -1 {
  const path = spec.path;
  if (!path?.length) return 1;

  const span = (at: number) => {
    const tile = path[((at % path.length) + path.length) % path.length];
    return Math.abs(tile.x - from.x) + Math.abs(tile.y - from.y);
  };

  return span(index + 1) >= span(index - 1) ? 1 : -1;
}

/**
 * Every creature standing on this route, with where it is standing.
 *
 * The one place that folds the world's record together with the save's, so
 * nothing else has to know that a roamer's position is derived and an idle
 * one's is not.
 */
export function standingOn(
  critters: readonly CritterSpec[],
  progress: Record<string, number>,
  met: readonly string[],
): { spec: CritterSpec; x: number; y: number }[] {
  return critters
    .filter((spec) => !met.includes(spec.id))
    .map((spec) => ({ spec, ...critterAt(progress, spec) }));
}

/** The tag a battle against one of these carries. */
export const CRITTER_TAG = "critter:";

/** Which one a battle is against, or null. */
export function critterIdOf(tag: string | null | undefined): string | null {
  return tag?.startsWith(CRITTER_TAG) ? tag.slice(CRITTER_TAG.length) : null;
}

/**
 * The ones that are written down rather than drawn from the route's table.
 *
 * A creature that joins you is a gift, and a gift is authored: which one is
 * waiting outside your own front door on the first morning is not a thing to
 * leave to a die. The roamers are authored for the opposite reason — a
 * chase around the sixth ring should be worth the walk, and "whatever the
 * encounter table happened to deal" is not.
 *
 * Everything else standing about is generated from the route's own encounter
 * table, which is the right instinct and costs nothing: a meadow has meadow
 * creatures pottering about in it, and it stays true if the bestiary changes.
 */
export interface CritterPlacement {
  id: string;
  kind: CritterKind;
  speciesId: string;
  level: number;
  /** Which map, and how it stands on it. */
  where: { at: "town" } | { at: "ring"; biome: string; ring: number };
  /** Whether it walks a loop. */
  roams?: boolean;
  /** What it looks like. Left off, it is ordinary. */
  variantId?: string;
}

export const CRITTERS: readonly CritterPlacement[] = [
  // -------------------------------------------------------------- in town
  //
  // Six of them, and only one does anything. That ratio is deliberate: a town
  // where every creature is a reward is a shopping list, and a town where
  // none of them is worth walking over to is scenery.
  { id: "town-doorstep", kind: "joins", speciesId: "eevee", level: 5, where: { at: "town" } },
  { id: "town-roof", kind: "idle", speciesId: "meowth", level: 8, where: { at: "town" } },
  { id: "town-well", kind: "idle", speciesId: "psyduck", level: 6, where: { at: "town" } },
  { id: "town-fence", kind: "idle", speciesId: "pidgey", level: 4, where: { at: "town" } },
  { id: "town-garden", kind: "idle", speciesId: "oddish", level: 5, where: { at: "town" } },
  { id: "town-step", kind: "idle", speciesId: "rattata", level: 3, where: { at: "town" } },

  // ----------------------------------------------------- the four roamers
  //
  // One per arm, further out each time, and each of them something you would
  // otherwise have to be very lucky to meet. A roamer is the only creature in
  // this world you can *see* before you fight it, so it may as well be worth
  // seeing.
  {
    id: "roam-meadow",
    kind: "wild",
    speciesId: "snorlax",
    level: 34,
    roams: true,
    where: { at: "ring", biome: "meadow", ring: 3 },
  },
  {
    id: "roam-pinewood",
    kind: "wild",
    speciesId: "absol",
    level: 42,
    roams: true,
    variantId: "tint2",
    where: { at: "ring", biome: "pinewood", ring: 4 },
  },
  {
    id: "roam-marsh",
    kind: "wild",
    speciesId: "lapras",
    level: 48,
    roams: true,
    where: { at: "ring", biome: "marsh", ring: 5 },
  },
  {
    id: "roam-ashflats",
    kind: "wild",
    speciesId: "dragonite",
    level: 58,
    roams: true,
    variantId: "shiny",
    where: { at: "ring", biome: "ashflats", ring: 6 },
  },

  // ------------------------------------------ two more that come with you
  //
  // Out on the arms rather than in town, so that walking somewhere difficult
  // is what finds them.
  {
    id: "gift-marsh",
    kind: "joins",
    speciesId: "lotad",
    level: 12,
    where: { at: "ring", biome: "marsh", ring: 1 },
  },
  {
    id: "gift-pinewood",
    kind: "joins",
    speciesId: "phantump",
    level: 22,
    roams: false,
    where: { at: "ring", biome: "pinewood", ring: 3 },
  },
];

/** How many generated idlers a route gets, by how far out it is. */
export function idlersFor(ring: number): number {
  // Thinner further out. The outer rings are where the census hides its best
  // things, and a crowd of visible creatures out there would read as though
  // the hunting were over.
  return ring <= 2 ? 3 : ring <= 4 ? 2 : 1;
}
