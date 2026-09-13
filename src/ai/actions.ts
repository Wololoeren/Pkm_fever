import {
  actionRefusal,
  activeOf,
  isFainted,
  type BattleAction,
  type BattleState,
  type SideIndex,
} from "@/engine/battle";
import { hasPp } from "@/engine/pp";

/**
 * Everything a side may do this turn, in a fixed order.
 *
 * The order matters, because a policy that scores two actions equally picks
 * the earlier one and a battle has to replay the same way on every machine:
 * moves by slot, then switches by party slot, then Struggle. Balls and
 * running are never offered — a trainer does not throw balls at your team,
 * and an opponent that could run would run from every losing position.
 *
 * Asked of `actionRefusal` for every candidate, so the list is exactly what
 * `resolveTurn` will accept. A policy choosing from anything else would hand
 * the other side a free turn when the engine refused it, which is the same
 * hole `aiAction` closes for the uniform opponent.
 */
export function legalActions(state: BattleState, side: SideIndex): BattleAction[] {
  if (state.outcome) return [];

  const combatant = state.sides[side];
  if (state.awaitingSwitch[side]) {
    const replacements = combatant.team
      .map((creature, at): BattleAction | null => (isFainted(creature) ? null : { t: "switch", partyIndex: at }))
      .filter((action): action is BattleAction => action !== null);
    return replacements.length ? replacements : [{ t: "pass" }];
  }
  // The other side owes a replacement and nothing else happens this turn.
  if (state.awaitingSwitch[1 - side]) return [{ t: "pass" }];

  const active = activeOf(state, side);
  if (!active.moves.length) return [{ t: "pass" }];

  const actions: BattleAction[] = [];
  for (let at = 0; at < active.moves.length; at++) {
    const action: BattleAction = { t: "fight", moveIndex: at };
    if (hasPp(active, at) && actionRefusal(state, side, action) === null) actions.push(action);
  }
  const fights = actions.length;
  for (let at = 0; at < combatant.team.length; at++) {
    if (at === combatant.active || isFainted(combatant.team[at])) continue;
    const action: BattleAction = { t: "switch", partyIndex: at };
    if (actionRefusal(state, side, action) === null) actions.push(action);
  }
  if (fights === 0) {
    // Struggle is asked of the engine like everything else, because the
    // engine decides it by whether any move is *permitted*, not by whether
    // any has uses left. A creature two turns into a Rollout with the slot
    // spent has no move it can name and no Struggle it is allowed, and what
    // the engine accepts from it is any fight at all: the forced move is
    // what resolves, whichever slot was named. Offer those.
    if (actionRefusal(state, side, { t: "struggle" }) === null) actions.push({ t: "struggle" });
    else {
      for (let at = 0; at < active.moves.length; at++) {
        const action: BattleAction = { t: "fight", moveIndex: at };
        if (actionRefusal(state, side, action) === null) actions.unshift(action);
      }
    }
  }
  return actions;
}

/** A stable one-line name for an action, for logs and datasets. */
export function actionKey(action: BattleAction): string {
  switch (action.t) {
    case "fight":
      return `fight:${action.moveIndex}`;
    case "switch":
      return `switch:${action.partyIndex}`;
    default:
      return action.t;
  }
}
