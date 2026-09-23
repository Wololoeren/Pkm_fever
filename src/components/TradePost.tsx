"use client";

import { useState } from "react";
import { species as speciesById } from "@/engine/dex";
import { ivTotal } from "@/engine/stats";
import { STAT_IDS, type Individual } from "@/engine/types";
import { postDealRefusal, type GameState } from "@/engine/engine";
import { displayName } from "@/lib/narrate";
import type { Bid, Listing } from "@/lib/post";
import { Sprite } from "./Sprite";
import { StatHover } from "./StatHover";

/**
 * Tim's board: what you have put up, and what your friends have.
 *
 * Two tabs because there are two questions — what am I offering, and what is
 * anybody offering me — and one list holding both would answer neither. The
 * board itself lives on the wire (see `lib/post.ts`); this draws it and hands
 * presses back to the page, which owns the room.
 *
 * Nothing here touches a save. A deal reaches the engine only when somebody
 * presses the button in the dialog that spells the whole thing out, and each
 * side applies its own half.
 */

/** A creature in one line, for a board that has to fit several. */
function Line({ creature }: { creature: Individual }) {
  const kind = speciesById(creature.speciesId);
  return (
    <span className="postLine">
      <Sprite speciesId={creature.speciesId} variantId={creature.variantId} size={48} abilities={creature.abilities} />
      <span>
        <strong>{displayName(creature)}</strong> · Lv{creature.level}
        <br />
        <span className="muted small">
          {kind.types.join("/")} · IV {ivTotal(creature.ivs)}/{31 * STAT_IDS.length}
          {creature.abilities.length ? ` · ${creature.abilities.length} ability` : ""}
        </span>
      </span>
    </span>
  );
}

/** Everything a deal moves, in words, for the dialog nobody should press through. */
export function dealText(
  theirs: Individual | null,
  ours: Individual | null,
  cash: number,
  who: string,
): string {
  const parts: string[] = [];
  if (ours) parts.push(`you give ${displayName(ours)} (Lv${ours.level})`);
  if (cash < 0) parts.push(`you pay ¤${(-cash).toLocaleString()}`);
  if (theirs) parts.push(`you receive ${displayName(theirs)} (Lv${theirs.level})`);
  if (cash > 0) parts.push(`you take ¤${cash.toLocaleString()}`);
  return `${parts.join(", ")} — with ${who}.`;
}

