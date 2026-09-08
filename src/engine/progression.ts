import { learnset, species as speciesById } from "./dex";
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
    return { individual: { ...grown, hp: individual.hp }, levelsGained: 0, movesLearned: [], evolvedTo: null };
  }

  // Moves that became available across every level just passed, in the order
  // they would have been learned.
  const movesLearned: string[] = [];
  for (const [level, moveId] of learnset(grown.speciesId)) {
    if (level <= before || level > grown.level) continue;
    if (grown.moves.includes(moveId)) continue;

    // A full moveset does not silently overwrite anything. Choosing what to
    // forget is a decision that belongs to the player, which means it belongs
    // in the input log — so until that input exists, a full set simply keeps
    // what it has.
    if (grown.moves.length >= 4) continue;
    grown = { ...grown, moves: [...grown.moves, moveId] };
    movesLearned.push(moveId);
  }

  const evolvedTo = evolutionAt(grown);
  if (evolvedTo) grown = { ...grown, speciesId: evolvedTo };

  const afterStats = computeStats(speciesById(grown.speciesId), grown);
  return {
    individual: { ...grown, hp: Math.max(1, Math.round(afterStats.hp * hpFraction)) },
    levelsGained,
    movesLearned,
    evolvedTo,
  };
}

/** The species this creature should become, if any. Level-up evolutions only;
 * item and friendship evolutions arrive with the item system. */
export function evolutionAt(individual: Individual): string | null {
  const options = speciesById(individual.speciesId).evolvesTo.filter(
    (evolution) => evolution.method === "level" && evolution.level > 0 && individual.level >= evolution.level,
  );
  if (!options.length) return null;

  // evolvesTo is sorted by id at build time, so a species with two level
  // evolutions resolves the same way on every machine.
  return options[0].id;
}
