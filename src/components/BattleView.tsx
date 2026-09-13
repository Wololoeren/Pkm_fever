"use client";

import { useEffect, useRef, useState } from "react";
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
import { displayName, narrateParts, type LogLine } from "@/lib/narrate";
import { badgesFor } from "@/lib/tags";
import { typeColor } from "@/render/palette";
import { GenderMark, HpBar, TeamBalls, teamPanel, VariantTag } from "./PartyStrip";
import { beatsFor, catchFor } from "@/lib/beats";
import { useBeat, useCatch, useEntrance } from "./useBeat";
import { useCues } from "./useCues";
import { autoPick, pickByKey, switchTargets } from "@/lib/switching";
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

const FIELD_LABELS: Record<string, string> = {
  sun: "SUN",
  rain: "RAIN",
  sand: "SAND",
  hail: "HAIL",
  snow: "SNOW",
  electric: "ELECTRIC",
  grassy: "GRASSY",
  misty: "MISTY",
  psychic: "PSYCHIC",
  water: "WATER SPORT",
  mud: "MUD SPORT",
};

/**
 * What is true of the whole battle, above the two plates.
 *
 * The badge row is per side, and weather belongs to neither side, so it gets
 * its own line — absent when nothing is up, like every badge.
 */
function FieldLine({ field }: { field: BattleState["field"] }) {
  if (!field) return null;
  const parts = (["weather", "terrain", "sport"] as const)
    .map((kind) => field[kind])
    .filter((one): one is NonNullable<typeof one> => one !== undefined);
  if (!parts.length) return null;
  return (
    <div className="fieldLine">
      {parts.map((one) => (
        <span key={one.id} className="tag" title={`${one.turns} turn${one.turns === 1 ? "" : "s"} left`}>
          {FIELD_LABELS[one.id] ?? one.id.toUpperCase()} {one.turns}
        </span>
      ))}
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
  aside = teamPanel(battle.sides[role].team, battle.sides[role].active),
}: {
  battle: BattleState;
  /** The side we are driving. */
  role: SideIndex;
  onAction: (action: BattleAction) => void;
  /**
   * Every kind of ball and how many of each are in the bag. Omitted in a duel:
   * there is nothing to catch and nowhere to run.
   */
  balls?: { id: string; name: string; count: number }[];
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

  /*
   * The scene does not play here any more.
   *
   * It used to, off the turn's `exp` event, because a battle evolved the
   * creature on the spot and the event was a report of something already
   * true. It is an *offer* now — nothing has changed species, and the player
   * has not been asked — so playing twenty seconds of it mid-battle would be
   * showing a thing that may not happen, over a battle that is still going.
   *
   * The offer waits in `pendingEvolutions` and is answered where every other
   * offer is: out in the field, once the battle is over. `page.tsx` plays it.
   */

  // What this turn looked like, and the two elements each side animates. The
  // refs are handed to `useBeat`, which restarts on the turn number.
  //
  // A ball thrown this turn: the wild creature's answer to a throw that failed
  // is pushed back past the smoke, so the two never happen under one another.
  const attempt = catchFor(battle.events, battle.turn);
  const beats = beatsFor(battle.events, attempt?.outcome === "escaped" ? attempt.length : 0);
  const ballRef = useRef<HTMLSpanElement>(null);
  const burstRef = useRef<HTMLSpanElement>(null);
  const foeSprite = useRef<HTMLSpanElement>(null);
  const foeFlash = useRef<HTMLSpanElement>(null);
  const mySprite = useRef<HTMLSpanElement>(null);
  const myFlash = useRef<HTMLSpanElement>(null);

  const them: SideIndex = role === 0 ? 1 : 0;
  const player = activeOf(battle, role);
  const foe = activeOf(battle, them);
  const mustSwitch = battle.awaitingSwitch[role];
  /**
   * The move that is going to happen whatever is pressed.
   *
   * A creature part-way through a Fly, a Rollout or an Outrage has had the
   * choice taken away, and the engine deliberately accepts *any* button
   * rather than greying all but one — greying them all is how a battle ends
   * up with nothing legal to press. So the menu has to say so instead, or the
   * player presses Tackle, watches an Outrage come out, and concludes the
   * buttons are broken.
   */
  const committed = battle.sides[role].volatiles?.committed ?? null;
  const ourTeam = battle.sides[role].team;
  const wildBattle = balls !== undefined;
  const canAct = !busy && !footer && !battle.outcome;
  const targets = switchTargets(battle, role);

  // A picker with one thing in it is a question with one answer: the single
  // eligible member goes out on its own, forced switch or chosen. And a
  // picker with nothing in it — held by a trap — closes rather than waits.
  useEffect(() => {
    if (!canAct || !(mustSwitch || switching)) return;
    const only = autoPick(battle, role);
    if (only !== null) {
      setSwitching(false);
      onAction({ t: "switch", partyIndex: only });
    } else if (switching && !switchTargets(battle, role).length) {
      setSwitching(false);
    }
  }, [battle, role, mustSwitch, switching, canAct, onAction]);

  /*
   * The keyboard's half of switching. X opens the picker, a number picks,
   * Escape closes. On the capture phase, and stopping there, because the
   * page's own battle keys read the same numbers as moves — and while the
   * picker is open a number is a creature, not a move.
   *
   * **X rather than S, and the repeat guard, are the same bug fixed twice.**
   * S is the walk-south key. Walking south into tall grass is the single
   * commonest way to meet anything in this game, and the key is still held
   * when the battle opens — so the operating system's auto-repeat arrived
   * here as a fresh press and the switch picker was open before the player
   * had seen what they had run into.
   *
   * Changing the key fixes the case that happens constantly. Throwing away
   * `event.repeat` fixes the whole class, including B and R and the number
   * keys, and including whatever this is rebound to next.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!canAct) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      // A key held down since before this battle existed is not a decision
      // about it.
      if (event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

      if (mustSwitch || switching) {
        const pick = pickByKey(battle, role, key);
        if (pick !== null) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setSwitching(false);
          onAction({ t: "switch", partyIndex: pick });
        } else if (/^[1-9]$/.test(key)) {
          // A number that is nobody eligible is swallowed rather than let
          // through to become a move.
          event.preventDefault();
          event.stopImmediatePropagation();
        } else if (key === "Escape" && !mustSwitch) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setSwitching(false);
        }
        return;
      }

      if (key === "x" && targets.length) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setSwitching(true);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [battle, role, mustSwitch, switching, canAct, onAction, targets.length]);

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
  useCatch(ballRef, foeSprite, burstRef, attempt, battle.turn);
  useCues(battle);

  const lines = narrateParts(battle.events, (side) =>
    side === role ? displayName(player) : `${opponentLabel} ${displayName(foe)}`.trim(),
  );

  /*
   * The whole battle, not just the turn that has just happened.
   *
   * `BattleState.events` is *this turn's* narration and is replaced every
   * turn — deliberately, because it is derived and the state hash leaves it
   * out. So the transcript does not exist anywhere until something keeps it,
   * and keeping it in the engine would mean a save that grows with every turn
   * of every battle for the sake of some words nobody replays.
   *
   * So it is kept here, in the view, which is exactly as long as it is worth
   * having: a new battle is a new tag and a fresh scroll.
   */
  const [history, setHistory] = useState<{ tag: string; turn: number; lines: LogLine[] }>({
    tag: battle.tag,
    turn: -1,
    lines: [],
  });

  useEffect(() => {
    setHistory((held) => {
      // A different battle is a different transcript.
      if (held.tag !== battle.tag) return { tag: battle.tag, turn: battle.turn, lines: [...lines] };
      // Appended once per turn, and only forwards. React can render the same
      // turn twice and a peer can hand us the same state again; neither is a
      // reason to say everything twice.
      if (battle.turn <= held.turn) return held;
      return { tag: battle.tag, turn: battle.turn, lines: [...held.lines, ...lines] };
    });
    // `lines` is rebuilt every render, so it cannot be a dependency without
    // this running every render. The turn is what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle.tag, battle.turn]);

  /** Everything said so far, with this turn on the end even before the effect
   * has run — so the newest line is never a frame late. */
  const transcript =
    history.tag === battle.tag && battle.turn <= history.turn
      ? history.lines
      : [...(history.tag === battle.tag ? history.lines : []), ...lines];

  // Pinned to the bottom as it grows, the way a chat log is: the newest line
  // is the one being read, and scrolling up is a deliberate act.
  const logRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = logRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [transcript.length]);

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
              <span className="promptWhere">
                Pick one from your party, or press its number{mustSwitch ? "" : " — Esc to go back"}.
              </span>
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
                const lands = landsAs(player, foe, moveId, battle.sides[them].volatiles);
                return (
                  <button
                    key={moveId}
                    type="button"
                    className={`moveBtn${left === 0 ? " spent" : ""}${
                      committed && committed !== moveId ? " overridden" : ""
                    }`}
                    style={{ borderLeftColor: typeColor(entry.type) }}
                    disabled={left === 0 && !committed}
                    title={
                      committed
                        ? `${moveById(committed).name} happens this turn whatever is pressed`
                        : left === 0
                          ? `${entry.name} has no uses left`
                          : undefined
                    }
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
              {/* One button per kind carried, so a Great or an Ultra Ball is
                  something you can actually choose. The Poké Ball's button
                  stays even at nought, because it is what B throws. */}
              {balls
                ?.filter((ball) => ball.id === "pokeball" || ball.count > 0)
                .map((ball) => (
                  <button
                    key={ball.id}
                    type="button"
                    onClick={() => onAction(ball.id === "pokeball" ? { t: "ball" } : { t: "ball", item: ball.id })}
                    disabled={ball.count <= 0}
                  >
                    {ball.name} ({ball.count})
                  </button>
                ))}
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
              {targets.length ? (
                <>
                  {" · "}
                  <kbd>X</kbd> switch
                </>
              ) : null}
              {wildBattle ? (
                <>
                  {" · "}
                  <kbd>B</kbd> Poké Ball · <kbd>R</kbd> run
                </>
              ) : null}
            </p>
          </div>
        )}
    </>
  );

  return (
    <div className="battle">
      <div className="stage">
        {/* Who you have, up the left. It used to sit a long way below the
            battle, under the bag, which meant checking what was left on the
            bench was a scroll rather than a glance. */}
        {/* Always a panel. A duel has no page party to hand in, so it gets the
            battle's own team by default; leaving the column empty put the field
            in the party's narrow slot and the log in the middle, and left a
            switch prompt pointing at a party that was not on screen. */}
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

        <div className="stageField">
          <FieldLine field={battle.field} />
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
              {/* The sprite and the ball share one box the size of the sprite,
                  so the ball lands at the creature's feet rather than at the
                  middle of a slot that also holds a nameplate. Beside the
                  mover rather than inside it, because the mover is what the
                  ball draws in and a ball that shrank with its own target
                  would vanish. */}
              <span className="catchStage">
                <span className="mover" ref={foeSprite}>
                  <Sprite speciesId={foe.speciesId} variantId={foe.variantId} size={96} faint={foe.hp <= 0} />
                  <span className="flash" ref={foeFlash} aria-hidden="true" />
                </span>
                <span className="ball" ref={ballRef} aria-hidden="true" />
                <span className="burst" ref={burstRef} aria-hidden="true">
                  <span className="star" />
                  <span className="star" />
                  <span className="star" />
                  <span className="star" />
                  <span className="puff" />
                  <span className="puff" />
                  <span className="puff" />
                </span>
              </span>
              <StatHover creature={foe} side={battle.sides[them]} />
            </div>
            <div className="slot mine hoverable" tabIndex={0}>
              <span className="mover" ref={mySprite}>
                <Sprite speciesId={player.speciesId} variantId={player.variantId} size={96} flip faint={player.hp <= 0} />
                <span className="flash" ref={myFlash} aria-hidden="true" />
              </span>
              <Nameplate creature={player} side={battle.sides[role]} right />
              <StatHover creature={player} side={battle.sides[role]} />
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
          <div className="log" ref={logRef}>
            {transcript.length ? (
              transcript.map((line, at) => (
                <p key={at}>
                  {line.map((part, index) =>
                    part.t === "text" ? (
                      <span key={index}>{part.text}</span>
                    ) : part.t === "key" ? (
                      <span key={index} className="logKey">
                        {part.text}
                      </span>
                    ) : (
                      // Whose move it was decides the colour, and only this
                      // component knows which side the reader is sitting on.
                      <span
                        key={index}
                        className={part.side === role ? "logMine" : "logTheirs"}
                      >
                        {part.text}
                      </span>
                    ),
                  )}
                </p>
              ))
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
