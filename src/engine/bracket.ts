import { rngFor, intBelow } from "./rng";

/**
 * A knockout bracket for four, eight or sixteen people.
 *
 * Pure, and deliberately transport-free: this module knows who is playing, who
 * plays whom, and who is left. It knows nothing about rooms, peers, WebRTC or
 * whose browser is whose. `lib/party.ts` moves the messages and
 * `engine/tourney.ts` speaks the protocol; both of them ask this what the
 * bracket says, which is what lets the whole of it be tested with no network
 * and no timing.
 *
 * ## Why a power of two, and nothing else
 *
 * The file-based bracket in `lib/tournament.ts` takes any number of entrants
 * and pads with byes, because an organiser gets whatever files turn up. This
 * one is people sitting in a room waiting, and a bye is a person told to sit
 * out a round they came to play. Four, eight or sixteen exactly: the lobby
 * simply does not start until it is full, which is a rule everybody can see
 * being applied rather than a fairness argument nobody can check.
 *
 * ## One match at a time
 *
 * Every round could be played in parallel, and it is not. The whole appeal of
 * a bracket among people who know each other is *watching* — the two who are
 * out play the winner's next opponent in their heads, and a player waiting to
 * go on has seen what is coming. So the tournament is a queue of matches, one
 * live at a time, and everybody who is not in it is a spectator.
 *
 * That also makes the protocol far smaller. There is exactly one live battle
 * in the room, so a spectator has one thing to follow and a dropped peer has
 * one thing to be taken over.
 *
 * ## The order is derived, not chosen
 *
 * The host is a player like everybody else, so the host must not be able to
 * pick their own path through the draw. The seeding comes out of the room code
 * and the joined ids, hashed — nobody chooses their id (it is the peer's), and
 * the code is fixed before anybody knows who is coming. Every client computes
 * the same bracket from the same list, which is also what lets a spectator
 * check the host is running the draw it announced.
 */

/** How many people a bracket takes. Nothing else is a knockout without byes. */
export const BRACKET_SIZES = [4, 8, 16] as const;
export type BracketSize = (typeof BRACKET_SIZES)[number];

export function isBracketSize(count: number): count is BracketSize {
  return (BRACKET_SIZES as readonly number[]).includes(count);
}

export interface Player {
  /** The peer id. Assigned by the transport, so nobody picks their own. */
  id: string;
  /** What they typed. Display only — two people may pick the same one. */
  name: string;
  /**
   * Their world's seed and how many moves their save is in, as they said on
   * arrival. Display only, and optional: a client too old to send them still
   * plays, it just shows a name.
   */
  seed?: string;
  moves?: number;
  /**
   * Whether the AI is playing their chair.
   *
   * Set when their peer drops, and never cleared: somebody who reconnects
   * mid-tournament would be rejoining a bracket that has moved on without
   * them, and handing a match back part-way through is a fairer-sounding rule
   * that is much harder to make fair.
   */
  gone: boolean;
}

/** One match: two seats, and who came out of it. */
export interface Seat {
  /** Index into the player list, or null for a slot the round has not filled. */
  player: number | null;
}

export interface BracketMatch {
  round: number;
  /** Position within the round, which is also the order they are played in. */
  at: number;
  seats: [Seat, Seat];
  /** The seat that won, once it has been played. */
  won: 0 | 1 | null;
}

export interface Bracket {
  code: string;
  size: BracketSize;
  /** Creatures a side brings. The host picks it before anybody joins. */
  teamSize: number;
  players: Player[];
  rounds: BracketMatch[][];
}

/**
 * The draw, from the code and who turned up.
 *
 * Sorted by a hash of the code and the id rather than by join order, so being
 * quick to click does not buy a soft first round — and so the host, who is
 * always first into their own room, has no advantage from it.
 */
export function drawOrder(code: string, players: readonly Player[]): Player[] {
  const keyed = players.map((player) => ({
    player,
    // A number per player from one stream, which is enough to shuffle by and
    // cheaper to reason about than sorting on a string digest.
    key: intBelow(rngFor(code, "draw", player.id), 1 << 30),
  }));
  keyed.sort((a, b) => a.key - b.key || a.player.id.localeCompare(b.player.id));
  return keyed.map((one) => one.player);
}

