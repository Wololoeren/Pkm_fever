import { resolveTurn, startBattle, TRAINER_RULES, type BattleAction, type BattleState } from "@/engine/battle";
import { intBelow, rngFor } from "@/engine/rng";
import { legalActions } from "./actions";
import { FEATURE_COUNT, featuresOf } from "./features";
import { oracleValues, type OracleOptions } from "./oracle";
import { linearPolicy, scoreOf, type Policy, type Weights } from "./policy";
import { randomMatchups, type TeamOptions } from "./teams";

/**
 * One decision the teacher was asked about: a row of features per legal
 * action, and what the teacher said each was worth.
 */
export interface Sample {
  features: number[][];
  values: number[];
}

export interface CollectOptions extends TeamOptions {
  /** Battles to play. */
  games?: number;
  /** Turns per battle before it is abandoned; long stalls teach little. */
  maxTurns?: number;
  /** How often, in thousandths, the side acting does something random instead. */
  epsilonMille?: number;
  oracle?: OracleOptions;
}

/**
 * Plays battles and asks the teacher about every decision in them.
 *
 * The moves actually played come from `student` when there is one, so the
 * positions collected are the ones the student's own habits lead to, which
 * is what it most needs correcting on. With no student the teacher's own
 * answer is played. Either way an epsilon share of turns is random, for the
 * positions nobody sensible reaches on purpose.
 */
export function collect(seed: string, student: Policy | null, options: CollectOptions = {}): Sample[] {
  const games = options.games ?? 20;
  const maxTurns = options.maxTurns ?? 60;
  const epsilon = options.epsilonMille ?? 100;
  const samples: Sample[] = [];

  for (const matchup of randomMatchups(seed, games, options)) {
    let state: BattleState = startBattle(seed, matchup.tag, matchup.a, matchup.b);
    while (!state.outcome && state.turn < maxTurns) {
      const actions: [BattleAction, BattleAction] = [{ t: "pass" }, { t: "pass" }];
      for (const side of [0, 1] as const) {
        const legal = legalActions(state, side);
        if (legal.length <= 1) {
          actions[side] = legal[0] ?? { t: "pass" };
          continue;
        }
        const valued = oracleValues(state, side, options.oracle);
        samples.push({
          features: valued.map((one) => featuresOf(state, side, one.action)),
          values: valued.map((one) => one.value),
        });

        const rng = rngFor(seed, matchup.tag, state.turn + 1, `collect${side}`);
        if (intBelow(rng, 1000) < epsilon) actions[side] = legal[intBelow(rng, legal.length)];
        else if (student) actions[side] = student.choose(state, side);
        else actions[side] = valued.reduce((best, one) => (one.value > best.value ? one : best)).action;
      }
      state = resolveTurn(state, actions, TRAINER_RULES).battle;
    }
  }
  return samples;
}

export interface FitOptions {
  /** Full-batch gradient steps. */
  epochs?: number;
  /** Adam's step size. */
  learningRate?: number;
  /**
   * How sharply the teacher's values are turned into a target distribution.
   * In the value's own units: the softmax of value / temperature. Small is
   * "only the best action counts"; large is "prefer better ones, gently".
   */
  temperature?: number;
  /** Weight decay, which keeps the quantised weights within a sane range. */
  l2?: number;
  /** Told the mean cross-entropy after each step, for watching it fall. */
  onLoss?: (epoch: number, loss: number) => void;
}

/**
 * Fits real-valued weights to the teacher's answers by gradient descent.
 *
 * A linear policy is a softmax over dot products, so its cross-entropy
 * gradient is a one-liner and needs no library: the mean feature under the
 * policy minus the mean feature under the target. Features are divided by a
 * thousand here so that the optimiser sees numbers near one; `quantize`
 * puts the scale back.
 *
 * Full-batch rather than one sample at a time. The dataset is a few thousand
 * rows of thirty numbers, so a whole pass costs nothing, and a full-batch
 * step is one that cannot make the loss worse for long: the per-sample
 * version was seen to *lose* agreement with every extra epoch, which is an
 * optimiser wandering rather than a model that had learned all it could.
 *
 * Deterministic in (samples, init, options), which makes a training run
 * repeatable. It is not promised to be bit-identical across machines the way
 * play is: only the integers it hands to `quantize` ship.
 */
