"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { Individual } from "@/engine/types";
import { typeColor } from "@/render/palette";
import { playStrike } from "./strikes";
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

/** How long the creature going back takes to walk off. */
export const SWITCH_OUT_MS = 320;
/** How long the ball takes to arc in and land. */
export const SWITCH_BALL_MS = 420;
/** How long the new creature takes to pop out of it. */
export const SWITCH_POP_MS = 280;
/** The whole switch, end to end. */
export const SWITCH_TOTAL_MS = SWITCH_OUT_MS + SWITCH_BALL_MS + SWITCH_POP_MS;

/** The creature that has just been replaced in a slot, for as long as its exit is on screen. */
export interface Leaving {
  creature: Individual;
  /** Unique to this one switch, so the animation plays once per switch. */
  key: string;
  /** Already down: nothing to walk off, so the ball comes straight in. */
  fainted: boolean;
}

/**
 * Who was standing in this slot a moment ago, when somebody else is now.
 *
 * The state only ever holds who is out *now*, so by the time a switch reaches
 * the screen the one who went back is already gone from it. This keeps the
 * last one seen and hands it back for exactly as long as the switch takes to
 * play — long enough to draw it walking off. A new battle is not a switch.
 */
export function useLeaving(tag: string, current: Individual): Leaving | null {
  const last = useRef({ tag, creature: current });
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  last.current.creature = last.current.creature.uid === current.uid ? current : last.current.creature;

  useEffect(() => {
    const before = last.current;
    last.current = { tag, creature: current };
    if (before.tag !== tag || before.creature.uid === current.uid) return;

    setLeaving({
      creature: before.creature,
      key: `${tag}:${before.creature.uid}>${current.uid}`,
      fainted: before.creature.hp <= 0,
    });
    const timer = setTimeout(() => setLeaving(null), SWITCH_TOTAL_MS + 50);
    return () => clearTimeout(timer);
    // Keyed on who is standing there, not on the creature object, which is a
    // new object every turn it takes a hit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, current.uid]);

  return leaving;
}

/**
 * Plays a switch: the one going back walks off, a ball arcs in from the
 * trainer's side and lands, and the new one pops out of it.
 *
 * Only for a switch within a battle — the first creature of a battle still
 * walks on with `useEntrance`. A fainted creature has already gone down on
 * screen, so its replacement skips the walk-off and the ball comes straight in.
 */
export function useSwitchIn(
  sprite: RefObject<HTMLElement | null>,
  ghost: RefObject<HTMLElement | null>,
  ball: RefObject<HTMLElement | null>,
  leaving: Leaving | null,
  facing: Facing,
): void {
  const key = leaving?.key ?? null;
  const fainted = leaving?.fainted ?? false;

  useEffect(() => {
    if (!key) return;
    const element = sprite.current;
    if (!element || typeof element.animate !== "function") return;
    if (stillness()) return;

    const away = facing === "right" ? -1 : 1;
    const out = fainted ? 0 : SWITCH_OUT_MS;
    const total = out + SWITCH_BALL_MS + SWITCH_POP_MS;
    const running: Animation[] = [];

    // The one going back.
    if (ghost.current && !fainted) {
      running.push(
        ghost.current.animate(
          [
            { transform: "translateX(0)", opacity: "1" },
            { transform: `translateX(${away * 110}%)`, opacity: "0" },
          ],
          { duration: SWITCH_OUT_MS, easing: "ease-in", fill: "forwards" },
        ),
      );
    }

    // The ball: thrown from the trainer's side, over the top, down onto the
    // spot, a spin on the way; then it bursts open and is gone.
    if (ball.current) {
      running.push(
        ball.current.animate(
          [
            { transform: `translate(${away * 260}%, -40%) rotate(0deg) scale(0.9)`, opacity: "0" },
            { transform: `translate(${away * 180}%, -220%) rotate(240deg) scale(1)`, opacity: "1", offset: 0.25 },
            { transform: "translate(0, 0) rotate(720deg) scale(1)", opacity: "1", offset: SWITCH_BALL_MS / (SWITCH_BALL_MS + SWITCH_POP_MS) },
            { transform: "translate(0, -10%) rotate(720deg) scale(1.9)", opacity: "0" },
          ],
          { duration: SWITCH_BALL_MS + SWITCH_POP_MS, delay: out, easing: "ease-out", fill: "both" },
        ),
      );
    }

    // The new one: nowhere until the ball lands, then out of it — small and
    // bright, a touch too big, and settled.
    const landed = (out + SWITCH_BALL_MS) / total;
    running.push(
      element.animate(
        [
          { transform: "scale(0.1)", opacity: "0", filter: "brightness(3)" },
          { transform: "scale(0.1)", opacity: "0", filter: "brightness(3)", offset: landed },
          { transform: "scale(1.12)", opacity: "1", filter: "brightness(1.6)", offset: landed + (1 - landed) * 0.65 },
          { transform: "scale(1)", opacity: "1", filter: "brightness(1)" },
        ],
        { duration: total, easing: "ease-out", fill: "none" },
      ),
    );

    return () => running.forEach((one) => one.cancel());
  }, [sprite, ghost, ball, key, fainted, facing]);
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
    const timers: ReturnType<typeof setTimeout>[] = [];
    const spawned: HTMLElement[] = [];
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

    for (const lungeAt of beat.lunges) {
      play(
        element,
        [
          { transform: "translateX(0)" },
          { transform: `translateX(${toward}px)`, offset: 0.35 },
          { transform: "translateX(0)" },
        ],
        260,
        lungeAt,
      );
    }

    for (const hit of beat.hits) {
      // Away from the blow, and harder on a critical. Three shakes rather than
      // one: a single displacement reads as the sprite having moved, and a
      // shake reads as having been hit.
      const kick = hit.crit ? 9 : 5;
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
        hit.crit ? 320 : 220,
        hit.at,
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
        const wash = hit.crit ? "rgba(255, 255, 255, 0.85)" : typeColor(hit.type ?? "normal");
        play(
          mark,
          [
            { background: wash, opacity: 0, transform: "scale(0.7)" },
            { background: wash, opacity: hit.crit ? 0.85 : 0.55, transform: "scale(1.05)", offset: 0.3 },
            { background: wash, opacity: 0, transform: "scale(1.25)" },
          ],
          hit.crit ? 380 : 300,
          hit.at,
        );

        // And what the move looks like landing: flames, a splash, a bolt.
        // Only for a blow somebody threw — a burn has no shape to show.
        const stage = mark.parentElement;
        const moveId = hit.moveId;
        if (stage && moveId) {
          timers.push(
            setTimeout(() => {
              spawned.push(...playStrike(stage, hit.type ?? "normal", moveId, hit.crit));
            }, hit.at),
          );
        }
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
      for (const timer of timers) clearTimeout(timer);
      for (const piece of spawned) piece.remove();
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
    // A caught ball is held shut past the stars; an escaped one is held only
    // until it opens, and the opening below fills forwards so it stays gone.
    const held = attempt.endAt + (attempt.outcome === "caught" ? CATCH_TAIL_MS : 0);
    play(
      orb,
      [{ transform: "scale(1)" }, { transform: "scale(1)" }],
      held - BALL_FLIGHT_MS,
      BALL_FLIGHT_MS,
      attempt.outcome === "caught" ? "forwards" : "none",
    );

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
      play(orb, [{ transform: "scale(1)", opacity: "1" }, { transform: "scale(1.3)", opacity: "0" }], 200, attempt.endAt, "forwards");
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
      // Forwards, like the drawing-in above it: two animations on the same
      // property and the later-added wins while both are alive, and a return
      // that ended would hand the sprite back to the one that hid it.
      play(
        sprite,
        [
          { transform: "scale(0.15) translateY(-20px)", opacity: "0" },
          { transform: "scale(1)", opacity: "1" },
        ],
        260,
        attempt.endAt + 80,
        "forwards",
      );
    }

    return () => {
      for (const one of running) one.cancel();
    };
  }, [ball, foe, burst, attempt, turn]);
}
