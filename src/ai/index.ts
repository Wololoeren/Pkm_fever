import type { BattleAction, BattleState, SideIndex } from "@/engine/battle";
import weightsFile from "@/data/ai-weights.json";
import { oraclePolicy } from "./oracle";
import { linearPolicy, loadWeights, type Policy, type WeightsFile } from "./policy";

export { legalActions } from "./actions";
export { FEATURE_NAMES, featuresOf } from "./features";
export { oraclePolicy, oracleValues } from "./oracle";
export { linearPolicy, loadWeights, UNIFORM, type Policy, type Weights } from "./policy";

/** The weights that ship, checked against this build's feature list on load. */
export const TRAINED_WEIGHTS = loadWeights(weightsFile as WeightsFile);

/**
 * The linear policy over those weights: what plays the search's rollouts and
 * ranks the other side's replies, and the cheap opponent for anything that
 * cannot afford the search.
 */
export const TRAINED: Policy = linearPolicy(TRAINED_WEIGHTS, "trained");

/**
 * The opponent a trainer fields: the search.
 *
 * Six sets of dice, one rollout turn, the other side's three likeliest
 * replies. Chosen on mirror matches — same team both chairs, so only play
 * decides — where it beats the linear policy about six games in ten, and
 * deeper or wider settings won no more for twice the time. The time matters
 * because loading a save replays every trainer battle in it: at nine
 * milliseconds a decision, a long playthrough's trainers add a few seconds
 * to a load, which is the most this should ever be allowed to cost.
 */
export const SEARCH: Policy = oraclePolicy({
  samples: 6,
  horizon: 1,
  model: "predict",
  rollout: TRAINED,
  guess: TRAINED_WEIGHTS,
  matchupWeight: 500,
});

/**
 * What a trainer does this turn.
 *
 * The wild side keeps `aiAction`: a creature in the grass picking at random
 * is a design choice, not a gap, and its rolls are part of every save that
 * exists. Trainers, gym leaders, the rival and the cup go through here.
 */
export function trainerAction(state: BattleState, side: SideIndex = 1): BattleAction {
  return SEARCH.choose(state, side);
}
