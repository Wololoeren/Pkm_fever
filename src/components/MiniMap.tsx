"use client";

import { useEffect, useRef } from "react";
import type { GameState } from "@/engine/engine";
import { TILE } from "@/engine/terrain";
import { HUB_ID, routeId, type World } from "@/engine/world";
import { paletteFor, tileColor } from "@/render/tiles";

/**
 * Two maps, because there are two questions.
 *
 * "Where am I on this route" and "where is this route in the world" are not
 * the same thing, and one picture answers them badly. So: a scaled-down view
 * of the map you are standing on, and under it the corridor diagram of the
 * region.
 *
 * The corridor diagram is not a shrunken map either. The world is a town with
 * four arms running outward and difficulty is one-dimensional along each arm,
 * so the useful question is "which arm, how far out" rather than "which
 * pixel". The four arms are drawn where they actually lie: west, north, east
 * and south, in the order the town's exits open onto them.
 */

const ARM_ANGLES = [180, 270, 0, 90];
const MINI_WIDTH = 176;

export function MiniMap({ world, state }: { world: World; state: GameState }) {
  const route = world.routes.get(state.route);
  // Standing indoors, the region map should still light up the town you are
  // indoors in — a door is not a journey.
  const outer = route?.kind === "interior" ? (route.parent ?? state.route) : state.route;

  return (
    <div className="miniMap">
      <LocalMap world={world} state={state} />
      <RegionMap world={world} state={state} outer={outer} />
    </div>
  );
}

/** The map you are standing on, small. */
function LocalMap({ world, state }: { world: World; state: GameState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const route = world.routes.get(state.route);
  const cell = route ? Math.max(3, Math.min(9, Math.floor(MINI_WIDTH / route.width))) : 4;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !route) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < route.height; y++) {
      for (let x = 0; x < route.width; x++) {
        const tile = route.tiles[y * route.width + x];
        ctx.fillStyle = tileColor(route.biome, tile, x, y);
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }

    // Doors, because on a map the size of a stamp a brown tile in a red roof
    // is invisible and knowing where you can go in is the whole point.
    ctx.fillStyle = "#ffd98a";
    for (const door of route.doors) ctx.fillRect(door.x * cell, door.y * cell, cell, cell);
    for (let y = 0; y < route.height; y++) {
      for (let x = 0; x < route.width; x++) {
        if (route.tiles[y * route.width + x] === TILE.EXIT) ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }

    // People still standing. Beaten trainers are off the map: they are
    // scenery now, and drawing them would suggest a fight that is not there.
    ctx.fillStyle = "#5b86d6";
    for (const trainer of world.trainers.get(route.id) ?? []) {
      if (state.beaten.includes(trainer.id)) continue;
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
    <div className="miniLocal">
      <canvas
        ref={ref}
        width={route.width * cell}
        height={route.height * cell}
        aria-label={`Map of ${route.label}`}
      />
      <span className="miniLabelText">{route.label}</span>
    </div>
  );
}

/** The region: which arm, how far out. */
function RegionMap({ world, state, outer }: { world: World; state: GameState; outer: string }) {
  const biomes = world.config.biomes;
  const rings = world.config.rings;

  const size = MINI_WIDTH;
  const centre = size / 2;
  const step = (centre - 16) / rings;
  const inTown = outer === HUB_ID;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Map of the region">
      {biomes.map((biome, arm) => {
        const angle = (ARM_ANGLES[arm % ARM_ANGLES.length] * Math.PI) / 180;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const palette = paletteFor(biome);

        return (
          <g key={biome}>
            <line
              x1={centre}
              y1={centre}
              x2={centre + dx * step * rings}
              y2={centre + dy * step * rings}
              stroke="var(--line)"
              strokeWidth={2}
            />
            {Array.from({ length: rings }, (_, index) => {
              const ring = index + 1;
              const id = routeId(biome, ring);
              const visited = state.visited.includes(id);
              const current = id === outer;
              const x = centre + dx * step * ring;
              const y = centre + dy * step * ring;

              return (
                <circle
                  key={id}
                  cx={x}
                  cy={y}
                  r={current ? 6 : 4}
                  // Unvisited rings are drawn but empty: the shape of the
                  // world is not a secret, only what is in it.
                  fill={visited ? palette.grass : "var(--bg)"}
                  stroke={current ? "var(--accent)" : "var(--line)"}
                  strokeWidth={current ? 3 : 1.5}
                >
                  <title>{`${biome} ring ${ring}${visited ? "" : " — not yet visited"}`}</title>
                </circle>
              );
            })}
            {/* Alongside the arm rather than past the end of it: a label
                set beyond the outermost ring runs off the edge, which is
                how "pinewood" first rendered as "P". */}
            <text
              x={centre + dx * step * rings * 0.55 - dy * 10}
              y={centre + dy * step * rings * 0.55 + dx * 10}
              textAnchor="middle"
              dominantBaseline="middle"
              className="miniLabel"
            >
              {biome}
            </text>
          </g>
        );
      })}

      <circle
        cx={centre}
        cy={centre}
        r={inTown ? 8 : 6}
        fill="var(--panel-2)"
        stroke={inTown ? "var(--accent)" : "var(--line)"}
        strokeWidth={inTown ? 3 : 1.5}
      >
        <title>Hearth — the town at the centre</title>
      </circle>
    </svg>
  );
}
