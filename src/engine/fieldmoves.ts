/**
 * Moves that do something when you are not in a battle.
 *
 * This game already has the HM idea, and it made a deliberate choice about it:
 * Cut, Surf, Strength, Rock Smash, Waterfall, Whirlpool, Dive, Rock Climb,
 * Flash and Fly are **items** you carry rather than moves you teach — see
 * `OBSTACLES` in terrain.ts, where each impassable tile names the tool that
 * answers it. "A key shaped like a verb", as the comment there puts it. That
 * is a better fit for a world with fifty routes and no HM-move economy, and
 * nothing here changes it.
 *
 * What it left out is the other half of the idea: the field moves that are not
 * keys at all. They do not open a tile, they *do* something — shake a tree,
 * draw a creature out of the grass, take you home, clear a map, hand over some
 * of your own health. None of those has an obstacle to be listed against, so
 * none of them existed.
 *
 * ## What is here, and why each one earns its place
 *
 * Every use below is built out of machinery the game already has, which is the
 * bar for being in this table at all:
 *
 * - **Headbutt** — the `TREE` tile has been solid scenery since the first
 *   route. Now it holds something. 122 species learn it, which makes it much
 *   the most widely useful thing in this file.
 * - **Sweet Scent** — the encounter census, drawn on demand instead of by
 *   walking. It takes the next slot in the same order, so it is a shortcut
 *   through the walking rather than a way to reroll what is waiting.
 * - **Dig** — `landAt(HUB_ID)`, which is what an Escape Rope already does. A
 *   rope you never run out of, paid for with a move slot.
 * - **Teleport** — `state.centre`, the Poké Center you last stood in. The
 *   blackout already knows how to send you there; this is asking for it.
 * - **Defog** — the fog-of-war bitset, filled in for the route you are on.
 * - **Milk Drink** and **Soft-Boiled** — health out of the user and into
 *   somebody else, which is the one kind of healing the bag cannot do.
 *
 * ## What is deliberately left out
 *
 * Rototiller wants soft soil to till and Secret Power wants a base to make,
 * and this world has neither. Flash is already the `hm-flash` item, and
 * `OBSTACLES` asks the bag rather than the party — giving the move the same job
 * would mean two answers to "can I see in here", which is the kind of pair that
 * drifts.
 */

import type { MoveEntry } from "./dex";

/** What using a move out in the world does. */
export type FieldUse =
  /** Headbutt: something comes out of the tree beside you. */
  | { t: "shake" }
  /** Sweet Scent: something comes out of the grass you are standing in. */
  | { t: "draw" }
  /** Dig: up and out, back to town. */
  | { t: "escape" }
  /** Teleport: back to the Center you last stood in. */
  | { t: "recall" }
  /** Defog: this route's map, filled in. */
  | { t: "reveal" }
  /**
   * Milk Drink and Soft-Boiled: your own health, given away.
   *
   * `share` is the denominator of the user's maximum that moves across, so a
   * half is `2`. It comes off the giver whether or not all of it is needed,
   * which is what stops it being a free full heal for the party.
   */
  | { t: "transfuse"; share: number };

export const FIELD_MOVES: Record<string, FieldUse> = {
  headbutt: { t: "shake" },
  sweetscent: { t: "draw" },
  dig: { t: "escape" },
  teleport: { t: "recall" },
  defog: { t: "reveal" },
  milkdrink: { t: "transfuse", share: 5 },
  softboiled: { t: "transfuse", share: 5 },
};

/** What this move does outside a battle, or null. */
export function fieldUse(moveId: string): FieldUse | null {
  return FIELD_MOVES[moveId] ?? null;
}

/** Whether it does anything outside a battle at all. */
export function hasFieldUse(move: MoveEntry): boolean {
  return FIELD_MOVES[move.id] !== undefined;
}

/**
 * Whether a field use needs somebody pointed at.
 *
 * One question rather than a check per caller: the engine asks it to decide
 * whether a missing target is a refusal, and the panel asks it to decide
 * whether to offer a picker.
 */
export function needsTarget(use: FieldUse): boolean {
  return use.t === "transfuse";
}

/** A short line for a button, since none of this is in the move's own blurb. */
export function fieldUseLabel(use: FieldUse): string {
  switch (use.t) {
    case "shake":
      return "Shake a tree beside you";
    case "draw":
      return "Draw something out of the grass";
    case "escape":
      return "Back to town";
    case "recall":
      return "Back to the last Poké Center";
    case "reveal":
      return "Fill in this route's map";
    case "transfuse":
      return "Give some of its health to another";
  }
}
