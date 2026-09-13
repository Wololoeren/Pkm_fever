import { species as speciesById } from "@/engine/dex";
import { variant } from "@/engine/variants";
import { applyColourShift, mixImages, oklabToRgb, rgbToOklab, rotateHue } from "./palette";

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

  // Shine first, colour second. Shine is a position between the two sprites
  // the artists drew; colour is a transform of whatever that lands on. Doing
  // it in this order is what makes a shiny Tide the Tide transform applied to
  // the shiny palette, which is exactly what the name says it is.
  const base = await loadImage(urlFor(num, false));
  if (!base) return null;

  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(base, 0, 0, SPRITE_SIZE, SPRITE_SIZE);

  if (form.mix > 0) {
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
  }

  if (form.chromaId) {
    const image = ctx.getImageData(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    applyColourShift(image, form);
    ctx.putImageData(image, 0, 0);
  }

  // Cropping happens last so that the two source images stay pixel-aligned
  // through the interpolation above.
  return fitToFrame(canvas);
}

/**
 * The egg, in the colour of what is inside it.
 *
 * The same egg the handhelds drew — cream, with green spots — from the same
 * repository as every creature, so it sits in the set rather than beside it.
 * Only the colour of the child is applied, not its shine: the spots take the
 * chroma's hue and the cream shell, having almost no colour of its own, stays
 * cream. Shine is a mix toward a second drawing, and nobody drew a shiny egg.
 */
const EGG_URL = `${BASE}/egg.png`;

function eggKey(variantId: string): string {
  return `egg:${variant(variantId).chromaId ?? "plain"}`;
}

export function cachedEgg(variantId: string): HTMLCanvasElement | null {
  return sprites.get(eggKey(variantId)) ?? null;
}

export function loadEgg(variantId: string): Promise<HTMLCanvasElement | null> {
  const id = eggKey(variantId);
  const started = building.get(id);
  if (started) return started;

  const pending = buildEgg(variantId).then((canvas) => {
    sprites.set(id, canvas);
    return canvas;
  });
  building.set(id, pending);
  return pending;
}

async function buildEgg(variantId: string): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return null;
  const image = await loadImage(EGG_URL);
  if (!image) return null;

  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, SPRITE_SIZE, SPRITE_SIZE);

  const form = variant(variantId);
  if (form.chromaId) {
    const data = ctx.getImageData(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    tintEgg(data, form);
    ctx.putImageData(data, 0, 0);
  }
  return fitToFrame(canvas);
}

/** The swatch's reference colour, which every chroma's dot is a transform of. */
const SWATCH_HUE = hueOf(rgbToOklab(214, 122, 74));
/** The egg's green spots. */
const SPOT_HUE = hueOf(rgbToOklab(156, 205, 131));

function hueOf(lab: { a: number; b: number }): number {
  return (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
}

/**
 * Colours the egg so its spots are the chroma's swatch colour.
 *
 * A chroma is a transform, not a colour: on a creature it rotates whatever
 * the art already has. Rotated straight, the egg's green spots would land on
 * a different colour from the dot the same chroma paints beside a creature —
 * an Ember egg came out teal. So the spots are first turned to the swatch's
 * reference orange, and the chroma applied to that, which is exactly how the
 * dot is made.
 *
 * Only the spots, for the colours that are a hue: the shell stays an egg. The
 * two that are a lightness — Onyx and Ivory — take the whole shell with them,
 * because pale spots on a cream egg are no spots at all.
 */
function tintEgg(image: ImageData, form: ReturnType<typeof variant>): void {
  const whole = form.lightShift !== 0;
  const spots = new ImageData(image.width, image.height);
  const pixels = image.data;

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const lab = rgbToOklab(pixels[i], pixels[i + 1], pixels[i + 2]);
    const colourful = Math.hypot(lab.a, lab.b) > 0.06;
    const green = colourful && Math.abs(hueOf(lab) - SPOT_HUE) < 30;
    if (!green && !whole) continue;

    const [r, g, b] = oklabToRgb(green ? rotateHue(lab, SWATCH_HUE - SPOT_HUE) : lab);
    spots.data.set([r, g, b, 255], i);
  }

  applyColourShift(spots, form);
  for (let i = 0; i < pixels.length; i += 4) {
    if (spots.data[i + 3] === 0) continue;
    pixels.set(spots.data.subarray(i, i + 3), i);
  }
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
