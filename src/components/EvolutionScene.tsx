"use client";

import { useEffect, useRef, useState } from "react";
import { species as speciesById } from "@/engine/dex";
import { Sprite } from "./Sprite";

/**
 * The one moment in this game worth stopping for.
 *
 * Everything else here is a number changing. An evolution is the number
 * changing *and* the thing itself changing, and it happens perhaps a dozen
 * times in a save — so it gets twenty seconds, the middle of the screen, and
 * nothing else moving while it runs.
 *
 * Which is exactly why it also gets a way out. A cinematic you cannot skip is
 * a cinematic you resent by the third time, so <kbd>E</kbd> and a button in
 * the corner end it immediately — the same key that leaves a conversation,
 * because "get me out of this" should not be a different key each time.
 *
 * **And, where there is something to refuse, a way to refuse it.** The scene
 * is two different things depending on who asked for it, and `onCancel` is
 * what tells them apart:
 *
 * - After a **stone**, it is a picture. The item is spent and the creature has
 *   already changed, so there is nothing to say no to and <kbd>E</kbd> only
 *   makes the picture shorter.
 * - After **growing into it**, it *is the question*. Nothing has changed
 *   species yet; running to the end says yes and <kbd>B</kbd> says no, and
 *   the answer goes back to the engine as an input either way.
 *
 * Nothing here touches game state in either case — it reports which answer it
 * got and the caller applies it, because a component that reached into a save
 * would be a decision the input log never saw.
 *
 * It is a picture of *this* creature, which took a while to be true. The scene
 * asked for `variantId="normal"` and got it — so the one moment the game
 * stops everything to look at a creature was the one moment it showed somebody
 * else's. A shiny that had been shiny for forty levels turned up in factory
 * colours, changed shape, and went back to being shiny in the party list
 * underneath. There is no sensible default here, which is why the prop has
 * none: a caller that cannot say which creature this is has no business
 * playing the scene.
 */

/** The whole thing, in milliseconds. */
const TOTAL = 20_000;

const STAGES = {
  /** Holding still, glow gathering. */
  gather: 4_000,
  /** Flicking between the two shapes, faster and faster. */
  flicker: 13_000,
  /** White out. */
  flash: 15_000,
  /** And there it is. */
  reveal: TOTAL,
};

export function EvolutionScene({
  from,
  to,
  variantId,
  onDone,
  onCancel,
}: {
  from: string;
  to: string;
  /**
   * Which of the eleven appearances is evolving.
   *
   * Required, and deliberately not defaulted. Evolution keeps the variant —
   * it is a fact about the creature and not about the species — so one id
   * covers both halves of the scene.
   */
  variantId: string;
  onDone: () => void;
  /**
   * Stopping it, when there is something to stop.
   *
   * Absent for the scenes that are only a picture — a stone has already been
   * spent, and a reveal you can refuse after the fact would be refusing
   * nothing. Present when the scene *is* the question, which is every
   * evolution grown into: `B`, and a button, and neither is the same as
   * skipping. Skipping says "yes, get on with it"; this says no.
   */
  onCancel?: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(performance.now());

  // One clock, driven by the frame loop rather than an interval, so the
  // animation stays in step with the screen and stops dead when the tab does.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const now = performance.now() - started.current;
      setElapsed(now);
      if (now < TOTAL) frame = requestAnimationFrame(tick);
      else onDone();
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [onDone]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const key = event.key.toLowerCase();

      // B stops it, where stopping it is a thing that can be done. Beside E
      // rather than instead of it, because they are opposite answers to the
      // same screen and a player who wants out of the animation should not
      // have to remember which kind of "out" this one is.
      if (key === "b" && onCancel) {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        return;
      }
      if (key !== "e") return;

      event.preventDefault();
      event.stopPropagation();
      onDone();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone, onCancel]);

  const before = speciesById(from);
  const after = speciesById(to);

  // Which shape is on screen. The flicker accelerates: the gap between swaps
  // shrinks from most of a second to a twentieth of one, which is what makes
  // the last few seconds read as the thing struggling rather than blinking.
  const showing = (() => {
    if (elapsed < STAGES.gather) return "before";
    if (elapsed >= STAGES.flash) return "after";

    const into = elapsed - STAGES.gather;
    const span = STAGES.flicker - STAGES.gather;

    // The swaps are counted rather than divided out, because the gap between
    // them is itself shrinking — dividing by a moving number makes the phase
    // jump every time the number moves, which reads as a stutter.
    let at = 0;
    let swaps = 0;
    while (at < into && swaps < 500) {
      at += Math.max(50, 700 - 650 * (at / span) ** 2);
      swaps++;
    }
    return swaps % 2 === 0 ? "before" : "after";
  })();

  const stage =
    elapsed < STAGES.gather
      ? "gather"
      : elapsed < STAGES.flicker
        ? "flicker"
        : elapsed < STAGES.flash
          ? "peak"
          : "reveal";

  const shown = showing === "after" ? after : before;
  const silhouette = stage !== "reveal";

  return (
    <div className={`evolve evolve-${stage}`} role="dialog" aria-label={`${before.name} is evolving`}>
      <div className="evolveRays" aria-hidden />

      <div className="evolveStage">
        <div className={`evolveSprite${silhouette ? " dark" : ""}`}>
          {/* At the size the art was drawn. The scene used to show it at 192,
              which is a clean doubling and so not *uneven* — but every pixel
              four times the area, held still and lit from behind for twenty
              seconds, is the one place blockiness has nowhere to hide. The
              drama is the glow, which can be any size it likes.

              The variant is passed straight through and needs no staging of
              its own: the earlier stages flatten this to black and the peak
              blows it white, both through a filter on the whole
              `.evolveSprite`, so the colour and the variant marks are hidden
              until the reveal for free. The reveal is the one frame that shows
              the creature as it actually is, which is the whole point of it.

              The badges are off, though. Everywhere else they are how you pick
              the interesting creature out of a list of six; here there is no
              list, and a star in the corner of the one moment the game asks
              you to just look at something is an interface element standing in
              front of it. The colours already say which one it is. */}
          <Sprite speciesId={shown.id} variantId={variantId} size={96} marks={false} />
        </div>
      </div>

      <p className="evolveWord">
        {stage === "reveal" ? (
          <>
            <strong>{before.name}</strong> became <strong>{after.name}</strong>!
          </>
        ) : (
          <>
            What? <strong>{before.name}</strong> is evolving!
          </>
        )}
      </p>

      <div className="evolveTrack" aria-hidden>
        <div className="evolveFill" style={{ width: `${Math.min(100, (elapsed / TOTAL) * 100)}%` }} />
      </div>

      <div className="evolveButtons">
        {/* Both, when both mean something, and worded as the opposite answers
            they are. "Skip" on a scene you can also refuse would be the one
            word in the game where the fast way out and the way out are the
            same button. */}
        {onCancel ? (
          <button type="button" className="ghost evolveStop" onClick={onCancel}>
            Stop it <kbd>B</kbd>
          </button>
        ) : null}
        <button type="button" className="ghost evolveSkip" onClick={onDone}>
          {onCancel ? "Let it" : "Skip"} <kbd>E</kbd>
        </button>
      </div>
    </div>
  );
}
