import type { BattleEvent, SideIndex } from "@/engine/battle";
import { ability } from "@/engine/abilities";
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

/**
 * The two probability ladders, which are not stats and do not read like them.
 *
 * Kept apart from STAT_NAMES on purpose: "its Attack fell" and "its accuracy
 * fell" are different sentences, and the engine emits a different event for
 * each so this file can tell them apart.
 */
const AIM_NAMES: Record<string, string> = {
  accuracy: "accuracy",
  evasion: "evasiveness",
};

/**
 * What each condition sounds like when it lands, and when it bites.
 *
 * One entry per `VolatileKind`, because a condition the player cannot see is a
 * condition they will report as broken — which is exactly what happened to
 * Leech Seed. The words are here rather than in the engine so that changing
 * them cannot invalidate a save.
 */
const VOLATILE_TEXT: Record<string, string> = {
  seeded: "was seeded",
  // Landing and biting are two sentences. Sharing one made the turn a seed
  // took hold read as the game stuttering.
  sapped: "had its health sapped",
  confused: "became confused",
  // Not the same line as becoming confused. They were both "became confused"
  // for a moment, which reads as the game repeating itself rather than as the
  // creature having just punched itself.
  selfhit: "hurt itself in its confusion",
  snapped: "shook it off",
  shield: "protected itself",
  endure: "braced itself",
  crit: "is getting pumped",
  yawn: "grew drowsy",
  nightmare: "fell into a nightmare",
  dreaming: "is caught in a nightmare",
  trapped: "can no longer escape",
  drowsy: "grew drowsy",
};

const SCREEN_TEXT: Record<string, string> = {
  reflect: "Reflect came up",
  lightscreen: "Light Screen came up",
  mist: "a mist gathered",
  safeguard: "Safeguard is watching",
  luckychant: "a chant went up",
  tailwind: "the wind is behind it",
};

const STAT_NAMES: Record<string, string> = {
  // HP is here for effort, which can land in it. Stat stages never do.
  hp: "HP",
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
      case "effort": {
        // Named per stat, because effort is the one stat input a player
        // directs — "it got stronger" would hide the only decision here.
        lines.push(`Effort: +${event.amount} ${event.stats.map((stat) => STAT_NAMES[stat]).join(" and ")}.`);
        break;
      }

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
      case "timeout":
        lines.push("The battle has gone on long enough — it is decided on health.");
        break;
      case "struggling":
        lines.push(`${nameOf(event.side)} has nothing left, and struggles!`);
        break;
      case "ability":
        lines.push(`${nameOf(event.side)}'s ${ability(event.abilityId).name}!`);
        break;
      case "fizzled":
        // Not a miss and not a hit of zero. Endeavor against something already
        // weaker, Counter with nothing to answer — the move happened and came
        // to nothing, and saying "it took 0" would be a different claim.
        lines.push(`${moveById(event.moveId).name} came to nothing.`);
        break;
      case "aim": {
        const direction = event.delta > 0 ? "rose" : "fell";
        const sharply = Math.abs(event.delta) > 1 ? " sharply" : "";
        lines.push(`${nameOf(event.side)}'s ${AIM_NAMES[event.which]} ${direction}${sharply}!`);
        break;
      }
      case "volatile":
        lines.push(`${nameOf(event.side)} ${VOLATILE_TEXT[event.which] ?? "was affected"}!`);
        break;
      case "screen":
        lines.push(`On ${nameOf(event.side)}'s side, ${SCREEN_TEXT[event.which] ?? "something went up"}!`);
        break;
      case "shielded":
        lines.push(`${nameOf(event.side)} protected itself!`);
        break;
      case "perish":
        // Counted down out loud, because a number nobody can see is a creature
        // that faints for no reason three turns later.
        lines.push(
          event.turns > 0
            ? `${nameOf(event.side)}'s count fell to ${event.turns}.`
            : `${nameOf(event.side)}'s count reached zero!`,
        );
        break;
      case "transformed":
        lines.push(`${nameOf(event.side)} transformed into ${speciesById(event.into).name}!`);
        break;
      case "sketched":
        lines.push(`${nameOf(event.side)} sketched ${moveById(event.moveId).name}!`);
        break;
    }
  }

  return lines;
}

export function displayName(individual: Individual): string {
  return individual.nickname ?? speciesById(individual.speciesId).name;
}
