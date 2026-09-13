import { trainerAction } from "@/ai";
import {
  DUEL_RULES,
  maxHp,
  resolveTurn,
  startBattle,
  type BattleAction,
  type BattleState,
  type SideIndex,
} from "./battle";
import {
  buildBracket,
  champion,
  nextMatch,
  ready,
  recordWin,
  type Bracket,
  type BracketMatch,
  type BracketSize,
  type Player,
} from "./bracket";
import { fullPp } from "./pp";
import { randomCreature } from "@/ai/teams";
import { atFullHealth, withMoves } from "./engine";
import { rngFor } from "./rng";
import type { Individual } from "./types";

/**
 * A bracket run over a wire, with a host and no referee.
 *
 * The duel in `duel.ts` solves the hard half already — two people picking
 * simultaneously with neither able to see the other's move or steer the dice —
 * and this does not solve it again. A tournament match *is* a duel; what this
 * adds is everything around one: who plays whom, in what order, who is
 * watching, and what happens when somebody closes the tab.
 *
 * ## What the host is and is not
 *
 * The host picks the format and holds the door: how many people, how many
 * creatures a side, and when the lobby is full enough to start. That is all.
 *
 * The host does **not** draw the bracket, because a host who drew it could
 * draw themselves an easy side. The draw comes out of the room code and the
 * peer ids through `drawOrder`, and every client computes it independently
 * from the same locked roster — so the host announces *who is in*, and the
 * bracket that follows is something everybody derives and nobody grants.
 *
 * The host does not decide results either. A match is played by the two people
 * in it, under the duel protocol, and both of them announce the same winner
 * because both of them resolved the same battle. A spectator that sees two
 * different results has caught something, and says so rather than picking one.
 *
 * ## Why one match at a time
 *
 * Because watching is the point. See the note in `bracket.ts`: a bracket among
 * people who know each other is half spectating, and running the rounds in
 * parallel would mean nobody ever sees the match they are about to play the
 * winner of. It also means there is exactly one live battle in the room, which
 * makes the protocol small enough to hold in your head.
 *
 * ## Watching, and the one place this spends bandwidth
 *
 * Spectators are sent the resolved battle after every turn, whole. They could
 * instead be sent the two reveals and run the engine themselves — cheaper on
 * the wire, and the same information — and that is not done on purpose: a
 * spectator running its own copy of the battle is a third client that can
 * desync, and a bracket that stops to argue about a fight nobody is playing is
 * the worst possible failure. A frame is a few kilobytes and there is one
 * match at a time.
 *
 * ## When somebody leaves
 *
 * Their chair is taken by the same search that plays every trainer in the
 * game. The alternative is a bracket that stops dead because one person's
 * laptop slept, which in a room of sixteen is close to certain.
 *
 * This is the one place the tournament asks for trust: the surviving player
 * drives both chairs, so they *could* play the absent one badly. It is
 * deliberate and it is bounded — the frames are broadcast, so the room watches
 * the AI's moves as they happen and a chair being thrown is visible to
 * everybody. The dishonest alternative would be pretending a hard problem
 * (proving an absent player's moves) had been solved.
 */

export type TourneyPhase =
  /** Waiting for people. The host can start once the lobby is exactly full. */
  | "lobby"
  /** The roster is locked and the draw is known; nothing is being played yet. */
  | "drawn"
  /** A match is live: we are in it, or we are watching it. */
  | "match"
  /** Somebody won the whole thing. */
  | "done";

