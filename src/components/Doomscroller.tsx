"use client";

import { useState } from "react";
import type { FriendPost } from "@/lib/friends";
import type { PartyStatus } from "@/lib/party";
import { normaliseRoomCode, randomRoomCode } from "@/lib/room";
import { ability } from "@/engine/abilities";
import { lot as auctionLot } from "@/engine/auction";
import { eggSteps } from "@/engine/breeding";
import { species as speciesById } from "@/engine/dex";
import {
  closedBids,
  DOOMSCROLL_STEPS,
  doomscrollRefusal,
  EGGOMETER,
  pawnWait,
  shredWait,
  therapyWait,
  fameLevel,
  fameToNext,
  STREAM_STAKE,
  tutorWait,
  WORKSHOP_JOBS,
  WORKSHOP_STATIONS,
  type GameState,
  type Input,
} from "@/engine/engine";
import { hasItem } from "@/engine/items";
import { cutWait } from "@/engine/lapidary";
import { printWait } from "@/engine/printer";
import type { World } from "@/engine/world";
import { displayName } from "@/lib/narrate";
import { eggMood } from "./PartyStrip";

/**
 * The Doomscroller: every clock you have running, as a feed.
 *
 * It is a joke about a thing you keep checking, and it is also exactly that:
 * the printer, the wheel, the shredder, the pawnbroker, the tutor, the
 * workshop, the auction and the eggs, each one a post. Anything that is ready
 * floats to the top, because that is the only post anybody reads.
 *
 * Read-only. Everything here is asked of the state; nothing is kept.
 */

interface Post {
  who: string;
  handle: string;
  text: string;
  /** Ready now: pinned to the top and marked. */
  ready: boolean;
}

/** Every post there is right now, ready ones first. */
export function feedPosts(world: World, state: GameState): Post[] {
  const posts: Post[] = [];
  const post = (who: string, handle: string, text: string, ready: boolean) => posts.push({ who, handle, text, ready });

  if (state.printedAt !== null) {
    const wait = printWait(state.tick, state.printedAt);
    post("Ivo", "@ivo_prints", wait ? `machine cooling down. ${wait} moves. do not touch it` : "printer's warm again 🖨️ come get a copy", !wait);
  }
  if (state.cutAt !== null) {
    const wait = cutWait(state.tick, state.cutAt);
    post("Hessa", "@hessa.cuts", wait ? `wheel still turning. ${wait} moves.` : "wheel's cool. bring me something to turn into a stone 💎", !wait);
  }
  if (state.shreddedAt !== null) {
    const wait = shredWait(state.tick, state.shreddedAt);
    post("Marv", "@marv_reclaims", wait ? `drum's busy. ${wait} moves. don't ask what's in it` : "drum's empty. no questions asked 🍬", !wait);
  }
  if (state.pawnedAt !== null) {
    const wait = pawnWait(state.stepsTaken, state.pawnedAt);
    post("Pawnbroker", "@cash4mons", wait ? `still selling the last one on. ${wait} steps` : "buying again. fifty a level, cash 💰", !wait);
  }
  if (state.tutoring) {
    const wait = tutorWait(state);
    const name = displayName(state.tutoring.creature);
    const learning = ability(state.tutoring.abilityId).name;
    post(
      "Ability Tutor",
      "@learn_with_tutor",
      wait ? `${name} is studying ${learning}. ${wait} steps to go 📚` : `${name} has learned ${learning}! come pick them up 🎓`,
      !wait,
    );
  }
  if (state.therapy) {
    const wait = therapyWait(state);
    const name = displayName(state.therapy.creature);
    post("Dr. Couch", "@couch_sessions", wait ? `${name} is opening up. ${wait} steps left in the session 🛋️` : `${name} has had a breakthrough. come and collect them 💚`, !wait);
  }
  if (state.influencing) {
    const posted = state.stepsTaken - state.influencing.since;
    const creature = state.influencing.creature;
    const fame = fameLevel({ ...creature, fameSteps: (creature.fameSteps ?? 0) + posted });
    const next = fameToNext(creature, posted);
    post(
      "Skye",
      "@skye.irl",
      `${displayName(creature)} is Famous ${fame} ✨ ${next === null ? "literally cannot get more famous" : `${next} steps to the next level`}`,
      next === null,
    );
  }
  if (state.stream) {
    const star = [...state.party, ...state.box].find((one) => one.uid === state.stream!.uid);
    post(
      "xX_Stream_Xx",
      "@stream_xx",
      `🔴 LIVE with ${star ? displayName(star) : "somebody"} · pool ¤${state.stream.pool.toLocaleString()} · ${state.stream.pool.toLocaleString()} steps of bandwidth left`,
      state.stream.pool > STREAM_STAKE,
    );
  }
  for (const station of WORKSHOP_STATIONS) {
    const held = state.workshop[station];
    if (!held) continue;
    const levels = held.creature.level - held.fromLevel;
    post(
      "Workshop",
      "@workshop_shifts",
      `${displayName(held.creature)} is ${WORKSHOP_JOBS[station]} — up ${levels} level${levels === 1 ? "" : "s"} since you dropped them off`,
      false,
    );
  }

  // The auction: a post per open bid, and a post for anything that has closed.
  const closed = new Set(closedBids(world, state).map((bid) => bid.n));
  for (const bid of state.bids) {
    const lot = auctionLot(world.seed, bid.n);
    const name = speciesById(lot.speciesId).name;
    if (closed.has(bid.n)) {
      post("Auction House", "@auction_house", `🔨 SOLD: lot ${bid.n}, ${name}. come and see if it went your way`, true);
    } else {
      post("Auction House", "@auction_house", `your bid on lot ${bid.n} (${name}) closes in ${lot.closesAt - state.stepsTaken} steps ⏳`, false);
    }
  }

  // Eggs.
  const exact = hasItem(state.bag, EGGOMETER);
  const [first, second] = state.daycare.slots;
  if (first && second) {
    if (state.daycare.eggReady) {
      post("Daycare", "@hearth_daycare", "an egg is waiting at the daycare 🥚", true);
    } else {
      const left = eggSteps(state.daycare.applied) - state.daycare.steps;
      post("Daycare", "@hearth_daycare", `${displayName(first)} and ${displayName(second)} are getting along. next egg in ${left} steps`, false);
    }
  }
  const eggs = [
    ...state.eggs.map((egg) => ({ egg, where: "in your party" })),
    ...state.daycare.incubating.map((egg) => ({ egg, where: "in an incubator" })),
  ];
  for (const { egg, where } of eggs) {
    post("Egg", "@egg_updates", `(${where}) ${eggMood(egg, exact)}`, egg.steps === 0);
  }

  return [...posts.filter((one) => one.ready), ...posts.filter((one) => !one.ready)];
}

