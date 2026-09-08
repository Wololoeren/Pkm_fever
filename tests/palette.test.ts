import { describe, expect, it } from "vitest";
import { mixImages, applyHueShift, oklabToRgb, rgbToOklab, rotateHue } from "@/render/palette";

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
