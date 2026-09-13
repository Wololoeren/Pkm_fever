"use client";

import { maxHp } from "@/engine/battle";
import { abilitiesOf } from "@/engine/abilities";
import { item } from "@/engine/items";
import { maxPp, ppLeft } from "@/engine/pp";
import { expForLevel, MAX_LEVEL } from "@/engine/progression";
import { species as speciesById } from "@/engine/dex";
import { computeStats } from "@/engine/stats";
import { GENDER_NAMES, GENDER_SYMBOLS } from "@/engine/gender";
import type { Gender, Individual } from "@/engine/types";
import { chroma, isSpecial, TOP_TIER, variant } from "@/engine/variants";
import { swatchFor } from "@/render/palette";
import { displayName } from "@/lib/narrate";
import type { Egg } from "@/engine/breeding";
import { EggSprite, Sprite } from "./Sprite";

export function hpClass(current: number, max: number): string {
  const share = max > 0 ? current / max : 0;
  if (share <= 0.2) return "hp low";
  if (share <= 0.5) return "hp mid";
  return "hp";
}

/**
 * How far into the level it is.
 *
 * Thin on purpose, and above the health bar rather than beside it: health is
 * the number you read in a battle and experience is the one you read between
 * them, so they should not compete. At the cap it is simply full — a bar that
 * empties itself at level 100 would be reporting a countdown to nothing.
 */
export function ExpBar({ creature }: { creature: Individual }) {
  const floor = expForLevel(creature.level);
  const ceiling = creature.level >= MAX_LEVEL ? floor : expForLevel(creature.level + 1);
  const span = ceiling - floor;
  const share = span > 0 ? Math.max(0, Math.min(1, (creature.exp - floor) / span)) : 1;

  return (
    <div
      className="expTrack"
      title={
        creature.level >= MAX_LEVEL
          ? "At the level cap"
          : `${ceiling - creature.exp} experience to level ${creature.level + 1}`
      }
    >
      <div className="expFill" style={{ width: `${share * 100}%` }} />
    </div>
  );
}

/**
 * How many are left on a side, as balls above the health bar.
 *
 * A health bar says how the creature in front of you is doing and nothing at
 * all about how long the fight has left to run. One ball per team member says
 * both at a glance: six of them means settle in, one means this is the last
 * of them. Beaten ones grey out where they stand rather than disappearing,
 * because a row that shrinks has to be counted, and a row that stays put can
 * simply be read.
 *
 * Nothing is drawn for a team of one. A single ball over a wild creature
 * would be reporting a fact nobody was in any doubt about.
 */
export function TeamBalls({ team, active }: { team: readonly Individual[]; active?: number }) {
  if (team.length < 2) return null;

  const standing = team.filter((one) => one.hp > 0).length;
  const label = `${standing} of ${team.length} still standing`;

  return (
    <div className="ballRow" title={label} aria-label={label}>
      {team.map((one, index) => (
        <span
          key={index}
          className={`ball${one.hp <= 0 ? " out" : ""}${index === active ? " here" : ""}`}
        />
      ))}
    </div>
  );
}

/**
 * How much fight it has left, as one number.
 *
 * Four separate counts is four things to read; the sum is the question a
 * player is actually asking before they walk into more grass. The breakdown
 * is on the battle buttons and in the stat screen, where there is room for it.
 */
/**
 * What this one can do that its species cannot.
 *
 * Nothing at all for nine creatures in ten, which is why it renders to nothing
 * rather than to "none": a row that says "no abilities" on every card is a row
 * that stops being read, and the whole value of an ability here is that seeing
 * one is a surprise.
 */
export function AbilityTags({ creature }: { creature: Individual }) {
  const held = abilitiesOf(creature.abilities);
  if (!held.length) return null;

  return (
    <>
      {held.map((spec) => (
        <span key={spec.id} className="tag ability" title={spec.blurb}>
          {spec.name}
        </span>
      ))}
    </>
  );
}

/**
 * What it is carrying, if anything.
 *
 * Renders to nothing when it is carrying nothing, for the same reason
 * `AbilityTags` does: a row that says "holding: nothing" on every card is a
 * row nobody reads twice. The title carries the blurb, because the whole
 * question a player has about a held item is what it is doing.
 */
export function HeldTag({ creature }: { creature: Individual }) {
  if (!creature.heldItem) return null;
  const spec = item(creature.heldItem);

  return (
    <span className="tag held" title={spec.blurb}>
      {spec.name}
    </span>
  );
}

