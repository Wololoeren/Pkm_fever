"use client";

import { useMemo, useState } from "react";
import {
  activeLures,
  flyRefusal,
  itemRefusal,
  lureLeft,
  toolRefusal,
  type GameState,
  type Input,
} from "@/engine/engine";
import type { World } from "@/engine/world";
import { bagEntries, item, type ItemKind } from "@/engine/items";
import { displayName } from "@/lib/narrate";

/**
 * The bag, and using what is in it.
 *
 * Only out in the field. A potion mid-battle would have to be committed and
 * revealed like a move for a duel to stay fair, and a heal the other side
 * cannot answer is the shortest road to a battle that never ends. Healing
 * between fights is the bargain the rest of the game already asks for.
 *
 * Most things here are used *on* somebody, so choosing one opens a party
 * picker. A lure is not: it is lit, and then it is simply true for a while, so
 * it goes off the moment it is pressed and reports itself at the top instead.
 */

/** The tabs, in the order they are reached for. */
const TABS: { kind: ItemKind; label: string }[] = [
  { kind: "medicine", label: "Medicine" },
  { kind: "ball", label: "Balls" },
  { kind: "hm", label: "Tools" },
  { kind: "rod", label: "Rods" },
  { kind: "lure", label: "Lures" },
  { kind: "treasure", label: "Valuables" },
  { kind: "breeding", label: "Breeding" },
  { kind: "key", label: "Keys" },
];

const DIRS: { dir: "n" | "e" | "s" | "w"; label: string }[] = [
  { dir: "n", label: "↑" },
  { dir: "w", label: "←" },
  { dir: "e", label: "→" },
  { dir: "s", label: "↓" },
];

export function BagPanel({
  world,
  state,
  onInput,
}: {
  world: World;
  state: GameState;
  onInput: (input: Input) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [tab, setTab] = useState<ItemKind | null>(null);

  const held = useMemo(() => {
    const byKind = new Map<ItemKind, [string, number][]>();
    for (const [id, count] of bagEntries(state.bag)) {
      const kind = item(id).kind;
      byKind.set(kind, [...(byKind.get(kind) ?? []), [id, count]]);
    }
    return byKind;
  }, [state.bag]);

  // The tabs are fixed so they do not rearrange themselves as the bag empties,
  // but which one opens first follows what you actually have.
  const active = tab ?? TABS.find((entry) => held.get(entry.kind)?.length)?.kind ?? "medicine";
  const rows = held.get(active) ?? [];

  // A selection survives switching tabs only while it is still held; using the
  // last potion should not leave a target picker for a potion you do not have.
  const selected = chosen && state.bag[chosen] ? chosen : null;

  if (!bagEntries(state.bag).length) return <p className="muted">Your bag is empty.</p>;

  const burning = activeLures(state);

  return (
    <div className="bag">
      {burning.length ? (
        <p className="good">
          {burning
            .map((spec) => `${spec.name} — ${lureLeft(state, spec.id)} moves`)
            .join(" · ")}
        </p>
      ) : null}

      <div className="tabs" role="tablist">
        {TABS.map((entry) => {
          const count = (held.get(entry.kind) ?? []).reduce((total, [, n]) => total + n, 0);
          return (
            <button
              key={entry.kind}
              type="button"
              role="tab"
              aria-selected={active === entry.kind}
              className={`tab${active === entry.kind ? " on" : ""}`}
              onClick={() => {
                setTab(entry.kind);
                setChosen(null);
              }}
            >
              {entry.label}
              <span className="tabCount">{count}</span>
            </button>
          );
        })}
      </div>

      {rows.length ? (
        <div className="items">
          {rows.map(([id, count]) => {
            const spec = item(id);
            // Only medicine is used on a creature; everything else is held,
            // worn or sold, and offering a target picker for a Nugget would be
            // a lie about what the button does.
            const usable =
              spec.kind === "medicine" ||
              spec.kind === "lure" ||
              spec.field === "clear" ||
              spec.field === "travel";
            const burning = spec.kind === "lure" ? lureLeft(state, id) : 0;
            const why = spec.kind === "lure" ? itemRefusal(state, id, 0) : null;

            return (
              <button
                key={id}
                type="button"
                className={`itemCard${selected === id ? " on" : ""}`}
                disabled={!usable || Boolean(why)}
                onClick={() => {
                  // A lure has no target to pick, so pressing it *is* using it.
                  if (spec.kind === "lure") onInput({ t: "useItem", item: id, index: 0 });
                  else setChosen(selected === id ? null : id);
                }}
                title={why ?? (usable ? (spec.kind === "lure" ? "Light it" : "Use on…") : "Nothing to use this on")}
              >
                <span className="itemName">
                  {spec.name} x{count}
                </span>
                <span className="muted itemBlurb">
                  {burning ? `Burning — ${burning} moves left.` : (why ?? spec.blurb)}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted">Nothing here yet.</p>
      )}

      {selected && item(selected).field === "clear" ? (
        <>
          <h4>Use {item(selected).name} which way?</h4>
          <div className="row">
            {DIRS.map(({ dir, label }) => {
              const why = toolRefusal(world, state, selected, dir);
              return (
                <button
                  key={dir}
                  type="button"
                  className="ghost"
                  disabled={Boolean(why)}
                  title={why ?? `Use it ${dir === "n" ? "north" : dir === "s" ? "south" : dir === "e" ? "east" : "west"}`}
                  onClick={() => {
                    onInput({ t: "useTool", item: selected, dir });
                    setChosen(null);
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </>
      ) : selected && item(selected).field === "travel" ? (
        <>
          <h4>Fly where?</h4>
          <div className="items">
            {state.visited
              .flatMap((id) => {
                const route = world.routes.get(id);
                return route && route.kind !== "interior" ? [route] : [];
              })
              .map((route) => {
                const why = flyRefusal(world, state, route.id);
                return (
                  <button
                    key={route.id}
                    type="button"
                    className="itemCard"
                    disabled={Boolean(why)}
                    title={why ?? `Fly to ${route.label}`}
                    onClick={() => {
                      onInput({ t: "fly", route: route.id });
                      setChosen(null);
                    }}
                  >
                    <span className="itemName">{route.label}</span>
                    <span className="muted itemBlurb">{why ?? "Fly there"}</span>
                  </button>
                );
              })}
          </div>
        </>
      ) : selected ? (
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
