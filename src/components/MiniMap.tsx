"use client";

import type { GameState } from "@/engine/engine";
import { HUB_ID, routeId, type World } from "@/engine/world";
import { paletteFor } from "@/render/tiles";

/**
 * Where you are, in the shape the world actually has.
 *
 * Not a scaled-down copy of the tiles — a corridor map. The world is a hub
 * with four arms running outward, and difficulty is one-dimensional along each
 * arm, so the useful question is "which arm, how far out" rather than "which
 * pixel". A minified tile view would answer the second and hide the first.
 *
 * The four arms are drawn where they actually lie: west, north, east and south
 * of the hub, in the order the hub's exits open onto them.
 */

const ARM_ANGLES = [180, 270, 0, 90];

export function MiniMap({ world, state }: { world: World; state: GameState }) {
  const biomes = world.config.biomes;
  const rings = world.config.rings;

  const size = 168;
  const centre = size / 2;
  const step = (centre - 16) / rings;

  const here = state.route;
  const atHub = here === HUB_ID;

  return (
    <div className="miniMap">
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
                const current = id === here;
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
          r={atHub ? 8 : 6}
          fill="var(--panel-2)"
          stroke={atHub ? "var(--accent)" : "var(--line)"}
          strokeWidth={atHub ? 3 : 1.5}
        >
          <title>Hearth — the hub town</title>
        </circle>
      </svg>
    </div>
  );
}
