"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BattleView } from "@/components/BattleView";
import { CheatMenu } from "@/components/CheatMenu";
import { EvolutionScene } from "@/components/EvolutionScene";
import { Inspect } from "@/components/Inspect";
import { MiniMap } from "@/components/MiniMap";
import { PvpScreen } from "@/components/PvpScreen";
import { GameCanvas } from "@/components/GameCanvas";
import { BagPanel } from "@/components/BagPanel";
import { FieldMovePanel } from "@/components/FieldMovePanel";
import { QuestPanel } from "@/components/QuestPanel";
import { LearnPanel } from "@/components/LearnPanel";
import { TalkPanel } from "@/components/TalkPanel";
import { HubPanel } from "@/components/HubPanel";
import { MartPanel } from "@/components/MartPanel";
import { MainMenu } from "@/components/MainMenu";
import { PartyStrip } from "@/components/PartyStrip";
import { StarterPick } from "@/components/StarterPick";
import { BALLS, countOf, item } from "@/engine/items";
import { quest as questSpec, rewardText } from "@/engine/quests";
import { gym as gymSpec } from "@/engine/gyms";
import { ALL_SPECIES, move as moveById, species as speciesById } from "@/engine/dex";
import type { BattleAction } from "@/engine/battle";
import { applyInput, bestRod, critterDoing, fishRefusal, IllegalInput, initialState, rivalCountdown, isWildBattle, opponentHint, opponentLabel, reduce, stateHash, type Notice, type Direction, type GameState, type Input } from "@/engine/engine";
import { DEFAULT_WORLD } from "@/engine/types";
import { APPEARANCE_COUNT } from "@/engine/variants";
import { generateWorld, type InteriorRole, type World } from "@/engine/world";
import {
  clearAutosave,
  downloadSave,
  flushAutosave,
  normaliseSeed,
  readAutosave,
  scheduleAutosave,
  type SaveFile,
} from "@/lib/save";
import { routeLabel } from "@/render/tiles";

interface Session {
  world: World;
  seed: string;
  inputs: Input[];
  state: GameState;
}

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: "n",
  ArrowDown: "s",
  ArrowLeft: "w",
  ArrowRight: "e",
  w: "n",
  s: "s",
  a: "w",
  d: "e",
};

/**
 * How long a held direction waits before the next step.
 *
 * Holding a key used to walk you at **the operating system's** key-repeat
 * rate, which is a setting in a control panel somewhere: typically half a
 * second of nothing and then thirty steps a second. So the walk began with a
 * stutter, ran at a speed nobody chose, and was a different speed on the next
 * machine — which makes it not a game feel at all, it is whatever the player
 * happened to have configured for repeating a letter in a word processor.
 *
 * 120ms is about eight tiles a second, and it is *ours*: the first step is
 * immediate, the rest are evenly spaced, and a route is eighty-eight tiles
 * across, so crossing one is eleven seconds of holding a key rather than
 * eighty-eight presses.
 */
const STEP_INTERVAL = 120;

/**
 * What a room with no panel of its own says.
 *
 * Keyed on what the building is for, because the catch-all was "Somebody lives
 * here. There is nothing to do but look around" for *every* interior that was
 * not the daycare, the centre or the mart — which meant a gym hall said it
 * too, standing in front of a gym leader, and the Cup's house said it to five
 * people who were waiting to fight you.
 *
 * A missing entry falls back to the house line, which is the safe reading: the
 * worst a new sort of room can say is that somebody lives in it.
 */
const INDOORS_NOTE: Partial<Record<InteriorRole, string>> = {
  house: "Somebody lives here. There is nothing to do but look around — step back out the way you came.",
  gym: "A gym. The leader is in here somewhere, and they are not waiting for you to be ready.",
  cup: "The Cup. Five of them, and whoever keeps the door. Nothing in this house gives a spent move back, so what is in your bag is what you have.",
};

