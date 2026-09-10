import { species as speciesById } from "@/engine/dex";
import { variant } from "@/engine/variants";
import {
  applyColourShift,
  applyPaletteShift,
  learnPaletteShift,
  type PaletteShift,
} from "./palette";
import { loadSprite } from "./sprites";

/**
 * Box icons: the art for a creature standing on the map.
 *
 * The overworld used to draw the battle sprite. That is a 96x96 drawing and a
 * tile is 26 pixels, so it went in at a quarter size with smoothing off — and
 * a quarter-size nearest-neighbour downscale of pixel art *throws away three
 * pixels in every four*. Eyes, ears and outlines land on the dropped rows at
 * random, which is why a creature standing in the grass looked mangled rather
 * than small.
 *
 * The games have art for exactly this job. The box icons are drawn at map
 * scale to begin with: 68x56 sheets whose creature occupies 14 to 58 pixels,
 * so a tile-sized draw is somewhere between one-to-one and a half, and nothing
 * has to be thrown away to get there.
 *
 * ## What is missing, and what happens then
 *
 * The set runs from Bulbasaur to Calyrex plus most regional forms — 945 of the
 * 1,099 sprite numbers this dex uses. Everything from Sprigatito onward has no
 * icon, and neither do 27 of the forms. Those fall back to the battle sprite,
 * shrunk properly rather than sampled: one high-quality downscale to the size
 * it will actually be drawn at. That is not as good as an icon and it is a very
 * long way better than what it replaced.
 *
 * ## Variants
 *
 * There is no shiny icon anywhere in the set, so the tint ladder cannot be an
 * interpolation between two icons the way it is between two sprites. It is a
 * palette shift learned from the front pair instead — see `learnPaletteShift`
 * in palette.ts for why that transfers. A shiny roamer has to *look* shiny from
 * across the route, because seeing it before you fight it is the whole appeal.
 */

const BASE =
  "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-viii/icons";

const FRONT = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";

/**
 * The box a creature standing on the map is drawn into.
 *
 * Wider than it is deep, and both a little over the 26-pixel tile: the icons
 * are wide drawings, and a creature that overhangs its tile upward reads as
 * standing in the world rather than sitting in a box. It cannot overhang
 * *downward*, because that is the floor it is standing on.
 */
const ICON_WIDTH = 30;
const ICON_HEIGHT = 34;

const icons = new Map<string, HTMLCanvasElement | null>();
const building = new Map<string, Promise<HTMLCanvasElement | null>>();
const images = new Map<string, Promise<HTMLImageElement | null>>();

function key(speciesId: string, variantId: string): string {
  return `${speciesId}:${variantId}`;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  const existing = images.get(url);
  if (existing) return existing;

  const pending = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    // Without this the canvas is tainted and getImageData throws, which would
    // take every variant with it. The icon host allows it; see sprites.ts.
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });

  images.set(url, pending);
  return pending;
}

/**
 * The icon, built and cached, or null for a species that has none.
 *
 * Private, because "did the icon exist" is not a question worth exporting: the
 * caller wants art for a tile and does not care which of the two sources it
 * came from. See `loadMapArt`.
 */
function loadIcon(speciesId: string, variantId: string): Promise<HTMLCanvasElement | null> {
  const id = key(speciesId, variantId);
  const started = building.get(id);
  if (started) return started;

  const pending = build(speciesId, variantId).then((canvas) => {
    icons.set(id, canvas);
    return canvas;
  });

  building.set(id, pending);
  return pending;
}

/**
 * What the shiny palette does to this species, learned once and kept.
 *
 * Keyed by sprite number rather than by species, because the forms that share
 * a number share a drawing and therefore share the answer.
 */
const shifts = new Map<number, Promise<PaletteShift | null>>();

function shiftFor(num: number): Promise<PaletteShift | null> {
  const existing = shifts.get(num);
  if (existing) return existing;

  const pending = (async () => {
    const [normal, shiny] = await Promise.all([
      loadImage(`${FRONT}/${num}.png`),
      loadImage(`${FRONT}/shiny/${num}.png`),
    ]);
    if (!normal || !shiny) return null;

    const a = pixels(normal);
    const b = pixels(shiny);
    return a && b ? learnPaletteShift(a, b) : null;
  })();

  shifts.set(num, pending);
  return pending;
}

