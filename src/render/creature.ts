import { rngFor, type Rng } from "@/engine/rng";

/**
 * The shadow a creature casts before its art arrives.
 *
 * This used to be placeholder *art*: a body, a head, ears, a tail and two eyes
 * in the species' own type colours, drawn deterministically and run through
 * the variant transform, back when there were no real sprites and the ladder
 * of eleven appearances had to be visible somehow. The real pipeline shipped,
 * and the moment it did this became a liability — every creature arrived as a
 * brightly coloured two-ellipse snowman with eyes, held the frame for as long
 * as the download took, and then turned into something that looked nothing
 * like it. A placeholder that looks like art is a placeholder that gets read
 * as art and reported as a bug, which is exactly what happened.
 *
 * So it is a silhouette now. The shape is still generated the same way and
 * still seeded on the species id — so it is creature-shaped and the same
 * creature is always the same shape — but every pixel of it is one dark
 * colour. Nothing about it invites being read as the animal, and something
 * creature-shaped is still better than a hole in the layout for however many
 * hundred milliseconds the sprite takes.
 *
 * One consequence worth naming: a shadow has no colour, so it has no variant
 * either. Eleven appearances all cast the same shadow, the hue transform that
 * used to distinguish them is gone, and the cache is keyed on the species
 * alone. The variant marks beside the sprite still say which one it is.
 */

const SIZE = 96;
const cache = new Map<string, HTMLCanvasElement>();

/**
 * How dark the shadow is.
 *
 * Not quite black. The battle field is a dark gradient and the party cards are
 * darker still, so true black would read as a hole punched in the panel rather
 * than as something standing there.
 */
const SHADOW = "#101218";

/**
 * Every piece is filled *and* stroked in the one colour.
 *
 * The stroke is not decoration — it is three pixels of width, and dropping it
 * would make every shape smaller than the shape the arriving sprite replaces.
 * Keeping it in the same colour means the overlaps leave no seams, which is
 * what lets this be drawn straight rather than drawn and then flattened.
 */
function fillAndEdge(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = SHADOW;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.strokeStyle = SHADOW;
  ctx.stroke();
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  fillAndEdge(ctx);
}

function triangle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x - width, y);
  ctx.lineTo(x, y - height);
  ctx.lineTo(x + width, y);
  ctx.closePath();
  fillAndEdge(ctx);
}

/**
 * The outline of something, seeded on its species id.
 *
 * A body, a head, and a coin-toss each for legs, a tail and up to two pairs of
 * ears. Not much, but enough that a long creature and a round one cast
 * different shadows, and enough that the same species always casts its own.
 */
function draw(ctx: CanvasRenderingContext2D, speciesId: string, rng: Rng): void {
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
    ctx.strokeStyle = SHADOW;
    ctx.stroke();
  }

  if (legs) {
    blob(ctx, SIZE / 2 - bodyR * 0.5, bodyY + bodyR * 0.8, 8, 6);
    blob(ctx, SIZE / 2 + bodyR * 0.5, bodyY + bodyR * 0.8, 8, 6);
  }

  blob(ctx, SIZE / 2, bodyY, bodyR, bodyR * 0.85);

  // Ears or horns, mirrored.
  for (let i = 0; i < ears; i++) {
    const offset = headR * (0.65 + i * 0.25);
    triangle(ctx, SIZE / 2 - offset, headY - headR * 0.6, 7, 14 + rng() * 8);
    triangle(ctx, SIZE / 2 + offset, headY - headR * 0.6, 7, 14 + rng() * 8);
  }

  blob(ctx, SIZE / 2, headY, headR, headR * 0.95);

  // No eyes, and no belly. Both used to be here, and both were most of why
  // this read as a drawing of a creature rather than as the space one is about
  // to occupy — a face is the one thing you cannot put on a silhouette and
  // still have it stay a silhouette.
}

/**
 * The shadow for one species. Cached on the species alone, since a shadow has
 * no variant to tell apart.
 */
export function creatureSprite(speciesId: string): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;

  const cached = cache.get(speciesId);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  draw(ctx, speciesId, rngFor("art", speciesId));

  cache.set(speciesId, canvas);
  return canvas;
}


