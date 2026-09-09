"use client";

import { useMemo, useState } from "react";
import { ALL_SPECIES } from "@/engine/dex";
import { GENDER_NAMES, GENDERS, type Gender } from "@/engine/gender";
import type { Cheat, GameState, Input } from "@/engine/engine";
import { ALL_APPEARANCES, variant } from "@/engine/variants";
import type { World } from "@/engine/world";
import { displayName } from "@/lib/narrate";
import { routeLabel } from "@/render/tiles";

/**
 * Testing shortcuts, behind Ctrl+Shift+Alt+Z.
 *
 * Everything here goes through the ordinary input path, so a save that used
 * any of it carries that fact in its log and reports `cheated`. That is
 * deliberate: the alternative — a menu that reaches in and edits state — makes
 * saves that a tournament check cannot tell apart from honest ones, and this
 * whole design exists so that it can.
 */
export function CheatMenu({
  world,
  state,
  onInput,
  onClose,
}: {
  world: World;
  state: GameState;
  onInput: (input: Input) => void;
  onClose: () => void;
}) {
  const [speciesId, setSpeciesId] = useState("bulbasaur");
  const [level, setLevel] = useState(50);
  const [variantId, setVariantId] = useState("normal");
  const [gender, setGender] = useState<Gender>("female");
  const [route, setRoute] = useState(state.route);

  const send = (cheat: Cheat) => onInput({ t: "cheat", cheat });

  // 1,134 species in a native select is fine and searchable by typing; a
  // custom combobox here would be scaffolding for scaffolding.
  const species = useMemo(() => [...ALL_SPECIES].sort((a, b) => a.num - b.num), []);
  const routes = useMemo(() => [...world.routes.keys()].sort(), [world]);

  return (
    <div className="cheatBackdrop" role="dialog" aria-label="Testing shortcuts">
      <section className="cheatPanel">
        <header className="cheatHead">
          <div>
            <h2>Testing shortcuts</h2>
            <p className="muted">
              Every one of these is an input like any other, so it lands in the save log and marks
              it {state.cheated ? "— and this save is already marked." : "as cheated."}
            </p>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </header>

        {state.cheated ? <p className="error">This save is marked as cheated.</p> : null}

        <h3>Give a creature</h3>
        <div className="row">
          <select value={speciesId} onChange={(event) => setSpeciesId(event.target.value)}>
            {species.map((entry) => (
              <option key={entry.id} value={entry.id}>
                #{entry.num} {entry.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            max={100}
            value={level}
            aria-label="Level"
            onChange={(event) => setLevel(Number(event.target.value))}
          />
          <select value={variantId} onChange={(event) => setVariantId(event.target.value)}>
            {ALL_APPEARANCES.map((id) => (
              <option key={id} value={id}>
                {variant(id).name}
              </option>
            ))}
          </select>
          <select value={gender} onChange={(event) => setGender(event.target.value as Gender)} aria-label="Gender">
            {GENDERS.map((option) => (
              <option key={option} value={option}>
                {GENDER_NAMES[option]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="primary"
            onClick={() => send({ op: "give", speciesId, level, variantId, gender })}
          >
            Give
          </button>
        </div>

        <h3>Party</h3>
        {state.party.length ? (
          <div className="boxList">
            {state.party.map((creature, index) => (
              <div key={creature.uid} className="boxRow">
                <div className="cardBody">
                  <div className="cardTop">
                    <strong>{displayName(creature)}</strong>
                    <span className="muted">Lv{creature.level}</span>
                  </div>
                </div>
                <select
                  value={creature.variantId}
                  aria-label={`Variant for ${displayName(creature)}`}
                  onChange={(event) => send({ op: "setVariant", index, variantId: event.target.value })}
                >
                  {ALL_APPEARANCES.map((id) => (
                    <option key={id} value={id}>
                      {variant(id).name}
                    </option>
                  ))}
                </select>
                <select
                  value={creature.gender}
                  aria-label={`Gender for ${displayName(creature)}`}
                  onChange={(event) => send({ op: "setGender", index, gender: event.target.value as Gender })}
                >
                  {GENDERS.map((option) => (
                    <option key={option} value={option}>
                      {GENDER_NAMES[option]}
                    </option>
                  ))}
                </select>
                <button type="button" className="ghost small" onClick={() => send({ op: "setLevel", index, level })}>
                  Set Lv{level}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Nothing in the party yet.</p>
        )}

        <h3>Everything else</h3>
        <div className="row">
          <button type="button" onClick={() => send({ op: "heal" })}>
            Heal party
          </button>
          <button type="button" onClick={() => send({ op: "balls", count: 50 })}>
            +50 balls
          </button>
          <button type="button" onClick={() => send({ op: "items" })}>
            Grant breeding items
          </button>
        </div>

        <h3>Warp</h3>
        <div className="row">
          <select value={route} onChange={(event) => setRoute(event.target.value)}>
            {routes.map((id) => (
              <option key={id} value={id}>
                {routeLabel(id)}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => send({ op: "warp", route })}>
            Go
          </button>
        </div>
      </section>
    </div>
  );
}
