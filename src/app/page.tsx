"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BattleView } from "@/components/BattleView";
import { DuelScreen } from "@/components/DuelScreen";
import { GameCanvas } from "@/components/GameCanvas";
import { HubPanel } from "@/components/HubPanel";
import { MainMenu } from "@/components/MainMenu";
import { PartyStrip } from "@/components/PartyStrip";
import { StarterPick } from "@/components/StarterPick";
import { ITEM_BLURBS, ITEM_NAMES } from "@/engine/breeding";
import { ALL_SPECIES } from "@/engine/dex";
import type { BattleAction } from "@/engine/battle";
import { applyInput, initialState, reduce, stateHash, type Direction, type GameState, type Input } from "@/engine/engine";
import { DEFAULT_WORLD } from "@/engine/types";
import { VARIANTS } from "@/engine/variants";
import { generateWorld, HUB_ID, type World } from "@/engine/world";
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
  const [duelling, setDuelling] = useState(false);

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

      if (state.phase === "battle" && state.battle && !state.battle.awaitingSwitch) {
        if (key >= "1" && key <= "4") {
          event.preventDefault();
          dispatch({ t: "fight", moveIndex: Number(key) - 1 });
        } else if (key === "b") {
          event.preventDefault();
          dispatch({ t: "ball" });
        } else if (key === "r") {
          event.preventDefault();
          dispatch({ t: "flee" });
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, dispatch]);

  const inHub = state?.phase === "field" && state.route === HUB_ID;

  const foundLabel = useMemo(() => {
    if (!state) return "";
    const special = state.found.filter((id) => id !== "normal").length;
    return `${special} of ${VARIANTS.length - 1}`;
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
          onDuel={() => {
            if (!autosave) return;
            start(autosave.seed, autosave.inputs);
            setDuelling(true);
          }}
        />
      </main>
    );
  }

  if (duelling) {
    return (
      <main className="shell">
        <DuelScreen roster={[...state.party, ...state.box]} onExit={() => setDuelling(false)} />
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
          <h2>{routeLabel(state.route)}</h2>
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
          balls={state.balls}
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
          <GameCanvas world={session.world} state={state} />
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
          {state.notice?.t === "hatched" ? (
            <p className="good">The egg hatched!{state.notice.boxed ? " Party was full, so it went to the box." : ""}</p>
          ) : null}
        </section>
      )}

      {inHub ? <HubPanel state={state} onInput={dispatch} /> : null}

      <section className="panel">
        {/* The hub panel already lists the party, with more detail and the
            actions that belong to it, so showing it twice is just noise. */}
        {inHub ? null : (
          <>
            <h3>Party</h3>
            <PartyStrip party={state.party} activeIndex={state.battle?.sides[0].active} />
          </>
        )}
        <div className="row">
          <button type="button" className="ghost" onClick={() => downloadSave(session.seed, session.inputs)}>
            Save to file
          </button>
          <button
            type="button"
            className="ghost"
            disabled={state.phase !== "field" || !state.party.length}
            onClick={() => setDuelling(true)}
          >
            1v1
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
