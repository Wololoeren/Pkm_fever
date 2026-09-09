"use client";

import { species as speciesById } from "@/engine/dex";
import { effortSpent, effortYield } from "@/engine/effort";
import { GENDER_NAMES } from "@/engine/gender";
import { natureVector } from "@/engine/natures";
import { computeStats, EV_MAX_PER_STAT, EV_MAX_TOTAL, IV_MAX, ivTotal } from "@/engine/stats";
import { STAT_IDS, type Individual } from "@/engine/types";
import { isSpecial, variant } from "@/engine/variants";
import { displayName } from "@/lib/narrate";
import { typeColor } from "@/render/palette";

/** "Atk", "Atk and Spe", "HP, Atk and Spe" — never "Atk and Spe and HP". */
function listOf(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "nothing";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const STAT_LABELS: Record<string, string> = {
  hp: "HP",
  atk: "Atk",
  def: "Def",
  spa: "SpA",
  spd: "SpD",
  spe: "Spe",
};

/**
 * Everything true about one creature, on hover.
 *
 * One component for the starter you are being offered and the creature trying
 * to knock yours over, because "what am I looking at" is the same question in
 * both places and two implementations of it would drift within a week.
 *
 * Nothing here is hidden from an opponent. A duel already shows open team
 * sheets — the protocol commits to moves before revealing them, so knowing
 * what is across from you cannot be used to cheat — and against a wild
 * creature the whole design says its numbers were fixed when the world was
 * made. There is nothing to protect by making a player guess.
 */
export function StatHover({ creature, title }: { creature: Individual; title?: string }) {
  const entry = speciesById(creature.speciesId);
  const stats = computeStats(entry, creature);
  const nature = natureVector(creature.natureId);
  const form = variant(creature.variantId);
  const spent = effortSpent(creature.evs);
  const yielded = effortYield(creature.speciesId);

  return (
    <div className="statHover" role="note">
      <p className="detailHead">
        {title ?? displayName(creature)} · Lv{creature.level} · {GENDER_NAMES[creature.gender]}
      </p>

      <div className="types">
        {entry.types.map((type) => (
          <span key={type} className="typePill" style={{ background: typeColor(type) }}>
            {type}
          </span>
        ))}
      </div>

      <p className="muted">
        {creature.natureId}
        {isSpecial(creature.variantId) ? ` · ${form.name}` : ""}
      </p>

      <table className="detailTable">
        <thead>
          <tr>
            <th>Stat</th>
            <th>Now</th>
            <th>Base</th>
            <th>IV</th>
            <th>EV</th>
            <th>Nat</th>
          </tr>
        </thead>
        <tbody>
          {STAT_IDS.map((stat) => (
            <tr key={stat}>
              <th scope="row">{STAT_LABELS[stat]}</th>
              <td>{stats[stat]}</td>
              <td className="muted">{entry.base[stat]}</td>
              <td>{creature.ivs[stat]}</td>
              <td className={creature.evs[stat] >= EV_MAX_PER_STAT ? "up" : undefined}>
                {creature.evs[stat]}
              </td>
              <td className={nature[stat] > 0 ? "up" : nature[stat] < 0 ? "down" : "muted"}>
                {nature[stat] === 0 ? "—" : nature[stat] > 0 ? `+${nature[stat]}` : nature[stat]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="muted">
        IV {ivTotal(creature.ivs)}/{IV_MAX * STAT_IDS.length} · EV {spent}/{EV_MAX_TOTAL}
      </p>
      <p className="muted">
        Beating one is worth {yielded.amount} {listOf(yielded.stats.map((s) => STAT_LABELS[s]))}.
      </p>
      <p className="muted">Knows {creature.moves.join(", ")}.</p>
    </div>
  );
}
