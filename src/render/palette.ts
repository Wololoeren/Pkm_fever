/**
 * Colour maths for the variant pipeline.
 *
 * This is the render side, so floats are fine — nothing here feeds game state,
 * and a rounding difference between two machines changes a pixel rather than a
 * save file. Every function in src/engine has the opposite rule.
 *
 * Two transforms, and between them they turn two source images into all eleven
 * appearances:
 *
 *  - **tints** interpolate normal towards shiny in OKLab. Interpolating in
 *    sRGB muddies pixel art badly through the midpoint, because sRGB is not
 *    perceptually uniform and the halfway point between two saturated colours
 *    lands in grey.
 *  - **chromas** rotate hue in OKLCh while holding lightness and chroma. That
 *    is exactly "colours transformed, contrast preserved": the shape stays
 *    readable and the creature still sits properly against a background.
 */

export interface Oklab {
  L: number;
  a: number;
  b: number;
}

function srgbToLinear(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number): number {
  const v = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

/** Björn Ottosson's OKLab. */
export function rgbToOklab(r: number, g: number, b: number): Oklab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToRgb({ L, a, b }: Oklab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Rotates hue by `degrees`, holding lightness and chroma exactly. */
export function rotateHue(lab: Oklab, degrees: number): Oklab {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    L: lab.L,
    a: lab.a * cos - lab.b * sin,
    b: lab.a * sin + lab.b * cos,
  };
}

/**
 * Rotates every opaque pixel's hue, in place. This is a chroma form.
 */
export function applyHueShift(data: ImageData, degrees: number): void {
  applyColourShift(data, { hueShift: degrees, hueSet: null, lightShift: 0, satScale: 1000 });
}

/** What a chroma does to a colour. Per-mille where it is a magnitude, so the
 * numbers match the ones the engine stores. */
export interface ColourShift {
  hueShift: number;
  hueSet: number | null;
  lightShift: number;
  satScale: number;
}

/**
 * The whole chroma transform, in place, in OKLCh.
 *
 * Hue rotation alone cannot reach black or white, because neither is a hue —
 * that is why lightness and colourfulness are here too. Lightness moves toward
 * the end it is heading for rather than by a flat amount, so a shift that
 * darkens never clips a dark pixel to nothing and never flattens the shading
 * that makes a sprite read as a shape.
 */
export function applyColourShift(data: ImageData, shift: ColourShift): void {
  const neutral =
    shift.hueShift === 0 && shift.hueSet === null && shift.lightShift === 0 && shift.satScale === 1000;
  if (neutral) return;

  const pixels = data.data;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;

    let lab = rgbToOklab(pixels[i], pixels[i + 1], pixels[i + 2]);
    lab = shift.hueSet === null ? rotateHue(lab, shift.hueShift) : setHue(lab, shift.hueSet);

    if (shift.satScale !== 1000) {
      lab = { L: lab.L, a: (lab.a * shift.satScale) / 1000, b: (lab.b * shift.satScale) / 1000 };
    }

    if (shift.lightShift !== 0) {
      const towards = shift.lightShift > 0 ? 1 : 0;
      const amount = Math.abs(shift.lightShift) / 1000;
      lab = { L: lab.L + (towards - lab.L) * amount, a: lab.a, b: lab.b };
    }

    const [r, g, b] = oklabToRgb(lab);
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
  }
}

/** Replaces the hue outright, keeping lightness and colourfulness. For a
 * colour that has to *be* something on every species rather than be turned. */
export function setHue(lab: Oklab, degrees: number): Oklab {
  const chroma = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  const radians = (degrees * Math.PI) / 180;
  return { L: lab.L, a: chroma * Math.cos(radians), b: chroma * Math.sin(radians) };
}

/**
 * Interpolates `base` towards `target` by `t` (0..1), in place on `base`.
 *
 * This is a tint, and it is the reason the two source sprites are worth
 * loading: a real gradient between the normal and shiny palettes, rather than
 * a guess at one. Done in OKLab, because the halfway point between two
 * saturated colours in sRGB lands in mud.
 *
 * The two images are the same creature in the same pose, so pixels correspond
 * one to one; where they disagree about transparency the opaque one wins,
 * which keeps the silhouette intact.
 */
/**
 * What a chroma would do to a representative colour, as a hex string.
 *
 * Derived rather than hand-picked, so a badge can never claim a colour the
 * sprite pipeline does not actually produce. The reference is a mid-lightness
 * warm orange — roughly where most creature art sits — so Onyx reads dark and
 * Ivory reads pale, which is the whole point of those two.
 */
