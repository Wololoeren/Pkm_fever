import { describe, expect, it } from "vitest";
import { SEARCH, TRAINED, TRAINED_WEIGHTS, trainerAction } from "@/ai";
import { legalActions } from "@/ai/actions";
import { arena, playMatch } from "@/ai/arena";
import { FEATURE_COUNT, FEATURE_NAMES, featuresOf } from "@/ai/features";
import { oraclePolicy, oracleValues } from "@/ai/oracle";
import { explore, linearPolicy, loadWeights, UNIFORM } from "@/ai/policy";
import { randomMatchups } from "@/ai/teams";
import { collect, fit, quantize, refine, report } from "@/ai/train";
import { evaluate, WIN_VALUE } from "@/ai/value";
import weightsFile from "@/data/ai-weights.json";
import {
  actionRefusal,
  battleHash,
  DUEL_RULES,
  resolveTurn,
  startBattle,
  type BattleAction,
  type BattleState,
} from "@/engine/battle";
import { creature } from "./helpers";

const SEED = "ai-suite";

function fresh(tag = "t"): BattleState {
  return startBattle(
    SEED,
    tag,
    [creature("charmander", { level: 20, moves: ["ember", "scratch", "growl"], uid: 1 }), creature("squirtle", { level: 20, uid: 2 })],
    [creature("bulbasaur", { level: 20, moves: ["vinewhip", "tackle"], uid: 3 }), creature("pidgey", { level: 20, uid: 4 })],
  );
}

describe("legal actions", () => {
  it("offers every move with uses and every healthy bench member, in slot order", () => {
    const actions = legalActions(fresh(), 0);
    expect(actions).toEqual([
      { t: "fight", moveIndex: 0 },
      { t: "fight", moveIndex: 1 },
      { t: "fight", moveIndex: 2 },
      { t: "switch", partyIndex: 1 },
    ]);
  });

  it("offers nothing the engine would refuse", () => {
    const state = fresh();
    for (const side of [0, 1] as const) {
      for (const action of legalActions(state, side)) {
        expect(actionRefusal(state, side, action)).toBeNull();
      }
    }
  });

  it("offers Struggle, and only Struggle, when every slot is spent", () => {
    const state = fresh();
    state.sides[0].team[0].pp = [0, 0, 0];
    state.sides[0].team[1].hp = 0;
    expect(legalActions(state, 0)).toEqual([{ t: "struggle" }]);
  });

  it("offers only replacements to a side that owes one, and only a pass to the other", () => {
    const state = fresh();
    state.sides[0].team[0].hp = 0;
    state.awaitingSwitch = [true, false];
    expect(legalActions(state, 0)).toEqual([{ t: "switch", partyIndex: 1 }]);
    expect(legalActions(state, 1)).toEqual([{ t: "pass" }]);
  });

  it("offers nothing once the battle is over", () => {
    const state = { ...fresh(), outcome: { t: "win", side: 0 } as const };
    expect(legalActions(state, 0)).toEqual([]);
  });
});

describe("features", () => {
  it("are one integer per named feature", () => {
    const state = fresh();
    for (const action of legalActions(state, 0)) {
      const features = featuresOf(state, 0, action);
      expect(features).toHaveLength(FEATURE_COUNT);
      for (const one of features) expect(Number.isInteger(one)).toBe(true);
    }
    expect(new Set(FEATURE_NAMES).size).toBe(FEATURE_COUNT);
  });

  it("read the type chart: Ember into Bulbasaur is the effective one", () => {
    const state = fresh();
    const at = (name: (typeof FEATURE_NAMES)[number]) => FEATURE_NAMES.indexOf(name);
    const ember = featuresOf(state, 0, { t: "fight", moveIndex: 0 });
    const scratch = featuresOf(state, 0, { t: "fight", moveIndex: 1 });
    const growl = featuresOf(state, 0, { t: "fight", moveIndex: 2 });
    expect(ember[at("effect")]).toBe(2000);
    expect(ember[at("stab")]).toBe(1000);
    expect(scratch[at("effect")]).toBe(1000);
    expect(ember[at("dmg_of_hp")]).toBeGreaterThan(scratch[at("dmg_of_hp")]);
    expect(growl[at("status_move")]).toBe(1000);
    expect(growl[at("lowers_target")]).toBe(250);
    expect(growl[at("dmg_of_hp")]).toBe(0);
  });

  it("see a switch as the incoming creature's matchup, not the outgoing one's", () => {
    const state = fresh();
    const at = (name: (typeof FEATURE_NAMES)[number]) => FEATURE_NAMES.indexOf(name);
    const swap = featuresOf(state, 0, { t: "switch", partyIndex: 1 });
    expect(swap[at("switch")]).toBe(1000);
    expect(swap[at("fight")]).toBe(0);
    // Squirtle's Tackle is neutral into Bulbasaur; Bulbasaur's Vine Whip is double into Squirtle.
    expect(swap[at("in_offence")]).toBe(1000);
    expect(swap[at("in_defence")]).toBe(2000);
    expect(swap[at("in_hp")]).toBe(1000);
  });
});

