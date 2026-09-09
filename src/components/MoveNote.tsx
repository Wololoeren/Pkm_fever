"use client";

import { effectiveness, move as moveById } from "@/engine/dex";
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
 * against it. That is the one fact here the move alone cannot tell you, and
 * the type chart is right there.
 */

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

export function MoveNote({ moveId, against }: { moveId: string; against?: readonly string[] }) {
  const entry = moveById(moveId);
  const lands = against && entry.category !== "status" ? effectiveness(entry.type, against) : null;

  return (
    <span className="moveNote">
      <span className="moveNoteHead">
        <span className="typePill" style={{ background: typeColor(entry.type) }}>
          {entry.type}
        </span>
        <span className="muted">{entry.category}</span>
      </span>

      <span className="moveFacts">
        <span>{entry.category === "status" ? "No damage" : `${entry.power} power`}</span>
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
