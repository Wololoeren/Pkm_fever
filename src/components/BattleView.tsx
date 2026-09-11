"use client";

import { useRef, useState } from "react";
import { activeOf, type BattleAction, type BattleState, type SideIndex } from "@/engine/battle";
import { move as moveById, species as speciesById, type MoveEntry } from "@/engine/dex";
import { displayPower } from "@/engine/moves";
import { anyPp, ppLeft, maxPp } from "@/engine/pp";
import { computeStats } from "@/engine/stats";
import type { Individual } from "@/engine/types";
import { displayName, narrate } from "@/lib/narrate";
import { typeColor } from "@/render/palette";
import { GenderMark, HpBar, TeamBalls, VariantTag } from "./PartyStrip";
import { EvolutionScene } from "./EvolutionScene";
import { beatsFor } from "@/lib/beats";
import { useBeat } from "./useBeat";
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
  aside,
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
  /**
   * Who you have, shown down the left of the battle.
   *
   * Passed in rather than built here because the party panel belongs to the
   * page — it is the same one that sits under the map when you are walking, and
   * two of them would be two answers to "who is with me".
   *
   * A function rather than a node, because switching is *done in it*. It used
   * to render a second copy of the party under the battlefield to pick from,
   * which meant the same six creatures were on screen twice: once to read and
   * once to click. Handed a callback, the panel that is already there becomes
   * the thing you click, and hands back null the rest of the time.
   */
  aside?: (choosing: ((index: number) => void) | null) => React.ReactNode;
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

  // What this turn looked like, and the two elements each side animates. The
  // refs are handed to `useBeat`, which restarts on the turn number.
  const beats = beatsFor(battle.events);
  const foeSprite = useRef<HTMLSpanElement>(null);
  const foeFlash = useRef<HTMLSpanElement>(null);
  const mySprite = useRef<HTMLSpanElement>(null);
  const myFlash = useRef<HTMLSpanElement>(null);

  const them: SideIndex = role === 0 ? 1 : 0;
  const player = activeOf(battle, role);
  const foe = activeOf(battle, them);
  const mustSwitch = battle.awaitingSwitch[role];
  const ourTeam = battle.sides[role].team;
  const theirTeam = battle.sides[them].team;
  const wildBattle = balls !== undefined;

  // The foe stands top-right and lunges left; we stand bottom-left and lunge
  // right. Handed in rather than read off a class, because the direction is
  // the one thing about the animation the layout decides.
  useBeat(foeSprite, foeFlash, beats[them], battle.turn, "left");
  useBeat(mySprite, myFlash, beats[role], battle.turn, "right");

  const lines = narrate(battle.events, (side) =>
    side === role ? displayName(player) : `${opponentLabel} ${displayName(foe)}`.trim(),
  );

  const actions = (
    <>
        {footer ? (
          <div className="actions">{footer}</div>
        ) : busy ? (
          <div className="actions">
            <p className="prompt">{busyLabel ?? "Waiting…"}</p>
          </div>
        ) : mustSwitch || switching ? (
          <div className="actions">
            {/* The prompt, and nothing else. The party is already on screen to
                the left and it is now what you click — a second copy of it
                here was the same six creatures twice, once to read and once to
                press. */}
            <p className="prompt">
              {mustSwitch ? "Send out who?" : "Switch to who?"}
              <span className="promptWhere">Pick one from your party.</span>
            </p>
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
                    {/* The key that presses it. One to four already worked and
                        nothing said so, which is a shortcut nobody uses. */}
                    <span className="moveKey" aria-hidden="true">
                      {index + 1}
                    </span>
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
    </>
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

      <div className="stage">
        {/* Who you have, up the left. It used to sit a long way below the
            battle, under the bag, which meant checking what was left on the
            bench was a scroll rather than a glance. */}
        {aside ? (
          <div className="stageParty">
            {aside(
              mustSwitch || switching
                ? (index) => {
                    setSwitching(false);
                    onAction({ t: "switch", partyIndex: index });
                  }
                : null,
            )}
          </div>
        ) : null}

        <div className="stageField">
          <div className="field">
        {/* Hover either creature for its full numbers. Nothing across the
            field is secret: a duel commits to a move before it is revealed,
            so reading the opponent cannot be used to cheat. */}
            {/* Ninety-six, which is the size the art was drawn at.
                It was a hundred and ninety-two, and doubling a
                ninety-six-pixel sprite does not add a single pixel of
                detail — it only makes every one of them four times as
                large and four times as obvious. Small and sharp beats
                big and soft. */}
            <div className="slot wild hoverable" tabIndex={0}>
              <Nameplate creature={foe} team={theirTeam} active={battle.sides[them].active} />
              {/* The sprite is wrapped rather than animated directly so the
                  nameplate and the hover panel hold still while it moves — a
                  shaking health bar is unreadable. */}
              <span className="mover" ref={foeSprite}>
                <Sprite speciesId={foe.speciesId} variantId={foe.variantId} size={96} faint={foe.hp <= 0} />
                <span className="flash" ref={foeFlash} aria-hidden="true" />
              </span>
              <StatHover creature={foe} />
            </div>
            <div className="slot mine hoverable" tabIndex={0}>
              <span className="mover" ref={mySprite}>
                <Sprite speciesId={player.speciesId} variantId={player.variantId} size={96} flip faint={player.hp <= 0} />
                <span className="flash" ref={myFlash} aria-hidden="true" />
              </span>
              <Nameplate creature={player} team={ourTeam} active={battle.sides[role].active} right />
              <StatHover creature={player} />
            </div>
          </div>

          {/* The buttons go under the field rather than under the whole
              stage, so what you press sits directly beneath what you are
              looking at. */}
          {actions}
        </div>

        {/* And the log down the right, where it can be as long as it likes
            without pushing the buttons off the bottom of the screen. */}
        <div className="stageLog">
          <div className="log">
            {lines.length ? (
              lines.map((line, i) => <p key={i}>{line}</p>)
            ) : (
              <p className="muted">
                {opponentLabel} {displayName(foe)} is out!
              </p>
            )}
          </div>
        </div>
      </div>


    </div>
  );
}
