import { stageFactor, type BattleState, type Combatant } from "@/engine/battle";
import { BATTLE_STAT_IDS, type StatId } from "@/engine/types";

/**
 * What a battle is doing to a creature's numbers, for the stat sheet.
 *
 * The sheet shows what a creature *is* — base, IV, nature, effort, the
 * finished total — and none of that moves in a battle. What moves is the
 * slot: stat stages, a Power Split, a paralysis on its Speed. The badge row
 * on the battle screen already shows those as tags; this is the same facts
 * lined up against the numbers they multiply, which is where a player who
 * opened the sheet to ask "why is it hitting so softly" is looking.
 *
 * Null whenever there is nothing to say, and the column is not drawn at all:
 * outside a battle, for a creature that is not the one out, and for the one
 * out when nothing has touched it yet. A column of dashes is a column that
 * teaches a player to stop reading it.
 */

export interface StatMod {
  /** Stages, −6 to +6. Nought when only the other two apply. */
  stage: number;
  /** The stage's multiplier as a fraction, never a float. */
  factor: [number, number];
  /** Power Split, Guard Split, Speed Swap or Power Trick: the number in use. */
  override?: number;
  /** Paralysis, on Speed. */
  halved?: boolean;
}

export type StatMods = Partial<Record<StatId, StatMod>>;

export function battleMods(
  state: { battle: BattleState | null; phase: string },
  /** Party index of the creature on the sheet. */
  index: number,
): StatMods | null {
  if (!state.battle || state.phase !== "battle") return null;
  const side = state.battle.sides[0];
  if (side.active !== index) return null;
  return sideMods(side);
}

/**
 * The same facts read straight off a side, for the hover card on the battle
 * screen — which is where a player actually looks mid-fight, and where the
 * column was first missed. Null when nothing is modified, as above.
 */
export function sideMods(side: Combatant): StatMods | null {
  const creature = side.team[side.active];
  const mods: StatMods = {};
  for (const stat of BATTLE_STAT_IDS) {
    const stage = side.stages[stat] ?? 0;
    const override = side.volatiles?.stats?.[stat];
    const halved = stat === "spe" && creature.status === "par";
    if (stage === 0 && override === undefined && !halved) continue;
    mods[stat] = {
      stage,
      factor: stageFactor(stage),
      ...(override !== undefined ? { override } : {}),
      ...(halved ? { halved } : {}),
    };
  }
  return Object.keys(mods).length ? mods : null;
}

/** "+2", "−1", or "" for nought. The sign the sheet already uses for natures. */
export function stageText(stage: number): string {
  if (stage === 0) return "";
  return stage > 0 ? `+${stage}` : `−${-stage}`;
}

/**
 * One cell of a Mod column, for either screen: what to print, which way it
 * leans, and the tooltip that spells the multiplier out once.
 */
export function describeMod(mod: StatMod): { text: string; tone: "up" | "down" | "flat"; title: string } {
  const parts: string[] = [];
  const notes: string[] = [];
  if (mod.override !== undefined) {
    parts.push(`=${mod.override}`);
    notes.push(`${mod.override} in use, split or swapped with the foe's`);
  }
  if (mod.stage) {
    parts.push(stageText(mod.stage));
    notes.push(
      `${mod.stage > 0 ? "raised" : "lowered"} ${Math.abs(mod.stage)} stage${Math.abs(mod.stage) === 1 ? "" : "s"} (${factorText(mod.factor)})`,
    );
  }
  if (mod.halved) {
    parts.push("½");
    notes.push("halved by paralysis");
  }
  const tone = mod.stage < 0 || mod.halved ? "down" : mod.stage > 0 ? "up" : "flat";
  return { text: parts.join(" "), tone, title: notes.join("; ") };
}

/** "×2", "×0.67" — the multiplier, said once in the tooltip. */
export function factorText([numerator, denominator]: [number, number]): string {
  if (numerator === denominator) return "×1";
  const ratio = numerator / denominator;
  // Two places, with the trailing nought trimmed: ×1.5 rather than ×1.50,
  // and ×0.67 rather than ×0.6666.
  return `×${Number.isInteger(ratio) ? ratio : ratio.toFixed(2).replace(/0$/, "")}`;
}
