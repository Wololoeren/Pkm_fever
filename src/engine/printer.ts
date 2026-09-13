import { inkFor, PRINTER_STOCK } from "./items";
import { CHROMA_IDS } from "./variants";

/**
 * The man with the 3D printer.
 *
 * He prints creatures in colour, which in this world means a chroma — and he
 * has run out of every ink but one. So the first thing he can make anybody is
 * ivory, and the other seven colours arrive as you find the cartridges for
 * them at the back of cabins on the far side of the map.
 *
 * ## Why he prints the last thing you saw
 *
 * Because it is the only specimen he has on file. He is not a shop and he is
 * not a wish: he prints from a scan, and the scan is whatever your last wild
 * encounter was. That turns an ordinary walk through the grass into the
 * *input* to the machine — you go and find the thing you want a copy of, come
 * back, and hope.
 *
 * It also keeps him honest against the rest of the game. A printer that made
 * any species on request would be a census with a menu, and the census is the
 * one thing this world will not put a menu in front of.
 *
 * ## Why it fails a quarter of the time
 *
 * A machine that always works is a vending machine, and the cooldown would be
 * the only cost. One that fails is a *gamble with a cooldown*, which is a very
 * different thing to walk back across the world for — and it is funnier: what
 * comes out of a failed print is a can of Slurm, because it had to be
 * something and the alternative was nothing at all.
 *
 * All of it is derived. The chance is rolled from the world seed and the tick
 * the attempt was made on, so a replay of the same log gets the same failures
 * — there is no rerolling a bad print by reloading.
 */

/** How long before the machine will run again, in moves. */
export const PRINT_COOLDOWN = 600;

/** The chance a print comes out as nothing, in per mille. */
export const PRINT_FAILS = 250;

/** What a failed print hands over instead. */
export const PRINT_CONSOLATION = "slurm";

/** What a print comes out at. */
export const PRINT_LEVEL = 5;

/**
 * The colours he can do right now.
 *
 * Ivory always — he never ran out of white, which is the joke — and every
 * other one whose cartridge is in your bag. The ink is *not* spent: it is a
 * key rather than a consumable, so a colour once opened stays open. See the
 * `ink` kind in items.ts for why.
 */
export function printable(has: (itemId: string) => boolean): string[] {
  return CHROMA_IDS.filter((id) => {
    const ink = inkFor(id);
    return ink === null || has(ink);
  });
}

/** The colours he is still missing, for him to complain about by name. */
export function missingInks(has: (itemId: string) => boolean): string[] {
  return CHROMA_IDS.filter((id) => {
    const ink = inkFor(id);
    return ink !== null && !has(ink);
  });
}

/** Whether the machine has cooled down, given when it last ran. */
export function printReady(tick: number, printedAt: number | null): boolean {
  return printedAt === null || tick - printedAt >= PRINT_COOLDOWN;
}

/** How many moves until it will run again. Zero when it is ready. */
export function printWait(tick: number, printedAt: number | null): number {
  if (printedAt === null) return 0;
  return Math.max(0, PRINT_COOLDOWN - (tick - printedAt));
}

/** The colour every printer starts with, re-exported so callers need one
 * import rather than two. */
export { PRINTER_STOCK };
