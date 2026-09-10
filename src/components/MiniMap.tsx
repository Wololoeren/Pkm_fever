"use client";

import { useEffect, useRef } from "react";
import { hasSeen, type GameState } from "@/engine/engine";
import { TILE } from "@/engine/terrain";
import { HUB_ID, type Route, type World } from "@/engine/world";
import { paletteFor, tileColor } from "@/render/tiles";

/**
 * Two maps, because there are two questions.
 *
 * "Where am I on this route" and "where is this route in the world" are not
 * the same thing, and one picture answers them badly. So: a scaled-down view
 * of the map you are standing on, and under it the corridor diagram of the
 * region.
 *
 * The region diagram is not a shrunken map either — it is the graph. Fifty
 * places on a lattice around one town, a dot each, joined by a line wherever
 * you can walk from one to the other.
 *
 * It used to be a fan of twenty arms, and a fan was the honest picture of a
 * world where the only questions were which arm and how far out. There are no
 * arms now: there are loops, junctions and a few blind ends, and the useful
 * question is "what have I not walked yet". So the dots are drawn at the cells
 * the places actually occupy and the lines at the crossings that actually
 * exist, which makes this a drawing of the world rather than a diagram of it.
 */

const MINI_WIDTH = 176;

export function MiniMap({ world, state }: { world: World; state: GameState }) {
  const route = world.routes.get(state.route);
  // Standing indoors, the region map should still light up the town you are
  // indoors in — a door is not a journey.
  const outer = route?.kind === "interior" ? (route.parent ?? state.route) : state.route;

  return (
    <div className="miniMap">
      {/* Where you are, over the map of it. The header at the top of the page
          says it too, but the header is a long way from the picture and the
          picture is the thing you are reading when you want to know. */}
      <h3 className="miniWhere">{route?.label ?? "Nowhere"}</h3>
      <LocalMap world={world} state={state} />
      <RegionMap world={world} state={state} outer={outer} />
    </div>
  );
}

/**
 * The map you are standing on, small, and only the parts you have looked at.
 *
 * It drew the whole route before, which made it a satellite photograph: you
 * arrived somewhere new and the map already knew the way through. Fog turns it
 * into what a small map should be — a record of where you have been, and a
 * picture of how much of a place is left.
 *
 * What counts as looked at is `hasSeen`, folded in the engine from what the
 * camera showed you. Coarser than a tile, so it reads as regions of a route
 * rather than a torch beam; see `FOG`.
 */
function LocalMap({ world, state }: { world: World; state: GameState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const route = world.routes.get(state.route);
  // Routes are 88x68, so the floor has to come down or the local map is half
  // again wider than the column it sits in. Interiors, being tiny, still get
  // fat pixels.
  const cell = route ? Math.max(2, Math.min(9, Math.floor(MINI_WIDTH / route.width))) : 4;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !route) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const seen = (x: number, y: number) => hasSeen(state, route, x, y);

    for (let y = 0; y < route.height; y++) {
      for (let x = 0; x < route.width; x++) {
        const tile = route.tiles[y * route.width + x];
        // Unwalked ground is drawn rather than left blank, so the shape of the
        // canvas still tells you how big the place is.
        ctx.fillStyle = seen(x, y) ? tileColor(route.biome, tile, x, y) : "#141920";
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }

    // Doors, because on a map the size of a stamp a brown tile in a red roof
    // is invisible and knowing where you can go in is the whole point.
    ctx.fillStyle = "#ffd98a";
    for (const door of route.doors) {
      if (!seen(door.x, door.y)) continue;
      ctx.fillRect(door.x * cell, door.y * cell, cell, cell);
    }
    for (let y = 0; y < route.height; y++) {
      for (let x = 0; x < route.width; x++) {
        if (route.tiles[y * route.width + x] !== TILE.EXIT) continue;
        if (!seen(x, y)) continue;
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }

    // People still standing. Beaten trainers are off the map: they are
    // scenery now, and drawing them would suggest a fight that is not there.
    // Nor is anybody drawn on ground you have not looked at — the map cannot
    // know about somebody you have never seen.
    ctx.fillStyle = "#5b86d6";
    for (const trainer of world.trainers.get(route.id) ?? []) {
      if (state.beaten.includes(trainer.id)) continue;
      if (!seen(trainer.x, trainer.y)) continue;
      ctx.fillRect(trainer.x * cell, trainer.y * cell, cell, cell);
    }

    const px = state.x * cell + cell / 2;
    const py = state.y * cell + cell / 2;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2.5, cell * 0.7), 0, Math.PI * 2);
    ctx.fillStyle = "#d8524a";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#12161d";
    ctx.stroke();
  }, [world, state, route, cell]);

  if (!route) return null;

  return (
    // No caption: the header above the map already names where you are, and
    // saying it twice on one screen is one label too many.
    <div className="miniLocal">
      <canvas
        ref={ref}
        width={route.width * cell}
        height={route.height * cell}
        aria-label={`Map of ${route.label}`}
      />
    </div>
  );
}

