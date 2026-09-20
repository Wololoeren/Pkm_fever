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
  /** The place clicked on the map, which the panel under it answers for. */
  const [zone, setZone] = useState<string | null>(null);

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
                {/* Always a picture: a dex entry without one is a list row
                    with more words. Where you hold one it is drawn as yours,
                    shine and colour and all; where you have only met the
                    species it is drawn ordinary, because that is all the dex
                    knows about it. */}
                <Sprite
                  speciesId={chosen.speciesId}
                  variantId={chosen.variantId ?? "normal"}
                  size={96}
                  marks={Boolean(chosen.variantId)}
                />
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
                onSelect={(routeId) => setZone(zone === routeId ? null : routeId)}
                selected={zone}
              />
              <p className="muted small">
                A solid ring is where you first met it; a dashed ring is a place whose table
                you have earned that says it lives there. Click any place for what lives in it.
              </p>
              <Zone world={world} dex={dex} routeId={zone} onSpecies={setPicked} />
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

/**
 * One place on the map, and what the dex knows about what lives there.
 *
 * The count is the point: how many of that zone's table you hold, out of how
 * many there are to hold. It is only a denominator once the table has been
 * earned — before `DEX_REVEAL` encounters the zone says how many more it
 * wants, because a list of everything living somewhere you have barely walked
 * would hand you the hunt rather than let you do it.
 */
function Zone({
  world,
  dex,
  routeId,
  onSpecies,
}: {
  world: World;
  dex: ReturnType<typeof dexOf>;
  routeId: string | null;
  onSpecies: (speciesId: string) => void;
}) {
  if (!routeId) return null;

  const place = world.routes.get(routeId);
  const known = dex.routes.find((one) => one.routeId === routeId);
  const label = place?.label ?? routeLabel(routeId);

  if (!place || place.kind !== "route") {
    return <p className="hint">{label} is a town. Nothing lives in the grass there, because there is none.</p>;
  }
  if (!known) {
    return <p className="hint">{label} — you have never been there.</p>;
  }
  if (!known.table) {
    const left = DEX_REVEAL - known.encounters;
    return (
      <p className="hint">
        {label} — {known.encounters} of {DEX_REVEAL} met. {left} more and the dex will list what lives here.
      </p>
    );
  }

  const by = new Map(dex.entries.map((entry) => [entry.speciesId, entry]));
  const living = known.table.map(({ speciesId }) => by.get(speciesId) ?? null);
  const caught = living.filter((entry) => entry?.caught).length;
  const seen = living.filter((entry) => entry?.seen).length;

  return (
    <div className="zoneList">
      <h4>
        {label} — caught {caught} of {known.table.length}
      </h4>
      <p className="muted small">{seen} seen. The commonest first.</p>
      <div className="items">
        {known.table.map(({ speciesId }, at) => {
          const entry = by.get(speciesId);
          const kind = speciesById(speciesId);
          return (
            <button
              key={speciesId}
              type="button"
              className={`zoneOne${entry?.caught ? " caught" : entry?.seen ? " seen" : " unseen"}`}
              title={
                entry?.caught
                  ? `${kind.name} — caught`
                  : entry?.seen
                    ? `${kind.name} — seen, not caught`
                    : `${kind.name} — never met. It lives here; you have not.`
              }
              onClick={() => onSpecies(speciesId)}
            >
              {entry?.seen ? (
                <Sprite speciesId={speciesId} variantId={entry.variantId ?? "normal"} size={48} marks={false} />
              ) : (
                <span className="zoneUnknown" aria-hidden="true">
                  ?
                </span>
              )}
              <span className="muted">
                #{at + 1} {entry?.seen ? kind.name : "—"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