export type TourneyMessage =
  /** Broadcast on arrival, and again whenever somebody new turns up: this is
   * who I am. Sent by everybody including the host. */
  | { t: "hello"; name: string; seed?: string; moves?: number }
  /**
   * The host, locking the field.
   *
   * Carries the roster in join order and the format. Every client derives the
   * bracket from it — the host is not sending a bracket, it is sending the
   * list the bracket is computed from, which is what makes the draw checkable.
   *
   * And the host's world seed, which the prize is drawn from. See `cupPrizeKey`.
   */
  | { t: "lock"; size: BracketSize; teamSize: number; players: Entrant[]; seed: string }
  /**
   * A player's team for the live match, in the open.
   *
   * Broadcast rather than sent to the opponent, because the gallery needs it
   * too: given both teams and the match seed every client builds the same
   * battle and watches it from the first turn rather than from whichever
   * frame happens to arrive first.
   *
   * Open team sheets, which competitive Pokémon has done for years and which
   * `duel.ts` already argues for at length: there is no hidden state to leak,
   * so no amount of devtools helps.
   */
  | { t: "team"; round: number; at: number; team: Individual[] }
  /** A duel message for the other player in the live match, passed through. */
  | { t: "duel"; round: number; at: number; from: string; body: unknown }
  /** A combatant showing the room the turn that just resolved. */
  | { t: "frame"; round: number; at: number; battle: BattleState }
  /** And the result, announced by both combatants. */
  | { t: "result"; round: number; at: number; won: 0 | 1 }
  /** Somebody's peer went away, so their chair is the AI's now. */
  | { t: "gone"; id: string };

export interface TourneyView {
  phase: TourneyPhase;
  /** Everybody in the room, once the field is locked. */
  bracket: Bracket | null;
  /** Who we are. Null until the transport has an id for us. */
  self: string;
  /** The match being played, or null. */
  live: BracketMatch | null;
  /** Its battle, as far as this client has seen it. */
  battle: BattleState | null;
  /** Which side of `battle` we drive, or null when we are watching. */
  role: SideIndex | null;
  /** Whoever won the whole thing. */
  won: Player | null;
  /** The host's world seed, once the field is locked. The prize is drawn from it. */
  hostSeed: string | null;
  /** Something two clients disagreed about, which is worth stopping for. */
  fault: string | null;
}

/**
 * A team as it walks out of a Center.
 *
 * The same rule the file-based bracket applies, for the same reason: a save is
 * often saved mid-walk with something fainted in the third slot, and a
 * tournament that started from that would be decided by who happened to save
 * at a Center. Everybody starts whole.
 */
function rested(creature: Individual): Individual {
  return { ...creature, hp: maxHp(creature), status: null, sleepTurns: 0, pp: fullPp(creature.moves) };
}

/**
 * The battle seed for one match.
 *
 * Derived from the room code and the two players, not from either of them.
 * The duel protocol derives its seed from two committed nonces, which is
 * stronger — neither player can steer it even in principle — and it is not
 * used here because a spectator has to be able to build the same battle
 * without having seen the nonces. Sorted so both ends and the whole gallery
 * agree without needing to know who is "first".
 */
export function matchSeed(code: string, a: string, b: string): string {
  const [low, high] = a <= b ? [a, b] : [b, a];
  return `bracket|${code}|${low}|${high}`;
}

/**
 * One end of a tournament.
 *
 * Transport-agnostic in exactly the way `DuelSession` is: handed a `send` and
 * fed whatever arrives, so a whole sixteen-player bracket can be wired up in
 * memory and played out by a test with no network and no timing.
 */
/** Somebody in the room, as they introduced themselves. */
export interface Entrant {
  id: string;
  name: string;
  /** Their world seed and move count. See `Player`. */
  seed?: string;
  moves?: number;
}

/**
 * What a peer claims about itself, kept only if it is the right shape.
 *
 * Another person's client wrote this, so a seed that is not a short string or
 * a count that is not a whole number is dropped rather than shown.
 */
function introduced(message: { seed?: unknown; moves?: unknown }): Pick<Entrant, "seed" | "moves"> {
  const seed = typeof message.seed === "string" && message.seed.length <= 32 ? message.seed : undefined;
  const moves =
    typeof message.moves === "number" && Number.isSafeInteger(message.moves) && message.moves >= 0
      ? message.moves
      : undefined;
  return { seed, moves };
}

export class TourneySession {
  private readonly send: (message: TourneyMessage) => void;
  private readonly code: string;
  private readonly team: Individual[];
  /** Our own world's seed. Only used if we turn out to be the host. */
  private readonly seed: string;
  private hostSeed: string | null = null;

  readonly self: string;
  readonly name: string;
  readonly host: boolean;

