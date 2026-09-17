"use client";

import { ability, isAbility } from "@/engine/abilities";
import { isItem, item as itemSpec } from "@/engine/items";
import { useEffect, useRef, useState } from "react";
import { chroma, TOP_TIER, variant, variantSummary } from "@/engine/variants";
import { creatureSprite } from "@/render/creature";
import { swatchFor } from "@/render/palette";
import { cachedEgg, cachedSprite, loadEgg, loadSprite, SPRITE_SIZE } from "@/render/sprites";

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
/**
 * Sergeant's stripes: one chevron for each ability, in the top-left corner.
 *
 * Nine creatures in ten have none, so a single chevron is already worth a
 * second look, and three — which only breeding reaches — reads as the rank it
 * is. Drawn rather than typed, because a stack of angles says "how many" at a
 * glance where a number would need reading. Kept to its own corner: the shine
 * star is top right and the colour letter bottom right.
 */
function AbilityMark({ abilities, size }: { abilities: readonly string[]; size: number }) {
  const count = Math.min(3, abilities.filter(isAbility).length);
  if (!count) return null;

  // A floor for the small sprites (party, box), where a fifth of 48 is too little to read.
  const width = Math.max(14, Math.round(size * 0.2));
  const rise = width * 0.42;
  const gap = width * 0.3;
  const stroke = Math.max(2, width * 0.2);
  const height = rise + gap * (count - 1) + stroke * 1.5;
  const names = abilities.filter(isAbility).map((id) => ability(id).name).join(", ");

  return (
    <span className="abilityMark" title={names} aria-label={`${count} ${count === 1 ? "ability" : "abilities"}: ${names}`}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
        {Array.from({ length: count }, (_, at) => {
          const y = stroke * 0.75 + rise + gap * at;
          const points = `${stroke * 0.75},${y} ${width / 2},${y - rise} ${width - stroke * 0.75},${y}`;
          return (
            <g key={at}>
              <polyline points={points} fill="none" stroke="#1b1206" strokeWidth={stroke + 2} strokeLinejoin="round" strokeLinecap="round" />
              <polyline points={points} fill="none" stroke="#f0cd76" strokeWidth={stroke} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
      </svg>
    </span>
  );
}

/**
 * A little gift box in the bottom-left corner: it is carrying something.
 *
 * The fourth corner, and the last free one — shine top right, colour bottom
 * right, ability stripes top left. The item's name is the hover text, so the
 * box says "something" at a glance and "what" on a look.
 */
function HeldMark({ itemId, size }: { itemId: string; size: number }) {
  const width = Math.max(12, Math.round(size * 0.17));
  const name = isItem(itemId) ? itemSpec(itemId).name : itemId;
  return (
    <span className="heldMark" title={`Holding ${name}`} aria-label={`Holding ${name}`}>
      <svg width={width} height={width} viewBox="0 0 16 16" aria-hidden>
        {/* The bow. */}
        <path d="M8 5 C5 1 2 3 4 5 Z M8 5 C11 1 14 3 12 5 Z" fill="#f0cd76" stroke="#1b1206" strokeWidth="1" />
        {/* The lid, then the box. */}
        <rect x="2" y="5" width="12" height="3.5" rx="0.6" fill="#d4675a" stroke="#1b1206" strokeWidth="1" />
        <rect x="3" y="8.5" width="10" height="6.5" rx="0.6" fill="#c9504f" stroke="#1b1206" strokeWidth="1" />
        {/* The ribbon down the middle. */}
        <rect x="7" y="5" width="2" height="10" fill="#f0cd76" />
      </svg>
    </span>
  );
}

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
  abilities,
  heldItem,
}: {
  speciesId: string;
  variantId: string;
  /** Its abilities, for the chevrons in the corner. Omit where there is no creature, only a species. */
  abilities?: readonly string[];
  /** What it is carrying, for the gift box in the corner. */
  heldItem?: string | null;
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
      {marks && abilities ? <AbilityMark abilities={abilities} size={drawn} /> : null}
      {marks && heldItem ? <HeldMark itemId={heldItem} size={drawn} /> : null}
    </span>
  );
}

/**
 * An egg, wearing the colour of whatever is going to come out of it.
 *
 * Its own component rather than a species id handed to `Sprite`, because an
 * egg is not a species: it has no shadow shape to fall back to, no shine, and
 * no marks — the colour on the shell is the whole of what it tells you.
 */
export function EggSprite({ variantId, size = 96 }: { variantId: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [, setLoaded] = useState(0);
  const drawn = crispSize(size);

  useEffect(() => {
    let live = true;
    if (!cachedEgg(variantId)) {
      void loadEgg(variantId).then(() => {
        if (live) setLoaded((n) => n + 1);
      });
    }
    return () => {
      live = false;
    };
  }, [variantId]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const egg = cachedEgg(variantId);
    if (!egg) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(egg, 0, 0, SPRITE_SIZE, SPRITE_SIZE, 0, 0, canvas.width, canvas.height);
  });

  const form = variant(variantId);
  return (
    <span
      className="spriteWrap"
      style={{ width: drawn, height: drawn }}
      title={form.chromaId ? `An egg with ${chroma(form.chromaId).name.toLowerCase()} spots` : "An egg"}
    >
      <canvas ref={ref} width={drawn} height={drawn} style={{ width: drawn, height: drawn }} />
    </span>
  );
}