export function fit(samples: readonly Sample[], init: readonly number[] | null, options: FitOptions = {}): number[] {
  const epochs = options.epochs ?? 300;
  const rate = options.learningRate ?? 0.05;
  const temperature = options.temperature ?? 300;
  const l2 = options.l2 ?? 1e-4;

  const w = init ? [...init] : new Array<number>(FEATURE_COUNT).fill(0);
  const m = new Array<number>(FEATURE_COUNT).fill(0);
  const v = new Array<number>(FEATURE_COUNT).fill(0);
  const beta1 = 0.9;
  const beta2 = 0.999;
  const count = Math.max(1, samples.length);

  // Scaled once; the rows never change.
  const rows = samples.map((sample) => ({
    features: sample.features.map((features) => features.map((one) => one / 1000)),
    target: softmax(sample.values.map((value) => value / temperature)),
  }));

  for (let epoch = 1; epoch <= epochs; epoch++) {
    const gradient = new Array<number>(FEATURE_COUNT).fill(0);
    let loss = 0;
    for (const { features, target } of rows) {
      const policy = softmax(features.map((x) => dot(w, x)));
      for (let row = 0; row < features.length; row++) {
        const delta = (policy[row] - target[row]) / count;
        for (let k = 0; k < FEATURE_COUNT; k++) gradient[k] += delta * features[row][k];
        if (target[row] > 0) loss -= (target[row] * Math.log(Math.max(policy[row], 1e-12))) / count;
      }
    }
    options.onLoss?.(epoch, loss);

    for (let k = 0; k < FEATURE_COUNT; k++) {
      const g = gradient[k] + l2 * w[k];
      m[k] = beta1 * m[k] + (1 - beta1) * g;
      v[k] = beta2 * v[k] + (1 - beta2) * g * g;
      const mHat = m[k] / (1 - Math.pow(beta1, epoch));
      const vHat = v[k] / (1 - Math.pow(beta2, epoch));
      w[k] -= (rate * mHat) / (Math.sqrt(vHat) + 1e-8);
    }
  }
  return w;
}

function dot(w: readonly number[], x: readonly number[]): number {
  let total = 0;
  for (let k = 0; k < FEATURE_COUNT; k++) total += w[k] * x[k];
  return total;
}

function softmax(logits: readonly number[]): number[] {
  let top = -Infinity;
  for (const one of logits) if (one > top) top = one;
  const exps = logits.map((one) => Math.exp(one - top));
  const sum = exps.reduce((total, one) => total + one, 0);
  return exps.map((one) => one / sum);
}

/**
 * Real weights to the integers that ship.
 *
 * The scale is the resolution the argmax sees, not a precision the policy
 * needs: a thousand gives three decimals of each weight, which is far more
 * than a preference order over a handful of actions can tell apart.
 */
export function quantize(weights: readonly number[], scale = 1000): Weights {
  return weights.map((one) => Math.round(one * scale));
}

export interface Report {
  samples: number;
  /** How often the student's pick is the teacher's, in thousandths. */
  agreementMille: number;
  /** Mean value lost by taking the student's pick instead of the teacher's. */
  meanRegret: number;
}

/** How well integer weights reproduce the teacher on a set of samples. */
export function report(samples: readonly Sample[], weights: Weights): Report {
  let agreed = 0;
  let regret = 0;
  for (const sample of samples) {
    let pick = 0;
    let bestScore = -Infinity;
    for (let row = 0; row < sample.features.length; row++) {
      const score = scoreOf(weights, sample.features[row]);
      if (score > bestScore) {
        bestScore = score;
        pick = row;
      }
    }
    const best = Math.max(...sample.values);
    if (sample.values[pick] === best) agreed++;
    regret += best - sample.values[pick];
  }
  const count = Math.max(1, samples.length);
  return {
    samples: samples.length,
    agreementMille: Math.floor((agreed * 1000) / count),
    meanRegret: Math.floor(regret / count),
  };
}

/**
 * Total value lost across the samples by taking the student's pick.
 *
 * The thing the policy is actually for. Cross-entropy is a smooth stand-in
 * for it that gradients can follow; this is the number itself, which is not
 * smooth and can only be walked.
 */
