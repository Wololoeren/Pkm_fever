import { baseFormOf, movesAtLevel, species as speciesById } from "./dex";
import { NATURE_IDS } from "./natures";
import { intBetween, rngFor, shuffle, type Rng } from "./rng";
import { clampIvs, IV_MAX, WILD_IV_MAX } from "./stats";
import { expForLevel } from "./progression";
import { STAT_IDS, type Individual, type StatId, type StatTable } from "./types";

/**
 * Breeding, and the reason the whole IV design works at all.
 *
 * Wild creatures roll IVs in 0..6, so a caught creature is a starting point
 * rather than a lottery ticket. That was always the intent — but inheritance
 * on its own only ever *copies*, which would make 6 the permanent ceiling for
 * the entire game and leave the breeding pillar doing nothing. Every egg
 * therefore rolls a small upward **mutation** on the slots it inherits, and
 * that is what turns 0..6 into a climb towards 31.
 *
 * From a wild pair, reaching a perfect stat takes roughly ten to fifteen
 * generations of deliberate breeding — long enough to be a project, short
 * enough to finish.
 *
 * Every roll is derived from the parents' identities and how many eggs this
 * pairing has produced, so breeding cannot be save-scummed any more than an
 * encounter can. It does become *solvable*: a dedicated player can compute an
 * optimal path from a given pair. That is a feature — it turns a grind into a
 * puzzle.
 */

/** Species that cannot breed at all. */
const NO_BREEDING = "Undiscovered";

/** The universal partner. */
const DITTO = "ditto";

/** How many of the twelve parent stat slots pass down, and with what item. */
const INHERITED_SLOTS = 3;
const INHERITED_SLOTS_WITH_HEIRLOOM = 5;

/** Steps walked before the pair has an egg waiting. */
export const STEPS_PER_EGG = 120;

/**
 * The three things that make breeding better, and the only items in the game
 * so far. They are equipment rather than consumables: found once, then applied
 * to a pairing for as long as you want them.
 */
export const BREEDING_ITEMS = ["heirloom", "talisman", "catalyst"] as const;
export type BreedingItem = (typeof BREEDING_ITEMS)[number];

export const ITEM_NAMES: Record<BreedingItem, string> = {
  heirloom: "Heirloom",
  talisman: "Talisman",
  catalyst: "Catalyst",
};

export const ITEM_BLURBS: Record<BreedingItem, string> = {
  heirloom: "Passes down five of the parents' stat slots instead of three.",
  talisman: "The child always inherits the first parent's nature.",
  catalyst: "Strengthens the mutation on every inherited stat.",
};

export interface DaycareState {
  /** The pair, in the order they were deposited. The first is the one whose
   * species and nature the child takes after. */
  slots: [Individual | null, Individual | null];
  /** Steps walked since the last egg appeared. */
  steps: number;
  /** How many eggs this pairing has produced. Names every roll, so the
   * hundredth egg from a pair is as fixed as the first. */
  eggIndex: number;
  eggReady: boolean;
  /** Which found items are applied to this pairing. */
  applied: BreedingItem[];
}

export function emptyDaycare(): DaycareState {
  return { slots: [null, null], steps: 0, eggIndex: 0, eggReady: false, applied: [] };
}

/**
 * Whether two creatures can produce an egg.
 *
 * Egg groups have to overlap, or one of them has to be Ditto, and neither may
 * be in the group that cannot breed at all.
 */
export function compatible(a: Individual, b: Individual): boolean {
  if (a.uid === b.uid) return false;

  const groupsA = speciesById(a.speciesId).eggGroups;
  const groupsB = speciesById(b.speciesId).eggGroups;
  if (groupsA.includes(NO_BREEDING) || groupsB.includes(NO_BREEDING)) return false;

  const isDitto = (individual: Individual) => baseFormOf(individual.speciesId) === DITTO;
  if (isDitto(a) || isDitto(b)) return !(isDitto(a) && isDitto(b));

  return groupsA.some((group) => groupsB.includes(group));
}

