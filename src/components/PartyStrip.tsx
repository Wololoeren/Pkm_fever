"use client";

import { maxHp } from "@/engine/battle";
import { species as speciesById } from "@/engine/dex";
import { computeStats } from "@/engine/stats";
import { GENDER_NAMES, GENDER_SYMBOLS } from "@/engine/gender";
import type { Gender, Individual } from "@/engine/types";
import { chroma, isSpecial, TOP_TIER, variant } from "@/engine/variants";
import { swatchFor } from "@/render/palette";
import { displayName } from "@/lib/narrate";
import { Sprite } from "./Sprite";

export function hpClass(current: number, max: number): string {
  const share = max > 0 ? current / max : 0;
  if (share <= 0.2) return "hp low";
  if (share <= 0.5) return "hp mid";
  return "hp";
}

export function HpBar({ creature }: { creature: Individual }) {
  const max = maxHp(creature);
  const share = max > 0 ? Math.max(0, creature.hp / max) : 0;
  return (
    <div className="hpTrack">
      <div className={hpClass(creature.hp, max)} style={{ width: `${share * 100}%` }} />
    </div>
  );
}

/**
 * The badges a variant earns — one per axis, never one for the pair.
 *
 * Shine and colour are independent, so "Shiny Tide" as a single tag reads as
 * a third kind of thing rather than as a shiny that happens to be Tide. Two
 * tags say what is actually true: this creature is on rung five, and it is
 * wearing Tide. Normal creatures get neither, so the strip stays quiet until
 * something interesting is in it.
 */
export function VariantTag({ variantId }: { variantId: string }) {
  if (!isSpecial(variantId)) return null;
  const form = variant(variantId);

  return (
    <>
      {form.tier > 0 && (
        <span className={`tag ${form.tier === TOP_TIER ? "shiny" : "tint"}`}>
          {TIER_LABELS[form.tier]}
        </span>
      )}
      {form.chromaId && (
        <span className="tag chroma" style={{ color: swatchFor(form), borderColor: swatchFor(form) }}>
          {chroma(form.chromaId).name}
        </span>
      )}
    </>
  );
}

const TIER_LABELS = ["Normal", "Faded", "Washed", "Turning", "Nearly", "Shiny"];

/** The symbol, coloured so it reads at a glance in a list. */
export function GenderMark({ gender }: { gender: Gender }) {
  return (
    <span className={`gender ${gender}`} title={GENDER_NAMES[gender]}>
      {GENDER_SYMBOLS[gender]}
    </span>
  );
}

export function PartyStrip({
  party,
  activeIndex,
  onSelect,
  onInspect,
}: {
  party: Individual[];
  activeIndex?: number;
  onSelect?: (index: number) => void;
  /** Opens the full sheet. Separate from onSelect, which switches in battle. */
  onInspect?: (uid: number) => void;
}) {
  if (!party.length) return <p className="muted">Nothing in your party yet.</p>;

  return (
    <div className="party">
      {party.map((creature, index) => {
        const stats = computeStats(speciesById(creature.speciesId), creature);
        const fainted = creature.hp <= 0;
        const Tag = onSelect ? "button" : onInspect ? "button" : "div";
        const activate = onSelect ? () => onSelect(index) : onInspect ? () => onInspect(creature.uid) : undefined;

        return (
          <Tag
            key={creature.uid}
            className={`card${index === activeIndex ? " active" : ""}${fainted ? " fainted" : ""}`}
            onClick={activate}
            disabled={onSelect ? fainted || index === activeIndex : undefined}
            type={activate ? "button" : undefined}
            title={onInspect && !onSelect ? "Look at it" : undefined}
          >
            <Sprite speciesId={creature.speciesId} variantId={creature.variantId} size={44} faint={fainted} />
            <div className="cardBody">
              <div className="cardTop">
                <strong>
                  {displayName(creature)} <GenderMark gender={creature.gender} />
                </strong>
                <span className="muted">Lv{creature.level}</span>
              </div>
              <HpBar creature={creature} />
              <div className="cardFoot">
                <span className="muted">
                  {creature.hp}/{stats.hp}
                </span>
                {creature.status ? <span className={`tag st-${creature.status}`}>{creature.status.toUpperCase()}</span> : null}
                <VariantTag variantId={creature.variantId} />
              </div>
            </div>
          </Tag>
        );
      })}
    </div>
  );
}
