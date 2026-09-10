"use client";

import { useState } from "react";
import { activeOf, type BattleAction, type BattleState, type SideIndex } from "@/engine/battle";
import { move as moveById, species as speciesById, type MoveEntry } from "@/engine/dex";
import { displayPower } from "@/engine/moves";
import { anyPp, ppLeft, maxPp } from "@/engine/pp";
import { computeStats } from "@/engine/stats";
import type { Individual } from "@/engine/types";
import { displayName, narrate } from "@/lib/narrate";
import { typeColor } from "@/render/palette";
import { GenderMark, HpBar, PartyStrip, TeamBalls, VariantTag } from "./PartyStrip";
import { EvolutionScene } from "./EvolutionScene";
import { MoveNote } from "./MoveNote";
import { StatHover } from "./StatHover";
import { Sprite } from "./Sprite";

/**
 * One battle view for both kinds of battle.
 *
 * A duel and a wild encounter differ in what you are allowed to do — no balls,
 * no running from a person — and in which side you are driving. Everything
 * else is the same, and keeping this one component is the UI half of keeping
 * it one engine.
 */

/**
 * What to print on a move button.
 *
 * Thirty-nine moves in the manifest have no power of their own — their damage
 * is computed from the battle — so printing `move.power` showed "0 pow" and
 * read as a bug. The ones with an honest stand-in show it; the rest say so.
 */
function powerText(entry: MoveEntry): string {
  if (entry.category === "status") return "status";
  const shown = displayPower(entry);
  return shown === null ? "power varies" : `${shown} pow`;
}

function Nameplate({
  creature,
  team,
  active,
  right,
}: {
  creature: Individual;
  /** Everything this side can still send out, for the row of balls. */
  team: readonly Individual[];
  active: number;
  right?: boolean;
}) {
  const stats = computeStats(speciesById(creature.speciesId), creature);
  return (
    <div className={`plate${right ? " right" : ""}`}>
      <div className="plateTop">
        <strong>
          {displayName(creature)} <GenderMark gender={creature.gender} />
        </strong>
        <span className="muted">Lv{creature.level}</span>
      </div>
      <TeamBalls team={team} active={active} />
      <HpBar creature={creature} />
      <div className="plateFoot">
        <span className="muted">
          {creature.hp}/{stats.hp}
        </span>
        {creature.status ? <span className={`tag st-${creature.status}`}>{creature.status.toUpperCase()}</span> : null}
        <VariantTag variantId={creature.variantId} />
      </div>
    </div>
  );
}

