"use client";

import { useEffect, useRef } from "react";
import { move as moveById } from "@/engine/dex";
import { displayPower } from "@/engine/moves";
import { typeColor } from "@/render/palette";

/**
 * What a move actually does, on hover.
 *
 * The button already carries the two things you need every turn — its type
 * and its power — and stops there, which leaves accuracy, PP, priority and
 * every secondary effect invisible at the moment you are choosing between
 * them. A tooltip is the right place for the rest: needed sometimes, in the
 * way always.
 *
 * When there is something across from you it also says how the move lands
 * against it. That is the one fact here the move alone cannot tell you — and
 * it is handed in rather than worked out, because the type chart is not the
 * whole answer: a Scrappy reaches a Ghost and a Levitate turns aside an
 * Earthquake the chart says nothing about. `landsAs` in the engine knows all
 * three, the button's arrow reads the same number, and so the tooltip and the
 * arrow above it cannot come apart.
 *
 * It is placed rather than anchored, and that is not a style choice. The stat
 * screen's move list is a scroll box, and a scroll box clips what hangs out of
 * it however high its z-index is — so the note on the top row was cut off
 * against the ceiling of the list, which no amount of layering could fix. A
 * fixed note is outside the box entirely; the cost is that the coordinates
 * have to be measured, which CSS cannot do.
 */

/** Clearance between the note and the thing it belongs to. */
const GAP = 6;
/** How close to the window edge it may sit. */
const MARGIN = 8;

const STAT_NAMES: Record<string, string> = {
  hp: "HP",
  atk: "Attack",
  def: "Defence",
  spa: "Sp. Atk",
  spd: "Sp. Def",
  spe: "Speed",
  accuracy: "accuracy",
  evasion: "evasion",
};

const STATUS_NAMES: Record<string, string> = {
  brn: "a burn",
  psn: "poison",
  par: "paralysis",
  slp: "sleep",
  frz: "a freeze",
};

/** "+1 Attack, −2 Speed" — the shape a boost table is read in. */
function boostText(boosts: Record<string, number>): string {
  return Object.entries(boosts)
    .map(([stat, by]) => `${by > 0 ? "+" : "−"}${Math.abs(by)} ${STAT_NAMES[stat] ?? stat}`)
    .join(", ");
}

/** How a multiplier in quarters reads. 4 is neutral. */
function effectText(quarters: number): string {
  if (quarters === 0) return "no effect at all";
  if (quarters >= 16) return "quadruple damage";
  if (quarters >= 8) return "double damage";
  if (quarters === 4) return "normal damage";
  if (quarters === 2) return "half damage";
  return "a quarter damage";
}