/** Where a mutation lands, with and without the catalyst. */
function mutationRange(withCatalyst: boolean): [number, number] {
  return withCatalyst ? [2, 5] : [1, 3];
}

/**
 * The child of a pairing.
 *
 * Pure in (seed, parents, eggIndex, items): the same pair always produces the
 * same sequence of eggs, on every machine, forever.
 */
export function breed(
  seed: string,
  first: Individual,
  second: Individual,
  eggIndex: number,
  applied: readonly BreedingItem[],
): Individual {
  const rng = rngFor(seed, "egg", first.uid, second.uid, eggIndex);

  // A Ditto contributes nothing but a slot, so the child takes after whichever
  // parent is not one.
  const isDitto = (individual: Individual) => baseFormOf(individual.speciesId) === DITTO;
  const template = isDitto(first) && !isDitto(second) ? second : first;
  const speciesId = baseFormOf(template.speciesId);

  const ivs = inheritIvs(rng, first, second, applied);

  const natureId = applied.includes("talisman")
    ? first.natureId
    : rng() < 0.5
      ? first.natureId
      : NATURE_IDS[intBetween(rng, 0, NATURE_IDS.length - 1)];

  return {
    // The caller owns identity; it has the counter.
    uid: 0,
    speciesId,
    level: 1,
    exp: expForLevel(1),
    ivs,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    natureId,
    // Never a variant. Rare forms are placed when the world is made and
    // counted exactly; letting breeding mint more would make the census a
    // lie and turn every tournament into a breeding race for shinies.
    variantId: "normal",
    hp: 0,
    status: null,
    sleepTurns: 0,
    moves: movesAtLevel(speciesId, 1),
    nickname: null,
    parents: [first.uid, second.uid],
  };
}

/**
 * Which stats come down from the parents, and how far each one climbs.
 *
 * Every stat is inherited from one parent or the other; a few of them —
 * three, or five with the heirloom — additionally mutate upward.
 *
 * The first cut rerolled the *non*-inherited stats at wild strength, which
 * read as the natural mirror of "wild creatures are weak" and was a disaster:
 * half of every generation's progress was thrown away and rerolled to 0..6, so
 * a line bred over twenty generations went precisely nowhere. Inheriting
 * everything and mutating a few means a child is never worse than its weaker
 * parent, and the climb is monotonic, slow and legible — which is what makes
 * breeding a project rather than a treadmill.
 */
function inheritIvs(
  rng: Rng,
  first: Individual,
  second: Individual,
  applied: readonly BreedingItem[],
): StatTable {
  const [low, high] = mutationRange(applied.includes("catalyst"));
  const mutated = new Set<StatId>(shuffle(rng, STAT_IDS).slice(0, mutatedSlots(applied)));

  const ivs = {} as StatTable;
  for (const stat of STAT_IDS) {
    const from = rng() < 0.5 ? first : second;
    // The mutation is the whole point: without it nothing could ever exceed
    // the best parent, and a wild ceiling of 6 would be the game's ceiling.
    const boost = mutated.has(stat) ? intBetween(rng, low, high) : 0;
    ivs[stat] = Math.min(IV_MAX, from.ivs[stat] + boost);
  }

  return clampIvs(ivs);
}

function mutatedSlots(applied: readonly BreedingItem[]): number {
  return applied.includes("heirloom") ? INHERITED_SLOTS_WITH_HEIRLOOM : INHERITED_SLOTS;
}

/**
 * Roughly how many generations a line needs to take one stat from a wild catch
 * to perfect.
 *
 * A stat only climbs on the generations it happens to be one of the mutated
 * ones, so the expected gain per generation is the mutation average scaled by
 * how many of the six stats mutate. Shown in the UI to set expectations, and
 * asserted in a test so the curve cannot drift quietly.
 */
export function generationsToMax(applied: readonly BreedingItem[] = []): number {
  const [low, high] = mutationRange(applied.includes("catalyst"));
  const perGeneration = ((low + high) / 2) * (mutatedSlots(applied) / STAT_IDS.length);
  return Math.ceil((IV_MAX - WILD_IV_MAX) / perGeneration);
}
