"use client";

import { learnableAt, move as moveById, species as speciesById } from "@/engine/dex";
import { MAX_MOVES, movesRefusal, type GameState, type Input } from "@/engine/engine";
import { natureVector } from "@/engine/natures";
import { computeStats, EV_MAX_PER_STAT, EV_MAX_TOTAL, IV_MAX, ivTotal } from "@/engine/stats";
import { effortSpent } from "@/engine/effort";
import { expForLevel, levelFromExp } from "@/engine/progression";
import { STAT_IDS, type Individual, type StatId } from "@/engine/types";
import { isSpecial, variant } from "@/engine/variants";
import { displayName } from "@/lib/narrate";
import { typeColor } from "@/render/palette";
import { GenderMark } from "./PartyStrip";
import type { World } from "@/engine/world";
import { InfoDot } from "./InfoDot";
import { Sprite } from "./Sprite";

/**
 * Everything about one creature, and the one thing you can change about it.
 *
 * The stat table is the point. Three separate systems feed each number — the
 * IV, the nature's vector, the variant's multiplier — and until you can see
 * them side by side there is no way to tell a well-bred creature from a lucky
 * one, or to understand why a nature you were told matters seems not to.
 */

const STAT_LABELS: Record<StatId, string> = {
  hp: "HP",
  atk: "Attack",
  def: "Defense",
  spa: "Sp. Atk",
  spd: "Sp. Def",
  spe: "Speed",
};

function MoveRow({
  moveId,
  chosen,
  disabled,
  onToggle,
}: {
  moveId: string;
  chosen: boolean;
  disabled: boolean;
  onToggle?: () => void;
}) {
  const entry = moveById(moveId);
  const Tag = onToggle ? "button" : "div";

  return (
    <Tag
      className={`moveRow${chosen ? " on" : ""}`}
      style={{ borderLeftColor: typeColor(entry.type) }}
      onClick={onToggle}
      disabled={onToggle ? disabled : undefined}
      type={onToggle ? "button" : undefined}
    >
      <span className="moveName">{entry.name}</span>
      <span className="moveMeta">
        {entry.type} · {entry.category}
        {entry.category === "status" ? "" : ` · ${entry.power || "—"} pow`}
        {entry.accuracy ? ` · ${entry.accuracy}%` : " · never misses"}
      </span>
      {chosen ? <span className="muted">✓</span> : null}
    </Tag>
  );
}

