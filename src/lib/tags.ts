import type { Combatant } from "@/engine/battle";
import { BATTLE_STAT_IDS, type Individual } from "@/engine/types";
import type { AimStat, SideConditionId } from "@/engine/statusmoves";
import type { StageStat } from "@/engine/dex";

/**
 * Everything happening to one side of a battle, as badges.
 *
 * A burn has had a "BRN" under the name since the first battle screen, and
 * nothing else ever did — so a creature two Defense stages down, seeded,
 * drowsy and standing behind a Reflect looked exactly like one in perfect
 * health. All of it was in the log, once, on the turn it happened, and then it
 * scrolled away. This row answers "what is true *now*", which is a different
 * question from "what happened".
 *
 * This is display, like `narrate.ts` and `beats.ts` beside it. The engine
 * emits conditions as structure and never as words, so none of these strings
 * can reach a state hash: renaming DROWSY tomorrow invalidates no save.
 *
 * Read off the `Combatant` rather than the `Individual` on purpose, because
 * that is where the game keeps them — and where a condition is kept is a
 * statement about how long it lasts. Stages and volatiles belong to the
 * *appearance* and are gone the moment it switches out; screens belong to the
 * side and survive it; only `status` belongs to the creature and follows it
 * into the box. Three lifetimes, one row, and a player has no reason to care
 * which is which until they switch — at which point most of the row emptying
 * out is the explanation.
 */

export interface Badge {
  /** Stable across renders, so a row is not rebuilt from scratch every turn. */
  key: string;
  label: string;
  /** The long form, on hover. Nothing here explains itself at six characters. */
  title: string;
  /**
   * The modifier class after `.tag`, decided here rather than in the markup.
   *
   * Two of them for everything that is a change — `rise` and `fall`, coloured
   * by which direction it moved *for the creature wearing it*, so the foe's
   * ATK going up is green on the foe's plate even though it is bad news for
   * you. The five statuses keep the `st-` classes they have had since before
   * there was a row to put them in: they are conditions rather than
   * directions, and a paralysis has never been yellow by accident.
   */
  cls: string;
}

/*
 * Typed against `StageStat` rather than `string`, both of these, so that a
 * sixth stat ladder cannot be added to the game without the compiler asking
 * what its badge says. The same is true of the aim and screen tables below.
 * Only the volatiles have no such gate, which is what `tests/plate.ts` guards.
 */
const STAT_LABELS: Record<StageStat, string> = {
  atk: "ATK",
  def: "DEF",
  spa: "SPA",
  spd: "SPD",
  spe: "SPE",
};

const STAT_NAMES: Record<StageStat, string> = {
  atk: "Attack",
  def: "Defense",
  spa: "Sp. Atk",
  spd: "Sp. Def",
  spe: "Speed",
};

const AIM_LABELS: Record<AimStat, string> = { accuracy: "ACC", evasion: "EVA" };
const AIM_NAMES: Record<AimStat, string> = { accuracy: "Accuracy", evasion: "Evasiveness" };

const STATUS_NAMES: Record<string, string> = {
  brn: "Burned — it loses health every turn and hits softer",
  psn: "Poisoned — it loses health every turn",
  par: "Paralysed — slower, and it sometimes cannot move at all",
  slp: "Asleep — it cannot move until it wakes",
  frz: "Frozen solid — it cannot move until it thaws",
};

const SCREEN_LABELS: Record<SideConditionId, string> = {
  reflect: "REFLECT",
  lightscreen: "LIGHT SCR",
  mist: "MIST",
  safeguard: "SAFEGUARD",
  luckychant: "CHANT",
  tailwind: "TAILWIND",
};

const SCREEN_NAMES: Record<SideConditionId, string> = {
  reflect: "Reflect — physical moves land for half",
  lightscreen: "Light Screen — special moves land for half",
  mist: "Mist — its stats cannot be lowered",
  safeguard: "Safeguard — it cannot be given a status",
  luckychant: "Lucky Chant — it cannot be hit critically",
  tailwind: "Tailwind — double speed",
};

/**
 * How a stage count reads.
 *
 * The arrow carries the direction and the colour carries whether that is good
 * news, so a number is only wanted for the cases the arrow cannot count. One
 * stage is much the commonest and reads better with nothing after it: "DEF ↓"
 * rather than "DEF ↓1", which invites the question of what a ↓2 would be.
 */
function rungs(delta: number): string {
  const arrow = delta > 0 ? "↑" : "↓";
  const size = Math.abs(delta);
  return size === 1 ? arrow : `${arrow}${size}`;
}

