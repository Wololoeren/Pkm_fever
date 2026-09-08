import {
  battleHash,
  DUEL_RULES,
  isFainted,
  resolveTurn,
  startBattle,
  type BattleAction,
  type BattleState,
  type SideIndex,
} from "./battle";
import type { Individual } from "./types";

/**
 * A battle between two people, over a wire, with no server and no referee.
 *
 * Two problems have to be solved before that is a fair fight, and both are
 * solved here rather than by trusting anybody:
 *
 * **Neither side may see the other's move before choosing its own.** Moves are
 * picked simultaneously, so whoever transmitted second would otherwise pick
 * the counter every turn. Each side therefore sends `sha256(action ‖ nonce)`
 * first, and only reveals the action once both commitments are in. A commit
 * says nothing about the move; a reveal that does not hash to the commit
 * already received is a cheat, caught immediately.
 *
 * **Neither side may bias the dice.** Criticals, accuracy and damage rolls all
 * come from the battle seed, so if either player chose it they could fish for
 * a good one. The seed is `sha256` of *both* players' opening nonces, each
 * committed before either is revealed, so neither knows the other's when
 * choosing their own and neither can steer the result.
 *
 * What this cannot do is stop somebody running modified code. It does not have
 * to: both peers resolve every turn with the same engine and compare hashes, so
 * a client playing different rules cannot force a wrong outcome on an honest
 * opponent — it can only diverge, and divergence is loud.
 *
 * Teams are exchanged in the open. Competitive Pokémon has done the same since
 * Open Team Sheets became standard, and it removes an entire class of problem:
 * there is no hidden state to leak, so no amount of devtools helps.
 */

const encoder = new TextEncoder();

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A stable string for an action.
 *
 * Both sides must hash the *same* bytes, so this cannot be JSON.stringify:
 * key order there follows construction order, and two clients that built the
 * object differently would compute different commitments and accuse each
 * other of cheating.
 */
export function canonicalAction(action: BattleAction): string {
  switch (action.t) {
    case "fight":
      return `fight:${action.moveIndex}`;
    case "switch":
      return `switch:${action.partyIndex}`;
    default:
      return action.t;
  }
}

export function commitTo(action: BattleAction, nonce: string): Promise<string> {
  return sha256(`${canonicalAction(action)}|${nonce}`);
}

export function verifyCommit(commit: string, action: BattleAction, nonce: string): Promise<boolean> {
  return commitTo(action, nonce).then((computed) => computed === commit);
}

/**
 * The battle seed, from both openings.
 *
 * Sorted so that both sides compute the same string without needing to agree
 * on who is "first". Neither can steer it: each committed to its nonce before
 * seeing the other's, so choosing a nonce to shape the sorted concatenation is
 * choosing blind.
 */
export function deriveBattleSeed(a: string, b: string): Promise<string> {
  const [low, high] = a <= b ? [a, b] : [b, a];
  return sha256(`duel|${low}|${high}`);
}

// --------------------------------------------------------------- messages

export type DuelMessage =
  /** Opening: the team, in the open, and a commitment to the seed nonce. */
  | { t: "hello"; team: Individual[]; commit: string }
  | { t: "openReveal"; nonce: string }
  | { t: "commit"; turn: number; commit: string }
  | { t: "reveal"; turn: number; action: BattleAction; nonce: string }
  /** Sent after each resolved turn so divergence is caught on the turn it
   * happens rather than three turns later. */
  | { t: "check"; turn: number; hash: string }
  | { t: "resign" };

export type DuelPhase =
  /** Waiting for the opponent's team and opening commitment. */
  | "opening"
  /** Both openings committed; waiting for the nonce reveals. */
  | "openingReveal"
  /** The battle is running; we owe an action. */
  | "choosing"
  /** We have committed; waiting for theirs. */
  | "committed"
  /** Both committed; exchanging reveals. */
  | "revealing"
  | "over";

