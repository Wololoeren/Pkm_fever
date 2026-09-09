"use client";

import { useState } from "react";
import { itemRefusal, type GameState, type Input } from "@/engine/engine";
import { bagEntries, item } from "@/engine/items";
import { displayName } from "@/lib/narrate";

/**
 * The bag, and using what is in it.
 *
 * Only out in the field. A potion mid-battle would have to be committed and
 * revealed like a move for a duel to stay fair, and a heal the other side
 * cannot answer is the shortest road to a battle that never ends. Healing
 * between fights is the bargain the rest of the game already asks for.
 */
export function BagPanel({ state, onInput }: { state: GameState; onInput: (input: Input) => void }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const entries = bagEntries(state.bag);

  if (!entries.length) return <p className="muted">Your bag is empty.</p>;

  const selected = chosen && state.bag[chosen] ? chosen : null;

  return (
    <div className="bag">
      <div className="items">
        {entries.map(([id, held]) => {
          const spec = item(id);
          // Only medicine is used on a creature; everything else is held, worn
          // or sold, and offering a target picker for a Nugget would be a lie.
          const usable = spec.kind === "medicine";

          return (
            <button
              key={id}
              type="button"
              className={`itemCard${selected === id ? " on" : ""}`}
              disabled={!usable}
              onClick={() => setChosen(selected === id ? null : id)}
              title={usable ? "Use on…" : "Nothing to use this on"}
            >
              <span className="itemName">
                {spec.name} x{held}
              </span>
              <span className="muted itemBlurb">{spec.blurb}</span>
            </button>
          );
        })}
      </div>

      {selected ? (
        <>
          <h4>Use the {item(selected).name} on…</h4>
          <div className="items">
            {state.party.map((creature, index) => {
              const refusal = itemRefusal(state, selected, index);
              return (
                <button
                  key={creature.uid}
                  type="button"
                  className="itemCard"
                  disabled={Boolean(refusal)}
                  title={refusal ?? undefined}
                  onClick={() => {
                    onInput({ t: "useItem", item: selected, index });
                    setChosen(null);
                  }}
                >
                  <span className="itemName">
                    {displayName(creature)} · Lv{creature.level}
                  </span>
                  <span className="muted itemBlurb">{refusal ?? "Use it"}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