function totalRegret(samples: readonly Sample[], weights: Weights): number {
  let regret = 0;
  for (const sample of samples) {
    let pick = 0;
    let bestScore = -Infinity;
    for (let row = 0; row < sample.features.length; row++) {
      const score = scoreOf(weights, sample.features[row]);
      if (score > bestScore) {
        bestScore = score;
        pick = row;
      }
    }
    regret += Math.max(...sample.values) - sample.values[pick];
  }
  return regret;
}

export interface RefineOptions {
  /** Passes over every weight. Stops early when a pass changes nothing. */
  passes?: number;
  /** Step sizes tried on each weight, largest first. */
  steps?: readonly number[];
}

/**
 * Walks the integer weights downhill on regret, one coordinate at a time.
 *
 * Starts where the gradient fit ended and asks, for each weight in turn,
 * whether nudging it up or down by each step loses less value on the
 * samples; keeps any nudge that does. Coordinate descent on a step
 * function, which is crude and exactly right for the last mile: the fit has
 * found the neighbourhood, and the argmax only cares about the order of a
 * few scores, which a smooth loss cannot see.
 *
 * Deterministic, and integer throughout, so the weights it returns are the
 * ones that ship.
 */
export function refine(samples: readonly Sample[], start: Weights, options: RefineOptions = {}): Weights {
  const passes = options.passes ?? 6;
  const steps = options.steps ?? [1000, 300, 100, 30, 10];
  const weights = [...start];
  let best = totalRegret(samples, weights);

  for (let pass = 0; pass < passes; pass++) {
    let improved = false;
    for (let k = 0; k < FEATURE_COUNT; k++) {
      for (const step of steps) {
        for (const direction of [1, -1]) {
          const before = weights[k];
          weights[k] = before + direction * step;
          const regret = totalRegret(samples, weights);
          if (regret < best) {
            best = regret;
            improved = true;
          } else {
            weights[k] = before;
          }
        }
      }
    }
    if (!improved) break;
  }
  return weights;
}

export interface IterateOptions {
  seed: string;
  /** Rounds of collect-then-fit. The first round plays the teacher's moves. */
  iterations?: number;
  collect?: CollectOptions;
  fit?: FitOptions;
  refine?: RefineOptions;
  /** Weights to start from, real-valued. */
  init?: readonly number[] | null;
  log?: (line: string) => void;
}

export interface Iterated {
  weights: Weights;
  real: number[];
  samples: Sample[];
  reports: Report[];
}

/**
 * Expert iteration: collect under the current student, refit on everything
 * gathered so far, repeat.
 *
 * Everything so far rather than the latest batch, because the point of the
 * later rounds is to add the positions the student wanders into, not to
 * forget the ones the teacher showed it first.
 */
export function iterate(options: IterateOptions): Iterated {
  const iterations = options.iterations ?? 3;
  const log = options.log ?? (() => {});
  let real: number[] | null = options.init ? [...options.init] : null;
  let weights: Weights | null = real ? quantize(real) : null;
  const samples: Sample[] = [];
  const reports: Report[] = [];

  for (let round = 0; round < iterations; round++) {
    const student = weights ? linearPolicy(weights, `student${round}`) : null;
    // The student also plays the teacher's rollout turns once there is one:
    // a lookahead played out by a random walker undervalues every position
    // that needs a sensible next move to be worth anything.
    const oracle = { ...options.collect?.oracle, rollout: student ?? options.collect?.oracle?.rollout };
    const fresh = collect(`${options.seed}:${round}`, student, { ...options.collect, oracle });
    samples.push(...fresh);
    log(`round ${round}: ${fresh.length} decisions collected (${samples.length} total)`);

    real = fit(samples, real, options.fit);
    weights = refine(samples, quantize(real), options.refine);
    // The next round's fit continues from where the walk ended, not from
    // where the gradient left off, or the walk would be redone every round.
    real = weights.map((one) => one / 1000);
    const scored = report(samples, weights);
    reports.push(scored);
    log(`round ${round}: agreement ${scored.agreementMille / 10}%, mean regret ${scored.meanRegret}`);
  }

  return { weights: weights ?? quantize(new Array<number>(FEATURE_COUNT).fill(0)), real: real ?? [], samples, reports };
}
