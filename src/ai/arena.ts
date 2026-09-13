import {
  DUEL_RULES,
  isFainted,
  resolveTurn,
  startBattle,
  type BattleAction,
  type BattleRules,
  type BattleState,
  type SideIndex,
} from "@/engine/battle";
import type { Individual } from "@/engine/types";
import type { Policy } from "./policy";
import type { Matchup } from "./teams";

export interface MatchResult {
  /** Who won, or null for a draw. */
  winner: SideIndex | null;
  turns: number;
  /** Members still standing on each side at the end. */
  left: [number, number];
}

/** One battle, played to the end by two policies. */
export function playMatch(
  seed: string,
  tag: string,
  teams: [readonly Individual[], readonly Individual[]],
  policies: [Policy, Policy],
  rules: BattleRules = DUEL_RULES,
): MatchResult {
  let state: BattleState = startBattle(seed, tag, teams[0], teams[1]);
  while (!state.outcome) {
    const actions: [BattleAction, BattleAction] = [policies[0].choose(state, 0), policies[1].choose(state, 1)];
    state = resolveTurn(state, actions, rules).battle;
  }
  return {
    winner: state.outcome.t === "win" ? state.outcome.side : null,
    turns: state.turn,
    left: [
      state.sides[0].team.filter((one) => !isFainted(one)).length,
      state.sides[1].team.filter((one) => !isFainted(one)).length,
    ],
  };
}

export interface ArenaResult {
  games: number;
  /** Games won by the first policy, and by the second. */
  wins: [number, number];
  draws: number;
  meanTurns: number;
  /** The first policy's share of decided games, in thousandths. */
  shareMille: number;
}

/**
 * Two policies over a set of matchups, each matchup played from both chairs.
 *
 * Both chairs, because a matchup is rarely fair and a policy that only ever
 * held the stronger team would look better than it is. Swapping teams and
 * keeping the tag also swaps who rolls what, so the two games are genuinely
 * different games rather than one game mirrored.
 */
export function arena(seed: string, matchups: readonly Matchup[], first: Policy, second: Policy): ArenaResult {
  const wins: [number, number] = [0, 0];
  let draws = 0;
  let turns = 0;
  for (const matchup of matchups) {
    const home = playMatch(seed, `${matchup.tag}:home`, [matchup.a, matchup.b], [first, second]);
    const away = playMatch(seed, `${matchup.tag}:away`, [matchup.b, matchup.a], [second, first]);
    turns += home.turns + away.turns;
    if (home.winner === null) draws++;
    else wins[home.winner]++;
    if (away.winner === null) draws++;
    else wins[1 - away.winner]++;
  }
  const games = matchups.length * 2;
  const decided = wins[0] + wins[1];
  return {
    games,
    wins,
    draws,
    meanTurns: games ? Math.floor(turns / games) : 0,
    shareMille: decided ? Math.floor((wins[0] * 1000) / decided) : 500,
  };
}