export function Inspect({
  world,
  creature,
  index,
  state,
  onInput,
  onClose,
}: {
  world: World;
  creature: Individual;
  /** Party index, or -1 for anything not in the party. */
  index: number;
  state: GameState;
  onInput: (input: Input) => void;
  onClose: () => void;
}) {
  const entry = speciesById(creature.speciesId);
  const stats = computeStats(entry, creature);
  const nature = natureVector(creature.natureId);
  const form = variant(creature.variantId);

  const pool = learnableAt(creature.speciesId, creature.level).sort((a, b) =>
    moveById(a).name < moveById(b).name ? -1 : 1,
  );
  const editable = index >= 0 && movesRefusal(world, state, index, creature.moves) === null;

  const toggle = (moveId: string) => {
    const next = creature.moves.includes(moveId)
      ? creature.moves.filter((id) => id !== moveId)
      : [...creature.moves, moveId];
    if (movesRefusal(world, state, index, next)) return;
    onInput({ t: "setMoves", index, moves: next });
  };

  const toNext = creature.level < 100 ? expForLevel(creature.level + 1) - creature.exp : 0;

  return (
    <div className="cheatBackdrop" role="dialog" aria-label={`${displayName(creature)} details`}>
      <section className="cheatPanel">
        <header className="cheatHead">
          <div className="row">
            <Sprite speciesId={creature.speciesId} variantId={creature.variantId} size={72} />
            <div>
              <h2>
                {displayName(creature)} <GenderMark gender={creature.gender} />{" "}
                <span className="muted">Lv{creature.level}</span>
              </h2>
              <div className="types">
                {entry.types.map((type) => (
                  <span key={type} className="typePill" style={{ background: typeColor(type) }}>
                    {type}
                  </span>
                ))}
                {creature.traded ? <span className="tag">TRADED</span> : null}
              </div>
              <p className="muted eggLine">
                {entry.eggGroups.includes("Undiscovered")
                  ? "Egg group: none — this one cannot breed at all."
                  : `Egg group${entry.eggGroups.length > 1 ? "s" : ""}: ${entry.eggGroups.join(", ")}`}
              </p>
            </div>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </header>

        <h3>
          Stats
          <InfoDot label="What these columns mean">
            <p className="muted">
              Nature <strong>{creature.natureId}</strong> — an additive vector, not a multiplier, so
              what it is worth is the same on every creature and shows in the column above.
            </p>
            <p className="muted">
              IV total <strong>{ivTotal(creature.ivs)}</strong> of {IV_MAX * STAT_IDS.length}. A wild
              catch rolls 0–6 per stat; anything higher was bred for.
            </p>
            <p className="muted">
              Effort <strong>{effortSpent(creature.evs)}</strong> of {EV_MAX_TOTAL}, at most{" "}
              {EV_MAX_PER_STAT} in one stat. Four points are one stat point at level 100 — earned by
              what you fight rather than what you inherited, which makes it the half of a creature
              you choose.
            </p>
            {!isSpecial(creature.variantId) ? null : (
              <p className="muted">
                Form <strong>{form.name}</strong> — every stat in the table already includes its
                multiplier (
                {STAT_IDS.filter((stat) => form.mult[stat] !== 1000)
                  .map((stat) => `${STAT_LABELS[stat]} ${((form.mult[stat] - 1000) / 10).toFixed(1)}%`)
                  .join(", ") || "no change"}
                ).
              </p>
            )}
          </InfoDot>
        </h3>
        <div className="scrollX">
          <table className="statTable">
            <thead>
              <tr>
                <th>Stat</th>
                <th className="num">Base</th>
                <th className="num">IV</th>
                <th className="num">Nature</th>
                <th className="num">EV</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {STAT_IDS.map((stat) => (
                <tr key={stat}>
                  <td>{STAT_LABELS[stat]}</td>
                  <td className="num">{entry.base[stat]}</td>
                  <td className="num">
                    {creature.ivs[stat]}
                    <span className="muted">/{IV_MAX}</span>
                  </td>
                  <td className={`num ${nature[stat] > 0 ? "good" : nature[stat] < 0 ? "error" : "muted"}`}>
                    {stat === "hp" ? "—" : nature[stat] > 0 ? `+${nature[stat]}` : nature[stat] || "0"}
                  </td>
                  <td className="num muted">{creature.evs[stat]}</td>
                  <td className="num strong">{stats[stat]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="factLines">
          <p className="muted">
            Nature <strong>{creature.natureId}</strong> · IV{" "}
            <strong>{ivTotal(creature.ivs)}</strong>/{IV_MAX * STAT_IDS.length} · Effort{" "}
            <strong>{effortSpent(creature.evs)}</strong>/{EV_MAX_TOTAL}
            {isSpecial(creature.variantId) ? ` · ${form.name}` : ""}
          </p>
          <p className="muted">
            {creature.level < 100
              ? `${toNext} experience to level ${creature.level + 1}.`
              : "At the level cap."}
            {creature.parents ? " Hatched from an egg." : ""}
            {levelFromExp(creature.exp) !== creature.level ? " (experience and level disagree)" : ""}
          </p>
        </div>

        <h3>
          Moves · {creature.moves.length}/{MAX_MOVES}
        </h3>
        {index < 0 ? (
          <p className="muted">Bring it into the party to rearrange its moves.</p>
        ) : editable ? (
          <p className="muted">
            Choose up to {MAX_MOVES} of everything it has learned by level {creature.level}. Only in
            town — rebuilding a moveset in front of a wild creature would make every matchup a
            formality.
          </p>
        ) : (
          <p className="hint">{movesRefusal(world, state, index, creature.moves) ?? "Not right now."}</p>
        )}

        <div className="moveList">
          {pool.map((moveId) => {
            const chosen = creature.moves.includes(moveId);
            return (
              <MoveRow
                key={moveId}
                moveId={moveId}
                chosen={chosen}
                disabled={!chosen && creature.moves.length >= MAX_MOVES}
                onToggle={editable ? () => toggle(moveId) : undefined}
              />
            );
          })}
          {pool.length ? null : <p className="muted">It has not learned anything yet.</p>}
        </div>
      </section>
    </div>
  );
}
