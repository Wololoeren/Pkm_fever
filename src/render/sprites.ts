import { species as speciesById } from "@/engine/dex";
import { variant } from "@/engine/variants";
import { applyHueShift, mixImages } from "./palette";

/**
 * Real sprites, and the variant pipeline running on them.
 *
 * Two images per species — normal and shiny — and every one of the eleven
 * appearances is derived from that pair:
 *
 *   normal   the normal sprite, untouched
 *   tint k   the normal sprite interpolated k/5 of the way towards the shiny
 *            one, in OKLab
 *   chroma   the shiny sprite with its hue rotated in OKLCh, holding lightness
 *            and chroma so contrast survives
 *   shiny    the shiny sprite, untouched
 *
 * Pixel access means the host has to allow it. PokeAPI's sprite repository is
 * served from raw.githubusercontent.com with `Access-Control-Allow-Origin: *`,
 * so a canvas drawn from it stays readable; Showdown's sprite archive sends no
 * such header, and getImageData on it would throw a security error. That is
 * the whole reason for this source rather than that one.
 *
 * Loading is asynchronous and the results are cached forever. Callers ask for
 * a sprite synchronously, get null on a miss, and are told when it arrives.
 */

const BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";

export const SPRITE_SIZE = 96;

/** `spriteNum` rather than `num`: PokeAPI numbers regional forms in the
 * 10000s, and the mapping is resolved once at build time. */
function urlFor(num: number, shiny: boolean): string {
  return `${BASE}/${shiny ? "shiny/" : ""}${num}.png`;
}

const images = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(url: string): Promise<HTMLImageElement | null> {
  const existing = images.get(url);
  if (existing) return existing;

  const pending = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    // Without this the canvas is tainted and getImageData throws, which would
    // take every variant with it.
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });

  images.set(url, pending);
  return pending;
}

const sprites = new Map<string, HTMLCanvasElement | null>();
const building = new Map<string, Promise<HTMLCanvasElement | null>>();

function key(speciesId: string, variantId: string): string {
  return `${speciesId}:${variantId}`;
}

/** The sprite if it is ready, or null. Never blocks. */
export function cachedSprite(speciesId: string, variantId: string): HTMLCanvasElement | null {
  return sprites.get(key(speciesId, variantId)) ?? null;
}

/** Whether this one has been tried and failed, so callers can stop waiting. */
export function spriteSettled(speciesId: string, variantId: string): boolean {
  return sprites.has(key(speciesId, variantId));
}

export function loadSprite(speciesId: string, variantId: string): Promise<HTMLCanvasElement | null> {
  const id = key(speciesId, variantId);
  const started = building.get(id);
  if (started) return started;

  const pending = build(speciesId, variantId).then((canvas) => {
    sprites.set(id, canvas);
    return canvas;
  });

  building.set(id, pending);
  return pending;
}

async function build(speciesId: string, variantId: string): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return null;

  const form = variant(variantId);
  const num = speciesById(speciesId).spriteNum;

  // A chroma or a shiny starts from the shiny sprite; everything else starts
  // from the normal one.
  const wantsShinyBase = form.kind === "shiny" || form.kind === "chroma";
  const base = await loadImage(urlFor(num, wantsShinyBase));
  if (!base) return null;

  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(base, 0, 0, SPRITE_SIZE, SPRITE_SIZE);

  if (form.kind === "tint") {
    const shiny = await loadImage(urlFor(num, true));
    if (shiny) {
      const target = document.createElement("canvas");
      target.width = SPRITE_SIZE;
      target.height = SPRITE_SIZE;
      const targetCtx = target.getContext("2d", { willReadFrequently: true });
      if (targetCtx) {
        targetCtx.drawImage(shiny, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
        const from = ctx.getImageData(0, 0, SPRITE_SIZE, SPRITE_SIZE);
        const to = targetCtx.getImageData(0, 0, SPRITE_SIZE, SPRITE_SIZE);
        mixImages(from, to, form.mix / 1000);
        ctx.putImageData(from, 0, 0);
      }
    }
  } else if (form.kind === "chroma") {
    const image = ctx.getImageData(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    applyHueShift(image, form.hueShift);
    ctx.putImageData(image, 0, 0);
  }

  // Cropping happens last so that the two source images stay pixel-aligned
  // through the interpolation above.
  return fitToFrame(canvas);
}

/**
 * Trims the transparent margin and scales what is left to fill the frame.
 *
 * The source sprites sit in a fixed 96x96 box with however much padding the
 * creature's size left over, so a Caterpie renders a third of the height of a
 * Steelix and every one of them looks lost in a battle scene. Fitting each to
 * its own bounding box makes the roster read as one set.
 */
function fitToFrame(source: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = source.getContext("2d", { willReadFrequently: true });
  if (!ctx) return source;

  const { data } = ctx.getImageData(0, 0, source.width, source.height);
  let top = source.height;
  let left = source.width;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      if (data[(y * source.width + x) * 4 + 3] < 8) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) return source;

  const width = right - left + 1;
  const height = bottom - top + 1;
  const margin = 4;
  const scale = Math.min((SPRITE_SIZE - margin * 2) / width, (SPRITE_SIZE - margin * 2) / height);

  const fitted = document.createElement("canvas");
  fitted.width = SPRITE_SIZE;
  fitted.height = SPRITE_SIZE;
  const target = fitted.getContext("2d");
  if (!target) return source;

  target.imageSmoothingEnabled = false;
  target.drawImage(
    source,
    left,
    top,
    width,
    height,
    Math.round((SPRITE_SIZE - width * scale) / 2),
    // Sat on the floor of the frame rather than centred, so a tall creature
    // and a short one stand on the same ground line.
    Math.round(SPRITE_SIZE - margin - height * scale),
    Math.round(width * scale),
    Math.round(height * scale),
  );

  return fitted;
}
