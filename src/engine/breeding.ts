import { baseFormOf, movesAtLevel, species as speciesById } from "./dex";
import { gendersPair, rollGender } from "./gender";
import { isItem, item as itemSpec } from "./items";
import { NATURE_IDS } from "./natures";
import { inheritAbilities } from "./abilities";
import { heldEffects } from "./carry";
import { fullPp } from "./pp";
import { intBelow, intBetween, rngFor, shuffle, type Rng } from "./rng";
import { clampIvs, IV_MAX, WILD_IV_MAX } from "./stats";
import { expForLevel } from "./progression";
import { STAT_IDS, type Individual, type StatId, type StatTable } from "./types";
import { appearanceId, CHROMA_IDS, TIER_COUNT, TOP_TIER, variant } from "./variants";

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
 * The things that make breeding better. They are equipment rather than
 * consumables: found once, then applied to a pairing for as long as you want
 * them.
 *
 * Three shape the stats, one shapes the shine ladder, and one lens per colour
 * pulls toward that colour. A lens is the only way to aim at an appearance
 * rather than wait for one, which is what makes going to find them worth the
 * walk.
 */
export const CHROMA_LENSES = CHROMA_IDS.map((id) => `lens-${id}`);

/**
 * The flat additions to the climb, weakest first.
 *
 * Their sizes live in the item catalogue with everything else about them, so
 * this is a list of names and not a second table of numbers to keep in step.
 *
 * The first five are found, one to a world, at the depth each is worth. The
 * Cup is last and is not found at all: it is what the five in the house at the
 * end of the ash flats are holding on to, and it is the largest of them by
 * half again because it is the only one you cannot simply walk to.
 */
export const CLIMB_ITEMS = ["glint", "gleam", "lustre", "radiance", "brilliance", "thecup"] as const;

/** The one piece of breeding equipment that is spent rather than kept. */
export const GLITTER = "glitter";

export const BREEDING_ITEMS = [
  "heirloom",
  "talisman",
  "catalyst",
  "prism",
  ...CLIMB_ITEMS,
  GLITTER,
  ...CHROMA_LENSES,
] as readonly string[];
export type BreedingItem = string;

/** The colour a lens aims at, or null if the item is not a lens. */
export function lensChroma(item: BreedingItem): string | null {
  return item.startsWith("lens-") ? item.slice("lens-".length) : null;
}

/**
 * Names and blurbs used to live here, beside the breeding rules. They are in
 * the item catalogue now, with everything else a bag can hold — a Prism and a
 * Potion are both things you own, and two tables of item names is one table
 * too many.
 */

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
  return breedingRefusal(a, b) === null;
}

/**
 * Why this pair will not produce an egg, or null if it will.
 *
 * The reason, not just the verdict, because the daycare has to say what is
 * wrong: "these two share no egg group" is a different problem from "these two
 * are both male", and a panel that guesses will eventually guess wrong. Same
 * shape as depositRefusal and movesRefusal, for the same reason.
 */
export function breedingRefusal(a: Individual, b: Individual): string | null {
  if (a.uid === b.uid) return "nothing breeds with itself";

  const groupsA = speciesById(a.speciesId).eggGroups;
  const groupsB = speciesById(b.speciesId).eggGroups;
  if (groupsA.includes(NO_BREEDING) || groupsB.includes(NO_BREEDING)) {
    return "one of these cannot breed at all";
  }

  // Ditto is the exception to gender as well as to species: it takes the shape
  // of whatever it is paired with.
  const isDitto = (individual: Individual) => baseFormOf(individual.speciesId) === DITTO;
  if (isDitto(a) && isDitto(b)) return "two Dittos have nothing to work from";
  if (isDitto(a) || isDitto(b)) return null;

  if (!gendersPair(a.gender, b.gender)) return "these two genders do not pair";
  if (!groupsA.some((group) => groupsB.includes(group))) return "these two share no egg group";
  return null;
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

  const gender = rollGender(rng);

  const natureId = applied.includes("talisman")
    ? first.natureId
    : rng() < 0.5
      ? first.natureId
      : NATURE_IDS[intBetween(rng, 0, NATURE_IDS.length - 1)];

  const variantId = inheritAppearance(rng, first, second, applied);

  // Drawn after appearance so that adding this did not renumber a single one
  // of the rolls above it. Every egg a pairing has ever produced still comes
  // out the same creature it did before abilities existed — with abilities.
  const abilities = inheritAbilities(rng, first.abilities, second.abilities);

  return {
    // The caller owns identity; it has the counter.
    uid: 0,
    speciesId,
    level: 1,
    exp: expForLevel(1),
    ivs,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    natureId,
    variantId,
    hp: 0,
    status: null,
    sleepTurns: 0,
    moves: movesAtLevel(speciesId, 1),
    pp: fullPp(movesAtLevel(speciesId, 1)),
    abilities,
    heldItem: null,
    nickname: null,
    traded: false,
    parents: [first.uid, second.uid],
    gender,
  };
}

