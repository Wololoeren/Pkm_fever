"use client";

import { useMemo, useState } from "react";
import {
  activeLures,
  EGGOMETER,
  activeRepel,
  holdRefusal,
  flyRefusal,
  itemRefusal,
  lureLeft,
  toolRefusal,
  type GameState,
  type Input,
} from "@/engine/engine";
import type { World } from "@/engine/world";
import { holdOf } from "@/engine/carry";
import { bagEntries, bagUse, hasItem, item, type ItemKind } from "@/engine/items";
import { displayName } from "@/lib/narrate";
import { EggSlots } from "./PartyStrip";
import { RegionMap } from "./MiniMap";
import { Handbook } from "./Handbook";
import { Doomscroller } from "./Doomscroller";
import { canLearnMachine } from "@/engine/dex";

/** The fly map. Narrower than the Grey Line's: the bag is a side column. */
const FLY_MAP = 240;

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
  { kind: "field", label: "Field" },
  { kind: "hold", label: "Held" },
  { kind: "berry", label: "Berries" },
  { kind: "stone", label: "Stones" },
  { kind: "tonic", label: "Tonics" },
  { kind: "hm", label: "Tools" },
  { kind: "tm", label: "Machines" },
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
  const [reading, setReading] = useState<"handbook" | "feed" | null>(null);
  const [tab, setTab] = useState<ItemKind | null>(null);
  const [query, setQuery] = useState("");

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
  // A search looks through the whole bag, not the tab: finding a thing is the
  // point, and knowing which tab it lives in is what you did not know.
  const searching = query.trim().length > 0;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = searching
    ? bagEntries(state.bag).filter(([id]) => {
        const spec = item(id);
        const text = `${spec.name} ${spec.blurb}`.toLowerCase();
        return words.every((word) => text.includes(word));
      })
    : (held.get(active) ?? []);

  // A selection survives switching tabs only while it is still held; using the
  // last potion should not leave a target picker for a potion you do not have.
  const selected = chosen && state.bag[chosen] ? chosen : null;

  if (!bagEntries(state.bag).length && !state.eggs.length) return <p className="muted">Your bag is empty.</p>;

  const burning = activeLures(state);
  const quiet = activeRepel(state);

  return (
    <div className="bag">
      {burning.length || quiet ? (
        <p className="good">
          {[
            ...burning.map((spec) => `${spec.name} — ${lureLeft(state, spec.id)} moves`),
            ...(quiet ? [`${item(quiet.item).name} — ${quiet.left} moves of quiet`] : []),
          ].join(" · ")}
        </p>
      ) : null}

      {/* Eggs sit above the tabs rather than in one. There is nothing to
          press on an egg — you walk, and it opens — so it is something to see
          every time the bag is open rather than something to go looking for. */}
      <EggSlots eggs={state.eggs} exact={hasItem(state.bag, EGGOMETER)} />

      <input
        type="search"
        className="boxSearch"
        placeholder="Search the bag…"
        value={query}
        aria-label="Search the bag"
        spellCheck={false}
        onChange={(event) => setQuery(event.target.value)}
      />

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
            // What pressing it does, asked of the item rather than guessed from
            // a list of kinds here. The list is how every item added after it
            // was written became a row that could not be pressed.
            const use = bagUse(spec);
            const usable = use !== null;
            const burning = spec.kind === "lure" ? lureLeft(state, id) : 0;
            const why = use === "light" ? itemRefusal(world, state, id, 0) : null;

            return (
              <button
                key={id}
                type="button"
                className={`itemCard${selected === id ? " on" : ""}`}
                disabled={!usable || Boolean(why)}
                onClick={() => {
                  // A lure, a repel and a rope have no target to pick, so
                  // pressing one *is* using it.
                  if (use === "light") onInput({ t: "useItem", item: id, index: 0 });
                  // Reading is not an input: nothing about the game changes,
                  // so nothing goes in the log.
                  else if (use === "read") setReading(spec.reads ?? "handbook");
                  else setChosen(selected === id ? null : id);
                }}
                title={
                  why ??
                  (use === "light"
                    ? "Use it"
                    : use === "hold"
                      ? "Give to…"
                      : use === "creature"
                        ? "Use on…"
                        : use === "world"
                          ? "Choose where"
                          : use === "read"
                            ? "Open it"
                          : "Nothing to use this on")
                }
              >
                <span className="itemName">
                  {spec.name} x{count}
                </span>
                <span className="muted itemBlurb">
                  {burning ? `Burning — ${burning} moves left.` : (why ?? spec.blurb)}
                </span>
                {/* Who could learn it, before it is picked: a machine is used on
                    somebody, and the somebody is the whole question. */}
                {spec.teaches ? (
                  <span className="itemBlurb small">
                    {(() => {
                      const able = state.party.filter(
                        (one) => canLearnMachine(one.speciesId, spec.teaches!) && !one.moves.includes(spec.teaches!),
                      );
                      return able.length
                        ? <span className="good">Can learn: {able.map((one) => displayName(one)).join(", ")}</span>
                        : <span className="muted">Nobody in your party can learn it.</span>;
                    })()}
                  </span>
                ) : null}
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
          {/*
           * The Grey Line's layout, for the same reason: a list of every place
           * you have walked is fine at five and unreadable at forty. The towns
           * keep their cards, and everywhere else you can land is ringed green
           * on the region map. Both read `flyRefusal`, so a place is on the map
           * exactly when the button for it would have been live.
           */}
          {(() => {
            const landable = state.visited.filter((id) => {
              const route = world.routes.get(id);
              return route && route.kind !== "interior" && flyRefusal(world, state, id) === null;
            });
            return landable.length ? (
              <div className="travelMap">
                <RegionMap
                  world={world}
                  state={state}
                  outer={state.route}
                  size={FLY_MAP}
                  reachable={landable}
                  onPick={(routeId) => {
                    onInput({ t: "fly", route: routeId });
                    setChosen(null);
                  }}
                />
                <span className="muted small">
                  {landable.length} places ringed in green — click one. The towns are below.
                </span>
              </div>
            ) : (
              <p className="muted">Nowhere to land yet.</p>
            );
          })()}
          <div className="items">
            {state.visited
              .flatMap((id) => {
                const route = world.routes.get(id);
                return route && route.kind === "town" ? [route] : [];
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
      ) : selected && holdOf(selected) ? (
        <>
          {/* A held item is given rather than used, so the verb changes and so
              does the refusal it asks. Whoever is already carrying something
              says so on the card, because handing this one over hands that one
              back and the player should be able to see what they are trading. */}
          <h4>Give the {item(selected).name} to…</h4>
          <div className="items">
            {state.party.map((creature, index) => {
              const refusal = holdRefusal(world, state, index, selected);
              const carrying = creature.heldItem ? item(creature.heldItem).name : null;
              return (
                <button
                  key={creature.uid}
                  type="button"
                  className="itemCard"
                  disabled={Boolean(refusal)}
                  title={refusal ?? undefined}
                  onClick={() => {
                    onInput({ t: "holdItem", index, item: selected });
                    setChosen(null);
                  }}
                >
                  <span className="itemName">
                    {displayName(creature)} · Lv{creature.level}
                  </span>
                  <span className="muted itemBlurb">
                    {refusal ?? (carrying ? `Swap for its ${carrying}` : "Give it")}
                  </span>
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
              const refusal = itemRefusal(world, state, selected, index);
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
      {reading === "handbook" ? <Handbook onClose={() => setReading(null)} /> : null}
      {reading === "feed" ? <Doomscroller world={world} state={state} onClose={() => setReading(null)} /> : null}
    </div>
  );
}
