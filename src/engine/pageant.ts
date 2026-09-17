import { species as speciesById } from "./dex";
import { item as itemSpec, isItem } from "./items";
import { heldEffects, PAGEANT_ITEMS } from "./carry";
import { abilitiesOf, hasPerk } from "./abilities";
import { rollPrize } from "./prize";
import { intBelow, intBetween, rngFor } from "./rng";
import { ivTotal } from "./stats";
import type { Individual } from "./types";
import { variant } from "./variants";

/**
 * The beauty pageant.
 *
 * Fifteen contestants, drawn the way a tournament's prizes are, at levels one
 * to seventy-five, and a new field every `PAGEANT_ROUND` steps. You enter one
 * creature per field; it wins a Ribbon only by outscoring every one of them.
 *
 * The score is plain arithmetic, shown on the board before you enter:
 *
 *   level
 * + 40 per shine rung
 * + the colour (Ivory 100, Onyx 90, the six hues 30–80)
 * + 20 per ability
 * + total IVs
 * + a pageant item's bonus, when it is held by a creature of its type
 *
 * Pure: the field is named from the seed and the round, so a replay — and
 * another player on the same seed at the same step count — sees the same
 * fifteen.
 */

/** Steps a field lasts before the next fifteen arrive. */
export const PAGEANT_ROUND = 2500;
/** How many contestants a field holds. */
export const PAGEANT_FIELD = 15;
/** How often a contestant is holding a pageant item, in percent. */
const CONTESTANT_ITEM_PERCENT = 30;

/** What a colour is worth on stage. */
export const CHROMA_SCORE: Readonly<Record<string, number>> = {
  ivory: 100,
  onyx: 90,
  teal: 80,
  umbral: 70,
  static: 60,
  tide: 50,
  ember: 40,
  verdant: 30,
};

export { PAGEANT_ITEMS } from "./carry";

/** The pageant bonus a creature's held item gives it, or 0. */
export function pageantItemBonus(creature: Individual): number {
  const types = speciesById(creature.speciesId).types as readonly string[];
  const anyType = hasPerk(creature, "humblebrag");
  let best = 0;
  for (const effect of heldEffects(creature.heldItem)) {
    if (effect.t !== "pageant") continue;
    if (anyType || effect.types.some((type) => types.includes(type))) best = Math.max(best, effect.bonus);
  }
  return best;
}

/** Every part of a score, for the board to show and the rule to add up. */
export function pageantParts(creature: Individual): { label: string; points: number }[] {
  const form = variant(creature.variantId);
  const parts = [
    { label: "Level", points: creature.level },
    { label: "Shine", points: (hasPerk(creature, "trendsetter") ? 80 : 40) * form.tier },
    {
      label: "Colour",
      points: (form.chromaId ? (CHROMA_SCORE[form.chromaId] ?? 30) : 0) * (hasPerk(creature, "colourcoordinated") ? 2 : 1),
    },
    { label: "Abilities", points: 20 * abilitiesOf(creature.abilities).length },
    { label: "IVs", points: ivTotal(creature.ivs) * (hasPerk(creature, "pretty") ? 5 : 1) },
    { label: "Photogenic", points: hasPerk(creature, "photogenic") ? 150 : 0 },
    {
      label: creature.heldItem && isItem(creature.heldItem) ? itemSpec(creature.heldItem).name : "Item",
      points: pageantItemBonus(creature),
    },
  ];
  return parts;
}

/** The score, all of it. */
export function pageantScore(creature: Individual): number {
  return pageantParts(creature).reduce((sum, part) => sum + part.points, 0);
}

/** Which field is on stage at this step count. */
export function pageantRound(stepsTaken: number): number {
  return Math.floor(stepsTaken / PAGEANT_ROUND);
}

/** The fifteen contestants of a round, as they always are. Bare, like a prize: no moves or health. */
export function pageantField(seed: string, round: number): Individual[] {
  const rng = rngFor(seed, "pageant", round);
  return Array.from({ length: PAGEANT_FIELD }, (_, at) => {
    const prize = rollPrize(rng, 16, 900_000 + at);
    const level = intBetween(rng, 1, 75);
    const heldItem =
      intBelow(rng, 100) < CONTESTANT_ITEM_PERCENT ? PAGEANT_ITEMS[intBelow(rng, PAGEANT_ITEMS.length)].id : null;
    return { ...prize, level, exp: level * level * level, heldItem, prize: false, caughtBy: "Pageant circuit" };
  });
}

/** The best score on stage this round: what a Ribbon has to beat. */
export function pageantToBeat(seed: string, round: number): number {
  return Math.max(...pageantField(seed, round).map(pageantScore));
}