/**
 * How often a child climbs a rung it did not inherit, per mille.
 *
 * One percent, and a tenth of any climb climbs again — so from an ordinary
 * pair, 0.9% of children come out Faded, 0.09% Washed, 0.009% Turning, and so
 * on down to a true shiny at odds you would never plan around. It is a floor
 * under every pairing rather than a strategy, and it means no lineage is
 * permanently locked out of the ladder.
 */
const CLIMB_CHANCE = 100;
const CLIMB_CHANCE_WITH_PRISM = 500;

/**
 * Everything else that touches the climb is *added* to that, never multiplied
 * into it. The Prism was the only multiplier and it stays the only one: two
 * multipliers in the same expression is a number no player can predict from
 * reading their own bag, and the whole point of showing the odds in the
 * daycare is that they can be reasoned about before the egg exists.
 */

/**
 * What every level between the two parents adds to the climb.
 *
 * Five basis points — a twentieth of a percent — for each level on each
 * parent, so a pair of level fifties is worth another five percent and a pair
 * of hundreds another ten. It is the one thing in breeding that rewards work
 * you did somewhere else entirely: a lineage raised as well as it was bred
 * climbs faster than one merely bred.
 *
 * Everything here is basis points rather than per mille, because 0.05% is not
 * a whole number of per mille and the whole pipeline is integers on purpose.
 */
const LEVEL_BASIS_POINTS = 5;
const BASIS = 10_000;

/** Given a climb, how often it climbs again. */
const CASCADE = 0.1;

/** How often a lens overrides the colour the parents would have given. */
const LENS_CHANCE = 0.2;

/**
 * What the child looks like — a rung on the shine ladder, and a colour.
 *
 * The two are independent, which is the whole reason a shiny Tide can exist
 * at all, so they are inherited by two unrelated rules and never traded off
 * against each other.
 */
function inheritAppearance(
  rng: Rng,
  first: Individual,
  second: Individual,
  applied: readonly BreedingItem[],
): string {
  const a = variant(first.variantId);
  const b = variant(second.variantId);
  const tier = inheritTier(rng, a.tier, b.tier, applied, first.level + second.level);
  return appearanceId(tier, inheritChroma(rng, a.chromaId, b.chromaId, applied));
}

/**
 * The shine ladder: the child starts at the average of its parents.
 *
 * Two true shinies always make a true shiny; a shiny and an ordinary make
 * something halfway. An odd sum cannot land between two rungs, so it falls to
 * one of the two either side with even odds — which is what keeps the matrix
 * symmetric rather than quietly rounding every pairing downward.
 *
 * On top of that sits the climb, which is the only way a lineage gains ground
 * it was not given — and how likely it is depends on how well the parents were
 * raised as well as on what they were.
 */
export function inheritTier(
  rng: Rng,
  first: number,
  second: number,
  applied: readonly BreedingItem[] = [],
  /** The two parents' levels added together. */
  levelSum = 0,
): number {
  const sum = first + second;
  let tier = sum % 2 === 0 ? sum / 2 : (sum - 1) / 2 + (rng() < 0.5 ? 0 : 1);

  const chance = climbChance(applied, levelSum);
  if (rng() * BASIS < chance) {
    tier += 1;
    while (tier < TOP_TIER && rng() < CASCADE) tier += 1;
  }

  return Math.min(TOP_TIER, tier);
}

/**
 * How likely a child is to climb a rung, in basis points.
 *
 * One predicate, two callers, as everywhere else: the panel showing the odds
 * and the roll that decides them are the same arithmetic, so the daycare can
 * never quote a number the engine does not use.
 */
export function climbChance(applied: readonly BreedingItem[], levelSum: number): number {
  const base = applied.includes("prism") ? CLIMB_CHANCE_WITH_PRISM : CLIMB_CHANCE;
  return Math.min(BASIS, base + Math.max(0, levelSum) * LEVEL_BASIS_POINTS + flatBonus(applied));
}

/**
 * What the light items and the Glitter add, in basis points.
 *
 * Read off the item catalogue rather than restated here. A second table of
 * "how much is a Lustre worth" is a second thing to forget to update, and the
 * bag already has to know the answer to print the blurb.
 */
export function flatBonus(applied: readonly BreedingItem[]): number {
  let total = 0;
  for (const id of applied) {
    if (isItem(id)) total += itemSpec(id).climbBonus ?? 0;
  }
  return total;
}

/**
 * The colour: carried, halved, or contested.
 *
 * Two of a colour always breed that colour. One of a colour is a coin flip.
 * Two different colours favour the parents but leave a slice for something
 * neither of them wore, so a line can drift somewhere new without being bred
 * for it. A lens then gets one chance to overrule the lot.
 */
