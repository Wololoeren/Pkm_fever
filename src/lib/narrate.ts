import type { BattleEvent, SideIndex } from "@/engine/battle";
import { move as moveById, species as speciesById } from "@/engine/dex";
import type { Individual } from "@/engine/types";

/**
 * Turns the battle's structured events into sentences.
 *
 * The engine deliberately emits tags rather than strings, so that the words
 * the game uses are never part of a state hash and can be changed — or
 * translated — without invalidating a single save file. This is where they
 * become English.
 */

const STATUS_TEXT: Record<string, string> = {
  brn: "was burned",
  psn: "was poisoned",
  par: "was paralysed",
  slp: "fell asleep",
  frz: "was frozen solid",
};

const BLOCKED_TEXT: Record<string, string> = {
  slp: "is fast asleep",
  frz: "is frozen solid",
  par: "is paralysed and cannot move",
};

const STAT_NAMES: Record<string, string> = {
  atk: "Attack",
  def: "Defense",
  spa: "Sp. Atk",
  spd: "Sp. Def",
  spe: "Speed",
};

function effectivenessText(quarters: number): string {
  if (quarters === 0) return "";
  if (quarters > 4) return " It's super effective!";
  if (quarters < 4) return " It's not very effective.";
  return "";
}

export function narrate(
  events: readonly BattleEvent[],
  nameOf: (side: SideIndex) => string,
): string[] {
  const lines: string[] = [];

  for (const event of events) {
    switch (event.t) {
      case "use":
        lines.push(`${nameOf(event.side)} used ${moveById(event.moveId).name}!`);
        break;
      case "miss":
        lines.push(`${nameOf(event.side)}'s attack missed!`);
        break;
      case "immune":
        lines.push(`It doesn't affect ${nameOf(event.side)}.`);
        break;
      case "damage": {
        const crit = event.crit ? " A critical hit!" : "";
        lines.push(`${nameOf(event.side)} took ${event.amount}.${crit}${effectivenessText(event.quarters)}`);
        break;
      }
      case "status":
        lines.push(`${nameOf(event.side)} ${STATUS_TEXT[event.status] ?? "was afflicted"}!`);
        break;
      case "boost": {
        const direction = event.delta > 0 ? "rose" : "fell";
        const sharply = Math.abs(event.delta) > 1 ? " sharply" : "";
        lines.push(`${nameOf(event.side)}'s ${STAT_NAMES[event.stat]} ${direction}${sharply}!`);
        break;
      }
      case "heal":
        lines.push(`${nameOf(event.side)} recovered ${event.amount} HP.`);
        break;
      case "recoil":
        lines.push(`${nameOf(event.side)} was hit by recoil for ${event.amount}.`);
        break;
      case "blocked":
        lines.push(`${nameOf(event.side)} ${BLOCKED_TEXT[event.reason] ?? "cannot move"}!`);
        break;
      case "woke":
        lines.push(`${nameOf(event.side)} woke up!`);
        break;
      case "thawed":
        lines.push(`${nameOf(event.side)} thawed out!`);
        break;
      case "residual":
        lines.push(`${nameOf(event.side)} was hurt by its ${event.status === "brn" ? "burn" : "poison"} for ${event.amount}.`);
        break;
      case "faint":
        lines.push(`${nameOf(event.side)} fainted!`);
        break;
      case "switch":
        lines.push("Come back! Go!");
        break;
      case "exp": {
        lines.push(`Gained ${event.amount} EXP.`);
        if (event.levels > 0) lines.push(`Level up! (+${event.levels})`);
        for (const learned of event.learned) lines.push(`Learned ${moveById(learned).name}!`);
        if (event.evolved) lines.push(`It evolved into ${speciesById(event.evolved).name}!`);
        break;
      }
      case "catchFailed":
        lines.push("Argh! It broke free!");
        break;
      case "caught":
        lines.push("Gotcha! It was caught!");
        break;
      case "fleeFailed":
        lines.push("Couldn't get away!");
        break;
      case "fled":
        lines.push("Got away safely.");
        break;
      case "noBalls":
        lines.push("No balls left!");
        break;
    }
  }

  return lines;
}

export function displayName(individual: Individual): string {
  return individual.nickname ?? speciesById(individual.speciesId).name;
}
