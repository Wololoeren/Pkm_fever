"use client";

import { useEffect, useRef, useState } from "react";
import { creatureSprite } from "@/render/creature";
import { cachedSprite, loadSprite, SPRITE_SIZE } from "@/render/sprites";

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

  return <canvas ref={ref} width={size} height={size} style={{ width: size, height: size }} />;
}
