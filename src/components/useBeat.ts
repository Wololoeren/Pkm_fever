"use client";

import { useEffect, type RefObject } from "react";
import { typeColor } from "@/render/palette";
import { BALL_FLIGHT_MS, BALL_SETTLE_MS, CATCH_TAIL_MS, WOBBLE_MS, type Beat, type Catch } from "@/lib/beats";

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

/** How long a creature takes to walk on. */
const ENTRANCE_MS = 380;

/**
 * Walks a creature on from its own side of the field.
 *
 * Creatures used to appear: one frame nothing, the next frame standing there
 * fully drawn, which is the one moment in a battle where something genuinely
 * arrives and the screen said nothing about it. Now it comes in from the edge
 * it belongs to — the foe from the right, where the foe stands, and yours from
 * the left — so a switch reads as one creature having been sent out rather
 * than as the plate above it changing its mind about whose it is.
 *
 * Keyed on *who is standing there* rather than on the turn, which is the whole
 * difference between this and `useBeat`: a turn spent switching and a turn
 * spent attacking are both one turn, and only one of them is an arrival.
 *
 * Added before `useBeat` in the component on purpose. Both animate the same
 * element's transform, and the Web Animations API gives the last-added
 * animation precedence while they overlap — so a creature sent out into a move
 * that was already aimed at it flinches rather than finishing its walk, which
 * is the right way round.
 */
export function useEntrance(
  sprite: RefObject<HTMLElement | null>,
  /** Changes when a different creature is out. Its uid, and the battle's. */
  who: string,
  facing: Facing,
): void {
  useEffect(() => {
    const element = sprite.current;
    if (!element || typeof element.animate !== "function") return;
    if (stillness()) return;

    // Percentages of its own width rather than pixels, so the walk is the same
    // walk whether the sprite is 48 across or 192.
    //
    // A hundred and ten percent and no further, with the fade finished well
    // before the walk is: nothing in the battle clips, so a longer run-up
    // would have the sprite visibly cross the field's own border and pass over
    // the party panel beside it. Clipping the field is not the fix — the two
    // hover panels are anchored below their slots and would go with it.
    const away = facing === "right" ? -1 : 1;
    const animation = element.animate(
      [
        { transform: `translateX(${away * 110}%)`, opacity: "0" },
        // Visible from here on, and by here it is all but home.
        { transform: `translateX(${away * 8}%)`, opacity: "1", offset: 0.55 },
        { transform: "translateX(0)", opacity: "1" },
      ],
      { duration: ENTRANCE_MS, easing: EASE, fill: "none" },
    );

    return () => animation.cancel();
  }, [sprite, who, facing]);
}

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

/**
 * A ball thrown at the wild creature.
 *
 * The ball is a span sitting over the wild slot at scale nought — nought
 * rather than `opacity: 0`, for the reason the flash has no colour: a rule
 * that hides an element in CSS and is never shown again in CSS is what the
 * Y1 guard catches, and scale is not the property it watches because the
 * keyframes below are the only thing that ever gives these a size.
 *
 * Flight, then the creature drawn in, then the wobbles, then either stars
 * over a ball that stays shut or smoke over a ball that opens and a creature
 * that comes back. Every time comes from `catchFor` in beats.ts, which is
 * also what pushes the wild creature's answer to a failed throw back past the
 * smoke — so the ball and the answer never happen under one another.
 */
