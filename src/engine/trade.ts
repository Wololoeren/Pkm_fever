import type { Individual } from "./types";

/**
 * Trading, on the same wire as a duel and with the opposite secrecy.
 *
 * A duel hides each move until both are committed, because seeing the other
 * choice first wins the turn. A trade is the reverse: seeing what is on the
 * table before you agree to it *is* the transaction, so offers travel in the
 * open and either side can withdraw until both have said yes.
 *
 * What still needs protecting is the swap you agreed to. An acceptance names
 * the pair it is agreeing to, so a peer cannot take your yes, quietly change
 * what they were offering, and complete the trade against the new pair. Change
 * either offer and both acceptances are void.
 *
 * What this cannot do, with no server between two people, is guarantee that a
 * completed trade is applied on both sides. A peer can receive and then refuse
 * to give — the same shape as a rage-quit in a duel, and answered the same
 * way: it is visible, it is on the record, and the remedy is social.
 */

export type TradeMessage =
  | { t: "offer"; creature: Individual }
  | { t: "withdraw" }
  /** `pair` names the two offers this is agreeing to. */
  | { t: "accept"; pair: string }
  | { t: "cancel" };

export type TradePhase =
  /** One or both sides have yet to put something on the table. */
  | "offering"
  /** Both offers are up; either side may accept or withdraw. */
  | "reviewing"
  /** We have accepted and are waiting on them. */
  | "waiting"
  /** Both accepted. `completed` says what changed hands. */
  | "done"
  | "cancelled";

export interface TradeView {
  phase: TradePhase;
  ours: Individual | null;
  theirs: Individual | null;
  weAccepted: boolean;
  theyAccepted: boolean;
  /** Set once, when both sides have agreed to the same pair. */
  completed: { given: Individual; received: Individual } | null;
}

/**
 * Identifies a pair of offers, so an acceptance cannot be reused for a
 * different one.
 *
 * Both sides have to compute the same string for the same two creatures, and
 * each holds them the other way round — so the two stamps are **sorted**
 * rather than ordered by anything about either creature's place in the trade.
 *
 * It used to order them by uid, which is not an order at all here: a uid is a
 * save's own counter, so both players are holding a uid 1 more often than
 * not. On a tie each side put its own creature first, the two keys never
 * matched, and the trade sat on "Waiting for them…" on both screens forever —
 * every test had passed because every test gave the two sides different uids.
 */
function pairKey(a: Individual | null, b: Individual | null): string {
  if (!a || !b) return "-";
  const stamp = (creature: Individual) =>
    `${creature.uid}:${creature.speciesId}:${creature.level}:${creature.natureId}:${creature.variantId}`;
  return [stamp(a), stamp(b)].sort().join("|");
}

export class TradeSession {
  private readonly send: (message: TradeMessage) => void;

  private ours: Individual | null = null;
  private theirs: Individual | null = null;
  private weAccepted = false;
  private theyAcceptedPair: string | null = null;
  private completed: TradeView["completed"] = null;
  private cancelled = false;

  constructor(send: (message: TradeMessage) => void) {
    this.send = send;
  }

  view(): TradeView {
    return {
      phase: this.phase(),
      ours: this.ours,
      theirs: this.theirs,
      weAccepted: this.weAccepted,
      theyAccepted: this.theyAcceptedPair === pairKey(this.ours, this.theirs),
      completed: this.completed,
    };
  }

  private phase(): TradePhase {
    if (this.completed) return "done";
    if (this.cancelled) return "cancelled";
    if (!this.ours || !this.theirs) return "offering";
    return this.weAccepted ? "waiting" : "reviewing";
  }

  /** Puts something on the table, replacing whatever was there. */
  offer(creature: Individual): void {
    if (this.completed || this.cancelled) return;
    this.ours = { ...creature };
    // Changing what you are offering voids both acceptances: nobody has agreed
    // to this pair yet.
    this.weAccepted = false;
    this.theyAcceptedPair = null;
    this.send({ t: "offer", creature: this.ours });
  }

  withdraw(): void {
    if (this.completed || this.cancelled || !this.ours) return;
    this.ours = null;
    this.weAccepted = false;
    this.theyAcceptedPair = null;
    this.send({ t: "withdraw" });
  }

  accept(): void {
    if (this.phase() !== "reviewing") return;
    this.weAccepted = true;
    this.send({ t: "accept", pair: pairKey(this.ours, this.theirs) });
    this.settle();
  }

  cancel(): void {
    if (this.completed) return;
    this.cancelled = true;
    this.send({ t: "cancel" });
  }

  receive(message: TradeMessage): void {
    if (this.completed || this.cancelled) return;

    switch (message.t) {
      case "offer":
        this.theirs = { ...message.creature };
        this.weAccepted = false;
        this.theyAcceptedPair = null;
        return;

      case "withdraw":
        this.theirs = null;
        this.weAccepted = false;
        this.theyAcceptedPair = null;
        return;

      case "accept":
        // Recorded against the pair it names. If either offer moves afterwards
        // this stops matching, and the acceptance is dead.
        this.theyAcceptedPair = message.pair;
        this.settle();
        return;

      case "cancel":
        this.cancelled = true;
        return;
    }
  }

  private settle(): void {
    if (this.completed || !this.ours || !this.theirs || !this.weAccepted) return;
    if (this.theyAcceptedPair !== pairKey(this.ours, this.theirs)) return;

    this.completed = { given: this.ours, received: this.theirs };
  }
}
