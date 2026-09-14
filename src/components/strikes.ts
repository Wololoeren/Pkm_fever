import { move as moveById } from "@/engine/dex";
import { typeColor } from "@/render/palette";

/**
 * What a move looks like landing.
 *
 * The flash says what type hit you; this says what *happened*: flames climb,
 * water splashes, a bolt cracks, leaves scatter. Short on purpose — every one
 * is over in under four tenths of a second, because a battle is the same few
 * blows hundreds of times and an effect that is lovely once is a wait by the
 * fiftieth.
 *
 * The pieces are made when the blow lands and remove themselves when they
 * finish, so nothing sits in the page between turns and nothing needs hiding
 * in the stylesheet. Where each piece goes is worked out from its index, so
 * the same move always looks the same.
 *
 * Display only, like the rest of the motion.
 */

type Motion = "burst" | "rise" | "fall" | "rings" | "shrink" | "bolt" | "slash" | "star";

interface Look {
  motion: Motion;
  shape: string;
  count: number;
  /** Overrides the type's own colour when the type colour reads badly here. */
  color?: string;
}

const LOOKS: Record<string, Look> = {
  fire: { motion: "rise", shape: "flame", count: 7, color: "#ff8a3d" },
  water: { motion: "burst", shape: "drop", count: 8, color: "#6fb6ff" },
  electric: { motion: "bolt", shape: "bolt", count: 2, color: "#ffe14d" },
  grass: { motion: "burst", shape: "leaf", count: 6, color: "#6fd36a" },
  ice: { motion: "burst", shape: "shard", count: 7, color: "#b9f1ff" },
  psychic: { motion: "rings", shape: "ring", count: 2, color: "#ff7ac0" },
  dragon: { motion: "rings", shape: "ring", count: 2, color: "#8f7cff" },
  ghost: { motion: "shrink", shape: "ring", count: 2, color: "#9b6cd8" },
  dark: { motion: "shrink", shape: "ring", count: 2, color: "#3a2f45" },
  poison: { motion: "rise", shape: "bubble", count: 6, color: "#c070e0" },
  ground: { motion: "fall", shape: "rock", count: 5, color: "#b58a4f" },
  rock: { motion: "fall", shape: "rock", count: 5, color: "#9e9178" },
  flying: { motion: "slash", shape: "slash", count: 3, color: "#eef6ff" },
  steel: { motion: "slash", shape: "slash", count: 2, color: "#d4dce4" },
  bug: { motion: "slash", shape: "slash", count: 3, color: "#b8d64a" },
  fairy: { motion: "burst", shape: "sparkle", count: 8, color: "#ffc2e6" },
  fighting: { motion: "star", shape: "star", count: 1 },
  normal: { motion: "star", shape: "star", count: 1, color: "#ffffff" },
};

/** A move that is thrown at close quarters rather than across the field. */
function contact(moveId: string): boolean {
  return moveById(moveId).flags?.includes("contact") ?? false;
}

/** A number in 0..1 for piece `at`, evenly spread. */
function spread(at: number, step: number): number {
  return (((at + 1) * step) % 1 + 1) % 1;
}

/**
 * Plays a move's effect over `stage` — the box the sprite is drawn in — and
 * hands back the pieces so the caller can take them away early if the turn is
 * replaced before they finish.
 */
