import {
  resolveTurn,
  TRAINER_RULES,
  type BattleAction,
  type BattleState,
  type SideIndex,
} from "@/engine/battle";
import { intBelow, rngFor } from "@/engine/rng";
import { legalActions } from "./actions";
import { scoreOf, type Policy, type Weights, UNIFORM } from "./policy";
import { featuresOf } from "./features";
import { evaluate } from "./value";

export interface OracleOptions {
  /**
   * How many times each pair of actions is played out, on differently named
   * dice. One is a single roll; three is enough to see a miss and a crit.
   */
  samples?: number;
  /**
   * Turns played on after the first, both sides driven by `rollout`, before
   * the position is scored. Nought is one turn of lookahead.
   */
  horizon?: number;
  /** Who plays the rollout turns. */
  rollout?: Policy;
  /**
   * How the other side's reply is guessed.
   *
   * `uniform` weights every legal reply equally: the honest model of an
   * opponent whose habits are unknown, and the one the student is trained
   * against. `predict` reads the same matrix from the other chair, ranks the
   * replies by what they are worth *to them*, and weights the best ones
   * more — an opponent who is also thinking one turn ahead — then hedges
   * toward the worst of those, so a plan that only works if they blunder
   * is marked down.
   */
  model?: "uniform" | "predict";
  /**
   * Linear weights to rank the other side's replies with, under `predict`.
   *
   * With them, only the top few replies by that ranking are played out at
   * all, which is most of the matrix gone. Without them the whole matrix is
   * played and ranked from the other chair, which is slower and is what the
   * teacher does when there is no student yet to rank with.
   */
  guess?: Weights;
  /** How much the leaf value weighs the matchup on the field. See `evaluate`. */
  matchupWeight?: number;
}

export interface Valued {
  action: BattleAction;
  /** What the action is worth, in the value's units. */
  value: number;
}

/**
 * Plays one turn from `state` on a renamed die, then `horizon` more.
 *
 * The tag is what names every roll in a battle, so a suffix on it is a new
 * set of dice for the same position without touching anything else. The
 * real dice are never used: a player that could see the next crit would be
 * gambling on numbers the other side's replay does not have.
 */
function playOut(
  state: BattleState,
  actions: [BattleAction, BattleAction],
  sample: number,
  horizon: number,
  rollout: Policy,
): BattleState {
  let next = resolveTurn({ ...state, tag: `${state.tag}~${sample}` }, actions, TRAINER_RULES).battle;
  for (let ahead = 0; ahead < horizon && !next.outcome; ahead++) {
    next = resolveTurn(next, [rollout.choose(next, 0), rollout.choose(next, 1)], TRAINER_RULES).battle;
  }
  return next;
}

/**
 * The payoff matrix: what every pair of (our action, their reply) is worth
 * to us, averaged over the dice. Ours down the rows, theirs across.
 */
export function payoffs(
  state: BattleState,
  side: SideIndex,
  ours: readonly BattleAction[],
  theirs: readonly BattleAction[],
  options: OracleOptions,
): number[][] {
  const samples = options.samples ?? 2;
  const horizon = options.horizon ?? 0;
  const rollout = options.rollout ?? UNIFORM;
  return ours.map((action) =>
    theirs.map((reply) => {
      const pair: [BattleAction, BattleAction] = side === 0 ? [action, reply] : [reply, action];
      let total = 0;
      for (let sample = 0; sample < samples; sample++) {
        total += evaluate(playOut(state, pair, sample, horizon, rollout), side, options.matchupWeight ?? 0);
      }
      return Math.floor(total / samples);
    }),
  );
}

/** How much more the best few predicted replies count than the rest. */
const PREDICTED_EXTRA = [4, 2, 1] as const;

/**
 * Every legal action for `side`, with what one turn of the real engine says
 * it is worth.
 *
 * Expensive by design: it runs the engine for every pair of things the two
 * sides might do, on several sets of dice, and reads the position that
 * results. Fast enough to play, because a turn is a few hundred integer
 * resolutions, and every one of them is deterministic — so it is also the
 * teacher whose answers a cheap policy is trained to reproduce.
 */
export function oracleValues(state: BattleState, side: SideIndex, options: OracleOptions = {}): Valued[] {
  const ours = legalActions(state, side);
  if (!ours.length) return [];
  const other = (1 - side) as SideIndex;
  let theirs = legalActions(state, other);
  if (!theirs.length) return ours.map((action) => ({ action, value: evaluate(state, side) }));

  const predicting = (options.model ?? "uniform") === "predict";
  // Pruned before anything is played: the replies the ranking thinks worst
  // are never resolved, and the ones left are already in their order.
  if (predicting && options.guess && theirs.length > 1) {
    const guess = options.guess;
    theirs = theirs
      .map((action) => ({ action, score: scoreOf(guess, featuresOf(state, other, action)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, PREDICTED_EXTRA.length)
      .map((one) => one.action);
  }

  const matrix = payoffs(state, side, ours, theirs, options);
  const replies = theirs.length;

  if (!predicting || replies === 1) {
    return ours.map((action, row) => ({
      action,
      value: Math.floor(matrix[row].reduce((sum, one) => sum + one, 0) / replies),
    }));
  }

  // The other chair. The value is zero-sum, so a column's mean, negated, is
  // what that reply is worth to them if they assume nothing about us.
  const theirWorth = theirs.map((_, column) => {
    let total = 0;
    for (let row = 0; row < ours.length; row++) total -= matrix[row][column];
    return Math.floor(total / ours.length);
  });
  const ranked = options.guess
    ? theirs.map((_, column) => column)
    : theirs.map((_, column) => column).sort((a, b) => theirWorth[b] - theirWorth[a] || a - b);
  const weight = new Array<number>(replies).fill(1);
  ranked.slice(0, PREDICTED_EXTRA.length).forEach((column, rank) => {
    weight[column] += PREDICTED_EXTRA[rank];
  });
  const weightTotal = weight.reduce((sum, one) => sum + one, 0);
  const likely = ranked.slice(0, PREDICTED_EXTRA.length);

  return ours.map((action, row) => {
    let expected = 0;
    for (let column = 0; column < replies; column++) expected += matrix[row][column] * weight[column];
    expected = Math.floor(expected / weightTotal);
    let worst = Infinity;
    for (const column of likely) worst = Math.min(worst, matrix[row][column]);
    // Three parts expectation to one part the worst of what they are likely
    // to do: enough hedge to refuse a coin-flip, not enough to play scared.
    return { action, value: Math.floor((3 * expected + worst) / 4) };
  });
}

/**
 * The search, playing directly.
 *
 * Argmax over `oracleValues`, ties broken by the battle's own stream. Pure
 * in the state, and integer from the first resolution to the last
 * comparison, which is what lets it sit behind a save file.
 */
export function oraclePolicy(options: OracleOptions = {}): Policy {
  return {
    name: `search(s${options.samples ?? 2},h${options.horizon ?? 0},${options.model ?? "uniform"})`,
    choose(state, side) {
      const valued = oracleValues(state, side, options);
      if (!valued.length) return { t: "pass" };
      let best = valued[0].value;
      for (const one of valued) if (one.value > best) best = one.value;
      const tied = valued.filter((one) => one.value === best);
      if (tied.length === 1) return tied[0].action;
      const roll = intBelow(rngFor(state.seed, state.tag, state.turn + 1, `search${side}`), tied.length);
      return tied[roll].action;
    },
  };
}