  private phase: TourneyPhase = "lobby";
  private lobby = new Map<string, Omit<Entrant, "id">>();
  /** How many moves into its save this client is, for the hello. */
  private readonly moves: number | undefined;
  private bracket: Bracket | null = null;
  private live: BracketMatch | null = null;
  private battle: BattleState | null = null;
  private role: SideIndex | null = null;
  private fault: string | null = null;
  /** Results heard for a match, by who said so, to catch two people
   * announcing different winners. */
  private claims = new Map<string, Map<string, 0 | 1>>();

  constructor(options: {
    self: string;
    name: string;
    code: string;
    host: boolean;
    /** The world this client is playing. The host's seeds the prize. */
    seed: string;
    /** How many moves into its save this client is. Shown to the room. */
    moves?: number;
    team: readonly Individual[];
    send: (message: TourneyMessage) => void;
  }) {
    this.self = options.self;
    this.name = options.name;
    this.code = options.code;
    this.host = options.host;
    this.seed = options.seed;
    this.team = options.team.map(rested);
    this.send = options.send;
    this.moves = options.moves;
    this.lobby.set(this.self, { name: this.name, seed: this.seed, moves: this.moves });
  }

  view(): TourneyView {
    return {
      phase: this.phase,
      bracket: this.bracket,
      self: this.self,
      live: this.live,
      battle: this.battle,
      role: this.role,
      won: this.bracket ? champion(this.bracket) : null,
      hostSeed: this.hostSeed,
      fault: this.fault,
    };
  }

  /** Everybody the lobby knows about, in join order. */
  roster(): Entrant[] {
    return [...this.lobby].map(([id, entry]) => ({ id, ...entry }));
  }

  /** Says who we are. Called on joining, and again when somebody arrives —
   * the newcomer has not heard the earlier ones. */
  announce(): void {
    this.send({ t: "hello", name: this.name, seed: this.seed, moves: this.moves });
  }

  /** Somebody arrived: tell them who we are, so a late joiner learns the room
   * without the host having to relay it. */
  onJoin(): void {
    this.announce();
  }

  /**
   * Somebody's peer left.
   *
   * Marked rather than removed. A bracket is a list of positions and removing
   * a player would renumber every one of them, which is exactly the sort of
   * thing that makes two clients disagree about who is playing whom.
   */
  onLeave(id: string): void {
    this.markGone(id);
    if (this.host) this.send({ t: "gone", id });
    this.fillAbsent();
    this.step();
  }

  /**
   * Sits the AI in any chair of the live match that has gone empty.
   *
   * A chair nobody is in will never announce a team, so a client waiting for
   * one would wait forever — which is the bracket stopping dead, the exact
   * thing the takeover exists to prevent.
   */
  private fillAbsent(): void {
    const seats = this.liveSeats();
    if (!seats || !this.bracket) return;
    for (const seat of [0, 1] as SideIndex[]) {
      if (seats[seat].gone && !this.teams[seat]) {
        this.teams[seat] = this.aiTeam(seats[seat], this.bracket.teamSize);
      }
    }
    this.drainPosted();
  }

  private markGone(id: string): void {
    if (!this.bracket) {
      this.lobby.delete(id);
      return;
    }
    const at = this.bracket.players.findIndex((one) => one.id === id);
    if (at < 0 || this.bracket.players[at].gone) return;
    const players = this.bracket.players.map((one, index) =>
      index === at ? { ...one, gone: true } : one,
    );
    this.bracket = { ...this.bracket, players };
  }

  /** The host, locking the field and starting the draw. */
  lock(size: BracketSize, teamSize: number): void {
    if (!this.host) throw new Error("only the host locks the field");
    const players = this.roster();
    if (players.length !== size) {
      throw new Error(`a bracket of ${size} needs ${size} players, and ${players.length} are here`);
    }
    this.send({ t: "lock", size, teamSize, players, seed: this.seed });
    this.applyLock(size, teamSize, players, this.seed);
  }

