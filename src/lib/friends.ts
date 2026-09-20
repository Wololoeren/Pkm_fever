import type { NewsKind } from "@/engine/news";
import { joinParty, type PartyRoom, type PartyStatus } from "./party";

/**
 * Subscribing to your friends' games.
 *
 * Everybody who types the same room code meets in one room and shouts their
 * own feed into it: a catch, a level worth remarking on, a badge, a trade, a
 * prize, a blackout. Nothing is asked for and nothing is answered — it is a
 * broadcast, which is why it can be a party room rather than a protocol.
 *
 * What crosses the wire is a line of text that was already written locally,
 * plus who wrote it. Never a creature, never a save, never a seed: a feed post
 * is a *claim* about somebody else's game, and this game is careful about
 * where its state comes from. Nothing received here reaches the engine or a
 * save — it lands in the Doomscroller's Friends tab and nowhere else.
 *
 * The transport is the one the duels and the brackets use: Trystero over
 * public Nostr relays, WebRTC between browsers, no server of ours anywhere.
 */

/** What one friend's game had to say. */
export interface FriendPost {
  /** Who says so. Their trainer name, which they chose and which proves nothing. */
  who: string;
  /** Which room it came in on. Filled in by the page rather than by the wire. */
  code?: string;
  /** Their step count when it happened, for their own sense of time. */
  at: number;
  kind: NewsKind;
  text: string;
  /** When we heard it, so the tab can order posts from different games. */
  heard: number;
}

/** What goes over the wire. */
type Wire =
  | { t: "news"; who: string; at: number; kind: NewsKind; text: string }
  /** Sent on arrival so a quiet room still shows who is in it. */
  | { t: "hello"; who: string };

export interface FeedHandlers {
  onPost: (post: FriendPost) => void;
  onStatus: (status: PartyStatus) => void;
  /** How many other people are in the room. */
  onCount: (count: number) => void;
}

export interface FeedRoom {
  /** Shouts one of our own lines into the room. */
  say: (item: { at: number; kind: NewsKind; text: string }) => void;
  leave: () => void;
}

/** How many posts a tab keeps. A feed is not an archive. */
export const FRIEND_POSTS_KEPT = 60;

/** Where the codes and what we have heard are remembered, per browser. */
export const FRIENDS_CODE_KEY = "pkm-fever.friendsCode";
export const FRIENDS_POSTS_KEY = "pkm-fever.friendsPosts";

/**
 * How many rooms can be subscribed to at once.
 *
 * Not one: friends are not a single group, and the person who plays with
 * their brother and with three people from a forum should not have to pick.
 * Not unlimited either — every room is a swarm of WebRTC connections over
 * public relays, and a browser holding twenty of them is a browser that has
 * stopped doing anything else.
 */
export const FRIENDS_ROOMS_MAX = 5;

/**
 * The codes this browser is subscribed to.
 *
 * Stored comma-separated under the key that used to hold a single code, so a
 * browser that remembered one room before this existed reads back as a list
 * of one rather than as nothing.
 */
export function readFriendsCodes(): string[] {
  try {
    return cleanCodes((localStorage.getItem(FRIENDS_CODE_KEY) ?? "").split(","));
  } catch {
    return [];
  }
}

export function writeFriendsCodes(codes: readonly string[]): void {
  try {
    const clean = cleanCodes(codes);
    if (clean.length) localStorage.setItem(FRIENDS_CODE_KEY, clean.join(","));
    else localStorage.removeItem(FRIENDS_CODE_KEY);
  } catch {
    // No storage: subscribed for this sitting only.
  }
}

/** Trimmed, upper-cased, no blanks, no duplicates, no more than the limit. */
export function cleanCodes(codes: readonly string[]): string[] {
  const out: string[] = [];
  for (const code of codes) {
    const clean = String(code ?? "").trim().toUpperCase();
    if (!clean || out.includes(clean)) continue;
    out.push(clean);
    if (out.length >= FRIENDS_ROOMS_MAX) break;
  }
  return out;
}

/**
 * Joins the room for this code and starts listening.
 *
 * `who` is our own trainer name, sent with every line. It is a label rather
 * than an identity — the transport knows which peer sent what, and nothing
 * here depends on the name being true.
 *
 * Asked for rather than handed over, because the room is joined before there
 * is a game: a code remembered in this browser is rejoined as the page loads,
 * which is well before a save has been continued and a trainer has a name. A
 * name read once at that moment is "Somebody" for the rest of the sitting,
 * which is exactly what every line arriving at a friend's feed used to say.
 */
export async function joinFeed(code: string, who: () => string, handlers: FeedHandlers): Promise<FeedRoom> {
  let room: PartyRoom<Wire> | null = null;

  room = await joinParty<Wire>(code, "feed", {
    onMessage: (message) => {
      if (message.t === "hello") {
        handlers.onCount(Math.max(0, (room?.peers().length ?? 1) - 1));
        return;
      }
      if (message.t !== "news") return;
      // Everything about a post is somebody else's claim, so it is trimmed to
      // a length a panel can hold and otherwise left alone.
      handlers.onPost({
        who: String(message.who ?? "Somebody").slice(0, 24),
        at: Number(message.at) || 0,
        kind: message.kind,
        text: String(message.text ?? "").slice(0, 200),
        heard: Date.now(),
      });
    },
    onStatus: handlers.onStatus,
    onJoin: () => {
      room?.send({ t: "hello", who: who() });
      handlers.onCount(Math.max(0, (room?.peers().length ?? 1) - 1));
    },
    onLeave: () => handlers.onCount(Math.max(0, (room?.peers().length ?? 1) - 1)),
  });

  room.send({ t: "hello", who: who() });

  return {
    say: (item) => room?.send({ t: "news", who: who(), at: item.at, kind: item.kind, text: item.text }),
    leave: () => room?.leave(),
  };
}

/** What we have heard, read back from this browser. */
export function readFriendPosts(): FriendPost[] {
  try {
    const raw = localStorage.getItem(FRIENDS_POSTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FriendPost[]).slice(-FRIEND_POSTS_KEPT) : [];
  } catch {
    return [];
  }
}

/** And written back, newest last. */
export function writeFriendPosts(posts: readonly FriendPost[]): void {
  try {
    localStorage.setItem(FRIENDS_POSTS_KEY, JSON.stringify(posts.slice(-FRIEND_POSTS_KEPT)));
  } catch {
    // No storage: the tab still has them for this sitting.
  }
}
