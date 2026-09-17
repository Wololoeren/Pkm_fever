import { heldEffects } from "./carry";
import { learnableAt, learnset, species as speciesById } from "./dex";
import { heldAfterEvolving, specialEvolutionAt, specialEvolutionByItem } from "./evolutions";
import { alignPp } from "./pp";
import { computeStats } from "./stats";
import type { Individual } from "./types";

/**
 * Levelling, learning and evolving — everything that happens to a creature
 * between battles rather than during one.
 *
 * One experience curve for every species. Vanilla has six, which exist to
 * make some lines feel slower than others; that is a lever worth having only
 * once the game has enough content for pacing to be a problem, and until then
 * it is six curves of arithmetic to keep bit-exact for no gain.
 */

export const MAX_LEVEL = 100;

/** How many moves a creature carries. Named here because growth is the thing
 * that runs into the limit; the engine re-exports it as MAX_MOVES. */
export const MOVE_SLOTS = 4;

/** Medium-fast: total experience needed to *be* this level. */
export function expForLevel(level: number): number {
  return level * level * level;
}

/** The level a total experience figure entitles a creature to. */
export function levelFromExp(exp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && exp >= expForLevel(level + 1)) level++;
  return level;
}

/** What defeating `loser` is worth to whatever beat it. */
export function expYield(loser: Individual): number {
  return Math.max(1, Math.floor((speciesById(loser.speciesId).baseExp * loser.level) / 7));
}

export interface GrowthResult {
  individual: Individual;
  levelsGained: number;
  movesLearned: string[];
  /**
   * Moves it grew into but had no room for.
   *
   * Reported rather than dropped, and reported rather than *applied*: which
   * move to forget is the player's decision, and a decision has to reach the
   * engine as an input or the save cannot replay it. So growth says what was
   * offered and stops there.
   */
  movesOffered: string[];
  /**
   * What it is *ready* to become, if anything — not what it became.
   *
   * Growth used to apply the evolution itself, and the field was called
   * `evolvedTo` because that is what it meant: by the time anybody read it,
   * the creature had already changed. Which left nowhere to stand to say no.
   *
   * Evolution is now an offer, for exactly the reason a move that will not fit
   * is an offer: it is the player's decision, and a decision has to reach the
   * engine as an *input* or the save cannot replay it. Growth says what is
   * ready and stops there; `evolve` below is what applies it, once somebody
   * has said yes.
   */
  evolveTo: string | null;
}

/**
 * Awards experience and applies everything that follows from it.
 *
 * A creature keeps the proportion of HP it had, rather than being healed by
 * levelling: gaining a level mid-battle should not be a free potion.
 */
export function awardExp(individual: Individual, amount: number): GrowthResult {
  const before = individual.level;
  const beforeStats = computeStats(speciesById(individual.speciesId), individual);
  const hpFraction = beforeStats.hp > 0 ? individual.hp / beforeStats.hp : 0;

  let grown: Individual = {
    ...individual,
    exp: individual.exp + Math.max(0, Math.floor(amount)),
  };
  grown = { ...grown, level: levelFromExp(grown.exp) };

  const levelsGained = grown.level - before;
  if (levelsGained <= 0) {
    return {
      individual: { ...grown, hp: individual.hp },
      levelsGained: 0,
      movesLearned: [],
      movesOffered: [],
      evolveTo: null,
    };
  }

  // Moves that became available across every level just passed, in the order
  // they would have been learned.
  const movesLearned: string[] = [];
  const movesOffered: string[] = [];
  for (const [level, moveId] of learnset(grown.speciesId)) {
    if (level <= before || level > grown.level) continue;
    if (grown.moves.includes(moveId)) continue;

    // A full moveset never silently overwrites anything. Room means it is
    // simply learned; no room means it is offered, and the offer waits in the
    // save until the player says what to forget. That way the choice is an
    // input like every other one, and a replay makes it again the same way.
    if (grown.moves.length >= MOVE_SLOTS) {
      if (!movesOffered.includes(moveId)) movesOffered.push(moveId);
      continue;
    }
    grown = alignPp({ ...grown, moves: [...grown.moves, moveId] }, grown);
    movesLearned.push(moveId);
  }

  // Read, and deliberately not applied. See `GrowthResult.evolveTo`.
  const evolveTo = evolutionAt(grown);

  const afterStats = computeStats(speciesById(grown.speciesId), grown);
  return {
    individual: { ...grown, hp: Math.max(1, Math.round(afterStats.hp * hpFraction)) },
    levelsGained,
    movesLearned,
    movesOffered,
    evolveTo,
  };
}