/**
 * An empty bracket for these players.
 *
 * The first round is top against bottom of the drawn order — the shape every
 * bracket uses, so the two ends of the draw cannot meet before the final.
 */
export function buildBracket(
  code: string,
  size: BracketSize,
  teamSize: number,
  players: readonly Player[],
): Bracket {
  if (players.length !== size) {
    throw new Error(`a bracket of ${size} needs ${size} players, not ${players.length}`);
  }

  const ordered = drawOrder(code, players);
  const index = new Map(ordered.map((player, at) => [player.id, at]));

  const rounds: BracketMatch[][] = [];
  let width = size;
  let round = 0;

  while (width >= 2) {
    const matches: BracketMatch[] = [];
    for (let at = 0; at < width / 2; at++) {
      matches.push({
        round,
        at,
        seats:
          round === 0
            ? [{ player: index.get(ordered[at].id)! }, { player: index.get(ordered[width - 1 - at].id)! }]
            : [{ player: null }, { player: null }],
        won: null,
      });
    }
    rounds.push(matches);
    width /= 2;
    round++;
  }

  return { code, size, teamSize, players: ordered, rounds };
}

/** The next match to be played, or null when the whole thing is done. */
export function nextMatch(bracket: Bracket): BracketMatch | null {
  for (const round of bracket.rounds) {
    for (const match of round) {
      if (match.won === null) return match;
    }
  }
  return null;
}

/** Whether both seats of this match are filled and it can start. */
export function ready(match: BracketMatch): boolean {
  return match.seats[0].player !== null && match.seats[1].player !== null;
}

/**
 * Records a result and carries the winner into the next round.
 *
 * Returns a new bracket: the whole structure is treated as a value so that a
 * spectator applying the host's announcements ends up with the same object a
 * player did, and the two can be compared.
 */
export function recordWin(bracket: Bracket, round: number, at: number, won: 0 | 1): Bracket {
  const rounds = bracket.rounds.map((one) => one.map((match) => ({ ...match, seats: [{ ...match.seats[0] }, { ...match.seats[1] }] as [Seat, Seat] })));

  const match = rounds[round]?.[at];
  if (!match) throw new Error(`no match ${round}/${at}`);
  if (match.won !== null) throw new Error(`match ${round}/${at} is already decided`);
  if (!ready(match)) throw new Error(`match ${round}/${at} is not ready`);

  match.won = won;

  // Into the next round, in the half of the draw it came from: two matches
  // feed one, and which seat depends on which of the two this was.
  const onward = rounds[round + 1]?.[Math.floor(at / 2)];
  if (onward) onward.seats[at % 2] = { player: match.seats[won].player };

  return { ...bracket, rounds };
}

/** Whoever won the last match of the last round, or null. */
export function champion(bracket: Bracket): Player | null {
  const last = bracket.rounds[bracket.rounds.length - 1]?.[0];
  if (!last || last.won === null) return null;
  const seat = last.seats[last.won].player;
  return seat === null ? null : bracket.players[seat];
}

/** What to call a round, counting in from the end. */
export function roundName(bracket: Bracket, round: number): string {
  const left = bracket.rounds.length - round;
  if (left === 1) return "Final";
  if (left === 2) return "Semi-final";
  if (left === 3) return "Quarter-final";
  return `Round ${round + 1}`;
}

/**
 * Whether this player is still in it.
 *
 * Read off the bracket rather than tracked, because a flag would be a second
 * copy of something the rounds already say — and the two would disagree the
 * first time a message arrived twice.
 */
export function stillIn(bracket: Bracket, player: number): boolean {
  for (const round of bracket.rounds) {
    for (const match of round) {
      if (match.won === null) continue;
      const loser = match.seats[match.won === 0 ? 1 : 0].player;
      if (loser === player) return false;
    }
  }
  return true;
}
