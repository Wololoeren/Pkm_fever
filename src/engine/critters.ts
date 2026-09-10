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
 * creature, and the whole appeal of a roamer is that the shiny dragon over the
 * storm coast is *the* shiny dragon over the storm coast. Its uid is filled in
 * when it actually enters a battle, the same way a wild one's is.
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
   * What it is doing, in words, decided when the world was made.
   *
   * On the world rather than worked out when you bump into it, for the same
   * reason everything else here is: two players on a seed should walk past the
   * same creature doing the same thing, and it should be doing that thing
   * again tomorrow. A creature that says something different every time you
   * pass is not a character, it is a slot machine.
   */
  line: string;
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
  where: { at: "town" } | { at: "route"; biome: string; nth: number };
  /** Whether it walks a loop. */
  roams?: boolean;
  /** What it looks like. Left off, it is ordinary. */
  variantId?: string;
  /**
   * What it is doing when you walk into it.
   *
   * Written by hand for these, because each of them stands somewhere
   * particular and that is half of it: the Psyduck is by the well, and the
   * line is about the well. The generated ones draw from `IDLE_LINES` instead.
   */
  line?: string;
}

/**
 * What a creature standing about is doing when you walk into it.
 *
 * Every one of them used to say the same eleven words — "looks up at you, and
 * goes back to whatever it was doing" — which is a fine line once and a hundred
 * identical creatures by the time you have crossed the world. A creature you can
 * see and walk up to and get *nothing particular* from is worse than no creature
 * at all: it teaches you that walking over is not worth the steps.
 *
 * The roster's own creatures are written by hand, because they stand somewhere
 * specific and that is half the joke. The generated ones cannot be — there are
 * about a hundred a world, drawn from whatever lives on the route — so they draw
 * from a pool keyed on **what they are**. A Fire one does something fiery and a
 * Ghost one does something ghostly, which is both funnier and more informative
 * than anything generic could be: the line tells you what you are looking at.
 *
 * Dual types read from both pools, so a Grass/Poison creature has six lines to
 * pick from rather than three, and reads differently from a plain Grass one.
 * Which line it gets is drawn from its id at world generation, so it is the same
 * for everybody on a seed and the same every time you walk past it. A creature
 * that says something different on Tuesday is not a character, it is a slot
 * machine.
 *
 * `{name}` is the species.
 */
