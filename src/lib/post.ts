import type { Individual } from "@/engine/types";
import { joinParty, type PartyRoom, type PartyStatus } from "./party";

/**
 * Tim's board: a market on the same room code the feed uses.
 *
 * Everything here is chatter. A listing is somebody saying "this is mine and
 * I would like this for it", an offer is somebody answering, and a deal is
 * both of them pressing a button in a dialog that spelled the whole thing
 * out. Nothing crosses into a save until that second press, and what crosses
 * then is applied by each side to its own game — see `postDeal` in engine.ts
 * for what is checked and what is taken on trust.
 *
 * The board only exists while people are standing at it. A listing lives in
 * the lister's browser and is shouted again when somebody new arrives; close
 * the tab and your listings go with you, which is the honest behaviour for a
 * market with no building.
 */

/** A creature somebody has put up. */
export interface Listing {
  /** Unique to the lister, so two people can list at the same moment. */
  id: string;
  /** Who is offering it. Their trainer name, which proves nothing. */
  who: string;
  /** The peer it came from, which the transport vouches for. */
  from: string;
  /** Which room it came in on. Filled in by the page, not by the wire. */
  code?: string;
  creature: Individual;
  /** What they are asking in cash, or 0 for "make me an offer". */
  asking: number;
  /** What they say they want, in words. */
  wants: string;
  /** When we heard it, for ordering a board of several people's things. */
  heard: number;
}

/** An answer to a listing: money, a creature, or both. */
export interface Bid {
  /** Unique to the bidder. */
  id: string;
  listing: string;
  who: string;
  from: string;
  /** Which room it came in on, so an answer goes back the way it came. */
  code?: string;
  /** What they are putting up, if anything. */
  creature: Individual | null;
  /** What they are paying, if anything. */
  cash: number;
  heard: number;
}

type Wire =
  /** Everything I have on the board. Sent on joining, and whenever it changes. */
  | { t: "board"; who: string; listings: Omit<Listing, "from" | "heard">[] }
  /** Somebody new arrived: say what you have. */
  | { t: "hello" }
  /** An answer to one of somebody's listings. */
  | { t: "bid"; who: string; bid: Omit<Bid, "from" | "heard"> }
  /** The bid is withdrawn. */
  | { t: "pull"; bid: string }
  /**
   * The lister has said yes, and this is the deal as they applied it.
   *
   * The bidder applies the mirror of it: what the lister gave is what the
   * bidder receives, and the cash changes sign.
   */
  | { t: "struck"; bid: string; listing: string; who: string; creature: Individual | null; cash: number }
  /** The lister has said no. */
  | { t: "declined"; bid: string };

export interface PostHandlers {
  /** Somebody's board, replacing whatever they had up before. */
  onBoard: (from: string, who: string, listings: Listing[]) => void;
  /** An answer to something of ours. */
  onBid: (bid: Bid) => void;
  onPull: (bidId: string) => void;
  /** A deal the other side has already applied: apply our half. */
  onStruck: (deal: { bid: string; listing: string; who: string; creature: Individual | null; cash: number }) => void;
  onDeclined: (bidId: string) => void;
  onStatus: (status: PartyStatus) => void;
  /**
   * How many other people are standing at the board.
   *
   * Peers, counted off the transport — not boards received, which is what the
   * panel used to show. Somebody with nothing up sends no board, so a room
   * that had paired perfectly well read "0 others at the board" until one of
   * you listed something, which is indistinguishable from a room that never
   * connected.
   */
  onCount: (count: number) => void;
  /** Somebody left: their board goes with them. */
  onGone: (from: string) => void;
}

export interface PostRoom {
  /** Shouts our whole board. Called whenever it changes. */
  show: (listings: Omit<Listing, "from" | "heard">[]) => void;
  bid: (bid: Omit<Bid, "from" | "heard">) => void;
  pull: (bidId: string) => void;
  strike: (deal: { bid: string; listing: string; creature: Individual | null; cash: number }) => void;
  decline: (bidId: string) => void;
  leave: () => void;
}

/** A short id for a listing or a bid, unique enough for a room of friends. */
export function postId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Joins the market for this code.
 *
 * The same room the feed uses, on a channel of its own: subscribing to your
 * friends and trading with them are the same circle of people, and asking
 * for a second code would be asking twice for the same thing.
 */
export async function joinPost(code: string, who: () => string, handlers: PostHandlers): Promise<PostRoom> {
  let room: PartyRoom<Wire> | null = null;
  let mine: Omit<Listing, "from" | "heard">[] = [];

  room = await joinParty<Wire>(code, "post", {
    onMessage: (message, from) => {
      switch (message.t) {
        case "hello":
          // Somebody arrived at the board; tell them what is on it.
          if (mine.length) room?.send({ t: "board", who: who(), listings: mine });
          handlers.onCount(Math.max(0, (room?.peers().length ?? 1) - 1));
          return;
        case "board":
          handlers.onBoard(
            from,
            String(message.who ?? "Somebody").slice(0, 24),
            (message.listings ?? []).slice(0, 12).map((one) => ({ ...one, from, heard: Date.now() })),
          );
          return;
        case "bid":
          handlers.onBid({ ...message.bid, from, heard: Date.now(), who: String(message.who ?? "Somebody").slice(0, 24) });
          return;
        case "pull":
          handlers.onPull(message.bid);
          return;
        case "struck":
          handlers.onStruck(message);
          return;
        case "declined":
          handlers.onDeclined(message.bid);
          return;
      }
    },
    onStatus: handlers.onStatus,
    onJoin: () => {
      if (mine.length) room?.send({ t: "board", who: who(), listings: mine });
      handlers.onCount(Math.max(0, (room?.peers().length ?? 1) - 1));
    },
    onLeave: (id) => {
      handlers.onGone(id);
      handlers.onCount(Math.max(0, (room?.peers().length ?? 1) - 1));
    },
  });

  room.send({ t: "hello" });

  return {
    show: (listings) => {
      mine = listings;
      room?.send({ t: "board", who: who(), listings });
    },
    bid: (bid) => room?.send({ t: "bid", who: who(), bid }),
    pull: (bidId) => room?.send({ t: "pull", bid: bidId }),
    strike: (deal) => room?.send({ t: "struck", ...deal, who: who() }),
    decline: (bidId) => room?.send({ t: "declined", bid: bidId }),
    leave: () => room?.leave(),
  };
}
