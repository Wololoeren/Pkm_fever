/**
 * Which Nostr relays the rooms meet on, and how to tell a dead network from an
 * empty room.
 *
 * Trystero picks five relays from its built-in list by hashing the app id. For
 * "pkm-fever" that pick was bad: tested from the live site on 2026-09-15, four
 * of the five were closed or never finished connecting, so every duel, trade
 * and bracket hung on a single relay. Anybody that one relay could not reach,
 * or that it rate-limited, never saw the other player at all.
 *
 * So the list is ours. Each of these paired two browsers through Trystero on
 * its own in that same test, and all of them are used at once: a room only
 * needs one relay that both players reach.
 *
 * Both players must be on the same list, so changing it strands anybody on an
 * older page until they reload. Add relays freely; remove one only when it is
 * dead anyway.
 */
export const RELAY_URLS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.mom",
  "wss://relay.snort.social",
  "wss://nostr.data.haus",
  "wss://nostr.islandarea.net",
];

export const APP_ID = "pkm-fever";

/** The config every room joins with. */
export function trysteroConfig() {
  return { appId: APP_ID, relayConfig: { urls: RELAY_URLS, redundancy: RELAY_URLS.length } };
}

/**
 * How long to give the relays before judging the network.
 *
 * Only the network is judged. Nobody having joined yet is not a failure — the
 * other player may still be typing the code — so a room waits for as long as
 * at least one relay is open.
 */
export const RELAY_GRACE_MS = 12000;

/** Whether any relay socket is open, from Trystero's own sockets. */
export function anyRelayOpen(sockets: Record<string, WebSocket>): boolean {
  return Object.values(sockets).some((socket) => socket.readyState === 1);
}
