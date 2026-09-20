"use client";

import { useState } from "react";
import type { FriendPost } from "@/lib/friends";
import type { PartyStatus } from "@/lib/party";
import { normaliseRoomCode, randomRoomCode } from "@/lib/room";

/**
 * Subscribing to somebody: a room code, and nothing else.
 *
 * Everybody who types the same code hears everybody else's feed, and can see
 * everybody else's board at Tim's. Nothing that arrives that way touches a
 * save — it is somebody's word about their own game — which is what lets the
 * code be a code rather than an account.
 *
 * Several at once, because friends are not one group: the person who plays
 * with their brother and with three people from a forum should not have to
 * choose which. Each is its own swarm with its own head count, and they are
 * listed rather than merged so it stays obvious who can see what you put up
 * at the trading post.
 *
 * One component in two places: the Doomscroller's Friends tab, and the button
 * under the node map. It used to live only in the Doomscroller, which meant
 * subscribing to a friend was gated behind owning the Doomscroller — a thing
 * you find hours in, for a feature that is about playing with somebody else
 * from the start.
 */

/** Everything the page knows about the rooms of friends, handed down. */
export interface FriendsFeed {
  /** Every code we are in. Empty for nowhere. */
  codes: readonly string[];
  status: Record<string, PartyStatus | null>;
  /** How many other people are in each room, by code. */
  here: Record<string, number>;
  posts: readonly FriendPost[];
  /** How many rooms are allowed at once. */
  max: number;
  onJoin: (code: string) => void;
  onLeave: (code: string) => void;
}

/** How one room is doing, in the fewest words that are still true. */
export function roomStatus(friends: FriendsFeed, code: string): string {
  const here = friends.here[code] ?? 0;
  if (friends.status[code] === "live" || here > 0) {
    return `${here} other${here === 1 ? "" : "s"} here`;
  }
  if (friends.status[code] === "connecting") return "finding the room…";
  if (friends.status[code] === "failed") return "no relay would have us";
  return "waiting for somebody";
}

/** Everybody we are listening to, and how many. */
export function roomsSummary(friends: FriendsFeed): string {
  if (!friends.codes.length) return "not subscribed";
  const here = friends.codes.reduce((sum, code) => sum + (friends.here[code] ?? 0), 0);
  const rooms = friends.codes.length === 1 ? friends.codes[0] : `${friends.codes.length} rooms`;
  return `${rooms} · ${here} other${here === 1 ? "" : "s"}`;
}

/** The codes we are in, and the two ways to add another. */
export function FriendsRoom({ friends }: { friends: FriendsFeed }) {
  const [typed, setTyped] = useState("");
  const full = friends.codes.length >= friends.max;

  return (
    <div className="friendsRooms">
      {friends.codes.map((code) => (
        <div key={code} className="row">
          <span className="tag rise">{code}</span>
          <span className="muted small">{roomStatus(friends, code)}</span>
          <button
            type="button"
            className="ghost small"
            title={`Stop listening to ${code}`}
            onClick={() => friends.onLeave(code)}
          >
            Leave
          </button>
        </div>
      ))}

      <div className="row">
        <input
          value={typed}
          onChange={(event) => setTyped(normaliseRoomCode(event.target.value))}
          placeholder="ROOM CODE"
          aria-label="Room code"
          spellCheck={false}
          disabled={full}
        />
        <button
          type="button"
          className="primary"
          disabled={full || typed.length < 4 || friends.codes.includes(typed)}
          title={
            full
              ? `No more than ${friends.max} rooms at once`
              : friends.codes.includes(typed)
                ? "You are already in that one"
                : typed.length < 4
                  ? "A code is at least four characters"
                  : "Listen to this room as well"
          }
          onClick={() => {
            friends.onJoin(typed);
            setTyped("");
          }}
        >
          {friends.codes.length ? "Add" : "Subscribe"}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={full}
          title={full ? `No more than ${friends.max} rooms at once` : "Make one up and tell your friends"}
          onClick={() => {
            friends.onJoin(randomRoomCode());
            setTyped("");
          }}
        >
          Start a room
        </button>
      </div>
    </div>
  );
}