/**
 * Becoming the other thing, once somebody has said yes.
 *
 * Split out of `awardExp` so that the moment a creature changes is a moment
 * the player chose, reachable from three roads that all have to agree: growing
 * into it in a battle, growing into it on a Rare Candy, and a stone.
 *
 * The health fraction is kept across the change, exactly as levelling keeps
 * it. An evolution usually raises maximum HP, and a creature that came out of
 * it at the same *number* would have quietly lost a slice of its health bar —
 * which is the sort of thing nobody notices and everybody feels.
 */
export function evolve(individual: Individual, into: string): Individual {
  const beforeStats = computeStats(speciesById(individual.speciesId), individual);
  const fraction = beforeStats.hp > 0 ? individual.hp / beforeStats.hp : 0;

  // An item the evolution needed held is used up by it.
  const changed = { ...individual, speciesId: into, heldItem: heldAfterEvolving(individual, into) };
  const afterStats = computeStats(speciesById(into), changed);
  return { ...changed, hp: Math.max(1, Math.round(afterStats.hp * fraction)) };
}

/**
 * What this stone would turn this creature into, or null.
 *
 * The relation lives in the manifest — sixty-seven evolutions, each naming
 * its item as a display string — so this matches on the name the item carries
 * rather than on a table kept beside it. That is why the stones in items.ts
 * are generated from the same place: two lists would be two lists to keep in
 * step, and the manifest is the one that can be rebuilt.
 *
 * A species with two doors behind one stone (Pikachu and its two Raichus)
 * resolves the same way `evolutionAt` does: `evolvesTo` is sorted by id at
 * build time, so the first is the first on every machine.
 */
export function evolutionByItem(individual: Individual, itemName: string): string | null {
  if (heldAnchors(individual)) return null;

  const options = speciesById(individual.speciesId).evolvesTo.filter(
    (step) => step.method === "useItem" && step.item === itemName,
  );
  // The trades and the rest, used from the bag: see evolutions.ts.
  return options[0]?.id ?? specialEvolutionByItem(individual, itemName);
}

/**
 * Whether what it is carrying refuses to let it change.
 *
 * The Everstone, asked in this file rather than at the two call sites, because
 * there are two roads to an evolution and an item that blocked one of them
 * would be an item that half works. A stone used on an anchored creature is
 * refused with a reason; a level-up simply does not evolve it, which is what
 * the stone is for in the games that have it.
 */
function heldAnchors(individual: Individual): boolean {
  return heldEffects(individual.heldItem).some((effect) => effect.t === "anchor");
}

/**
 * Moves it once had the level for and does not know.
 *
 * Not "moves it forgot" — nothing is recorded when a move is dropped, and
 * nothing needs to be. A creature that has passed level twenty knows what its
 * species learns at twenty or it does not, and the difference between those
 * two is the whole list. Derived, like quest progress and everything else, so
 * a moveset rearranged in town changes the answer immediately.
 */
export function forgottenMoves(individual: Individual): string[] {
  return learnableAt(individual.speciesId, individual.level)
    .filter((moveId) => !individual.moves.includes(moveId))
    .sort();
}

/**
 * Whether this creature has anywhere left to grow.
 *
 * Any method counts, not just the ones the game acts on: a Happiny that could
 * only ever evolve by holding an Oval Stone is still not a finished creature,
 * and Eviolite asks exactly this question.
 */
export function canStillEvolve(individual: Individual): boolean {
  return speciesById(individual.speciesId).evolvesTo.length > 0;
}

/** The species this creature should become, if any. Level-up evolutions only;
 * a stone asks `evolutionByItem` instead, and friendship is on the deferred
 * list in docs/items-deferred.md because there is no friendship. */
export function evolutionAt(individual: Individual): string | null {
  if (heldAnchors(individual)) return null;

  const options = speciesById(individual.speciesId).evolvesTo.filter(
    (evolution) => evolution.method === "level" && evolution.level > 0 && individual.level >= evolution.level,
  );
  // Everything that is not a plain level — held items, moves, a Soothe Bell —
  // after the plain ones. See evolutions.ts.
  if (!options.length) return specialEvolutionAt(individual);

  // evolvesTo is sorted by id at build time, so a species with two level
  // evolutions resolves the same way on every machine.
  return options[0].id;
}