/** Everything the page knows about the room of friends, handed down. */
export interface FriendsFeed {
  /** The code we are in, or "" for nowhere. */
  code: string;
  status: PartyStatus | null;
  /** How many other people are in the room. */
  here: number;
  posts: readonly FriendPost[];
  onCode: (code: string) => void;
}

export function Doomscroller({
  world,
  state,
  onInput,
  friends,
  onClose,
}: {
  world: World;
  state: GameState;
  onInput: (input: Input) => void;
  friends?: FriendsFeed;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const posts = feedPosts(world, state);
  // What each of the three is called. Nobody sits down meaning to lose a
  // thousand steps, which is the joke and also what the buttons say.
  // Two tabs: the timers, and what the world has said about your game.
  const [tab, setTab] = useState<"timers" | "news" | "friends">("timers");
  const sittings: [number, string][] = [
    [DOOMSCROLL_STEPS[0], "A bit"],
    [DOOMSCROLL_STEPS[1], "A little more"],
    [DOOMSCROLL_STEPS[2], "Just one more"],
  ];
  return (
    <div className="cheatBackdrop" role="dialog" aria-label="Doomscroller">
      <section className="cheatPanel handbook doomscroller">
        <header className="handbookHead">
          <div className="cheatHead">
            <h2>Doomscroller</h2>
            <button type="button" className="ghost" onClick={onClose}>
              Close
            </button>
          </div>
          <p className="muted small">
            {posts.filter((one) => one.ready).length} ready · {posts.length} posts · you have been scrolling for {state.stepsTaken.toLocaleString()} steps
          </p>
          {/* And the thing a feed is actually for: passing time you meant to
              spend on something else. Every step counts as a step — eggs walk,
              poison bites, the stream's pool drains — you simply do not move. */}
          <div className="row scrollOn">
            {sittings.map(([steps, label]) => (
              <button
                key={steps}
                type="button"
                className="ghost small"
                disabled={Boolean(doomscrollRefusal(state, steps))}
                title={doomscrollRefusal(state, steps) ?? `${steps.toLocaleString()} steps go by where you stand`}
                onClick={() => onInput({ t: "doomscroll", steps })}
              >
                {label} · {steps.toLocaleString()}
              </button>
            ))}
          </div>
          <div className="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "timers"}
              className={`tab${tab === "timers" ? " on" : ""}`}
              onClick={() => setTab("timers")}
            >
              Timers<span className="tabCount">{posts.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "news"}
              className={`tab${tab === "news" ? " on" : ""}`}
              onClick={() => setTab("news")}
            >
              News<span className="tabCount">{state.news.length}</span>
            </button>
            {friends ? (
              <button
                type="button"
                role="tab"
                aria-selected={tab === "friends"}
                className={`tab${tab === "friends" ? " on" : ""}`}
                onClick={() => setTab("friends")}
              >
                Friends<span className="tabCount">{friends.posts.length}</span>
              </button>
            ) : null}
          </div>
        </header>

        {tab === "news" ? (
          <>
            {state.news.length ? (
              <ol className="newsList">
                {[...state.news].reverse().map((item) => (
                  <li key={`${item.at}:${item.kind}`} className="newsLine">
                    <span className="newsWhen">{item.at.toLocaleString()}</span>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="hint">Nothing yet. Walk about, catch something, and it will find an opinion.</p>
            )}
            <p className="muted small">
              The newest line pops up in the corner as it is written, unless you have muted it — muting
              only stops the corner, and every line is kept here either way.
            </p>
          </>
        ) : null}
        {tab === "friends" && friends ? (
          <>
            {/* A room code and nothing else: everybody who types the same one
                hears everybody else's feed. Nothing received here touches the
                game — it is somebody's word about their own save. */}
            <div className="row">
              {friends.code ? (
                <>
                  <span className="tag rise">{friends.code}</span>
                  <span className="muted small">
                    {friends.status === "live" || friends.here > 0
                      ? `${friends.here} other${friends.here === 1 ? "" : "s"} here`
                      : friends.status === "connecting"
                        ? "finding the room…"
                        : friends.status === "failed"
                          ? "no relay would have us"
                          : "waiting for somebody"}
                  </span>
                  <button type="button" className="ghost small" onClick={() => friends.onCode("")}>
                    Leave
                  </button>
                </>
              ) : (
                <>
                  <input
                    value={typed}
                    onChange={(event) => setTyped(normaliseRoomCode(event.target.value))}
                    placeholder="ROOM CODE"
                    aria-label="Room code"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="primary"
                    disabled={typed.length < 4}
                    title={typed.length < 4 ? "A code is at least four characters" : "Listen to this room"}
                    onClick={() => friends.onCode(typed)}
                  >
                    Subscribe
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    title="Make one up and tell your friends"
                    onClick={() => {
                      const code = randomRoomCode();
                      setTyped(code);
                      friends.onCode(code);
                    }}
                  >
                    Start a room
                  </button>
                </>
              )}
            </div>
            {friends.posts.length ? (
              <ol className="newsList">
                {[...friends.posts].reverse().map((post) => (
                  <li key={`${post.who}:${post.heard}`} className="newsLine">
                    <span className="newsWhen">{post.who}</span>
                    <span>{post.text}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="hint">
                Nothing from anybody yet. Your own lines go out as they are written, so leave it open.
              </p>
            )}
            <p className="muted small">
              Everybody on this code hears everybody. What crosses is a line of text and the name you
              chose — never a creature, never a save. Nothing here can change your game.
            </p>
          </>
        ) : null}

        {tab === "timers" && posts.length ? (
          <ol className="feed">
            {posts.map((one, at) => (
              <li key={at} className={`feedPost${one.ready ? " ready" : ""}`}>
                <div className="feedHead">
                  <strong>{one.who}</strong> <span className="muted">{one.handle}</span>
                  {one.ready ? <span className="tag rise">READY</span> : null}
                </div>
                <p>{one.text}</p>
              </li>
            ))}
          </ol>
        ) : tab === "timers" ? (
          <p className="muted">Nothing on your feed. Go and start a clock somewhere — touch grass, as they say.</p>
        ) : null}
      </section>
    </div>
  );
}
