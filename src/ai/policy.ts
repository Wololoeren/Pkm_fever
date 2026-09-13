import { aiAction, type BattleAction, type BattleState, type SideIndex } from "@/engine/battle";
import { intBelow, rngFor } from "@/engine/rng";
import { legalActions } from "./actions";
import { FEATURE_COUNT, FEATURE_NAMES, featuresOf } from "./features";

/** Something that decides. Pure in (state, side), like the engine it drives. */
export interface Policy {
  name: string;
  choose(state: BattleState, side: SideIndex): BattleAction;
}

/** One integer per feature, in the order of `FEATURE_NAMES`. */
export type Weights = number[];

/** What a trained policy is saved as. */
export interface WeightsFile {
  features: readonly string[];
  weights: Weights;
  /** Where the numbers came from. Informational. */
  trained?: Record<string, unknown>;
}

export interface Scored {
  action: BattleAction;
  features: number[];
  score: number;
}

/** The dot product, exact: integer weights over integer features. */
export function scoreOf(weights: Weights, features: number[]): number {
  let total = 0;
  for (let at = 0; at < FEATURE_COUNT; at++) total += weights[at] * features[at];
  return total;
}

export function scoreActions(weights: Weights, state: BattleState, side: SideIndex): Scored[] {
  return legalActions(state, side).map((action) => {
    const features = featuresOf(state, side, action);
    return { action, features, score: scoreOf(weights, features) };
  });
}

/**
 * The greedy policy over a weight vector.
 *
 * Argmax, with ties broken by the battle's own random stream rather than by
 * slot order, so two identical moves are not always the first one. Both
 * halves are deterministic in the state, which is what lets a trainer battle
 * sit inside a save file: the opponent's choices are never in the log, they
 * are recomputed from it.
 */
export function linearPolicy(weights: Weights, name = "linear"): Policy {
  if (weights.length !== FEATURE_COUNT) {
    throw new Error(`expected ${FEATURE_COUNT} weights, got ${weights.length}`);
  }
  return {
    name,
    choose(state, side) {
      const scored = scoreActions(weights, state, side);
      if (!scored.length) return { t: "pass" };
      let best = scored[0].score;
      for (const one of scored) if (one.score > best) best = one.score;
      const tied = scored.filter((one) => one.score === best);
      if (tied.length === 1) return tied[0].action;
      const roll = intBelow(rngFor(state.seed, state.tag, state.turn + 1, `policy${side}`), tied.length);
      return tied[roll].action;
    },
  };
}

/** The opponent the game shipped with: a usable move, at random. */
export const UNIFORM: Policy = { name: "uniform", choose: (state, side) => aiAction(state, side) };

/**
 * A policy that mostly follows another one and sometimes does anything legal.
 *
 * For collecting training positions: a teacher that only ever sees the
 * positions a good player reaches never learns what to do in a bad one. The
 * roll is named from the battle so a collection run is repeatable.
 */
export function explore(base: Policy, epsilonMille: number): Policy {
  return {
    name: `${base.name}+e${epsilonMille}`,
    choose(state, side) {
      const rng = rngFor(state.seed, state.tag, state.turn + 1, `explore${side}`);
      if (intBelow(rng, 1000) < epsilonMille) {
        const legal = legalActions(state, side);
        if (legal.length) return legal[intBelow(rng, legal.length)];
      }
      return base.choose(state, side);
    },
  };
}

/** Checks a weights file against the feature list this build knows. */
export function loadWeights(file: WeightsFile): Weights {
  const same =
    file.features.length === FEATURE_NAMES.length &&
    file.features.every((name, at) => name === FEATURE_NAMES[at]);
  if (!same) throw new Error("weights file was trained against a different feature list; retrain it");
  if (file.weights.length !== FEATURE_COUNT || file.weights.some((w) => !Number.isInteger(w))) {
    throw new Error("weights must be one integer per feature");
  }
  return file.weights;
}
