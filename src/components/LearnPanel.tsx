"use client";

import { useEffect } from "react";
import { learnRefusal, pendingOffers, type GameState, type Input } from "@/engine/engine";
import { move as moveById } from "@/engine/dex";
import { displayPower } from "@/engine/moves";
import { displayName } from "@/lib/narrate";
import { typeColor } from "@/render/palette";
import { MoveNote } from "./MoveNote";

/**
 * "It wants to learn something and it has no room."
 *
 * The one decision in this game that is made *for* you everywhere else. A
 * creature that grows into a fifth move used to simply not get it — the code
 * said so in a comment, and the comment was right: which move to forget is a
 * choice, a choice has to reach the engine as an input, and until the input
 * existed the honest thing was to change nothing.
 *
 * So the offer waits in the save rather than in a modal. Levelling happens in
 * the middle of a battle, and a battle here resolves both sides' actions
 * together — a prompt that stopped the turn to ask a question would have to
 * be answered by the other peer in a duel, which is not a protocol anybody
 * wants. The question is asked once you are back on your feet.
 *
 * Both answers are real answers. Turning one down clears it for good, because
 * a prompt that keeps coming back is one people learn to dismiss without
 * reading — and the move is still there to be taught later, in town, from the
 * moveset editor.
 */
export function LearnPanel({
  state,
  onInput,
}: {
  state: GameState;
  onInput: (input: Input) => void;
}) {
  const waiting = pendingOffers(state);
  const offer = waiting[0];

  // Numbered like a conversation's options, and E to decline like everything
  // else that can be walked away from.
  useEffect(() => {
    if (!offer) return;

    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      const key = event.key.toLowerCase();
      if (key === "e") {
        event.preventDefault();
        event.stopPropagation();
        onInput({ t: "learnMove", uid: offer.uid, moveId: offer.moveId, forget: null });
        return;
      }

      if (key < "1" || key > "9") return;
      const forget = offer.creature.moves[Number(key) - 1];
      if (!forget) return;

      event.preventDefault();
      event.stopPropagation();
      onInput({ t: "learnMove", uid: offer.uid, moveId: offer.moveId, forget });
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [offer, onInput]);

  if (!offer) return null;

  const learning = moveById(offer.moveId);

  return (
    <section className="panel learn">
      <div className="talkHead">
        <h3>
          {displayName(offer.creature)} wants to learn {learning.name}
        </h3>
        <button
          type="button"
          className="ghost"
          onClick={() =>
            onInput({ t: "learnMove", uid: offer.uid, moveId: offer.moveId, forget: null })
          }
        >
          Skip <kbd>E</kbd>
        </button>
      </div>

      <p className="muted">
        It already knows four. Choose one to forget, or skip — you can teach it later in town,
        whichever you decide now.
      </p>

      {/* Focusable, so the note under it opens from the keyboard as the move
          rows do. It carries the same MoveNote the rows carry; it simply had no
          hover rule of its own, so the note was rendered and never shown. */}
      <div className="learnNew" tabIndex={0}>
        <span className="typePill" style={{ background: typeColor(learning.type) }}>
          {learning.type}
        </span>
        <strong>{learning.name}</strong>
        <span className="muted">
          {learning.category === "status"
            ? "status"
            : `${displayPower(learning) ?? "varies"} pow`}{" "}
          ·{" "}
          {learning.accuracy === 0 ? "never misses" : `${learning.accuracy}%`} · {learning.pp} PP
        </span>
        <MoveNote moveId={offer.moveId} />
      </div>

      <div className="talkOptions">
        {offer.creature.moves.map((moveId, index) => {
          const entry = moveById(moveId);
          const why = learnRefusal(state, offer.uid, offer.moveId, moveId);

          return (
            <button
              key={moveId}
              type="button"
              className="talkOption moveRow"
              disabled={Boolean(why)}
              title={why ?? `Forget ${entry.name}`}
              onClick={() =>
                onInput({ t: "learnMove", uid: offer.uid, moveId: offer.moveId, forget: moveId })
              }
            >
              <kbd>{index + 1}</kbd>
              <span>Forget {entry.name}</span>
              <span className="muted">
                {entry.type} ·{" "}
                {entry.category === "status" ? "status" : `${displayPower(entry) ?? "varies"} pow`}
              </span>
              <MoveNote moveId={moveId} />
            </button>
          );
        })}
      </div>

      {waiting.length > 1 ? (
        <p className="muted">{waiting.length - 1} more waiting after this one.</p>
      ) : null}
    </section>
  );
}
