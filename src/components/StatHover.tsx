"use client";

import { abilitiesOf, typesWith } from "@/engine/abilities";
import { isItem, item } from "@/engine/items";
import { species as speciesById } from "@/engine/dex";
import { effortSpent, effortYield } from "@/engine/effort";
import { GENDER_NAMES } from "@/engine/gender";
import { computeStats, EV_MAX_PER_STAT, EV_MAX_TOTAL, IV_MAX, ivTotal, natureTerms } from "@/engine/stats";
import { STAT_IDS, type Individual } from "@/engine/types";
import { isSpecial, variant } from "@/engine/variants";
import type { Combatant } from "@/engine/battle";
import { describeMod, sideMods, type StatMod } from "@/lib/mods";
import { displayName } from "@/lib/narrate";
import { typeColor } from "@/render/palette";
import { AbilityMark } from "./Handbook";

/** "Atk", "Atk and Spe", "HP, Atk and Spe" — never "Atk and Spe and HP". */
function listOf(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "nothing";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** One Mod cell: the stage as the sheet writes a nature, a split number, a half. */
function ModCell({ mod }: { mod?: StatMod }) {
  if (!mod) return <td className="muted">—</td>;
  const { text, tone, title } = describeMod(mod);
  return (
    <td className={tone === "up" ? "up" : tone === "down" ? "down" : undefined} title={title}>
      {text}
    </td>
  );
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
export function StatHover({
  creature,
  title,
  side,
  owned,
}: {
  creature: Individual;
  title?: string;
  /** Every ability something of yours carries, for the mark beside each one. */
  owned?: ReadonlySet<string>;
  /**
   * The side it is standing on, in a battle. What the battle is doing to
   * these numbers — stages, a split, a paralysis — is a fact about the slot
   * rather than the creature, and the Mod column is drawn only when there is
   * one and something has touched it. The starter card has no side and no
   * column.
   */
  side?: Combatant;
}) {
  const entry = speciesById(creature.speciesId);
  const mods = side ? sideMods(side) : null;
  const stats = computeStats(entry, creature);
  const nature = natureTerms(creature);
  const form = variant(creature.variantId);
  const spent = effortSpent(creature.evs);
  const yielded = effortYield(creature.speciesId);

  return (
    <div className="statHover" role="note">
      <p className="detailHead">
        {title ?? displayName(creature)} · Lv{creature.level} · {GENDER_NAMES[creature.gender]}
      </p>

      <div className="types">
        {typesWith(creature.abilities, entry.types).map((type) => (
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
            {mods ? <th>Mod</th> : null}
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
              {mods ? <ModCell mod={mods[stat]} /> : null}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="muted">
        Base {STAT_IDS.reduce((sum, stat) => sum + entry.base[stat], 0)} · IV {ivTotal(creature.ivs)}/
        {IV_MAX * STAT_IDS.length} · EV {spent}/{EV_MAX_TOTAL}
      </p>
      <p className="muted">
        Beating one is worth {yielded.amount} {listOf(yielded.stats.map((s) => STAT_LABELS[s]))}.
      </p>
      <p className="muted">Knows {creature.moves.join(", ")}.</p>
      {/* What it is carrying, and what that does — a starter can arrive holding
          something, and it is part of the choice. */}
      {creature.heldItem && isItem(creature.heldItem) ? (
        <p>
          Holding <strong>{item(creature.heldItem).name}</strong> — <span className="muted">{item(creature.heldItem).blurb}</span>
        </p>
      ) : null}
      {abilitiesOf(creature.abilities).map((spec) => (
        <p key={spec.id} className="good">
          {owned ? <AbilityMark had={owned.has(spec.id)} /> : null}
          <strong>{spec.name}</strong> — {spec.blurb}
        </p>
      ))}
    </div>
  );
}