export function playStrike(stage: HTMLElement, type: string, moveId: string, crit: boolean): HTMLElement[] {
  if (typeof document === "undefined" || typeof stage.animate !== "function") return [];

  // A contact move of a type with a projectile look still lands as a blow:
  // a Fire Punch is a fist that is on fire, so it gets the burst of the punch
  // and the flames of the type.
  const look = LOOKS[type] ?? LOOKS.normal;
  const looks = contact(moveId) && look.motion !== "star" ? [look, { ...LOOKS.normal, color: look.color ?? typeColor(type) }] : [look];
  const size = crit ? 1.25 : 1;
  const pieces: HTMLElement[] = [];

  for (const one of looks) {
    const color = one.color ?? typeColor(type);
    for (let at = 0; at < one.count; at++) {
      const piece = document.createElement("span");
      piece.className = `strike strike-${one.shape}`;
      piece.style.setProperty("--strike", color);
      stage.appendChild(piece);
      pieces.push(piece);

      const { frames, duration, delay } = motion(one.motion, at, one.count, size);
      const animation = piece.animate(frames, { duration, delay, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)", fill: "both" });
      animation.onfinish = () => piece.remove();
      animation.oncancel = () => piece.remove();
      // And a timer behind it. A tab that is not being painted — hidden, or in
      // the background — leaves an animation pending without ever finishing
      // it, and the pieces would pile up until the page drew again.
      setTimeout(() => piece.remove(), delay + duration + 250);
    }
  }
  return pieces;
}

function motion(kind: Motion, at: number, count: number, size: number): { frames: Keyframe[]; duration: number; delay: number } {
  const angle = (360 / count) * at + spread(at, 0.618) * 25;
  const radians = (angle * Math.PI) / 180;
  const center = "translate(-50%, -50%)";

  switch (kind) {
    case "burst": {
      const reach = (26 + spread(at, 0.414) * 14) * size;
      const x = Math.cos(radians) * reach;
      const y = Math.sin(radians) * reach;
      return {
        frames: [
          { transform: `${center} translate(0, 0) rotate(${angle}deg) scale(${0.6 * size})`, opacity: 1 },
          { transform: `${center} translate(${x}px, ${y}px) rotate(${angle + 90}deg) scale(${0.3 * size})`, opacity: 0 },
        ],
        duration: 320,
        delay: 0,
      };
    }
    case "rise": {
      const x = (spread(at, 0.618) - 0.5) * 44 * size;
      return {
        frames: [
          { transform: `${center} translate(${x}px, 18px) scale(${0.5 * size})`, opacity: 0 },
          { transform: `${center} translate(${x}px, 0px) scale(${1 * size})`, opacity: 1, offset: 0.3 },
          { transform: `${center} translate(${x * 0.6}px, -34px) scale(${0.4 * size})`, opacity: 0 },
        ],
        duration: 360,
        delay: at * 25,
      };
    }
    case "fall": {
      const x = (spread(at, 0.618) - 0.5) * 50 * size;
      return {
        frames: [
          { transform: `${center} translate(${x}px, -48px) rotate(0deg) scale(${size})`, opacity: 0 },
          { transform: `${center} translate(${x}px, -8px) rotate(${90 + at * 30}deg) scale(${size})`, opacity: 1, offset: 0.6 },
          { transform: `${center} translate(${x}px, 6px) rotate(${120 + at * 30}deg) scale(${0.6 * size})`, opacity: 0 },
        ],
        duration: 340,
        delay: at * 30,
      };
    }
    case "rings":
      return {
        frames: [
          { transform: `${center} scale(${0.2 * size})`, opacity: 0.9 },
          { transform: `${center} scale(${1.5 * size})`, opacity: 0 },
        ],
        duration: 360,
        delay: at * 90,
      };
    case "shrink":
      return {
        frames: [
          { transform: `${center} scale(${1.6 * size})`, opacity: 0 },
          { transform: `${center} scale(${0.9 * size})`, opacity: 0.85, offset: 0.5 },
          { transform: `${center} scale(${0.2 * size})`, opacity: 0 },
        ],
        duration: 360,
        delay: at * 80,
      };
    case "bolt": {
      const x = (at === 0 ? -8 : 10) * size;
      return {
        frames: [
          { transform: `${center} translate(${x}px, 0) scale(${size})`, opacity: 0 },
          { transform: `${center} translate(${x}px, 0) scale(${size})`, opacity: 1, offset: 0.1 },
          { transform: `${center} translate(${x}px, 0) scale(${size})`, opacity: 0.2, offset: 0.35 },
          { transform: `${center} translate(${x}px, 0) scale(${size})`, opacity: 1, offset: 0.55 },
          { transform: `${center} translate(${x}px, 0) scale(${size})`, opacity: 0 },
        ],
        duration: 300,
        delay: at * 60,
      };
    }
    case "slash": {
      const tilt = -35 + at * 28;
      const y = (at - (count - 1) / 2) * 12;
      return {
        frames: [
          { transform: `${center} translate(0, ${y}px) rotate(${tilt}deg) scaleX(0)`, opacity: 1 },
          { transform: `${center} translate(0, ${y}px) rotate(${tilt}deg) scaleX(${size})`, opacity: 1, offset: 0.5 },
          { transform: `${center} translate(0, ${y}px) rotate(${tilt}deg) scaleX(${size})`, opacity: 0 },
        ],
        duration: 260,
        delay: at * 55,
      };
    }
    case "star":
      return {
        frames: [
          { transform: `${center} rotate(0deg) scale(${0.3 * size})`, opacity: 1 },
          { transform: `${center} rotate(20deg) scale(${1.1 * size})`, opacity: 0.9, offset: 0.45 },
          { transform: `${center} rotate(30deg) scale(${1.3 * size})`, opacity: 0 },
        ],
        duration: 260,
        delay: 0,
      };
  }
}
