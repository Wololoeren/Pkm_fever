"use client";

import { useState } from "react";
import { buyRefusal, sellRefusal, type GameState, type Input } from "@/engine/engine";
import { bagEntries, countOf, item, MART_STOCK } from "@/engine/items";
import type { World } from "@/engine/world";

/**
 * The Mart: the only place money turns into anything.
 *
 * Buying and selling both refuse through the engine's own predicates rather
 * than a second opinion computed here, so a row that looks affordable is one
 * the engine will accept — and a row that is greyed out says why in the same
 * words the refusal would have used.
 */
export function MartPanel({
  world,
  state,
  onInput,
}: {
  world: World;
  state: GameState;
  onInput: (input: Input) => void;
}) {
  const [count, setCount] = useState(1);

  return (
    <div className="mart">
      <div className="martHead">
        <h3>Mart</h3>
        <p className="muted">
          Purse <strong>¤{state.money.toLocaleString()}</strong>
        </p>
        <label className="martCount">
          How many
          <input
            type="number"
            min={1}
            max={99}
            value={count}
            onChange={(event) => setCount(Math.max(1, Math.min(99, Number(event.target.value) || 1)))}
          />
        </label>
      </div>

      <h4>For sale</h4>
      <div className="items">
        {MART_STOCK.map((spec) => {
          // Equipment is one and done, so the counter does not apply to it.
          const wanted = spec.stacks ? count : 1;
          const refusal = buyRefusal(world, state, spec.id, wanted);
          const held = countOf(state.bag, spec.id);

          return (
            <button
              key={spec.id}
              type="button"
              className="itemCard"
              disabled={Boolean(refusal)}
              title={refusal ?? `Buy ${wanted} for ¤${(spec.price * wanted).toLocaleString()}`}
              onClick={() => onInput({ t: "buyItem", item: spec.id, count: wanted })}
            >
              <span className="itemName">
                {spec.name} · ¤{spec.price.toLocaleString()}
                {held ? ` · have ${held}` : ""}
              </span>
              <span className="muted itemBlurb">{refusal ?? spec.blurb}</span>
            </button>
          );
        })}
      </div>

      <h4>Your bag</h4>
      {bagEntries(state.bag).length ? (
        <div className="items">
          {bagEntries(state.bag).map(([id, held]) => {
            const spec = item(id);
            const wanted = Math.min(count, held);
            const refusal = sellRefusal(world, state, id, wanted);

            return (
              <button
                key={id}
                type="button"
                className="itemCard"
                disabled={Boolean(refusal)}
                title={refusal ?? `Sell ${wanted} for ¤${(spec.sell * wanted).toLocaleString()}`}
                onClick={() => onInput({ t: "sellItem", item: id, count: wanted })}
              >
                <span className="itemName">
                  {spec.name} x{held}
                </span>
                <span className="muted itemBlurb">
                  {refusal ?? `Sells for ¤${spec.sell.toLocaleString()} each.`}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted">Nothing to sell.</p>
      )}
    </div>
  );
}