  private applyLock(size: BracketSize, teamSize: number, players: Entrant[], seed: string): void {
    this.hostSeed = seed;
    this.bracket = buildBracket(
      this.code,
      size,
      teamSize,
      players.map((one) => ({ id: one.id, name: one.name, ...introduced(one), gone: false })),
    );
    this.phase = "drawn";
    this.step();
  }

  /**
   * Moves to the next match, and starts it if we are in it.
   *
   * Called after anything that could have changed what is next: the draw
   * landing, a result arriving, somebody leaving. Idempotent, because every
   * one of those can arrive twice.
   */
  private step(): void {
    if (!this.bracket || this.fault) return;

    const match = nextMatch(this.bracket);
    if (!match) {
      this.phase = "done";
      this.live = null;
      return;
    }
    if (!ready(match)) return;
    if (this.live && this.live.round === match.round && this.live.at === match.at) return;

    this.live = match;
    this.phase = "match";
    this.battle = null;
    this.pending = null;
    this.theirs = null;
    this.teams = [null, null];

    const seats = match.seats.map((seat) => this.bracket!.players[seat.player!]);
    const mine = seats.findIndex((one) => one.id === this.self);
    this.role = mine < 0 ? null : (mine as SideIndex);

    // Our own team goes in first, into our own slot, and is announced. It has
    // to be announced rather than assumed: the opponent and the whole gallery
    // build this battle too, and none of them can see our party.
    if (this.role !== null) {
      const ours = this.team.slice(0, this.bracket.teamSize);
      this.teams[this.role] = ours;
      this.seen.set(this.self, ours);
      this.send({ t: "team", round: match.round, at: match.at, team: ours });
    }

    // A chair nobody is sitting in will never announce anything, so it is
    // filled now rather than waited for.
    for (const seat of [0, 1] as SideIndex[]) {
      if (seats[seat].gone) this.teams[seat] = this.aiTeam(seats[seat], this.bracket.teamSize);
    }

    this.drainPosted();
  }

  /**
   * Builds the battle once both teams are known.
   *
   * Called from every road that could complete the pair — the match starting,
   * a team arriving, somebody being marked gone — because they can land in
   * any order and a client that only built on one of them would sit forever
   * on the others.
   */
  /**
   * Moves whatever has been posted for the live match into its two seats.
   *
   * Idempotent and cheap, so it is safe to call from every road that could
   * have changed either side of the question.
   */
  private drainPosted(): void {
    const seats = this.liveSeats();
    if (!seats || !this.live) return;

    const held = this.posted.get(`${this.live.round}/${this.live.at}`);
    if (held) {
      for (const [id, team] of held) {
        const seat = seats.findIndex((one) => one.id === id);
        if (seat >= 0 && !this.teams[seat]) this.teams[seat] = team;
      }
    }
    this.tryBuild(seats);
  }

  private tryBuild(seats: Player[]): void {
    if (this.battle || !this.live) return;
    const [first, second] = this.teams;
    if (!first || !second) return;

    this.battle = startBattle(
      matchSeed(this.code, seats[0].id, seats[1].id),
      "bracket",
      first,
      second,
    );

    // Nobody is here to play it: the AI takes both chairs and whoever is
    // still in the room drives it. The lowest id present does it, so exactly
    // one client plays it and the rest watch.
    if (this.shouldDriveAi(seats)) this.playOut();
  }

  /** The two teams for the live match, by seat, as they are announced. */
  private teams: [Individual[] | null, Individual[] | null] = [null, null];

  /**
   * Every team this room has ever announced, by player.
   *
   * So that a player who drops in round three is played by the AI with the
   * creatures they beat two people with, rather than with a stand-in. Kept
   * for the whole tournament because that is exactly how long it is useful.
   */
  private seen = new Map<string, Individual[]>();

  /**
   * Teams announced for a match, held by match and sender until this client
   * has caught up to that match.
   *
   * Buffered rather than acted on directly, because "has this match started
   * *here* yet" and "has somebody sent their team for it" are two independent
   * questions and either can be answered first. The host is the reliable way
   * to get it wrong: it broadcasts the lock before applying it, so by the time
   * it draws its own bracket the other three have already sent their teams —
   * and a client that dropped what it was not ready for sat forever with an
   * empty screen while everybody else watched the match.
   *
   * A real relay reorders anyway. This is the shape that does not care.
   */
  private posted = new Map<string, Map<string, Individual[]>>();

