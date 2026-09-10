import { describe, expect, it } from "vitest";
import {
  applyHueShift,
  applyPaletteShift,
  learnPaletteShift,
  mixImages,
  oklabToRgb,
  rgbToOklab,
  rotateHue,
} from "@/render/palette";

/**
 * The colour maths behind the eleven appearances.
 *
 * Render-side, so floats are allowed here — nothing in this file feeds game
 * state, and a rounding difference changes a pixel rather than a save file.
 * It is still worth pinning: a tint that quietly stopped interpolating would
 * look like art that had not loaded rather than like a bug.
 */

/** ImageData is a DOM type; the transforms only touch `.data`, so a plain
 * object with the same shape exercises them without a browser. */
function image(pixels: number[]): ImageData {
  return {
    data: new Uint8ClampedArray(pixels),
    width: pixels.length / 4,
    height: 1,
    colorSpace: "srgb",
  } as ImageData;
}

describe("oklab", () => {
  it("P1: round-trips a colour to within a rounding step", () => {
    for (const rgb of [
      [0, 0, 0],
      [255, 255, 255],
      [226, 88, 42],
      [59, 127, 212],
      [84, 160, 56],
    ]) {
      const [r, g, b] = oklabToRgb(rgbToOklab(rgb[0], rgb[1], rgb[2]));
      expect(Math.abs(r - rgb[0])).toBeLessThanOrEqual(1);
      expect(Math.abs(g - rgb[1])).toBeLessThanOrEqual(1);
      expect(Math.abs(b - rgb[2])).toBeLessThanOrEqual(1);
    }
  });

  it("P2: a hue rotation holds lightness, which is what keeps contrast", () => {
    // This is the whole claim behind the chroma forms: the colours move, the
    // light and dark of the sprite does not.
    const lab = rgbToOklab(226, 88, 42);
    for (const degrees of [30, 100, 170, 240, 300]) {
      expect(rotateHue(lab, degrees).L).toBeCloseTo(lab.L, 10);
    }
  });

  it("P3: rotating a full turn returns where it started", () => {
    const lab = rgbToOklab(59, 127, 212);
    const round = rotateHue(lab, 360);
    expect(round.a).toBeCloseTo(lab.a, 6);
    expect(round.b).toBeCloseTo(lab.b, 6);
  });
});

describe("variant transforms", () => {
  it("P4: a tint at zero is the original and at one is the target", () => {
    const start = [200, 40, 40, 255];
    const target = image([40, 40, 200, 255]);

    const none = image([...start]);
    mixImages(none, target, 0);
    expect([...none.data]).toEqual(start);

    const full = image([...start]);
    mixImages(full, target, 1);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(full.data[i] - target.data[i])).toBeLessThanOrEqual(1);
    }
  });

  it("P5: a tint halfway is between the two, not either of them", () => {
    const half = image([200, 40, 40, 255]);
    mixImages(half, image([40, 40, 200, 255]), 0.5);

    expect(half.data[0]).toBeLessThan(200);
    expect(half.data[0]).toBeGreaterThan(40);
    expect(half.data[2]).toBeGreaterThan(40);
    expect(half.data[2]).toBeLessThan(200);
  });

  it("P6: transparent pixels are left alone, so the silhouette survives", () => {
    const transparent = image([200, 40, 40, 0]);
    mixImages(transparent, image([40, 40, 200, 255]), 1);
    expect([...transparent.data]).toEqual([200, 40, 40, 0]);

    const hidden = image([200, 40, 40, 0]);
    applyHueShift(hidden, 180);
    expect([...hidden.data]).toEqual([200, 40, 40, 0]);
  });

  it("P7: a hue shift actually changes the colour", () => {
    const shifted = image([226, 88, 42, 255]);
    applyHueShift(shifted, 170);
    expect([...shifted.data].slice(0, 3)).not.toEqual([226, 88, 42]);
    expect(shifted.data[3]).toBe(255);
  });
});

describe("a variant learned as a palette shift", () => {
  /**
   * The maths that lets an icon be tinted at all.
   *
   * The tint ladder is an interpolation between two images, which needs the
   * pair to be the same drawing at the same size. The box icons are neither,
   * and there is no shiny icon in existence to pair one with — so the shift is
   * read off the front pair and applied to the icon by nearest colour. These
   * pin the three things that has to get right.
   */
  it("P8: applied to the sprite it was learned from, it *is* the shiny", () => {
    // The identity case, and the one that says the maths is a shift rather
    // than an approximation of one.
    const normal = image([200, 40, 40, 255, 40, 60, 200, 255, 0, 0, 0, 255]);
    const shiny = image([40, 200, 40, 255, 220, 180, 60, 255, 0, 0, 0, 255]);
    const shift = learnPaletteShift(normal, shiny);

    const painted = image([...normal.data]);
    applyPaletteShift(painted, shift, 1);

    for (let i = 0; i < shiny.data.length; i++) {
      expect(Math.abs(painted.data[i] - shiny.data[i]), `channel ${i}`).toBeLessThanOrEqual(2);
    }
  });

  it("P9: it moves a colour it has never seen by its neighbour's delta", () => {
    // What makes it transferable. The icon's palette is not the sprite's —
    // measured, they share two colours out of ten — so almost every pixel it
    // is asked about is one it was not trained on.
    const normal = image([200, 40, 40, 255]);
    const shiny = image([200, 40, 200, 255]);
    const shift = learnPaletteShift(normal, shiny);

    // A near neighbour of the trained red, which is not the trained red.
    const near = image([190, 50, 46, 255]);
    applyPaletteShift(near, shift, 1);

    // It went blue-ward like its neighbour did, and it did not simply *become*
    // its neighbour's destination.
    expect(near.data[2]).toBeGreaterThan(120);
    expect([near.data[0], near.data[1], near.data[2]]).not.toEqual([200, 40, 200]);
  });

  it("P10: a colour the shiny does not change is left where it is", () => {
    // The outline case, and the reason the delta is transferred rather than
    // the destination. An icon's outline is pure black; the darkest colour in
    // a front sprite is a near-black. Mapping to the destination would lift
    // every outline in the game by a shade.
    const normal = image([24, 24, 24, 255, 200, 40, 40, 255]);
    const shiny = image([24, 24, 24, 255, 40, 40, 200, 255]);
    const shift = learnPaletteShift(normal, shiny);

    const outline = image([0, 0, 0, 255]);
    applyPaletteShift(outline, shift, 1);
    expect([outline.data[0], outline.data[1], outline.data[2]]).toEqual([0, 0, 0]);
  });

  it("P11: at zero it does nothing, and it never touches a transparent pixel", () => {
    const normal = image([200, 40, 40, 255]);
    const shiny = image([40, 40, 200, 255]);
    const shift = learnPaletteShift(normal, shiny);

    const still = image([200, 40, 40, 255]);
    applyPaletteShift(still, shift, 0);
    expect([...still.data]).toEqual([200, 40, 40, 255]);

    const clear = image([200, 40, 40, 0]);
    applyPaletteShift(clear, shift, 1);
    expect([...clear.data]).toEqual([200, 40, 40, 0]);
  });

  it("P12: it learns nothing from pixels that are not part of the drawing", () => {
    // A transparent pixel's colour channels are undefined in a PNG — they are
    // whatever the encoder left there. Learning from one would put a junk
    // colour in the palette for every real colour to be matched against.
    const normal = image([255, 0, 255, 0, 200, 40, 40, 255]);
    const shiny = image([0, 255, 0, 0, 40, 40, 200, 255]);
    const shift = learnPaletteShift(normal, shiny);

    expect(shift.from.length).toBe(1);
  });
});