export function swatchFor(shift: ColourShift): string {
  const lab = (() => {
    let value = rgbToOklab(214, 122, 74);
    value = shift.hueSet === null ? rotateHue(value, shift.hueShift) : setHue(value, shift.hueSet);
    value = { L: value.L, a: (value.a * shift.satScale) / 1000, b: (value.b * shift.satScale) / 1000 };
    if (shift.lightShift !== 0) {
      const towards = shift.lightShift > 0 ? 1 : 0;
      const amount = Math.abs(shift.lightShift) / 1000;
      value = { L: value.L + (towards - value.L) * amount, a: value.a, b: value.b };
    }
    return value;
  })();

  const [r, g, b] = oklabToRgb(lab);
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function mixImages(base: ImageData, target: ImageData, t: number): void {
  if (t <= 0) return;

  const a = base.data;
  const b = target.data;
  const length = Math.min(a.length, b.length);

  for (let i = 0; i < length; i += 4) {
    if (a[i + 3] === 0 || b[i + 3] === 0) continue;

    const from = rgbToOklab(a[i], a[i + 1], a[i + 2]);
    const to = rgbToOklab(b[i], b[i + 1], b[i + 2]);
    const [r, g, bl] = oklabToRgb({
      L: from.L + (to.L - from.L) * t,
      a: from.a + (to.a - from.a) * t,
      b: from.b + (to.b - from.b) * t,
    });

    a[i] = r;
    a[i + 1] = g;
    a[i + 2] = bl;
  }
}

/** One colour per type, used to give a species a recognisable palette. */
export const TYPE_COLORS: Record<string, string> = {
  normal: "#9199a1",
  fire: "#e2582a",
  water: "#3b7fd4",
  electric: "#e0b21c",
  grass: "#54a038",
  ice: "#5fbcc4",
  fighting: "#b6382f",
  poison: "#8e4a9e",
  ground: "#b48a3e",
  flying: "#7f9ad4",
  psychic: "#d94f7c",
  bug: "#89a026",
  rock: "#9c8a4c",
  ghost: "#61558f",
  dragon: "#4a53b8",
  dark: "#4f454c",
  steel: "#7d8a97",
  fairy: "#d97fb0",
  stellar: "#3fa39a",
};

export function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? TYPE_COLORS.normal;
}

/**
 * A variant expressed as a palette shift rather than as a second image.
 *
 * `mixImages` can only tint an image that comes with a matching partner: it
 * walks two images pixel by pixel, so both have to be the same art at the same
 * size. That is true of the front sprites — PokeAPI's normal and shiny pair is
 * the same drawing recoloured, and measured, not one pixel of either differs in
 * *shape* — and it is the reason the tint ladder works at all.
 *
 * It is not true of anything else. The box icons are a different drawing at a
 * different size in a different palette, and there is no shiny icon anywhere to
 * pair one with. So the shift is *learned* from the pair the artists drew and
 * then applied to whichever image is being drawn:
 *
 *   - `learnPaletteShift` reads the front pair and records, for each colour in
 *     the normal sprite, how far it moves in OKLab to become shiny.
 *   - `applyPaletteShift` finds the nearest of those colours to each pixel of
 *     some other image and moves it by the same amount.
 *
 * Nearest rather than exact, because the two palettes are not the same set:
 * measured across a spread of species, an icon shares two colours exactly with
 * its front sprite and no more. What it does share is the colour *families* —
 * a Pikachu's yellow, a Snorlax's cream and blue, a Charizard's orange and red
 * — and those match at an OKLab distance of 0.01 to 0.08, against shiny shifts
 * of 0.04 to 0.16. The match is several times finer than the thing being
 * measured, which is what makes this honest rather than merely plausible.
 *
 * The *delta* is transferred and not the destination, which matters for the one
 * case that would otherwise look wrong: an icon's pure black outline has no
 * exact partner in a front sprite whose darkest colour is a near-black, so
 * mapping to the destination would quietly lift every outline. Adding the
 * delta leaves a colour the shiny does not change exactly where it was.
 */
export interface PaletteShift {
  /** The normal sprite's colours, in the order the deltas match. */
  from: Oklab[];
  /** Where each one goes, as an offset rather than a destination. */
  delta: Oklab[];
}

export function learnPaletteShift(normal: ImageData, shiny: ImageData): PaletteShift {
  const seen = new Map<number, { from: Oklab; delta: Oklab }>();
  const length = Math.min(normal.data.length, shiny.data.length);

  for (let i = 0; i < length; i += 4) {
    // Both opaque, or the pixel is not part of the drawing on one side and
    // there is nothing to learn from it.
    if (normal.data[i + 3] < 200 || shiny.data[i + 3] < 200) continue;

    const packed = (normal.data[i] << 16) | (normal.data[i + 1] << 8) | normal.data[i + 2];
    if (seen.has(packed)) continue;

    const from = rgbToOklab(normal.data[i], normal.data[i + 1], normal.data[i + 2]);
    const to = rgbToOklab(shiny.data[i], shiny.data[i + 1], shiny.data[i + 2]);
    seen.set(packed, { from, delta: { L: to.L - from.L, a: to.a - from.a, b: to.b - from.b } });
  }

  const rows = [...seen.values()];
  return { from: rows.map((row) => row.from), delta: rows.map((row) => row.delta) };
}

export function applyPaletteShift(image: ImageData, shift: PaletteShift, t: number): void {
  if (t <= 0 || !shift.from.length) return;

  // Keyed by colour rather than by pixel. A sprite is a handful of colours
  // over thousands of pixels — an icon runs from eight to a hundred and ten —
  // so the nearest-colour search runs a hundred times rather than ten thousand.
  const done = new Map<number, [number, number, number]>();

  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] < 8) continue;

    const packed = (image.data[i] << 16) | (image.data[i + 1] << 8) | image.data[i + 2];
    let out = done.get(packed);

    if (!out) {
      const here = rgbToOklab(image.data[i], image.data[i + 1], image.data[i + 2]);

      let best = 0;
      let closest = Infinity;
      for (let n = 0; n < shift.from.length; n++) {
        const one = shift.from[n];
        const gap =
          (here.L - one.L) * (here.L - one.L) +
          (here.a - one.a) * (here.a - one.a) +
          (here.b - one.b) * (here.b - one.b);
        if (gap < closest) {
          closest = gap;
          best = n;
        }
      }

      const move = shift.delta[best];
      out = oklabToRgb({
        L: here.L + move.L * t,
        a: here.a + move.a * t,
        b: here.b + move.b * t,
      });
      done.set(packed, out);
    }

    image.data[i] = out[0];
    image.data[i + 1] = out[1];
    image.data[i + 2] = out[2];
  }
}