  /** The players in the live match, by seat. */
  private liveSeats(): Player[] | null {
    if (!this.live || !this.bracket) return null;
    return this.live.seats.map((seat) => this.bracket!.players[seat.player!]);
  }

  /**
   * The team of somebody whose chair the AI is taking.
   *
   * **Their own, wherever possible.** Every team announced in this room is
   * remembered — see `seen` — so a player who fought in round one and closed
   * their laptop in round two is still played with the creatures they
   * actually brought. That is the whole difference between the AI standing in
   * for somebody and the AI replacing them.
   *
   * The fallback is for the one case that cannot be covered: somebody who
   * dropped before ever playing a match, whose team nobody in the room has
   * ever seen. It is drawn from the room code and their id — not copied from
   * ours, which would make every such match a mirror — so that every client
   * left in the room builds the *same* stand-in. Two spectators disagreeing
   * about what the absent player brought is a bracket with two results in it.
   */
  private aiTeam(player: Player, size: number): Individual[] {
    const remembered = this.seen.get(player.id);
    if (remembered) return remembered.slice(0, size).map(rested);

    const rng = rngFor(this.code, "absent", player.id);
    // At the level of the field, so a stand-in is neither a walkover nor a
    // wall: the average of what we brought is the only measure of the room
    // this client has.
    const level = Math.max(
      2,
      Math.round(this.team.reduce((total, one) => total + one.level, 0) / Math.max(1, this.team.length)),
    );
    return Array.from({ length: size }, (_, at) =>
      atFullHealth(withMoves(randomCreature(rng, 900_000 + at, [level, level]))),
    );
  }

  /** Whether this client is the one that plays a match nobody is present for. */
  private shouldDriveAi(seats: Player[]): boolean {
    const absent = seats.every((one) => one.gone || one.id !== this.self);
    if (!absent) return false;
    const bothGone = seats.every((one) => one.gone);
    if (!bothGone) return false;
    const here = this.bracket!.players.filter((one) => !one.gone).map((one) => one.id).sort();
    return here[0] === this.self;
  }

  /** Plays a match out locally, with the search in both chairs. */
  private playOut(): void {
    if (!this.battle || !this.live) return;
    let state = this.battle;

    while (!state.outcome) {
      const actions: [BattleAction, BattleAction] = [
        trainerAction(state, 0),
        trainerAction(state, 1),
      ];
      state = resolveTurn(state, actions, DUEL_RULES).battle;
      this.battle = state;
      this.send({ t: "frame", round: this.live.round, at: this.live.at, battle: state });
    }
    this.finish(state);
  }

  /**
   * Our move for the live match.
   *
   * The commit-reveal of `duel.ts` is not repeated here: a bracket match is
   * between two people who are both in a room where everything is broadcast,
   * and the frames are the record. What this does is resolve the turn once
   * both actions are in hand and show the room.
   */
  choose(action: BattleAction): void {
    if (this.role === null || !this.battle || !this.live) return;
    this.pending = action;
    this.send({
      t: "duel",
      round: this.live.round,
      at: this.live.at,
      from: this.self,
      body: action,
    });
    this.maybeResolve();
  }

  private pending: BattleAction | null = null;
  private theirs: BattleAction | null = null;

  private maybeResolve(): void {
    if (this.role === null || !this.battle || !this.live) return;
    if (!this.pending || !this.theirs) return;

    const actions: [BattleAction, BattleAction] = [{ t: "pass" }, { t: "pass" }];
    actions[this.role] = this.pending;
    actions[this.role === 0 ? 1 : 0] = this.theirs;

    try {
      this.battle = resolveTurn(this.battle, actions, DUEL_RULES).battle;
    } catch {
      this.fault = "a move the rules refused";
      return;
    }
    this.pending = null;
    this.theirs = null;

    // Only one of the two broadcasts the frame, so the gallery is not sent
    // every turn twice. Side 0 does it, which both ends agree on.
    if (this.role === 0) {
      this.send({ t: "frame", round: this.live.round, at: this.live.at, battle: this.battle });
    }
    if (this.battle.outcome) this.finish(this.battle);
  }

