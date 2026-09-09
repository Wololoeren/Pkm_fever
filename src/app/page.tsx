"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BattleView } from "@/components/BattleView";
import { CheatMenu } from "@/components/CheatMenu";
import { Inspect } from "@/components/Inspect";
import { MiniMap } from "@/components/MiniMap";
import { PvpScreen } from "@/components/PvpScreen";
import { GameCanvas } from "@/components/GameCanvas";
import { HubPanel } from "@/components/HubPanel";
import { MainMenu } from "@/components/MainMenu";
import { PartyStrip } from "@/components/PartyStrip";
import { StarterPick } from "@/components/StarterPick";
import { ITEM_BLURBS, ITEM_NAMES } from "@/engine/breeding";
import { ALL_SPECIES } from "@/engine/dex";
import type { BattleAction } from "@/engine/battle";
import { applyInput, initialState, isWildBattle, reduce, stateHash, type Direction, type GameState, type Input } from "@/engine/engine";
import { DEFAULT_WORLD } from "@/engine/types";
import { APPEARANCE_COUNT } from "@/engine/variants";
import { generateWorld, type World } from "@/engine/world";
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

export default function Page() {
  const [session, setSession] = useState<Session | null>(null);
  const [autosave, setAutosave] = useState<SaveFile | null>(null);
  const [pvp, setPvp] = useState(false);
  const [cheats, setCheats] = useState(false);
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
            <dt>Balls</dt>
            <dd>{state.balls}</dd>
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
          balls={isWildBattle(state.battle) ? state.balls : undefined}
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
          <div className="fieldRow">
            <GameCanvas world={session.world} state={state} />
            <MiniMap world={session.world} state={state} />
          </div>
          <p className="hint">
            <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> or <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> to
            walk. Tall grass has things in it. Walk east to go further out; the hub is west.
          </p>
          {state.notice?.t === "whiteout" ? (
            <p className="error">Everything fainted. You woke up back in Hearth, patched up.</p>
          ) : null}
          {state.notice?.t === "caught" ? (
            <p className="good">Caught it!{state.notice.boxed ? " Party was full, so it went to the box." : ""}</p>
          ) : null}
          {state.notice?.t === "found" ? (
            <p className="good">
              You found the {ITEM_NAMES[state.notice.item]}! {ITEM_BLURBS[state.notice.item]} Apply it at
              the daycare back in Hearth.
            </p>
          ) : null}
          {state.notice?.t === "beatTrainer" ? (
            <p className="good">
              You beat {state.notice.name}, and they handed over {state.notice.balls} balls.
            </p>
          ) : null}
          {state.notice?.t === "hatched" ? (
            <p className="good">The egg hatched!{state.notice.boxed ? " Party was full, so it went to the box." : ""}</p>
          ) : null}
        </section>
      )}

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

      {indoors && !inHub ? (
        <section className="panel">
          <p className="muted">
            Somebody lives here. There is nothing to do but look around — step back out the way
            you came.
          </p>
        </section>
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

      <section className="panel">
        {/* The hub panel already lists the party, with more detail and the
            actions that belong to it, so showing it twice is just noise. */}
        {inHub ? null : (
          <>
            <h3>Party</h3>
            <PartyStrip party={state.party} activeIndex={state.battle?.sides[0].active} onInspect={setInspecting} />
          </>
        )}
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
