"use client";

import { useState } from "react";
import { maxHp } from "@/engine/battle";
import { move as moveById } from "@/engine/dex";
import { fieldMoveRefusal, type GameState, type Input } from "@/engine/engine";
import { fieldUse, fieldUseLabel, needsTarget } from "@/engine/fieldmoves";
import { ppLeft } from "@/engine/pp";
import type { World } from "@/engine/world";
import { displayName } from "@/lib/narrate";

/**
 * The moves your party can use out here.
 *
 * The HMs in this game are items — Cut, Surf, Strength and the rest are keys
 * in the bag, and `OBSTACLES` in terrain.ts names the tool each tile wants. So
 * this panel is not "the HM menu"; it is the other half of the idea, the moves
 * that *do* something rather than opening something: shake a tree, draw
 * whatever is in the grass, walk home, fill in the map, hand over some health.
 *
 * Every button asks the engine's own `fieldMoveRefusal` for whether it can be
 * pressed and what to say if not — one predicate, two callers, so the panel
 * greys exactly what the engine refuses and in the same words. Computing a
 * second opinion here is how a button that throws gets shipped.
 *
 * Nothing is listed when nobody has one, rather than an empty panel: a heading
 * over nothing is a thing the player has to read to learn that there is
 * nothing to read.
 */
export function FieldMovePanel({
  world,
  state,
  onInput,
}: {
  world: World;
  state: GameState;
  onInput: (input: Input) => void;
}) {
  /** Which move is waiting to be told who it is for. */
  const [pointing, setPointing] = useState<{ index: number; moveIndex: number } | null>(null);

  // Every (creature, move) pair that has any use out here at all. Built from
  // the party rather than from the table, so the order is party order — which
  // is the order the player already has in their head.
  const usable = state.party.flatMap((creature, index) =>
    creature.moves.flatMap((moveId, moveIndex) => {
      const use = fieldUse(moveId);
      return use ? [{ creature, index, moveId, moveIndex, use }] : [];
    }),
  );

  if (!usable.length) return null;

  const aiming = pointing
    ? usable.find((one) => one.index === pointing.index && one.moveIndex === pointing.moveIndex)
    : undefined;

  return (
    <section className="panel">
      <h3>Out here</h3>

      {aiming ? (
        <>
          <p className="prompt">
            {moveById(aiming.moveId).name} from {displayName(aiming.creature)} — on whom?
          </p>
          <div className="items">
            {state.party.map((target, to) => {
              const refusal = fieldMoveRefusal(world, state, aiming.index, aiming.moveIndex, to);
              return (
                <button
                  key={target.uid}
                  type="button"
                  className="itemCard"
                  disabled={Boolean(refusal)}
                  title={refusal ?? undefined}
                  onClick={() => {
                    setPointing(null);
                    onInput({ t: "fieldMove", index: aiming.index, moveIndex: aiming.moveIndex, to });
                  }}
                >
                  <span className="itemName">
                    {displayName(target)} · Lv{target.level}
                  </span>
                  {/* The refusal stays out of the description line here for
                      the same reason it does on the Mart's shelves: the greying
                      already says no, and what the row is for is the half you
                      are reading. */}
                  <span className="muted itemBlurb">
                    {target.hp}/{maxHp(target)}
                  </span>
                </button>
              );
            })}
          </div>
          <button type="button" className="ghost" onClick={() => setPointing(null)}>
            Back
          </button>
        </>
      ) : (
        <div className="items">
          {usable.map(({ creature, index, moveId, moveIndex, use }) => {
            const wants = needsTarget(use);
            // Asked with nobody named, so what comes back is about the
            // move and the place. A move that wants a target answers "on
            // whom?", which is not a refusal here — it is the question the
            // next screen exists to ask.
            const refusal = fieldMoveRefusal(world, state, index, moveIndex);
            const blocked = wants && refusal === "on whom?" ? null : refusal;

            return (
              <button
                key={`${creature.uid}:${moveIndex}`}
                type="button"
                className="itemCard"
                disabled={Boolean(blocked)}
                title={blocked ?? undefined}
                onClick={() =>
                  wants
                    ? setPointing({ index, moveIndex })
                    : onInput({ t: "fieldMove", index, moveIndex })
                }
              >
                <span className="itemName">
                  {moveById(moveId).name} · {displayName(creature)}
                  <span className="muted"> · {ppLeft(creature, moveIndex)} left</span>
                </span>
                <span className="muted itemBlurb">{fieldUseLabel(use)}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
