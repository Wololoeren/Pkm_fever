"use client";

import { species as speciesById } from "@/engine/dex";
import type { GameState } from "@/engine/engine";
import { DEX_REVEAL, dexOf } from "@/engine/pokedex";
import type { World } from "@/engine/world";
import { routeLabel } from "@/render/tiles";
import { typeColor } from "@/render/palette";

/**
 * Seen and caught, per species; and what a route has shown you.
 *
 * The one panel in the game that is allowed a denominator, and it earns it: a
 * route's table is shown only after the route has been asked `DEX_REVEAL`
 * times. Before that, the route says how many more it wants and nothing else.
 */
export function DexPanel({ world, state }: { world: World; state: GameState }) {
  const dex = dexOf(world, state);

  return (
    <div className="dex">
      <p className="muted notesCount">
        Seen <strong>{dex.seen}</strong> · caught <strong>{dex.caught}</strong> of{" "}
        <strong>{dex.total}</strong>.
      </p>

      {dex.entries.length ? (
        <ul className="dexList">
          {dex.entries.map((entry) => (
            <li key={entry.speciesId} className={entry.caught ? "caught" : "seen"}>
              <span className="muted dexNum">#{entry.num}</span>{" "}
              <span
                className="dexName"
                style={{ borderLeftColor: typeColor(speciesById(entry.speciesId).types[0]) }}
              >
                {entry.name}
              </span>{" "}
              <span className={`tag ${entry.caught ? "rise" : ""}`}>{entry.caught ? "CAUGHT" : "SEEN"}</span>
              {entry.where ? (
                <span className="muted small"> · {world.routes.get(entry.where)?.label ?? routeLabel(entry.where)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nothing yet. Everything you meet gets a line here.</p>
      )}

      {dex.routes.length ? (
        <>
          <h4>Routes</h4>
          {dex.routes.map((route) => (
            <div key={route.routeId} className="dexRoute">
              <strong>{route.label}</strong>{" "}
              {route.table ? (
                <span className="muted">
                  ·{" "}
                  {route.table
                    .map(({ speciesId }) => speciesById(speciesId).name)
                    .join(", ")}
                </span>
              ) : (
                <span className="muted">
                  · {DEX_REVEAL - route.encounters} more{" "}
                  {DEX_REVEAL - route.encounters === 1 ? "encounter" : "encounters"} before it shows what lives here
                </span>
              )}
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}