export function PpTotal({ creature }: { creature: Individual }) {
  const left = creature.moves.reduce((sum, _, at) => sum + ppLeft(creature, at), 0);
  const full = creature.moves.reduce((sum, moveId) => sum + maxPp(moveId), 0);
  if (!full) return null;

  return (
    <span
      className={`ppTotal${left === 0 ? " out" : left * 4 <= full ? " low" : ""}`}
      title={`${left} of ${full} move uses left — restored at the centre, or by losing`}
    >
      {left}/{full} PP
    </span>
  );
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

/**
 * The eggs being carried, each in the party slot it is taking up.
 *
 * Shown with the party and in the bag: the party is where the slot goes, the
 * bag is where you would look for something you picked up. Nothing to press —
 * you walk, and an egg opens when it is ready.
 *
 * How long is a surprise. No count and no bar: only a line that changes as it
 * gets closer, the way the handhelds let you hold an egg up to your ear.
 */
function eggMood(egg: Egg): string {
  if (egg.steps === 0) return "It's hatching!";
  const left = egg.steps / egg.total;
  if (left > 0.66) return "What will hatch from this? It will take some time.";
  if (left > 0.33) return "It moves around inside sometimes.";
  if (left > 0.1) return "It's making sounds inside.";
  return "It's close to hatching!";
}

export function EggSlots({ eggs }: { eggs: readonly Egg[] }) {
  if (!eggs.length) return null;
  return (
    <div className="eggs">
      {eggs.map((egg, index) => (
        <div key={index} className="eggCard">
          <EggSprite variantId={egg.creature.variantId} size={48} />
          <div className="eggInfo">
            <span className="itemName">Egg</span>
            <span className="muted itemBlurb">{eggMood(egg)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The battle's own team as the panel beside the field, for a battle whose page
 * has no party to hand in — a duel or a bracket match, where what you brought
 * is the team, at the health it has in the battle.
 */
export function teamPanel(team: Individual[], activeIndex: number) {
  return function TeamPanel(choosing: ((index: number) => void) | null) {
    return (
      <section className={`panel${choosing ? " choosing" : ""}`}>
        <h3>{choosing ? "Send out who?" : "Team"}</h3>
        <PartyStrip party={team} activeIndex={activeIndex} onSelect={choosing ?? undefined} />
      </section>
    );
  };
}

export function PartyStrip({
  party,
  activeIndex,
  onSelect,
  onInspect,
  onReorder,
}: {
  party: Individual[];
  activeIndex?: number;
  onSelect?: (index: number) => void;
  /** Opens the full sheet. Separate from onSelect, which switches in battle. */
  onInspect?: (uid: number) => void;
  /**
   * Moves a member to another slot. Given wherever the party is shown and
   * reordering is legal, so the order can be set from any of them — slot zero
   * is who walks into the next fight, which is not a decision that belongs to
   * one screen.
   */
  onReorder?: (from: number, to: number) => void;
}) {
  if (!party.length) return <p className="muted">Nothing in your party yet.</p>;

  return (
    <div className="party">
      {party.map((creature, index) => {
        const stats = computeStats(speciesById(creature.speciesId), creature);
        const fainted = creature.hp <= 0;
        const Tag = onSelect ? "button" : onInspect ? "button" : "div";
        const activate = onSelect ? () => onSelect(index) : onInspect ? () => onInspect(creature.uid) : undefined;

        const card = (
          <Tag
            key={creature.uid}
            className={`card${index === activeIndex ? " active" : ""}${fainted ? " fainted" : ""}`}
            onClick={activate}
            disabled={onSelect ? fainted || index === activeIndex : undefined}
            type={activate ? "button" : undefined}
            title={onInspect && !onSelect ? "Look at it" : undefined}
          >
            {/* The number that sends it out, while a switch is being chosen. */}
            {onSelect ? <kbd className="cardKey">{index + 1}</kbd> : null}
            <Sprite speciesId={creature.speciesId} variantId={creature.variantId} size={48} faint={fainted} />
            <div className="cardBody">
              <div className="cardTop">
                <strong>
                  {displayName(creature)} <GenderMark gender={creature.gender} />
                </strong>
                <span className="muted">Lv{creature.level}</span>
              </div>
              <ExpBar creature={creature} />
              <HpBar creature={creature} />
              <div className="cardFoot">
                <span className="muted">
                  {creature.hp}/{stats.hp}
                </span>
                <PpTotal creature={creature} />
                {creature.status ? <span className={`tag st-${creature.status}`}>{creature.status.toUpperCase()}</span> : null}
                <VariantTag variantId={creature.variantId} />
                <HeldTag creature={creature} />
                <AbilityTags creature={creature} />
              </div>
            </div>
          </Tag>
        );

        if (!onReorder) return card;

        // The arrows sit beside the card rather than inside it: the card is a
        // <button> whenever it does anything, and a button inside a button is
        // not a thing a browser will agree to render.
        return (
          <div key={creature.uid} className="partyRow">
            {card}
            <div className="orderButtons">
              <button
                type="button"
                aria-label={`Move ${displayName(creature)} up`}
                title="Move up"
                disabled={index === 0}
                onClick={() => onReorder(index, index - 1)}
              >
                ▲
              </button>
              <button
                type="button"
                aria-label={`Move ${displayName(creature)} down`}
                title="Move down"
                disabled={index === party.length - 1}
                onClick={() => onReorder(index, index + 1)}
              >
                ▼
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
