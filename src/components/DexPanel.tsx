"use client";

import { useMemo, useState } from "react";
import { species as speciesById } from "@/engine/dex";
import type { GameState } from "@/engine/engine";
import { DEX_REVEAL, dexOf, searchDex, type DexEntry } from "@/engine/pokedex";
import type { World } from "@/engine/world";
import { routeLabel } from "@/render/tiles";
import { typeColor } from "@/render/palette";
import { RegionMap } from "./MiniMap";
import { Sprite } from "./Sprite";

/**
 * Seen and caught, per species; and where.
 *
 * A list you can search, and beside it the one you picked: its sprite, its
 * types, where you first met it, and the region map with that place ringed —
 * and, dashed, every place whose table you have earned that says it lives
 * there. The map is the same drawing as the one under the field map, with
 * marks on it; a second region map that disagreed with the first would be a
 * second world.
 *
 * The one panel in the game that is allowed a denominator, and it earns it: a
 * route's table is shown only after the route has been asked `DEX_REVEAL`
 * times. Before that, the route says how many more it wants and nothing else.
 */
export function DexPanel({ world, state }: { world: World; state: GameState }) {
  const dex = useMemo(() => dexOf(world, state), [world, state]);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  const shown = useMemo(() => searchDex(dex.entries, query), [dex, query]);
  const chosen: DexEntry | null =
    dex.entries.find((entry) => entry.speciesId === picked) ?? shown[0] ?? null;

  const placeName = (routeId: string) => world.routes.get(routeId)?.label ?? routeLabel(routeId);

  return (
    <div className="dex">
      <p className="muted notesCount">
        Seen <strong>{dex.seen}</strong> · caught <strong>{dex.caught}</strong> of{" "}
        <strong>{dex.total}</strong>.
      </p>

      {dex.entries.length ? (
        <div className="dexLayout">
          <div className="dexSide">
            <input
              className="dexSearch"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search a name, a number, a type, or caught"
              aria-label="Search the Pokédex"
              spellCheck={false}
            />
            {shown.length ? (
              <ul className="dexList">
                {shown.map((entry) => (
                  <li key={entry.speciesId}>
                    <button
                      type="button"
                      className={`dexRow${chosen?.speciesId === entry.speciesId ? " picked" : ""}`}
                      onClick={() => setPicked(entry.speciesId)}
                    >
                      <span className="muted dexNum">#{entry.num}</span>
                      <span
                        className="dexName"
                        style={{ borderLeftColor: typeColor(speciesById(entry.speciesId).types[0]) }}
                      >
                        {entry.name}
                      </span>
                      <span className={`tag ${entry.caught ? "rise" : ""}`}>{entry.caught ? "CAUGHT" : "SEEN"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Nothing you have seen matches that.</p>
            )}
          </div>

          {chosen ? (
            <div className="dexCard">
              <div className="dexCardHead">
                {/* Only when you hold one: the picture is that creature's,
                    and a species you have only met has nobody to draw. */}
                {chosen.variantId ? (
                  <Sprite speciesId={chosen.speciesId} variantId={chosen.variantId} size={48} />
                ) : null}
                <div>
                  <strong>
                    #{chosen.num} {chosen.name}
                  </strong>
                  <div className="types">
                    {speciesById(chosen.speciesId).types.map((type) => (
                      <span key={type} className="typePill" style={{ background: typeColor(type) }}>
                        {type}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <p className="muted small">
                {chosen.caught ? "Caught." : "Seen, not yet caught."} First met on{" "}
                <strong>{chosen.where ? placeName(chosen.where) : "somewhere"}</strong>.
                {chosen.livesOn.length ? (
                  <>
                    {" "}
                    Lives on {chosen.livesOn.map(placeName).join(", ")}.
                  </>
                ) : (
                  " Nowhere has shown you its table yet."
                )}
              </p>
              <RegionMap
                world={world}
                state={state}
                outer={state.route}
                marks={[
                  ...(chosen.where ? [{ routeId: chosen.where, kind: "met" as const }] : []),
                  ...chosen.livesOn.map((routeId) => ({ routeId, kind: "lives" as const })),
                ]}
              />
              <p className="muted small">
                A solid ring is where you first met it; a dashed ring is a place whose table
                you have earned that says it lives there.
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="muted">Nothing yet. Everything you meet gets a line here.</p>
      )}

      {dex.routes.length ? (
        <details className="dexRoutes">
          <summary>
            <h4>Routes · {dex.routes.filter((route) => route.table).length} tables earned</h4>
          </summary>
          {dex.routes.map((route) => (
            <div key={route.routeId} className="dexRoute">
              <strong>{route.label}</strong>{" "}
              {route.table ? (
                <span className="muted">
                  ·{" "}
                  {route.table.map(({ speciesId }) => speciesById(speciesId).name).join(", ")}
                </span>
              ) : (
                <span className="muted">
                  · {DEX_REVEAL - route.encounters} more{" "}
                  {DEX_REVEAL - route.encounters === 1 ? "encounter" : "encounters"} before it shows what
                  lives here
                </span>
              )}
            </div>
          ))}
        </details>
      ) : null}
    </div>
  );
}