export default function Page() {
  const [session, setSession] = useState<Session | null>(null);
  const [autosave, setAutosave] = useState<SaveFile | null>(null);
  const [pvp, setPvp] = useState(false);
  const [cheats, setCheats] = useState(false);
  /**
   * The evolution notice whose reveal has already been sat through.
   *
   * The notice object itself rather than a boolean, so nothing has to reset
   * it: every notice is a fresh object, so the next stone is a different
   * object and shows its own scene. The battle's version of this keys on the
   * turn instead, because a battle can produce several and they arrive in the
   * same object.
   */
  const [seenEvolution, setSeenEvolution] = useState<Notice | null>(null);
  /** uid of whatever is being looked at, or null. */
  const [inspecting, setInspecting] = useState<number | null>(null);

  // localStorage is not available while the static export is being rendered,
  // so the autosave is looked up once the page is actually in a browser.
  useEffect(() => setAutosave(readAutosave()), []);

  const start = useCallback((seed: string, inputs: Input[] = []) => {
    const clean = normaliseSeed(seed);
    const world = generateWorld(DEFAULT_WORLD, clean, ALL_SPECIES);
    try {
      setSession({ world, seed: clean, inputs, state: reduce(world, inputs) });
    } catch {
      // A log that will not replay is a corrupt save, not a playable one.
      setSession({ world, seed: clean, inputs: [], state: initialState(world) });
    }
  }, []);

  /**
   * The only way state ever changes.
   *
   * The input log is the source of truth and the state is derived from it, so
   * what the browser holds is exactly what a save file holds. An input the
   * engine refuses — walking into a tree — is dropped rather than recorded:
   * the log must stay replayable.
   */
  const dispatch = useCallback((input: Input) => {
    setSession((current) => {
      if (!current) return current;
      try {
        const state = applyInput(current.world, current.state, input);
        return { ...current, inputs: [...current.inputs, input], state };
      } catch (error) {
        /**
         * A refusal is ordinary. Anything else is a bug wearing a refusal's
         * clothes, and it says so out loud.
         *
         * `IllegalInput` is the engine saying no — walking into a tree, a
         * potion in a battle, a deposit outside the daycare — and it happens
         * constantly and correctly. Every *other* throw that lands here is a
         * crash, and this `catch` is exactly wide enough to hide one: the
         * Toxic bug spent months reaching the player as "that move is not
         * legal" because `STATUS_IMMUNE["tox"]` was undefined and `.includes`
         * threw from a move that was perfectly legal. It took a hundred
         * battles of a probe to find something a single line here would have
         * named on the first occurrence.
         *
         * The session is still kept rather than torn down. A crash in one
         * input should cost that input, not the playthrough — the log is
         * intact and the state is the last good one, which is the most
         * recoverable position there is.
         */
        if (!(error instanceof IllegalInput)) {
          console.error("[pkm-fever] input crashed the engine", input, error);
        }
        return current;
      }
    });
  }, []);

  /**
   * The autosave, on a timer rather than on every keystroke.
   *
   * It used to be written from inside the state updater above, once per input.
   * That is a side effect in a function React is allowed to call twice, and it
   * serialises the *entire* log every step — which is nothing at a hundred
   * inputs and a dropped frame every step by the time a save is worth having.
   *
   * Here it is an effect over the log, debounced, so the cost is proportional
   * to how long you play rather than to how fast you walk. `flushAutosave`
   * pays whatever is owed when the tab goes away, which is the one moment a
   * debounce would otherwise cost real progress.
   */
  useEffect(() => {
    if (!session) return;
    scheduleAutosave(session.seed, session.inputs);
  }, [session]);

  useEffect(() => {
    // `pagehide` rather than `beforeunload`: it fires on a mobile tab being
    // backgrounded, which is how a phone ends a session, and `beforeunload`
    // does not.
    const flush = () => flushAutosave();
    const onHidden = () => {
      if (document.visibilityState === "hidden") flushAutosave();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
      flushAutosave();
    };
  }, []);

  const state = session?.state;

  /**
   * The evolution to sit through, if a stone produced one and it has not been.
   *
   * Bound here rather than read out of `state.notice` inside the JSX, because
   * the variant lookup is a callback and TypeScript drops the narrowing from
   * `notice.t === "evolved"` the moment the access happens inside one. The
   * alternative was a cast, which would have been a way of insisting the
   * notice is the shape it is rather than showing it.
   */
  const evolved =
    state?.notice?.t === "evolved" && seenEvolution !== state.notice ? state.notice : null;

  /**
   * Which directions are held, in the order they were pressed.
   *
   * A list rather than one direction, and the **last** one wins. Rolling a
   * thumb from one arrow to the next without letting go of the first is how
   * anybody actually turns a corner at speed, and with a single slot that
   * reads as the turn being ignored until the old key comes up.
   */
  const held = useRef<Direction[]>([]);
  const walkTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * Whether a step is legal at all, in a ref.
   *
   * The timer below must not be torn down and rebuilt every time the state
   * changes — which is every step — so it reads this instead of closing over
   * `state`.
   */
  const canWalk = useRef(false);
  useEffect(() => {
    canWalk.current = state?.phase === "field";
  }, [state?.phase]);

  const stopWalking = useCallback(() => {
    if (walkTimer.current === null) return;
    clearInterval(walkTimer.current);
    walkTimer.current = null;
  }, []);

  const startWalking = useCallback(() => {
    if (walkTimer.current !== null) return;
    walkTimer.current = setInterval(() => {
      const dir = held.current[held.current.length - 1];
      // Nothing held, or a battle started under us. Either way the walk is
      // over: stepping out of an encounter because a key was still down is
      // exactly the input nobody meant to give.
      if (!dir || !canWalk.current) {
        stopWalking();
        return;
      }
      dispatch({ t: "move", dir });
    }, STEP_INTERVAL);
  }, [dispatch, stopWalking]);

  // A key held while the window loses focus never sends its keyup, so without
  // this, alt-tabbing away mid-stride leaves the player walking forever.
  useEffect(() => {
    const release = () => {
      held.current = [];
      stopWalking();
    };
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("blur", release);
      release();
    };
  }, [stopWalking]);

  useEffect(() => {
    if (!state) return;

    function onKeyUp(event: KeyboardEvent) {
      const dir = KEY_DIRECTIONS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (!dir) return;
      held.current = held.current.filter((one) => one !== dir);
      if (!held.current.length) stopWalking();
    }

    function onKey(event: KeyboardEvent) {
      if (!state) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

      // Somebody typing a room code should not be walking across a route at
      // eight tiles a second, which is what WASD in a text box became the
      // moment holding a key meant something.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      // Three modifiers and a letter, so nothing reaches it by accident.
      if (event.ctrlKey && event.shiftKey && event.altKey && key === "z") {
        event.preventDefault();
        setCheats((open) => !open);
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      if (state.phase === "field") {
        const dir = KEY_DIRECTIONS[key];
        if (!dir) return;
        event.preventDefault();
        // The operating system's own repeat, thrown away. The cadence is
        // `STEP_INTERVAL`'s to set, and honouring both would be two walks
        // racing each other.
        if (event.repeat) return;
        if (!held.current.includes(dir)) held.current.push(dir);
        dispatch({ t: "move", dir });
        startWalking();
        return;
      }

      if (state.phase === "battleEnd") {
        if (key === "Enter" || key === " ") {
          event.preventDefault();
          dispatch({ t: "continue" });
        }
        return;
      }

      // awaitingSwitch is a pair, so testing the array itself is permanently
      // truthy and the negation permanently false — which killed every battle
      // key. Side 0 is us; a replacement is chosen from the party strip, not
      // the keyboard.
      if (state.phase === "battle" && state.battle && !state.battle.awaitingSwitch[0]) {
        if (key >= "1" && key <= "4") {
          event.preventDefault();
          dispatch({ t: "fight", moveIndex: Number(key) - 1 });
        } else if (key === "b" && isWildBattle(state.battle)) {
          event.preventDefault();
          dispatch({ t: "ball" });
        } else if (key === "r" && isWildBattle(state.battle)) {
          event.preventDefault();
          dispatch({ t: "flee" });
        }
      }
    }

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [state, dispatch, startWalking, stopWalking]);

  // What you can do is a property of where you are standing. The daycare and
  // the centre are buildings now, so their panels appear when you are inside
  // one rather than following you around town.
  const here = state ? session?.world.routes.get(state.route) : undefined;
  const indoors = state?.phase === "field" && here?.kind === "interior";
  const inDaycare = indoors && here?.role === "daycare";
  const inCentre = indoors && here?.role === "centre";
  const inMart = indoors && here?.role === "mart";
  const inHub = inDaycare || inCentre;

  /** What the inspector is looking at, and whether it is in the party — which
   * decides whether its moves can be rearranged. */
  const inspected = useMemo(() => {
    if (!state || inspecting === null) return null;
    const index = state.party.findIndex((creature) => creature.uid === inspecting);
    if (index >= 0) return { creature: state.party[index], index };
    const boxed = state.box.find((creature) => creature.uid === inspecting);
    return boxed ? { creature: boxed, index: -1 } : null;
  }, [state, inspecting]);

  const foundLabel = useMemo(() => {
    if (!state) return "";
    const special = state.found.filter((id) => id !== "normal").length;
    return `${special} of ${APPEARANCE_COUNT - 1}`;
  }, [state]);

  if (!session || !state) {
    return (
      <main className="shell">
        <MainMenu
          autosave={autosave}
          onNew={(seed) => {
            clearAutosave();
            start(seed);
          }}
          onLoad={(save) => start(save.seed, save.inputs)}
        />
      </main>
    );
  }

  if (pvp) {
    return (
      <main className="shell">
        <PvpScreen
          roster={[...state.party, ...state.box]}
          onExit={() => setPvp(false)}
          onTrade={(giveUid, received) => {
            const give = state.party.findIndex((creature) => creature.uid === giveUid);
            if (give >= 0) dispatch({ t: "trade", give, receive: received });
          }}
        />
      </main>
    );
  }

  if (state.phase === "starter") {
    return (
      <main className="shell">
        <StarterPick world={session.world} onPick={(index) => dispatch({ t: "pickStarter", index })} />
      </main>
    );
  }

  /**
   * Who you have, built once and shown in one of two places.
   *
   * Beside the field during a battle, under the map while you are walking, and
   * nowhere at all in a town, where the hub panel already lists everybody.
   * One panel rather than two, because two would be two answers to the same
   * question and they would drift.
   */
  const fighting = state.phase === "battle" || state.phase === "battleEnd";
  //
  // Given a callback when the battle wants somebody sent out, in which case the
  // cards become the thing you press and the panel says so. Reordering and the
  // full sheet are withheld while choosing: a click meant to send a creature
  // out should not sometimes open a stat screen instead.
  const partyPanel = (choosing: ((index: number) => void) | null) => (
    <section className={`panel${choosing ? " choosing" : ""}`}>
      <h3>{choosing ? "Send out who?" : "Party"}</h3>
      <PartyStrip
        party={state.party}
        activeIndex={state.battle?.sides[0].active}
        onSelect={choosing ?? undefined}
        onInspect={choosing ? undefined : setInspecting}
        onReorder={choosing ? undefined : (from, to) => dispatch({ t: "reorderParty", from, to })}
      />
    </section>
  );

  return (
    <main className="shell game">
      <header className="hud">
        <div>
          <h2>{here?.label ?? routeLabel(state.route)}</h2>
          <p className="muted">
            seed <code>{session.seed}</code> · {session.inputs.length} moves · hash <code>{stateHash(state)}</code>
          </p>
        </div>
        <div className="hudStats">
          <div>
            <dt>Money</dt>
            <dd>¤{state.money.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Balls</dt>
            <dd>{BALLS.reduce((total, ball) => total + countOf(state.bag, ball.id), 0)}</dd>
          </div>
          <div>
            <dt>Badges</dt>
            <dd>{state.badges.length} of 8</dd>
          </div>
          <div>
            <dt>Variants</dt>
            <dd>{foundLabel}</dd>
          </div>
          <div>
            <dt>Boxed</dt>
            <dd>{state.box.length}</dd>
          </div>
        </div>
      </header>

      {state.phase === "battle" || state.phase === "battleEnd" ? (
        <BattleView
          aside={partyPanel}
          battle={state.battle!}
          role={0}
          // Only a wild battle gets a ball count, because that is what
          // BattleView reads as "balls and running are legal here".
          balls={isWildBattle(state.battle) ? countOf(state.bag, "pokeball") : undefined}
          // Whose it is, worked out from the battle's own tag. Left to its
          // default, every trainer and gym leader in the game fielded "Wild"
          // creatures.
          opponentLabel={opponentLabel(session.world, state.battle)}
          opening={opponentHint(session.world, state.battle)?.text}
          onAction={dispatch as (action: BattleAction) => void}
          footer={
            state.phase === "battleEnd" ? (
              <>
                <button type="button" className="primary" onClick={() => dispatch({ t: "continue" })} autoFocus>
                  Continue
                </button>
                <p className="hint">
                  <kbd>Enter</kbd> or <kbd>Space</kbd>
                </p>
              </>
            ) : undefined
          }
        />
      ) : (
        <section className="field">
          {/* The map, the little map, and what you are out here for. The
              quests sit beside the minimap because they are read the same
              way — a glance while walking, rather than something you stop and
              open a panel for. */}
          <div className="fieldRow">
            <GameCanvas world={session.world} state={state} />
            <MiniMap world={session.world} state={state} />
            <section className="panel questsBeside">
              <h3>Quests</h3>
              <QuestPanel world={session.world} state={state} onInput={dispatch} />
            </section>
          </div>
          <p className="hint">
            <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> or <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> to
            walk. Tall grass has things in it. Every gap in the wall leads somewhere; the small
            map shows which of them you have taken.
          </p>
          {/* Somebody is behind you. A number counting down, because there is
              nothing to *do* about him except be ready, and a warning you can
              act on is a warning worth giving. */}
          {rivalCountdown(state) !== null ? (
            <p className="error">
              Somebody is following you. {rivalCountdown(state)} moves before they catch up.
            </p>
          ) : null}
          {state.notice?.t === "whiteout" ? (
            <p className="error">
              Everything fainted. You woke up in{" "}
              {session.world.routes.get(state.notice.at)?.label ?? "Hearth"}, patched up.
            </p>
          ) : null}
          {state.notice?.t === "caught" ? (
            <p className="good">Caught it!{state.notice.boxed ? " Party was full, so it went to the box." : ""}</p>
          ) : null}
          {state.notice?.t === "found" ? (
            <p className="good">
              You found the {item(state.notice.item).name}! {item(state.notice.item).blurb} Apply it at
              the daycare back in Hearth.
            </p>
          ) : null}
          {state.notice?.t === "beatTrainer" ? (
            <p className="good">
              You beat {state.notice.name}, and they handed over ¤{state.notice.money.toLocaleString()}.
            </p>
          ) : null}
          {state.notice?.t === "usedMove" ? (
            <p className="good">Used {moveById(state.notice.move).name}.</p>
          ) : null}
          {state.notice?.t === "travelled" ? (
            <p className="good">
              The Grey Line walked you to{" "}
              {session.world.routes.get(state.notice.route)?.label ?? state.notice.route}.
            </p>
          ) : null}
          {state.notice?.t === "used" ? (
            <p className="good">
              Used the {item(state.notice.item).name} on {state.notice.on}.
            </p>
          ) : null}
          {state.notice?.t === "bought" ? (
            <p className="good">
              Bought {state.notice.count} x {item(state.notice.item).name}.
            </p>
          ) : null}
          {state.notice?.t === "sold" ? (
            <p className="good">
              Sold {state.notice.count} x {item(state.notice.item).name}.
            </p>
          ) : null}
          {state.notice?.t === "picked" ? (
            <p className="good">Picked up a {item(state.notice.item).name}.</p>
          ) : null}
          {state.notice?.t === "noticed" ? (
            <p className="muted">
              {critterDoing(session.world, state.route, state.notice.critterId) ??
                `The ${speciesById(state.notice.speciesId).name} looks up at you, and goes back to whatever it was doing.`}
            </p>
          ) : null}
          {state.notice?.t === "joined" ? (
            <p className="good">
              {critterDoing(session.world, state.route, state.notice.critterId) ??
                `The ${speciesById(state.notice.speciesId).name} decided to come along.`}
              {state.notice.boxed ? " Your party was full, so it is in the box." : ""}
            </p>
          ) : null}
          {state.notice?.t === "given" ? (
            <p className="good">
              {state.notice.on} is carrying the {item(state.notice.item).name}.
            </p>
          ) : null}
          {state.notice?.t === "took" ? (
            <p className="good">
              Took the {item(state.notice.item).name} back off {state.notice.on}.
            </p>
          ) : null}
          {state.notice?.t === "gift" ? (
            <p className="good">
              {state.notice.from} gave you a {item(state.notice.item).name}.
            </p>
          ) : null}
          {state.notice?.t === "healed" ? (
            <p className="good">{state.notice.by} patched everyone up.</p>
          ) : null}
          {state.notice?.t === "swapped" ? (
            <p className="good">
              Traded your {state.notice.given} for their {state.notice.got}.
            </p>
          ) : null}
          {state.notice?.t === "questTaken" ? (
            <p className="good">Took on {questSpec(state.notice.id).name}.</p>
          ) : null}
          {state.notice?.t === "questDone" ? (
            <p className="good">
              {questSpec(state.notice.id).name} done — paid {rewardText(questSpec(state.notice.id).reward)}.
            </p>
          ) : null}
          {state.notice?.t === "cleared" ? (
            <p className="good">Used {item(state.notice.item).name}. The way is open.</p>
          ) : null}
          {state.notice?.t === "badge" ? (
            <p className="good">
              Beat {gymSpec(state.notice.gym).leader} — the {gymSpec(state.notice.gym).name} badge is
              yours. Every other gym just got five levels harder.
            </p>
          ) : null}
          {state.notice?.t === "released" ? (
            <p className="muted">You let {state.notice.name} go.</p>
          ) : null}
          {state.notice?.t === "appraised" ? (
            <p className="good">
              Sold your {state.notice.name} — {state.notice.tier} rung
              {state.notice.tier === 1 ? "" : "s"} of shine, for{" "}
              {state.notice.money
                ? `¤${state.notice.money.toLocaleString()}`
                : `${state.notice.glitter} Glitter`}
              .
            </p>
          ) : null}
          {state.notice?.t === "taught" ? (
            <p className="good">
              {state.notice.name}{" "}
              {state.notice.forgot
                ? `forgot ${moveById(state.notice.forgot).name} and learned`
                : "learned"}{" "}
              {moveById(state.notice.learned).name}.
            </p>
          ) : null}
          {state.notice?.t === "lured" ? (
            <p className="good">
              Lit the {item(state.notice.item).name}. It burns until move{" "}
              {state.notice.until.toLocaleString()}.
            </p>
          ) : null}
          {state.notice?.t === "hatched" ? (
            <p className="good">The egg hatched!{state.notice.boxed ? " Party was full, so it went to the box." : ""}</p>
          ) : null}
        </section>
      )}

      {state.talking ? (
        <TalkPanel world={session.world} state={state} onInput={dispatch} />
      ) : null}

      {/* Above the map and below a conversation: it is a question waiting for
          you rather than something happening now, and it keeps until the
          person in front of you is finished. */}
      {state.phase === "field" && !state.talking ? (
        <LearnPanel state={state} onInput={dispatch} />
      ) : null}

      {inHub ? (
        <HubPanel
          world={session.world}
          state={state}
          onInput={dispatch}
          onPvp={() => setPvp(true)}
          onInspect={setInspecting}
          showDaycare={Boolean(inDaycare)}
          showPvp={Boolean(inCentre)}
        />
      ) : null}

      {inMart ? (
        <section className="panel">
          <MartPanel world={session.world} state={state} onInput={dispatch} />
        </section>
      ) : null}

      {indoors && !inHub && !inMart ? (
        <section className="panel">
          <p className="muted">{INDOORS_NOTE[here!.role ?? "house"] ?? INDOORS_NOTE.house}</p>
        </section>
      ) : null}

      {evolved ? (
        <EvolutionScene
          from={evolved.from}
          to={evolved.to}
          // The party is where an appearance is recorded, and the notice says
          // which member. It has already changed species by the time this is
          // read, which is why the notice carries both names and the creature
          // carries neither.
          variantId={state.party.find((one) => one.uid === evolved.uid)?.variantId ?? "normal"}
          onDone={() => setSeenEvolution(evolved)}
        />
      ) : null}

      {cheats ? (
        <CheatMenu world={session.world} state={state} onInput={dispatch} onClose={() => setCheats(false)} />
      ) : null}

      {inspected ? (
        <Inspect
          world={session.world}
          creature={inspected.creature}
          index={inspected.index}
          state={state}
          onInput={dispatch}
          onClose={() => setInspecting(null)}
        />
      ) : null}

      {/* Who you have and what you are carrying, side by side. Either can be
          absent — the party is hidden indoors where the hub panel already
          lists it, and the bag only appears in the field — and whichever
          remains takes the full width rather than sitting in half of it. */}
      <div className="sideBySide">
        {/* Not here during a battle: it is up beside the field instead, which
            is where you want it when you are deciding who to send out. */}
        {inHub || fighting ? null : partyPanel(null)}

        {state.phase === "field" ? (
          <section className="panel">
            <div className="row">
              <h3>Bag</h3>
              {/* Fishing is offered where it is legal and refused where it is
                  not, in the engine's own words. */}
              <button
                type="button"
                className="ghost"
                disabled={Boolean(fishRefusal(session.world, state))}
                title={fishRefusal(session.world, state) ?? "Cast a line"}
                onClick={() => dispatch({ t: "fish" })}
              >
                {bestRod(state.bag) ? `Fish (${bestRod(state.bag)!.name})` : "Fish"}
              </button>
            </div>
            <BagPanel world={session.world} state={state} onInput={dispatch} />

            {/* And what your party can do out here, under the bag because it
                is the same kind of question: something you have, used on the
                place you are standing. Renders nothing when nobody has one. */}
            <FieldMovePanel world={session.world} state={state} onInput={dispatch} />
          </section>
        ) : null}
      </div>

      <section className="panel">
        <div className="row">
          <button type="button" className="ghost" onClick={() => downloadSave(session.seed, session.inputs)}>
            Save to file
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              if (confirm("Leave this run? The autosave stays, so you can continue it later.")) {
                setAutosave(readAutosave());
                setSession(null);
              }
            }}
          >
            Main menu
          </button>
        </div>
      </section>
    </main>
  );
}
