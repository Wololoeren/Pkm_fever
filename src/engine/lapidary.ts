import { ALL_SPECIES } from "./dex";
import { ITEMS } from "./items";
import { intBelow, weighted, type Rng } from "./rng";
import type { Individual } from "./types";

/**
 * The lapidary: a creature in, a stone out.
 *
 * He takes one off your hands and hands back an evolution stone of its type —
 * a Vulpix becomes a Fire Stone, a Poliwag a Water Stone. What he is for is
 * the other half of the problem the shredder solves: a box of things you
 * caught once is a box with no exit, and the twenty-two stones are otherwise
 * something you either find or do without.
 *
 * ## Where the type-to-stone table comes from
 *
 * There isn't one, and that is the point.
 *
 * A stone in this game has no type written on it: `items.ts` says as much at
 * length, because *which* species a stone opens is already in the manifest —
 * sixty-eight item evolutions, each naming its stone as a display string — and
 * "listing twenty-two stones against sixty-eight species here would be a
 * second copy of a table the manifest already has, free to disagree with it".
 *
 * The same argument applies twice over here. So the table is *derived*: for
 * every item evolution in the manifest, the stone is credited to the types of
 * the creature it evolves. Fire Stone is credited to fire because Vulpix,
 * Growlithe and Eevee-into-Flareon are what it opens. Nobody wrote that down;
 * a rebuilt roster changes it without this file knowing a single species name.
 *
 * ## Why the pick inside a type is weighted
 *
 * Because the counts mean something. Seven grass creatures evolve by Leaf
 * Stone and five by Sun Stone, so a grass type is mostly a Leaf Stone and
 * sometimes a Sun Stone — which is both the intuitive answer and a more
 * interesting one than a coin flip between them. Uniform *between the
 * creature's types*, as asked; weighted *within* one, because that is what the
 * manifest actually says.
 */

/** How long before he will take another. The shredder's gate, and the same
 * reasoning: this is an exchange you should be asked to think about, not a
 * conveyor. */
export const CUT_COOLDOWN = 1000;

/**
 * Every stone, credited to the types it opens.
 *
 * Built once at module load from the manifest. A type with nothing against it
 * — `ground`, today, because no ground type in this roster evolves by stone —
 * gets nothing, and `stoneFor` says what happens then.
 */
const BY_TYPE: ReadonlyMap<string, readonly { id: string; weight: number }[]> = (() => {
  const byName = new Map(ITEMS.filter((one) => one.evolves).map((one) => [one.name, one.id]));
  const counts = new Map<string, Map<string, number>>();

  for (const entry of ALL_SPECIES) {
    for (const step of entry.evolvesTo) {
      if (step.method !== "useItem" || !step.item) continue;
      const stone = byName.get(step.item);
      if (!stone) continue;

      // Credited to what the creature *is*, not what it becomes: you are
      // handing over the Vulpix, and the Vulpix is the fire type.
      for (const type of entry.types) {
        const bucket = counts.get(type) ?? new Map<string, number>();
        bucket.set(stone, (bucket.get(stone) ?? 0) + 1);
        counts.set(type, bucket);
      }
    }
  }

  const out = new Map<string, { id: string; weight: number }[]>();
  for (const [type, bucket] of counts) {
    out.set(
      type,
      // Sorted, so a rebuild on the same manifest produces the same draw
      // order and the same stone for the same roll.
      [...bucket]
        .map(([id, weight]) => ({ id, weight }))
        .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id)),
    );
  }
  return out;
})();

/**
 * Everything he will ever hand out, for the fallback and for the test that
 * keeps this honest — a table of one type is not a derivation.
 */
const EVERYTHING: readonly { id: string; weight: number }[] = (() => {
  const total = new Map<string, number>();
  for (const rows of BY_TYPE.values()) {
    for (const row of rows) total.set(row.id, (total.get(row.id) ?? 0) + row.weight);
  }
  return [...total]
    .map(([id, weight]) => ({ id, weight }))
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
})();

/** What this type is worth, for the panel to show before you commit. */
export function stonesForType(type: string): readonly { id: string; weight: number }[] {
  return BY_TYPE.get(type) ?? EVERYTHING;
}

/** Whether a type has stones of its own, or falls back to the whole table. */
export function typeHasStones(type: string): boolean {
  return BY_TYPE.has(type);
}

/**
 * What he gives for this one.
 *
 * Uniform between the creature's types — a Bulbasaur is as likely to come out
 * grass as poison — and then weighted within the type it landed on.
 *
 * A type with no stones of its own falls back to the whole table rather than
 * failing. There is exactly one of those today and it is `ground`; refusing a
 * Diglett at the counter would be a rule nobody could guess and a panel row
 * that greys out for reasons that live in a data file.
 */
export function stoneFor(rng: Rng, types: readonly string[]): string {
  const type = types.length ? types[intBelow(rng, types.length)] : "normal";
  const rows = stonesForType(type);
  if (!rows.length) return EVERYTHING[0]?.id ?? "stone-firestone";
  return weighted(rng, rows, (row) => row.weight).id;
}

/** Whether he will take another yet. */
export function cutReady(tick: number, cutAt: number | null): boolean {
  return cutAt === null || tick - cutAt >= CUT_COOLDOWN;
}

/** How many moves until he will. Zero when he is ready. */
export function cutWait(tick: number, cutAt: number | null): number {
  if (cutAt === null) return 0;
  return Math.max(0, CUT_COOLDOWN - (tick - cutAt));
}

/** The types he would draw from for this one, for the panel to name. */
export function cutTypes(creature: Individual, typesOf: (id: string) => readonly string[]): readonly string[] {
  return typesOf(creature.speciesId);
}
