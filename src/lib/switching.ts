import { actionRefusal, isFainted, type BattleState, type SideIndex } from "@/engine/battle";

/**
 * Who can be switched to, right now.
 *
 * Three answers: fainted, already out, and held by a trap. The trap is the
 * engine's own refusal predicate; the other two are what `switchTo` throws
 * on, asked here so the keyboard, the party cards and the button cannot
 * disagree about who is eligible.
 */
export function switchTargets(battle: BattleState, role: SideIndex): number[] {
  const side = battle.sides[role];
  return side.team
    .map((_, index) => index)
    .filter(
      (partyIndex) =>
        partyIndex !== side.active &&
        !isFainted(side.team[partyIndex]) &&
        actionRefusal(battle, role, { t: "switch", partyIndex }) === null,
    );
}

/**
 * The one to send without asking, or null.
 *
 * A picker with one thing in it is a question with one answer, and asking it
 * costs a click every time a creature faints with one left in reserve. So a
 * single eligible member goes out on its own, whether the switch was forced
 * or chosen.
 */
export function autoPick(battle: BattleState, role: SideIndex): number | null {
  const targets = switchTargets(battle, role);
  return targets.length === 1 ? targets[0] : null;
}

/** Which party member a number key means, if it may be sent out. */
export function pickByKey(battle: BattleState, role: SideIndex, key: string): number | null {
  if (!/^[1-6]$/.test(key)) return null;
  const index = Number(key) - 1;
  return switchTargets(battle, role).includes(index) ? index : null;
}
