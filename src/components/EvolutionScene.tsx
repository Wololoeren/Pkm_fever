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
 * Nothing here touches game state. The evolution already happened in the
 * engine, on the turn the experience was awarded; this is a picture of
 * something that is already true, which is why skipping it costs nothing.
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
  onDone,
}: {
  from: string;
  to: string;
  onDone: () => void;
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
      if (event.key.toLowerCase() !== "e") return;

      event.preventDefault();
      event.stopPropagation();
      onDone();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

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
              drama is the glow, which can be any size it likes. */}
          <Sprite speciesId={shown.id} variantId="normal" size={96} />
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

      <button type="button" className="ghost evolveSkip" onClick={onDone}>
        Skip <kbd>E</kbd>
      </button>
    </div>
  );
}
