"use client";

import { useState } from "react";
import { activeOf, type BattleAction, type BattleState, type SideIndex } from "@/engine/battle";
import { move as moveById, species as speciesById } from "@/engine/dex";
import { computeStats } from "@/engine/stats";
import type { Individual } from "@/engine/types";
import { displayName, narrate } from "@/lib/narrate";
import { typeColor } from "@/render/palette";
import { GenderMark, HpBar, PartyStrip, VariantTag } from "./PartyStrip";
import { Sprite } from "./Sprite";

/**
 * One battle view for both kinds of battle.
 *
 * A duel and a wild encounter differ in what you are allowed to do — no balls,
 * no running from a person — and in which side you are driving. Everything
 * else is the same, and keeping this one component is the UI half of keeping
 * it one engine.
 */

function Nameplate({ creature, right }: { creature: Individual; right?: boolean }) {
  const stats = computeStats(speciesById(creature.speciesId), creature);
  return (
    <div className={`plate${right ? " right" : ""}`}>
      <div className="plateTop">
        <strong>
          {displayName(creature)} <GenderMark gender={creature.gender} />
        </strong>
        <span className="muted">Lv{creature.level}</span>
      </div>
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

  const them: SideIndex = role === 0 ? 1 : 0;
  const player = activeOf(battle, role);
  const foe = activeOf(battle, them);
  const mustSwitch = battle.awaitingSwitch[role];
  const ourTeam = battle.sides[role].team;
  const wildBattle = balls !== undefined;

  const lines = narrate(battle.events, (side) =>
    side === role ? displayName(player) : `${opponentLabel} ${displayName(foe)}`.trim(),
  );

  return (
    <div className="battle">
      <div className="field">
        <div className="slot wild">
          <Nameplate creature={foe} />
          <Sprite speciesId={foe.speciesId} variantId={foe.variantId} size={148} faint={foe.hp <= 0} />
        </div>
        <div className="slot mine">
          <Sprite speciesId={player.speciesId} variantId={player.variantId} size={148} flip faint={player.hp <= 0} />
          <Nameplate creature={player} right />
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
              return (
                <button
                  key={moveId}
                  type="button"
                  className="moveBtn"
                  style={{ borderLeftColor: typeColor(entry.type) }}
                  onClick={() => onAction({ t: "fight", moveIndex: index })}
                >
                  <span className="moveName">{entry.name}</span>
                  <span className="moveMeta">
                    {entry.type} · {entry.category === "status" ? "status" : `${entry.power} pow`}
                  </span>
                </button>
              );
            })}
          </div>
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
