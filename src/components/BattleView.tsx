"use client";

import { useRef, useState } from "react";
import {
  activeOf,
  landsAs,
  type BattleAction,
  type BattleState,
  type Combatant,
  type SideIndex,
} from "@/engine/battle";
import { move as moveById, species as speciesById, type MoveEntry } from "@/engine/dex";
import { displayPower } from "@/engine/moves";
import { anyPp, ppLeft, maxPp } from "@/engine/pp";
import { computeStats } from "@/engine/stats";
import type { Individual } from "@/engine/types";
import { displayName, narrate } from "@/lib/narrate";
import { badgesFor } from "@/lib/tags";
import { typeColor } from "@/render/palette";
import { GenderMark, HpBar, TeamBalls, VariantTag } from "./PartyStrip";
import { EvolutionScene } from "./EvolutionScene";
import { beatsFor } from "@/lib/beats";
import { useBeat, useEntrance } from "./useBeat";
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
export function powerText(entry: MoveEntry): string {
  if (entry.category === "status") return "status";
  const shown = displayPower(entry);
  if (shown === null) return "power varies";

  // Thirty-one moves land more than once, and the manifest's power is one
  // blow's worth. Printed bare it makes Fury Swipes look like the worst move
  // in the game at 18, when three blows of it is a little over fifty.
  const hits = entry.multihit;
  if (!hits) return `${shown} pow`;
  return hits[0] === hits[1]
    ? `${shown} pow ×${hits[0]}`
    : `${shown} pow ×${hits[0]}–${hits[1]}`;
}

/**
 * How this move lands on what is standing opposite, as one glyph.
 *
 * The tooltip has said "double damage against what is out" for a while, which
 * is the right amount of detail and the wrong amount of effort: choosing a
 * move is a decision you make four times a turn, and hovering four buttons to
 * find the one that works is not a decision, it is a survey. An arrow is
 * readable without stopping.
 *
 * Nothing for a neutral hit, deliberately. Four buttons each wearing a badge
 * that says "normal" is four badges nobody reads, and then the one that
 * matters is just another badge. Silence is what makes the arrow loud.
 *
 * Doubled for the extremes, because quadruple and double are genuinely
 * different answers — one of them ends the fight this turn — and the type
 * chart produces both often enough to be worth telling apart.
 */
function EffectMark({ quarters }: { quarters: number | null }) {
  if (quarters === null || quarters === 4) return null;

  const [glyph, cls, title] =
    quarters === 0
      ? ["✕", "eff none", "No effect at all on what is out"]
      : quarters >= 16
        ? ["▲▲", "eff up", "Quadruple damage against what is out"]
        : quarters >= 8
          ? ["▲", "eff up", "Double damage against what is out"]
          : quarters === 2
            ? ["▼", "eff down", "Half damage against what is out"]
            : ["▼▼", "eff down", "A quarter damage against what is out"];

  return (
    <span className={cls} title={title} aria-label={title}>
      {glyph}
    </span>
  );
}

function Nameplate({
  creature,
  side,
  right,
}: {
  creature: Individual;
  /**
   * The whole side rather than just the creature.
   *
   * Most of what is happening to it is kept on the side and not on the animal
   * — stat stages, screens, everything volatile — because that is how long
   * those things last. The badge row is the one place in the game that shows
   * all of it at once, so this is the one component that needs all of it.
   */
  side: Combatant;
  right?: boolean;
}) {
  const stats = computeStats(speciesById(creature.speciesId), creature);
  const badges = badgesFor(side, creature);

  return (
    <div className={`plate${right ? " right" : ""}`}>
      <div className="plateTop">
        <strong>
          {displayName(creature)} <GenderMark gender={creature.gender} />
        </strong>
        <span className="muted">Lv{creature.level}</span>
      </div>
      <TeamBalls team={side.team} active={side.active} />
      <HpBar creature={creature} />
      <div className="plateFoot">
        <span className="muted">
          {creature.hp}/{stats.hp}
        </span>
        <VariantTag variantId={creature.variantId} />
      </div>
      {/* Its own row rather than in the foot, and absent when there is
          nothing in it. A creature in perfect health has the plate it always
          had; one that is seeded, drowsy and two stages down grows a row
          instead of squeezing the numbers beside it. */}
      {badges.length ? (
        <div className="badgeRow">
          {badges.map((badge) => (
            <span key={badge.key} className={`tag ${badge.cls}`} title={badge.title}>
              {badge.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function BattleView({
  battle,
  role,
  onAction,
  balls,
  opponentLabel = "Wild",
  opening,
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
  /**
   * What the opponent says before anything is thrown.
   *
   * Shown above the log and left up for the whole battle rather than printed
   * into it. A line that scrolls away is a line you read once while you were
   * looking at something else — which is exactly what happened to every status
   * the log announced before the badge row existed, and the lesson is cheap to
   * apply twice.
   */
  opening?: string;
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

    // Which creature earned it, so the scene can show that one rather than a
    // factory-colours stand-in. `uid` is on the event for exactly this: the
    // creature has already changed by the time anything reads the event, and
    // the team is the only place its appearance is recorded. Experience only
    // ever goes to the side we are driving, and "normal" is the honest answer
    // if that ever stops being true.
    const grown = battle.sides[role].team.find((one) => one.uid === event.uid);

    const key = `${battle.tag}:${battle.turn}:${event.evolved}`;
    return evolvedKey === key
      ? null
      : {
          key,
          from: event.evolvedFrom,
          to: event.evolved,
          variantId: grown?.variantId ?? "normal",
        };
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
  const wildBattle = balls !== undefined;

  // The foe stands top-right and lunges left; we stand bottom-left and lunge
  // right. Handed in rather than read off a class, because the direction is
  // the one thing about the animation the layout decides.
  //
  // Walking on comes first so that being hit comes second: they animate the
  // same transform, and the later animation wins while the two overlap. A
  // creature sent out into a move already aimed at it should flinch rather
  // than keep strolling.
  useEntrance(foeSprite, `${battle.tag}:${foe.uid}`, "left");
  useEntrance(mySprite, `${battle.tag}:${player.uid}`, "right");
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
                // Asked once and handed to both the arrow and the tooltip
                // under it, so the two cannot disagree about the same move.
                const lands = landsAs(player, foe, moveId);
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
                    <span className="moveHead">
                      <span className="moveName">{entry.name}</span>
                      <EffectMark quarters={lands} />
                    </span>
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
                    <MoveNote moveId={moveId} lands={lands} />
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
          variantId={evolving.variantId}
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
              <Nameplate creature={foe} side={battle.sides[them]} />
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
              <Nameplate creature={player} side={battle.sides[role]} right />
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
          {opening ? (
            <p className="opening">
              <span className="openingWho">{opponentLabel.replace(/'s$/, "")}:</span> {opening}
            </p>
          ) : null}
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
