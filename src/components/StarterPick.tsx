"use client";

import { species as speciesById } from "@/engine/dex";
import { STAT_IDS } from "@/engine/types";
import type { World } from "@/engine/world";
import { typeColor } from "@/render/palette";
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
 * The six starters this world offers.
 *
 * Drawn from every three-stage line in the manifest and shuffled by the world
 * seed, so each seed offers a different six — and everyone playing that seed
 * is offered exactly the same six, which is what makes a shared-seed
 * tournament fair.
 */
export function StarterPick({ world, onPick }: { world: World; onPick: (index: number) => void }) {
  return (
    <section className="starters">
      <header className="pageHead">
        <h2>Choose a partner</h2>
        <p className="muted">
          Seed <code>{world.seed}</code> deals these six. Anyone else on this seed is offered the same.
        </p>
      </header>

      <div className="starterGrid">
        {world.starters.map((id, index) => {
          const entry = speciesById(id);
          const total = STAT_IDS.reduce((sum, stat) => sum + entry.base[stat], 0);

          return (
            <button key={id} type="button" className="starterCard" onClick={() => onPick(index)}>
              <Sprite speciesId={id} variantId="normal" size={128} />
              <h3>{entry.name}</h3>
              <div className="types">
                {entry.types.map((type) => (
                  <span key={type} className="typePill" style={{ background: typeColor(type) }}>
                    {type}
                  </span>
                ))}
              </div>
              <dl className="statGrid">
                {STAT_IDS.map((stat) => (
                  <div key={stat}>
                    <dt>{STAT_LABELS[stat]}</dt>
                    <dd>{entry.base[stat]}</dd>
                  </div>
                ))}
              </dl>
              <p className="muted total">Total {total}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
