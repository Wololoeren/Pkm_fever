import { learnableAt, learnset, species as speciesById } from "./dex";
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
  evolvedTo: string | null;
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
      evolvedTo: null,
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

  const evolvedTo = evolutionAt(grown);
  if (evolvedTo) grown = { ...grown, speciesId: evolvedTo };

  const afterStats = computeStats(speciesById(grown.speciesId), grown);
  return {
    individual: { ...grown, hp: Math.max(1, Math.round(afterStats.hp * hpFraction)) },
    levelsGained,
    movesLearned,
    movesOffered,
    evolvedTo,
  };
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
  const options = speciesById(individual.speciesId).evolvesTo.filter(
    (step) => step.method === "useItem" && step.item === itemName,
  );
  return options[0]?.id ?? null;
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
  const options = speciesById(individual.speciesId).evolvesTo.filter(
    (evolution) => evolution.method === "level" && evolution.level > 0 && individual.level >= evolution.level,
  );
  if (!options.length) return null;

  // evolvesTo is sorted by id at build time, so a species with two level
  // evolutions resolves the same way on every machine.
  return options[0].id;
}