/** The region: the whole graph, and which dot you are standing on. */
function RegionMap({ world, state, outer }: { world: World; state: GameState; outer: string }) {
  const size = MINI_WIDTH;
  const pad = 9;

  // Every place that has a cell — the fifty routes and the town. Interiors do
  // not: a room behind a door is not anywhere on the lattice.
  const places = [...world.routes.values()].filter(
    (route) => route.kind === "route" || route.kind === "town",
  );

  // The lattice is lumpy and off-centre by construction, so its extent is
  // measured rather than assumed, and the shorter axis is centred inside the
  // square. Scaled by the longer axis so a world that grew wide is drawn
  // wide rather than squashed to fit.
  const minX = Math.min(...places.map((place) => place.cell.x));
  const maxX = Math.max(...places.map((place) => place.cell.x));
  const minY = Math.min(...places.map((place) => place.cell.y));
  const maxY = Math.max(...places.map((place) => place.cell.y));
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const step = (size - pad * 2) / span;

  const at = (cell: { x: number; y: number }) => ({
    x: pad + (cell.x - minX) * step + ((span - (maxX - minX)) * step) / 2,
    y: pad + (cell.y - minY) * step + ((span - (maxY - minY)) * step) / 2,
  });

  const dot = Math.max(2.4, Math.min(5, step * 0.34));

  // One line per crossing rather than two. Borders are written from both
  // sides — that is what makes stepping out and back a round trip — so the
  // pairs are deduplicated here by name.
  const drawn = new Set<string>();
  const edges: { from: Route; to: Route; walked: boolean }[] = [];
  for (const place of places) {
    for (const border of place.borders) {
      const other = world.routes.get(border.to);
      if (!other || (other.kind !== "route" && other.kind !== "town")) continue;
      const key = place.id < other.id ? `${place.id}|${other.id}` : `${other.id}|${place.id}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      edges.push({
        from: place,
        to: other,
        // Both ends walked. Drawn brighter, which is what turns the picture
        // from a diagram of the world into a record of where you have been:
        // the dim lines are the ones still to take.
        walked: [place, other].every(
          (end) => end.id === HUB_ID || state.visited.includes(end.id),
        ),
      });
    }
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Map of the region">
      {edges.map(({ from, to, walked }) => {
        const a = at(from.cell);
        const b = at(to.cell);
        return (
          <line
            key={`${from.id}|${to.id}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            // `--line` is a hairline against a panel and vanished entirely at
            // this size: sixty-four crossings were being drawn and none of
            // them could be seen, which left the map a field of loose dots.
            stroke="var(--muted)"
            strokeOpacity={walked ? 0.85 : 0.3}
            strokeWidth={walked ? 2 : 1.25}
          />
        );
      })}

      {places.map((place) => {
        const here = at(place.cell);
        // By kind, not by id: there are four towns now and only one of them
        // is home.
        const town = place.kind === "town";
        // `town ||` used to be here, from when there was one town and it was
        // where you started. With four of them that read as "every town has
        // been visited", so the map handed you the location of three towns you
        // had never walked to.
        const visited = state.visited.includes(place.id);
        const current = place.id === outer;
        const palette = paletteFor(place.biome);

        return (
          // No labels. Fifty names in a 176px square would be ink rather than
          // answer; the places are told apart by the colour of the ones you
          // have walked, and hovering one names it.
          <circle
            key={place.id}
            cx={here.x}
            cy={here.y}
            r={current ? dot + 2 : town ? dot + 1 : dot}
            // Unwalked places are drawn but empty: the shape of the world is
            // not a secret, only what is in it.
            fill={town ? (visited ? "var(--accent)" : "var(--panel-2)") : visited ? palette.grass : "var(--bg)"}
            stroke={current ? "var(--accent)" : "var(--muted)"}
            strokeOpacity={current || visited ? 1 : 0.45}
            strokeWidth={current ? 3 : 1.25}
          >
            <title>
              {`${place.label}${town ? " — a town" : ""}${visited ? "" : " — not yet visited"}`}
            </title>
          </circle>
        );
      })}
    </svg>
  );
}
