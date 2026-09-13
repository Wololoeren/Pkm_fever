import {
  DUEL_RULES,
  isFainted,
  maxHp,
  resolveTurn,
  startBattle,
  type BattleAction,
  type BattleState,
} from "@/engine/battle";
import { trainerAction } from "@/ai";
import { fullPp } from "@/engine/pp";
import type { Individual } from "@/engine/types";
import { normaliseSeed } from "./save";
import type { Verification } from "./verify";

/**
 * Tournament mode: same seed, fixed hours, bring six.
 *
 * The check-in is the verify page, and this is what happens after it. Every
 * entrant is a verified save — a seed, a hash, a party — and the bracket is
 * built from nothing else: entrants are ordered by hash, so two organisers
 * with the same files draw the same bracket, and every match's dice come from
 * the tournament seed and the two hashes in it, so the same bracket plays out
 * the same way on any machine. A result nobody can reproduce is a result
 * somebody has to be trusted about, and the whole design is that nobody is.
 *
 * Matches are the engine's own 1v1 battles under duel rules — no catching, no
 * running, no experience — with both sides driven by the same uniform AI
 * that drives every wild creature. That is deliberately not a strategy: the
 * bracket measures the *teams* people bred and trained, and a better AI would
 * measure the AI. A match that reaches the turn limit is decided on health,
 * as any battle is, and a dead heat goes to the higher seed and says so.
 *
 * Pure. The page is a file input and a table.
 */

export interface Entrant {
  /** What the organiser sees: the file's name. */
  name: string;
  report: Verification;
}

export interface Match {
  a: Entrant | null;
  b: Entrant | null;
  /** Who went through. A bye is a win for whoever was there. */
  winner: Entrant | null;
  turns: number;
  /** Creatures still standing on each side when it ended. */
  left: [number, number];
  /** Decided at the turn limit on health, or a dead heat given to the seed. */
  note: string | null;
}

export interface Tournament {
  seed: string;
  /** Creatures per side. Everybody brings this many, or fewer and forfeits the rest. */
  size: number;
  rounds: Match[][];
  champion: Entrant | null;
}

/** Why a save cannot enter, or null. */
export function entryRefusal(report: Verification, size: number, seed: string | null): string | null {
  if (!report.ok) return "does not replay";
  if (report.cheated) return "used a testing shortcut";
  if (report.roster.length < size) return `brings ${report.roster.length}, and ${size} are needed`;
  if (seed !== null && report.seed !== seed) return `played seed ${report.seed}, not ${seed}`;
  return null;
}

/** Entrants by hash, which is the only order two organisers will agree on. */
export function seedOrder(entrants: readonly Entrant[]): Entrant[] {
  return [...entrants].sort((a, b) => a.report.hash.localeCompare(b.report.hash) || a.name.localeCompare(b.name));
}

/** The first round: top seed against bottom, with byes for the gaps up to a power of two. */
function firstRound(ordered: readonly Entrant[]): [Entrant | null, Entrant | null][] {
  let slots = 1;
  while (slots < ordered.length) slots *= 2;
  const padded: (Entrant | null)[] = [...ordered];
  while (padded.length < slots) padded.push(null);
  const pairs: [Entrant | null, Entrant | null][] = [];
  for (let at = 0; at < slots / 2; at++) pairs.push([padded[at], padded[slots - 1 - at]]);
  return pairs;
}

/**
 * A team as it walks out of a Center: full health, no condition, every use
 * back.
 *
 * A save is checked in as it was saved, and a save is often saved mid-walk,
 * with something fainted in the third slot. The first bracket run found
 * exactly that: a final over in one turn because the loser had brought one
 * creature standing and one already down. A tournament starts fresh, and the
 * same rule applies to everybody.
 */
function rested(creature: Individual): Individual {
  return { ...creature, hp: maxHp(creature), status: null, sleepTurns: 0, pp: fullPp(creature.moves) };
}

/**
 * One match, played to the end by the engine.
 *
 * The team is the first `size` of the party, which is the order the player
 * chose, rested. The battle seed is the tournament's seed and both hashes, so
 * a rematch of the same two saves under the same seed is the same battle.
 */
export function playMatch(seed: string, size: number, a: Entrant, b: Entrant): Match {
  const teamA = a.report.roster.slice(0, size).map(rested);
  const teamB = b.report.roster.slice(0, size).map(rested);
  const tag = `cup:${a.report.hash}:${b.report.hash}`;
  let state: BattleState = startBattle(seed, tag, teamA, teamB);

  while (!state.outcome) {
    // Both chairs are played by the trainer's policy rather than at random:
    // a bracket decided by which side happened to roll its good move is a
    // bracket that says nothing about the teams in it.
    const actions: [BattleAction, BattleAction] = [trainerAction(state, 0), trainerAction(state, 1)];
    state = resolveTurn(state, actions, DUEL_RULES).battle;
  }

  const left: [number, number] = [
    state.sides[0].team.filter((one) => !isFainted(one)).length,
    state.sides[1].team.filter((one) => !isFainted(one)).length,
  ];
  const timedOut = state.events.some((event) => event.t === "timeout");
  const outcome = state.outcome;
  if (outcome.t === "win") {
    return {
      a,
      b,
      winner: outcome.side === 0 ? a : b,
      turns: state.turn,
      left,
      note: timedOut ? "decided on health at the turn limit" : null,
    };
  }
  // A draw: both sides down at once, or level on health at the limit. The
  // higher seed goes through, and the bracket says so rather than hiding it.
  return { a, b, winner: a, turns: state.turn, left, note: "a dead heat, given to the higher seed" };
}

export function runTournament(entrants: readonly Entrant[], seed: string, size: number): Tournament {
  const clean = normaliseSeed(seed);
  const ordered = seedOrder(entrants);
  const rounds: Match[][] = [];
  let pairs = firstRound(ordered);

  while (pairs.length) {
    const round: Match[] = pairs.map(([a, b]) => {
      if (a && b) return playMatch(clean, size, a, b);
      const through = a ?? b;
      return { a, b, winner: through, turns: 0, left: [0, 0], note: through ? "a bye" : null };
    });
    rounds.push(round);
    if (round.length === 1) break;
    const winners = round.map((match) => match.winner);
    const next: [Entrant | null, Entrant | null][] = [];
    for (let at = 0; at < winners.length; at += 2) next.push([winners[at], winners[at + 1] ?? null]);
    pairs = next;
  }

  return {
    seed: clean,
    size,
    rounds,
    champion: rounds.length ? rounds[rounds.length - 1][0].winner : null,
  };
}