function stageTitle(name: string, delta: number): string {
  const size = Math.abs(delta);
  return `${name} ${delta > 0 ? "raised" : "lowered"} ${size} stage${size === 1 ? "" : "s"}`;
}

/** "3 turns", "1 turn". Said often enough here to be worth one place. */
function turnsText(count: number): string {
  return `${count} turn${count === 1 ? "" : "s"}`;
}

/**
 * Everything worth a badge, in a fixed order.
 *
 * Fixed rather than in the order things happened, because a row that
 * reshuffles itself every turn has to be re-read every turn. Status first — it
 * is the one that outlives the battle — then the stat ladders, then what is
 * being done to this appearance, then what covers the whole side.
 *
 * The active creature is handed in rather than looked up out of the side,
 * because `activeOf` is how the rest of the game asks that question and a
 * second `side.team[side.active]` here would be a second answer waiting to
 * disagree with it.
 */
export function badgesFor(side: Combatant, creature: Individual): Badge[] {
  const out: Badge[] = [];

  if (creature.status) {
    out.push({
      key: `status:${creature.status}`,
      label: creature.status.toUpperCase(),
      title: STATUS_NAMES[creature.status] ?? creature.status,
      cls: `st-${creature.status}`,
    });
  }

  // The game's own list rather than `Object.keys`, so the order is fixed and
  // not whichever one the last move to touch a stage happened to insert.
  for (const stat of BATTLE_STAT_IDS) {
    const delta = side.stages[stat] ?? 0;
    if (!delta) continue;
    out.push({
      key: `stage:${stat}`,
      label: `${STAT_LABELS[stat]} ${rungs(delta)}`,
      title: stageTitle(STAT_NAMES[stat], delta),
      cls: delta > 0 ? "rise" : "fall",
    });
  }

  for (const which of ["accuracy", "evasion"] as AimStat[]) {
    const delta = side.aim?.[which] ?? 0;
    if (!delta) continue;
    out.push({
      key: `aim:${which}`,
      label: `${AIM_LABELS[which]} ${rungs(delta)}`,
      title: stageTitle(AIM_NAMES[which], delta),
      cls: delta > 0 ? "rise" : "fall",
    });
  }

  const vol = side.volatiles;
  if (vol) {
    if (vol.seeded) {
      out.push({
        key: "seeded",
        label: "SEEDED",
        title: "Seeded — some of its health goes across the field every turn",
        cls: "fall",
      });
    }
    if (vol.confusion) {
      out.push({
        key: "confused",
        label: "CONFUSED",
        title: `Confused — it may hurt itself instead, for ${turnsText(vol.confusion)} more`,
        cls: "fall",
      });
    }
    if (vol.yawn) {
      out.push({
        key: "drowsy",
        label: "DROWSY",
        title:
          vol.yawn === 1
            ? "Drowsy — it falls asleep at the end of this turn"
            : "Drowsy — it is about to fall asleep",
        cls: "fall",
      });
    }
    if (vol.nightmare) {
      out.push({
        key: "nightmare",
        label: "NIGHTMARE",
        title: "In a nightmare — it loses health every turn it stays asleep",
        cls: "fall",
      });
    }
    if (vol.perish !== undefined) {
      out.push({
        key: "perish",
        label: `PERISH ${vol.perish}`,
        title: `Perish Song — it faints in ${turnsText(vol.perish)} unless it switches out`,
        cls: "fall",
      });
    }
    if (vol.trapped) {
      out.push({
        key: "trapped",
        label: "TRAPPED",
        title: "Trapped — it cannot switch out and it cannot run",
        cls: "fall",
      });
    }
    if (vol.shield) {
      out.push({
        key: "shield",
        label: vol.shield === "endure" ? "ENDURE" : "SHIELD",
        title:
          vol.shield === "endure"
            ? "Braced — it survives this turn on one health"
            : "Protected — nothing lands on it this turn",
        cls: "rise",
      });
    }
    if (vol.crit) {
      out.push({
        key: "crit",
        label: `CRIT ${rungs(vol.crit)}`,
        title: stageTitle("Critical hit rate", vol.crit),
        cls: "rise",
      });
    }
  }

  // Screens last, and they say how long they have left: they are the only
  // badges in the row that switching out does not take away, so the number is
  // the one thing a player wants from them.
  for (const [id, turns] of Object.entries(side.screens ?? {})) {
    if (!turns) continue;
    const which = id as SideConditionId;
    out.push({
      key: `screen:${which}`,
      label: `${SCREEN_LABELS[which] ?? which.toUpperCase()} ${turns}`,
      title: `${SCREEN_NAMES[which] ?? which}, ${turnsText(turns)} left — and it stays up through a switch`,
      cls: "rise",
    });
  }

  return out;
}