  /** Announces the result of a match this client played or drove. */
  private finish(state: BattleState): void {
    if (!this.live) return;
    const won: 0 | 1 = state.outcome?.t === "win" && state.outcome.side === 1 ? 1 : 0;
    this.send({ t: "result", round: this.live.round, at: this.live.at, won });
    this.hearResult(this.live.round, this.live.at, won, this.self);
  }

  receive(message: TourneyMessage, from: string): void {
    if (this.fault) return;

    switch (message.t) {
      case "hello":
        if (!this.bracket) this.lobby.set(from, { name: message.name, ...introduced(message) });
        return;

      case "lock":
        // Only from the host, and only once. A second lock is somebody's
        // client repeating itself, or somebody pretending to be the host.
        if (this.host || this.bracket) return;
        // A lock from a client too old to send a seed still starts the
        // bracket. It just draws the prize without a world in it.
        this.applyLock(message.size, message.teamSize, message.players, typeof message.seed === "string" ? message.seed : "");
        return;

      case "team": {
        const theirs = message.team.map((one) => rested(one));
        // Filed under the sender the transport reports, not one the message
        // claims, so a team cannot be posted on somebody else's behalf.
        const key = `${message.round}/${message.at}`;
        const held = this.posted.get(key) ?? new Map<string, Individual[]>();
        held.set(from, theirs);
        this.posted.set(key, held);
        // Remembered for the rest of the tournament, so the AI can play them
        // with their own creatures if they drop later.
        this.seen.set(from, theirs);
        this.drainPosted();
        return;
      }

      case "duel":
        // The opponent's move for a turn, which can arrive before we have
        // finished resolving the previous one. Held in `theirs` either way —
        // `maybeResolve` fires only when both halves are in hand, so an early
        // arrival waits rather than being dropped.
        if (!this.live || message.round !== this.live.round || message.at !== this.live.at) return;
        if (this.role === null) return;
        if (from === this.self) return;
        this.theirs = message.body as BattleAction;
        this.maybeResolve();
        return;

      case "frame":
        // Spectators only. A player has resolved the turn itself and its own
        // copy is the one it acts on.
        //
        // A spectator builds the same battle from the two announced teams and
        // could follow along without these — and is sent them anyway, because
        // a gallery that simulates is a third client that can desync, and a
        // bracket that stops to argue about a fight nobody is playing is the
        // worst failure available. The frame is the truth; the built battle
        // is only so there is something on screen before the first one lands.
        if (this.role !== null) return;
        if (!this.live || message.round !== this.live.round || message.at !== this.live.at) return;
        this.battle = message.battle;
        return;

      case "result":
        this.hearResult(message.round, message.at, message.won, from);
        return;

      case "gone":
        this.markGone(message.id);
        this.fillAbsent();
        this.step();
        return;
    }
  }

  /**
   * A result, from somebody.
   *
   * Both combatants announce, and they must agree. Two different winners for
   * one match means two clients resolved the same battle differently, which
   * is the same fault the duel's hash check exists to catch and is worth
   * stopping the whole bracket for — a tournament that guessed which of two
   * results to believe would be a tournament whose results mean nothing.
   */
  private hearResult(round: number, at: number, won: 0 | 1, from: string): void {
    if (!this.bracket) return;
    const key = `${round}/${at}`;
    const heard = this.claims.get(key) ?? new Map<string, 0 | 1>();
    heard.set(from, won);
    this.claims.set(key, heard);

    const distinct = new Set(heard.values());
    if (distinct.size > 1) {
      this.fault = `two clients disagreed about match ${key}`;
      return;
    }

    const match = this.bracket.rounds[round]?.[at];
    if (!match || match.won !== null) return;

    this.bracket = recordWin(this.bracket, round, at, won);
    this.live = null;
    this.step();
  }
}
