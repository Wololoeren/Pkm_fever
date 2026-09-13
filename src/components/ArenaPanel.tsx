"use client";

import { arena, ARENA_ROUNDS, ARENA_SIZE } from "@/engine/arenas";
import { species as speciesById } from "@/engine/dex";
import {
  arenaField,
  arenaFightRefusal,
  arenaPrizes,
  arenaPrizeRefusal,
  arenaTeam,
  type GameState,
  type Input,
} from "@/engine/engine";
import { STAT_IDS } from "@/engine/types";
import { variant } from "@/engine/variants";
import type { World } from "@/engine/world";
import { GenderMark, VariantTag } from "./PartyStrip";
import { Sprite } from "./Sprite";

/**
 * A bracket you are part-way through, out in the field.
 *
 * It follows you rather than living with the person who runs it, because a
 * knockout is three fights with a walk between them and having to go back and
 * ask permission for each one would be three walks nobody wants. The host
 * takes your entry; the bracket is then yours until you win it or lose it.
 *
 * Everything here is read off three numbers on the state — see `state.arena`.
 * There is no second copy of the draw for this to disagree with.
 */
export function ArenaPanel({
  world,
  state,
  onInput,
}: {
  world: World;
  state: GameState;
  onInput: (input: Input) => void;
}) {
  if (!state.arena) return null;

  const spec = arena(state.arena.id);
  const round = state.arena.round;
  const done = round >= ARENA_ROUNDS;
  const field = arenaField(state);
  const next = done ? [] : arenaTeam(world, state);

  return (
    <section className="panel hubCol">
      <h3>
        {spec.title} · {spec.teamSize}v{spec.teamSize}
      </h3>

      {/* The draw as a row of names. The other seven are the machine and the
          panel says so — see the note in engine.ts about why their matches
          are not simulated. */}
      <p className="muted">
        {done
          ? "You took it. Three rounds, seven of them, and one of you left."
          : `Round ${round + 1} of ${ARENA_ROUNDS}. ${ARENA_SIZE - 1} of the draw are the machine.`}
      </p>
      <div className="row">
        {field.map((name, at) => (
          <span key={name} className={`tag${at < round ? " fall" : ""}`}>
            {name}
          </span>
        ))}
      </div>

      {done ? (
        <>
          <h4>Pick one</h4>
          <p className="muted">
            Three at level 1, rolled from a field of {ARENA_SIZE}. The bigger the bracket the
            better the odds — on shine, colour, abilities and breeding alike.
          </p>
          <div className="starterGrid">
            {arenaPrizes(world, state).map((creature, index) => {
              const entry = speciesById(creature.speciesId);
              const why = arenaPrizeRefusal(state, index);
              return (
                <button
                  key={creature.speciesId}
                  type="button"
                  className="starterCard"
                  disabled={Boolean(why)}
                  title={why ?? entry.name}
                  onClick={() => onInput({ t: "arenaPrize", index })}
                >
                  <Sprite speciesId={creature.speciesId} variantId={creature.variantId} size={96} />
                  <strong>
                    {entry.name} <GenderMark gender={creature.gender} />
                  </strong>
                  <VariantTag variantId={creature.variantId} />
                  <p className="muted">
                    IVs {STAT_IDS.reduce((sum, stat) => sum + creature.ivs[stat], 0)}/186
                    {creature.abilities.length
                      ? ` · ${creature.abilities.length} ${
                          creature.abilities.length === 1 ? "ability" : "abilities"
                        }`
                      : ""}
                  </p>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          {/* What is across the table, before you commit to it. The same
              courtesy the gym panel extends: you can see what you are
              walking into. */}
          <div className="row">
            {next.map((one) => (
              <span key={one.uid} className="tag">
                {speciesById(one.speciesId).name} Lv{one.level}
                {variant(one.variantId).tier > 0 ? " ✦" : ""}
              </span>
            ))}
          </div>
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={Boolean(arenaFightRefusal(state))}
              title={arenaFightRefusal(state) ?? "Play it"}
              onClick={() => onInput({ t: "arenaFight" })}
            >
              Play round {round + 1}
            </button>
            <span className="muted">
              {arenaFightRefusal(state) ?? "Lose this and you are out of the draw."}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
