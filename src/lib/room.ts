/**
 * Getting two browsers talking, with nothing of ours in between.
 *
 * Generic in the message, because a duel and a trade want the same pairing and
 * opposite protocols on top of it. The room knows only that whatever it is
 * handed survives JSON.
 *
 * Trystero matches peers over public relays and then speaks WebRTC directly,
 * so a duel needs no server, no account and no cost — which is the only way
 * this works from a static site at all. The protocol on top of it is in
 * engine/duel.ts and knows nothing about any of this; the pairing here is the
 * same shape the drafter uses, and for the same reasons.
 *
 * Trystero and its relay client are loaded only when somebody actually asks
 * for a duel. Neither belongs in the bundle of a page that is usually one
 * person playing alone.
 */

const APP_ID = "pkm-fever";

export type RoomStatus = "connecting" | "waiting" | "paired" | "failed" | "closed";

export interface RoomHandlers<T> {
  onMessage: (message: T) => void;
  onStatus: (status: RoomStatus) => void;
  /** Fires once, when the other player arrives. */
  onPeer: () => void;
}

export interface Room<T> {
  send: (message: T) => void;
  leave: () => void;
}

/** Long enough that a slow relay is not called a failure, short enough that a
 * network which blocks WebRTC outright stops pretending it might work. */
const CONNECT_GRACE_MS = 12000;

export async function joinRoom<T extends { t: string }>(
  code: string,
  kind: string,
  handlers: RoomHandlers<T>,
): Promise<Room<T>> {
  const { joinRoom: joinTrysteroRoom } = await import("trystero/nostr");

  handlers.onStatus("connecting");
  const room = joinTrysteroRoom({ appId: APP_ID }, `${kind}-${code}`);

  // JSON on the wire rather than the library's structured payload type: it
  // keeps DuelMessage a domain type instead of one shaped by a generic.
  const channel = room.makeAction<string>("msg");

  let peer: string | null = null;
  let live = false;

  channel.onMessage = (raw) => {
    let message: T;
    try {
      message = JSON.parse(raw) as T;
    } catch {
      return;
    }
    if (message && typeof message.t === "string") handlers.onMessage(message);
  };

  room.onPeerJoin = (id) => {
    // A duel is strictly two people. Anyone arriving after the pair is formed
    // is ignored rather than allowed to interleave messages into the protocol.
    if (peer) return;
    peer = id;
    live = true;
    handlers.onStatus("paired");
    handlers.onPeer();
  };

  room.onPeerLeave = (id) => {
    if (id !== peer) return;
    peer = null;
    handlers.onStatus("failed");
  };

  handlers.onStatus("waiting");

  const grace = setTimeout(() => {
    if (!live) handlers.onStatus("failed");
  }, CONNECT_GRACE_MS);

  return {
    send(message) {
      void channel.send(JSON.stringify(message), peer ? { target: peer } : undefined).catch(() => {
        // A peer that vanished mid-send. The duel is over either way, and the
        // session will notice when nothing comes back.
      });
    },
    leave() {
      clearTimeout(grace);
      channel.onMessage = null;
      room.onPeerJoin = null;
      room.onPeerLeave = null;
      void room.leave();
      handlers.onStatus("closed");
    },
  };
}

/** Crockford's base32, so a room code survives being read out loud. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function randomRoomCode(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

export function normaliseRoomCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[ILO]/g, (c) => (c === "I" || c === "L" ? "1" : "0"))
    .replace(/U/g, "V")
    .replace(/[^0-9A-Z]/g, "")
    .slice(0, 10);
}