const IDLE_LINES: Record<string, readonly string[]> = {
  normal: [
    "The {name} is doing something entirely ordinary with tremendous commitment.",
    "The {name} moves six inches to the left, considers whether that was better, and moves back.",
    "The {name} has found the one patch of sun there is, and will not be discussing it.",
  ],
  fire: [
    "The {name} is warming a rock. The rock did not ask.",
    "The {name} sneezes, and a small area of the ground stops being green.",
    "The {name} is very carefully not setting anything alight, and would like that noticed.",
  ],
  water: [
    "The {name} is soaked to the skin and could not be happier about it.",
    "The {name} has been holding the same mouthful of water for some time now. It has plans.",
    "The {name} shakes itself dry, immediately gets wet again, and appears to have expected this.",
  ],
  electric: [
    "Your hair stands up. The {name} finds this hilarious.",
    "The {name} is chewing something it should not be chewing, and the something is buzzing.",
    "The {name} has counted to three twice and is plainly building up to something.",
  ],
  grass: [
    "The {name} is photosynthesising and would rather not be interrupted.",
    "The {name} has grown roots into the path. It intends to deal with that later.",
    "The {name} is arguing with a flower. The flower is winning.",
  ],
  ice: [
    "The {name} has frozen a puddle solid and is standing on it, entirely pleased with itself.",
    "The {name} breathes out. You can see it, and it is the middle of summer.",
    "The {name} has not noticed the cold, or you, or anything else in particular.",
  ],
  fighting: [
    "The {name} is doing press-ups. You have interrupted the count and it is starting again.",
    "The {name} squares up to a boulder. The boulder holds its ground.",
    "The {name} nods at you the way one professional nods at another.",
  ],
  poison: [
    "The {name} is bubbling gently. You take a step back and it seems to approve.",
    "The {name} offers you something it found. You decline. It shrugs and eats it.",
    "Everything within a foot of the {name} has gone an interesting colour.",
  ],
  ground: [
    "The {name} surfaces, looks around, disagrees with all of it, and goes back down.",
    "The {name} has dug a hole. The {name} is now filling in the hole.",
    "There is a {name}-shaped hole here, and a {name} sitting beside it, thinking.",
  ],
  flying: [
    "The {name} takes off, thinks better of it, and lands exactly where it started.",
    "The {name} is watching something in the sky that you cannot see.",
    "The {name} preens one feather for a very long time.",
  ],
  psychic: [
    "The {name} answers a question you had not asked yet.",
    "The {name} is levitating a pebble. It is not an impressive pebble.",
    "The {name} looks at you like somebody who has already read the last page.",
  ],
  bug: [
    "The {name} is carrying something four times its own size and refuses all help.",
    "The {name} has been going round the same stone for several minutes.",
    "The {name} freezes, hoping very hard that it is a stick.",
  ],
  rock: [
    "The {name} is being a rock. It is extremely good at it.",
    "You almost trod on the {name}. The {name} is used to this.",
    "The {name} shifts its weight, and something several feet away falls over.",
  ],
  ghost: [
    "The {name} is there. Then it is not. Then it is, slightly to the left.",
    "The {name} tries to frighten you and gets the timing very slightly wrong.",
    "You feel watched. The {name} is being extremely unsubtle about it.",
  ],
  dragon: [
    "The {name} regards you the way one regards weather.",
    "The {name} is sitting on a pile of nothing in particular, guarding it fiercely.",
    "The {name} yawns. Somewhere behind you, a bird decides to be elsewhere.",
  ],
  dark: [
    "The {name} was definitely not doing anything, and would like that on the record.",
    "The {name} watches you from a shadow that is a little too small for it.",
    "The {name} has your something. You check your pockets. It has your something.",
  ],
  steel: [
    "The {name} rings faintly whenever the wind changes.",
    "The {name} is polishing itself with a leaf, methodically, and has been for hours.",
    "You tap the {name}. It sounds expensive.",
  ],
  fairy: [
    "The {name} smiles at you. You feel obscurely that you have agreed to something.",
    "The {name} has arranged nine pebbles into a shape it will not explain.",
    "The {name} laughs at nothing at all, which is somehow worse.",
  ],
  stellar: [
    "The {name} is looking at something a very long way off, and does not blink.",
  ],
};

/**
 * The line a generated one gets: drawn from what it is, and from its own id.
 *
 * Both types when it has two, so a Grass/Poison creature reads differently from
 * a plain Grass one and has twice as many things it might be doing.
 */
export function idleLine(name: string, types: readonly string[], pick: number): string {
  const pool = types.flatMap((type) => IDLE_LINES[type] ?? []);
  const lines = pool.length ? pool : IDLE_LINES.normal;
  return lines[pick % lines.length].replace(/\{name\}/g, name);
}