export type DuelFault =
  /** A reveal did not match the commitment that preceded it. */
  | { t: "badReveal"; side: SideIndex }
  /** The two clients resolved the same turn differently. */
  | { t: "desync"; turn: number; ours: string; theirs: string }
  | { t: "resigned"; side: SideIndex };

export interface DuelView {
  phase: DuelPhase;
  battle: BattleState | null;
  fault: DuelFault | null;
  /** Which side of `battle` we drive. Null until the openings settle it. */
  role: SideIndex | null;
}

/**
 * One end of a duel.
 *
 * Deliberately transport-agnostic: it is handed a `send` function and fed
 * whatever arrives. That is what lets the whole protocol be tested by wiring
 * two sessions to each other in memory, with no network and no timing.
 *
 * Both peers build **the same battle in the same orientation**, and each knows
 * which side it is driving. The obvious alternative — each player being side 0
 * in its own view — looks tidier and is quietly broken: rolls are named after
 * the side that makes them (`0-crit`), so two clients would compute that tag
 * for different creatures and desync on the first critical hit. Roles come
 * from the opening nonces, which neither player can steer.
 */
export class DuelSession {
  private readonly send: (message: DuelMessage) => void;
  private readonly newNonce: () => string;

  private ourTeam: Individual[];
  private theirTeam: Individual[] | null = null;

  private openingNonce: string;
  private theirOpeningCommit: string | null = null;
  private theirOpeningNonce: string | null = null;

  private pending: { action: BattleAction; nonce: string } | null = null;
  private theirCommit: string | null = null;
  private theirReveal: { action: BattleAction; nonce: string } | null = null;

  private state: BattleState | null = null;
  private role: SideIndex | null = null;
  private phase: DuelPhase = "opening";
  private fault: DuelFault | null = null;
  /** Their reported hash for a turn we may not have resolved yet. */
  private theirChecks = new Map<number, string>();

  constructor(
    team: readonly Individual[],
    send: (message: DuelMessage) => void,
    newNonce: () => string = randomNonce,
  ) {
    this.ourTeam = team.map((creature) => ({ ...creature }));
    this.send = send;
    this.newNonce = newNonce;
    this.openingNonce = newNonce();
  }

  view(): DuelView {
    return { phase: this.phase, battle: this.state, fault: this.fault, role: this.role };
  }

  /** The side we are not. */
  private opponentSide(): SideIndex {
    return this.role === 0 ? 1 : 0;
  }

  /** Announces our team and commits to our opening nonce. */
  async open(): Promise<void> {
    this.send({ t: "hello", team: this.ourTeam, commit: await sha256(`open|${this.openingNonce}`) });
  }

  /** Chooses this turn's action and commits to it. */
  async choose(action: BattleAction): Promise<void> {
    if (this.phase !== "choosing") throw new Error(`cannot choose while ${this.phase}`);

    const nonce = this.newNonce();
    this.pending = { action, nonce };
    this.phase = "committed";
    this.send({ t: "commit", turn: this.turnNumber(), commit: await commitTo(action, nonce) });
    await this.maybeReveal();
  }

  resign(): void {
    this.phase = "over";
    this.fault = { t: "resigned", side: 0 };
    this.send({ t: "resign" });
  }

  async receive(message: DuelMessage): Promise<void> {
    if (this.phase === "over" && message.t !== "resign") return;

    switch (message.t) {
      case "hello":
        this.theirTeam = message.team.map((creature) => ({ ...creature }));
        this.theirOpeningCommit = message.commit;
        this.phase = "openingReveal";
        this.send({ t: "openReveal", nonce: this.openingNonce });
        await this.maybeStart();
        return;

      case "openReveal": {
        if (!this.theirOpeningCommit) return;
        if ((await sha256(`open|${message.nonce}`)) !== this.theirOpeningCommit) {
          this.failWith({ t: "badReveal", side: 1 });
          return;
        }
        this.theirOpeningNonce = message.nonce;
        await this.maybeStart();
        return;
      }

      case "commit":
        if (message.turn !== this.turnNumber()) return;
        this.theirCommit = message.commit;
        await this.maybeReveal();
        return;

      case "reveal": {
        if (message.turn !== this.turnNumber()) return;
        // A reveal with no commitment on file cannot be checked against
        // anything, which is exactly the shape a cheat would take.
        if (!this.theirCommit) {
          this.failWith({ t: "badReveal", side: this.opponentSide() });
          return;
        }
        if (!(await verifyCommit(this.theirCommit, message.action, message.nonce))) {
          this.failWith({ t: "badReveal", side: this.opponentSide() });
          return;
        }
        this.theirReveal = { action: message.action, nonce: message.nonce };
        await this.maybeResolve();
        return;
      }

      case "check":
        this.theirChecks.set(message.turn, message.hash);
        this.compareAt(message.turn);
        return;

      case "resign":
        this.phase = "over";
        this.fault = { t: "resigned", side: 1 };
        return;
    }
  }