export function useCatch(
  ball: RefObject<HTMLElement | null>,
  /** The wild creature's sprite wrapper: drawn in, and let out again. */
  foe: RefObject<HTMLElement | null>,
  /** The four stars and the three puffs, in that order. */
  burst: RefObject<HTMLElement | null>,
  attempt: Catch | null,
  /** Restarts the whole thing, as `useBeat` does. */
  turn: number,
): void {
  useEffect(() => {
    const orb = ball.current;
    const sprite = foe.current;
    const marks = burst.current;
    if (!attempt || !orb || !sprite || !marks || typeof orb.animate !== "function") return;
    if (stillness()) return;

    const running: Animation[] = [];
    const play = (target: HTMLElement, frames: Keyframe[], duration: number, delay: number, fill: FillMode = "none") => {
      running.push(target.animate(frames, { duration, delay, easing: EASE, fill }));
    };

    // Out of your side of the field and over to theirs, spinning, in an arc.
    play(
      orb,
      [
        { transform: "translate(-240px, 120px) rotate(0deg) scale(1)", offset: 0 },
        { transform: "translate(-120px, -70px) rotate(360deg) scale(1)", offset: 0.55 },
        { transform: "translate(0, 0) rotate(720deg) scale(1)", offset: 1 },
      ],
      BALL_FLIGHT_MS,
      0,
    );
    // And it stays there: shut through the wobbles, and until the tail says.
    const held = attempt.endAt + (attempt.outcome === "caught" ? CATCH_TAIL_MS : 0);
    play(orb, [{ transform: "scale(1)" }, { transform: "scale(1)" }], held - BALL_FLIGHT_MS, BALL_FLIGHT_MS, "forwards");

    // The creature drawn in as the ball lands, and held there.
    play(
      sprite,
      [
        { transform: "scale(1)", opacity: "1" },
        { transform: "scale(0.15) translateY(-20px)", opacity: "0" },
      ],
      BALL_SETTLE_MS,
      BALL_FLIGHT_MS - 60,
      "forwards",
    );

    // The wobbles, each a rock to one side and back, with a bounce as it lands.
    play(orb, [{ transform: "translateY(0) scale(1)" }, { transform: "translateY(-14px) scale(1)" }, { transform: "translateY(0) scale(1)" }], BALL_SETTLE_MS, BALL_FLIGHT_MS);
    for (const at of attempt.wobblesAt) {
      play(
        orb,
        [
          { transform: "rotate(0deg) scale(1)" },
          { transform: "rotate(-24deg) scale(1)", offset: 0.25 },
          { transform: "rotate(20deg) scale(1)", offset: 0.55 },
          { transform: "rotate(-8deg) scale(1)", offset: 0.8 },
          { transform: "rotate(0deg) scale(1)" },
        ],
        WOBBLE_MS * 0.7,
        at,
      );
    }

    const stars = Array.from(marks.querySelectorAll<HTMLElement>(".star"));
    const puffs = Array.from(marks.querySelectorAll<HTMLElement>(".puff"));

    if (attempt.outcome === "caught") {
      // A click, and stars out of the ball in four directions.
      play(orb, [{ transform: "scale(1)" }, { transform: "scale(1.25)", offset: 0.3 }, { transform: "scale(1)" }], 260, attempt.endAt);
      stars.forEach((star, at) => {
        const angle = -90 + at * 60;
        const dx = Math.round(Math.cos((angle * Math.PI) / 180) * 34);
        const dy = Math.round(Math.sin((angle * Math.PI) / 180) * 34) - 12;
        play(
          star,
          [
            { transform: "translate(0, 0) scale(0)", opacity: "1" },
            { transform: `translate(${dx * 0.6}px, ${dy * 0.6}px) scale(1.1)`, opacity: "1", offset: 0.4 },
            { transform: `translate(${dx}px, ${dy}px) scale(0.4)`, opacity: "0" },
          ],
          CATCH_TAIL_MS,
          attempt.endAt + at * 40,
        );
      });
    } else {
      // The ball opens, smoke, and the creature is standing there again.
      play(orb, [{ transform: "scale(1)", opacity: "1" }, { transform: "scale(1.3)", opacity: "0" }], 200, attempt.endAt);
      puffs.forEach((puff, at) => {
        const dx = (at - 1) * 22;
        play(
          puff,
          [
            { transform: `translate(${dx}px, 6px) scale(0.3)`, opacity: "0.9" },
            { transform: `translate(${dx * 1.6}px, -18px) scale(1.5)`, opacity: "0" },
          ],
          CATCH_TAIL_MS,
          attempt.endAt + at * 50,
        );
      });
      play(
        sprite,
        [
          { transform: "scale(0.15) translateY(-20px)", opacity: "0" },
          { transform: "scale(1)", opacity: "1" },
        ],
        260,
        attempt.endAt + 80,
      );
    }

    return () => {
      for (const one of running) one.cancel();
    };
  }, [ball, foe, burst, attempt, turn]);
}
