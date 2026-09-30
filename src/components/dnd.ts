"use client";

import type { DragEvent } from "react";

/**
 * Dragging things about with a mouse.
 *
 * The game can be played entirely with buttons — every drag below is a thing
 * you can also click — but arranging a party and a box of two hundred through
 * ▲ and ▼ is a hundred clicks where a hand wants one gesture. So the party
 * reorders by dragging, creatures move between the party and the boxes by
 * dragging, and an item is given or used by dropping it on somebody.
 *
 * One vocabulary for all of it, in one file, because the alternative is four
 * components each inventing a payload format and three of them agreeing.
 *
 * The payload rides on a private media type rather than `text/plain`. Two
 * reasons: text dragged in from outside the page — a word from a document, a
 * link — cannot be mistaken for a creature, and `dragover` can ask *what* is
 * being dragged before it agrees to take it, which is what lets a drop target
 * light up only for things it can actually accept. (`getData` is deliberately
 * unreadable during `dragover`; `types` is not.)
 */

/** What is being dragged. */
export type Dragged =
  /** Somebody in the party, by slot. */
  | { t: "party"; index: number; uid: number }
  /** Somebody in the box, by their place in the whole box list. */
  | { t: "box"; index: number; uid: number }
  /** An item from the bag, by id. */
  | { t: "item"; id: string };

const DND_TYPE = "application/x-pkm-fever";

/** Starts a drag, and says what is in hand. */
export function startDrag(event: DragEvent, what: Dragged): void {
  event.dataTransfer.setData(DND_TYPE, JSON.stringify(what));
  // A plain-text copy as well, so dropping one outside the game does
  // something legible rather than nothing.
  event.dataTransfer.setData("text/plain", what.t === "item" ? what.id : String(what.uid));
  event.dataTransfer.effectAllowed = "move";
}

/** Whether this drag is one of ours at all. Safe to ask during `dragover`. */
export function isOurs(event: DragEvent): boolean {
  return event.dataTransfer.types.includes(DND_TYPE);
}

/** What was dropped, or null if it was not ours or not readable. */
export function readDrag(event: DragEvent): Dragged | null {
  try {
    const raw = event.dataTransfer.getData(DND_TYPE);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const what = parsed as Dragged;
    if (what.t === "item") return typeof what.id === "string" ? what : null;
    if (what.t === "party" || what.t === "box") {
      return Number.isInteger(what.index) && Number.isInteger(what.uid) ? what : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The props a drop target needs, given what it does with a drop.
 *
 * `onDragOver` has to call `preventDefault` or the browser refuses the drop
 * outright — the one piece of this API that is pure ceremony, and the one
 * everybody forgets, so it is written once here.
 */
export function dropTarget(
  takes: (what: Dragged) => boolean,
  onDropped: (what: Dragged) => void,
): {
  onDragOver: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
} {
  return {
    onDragOver: (event) => {
      if (!isOurs(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    },
    onDrop: (event) => {
      const what = readDrag(event);
      if (!what || !takes(what)) return;
      event.preventDefault();
      event.stopPropagation();
      onDropped(what);
    },
  };
}
