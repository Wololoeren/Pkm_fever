"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BattleView } from "@/components/BattleView";
import { CheatMenu } from "@/components/CheatMenu";
import { EvolutionScene } from "@/components/EvolutionScene";
import { Inspect } from "@/components/Inspect";
import { MiniMap } from "@/components/MiniMap";
import { PvpScreen } from "@/components/PvpScreen";
import { GameCanvas } from "@/components/GameCanvas";
import { BagPanel } from "@/components/BagPanel";
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
import { applyInput, bestRod, fishRefusal, initialState, isWildBattle, opponentLabel, reduce, stateHash, type Notice, type Direction, type GameState, type Input } from "@/engine/engine";
import { DEFAULT_WORLD } from "@/engine/types";
import { APPEARANCE_COUNT } from "@/engine/variants";
import { generateWorld, type InteriorRole, type World } from "@/engine/world";
import {
  clearAutosave,
  downloadSave,
  normaliseSeed,
  readAutosave,
  writeAutosave,
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
        const inputs = [...current.inputs, input];
        writeAutosave(current.seed, inputs);
        return { ...current, inputs, state };
      } catch {
        return current;
      }
    });
  }, []);

  const state = session?.state;

  useEffect(() => {
    if (!state) return;

    function onKey(event: KeyboardEvent) {
      if (!state) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

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
        dispatch({ t: "move", dir });
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
    return () => window.removeEventListener("keydown", onKey);
  }, [state, dispatch]);

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
          battle={state.battle!}
          role={0}
          // Only a wild battle gets a ball count, because that is what
          // BattleView reads as "balls and running are legal here".
          balls={isWildBattle(state.battle) ? countOf(state.bag, "pokeball") : undefined}
          // Whose it is, worked out from the battle's own tag. Left to its
          // default, every trainer and gym leader in the game fielded "Wild"
          // creatures.
          opponentLabel={opponentLabel(session.world, state.battle)}
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
              The {speciesById(state.notice.speciesId).name} looks up at you, and goes back to
              whatever it was doing.
            </p>
          ) : null}
          {state.notice?.t === "joined" ? (
            <p className="good">
              The {speciesById(state.notice.speciesId).name} decided to come along
              {state.notice.boxed ? " — your party was full, so it is in the box" : ""}.
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

      {state.notice?.t === "evolved" && seenEvolution !== state.notice ? (
        <EvolutionScene
          from={state.notice.from}
          to={state.notice.to}
          onDone={() => setSeenEvolution(state.notice)}
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
        {inHub ? null : (
          <section className="panel">
            <h3>Party</h3>
            <PartyStrip
              party={state.party}
              activeIndex={state.battle?.sides[0].active}
              onInspect={setInspecting}
              onReorder={(from, to) => dispatch({ t: "reorderParty", from, to })}
            />
          </section>
        )}

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
