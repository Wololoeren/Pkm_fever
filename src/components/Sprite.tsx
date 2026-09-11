"use client";

import { useEffect, useRef, useState } from "react";
import { chroma, TOP_TIER, variant, variantSummary } from "@/engine/variants";
import { creatureSprite } from "@/render/creature";
import { swatchFor } from "@/render/palette";
import { cachedSprite, loadSprite, SPRITE_SIZE } from "@/render/sprites";

/**
 * The marks that say a creature is not ordinary.
 *
 * Two axes means two marks. Shine is a rung, so it gets a rung's glyph — a
 * numbered spark on the way up, a star at the top. Colour is a colour, so it
 * gets a dot painted in the colour the sprite pipeline actually produces for
 * it, from the same transform, rather than a hand-picked one that could drift.
 *
 * Both matter, because the palette shift alone is not enough to read: a
 * two-fifths tint of something already green is a colour you would have to
 * have memorised the original to notice, and with eight colours a bare
 * diamond stopped saying which.
 */
function VariantMark({ variantId, size }: { variantId: string; size: number }) {
  const form = variant(variantId);
  if (form.tier === 0 && !form.chromaId) return null;

  const fontSize = Math.max(9, Math.round(size * 0.16));

  return (
    <>
      {form.tier > 0 && (
        <span className={`mark ${form.tier === TOP_TIER ? "shiny" : "tint"}`} style={{ fontSize }}>
          {form.tier === TOP_TIER ? "★" : `✦${form.tier}`}
        </span>
      )}
      {form.chromaId && (
        <span
          className="mark chroma"
          style={{ fontSize, color: swatchFor(form), borderColor: swatchFor(form) }}
          // Eight colours is past what a shape can carry, so the letter does
          // the work and the colour confirms it.
        >
          {chroma(form.chromaId).name.charAt(0)}
        </span>
      )}
    </>
  );
}

/**
 * The only sizes at which pixel art stays pixel art.
 *
 * The sprites are 96 pixels square. Drawn into a box that is not a whole
 * multiple or a whole fraction of that, nearest-neighbour scaling has to make
 * some source pixels wider than others — at the battle's old 148, forty-four
 * columns came out one pixel wide and fifty-two came out two. That is what
 * "distorted" looks like on pixel art: outlines that wobble, a one-pixel line
 * that is sometimes two, a creature that reads as very slightly stretched in
 * places and nowhere in particular.
 *
 * It cannot be fixed by turning smoothing on — that trades a lumpy sprite for
 * a blurry one — and it cannot be fixed by `image-rendering: pixelated`, which
 * only moves the same uneven division into the browser. The only cure is for
 * the box to be a whole multiple of the art.
 */
const CRISP_SIZES: readonly number[] = [24, 48, 96, 192, 384];

/**
 * The nearest size at which every source pixel is the same size.
 *
 * Snapped here rather than left to the caller, so a layout that wants "about
 * 150 across" gets 192 and cannot quietly reintroduce this. Ties go to the
 * smaller, because growing a sprite is what breaks a layout.
 */
export function crispSize(wanted: number): number {
  return CRISP_SIZES.reduce((best, size) =>
    Math.abs(size - wanted) < Math.abs(best - wanted) ? size : best,
  );
}

/**
 * Draws a creature at a given size.
 *
 * Real art when it has arrived, and a flat shadow of the right shape until
 * then — so a slow connection shows something standing there rather than a
 * hole in the layout, and the game still runs with no network at all. The
 * shadow is deliberately not art: see `render/creature`.
 *
 * The size asked for is snapped to one the art divides into. See CRISP_SIZES.
 */
export function Sprite({
  speciesId,
  variantId,
  size = 96,
  flip = false,
  faint = false,
  marks = true,
}: {
  speciesId: string;
  variantId: string;
  size?: number;
  flip?: boolean;
  faint?: boolean;
  /**
   * Whether to put the star and the colour letter on it.
   *
   * On everywhere by default, because everywhere else the sprite is one of
   * many and the badges are how you pick the interesting one out of a list.
   * Off for the evolution reveal, which is the one place the sprite is not in
   * a list: it is alone, in the middle of the screen, with nothing to be
   * picked out from and twenty seconds of build-up behind it. A badge there is
   * an interface element in the middle of the only moment this game asks you
   * to just look at something.
   */
  marks?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [, setLoaded] = useState(0);
  const drawn = crispSize(size);

  // Kick off the download once per species-and-variant; the cache makes every
  // later mount free.
  useEffect(() => {
    let live = true;
    if (!cachedSprite(speciesId, variantId)) {
      void loadSprite(speciesId, variantId).then(() => {
        if (live) setLoaded((n) => n + 1);
      });
    }
    return () => {
      live = false;
    };
  }, [speciesId, variantId]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const sprite = cachedSprite(speciesId, variantId) ?? creatureSprite(speciesId);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!sprite) return;

    ctx.save();
    ctx.globalAlpha = faint ? 0.35 : 1;
    if (flip) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite, 0, 0, SPRITE_SIZE, SPRITE_SIZE, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  });

  return (
    <span className="spriteWrap" style={{ width: drawn, height: drawn }} title={variantSummary(variantId)}>
      <canvas ref={ref} width={drawn} height={drawn} style={{ width: drawn, height: drawn }} />
      {marks ? <VariantMark variantId={variantId} size={drawn} /> : null}
    </span>
  );
}
