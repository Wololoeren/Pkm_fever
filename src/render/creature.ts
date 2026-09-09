import { species as speciesById } from "@/engine/dex";
import { rngFor, type Rng } from "@/engine/rng";
import { variant } from "@/engine/variants";
import { applyHueShift, typeColor } from "./palette";

/**
 * Placeholder creature art, drawn rather than downloaded.
 *
 * The real thing will be two sprites per species — normal and shiny — and the
 * variant pipeline will interpolate between them. Until those exist, this
 * draws a creature deterministically from its id and runs it through *the same
 * transform*, so the ladder of eleven appearances is real and visible today
 * and swapping in real art later changes where the pixels come from, not what
 * happens to them.
 *
 * Everything is seeded on the species id, so a given species always looks the
 * same, and a creature's shape reads as its own rather than as a placeholder
 * rectangle.
 */

const SIZE = 96;
const cache = new Map<string, HTMLCanvasElement>();

function shade(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1), 16);
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const r = clamp(((value >> 16) & 255) * amount);
  const g = clamp(((value >> 8) & 255) * amount);
  const b = clamp((value & 255) * amount);
  return `rgb(${r},${g},${b})`;
}

function blob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill: string,
  outline: string,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = outline;
  ctx.stroke();
}

function triangle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  outline: string,
): void {
  ctx.beginPath();
  ctx.moveTo(x - width, y);
  ctx.lineTo(x, y - height);
  ctx.lineTo(x + width, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = outline;
  ctx.stroke();
}

function draw(ctx: CanvasRenderingContext2D, speciesId: string, rng: Rng): void {
  const entry = speciesById(speciesId);
  const primary = typeColor(entry.types[0]);
  const secondary = typeColor(entry.types[1] ?? entry.types[0]);
  const outline = shade(primary, 0.42);

  const bodyR = 26 + rng() * 8;
  const bodyY = 60;
  const headR = 15 + rng() * 7;
  const headY = bodyY - bodyR * 0.85 - headR * 0.5;
  const ears = Math.floor(rng() * 3);
  const legs = rng() < 0.75;
  const tail = rng() < 0.6;

  // Tail first, so it sits behind the body.
  if (tail) {
    ctx.beginPath();
    ctx.moveTo(SIZE / 2 + bodyR * 0.7, bodyY + 4);
    ctx.quadraticCurveTo(SIZE / 2 + bodyR + 16, bodyY - 6, SIZE / 2 + bodyR + 6, bodyY - 22);
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.strokeStyle = shade(secondary, 0.9);
    ctx.stroke();
  }

  if (legs) {
    blob(ctx, SIZE / 2 - bodyR * 0.5, bodyY + bodyR * 0.8, 8, 6, shade(primary, 0.8), outline);
    blob(ctx, SIZE / 2 + bodyR * 0.5, bodyY + bodyR * 0.8, 8, 6, shade(primary, 0.8), outline);
  }

  blob(ctx, SIZE / 2, bodyY, bodyR, bodyR * 0.85, primary, outline);
  blob(ctx, SIZE / 2, bodyY + bodyR * 0.18, bodyR * 0.55, bodyR * 0.5, shade(secondary, 1.18), "transparent");

  // Ears or horns, mirrored.
  for (let i = 0; i < ears; i++) {
    const offset = headR * (0.65 + i * 0.25);
    triangle(ctx, SIZE / 2 - offset, headY - headR * 0.6, 7, 14 + rng() * 8, secondary, outline);
    triangle(ctx, SIZE / 2 + offset, headY - headR * 0.6, 7, 14 + rng() * 8, secondary, outline);
  }

  blob(ctx, SIZE / 2, headY, headR, headR * 0.95, primary, outline);

  const eyeX = headR * 0.42;
  const eyeR = 4 + rng() * 2;
  for (const side of [-1, 1]) {
    blob(ctx, SIZE / 2 + side * eyeX, headY - 1, eyeR, eyeR * 1.1, "#f7f7f2", outline);
    ctx.beginPath();
    ctx.ellipse(SIZE / 2 + side * eyeX, headY - 1, eyeR * 0.45, eyeR * 0.55, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#1b1b22";
    ctx.fill();
  }
}

/**
 * The sprite for one species wearing one variant. Cached, because a battle
 * redraws sixty times a second and the palette transform touches every pixel.
 */
export function creatureSprite(speciesId: string, variantId: string): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;

  const key = `${speciesId}:${variantId}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  draw(ctx, speciesId, rngFor("art", speciesId));

  // With only one source image there is no shiny palette to interpolate
  // towards, so a tint is approximated by rotating hue a proportional
  // distance. The real pipeline in render/sprites does the true thing with
  // both images; this only has to hold the frame until it arrives.
  const form = variant(variantId);
  // No real sprites to interpolate between here, so shine is faked as a hue
  // sweep of its own and the chroma is layered on top of it — the same two
  // axes, in the same order, at placeholder quality.
  const degrees = (150 * form.mix) / 1000 + form.hueShift;
  if (degrees !== 0) {
    const image = ctx.getImageData(0, 0, SIZE, SIZE);
    applyHueShift(image, degrees);
    ctx.putImageData(image, 0, 0);
  }

  cache.set(key, canvas);
  return canvas;
}


