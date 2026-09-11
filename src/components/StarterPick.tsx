"use client";

import { species as speciesById } from "@/engine/dex";
import { offeredStarter } from "@/engine/engine";
import { STAT_IDS } from "@/engine/types";
import { isSpecial } from "@/engine/variants";
import type { World } from "@/engine/world";
import { typeColor } from "@/render/palette";
import { GenderMark, VariantTag } from "./PartyStrip";
import { StatHover } from "./StatHover";
import { Sprite } from "./Sprite";

const STAT_LABELS: Record<string, string> = {
  hp: "HP",
  atk: "Atk",
  def: "Def",
  spa: "SpA",
  spd: "SpD",
  spe: "Spe",
};

/**
 * The starters this world offers.
 *
 * One grass, one fire and one water, drawn from the real starter trios by the
 * world seed — so each seed offers a different three, and everyone playing
 * that seed is offered exactly the same three, which is what makes a
 * shared-seed tournament fair.
 *
 * The card shows the creature you would actually get, not its species. That
 * distinction cost a real bug: the sprite here was hard-coded to the ordinary
 * palette, so the appearance the seed had already rolled only became visible
 * *after* choosing — forty rerolls could walk past a chroma starter without
 * one of them ever saying so.
 */
export function StarterPick({ world, onPick }: { world: World; onPick: (index: number) => void }) {
  return (
    <section className="starters">
      <header className="pageHead">
        <h2>Choose a partner</h2>
        <p className="muted">
          Seed <code>{world.seed}</code> deals these {world.starters.length}. Anyone else on this
          seed is offered the same. Hover a card for its full numbers.
        </p>
      </header>

      <div className="starterGrid">
        {world.starters.map((id, index) => {
          const entry = speciesById(id);
          const creature = offeredStarter(world, index);
          const total = STAT_IDS.reduce((sum, stat) => sum + entry.base[stat], 0);

          return (
            <button key={id} type="button" className="starterCard" onClick={() => onPick(index)}>
              {/* The art is 96 pixels square, so this is drawn at its own size.
                  Doubling it adds no detail — it only makes every pixel four
                  times as obvious, and it pushed the numbers below the fold on
                  a laptop, which is the one screen where the numbers are the
                  reason you are looking. */}
              <Sprite speciesId={id} variantId={creature.variantId} size={96} />
              <h3>
                {entry.name} <GenderMark gender={creature.gender} />
              </h3>
              <div className="types">
                {entry.types.map((type) => (
                  <span key={type} className="typePill" style={{ background: typeColor(type) }}>
                    {type}
                  </span>
                ))}
              </div>
              {isSpecial(creature.variantId) && (
                <div className="types">
                  <VariantTag variantId={creature.variantId} />
                </div>
              )}
              <dl className="statGrid">
                {STAT_IDS.map((stat) => (
                  <div key={stat}>
                    <dt>{STAT_LABELS[stat]}</dt>
                    <dd>{entry.base[stat]}</dd>
                  </div>
                ))}
              </dl>
              <p className="muted total">Base total {total}</p>

              <StatHover creature={creature} title={entry.name} />
            </button>
          );
        })}
      </div>
    </section>
  );
}
