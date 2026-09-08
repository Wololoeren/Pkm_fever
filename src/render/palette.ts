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
  if (degrees === 0) return;

  const pixels = data.data;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const [r, g, b] = oklabToRgb(rotateHue(rgbToOklab(pixels[i], pixels[i + 1], pixels[i + 2]), degrees));
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
  }
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
