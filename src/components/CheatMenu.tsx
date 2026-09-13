"use client";

import { useMemo, useState } from "react";
import { ALL_SPECIES, species as speciesById } from "@/engine/dex";
import { BRACKET_SIZES, type BracketSize } from "@/engine/bracket";
import { cheatPrizeOffer, prizeIvFloor } from "@/engine/prize";
import { STAT_IDS } from "@/engine/types";
import { Sprite } from "./Sprite";
import { GENDER_NAMES, GENDERS, type Gender } from "@/engine/gender";
import { atFullHealth, withMoves, type Cheat, type GameState, type Input } from "@/engine/engine";
import type { Individual } from "@/engine/types";
import { Inspect } from "./Inspect";
import { ALL_APPEARANCES, variant } from "@/engine/variants";
import type { World } from "@/engine/world";
import { displayName } from "@/lib/narrate";

/**
 * Testing shortcuts, behind Ctrl+Shift+Alt+Z, and only under `npm run dev`
 * (see `CHEATS_AVAILABLE` in app/page.tsx).
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
  /**
   * Which field the prize bench is previewing, and which roll of it.
   *
   * The roll is local until something is taken: rerolling is looking, and
   * looking is not a decision the save has any business recording. What
   * *is* recorded is the roll that was finally taken from, which is what lets
   * the same log produce the same creature.
   */
  const [prizeSize, setPrizeSize] = useState<BracketSize>(4);
  const [prizeRoll, setPrizeRoll] = useState(0);
  /** The bench prize whose stat screen is open, or null. */
  const [peeking, setPeeking] = useState<Individual | null>(null);

  const send = (cheat: Cheat) => onInput({ t: "cheat", cheat });

  // 1,134 species in a native select is fine and searchable by typing; a
  // custom combobox here would be scaffolding for scaffolding.
  const species = useMemo(() => [...ALL_SPECIES].sort((a, b) => a.num - b.num), []);
  // Routes carry their own label now, so ask them. Deriving one from the id
  // put every interior in the list as "Hub · ring 0 · indoors" — four
  // identical rows and no way to tell the daycare from a house.
  /**
   * The three this field and roll would offer.
   *
   * Computed here exactly as the engine will compute it when one is taken —
   * same function, same arguments — so what is on screen is what arrives, and
   * a bench that quietly showed something else would be worse than no bench.
   *
   * Finished the way the engine finishes one on arrival (moves, full health,
   * the cheat mark), so the stat screen shows the creature that would arrive
   * rather than a bare roll with no moves and no health.
   */
  const prizes = useMemo(
    () =>
      cheatPrizeOffer(world.seed, prizeRoll, prizeSize, state.nextUid).map((one) =>
        atFullHealth(withMoves({ ...one, cheat: true })),
      ),
    [prizeRoll, prizeSize, state.nextUid, world.seed],
  );

  const routes = useMemo(
    () =>
      [...world.routes.values()]
        .map((route) => ({
          id: route.id,
          label:
            route.kind === "interior"
              ? `${world.routes.get(route.parent ?? "")?.label ?? "Somewhere"} · ${route.label}`
              : route.label,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [world],
  );

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

        <h3>Bracket prize</h3>
        <p className="muted">
          What winning a field of this size offers. Four wins and three other people, without the
          four wins or the three other people — the odds on shine, colour, abilities and breeding
          all climb with the field, so the point of the bench is seeing that they do.
        </p>
        <div className="row">
          {BRACKET_SIZES.map((one) => (
            <button
              key={one}
              type="button"
              className={prizeSize === one ? "primary" : "ghost"}
              onClick={() => setPrizeSize(one)}
            >
              {one} players
            </button>
          ))}
          <button type="button" className="ghost" onClick={() => setPrizeRoll((one) => one + 1)}>
            Reroll
          </button>
          <span className="muted">
            IVs from {prizeIvFloor(prizeSize)}/31 · roll {prizeRoll}
          </span>
        </div>
        <div className="boxList">
          {prizes.map((creature, index) => (
            <div key={creature.speciesId} className="boxRow">
              <Sprite speciesId={creature.speciesId} variantId={creature.variantId} size={24} />
              <div
                className="cardBody clickable"
                role="button"
                tabIndex={0}
                title="Show stats"
                onClick={() => setPeeking(creature)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setPeeking(creature);
                  }
                }}
              >
                <div className="cardTop">
                  <strong>{speciesById(creature.speciesId).name}</strong>
                  <span className="muted">Lv{creature.level}</span>
                </div>
                <span className="muted">
                  {variant(creature.variantId).name} · IVs{" "}
                  {STAT_IDS.reduce((total, stat) => total + creature.ivs[stat], 0)}/186
                  {creature.abilities.length
                    ? ` · ${creature.abilities.join(", ")}`
                    : " · no ability"}
                </span>
              </div>
              <button
                type="button"
                className="ghost small"
                onClick={() => send({ op: "prize", size: prizeSize, roll: prizeRoll, index })}
              >
                Take
              </button>
            </div>
          ))}
        </div>

        <h3>Warp</h3>
        <div className="row">
          <select value={route} onChange={(event) => setRoute(event.target.value)}>
            {routes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => send({ op: "warp", route })}>
            Go
          </button>
        </div>
      </section>

      {/* Read-only: index -1 is "not in the party", so it cannot edit moves.
          Drawn after the menu so it sits over it, and closing it lands back on
          the bench rather than out of the menu. */}
      {peeking ? (
        <Inspect
          world={world}
          creature={peeking}
          index={-1}
          state={state}
          onInput={onInput}
          onClose={() => setPeeking(null)}
        />
      ) : null}
    </div>
  );
}
