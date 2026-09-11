"use client";

import { useEffect, type RefObject } from "react";
import { typeColor } from "@/render/palette";
import type { Beat } from "@/lib/beats";

/**
 * Plays one creature's turn.
 *
 * Driven by the Web Animations API rather than by CSS classes, for one
 * practical reason: a CSS animation does not restart when the same class is
 * applied again, and a battle is the same four or five animations over and
 * over. The usual fixes are a `key` that remounts the element — which here
 * would remount the sprite's canvas and blank it for a frame — or reading
 * `offsetWidth` to force a reflow, which is a trick that needs a comment
 * every time anybody sees it. `element.animate()` simply starts.
 *
 * It also gives the thing this needs most: real times. A turn is two swings
 * and two answers, and `beats.ts` has already worked out when each of them
 * happens; every animation here is just that number as a `delay`.
 *
 * Nothing about this is in the engine, which is the point. An animation the
 * game's state depended on would be a save that broke when somebody retimed a
 * shake.
 */

/** Which way this slot's creature lunges. The two sides face each other. */
export type Facing = "left" | "right";

/**
 * Honours the reduced-motion setting.
 *
 * Read at play time rather than cached, because somebody can change it while
 * the tab is open — and read defensively, because `matchMedia` does not exist
 * in the test environment and a battle should not depend on a browser API to
 * resolve.
 */
function stillness(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

const EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

export function useBeat(
  sprite: RefObject<HTMLElement | null>,
  flash: RefObject<HTMLElement | null>,
  beat: Beat,
  /** Restarts the whole thing. The turn number, which changes exactly once
   * per resolved turn — using the events array would restart on every render
   * that produced an equal-but-new array. */
  turn: number,
  facing: Facing,
): void {
  useEffect(() => {
    const element = sprite.current;
    if (!element || typeof element.animate !== "function") return;
    if (stillness()) return;

    const running: Animation[] = [];
    const play = (
      target: HTMLElement,
      frames: Keyframe[],
      duration: number,
      delay: number,
    ) => {
      running.push(target.animate(frames, { duration, delay, easing: EASE, fill: "none" }));
    };

    // Toward whatever is opposite, and back. The distance is small on
    // purpose: this is a sprite standing on a field, not a fighting game.
    const toward = facing === "right" ? 18 : -18;

    if (beat.lungeAt !== null) {
      play(
        element,
        [
          { transform: "translateX(0)" },
          { transform: `translateX(${toward}px)`, offset: 0.35 },
          { transform: "translateX(0)" },
        ],
        260,
        beat.lungeAt,
      );
    }

    if (beat.hitAt !== null) {
      // Away from the blow, and harder on a critical. Three shakes rather than
      // one: a single displacement reads as the sprite having moved, and a
      // shake reads as having been hit.
      const kick = beat.crit ? 9 : 5;
      const away = facing === "right" ? -kick : kick;
      play(
        element,
        [
          { transform: "translateX(0)" },
          { transform: `translateX(${away}px)` },
          { transform: `translateX(${-away * 0.7}px)` },
          { transform: `translateX(${away * 0.4}px)` },
          { transform: "translateX(0)" },
        ],
        beat.crit ? 320 : 220,
        beat.hitAt,
      );

      // And a wash of the attacking move's own colour over it, which is the
      // cheapest way to say what just hit you. White for a critical, because
      // a critical is not a type.
      const mark = flash.current;
      if (mark) {
        // The colour is carried *in the keyframes* rather than left on the
        // element, so when the animation finishes and hands back (`fill:
        // "none"`) the flash returns to having no colour at all. That is what
        // makes it invisible at rest, and it is why it needs no `opacity: 0`
        // in the stylesheet — which would have been a rule that hides itself
        // and is never shown again in CSS, the exact shape Y1 guards against.
        const wash = beat.crit ? "rgba(255, 255, 255, 0.85)" : typeColor(beat.type ?? "normal");
        play(
          mark,
          [
            { background: wash, opacity: 0, transform: "scale(0.7)" },
            { background: wash, opacity: beat.crit ? 0.85 : 0.55, transform: "scale(1.05)", offset: 0.3 },
            { background: wash, opacity: 0, transform: "scale(1.25)" },
          ],
          beat.crit ? 380 : 300,
          beat.hitAt,
        );
      }
    }

    if (beat.dodgeAt !== null) {
      // A miss should look like a miss. Sideways and back, with no flash.
      play(
        element,
        [
          { transform: "translateX(0)", opacity: "1" },
          { transform: `translateX(${facing === "right" ? -14 : 14}px)`, opacity: "0.55", offset: 0.4 },
          { transform: "translateX(0)", opacity: "1" },
        ],
        300,
        beat.dodgeAt,
      );
    }

    if (beat.glowAt !== null && beat.hitAt === null) {
      // Something landed that was not damage. Only when nothing hit it, or a
      // move that both hurts and burns would play two animations over each
      // other and read as neither.
      play(
        element,
        [
          { filter: "brightness(1)" },
          { filter: "brightness(1.55)", offset: 0.4 },
          { filter: "brightness(1)" },
        ],
        420,
        beat.glowAt,
      );
    }

    if (beat.faintAt !== null) {
      // Down and out, and it stays down: `fill: "forwards"` because the sprite
      // underneath is already drawn faint and the animation should hand over
      // to it rather than snap back for a frame first.
      running.push(
        element.animate(
          [
            { transform: "translateY(0)", opacity: "1" },
            { transform: "translateY(26px)", opacity: "0" },
          ],
          { duration: 420, delay: beat.faintAt, easing: "ease-in", fill: "forwards" },
        ),
      );
    }

    return () => {
      for (const animation of running) animation.cancel();
    };
    // `beat` is rebuilt every render, so it cannot be a dependency without
    // restarting the animation on every keystroke elsewhere on the page. The
    // turn number is what actually changes when there is something new to
    // play, and the beat is a pure function of the turn's events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn]);
}
