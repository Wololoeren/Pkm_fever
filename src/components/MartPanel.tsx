"use client";

import { useState } from "react";
import { buyRefusal, sellRefusal, type GameState, type Input } from "@/engine/engine";
import { bagEntries, countOf, item, MART_STOCK, type ItemKind } from "@/engine/items";
import type { World } from "@/engine/world";

/**
 * The Mart: the only place money turns into anything.
 *
 * Buying and selling both refuse through the engine's own predicates rather
 * than a second opinion computed here, so a row that looks affordable is one
 * the engine will accept — and a row that is greyed out says why in the same
 * words the refusal would have used.
 */
/**
 * The shelves, in the order somebody actually reaches for them.
 *
 * The stock used to be one flat list, which was fine at fifteen rows. It is
 * seventy-three now — ten stones, twelve tonics, twenty-five mints — and
 * twenty-five near-identical mints at the top of a single grid buries the
 * potions underneath them. Same fix the bag already had, and the labels are
 * the bag's labels so one thing is called one thing in both places.
 *
 * Derived from what is actually priced rather than listed: a kind nobody
 * stocks does not get an empty shelf, and a new priced kind cannot go missing
 * from the shop by being forgotten here.
 */
const SHELF_ORDER: readonly ItemKind[] = [
  "medicine",
  "ball",
  "field",
  "stone",
  "tonic",
  "rod",
  "lure",
  "breeding",
  "treasure",
  "hm",
  "tm",
  "key",
];

const SHELF_LABEL: Record<ItemKind, string> = {
  medicine: "Medicine",
  ball: "Balls",
  field: "Field",
  stone: "Stones",
  tonic: "Tonics",
  rod: "Rods",
  lure: "Lures",
  breeding: "Breeding",
  treasure: "Valuables",
  hm: "Tools",
  tm: "Machines",
  key: "Keys",
};

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
  const [shelf, setShelf] = useState<ItemKind | null>(null);

  // What is on the shelves at all, in reading order.
  const shelves = SHELF_ORDER.filter((kind) => MART_STOCK.some((spec) => spec.kind === kind));
  const open = shelf && shelves.includes(shelf) ? shelf : shelves[0];
  const stock = MART_STOCK.filter((spec) => spec.kind === open);

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

      <div className="tabs" role="tablist">
        {shelves.map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={kind === open}
            className={kind === open ? "tab on" : "tab"}
            onClick={() => setShelf(kind)}
          >
            {SHELF_LABEL[kind]}
            <span className="tabCount">
              {MART_STOCK.filter((spec) => spec.kind === kind).length}
            </span>
          </button>
        ))}
      </div>

      <div className="items">
        {stock.map((spec) => {
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