export function TradePost({
  state,
  codes,
  here,
  listings,
  mine,
  bids,
  onList,
  onUnlist,
  onBid,
  onAccept,
  onDecline,
  onClose,
}: {
  state: GameState;
  /** The rooms this board is drawn from. Empty when you have subscribed to nobody. */
  codes: readonly string[];
  /** How many other people are standing at it. */
  here: number;
  /** What everybody else has up. */
  listings: readonly Listing[];
  /** What we have up. */
  mine: readonly Listing[];
  /** Answers to ours. */
  bids: readonly Bid[];
  onList: (index: number, asking: number, wants: string) => void;
  onUnlist: (id: string) => void;
  onBid: (listing: Listing, giving: number | null, cash: number) => void;
  onAccept: (bid: Bid) => void;
  onDecline: (bid: Bid) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"mine" | "theirs">("mine");
  const [asking, setAsking] = useState(0);
  const [wants, setWants] = useState("");
  /** The listing we are answering, and with what. */
  const [answering, setAnswering] = useState<{ listing: Listing; giving: number | null; cash: number } | null>(null);
  /** A bid of somebody's that we are about to accept, spelled out. */
  const [confirming, setConfirming] = useState<Bid | null>(null);

  const listed = new Set(mine.map((one) => one.creature.uid));

  /**
   * Why this bid cannot be taken, in the engine's own words, or null.
   *
   * Asked here as well as in the engine because saying yes is two things: the
   * swap, which the engine applies, and the word to the other side, which it
   * cannot take back. A cash offer for the only creature you have is refused
   * — you have to keep something that can fight — and the button used to send
   * the word anyway, so they walked away with a copy of a creature you still
   * had.
   */
  const whyNot = (bid: Bid): string | null => {
    const listing = mine.find((one) => one.id === bid.listing);
    if (!listing) return "that listing is gone";
    const give = state.party.findIndex((one) => one.uid === listing.creature.uid);
    return postDealRefusal(state, { give: give >= 0 ? give : null, receive: bid.creature, paid: bid.cash });
  };

  return (
    <div className="cheatBackdrop" role="dialog" aria-label="The trading post">
      <section className="cheatPanel handbook tradePost">
        <header className="handbookHead">
          <div className="cheatHead">
            <h2>Tim&apos;s board</h2>
            <button type="button" className="ghost" onClick={onClose}>
              Close
            </button>
          </div>
          <p className="muted small">
            {codes.length
              ? `${codes.join(", ")} · ${here} other${here === 1 ? "" : "s"} at the board. What you pin up shows on every room you are in, and somebody with nothing up shows nothing. Nothing is held for you either: a deal happens when you both press the button.`
              : "You have subscribed to nobody. Subscribe to a friend under the node map, and the board fills with what they are offering."}
          </p>
          <div className="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "mine"}
              className={`tab${tab === "mine" ? " on" : ""}`}
              onClick={() => setTab("mine")}
            >
              Yours<span className="tabCount">{mine.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "theirs"}
              className={`tab${tab === "theirs" ? " on" : ""}${bids.length ? " hasHits" : ""}`}
              onClick={() => setTab("theirs")}
            >
              Theirs<span className="tabCount">{listings.length}</span>
            </button>
          </div>
        </header>

        {tab === "mine" ? (
          <>
            {/* What is up, and what anybody has said about it. */}
            {mine.length ? (
              <ol className="postList">
                {mine.map((one) => {
                  const answers = bids.filter((bid) => bid.listing === one.id);
                  return (
                    <li key={one.id} className="postItem">
                      <Line creature={one.creature} />
                      <span className="muted small">
                        {one.asking ? `Asking ¤${one.asking.toLocaleString()}` : "Open to offers"}
                        {one.wants ? ` · wants ${one.wants}` : ""}
                      </span>
                      <div className="row">
                        <button type="button" className="ghost small" onClick={() => onUnlist(one.id)}>
                          Take it down
                        </button>
                      </div>
                      {answers.map((bid) => (
                        <div key={bid.id} className="postBid">
                          <strong>{bid.who}</strong> offers{" "}
                          {bid.creature ? displayName(bid.creature) : ""}
                          {bid.creature && bid.cash ? " and " : ""}
                          {bid.cash ? `¤${bid.cash.toLocaleString()}` : ""}
                          {bid.creature ? <Line creature={bid.creature} /> : null}
                          <div className="row">
                            <button
                              type="button"
                              className="primary small"
                              disabled={Boolean(whyNot(bid))}
                              title={whyNot(bid) ?? "See the whole deal before anything happens"}
                              onClick={() => setConfirming(bid)}
                            >
                              Look at it
                            </button>
                            <button type="button" className="ghost small" onClick={() => onDecline(bid)}>
                              No thanks
                            </button>
                          </div>
                        </div>
                      ))}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="hint">Nothing of yours is up.</p>
            )}

            <h4>Pin something up</h4>
            <div className="row">
              <label className="martCount">
                Asking
                <input
                  type="number"
                  min={0}
                  max={999999}
                  value={asking}
                  onChange={(event) => setAsking(Math.max(0, Math.min(999999, Number(event.target.value) || 0)))}
                />
              </label>
              <input
                value={wants}
                placeholder="What you want for it"
                aria-label="What you want for it"
                maxLength={40}
                onChange={(event) => setWants(event.target.value)}
              />
            </div>
            <div className="items">
              {state.party.map((creature, index) => (
                <button
                  key={creature.uid}
                  type="button"
                  className="itemCard"
                  disabled={!codes.length || listed.has(creature.uid) || state.locked.includes(creature.uid)}
                  title={
                    !codes.length
                      ? "Subscribe to somebody first"
                      : listed.has(creature.uid)
                        ? "Already on the board"
                        : state.locked.includes(creature.uid)
                          ? "That one is locked"
                          : "Pin it up"
                  }
                  onClick={() => onList(index, asking, wants.trim())}
                >
                  <span className="itemName">
                    {displayName(creature)} · Lv{creature.level}
                  </span>
                  <span className="muted itemBlurb">
                    IV {ivTotal(creature.ivs)}/{31 * STAT_IDS.length}
                    {creature.abilities.length ? ` · ${creature.abilities.length} ability` : ""}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {listings.length ? (
              <ol className="postList">
                {listings.map((one) => (
                  <li key={`${one.from}:${one.id}`} className="postItem">
                    <Line creature={one.creature} />
                    <span className="muted small">
                      <strong>{one.who}</strong>
                      {codes.length > 1 && one.code ? ` (${one.code})` : ""} ·{" "}
                      {one.asking ? `asking ¤${one.asking.toLocaleString()}` : "open to offers"}
                      {one.wants ? ` · wants ${one.wants}` : ""}
                    </span>
                    <StatHover creature={one.creature} title={`${one.who}'s ${speciesById(one.creature.speciesId).name}`} />
                    <div className="row">
                      <button
                        type="button"
                        className="ghost small"
                        onClick={() => setAnswering({ listing: one, giving: null, cash: one.asking })}
                      >
                        Make an offer
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="hint">
                {codes.length
                  ? "Nothing on the board. Somebody has to be standing at it with something to spare."
                  : "Join a room first."}
              </p>
            )}
          </>
        )}

        {/* Answering somebody's listing: cash, one of yours, or both. */}
        {answering ? (
          <div className="postDeal">
            <h4>Your offer for {displayName(answering.listing.creature)}</h4>
            <div className="row">
              <label className="martCount">
                Cash
                <input
                  type="number"
                  min={0}
                  max={state.money}
                  value={answering.cash}
                  onChange={(event) =>
                    setAnswering({
                      ...answering,
                      cash: Math.max(0, Math.min(state.money, Number(event.target.value) || 0)),
                    })
                  }
                />
              </label>
              <span className="muted small">Purse ¤{state.money.toLocaleString()}</span>
            </div>
            <div className="items">
              {state.party.map((creature, index) => (
                <button
                  key={creature.uid}
                  type="button"
                  className={`itemCard${answering.giving === index ? " on" : ""}`}
                  disabled={state.locked.includes(creature.uid)}
                  onClick={() =>
                    setAnswering({ ...answering, giving: answering.giving === index ? null : index })
                  }
                >
                  <span className="itemName">
                    {answering.giving === index ? "✓ " : ""}
                    {displayName(creature)} · Lv{creature.level}
                  </span>
                  <span className="muted itemBlurb">IV {ivTotal(creature.ivs)}/{31 * STAT_IDS.length}</span>
                </button>
              ))}
            </div>
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={!answering.cash && answering.giving === null}
                onClick={() => {
                  onBid(answering.listing, answering.giving, answering.cash);
                  setAnswering(null);
                }}
              >
                Send it
              </button>
              <button type="button" className="ghost" onClick={() => setAnswering(null)}>
                Never mind
              </button>
            </div>
          </div>
        ) : null}

        {/* The whole deal, spelled out, before anything happens. */}
        {confirming ? (
          <div className="postDeal">
            <h4>Do we have a deal?</h4>
            <p>
              {dealText(
                confirming.creature,
                mine.find((one) => one.id === confirming.listing)?.creature ?? null,
                confirming.cash,
                confirming.who,
              )}
            </p>
            {confirming.creature ? <StatHover creature={confirming.creature} title={`What ${confirming.who} is offering`} /> : null}
            <p className="muted small">
              Nobody holds anything for either of you. Once you press this, your side of it is done —
              theirs is done when their game applies it, and if it does not, that is between you.
            </p>
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={Boolean(whyNot(confirming))}
                title={whyNot(confirming) ?? "Your half happens now, and they are told"}
                onClick={() => {
                  onAccept(confirming);
                  setConfirming(null);
                }}
              >
                Deal
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  onDecline(confirming);
                  setConfirming(null);
                }}
              >
                No
              </button>
            </div>
          </div>
        ) : null}

      </section>
    </div>
  );
}
