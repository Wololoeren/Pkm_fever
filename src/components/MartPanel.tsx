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
 * the engine will accept. The refusal itself is not printed on the shelf: the
 * greying says "no" and the description says what the thing is, which is the
 * half you came to read.
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
  "hold",
  "berry",
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
  hold: "Held",
  berry: "Berries",
  stone: "Stones",
  tonic: "Tonics",
  rod: "Rods",
  lure: "Lures",
  breeding: "Breeding",
  treasure: "Valuables",
  hm: "Tools",
  tm: "Machines",
  key: "Keys",
  // Never on a shelf — an ink is found, not bought — but the table is keyed
  // on every kind there is, so leaving it out is a compile error rather than
  // a shelf that silently disappears.
  ink: "Inks",
};

/**
 * What a search looks at: the name, what it does, and the shelf it is on.
 *
 * Word by word, so "great ball" and "ball great" both find it, and so
 * "berry cure" narrows rather than widens. The same rule the bag and the box
 * search by, because three panels with three ideas of what a search means is
 * three panels nobody trusts.
 */
function matches(spec: { name: string; blurb: string; kind: ItemKind }, query: string): boolean {
  const haystack = `${spec.name} ${spec.blurb} ${SHELF_LABEL[spec.kind]}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

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
  const [query, setQuery] = useState("");
  const [selling, setSelling] = useState(false);

  const searching = query.trim().length > 0;

  // What is on the shelves at all, in reading order.
  const shelves = SHELF_ORDER.filter((kind) => MART_STOCK.some((spec) => spec.kind === kind));
  const open = shelf && shelves.includes(shelf) ? shelf : shelves[0];
  // A search looks through the whole shop rather than the open shelf: which
  // shelf a thing is on is exactly what you did not know.
  const stock = searching
    ? MART_STOCK.filter((spec) => matches(spec, query))
    : MART_STOCK.filter((spec) => spec.kind === open);

  // What you are carrying that the shop will take, under the same search.
  const sellable = bagEntries(state.bag).filter(([id]) => !searching || matches(item(id), query));

  return (
    <div className="mart">
      <div className="martHead">
        <h3>Mart</h3>
        <p className="muted">
          Purse <strong>¤{state.money.toLocaleString()}</strong>
        </p>
        <input
          type="search"
          className="boxSearch"
          placeholder="Search the shop…"
          value={query}
          aria-label="Search the Mart"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
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

      <h4>
        For sale{searching ? ` · ${stock.length} found` : ""}
      </h4>

      <div className="tabs" role="tablist">
        {shelves.map((kind) => {
          const hits = searching ? MART_STOCK.filter((spec) => spec.kind === kind && matches(spec, query)).length : 0;
          return (
            <button
              key={kind}
              type="button"
              role="tab"
              aria-selected={!searching && kind === open}
              // While searching the shelves are a map of where the hits are
              // rather than a choice: clicking one clears the search and
              // opens it, which is what somebody who has found the shelf
              // they wanted wants next.
              className={`tab${!searching && kind === open ? " on" : ""}${hits ? " hasHits" : ""}`}
              onClick={() => {
                setShelf(kind);
                setQuery("");
              }}
            >
              {SHELF_LABEL[kind]}
              <span className="tabCount">
                {searching ? hits : MART_STOCK.filter((spec) => spec.kind === kind).length}
              </span>
            </button>
          );
        })}
      </div>

      {searching && !stock.length ? <p className="hint">Nothing on any shelf matches that.</p> : null}

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
              /* Sighted players get the refusal from the greying; a screen
                 reader gets no greying, so it goes in the accessible name. */
              aria-label={refusal ? `${spec.name} ¤${spec.price.toLocaleString()} · ${refusal}` : undefined}
              onClick={() => onInput({ t: "buyItem", item: spec.id, count: wanted })}
            >
              <span className="itemName">
                {spec.name} · ¤{spec.price.toLocaleString()}
                {held ? ` · have ${held}` : ""}
              </span>
              {/* The description, whether or not you can buy it — a row you
                  cannot afford is exactly the row you are reading to decide
                  whether it is worth saving for, and "you cannot afford that"
                  is not news: the price is on the line above, the purse is at
                  the top of the panel, and the row is greyed out. Every other
                  refusal a rendered row can hit is equally redundant — "you
                  already have one" is the `· have 1` the name already
                  carries — and the rest cannot happen for a row that is on
                  screen. */}
              <span className="muted itemBlurb">{spec.blurb}</span>
            </button>
          );
        })}
      </div>

      <h4>
        <button
          type="button"
          className="ghost small martFold"
          aria-expanded={selling}
          onClick={() => setSelling(!selling)}
        >
          {selling ? "▾" : "▸"} Your bag · {sellable.length}
          {searching ? " found" : ""}
        </button>
      </h4>
      {!selling ? (
        <p className="hint">What you are carrying, to sell. Closed by default: a shop is for buying.</p>
      ) : sellable.length ? (
        <div className="items">
          {sellable.map(([id, held]) => {
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