export function inheritChroma(
  rng: Rng,
  first: string | null,
  second: string | null,
  applied: readonly BreedingItem[] = [],
): string | null {
  let colour: string | null;

  if (first && second && first === second) {
    colour = first;
  } else if (first && second) {
    const roll = rng();
    colour = roll < 0.4 ? first : roll < 0.8 ? second : CHROMA_IDS[intBelow(rng, CHROMA_IDS.length)];
  } else if (first || second) {
    colour = rng() < 0.5 ? (first ?? second) : null;
  } else {
    colour = null;
  }

  // Lenses are checked in a fixed order so two of them cannot depend on which
  // was toggled first. Each is an independent chance; the first to land wins.
  for (const item of [...applied].sort()) {
    const wanted = lensChroma(item);
    if (!wanted) continue;
    if (rng() < LENS_CHANCE) {
      colour = wanted;
      break;
    }
  }

  return colour;
}

/**
 * The mixing matrix: what two parent rungs produce, as per-mille odds over
 * the six rungs.
 *
 * Computed from the same rules `inheritTier` runs rather than tabulated
 * beside them, because a matrix that can disagree with the code is worse than
 * no matrix. Shown in the daycare, and asserted in a test.
 */
export function tierMatrix(
  first: number,
  second: number,
  applied: readonly BreedingItem[] = [],
  levelSum = 0,
): number[] {
  const odds = new Array<number>(TIER_COUNT).fill(0);
  const sum = first + second;
  const climb = climbChance(applied, levelSum);

  const starts = sum % 2 === 0 ? [[sum / 2, 1]] : [[(sum - 1) / 2, 0.5], [(sum + 1) / 2, 0.5]];

  for (const [start, share] of starts) {
    // Already at the top: the climb has nowhere to go, and that probability
    // stays where it is rather than evaporating. Dropping it is how a matrix
    // starts summing to 990 and nobody notices for a year.
    if (start >= TOP_TIER) {
      odds[TOP_TIER] += share * 1000;
      continue;
    }

    // Not climbing at all.
    odds[start] += share * (1 - climb / BASIS) * 1000;

    // Climbing, then cascading: each further rung is a tenth as likely, and
    // anything that would pass the top rung stops there.
    let mass = share * (climb / BASIS);
    for (let step = 1; start + step <= TOP_TIER; step++) {
      const lands = start + step === TOP_TIER ? mass : mass * (1 - CASCADE);
      odds[start + step] += lands * 1000;
      mass *= CASCADE;
    }
  }

  return odds;
}

/**
 * What colour a pairing is likely to produce, as per-mille odds.
 *
 * Computed rather than sampled, and from the same rules `inheritChroma` rolls
 * against. The lenses are the fiddly part: they are checked in a fixed order
 * and the first to land wins, so lens *i* only gets its chance if none of the
 * ones before it fired — which is a geometric series, not a sum.
 */
export function chromaOdds(
  first: string | null,
  second: string | null,
  applied: readonly BreedingItem[] = [],
): { id: string | null; share: number }[] {
  const share = new Map<string | null, number>();
  const add = (id: string | null, amount: number) =>
    share.set(id, (share.get(id) ?? 0) + amount);

  // What the parents alone would give.
  if (first && second && first === second) {
    add(first, 1);
  } else if (first && second) {
    add(first, 0.4);
    add(second, 0.4);
    for (const id of CHROMA_IDS) add(id, 0.2 / CHROMA_IDS.length);
  } else if (first || second) {
    add(first ?? second, 0.5);
    add(null, 0.5);
  } else {
    add(null, 1);
  }

  const lenses = [...applied].sort().map(lensChroma).filter((id): id is string => id !== null);
  if (lenses.length) {
    // Everything above survives only if no lens fires at all.
    const survives = (1 - LENS_CHANCE) ** lenses.length;
    for (const [id, amount] of [...share]) share.set(id, amount * survives);

    lenses.forEach((id, index) => {
      add(id, (1 - LENS_CHANCE) ** index * LENS_CHANCE);
    });
  }

  return [...share]
    .map(([id, amount]) => ({ id, share: amount * 1000 }))
    .filter((row) => row.share > 0.05)
    .sort((a, b) => b.share - a.share || String(a.id).localeCompare(String(b.id)));
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
  const mutated = new Set<StatId>(
    shuffle(rng, STAT_IDS).slice(0, mutatedSlots(applied, [first, second])),
  );

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

/**
 * How many stat slots mutate, given what the pairing has going for it.
 *
 * Two roads to the same number now: the Heirloom applied to the daycare, and a
 * Destiny Knot *carried by one of the pair*. Whichever gives more wins rather
 * than the two adding, because five of six slots is already most of them and a
 * seventh does not exist — so a player holding both has not wasted one, they
 * have brought a spare.
 */
function mutatedSlots(applied: readonly BreedingItem[], pair: readonly (Individual | null)[] = []): number {
  const fromItems = applied.includes("heirloom") ? INHERITED_SLOTS_WITH_HEIRLOOM : INHERITED_SLOTS;

  let fromHeld = INHERITED_SLOTS;
  for (const parent of pair) {
    for (const effect of heldEffects(parent?.heldItem ?? null)) {
      if (effect.t === "lineage") fromHeld = Math.max(fromHeld, effect.slots);
    }
  }

  return Math.max(fromItems, fromHeld);
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