export const CRITTERS: readonly CritterPlacement[] = [
  // -------------------------------------------------------------- in town
  //
  // Five of them, and **none of them does anything**. That is the rule now,
  // not the ratio: nothing you can pick up is in Hearth. A town that hands you
  // a creature before you have left it makes the starter choice smaller, and
  // makes the first walk out something you do having already been paid. There
  // was an Eevee on the doorstep and it has gone out to the meadow.
  //
  // What is left is scenery, and scenery is worth having: a town with nothing
  // alive in it is a menu with roofs.
  {
    id: "town-roof",
    kind: "idle",
    speciesId: "meowth",
    level: 8,
    where: { at: "town" },
    line:
      "The Meowth is asleep on a warm roof tile, and has clearly done the arithmetic on which one.",
  },
  {
    id: "town-well",
    kind: "idle",
    speciesId: "psyduck",
    level: 6,
    where: { at: "town" },
    line:
      "The Psyduck is staring down the well. The well is staring back. This has been going on for a while.",
  },
  {
    id: "town-fence",
    kind: "idle",
    speciesId: "pidgey",
    level: 4,
    where: { at: "town" },
    line:
      "The Pidgey shuffles four inches along the fence, which it considers a complete answer.",
  },
  {
    id: "town-garden",
    kind: "idle",
    speciesId: "oddish",
    level: 5,
    where: { at: "town" },
    line:
      "The Oddish has buried itself in the flowerbed and believes, sincerely, that you cannot see it.",
  },
  {
    id: "town-step",
    kind: "idle",
    speciesId: "rattata",
    level: 3,
    where: { at: "town" },
    line:
      "The Rattata is guarding a crust of bread the size of its own head. It will not share it, and it does not intend to eat it either.",
  },

  // ----------------------------------------------------- the four roamers
  //
  // Four kinds of place, further out each time, and each of them something you
  // would otherwise have to be very lucky to meet. A roamer is the only
  // creature in this world you can *see* before you fight it, so it may as
  // well be worth seeing.
  //
  // One per arm, once. There are no arms, so they are spread by *kind* instead
  // and each one put where it belongs: the dark one in the Dusk Hollow, the
  // sea serpent in the drowned reach, the dragon over the storm coast.
  {
    id: "roam-meadow",
    line:
      "The Snorlax does not wake. Somewhere under all that, a decision is being made about whether you are worth it.",
    kind: "wild",
    speciesId: "snorlax",
    level: 34,
    roams: true,
    where: { at: "route", biome: "meadow", nth: 3 },
  },
  {
    id: "roam-duskhollow",
    line:
      "The Absol looks at you the way a doctor looks at an X-ray.",
    kind: "wild",
    speciesId: "absol",
    level: 42,
    roams: true,
    variantId: "tint2",
    where: { at: "route", biome: "duskhollow", nth: 2 },
  },
  {
    id: "roam-sunkenreach",
    line:
      "The Lapras is singing something long and slow, and stops the moment it notices you listening.",
    kind: "wild",
    speciesId: "lapras",
    level: 48,
    roams: true,
    where: { at: "route", biome: "sunkenreach", nth: 1 },
  },
  {
    id: "roam-stormcoast",
    line:
      "The Dragonite is carrying a parcel, and seems to be waiting for you to tell it which way is north.",
    kind: "wild",
    speciesId: "dragonite",
    level: 58,
    roams: true,
    variantId: "shiny",
    where: { at: "route", biome: "stormcoast", nth: 3 },
  },

  // ----------------------------------------- three that come with you
  //
  // Out on the map rather than in town, so that walking somewhere is what
  // finds them, and further out each time.
  //
  // The Eevee is the one that used to be on Hearth's doorstep. It is a level
  // *one* now rather than a five, which is the whole difference between a free
  // second starter and a project: it is below anything the first patch of
  // grass will throw at it, so taking it out of the meadow means bringing it
  // up rather than being handed a spare. Eight stones in the game turn it into
  // eight different things, so it is worth the raising.
  {
    id: "gift-eevee",
    line:
      "The Eevee has decided. It was not a long process.",
    kind: "joins",
    speciesId: "eevee",
    level: 1,
    where: { at: "route", biome: "meadow", nth: 1 },
  },
  {
    id: "gift-marsh",
    line:
      "The Lotad paddles over, climbs out, and stands beside you looking pleased with the whole arrangement.",
    kind: "joins",
    speciesId: "lotad",
    level: 12,
    where: { at: "route", biome: "marsh", nth: 1 },
  },
  {
    id: "gift-bramblewood",
    line:
      "The Phantump follows you. You are fairly sure it was not there a moment ago, and fairly sure it would say the same of you.",
    kind: "joins",
    speciesId: "phantump",
    level: 22,
    roams: false,
    where: { at: "route", biome: "bramblewood", nth: 3 },
  },
];

/** How many generated idlers a route gets, by how far out it is. */
export function idlersFor(ring: number): number {
  // Thinner further out. The outer rings are where the census hides its best
  // things, and a crowd of visible creatures out there would read as though
  // the hunting were over.
  return ring <= 2 ? 3 : ring <= 5 ? 2 : 1;
}