describe("the policy", () => {
  it("is a pure function of the state: the same position gets the same action, always", () => {
    const state = fresh();
    const first = trainerAction(state, 1);
    for (let again = 0; again < 20; again++) expect(trainerAction(state, 1)).toEqual(first);
    expect(legalActions(state, 1)).toContainEqual(first);
  });

  it("never hands the engine something it refuses, across whole battles", () => {
    for (const matchup of randomMatchups(SEED, 12, { size: 3 })) {
      let state = startBattle(SEED, matchup.tag, matchup.a, matchup.b);
      while (!state.outcome) {
        const actions: [BattleAction, BattleAction] = [TRAINED.choose(state, 0), TRAINED.choose(state, 1)];
        for (const side of [0, 1] as const) expect(actionRefusal(state, side, actions[side])).toBeNull();
        state = resolveTurn(state, actions, DUEL_RULES).battle;
      }
    }
  });

  it("prefers the super-effective STAB move when the weights say damage matters", () => {
    const state = fresh();
    expect(trainerAction(state, 0)).toEqual({ t: "fight", moveIndex: 0 });
  });

  it("breaks a tie with the battle's own stream rather than always the first slot", () => {
    const state = startBattle(
      SEED,
      "tie",
      [creature("rattata", { level: 20, moves: ["tackle", "tackle", "tackle", "tackle"] })],
      [creature("pidgey", { level: 20 })],
    );
    const picks = new Set<number>();
    for (let turn = 0; turn < 40; turn++) {
      const chosen = TRAINED.choose({ ...state, turn }, 0);
      if (chosen.t === "fight") picks.add(chosen.moveIndex);
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it("refuses a weights file trained against another feature list", () => {
    expect(() => loadWeights({ features: ["fight"], weights: [1] })).toThrow(/feature list/);
    expect(() => loadWeights({ features: FEATURE_NAMES, weights: TRAINED_WEIGHTS.map((w) => w + 0.5) })).toThrow(/integer/);
    expect(() => linearPolicy([1, 2, 3])).toThrow(/weights/);
  });

  it("ships weights that match this build", () => {
    expect(loadWeights(weightsFile)).toEqual(TRAINED_WEIGHTS);
  });
});

describe("the arena", () => {
  it("plays a deterministic match, and the same match again is the same match", () => {
    const matchup = randomMatchups(SEED, 1)[0];
    const once = playMatch(SEED, matchup.tag, [matchup.a, matchup.b], [TRAINED, UNIFORM]);
    const twice = playMatch(SEED, matchup.tag, [matchup.a, matchup.b], [TRAINED, UNIFORM]);
    expect(twice).toEqual(once);
    expect(once.turns).toBeGreaterThan(0);
  });

  it("scores the shipped policy well clear of picking at random", () => {
    const result = arena(SEED, randomMatchups(`${SEED}:arena`, 40, { size: 3 }), TRAINED, UNIFORM);
    expect(result.games).toBe(80);
    expect(result.shareMille).toBeGreaterThan(600);
  });

  it("deals level-matched teams, so a matchup is decided by play rather than by levels", () => {
    for (const matchup of randomMatchups(SEED, 20, { size: 3, levels: [20, 50], spread: 3 })) {
      const levels = [...matchup.a, ...matchup.b].map((one) => one.level);
      expect(Math.max(...levels) - Math.min(...levels)).toBeLessThanOrEqual(6);
      for (const one of [...matchup.a, ...matchup.b]) {
        expect(one.moves.length).toBeGreaterThan(0);
        expect(one.hp).toBeGreaterThan(0);
      }
    }
  });
});

describe("the teacher", () => {
  it("values an even start near nought, a win as the health that won it plus a bonus, and is zero-sum", () => {
    const state = fresh();
    expect(Math.abs(evaluate(state, 0))).toBeLessThan(500);
    expect(evaluate(state, 0) + evaluate(state, 1)).toBe(0);
    const won = { ...state, outcome: { t: "win", side: 1 } as const };
    expect(evaluate(won, 1) - evaluate(won, 0)).toBe(2 * WIN_VALUE);
    // The bonus is small next to a body: one hit from won and won are neighbours.
    expect(WIN_VALUE).toBeLessThan(2000);
  });

  it("marks a position down when the creature on the field is outmatched", () => {
    const state = fresh();
    // Charmander into Bulbasaur reaches further than Bulbasaur into Charmander.
    expect(evaluate(state, 0, 500)).toBeGreaterThan(evaluate(state, 0));
  });

  it("values every legal action, and does not disturb the battle it was asked about", () => {
    const state = fresh();
    const before = battleHash(state);
    const valued = oracleValues(state, 0, { samples: 2, horizon: 1 });
    expect(valued.map((one) => one.action)).toEqual(legalActions(state, 0));
    expect(battleHash(state)).toBe(before);
    expect(state.turn).toBe(0);
  });

  it("puts Ember above Growl for a Charmander facing a Bulbasaur", () => {
    const valued = oracleValues(fresh(), 0, { samples: 3 });
    const value = (index: number) => valued.find((one) => one.action.t === "fight" && one.action.moveIndex === index)!.value;
    expect(value(0)).toBeGreaterThan(value(2));
  });

  it("beats the linear policy it grew out of, on mirror matches where only play decides", () => {
    const mirror = randomMatchups(`${SEED}:mirror`, 30, { size: 3 }).map((one) => ({
      ...one,
      b: one.a.map((creature) => ({ ...creature, uid: creature.uid + 100 })),
    }));
    const result = arena(SEED, mirror, SEARCH, TRAINED);
    expect(result.shareMille).toBeGreaterThan(500);
  });

  it("plays as a policy that beats picking at random", () => {
    const result = arena(SEED, randomMatchups(`${SEED}:teacher`, 10, { size: 2 }), oraclePolicy({ samples: 2 }), UNIFORM);
    expect(result.shareMille).toBeGreaterThan(550);
  });
});

describe("training", () => {
  it("collects one sample per real decision, with a value for every legal action", () => {
    const samples = collect(SEED, null, { games: 2, size: 2, oracle: { samples: 1 } });
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) {
      expect(sample.features.length).toBe(sample.values.length);
      expect(sample.features.length).toBeGreaterThan(1);
    }
  });

  it("is repeatable: the same seed collects the same samples and fits the same weights", () => {
    const options = { games: 2, size: 2, oracle: { samples: 1 } };
    const once = collect(SEED, null, options);
    const twice = collect(SEED, null, options);
    expect(twice).toEqual(once);
    const fitted = quantize(fit(once, null, { epochs: 30 }));
    expect(quantize(fit(twice, null, { epochs: 30 }))).toEqual(fitted);
    expect(fitted).toHaveLength(FEATURE_COUNT);
  });

  it("lowers the loss it is minimising", () => {
    const samples = collect(SEED, explore(UNIFORM, 300), { games: 4, size: 2, oracle: { samples: 1 } });
    const losses: number[] = [];
    fit(samples, null, { epochs: 40, onLoss: (_, loss) => losses.push(loss) });
    expect(losses.at(-1)!).toBeLessThan(losses[0]);
  });

  it("refines integer weights without ever making regret worse", () => {
    const samples = collect(SEED, null, { games: 4, size: 2, oracle: { samples: 1 } });
    const start = quantize(fit(samples, null, { epochs: 30 }));
    const before = report(samples, start);
    const after = report(samples, refine(samples, start, { passes: 2, steps: [300, 100] }));
    expect(after.meanRegret).toBeLessThanOrEqual(before.meanRegret);
    expect(after.samples).toBe(samples.length);
  });
});
