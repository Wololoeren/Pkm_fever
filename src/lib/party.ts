/**
 * A room with more than two people in it.
 *
 * `room.ts` pairs exactly two browsers and says so out loud — "a duel is
 * strictly two people. Anyone arriving after the pair is formed is ignored" —
 * which is the right rule for a duel and a trade, and the wrong one for a
 * bracket of sixteen. This is the same transport with that rule lifted: every
 * peer is kept, messages go to everybody by default, and joins and leaves are
 * reported rather than swallowed.
 *
 * Deliberately a second file rather than a flag on the first. The two-peer
 * room's guarantee — that no third party can interleave messages into a
 * commit-reveal protocol — is worth keeping exactly as it is, and a shared
 * implementation with a `maxPeers` would be one edit away from quietly
 * removing it from the duel as well.
 *
 * Nothing here knows what a tournament is. `engine/tourney.ts` speaks the
 * protocol and `engine/bracket.ts` holds the draw; this moves strings.
 */

import { anyRelayOpen, RELAY_GRACE_MS, trysteroConfig } from "./relays";

export type PartyStatus = "connecting" | "waiting" | "live" | "failed" | "closed";

export interface PartyHandlers<T> {
  /** A message, and which peer it came from. The sender is the transport's
   * id, not anything the sender chose, which is what makes it usable as an
   * identity in the draw. */
  onMessage: (message: T, from: string) => void;
  onStatus: (status: PartyStatus) => void;
  /** Somebody arrived. Fires per peer, not once. */
  onJoin: (id: string) => void;
  /**
   * Somebody left.
   *
   * The event a bracket cares about most: a player who closes the tab
   * mid-tournament is a chair the AI has to sit down in, and this is the only
   * notice there is that it happened.
   */
  onLeave: (id: string) => void;
}

export interface PartyRoom<T> {
  /** Our own peer id, once the transport has assigned one. */
  self: string;
  /** Everybody here, including us, in join order. */
  peers: () => string[];
  /** To everybody. */
  send: (message: T) => void;
  /** To one peer, for a protocol that is between two of the people present. */
  sendTo: (id: string, message: T) => void;
  leave: () => void;
}

const CLOSE_ABORT_MS = 4000;

/** The same narrow suppression `room.ts` documents at length. */
function ignoreCloseAbort(): void {
  if (typeof window === "undefined") return;

  const handler = (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    const name = (reason as { name?: unknown })?.name;
    const message = (reason as { message?: unknown })?.message;
    if (name === "OperationError" && typeof message === "string" && /close called/i.test(message)) {
      event.preventDefault();
    }
  };

  window.addEventListener("unhandledrejection", handler);
  window.setTimeout(() => window.removeEventListener("unhandledrejection", handler), CLOSE_ABORT_MS);
}

export async function joinParty<T extends { t: string }>(
  code: string,
  kind: string,
  handlers: PartyHandlers<T>,
): Promise<PartyRoom<T>> {
  const { joinRoom: joinTrysteroRoom, selfId, getRelaySockets } = await import("trystero/nostr");

  handlers.onStatus("connecting");
  const room = joinTrysteroRoom(trysteroConfig(), `${kind}-${code}`);
  const channel = room.makeAction<string>("msg");

  // Join order, which is not the draw order — see `drawOrder`, which shuffles
  // it precisely so that being quick to click buys nothing.
  const present: string[] = [];

  channel.onMessage = (raw, context) => {
    let message: T;
    try {
      message = JSON.parse(raw) as T;
    } catch {
      return;
    }
    // The sender comes off the transport's context rather than out of the
    // message, and that is the whole reason a bracket can use it as an
    // identity: a peer cannot claim to be somebody else without the relay
    // agreeing, and the relay has no reason to.
    if (message && typeof message.t === "string") handlers.onMessage(message, context.peerId);
  };

  room.onPeerJoin = (id) => {
    if (present.includes(id)) return;
    present.push(id);
    handlers.onStatus("live");
    handlers.onJoin(id);
  };

  room.onPeerLeave = (id) => {
    const at = present.indexOf(id);
    if (at < 0) return;
    present.splice(at, 1);
    handlers.onLeave(id);
    // Not "failed": a bracket of sixteen losing one is a chair for the AI,
    // not the end of the room. Whether it matters is the protocol's business.
  };

  handlers.onStatus("waiting");

  // Judge the network, never the room: an empty room after twelve seconds is
  // somebody still typing the code. Only when no relay is open at all is
  // there nothing to wait for — and a relay that comes back un-fails it.
  let failedNetwork = false;
  const grace = setInterval(() => {
    if (present.length) return clearInterval(grace);
    const open = anyRelayOpen(getRelaySockets() as Record<string, WebSocket>);
    if (open === !failedNetwork) return;
    failedNetwork = !open;
    handlers.onStatus(open ? "waiting" : "failed");
  }, RELAY_GRACE_MS);

  return {
    self: selfId,
    peers: () => [selfId, ...present],
    send(message) {
      void channel.send(JSON.stringify(message)).catch(() => {
        // Somebody vanished mid-send. `onLeave` is the notice that matters.
      });
    },
    sendTo(id, message) {
      void channel.send(JSON.stringify(message), { target: id }).catch(() => {});
    },
    leave() {
      clearInterval(grace);
      channel.onMessage = null;
      room.onPeerJoin = null;
      room.onPeerLeave = null;

      ignoreCloseAbort();
      try {
        const closing = room.leave() as unknown;
        if (closing instanceof Promise) closing.catch(() => {});
      } catch {
        // Already closed, or closed underneath us.
      }

      handlers.onStatus("closed");
    },
  };
}