  private turnNumber(): number {
    return (this.state?.turn ?? 0) + 1;
  }

  private failWith(fault: DuelFault): void {
    this.fault = fault;
    this.phase = "over";
  }

  /**
   * Both openings known: settle who is which side, derive the seed, and build
   * the battle.
   *
   * Roles come from the nonces themselves — lower is side 0 — so neither
   * player picks, and neither picks knowing the other's, because both
   * committed first. Identical nonces mean somebody echoed ours back.
   */
  private async maybeStart(): Promise<void> {
    if (this.state || !this.theirTeam || !this.theirOpeningNonce) return;
    if (this.openingNonce === this.theirOpeningNonce) {
      this.failWith({ t: "badReveal", side: 1 });
      return;
    }

    this.role = this.openingNonce < this.theirOpeningNonce ? 0 : 1;
    const seed = await deriveBattleSeed(this.openingNonce, this.theirOpeningNonce);
    const [first, second] =
      this.role === 0 ? [this.ourTeam, this.theirTeam] : [this.theirTeam, this.ourTeam];

    this.state = startBattle(seed, "duel", first, second);
    this.phase = "choosing";
  }

  /** Reveal only once their commitment is safely in hand. */
  private async maybeReveal(): Promise<void> {
    if (!this.pending || !this.theirCommit) return;
    if (this.phase === "revealing") return;

    this.phase = "revealing";
    this.send({
      t: "reveal",
      turn: this.turnNumber(),
      action: this.pending.action,
      nonce: this.pending.nonce,
    });
    await this.maybeResolve();
  }

  private async maybeResolve(): Promise<void> {
    if (!this.state || !this.pending || !this.theirReveal || this.role === null) return;

    const turn = this.turnNumber();
    const actions: [BattleAction, BattleAction] = [{ t: "pass" }, { t: "pass" }];
    actions[this.role] = this.pending.action;
    actions[this.opponentSide()] = this.theirReveal.action;

    try {
      this.state = resolveTurn(this.state, actions, DUEL_RULES).battle;
    } catch {
      // An action the rules refuse is a cheat or a bug; either way this duel
      // is not recoverable and pretending otherwise hides it.
      this.failWith({ t: "badReveal", side: 1 });
      return;
    }

    this.pending = null;
    this.theirCommit = null;
    this.theirReveal = null;

    const hash = battleHash(this.state);
    this.send({ t: "check", turn, hash });
    this.compareAt(turn);
    if (this.phase === "over") return;

    this.phase = this.state.outcome ? "over" : "choosing";
  }

  /**
   * Compares our result for a turn with theirs.
   *
   * Both peers hold the same battle in the same orientation, so the hashes
   * compare directly — and a difference means one of us is running rules the
   * other is not.
   */
  private compareAt(turn: number): void {
    const theirs = this.theirChecks.get(turn);
    if (!theirs || !this.state || this.state.turn !== turn) return;

    const ours = battleHash(this.state);
    if (ours !== theirs) this.failWith({ t: "desync", turn, ours, theirs });
  }
}

/** Whether a side still has anything able to fight. */
export function canContinue(state: BattleState, side: SideIndex): boolean {
  return state.sides[side].team.some((creature) => !isFainted(creature));
}