export function MoveNote({
  moveId,
  /** Quarters, from the engine. Null wherever there is nothing to land on. */
  lands = null,
}: {
  moveId: string;
  lands?: number | null;
}) {
  const entry = moveById(moveId);
  const note = useRef<HTMLSpanElement>(null);

  // Above the row where there is room for it, below where there is not, and
  // never off the side. Measured when the pointer arrives rather than on every
  // render: nothing about the note moves until something is hovered, and a
  // hundred of these recalculating on mount would be a hundred layouts.
  useEffect(() => {
    const self = note.current;
    const anchor = self?.parentElement;
    if (!self || !anchor) return;

    const place = () => {
      const box = anchor.getBoundingClientRect();
      const above = box.top - self.offsetHeight - GAP;
      self.style.top = `${Math.round(above >= MARGIN ? above : box.bottom + GAP)}px`;
      self.style.left = `${Math.round(
        Math.max(MARGIN, Math.min(box.left, window.innerWidth - self.offsetWidth - MARGIN)),
      )}px`;
    };

    // Ancestor scrolls are watched only while the note is up, so a list of a
    // hundred moves is not a hundred scroll listeners.
    const follow = () => window.addEventListener("scroll", place, true);
    const drop = () => window.removeEventListener("scroll", place, true);
    const enter = () => {
      place();
      follow();
    };

    anchor.addEventListener("mouseenter", enter);
    anchor.addEventListener("focus", enter);
    anchor.addEventListener("mouseleave", drop);
    anchor.addEventListener("blur", drop);

    return () => {
      anchor.removeEventListener("mouseenter", enter);
      anchor.removeEventListener("focus", enter);
      anchor.removeEventListener("mouseleave", drop);
      anchor.removeEventListener("blur", drop);
      drop();
    };
  }, []);

  return (
    <span className="moveNote" ref={note}>
      <span className="moveNoteHead">
        <span className="typePill" style={{ background: typeColor(entry.type) }}>
          {entry.type}
        </span>
        <span className="muted">{entry.category}</span>
      </span>

      <span className="moveFacts">
        <span>
          {entry.category === "status"
            ? "No damage"
            : displayPower(entry) === null
              ? "Power depends on the battle"
              : `${displayPower(entry)} power`}
        </span>
        {/* Per blow, for the thirty-one that land more than once — the power
            beside it is one hit's worth, which reads as a feeble move until
            you know that. */}
        {entry.multihit ? (
          <span>
            {entry.multihit[0] === entry.multihit[1]
              ? `Hits ${entry.multihit[0]} times`
              : `Hits ${entry.multihit[0]} to ${entry.multihit[1]} times`}
            {entry.multiaccuracy ? ", each rolled to miss" : ""}
          </span>
        ) : null}
        {entry.alwaysCrit ? <span>Always a critical hit</span> : null}
        <span>{entry.accuracy === 0 ? "Never misses" : `${entry.accuracy}% accurate`}</span>
        <span>{entry.pp} PP</span>
        {entry.priority !== 0 ? (
          <span>{entry.priority > 0 ? `Goes first (+${entry.priority})` : `Goes last (${entry.priority})`}</span>
        ) : null}
        {entry.critRatio > 1 ? <span>Crits often</span> : null}
      </span>

      {entry.status ? <span>Leaves {STATUS_NAMES[entry.status] ?? entry.status}.</span> : null}
      {entry.boosts ? (
        <span>
          {/* A move's own boosts land on whoever it targets; only the
              secondary effect carries its own `self` flag. */}
          {entry.target === "self" ? "On itself: " : "On the target: "}
          {boostText(entry.boosts as Record<string, number>)}.
        </span>
      ) : null}
      {entry.secondary ? (
        <span>
          {entry.secondary.chance}% chance of{" "}
          {entry.secondary.status
            ? (STATUS_NAMES[entry.secondary.status] ?? entry.secondary.status)
            : entry.secondary.boosts
              ? boostText(entry.secondary.boosts as Record<string, number>)
              : "something"}
          .
        </span>
      ) : null}
      {entry.selfBoosts ? (
        // Red when it is a cost, which sixteen of the seventeen are. Diamond
        // Storm's is a reward and reads as one.
        <span
          className={
            Object.values(entry.selfBoosts.boosts).some((delta) => (delta ?? 0) < 0)
              ? "error"
              : undefined
          }
        >
          {entry.selfBoosts.chance < 100 ? `${entry.selfBoosts.chance}% chance of ` : ""}
          {boostText(entry.selfBoosts.boosts as Record<string, number>)} on itself.
        </span>
      ) : null}
      {entry.drain ? (
        <span>
          Heals back {entry.drain[0]}/{entry.drain[1]} of the damage it deals.
        </span>
      ) : null}
      {entry.recoil ? (
        <span className="error">
          Costs you {entry.recoil[0]}/{entry.recoil[1]} of the damage it deals.
        </span>
      ) : null}
      {entry.heal ? (
        <span>
          Restores {entry.heal[0]}/{entry.heal[1]} of full health.
        </span>
      ) : null}

      {lands !== null ? (
        <span className={lands > 4 ? "good" : lands < 4 ? "error" : "muted"}>
          Against what is out: {effectText(lands)}.
        </span>
      ) : null}
    </span>
  );
}
