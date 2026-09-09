"use client";

import { species as speciesById } from "@/engine/dex";
import { offeredStarter } from "@/engine/engine";
import { natureVector } from "@/engine/natures";
import { computeStats, IV_MAX, ivTotal } from "@/engine/stats";
import { STAT_IDS, type Individual } from "@/engine/types";
import { isSpecial, variant } from "@/engine/variants";
import type { World } from "@/engine/world";
import { typeColor } from "@/render/palette";
import { GenderMark, VariantTag } from "./PartyStrip";
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
              <Sprite speciesId={id} variantId={creature.variantId} size={128} />
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

              <StarterDetail creature={creature} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The numbers behind the card, on hover.
 *
 * Base stats are the species; these are the creature. A seed deals its own
 * IVs, its own nature and its own appearance, and those move the level-five
 * numbers enough that two cards showing the same species are not the same
 * offer — which is the whole reason to look before choosing.
 */
function StarterDetail({ creature }: { creature: Individual }) {
  const stats = computeStats(speciesById(creature.speciesId), creature);
  const nature = natureVector(creature.natureId);
  const form = variant(creature.variantId);

  return (
    <div className="starterDetail" role="note">
      <p className="detailHead">
        Level {creature.level} · {creature.natureId}
        {isSpecial(creature.variantId) ? ` · ${form.name}` : ""}
      </p>

      <table className="detailTable">
        <thead>
          <tr>
            <th>Stat</th>
            <th>Now</th>
            <th>IV</th>
            <th>Nature</th>
          </tr>
        </thead>
        <tbody>
          {STAT_IDS.map((stat) => (
            <tr key={stat}>
              <th scope="row">{STAT_LABELS[stat]}</th>
              <td>{stats[stat]}</td>
              <td>{creature.ivs[stat]}</td>
              <td className={nature[stat] > 0 ? "up" : nature[stat] < 0 ? "down" : "muted"}>
                {nature[stat] === 0 ? "—" : nature[stat] > 0 ? `+${nature[stat]}` : nature[stat]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="muted">
        IV total {ivTotal(creature.ivs)} of {IV_MAX * STAT_IDS.length}. A starter rolls low on
        purpose — breeding is the way up.
      </p>
      <p className="muted">Knows {creature.moves.map((id) => id).join(", ")}.</p>
    </div>
  );
}