export function BattleView({
  battle,
  role,
  onAction,
  balls,
  opponentLabel = "Wild",
  busy = false,
  busyLabel,
  footer,
}: {
  battle: BattleState;
  /** The side we are driving. */
  role: SideIndex;
  onAction: (action: BattleAction) => void;
  /** Omitted in a duel: there is nothing to catch and nowhere to run. */
  balls?: number;
  opponentLabel?: string;
  /** True while we are waiting on somebody else and must not act. */
  busy?: boolean;
  busyLabel?: string;
  /** Shown in place of the action buttons once the battle is decided. */
  footer?: React.ReactNode;
}) {
  const [switching, setSwitching] = useState(false);

  // An evolution to show, if this turn produced one and it has not been sat
  // through yet. Keyed by the battle and the turn it happened on, so the same
  // one is never shown twice and a later one is never missed.
  const [evolvedKey, setEvolved] = useState<string | null>(null);
  const evolving = (() => {
    const event = battle.events.find(
      (one) => one.t === "exp" && one.evolved && one.evolvedFrom,
    );
    if (!event || event.t !== "exp" || !event.evolved || !event.evolvedFrom) return null;

    const key = `${battle.tag}:${battle.turn}:${event.evolved}`;
    return evolvedKey === key ? null : { key, from: event.evolvedFrom, to: event.evolved };
  })();

  const them: SideIndex = role === 0 ? 1 : 0;
  const player = activeOf(battle, role);
  const foe = activeOf(battle, them);
  const mustSwitch = battle.awaitingSwitch[role];
  const ourTeam = battle.sides[role].team;
  const theirTeam = battle.sides[them].team;
  const wildBattle = balls !== undefined;

  const lines = narrate(battle.events, (side) =>
    side === role ? displayName(player) : `${opponentLabel} ${displayName(foe)}`.trim(),
  );

  return (
    <div className="battle">
      {evolving ? (
        <EvolutionScene
          from={evolving.from}
          to={evolving.to}
          onDone={() => setEvolved(evolving.key)}
        />
      ) : null}

      <div className="field">
        {/* Hover either creature for its full numbers. Nothing across the
            field is secret: a duel commits to a move before it is revealed,
            so reading the opponent cannot be used to cheat. */}
        <div className="slot wild hoverable" tabIndex={0}>
          <Nameplate creature={foe} team={theirTeam} active={battle.sides[them].active} />
          <Sprite speciesId={foe.speciesId} variantId={foe.variantId} size={148} faint={foe.hp <= 0} />
          <StatHover creature={foe} />
        </div>
        <div className="slot mine hoverable" tabIndex={0}>
          <Sprite speciesId={player.speciesId} variantId={player.variantId} size={148} flip faint={player.hp <= 0} />
          <Nameplate creature={player} team={ourTeam} active={battle.sides[role].active} right />
          <StatHover creature={player} />
        </div>
      </div>

      <div className="log">
        {lines.length ? (
          lines.map((line, i) => <p key={i}>{line}</p>)
        ) : (
          <p className="muted">
            {opponentLabel} {displayName(foe)} is out!
          </p>
        )}
      </div>

      {footer ? (
        <div className="actions">{footer}</div>
      ) : busy ? (
        <div className="actions">
          <p className="prompt">{busyLabel ?? "Waiting…"}</p>
        </div>
      ) : mustSwitch || switching ? (
        <div className="actions">
          <p className="prompt">{mustSwitch ? "Send out who?" : "Switch to who?"}</p>
          <PartyStrip
            party={ourTeam}
            activeIndex={battle.sides[role].active}
            onSelect={(index) => {
              setSwitching(false);
              onAction({ t: "switch", partyIndex: index });
            }}
          />
          {mustSwitch ? null : (
            <button type="button" className="ghost" onClick={() => setSwitching(false)}>
              Back
            </button>
          )}
        </div>
      ) : (
        <div className="actions">
          <div className="moves">
            {player.moves.map((moveId, index) => {
              const entry = moveById(moveId);
              const left = ppLeft(player, index);
              return (
                <button
                  key={moveId}
                  type="button"
                  className={`moveBtn${left === 0 ? " spent" : ""}`}
                  style={{ borderLeftColor: typeColor(entry.type) }}
                  disabled={left === 0}
                  title={left === 0 ? `${entry.name} has no uses left` : undefined}
                  onClick={() => onAction({ t: "fight", moveIndex: index })}
                >
                  <span className="moveName">{entry.name}</span>
                  <span className="moveMeta">
                    {entry.type} · {powerText(entry)}
                  </span>
                  {/* Uses left, on the button rather than in the tooltip: it
                      is the number that decides whether you can press it. */}
                  <span className={`movePp${left <= Math.ceil(maxPp(moveId) / 4) ? " low" : ""}`}>
                    {left}/{maxPp(moveId)}
                  </span>
                  {/* The rest of it, including how it lands on whatever is
                      actually standing there. */}
                  <MoveNote moveId={moveId} against={speciesById(foe.speciesId).types} />
                </button>
              );
            })}
          </div>

          {/* Only when it is the only thing left. A creature with anything in
              the tank is refused it by the engine, so offering it would be a
              button that throws. */}
          {!anyPp(player) ? (
            <button
              type="button"
              className="moveBtn spentAll"
              onClick={() => onAction({ t: "struggle" })}
            >
              <span className="moveName">Struggle</span>
              <span className="moveMeta">nothing left · hurts you too</span>
            </button>
          ) : null}
          <div className="row">
            {wildBattle ? (
              <button type="button" onClick={() => onAction({ t: "ball" })} disabled={balls <= 0}>
                Throw ball ({balls})
              </button>
            ) : null}
            <button type="button" onClick={() => setSwitching(true)} disabled={ourTeam.length < 2}>
              Switch
            </button>
            {wildBattle ? (
              <button type="button" className="ghost" onClick={() => onAction({ t: "flee" })}>
                Run
              </button>
            ) : null}
          </div>
          <p className="hint">
            Keys: <kbd>1</kbd>–<kbd>4</kbd> moves
            {wildBattle ? (
              <>
                {" · "}
                <kbd>B</kbd> ball · <kbd>R</kbd> run
              </>
            ) : null}
          </p>
        </div>
      )}
    </div>
  );
}