function pixels(image: HTMLImageElement): ImageData | null {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function build(speciesId: string, variantId: string): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return null;

  const num = speciesById(speciesId).spriteNum;
  const source = await loadImage(`${BASE}/${num}.png`);
  if (!source) return null;

  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0);

  const form = variant(variantId);

  // Shine first, colour second — the same order as the battle sprite, so a
  // shiny Tide is the Tide transform over the shiny palette in both places.
  if (form.mix > 0) {
    const shift = await shiftFor(num);
    if (shift) {
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      applyPaletteShift(image, shift, form.mix / 1000);
      ctx.putImageData(image, 0, 0);
    }
  }

  if (form.chromaId) {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyColourShift(image, form);
    ctx.putImageData(image, 0, 0);
  }

  return fit(canvas);
}

/**
 * The art for a creature standing on the map, ready to blit at one-to-one.
 *
 * One question with one answer, so the canvas does not have to know which of
 * the two sources it got: the icon where there is one, and the battle sprite
 * shrunk properly where there is not. Either way what comes back is already
 * the size it will be drawn at, which is the point — the bug this replaced was
 * a resample happening at paint time, every frame, at a ratio nothing chose.
 */
const shrunk = new Map<string, HTMLCanvasElement | null>();

export function cachedMapArt(speciesId: string, variantId: string): HTMLCanvasElement | null {
  const id = key(speciesId, variantId);
  return icons.get(id) ?? shrunk.get(id) ?? null;
}

export function loadMapArt(
  speciesId: string,
  variantId: string,
): Promise<HTMLCanvasElement | null> {
  const id = key(speciesId, variantId);

  return loadIcon(speciesId, variantId).then((icon) => {
    if (icon) return icon;
    if (shrunk.has(id)) return shrunk.get(id) ?? null;

    // No icon for this one. The battle sprite is already being cached for the
    // party panel and the battle view, so this usually costs no download.
    return loadSprite(speciesId, variantId).then((sprite) => {
      const made = sprite ? fit(sprite) : null;
      shrunk.set(id, made);
      return made;
    });
  });
}


/**
 * Trims the transparent margin and shrinks what is left to fit the map box.
 *
 * Two rules, and both of them are the lesson from what this replaced:
 *
 * **Never enlarge.** Two fifths of the icons already fit a tile, and an upscale
 * by 1.33 makes some source pixels one screen pixel and others two, which is
 * the uneven-pixel problem `crispSize` in Sprite.tsx exists to avoid. A
 * Caterpie being smaller than a Steelix on the map is not a defect anyway — it
 * is the one thing a fixed box throws away, and it is worth keeping.
 *
 * **Average rather than sample.** Sampling instead of averaging is precisely
 * what mangled the battle sprite at a quarter size, so anything under one-to-one
 * goes through the browser's high-quality filter, and one-to-one does not go
 * through a filter at all.
 *
 * The scale used to snap to a half or a third, on the theory that a whole
 * fraction keeps the pixel grid even. That is true of *sampling* and irrelevant
 * to averaging, and it cost a great deal: a Snorlax wants 0.79 and was given
 * 0.5, which made it exactly as big as an Eevee. The fit is used as it falls.
 */
function fit(source: HTMLCanvasElement): HTMLCanvasElement | null {
  const ctx = source.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

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
  if (right < left || bottom < top) return null;

  const width = right - left + 1;
  const height = bottom - top + 1;

  const scale = Math.min(1, ICON_WIDTH / width, ICON_HEIGHT / height);

  const drawnWidth = Math.max(1, Math.round(width * scale));
  const drawnHeight = Math.max(1, Math.round(height * scale));

  const fitted = document.createElement("canvas");
  fitted.width = drawnWidth;
  fitted.height = drawnHeight;
  const target = fitted.getContext("2d");
  if (!target) return null;

  // Nothing is resampled at one-to-one, so smoothing there would only soften
  // art that is already the right size.
  target.imageSmoothingEnabled = scale < 1;
  target.imageSmoothingQuality = "high";
  target.drawImage(source, left, top, width, height, 0, 0, drawnWidth, drawnHeight);

  return fitted;
}
