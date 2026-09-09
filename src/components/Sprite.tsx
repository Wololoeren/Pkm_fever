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
 * Draws a creature at a given size.
 *
 * Real art when it has arrived, and the generated placeholder until then — so
 * a slow connection shows a creature-shaped thing rather than a hole, and the
 * game still runs with no network at all. Both go through the same variant
 * pipeline, so a tint is a tint either way.
 */
export function Sprite({
  speciesId,
  variantId,
  size = 96,
  flip = false,
  faint = false,
}: {
  speciesId: string;
  variantId: string;
  size?: number;
  flip?: boolean;
  faint?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [, setLoaded] = useState(0);

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

    const sprite = cachedSprite(speciesId, variantId) ?? creatureSprite(speciesId, variantId);
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
    <span className="spriteWrap" style={{ width: size, height: size }} title={variantSummary(variantId)}>
      <canvas ref={ref} width={size} height={size} style={{ width: size, height: size }} />
      <VariantMark variantId={variantId} size={size} />
    </span>
  );
}
