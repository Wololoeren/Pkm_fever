"use client";

import { useEffect, useRef } from "react";
import type { GameState } from "@/engine/engine";
import { TILE_GRASS, type World } from "@/engine/world";
import { paletteFor, TILE_PX, tileColor } from "@/render/tiles";

/**
 * The overworld, drawn from state.
 *
 * Strictly one-way: this reads GameState and paints it, and never writes back.
 * The moment a value computed here fed into game state, replay would be dead
 * and nobody would notice for months.
 */
export function GameCanvas({ world, state }: { world: World; state: GameState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const route = world.routes.get(state.route);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !route) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < route.height; y++) {
      for (let x = 0; x < route.width; x++) {
        const tile = route.tiles[y * route.width + x];
        ctx.fillStyle = tileColor(route.biome, tile, x, y);
        ctx.fillRect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);

        // A few blades on tall grass, so it reads as somewhere an encounter
        // can happen rather than as a green square.
        if (tile === TILE_GRASS) {
          ctx.strokeStyle = "rgba(0,0,0,0.16)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let blade = 0; blade < 3; blade++) {
            const bx = x * TILE_PX + 5 + blade * 7;
            const by = y * TILE_PX + TILE_PX - 5;
            ctx.moveTo(bx, by);
            ctx.lineTo(bx + 2, by - 7);
          }
          ctx.stroke();
        }
      }
    }

    // The player: a small figure rather than a dot, so facing reads at a
    // glance even at this size.
    const px = state.x * TILE_PX + TILE_PX / 2;
    const py = state.y * TILE_PX + TILE_PX / 2;
    const palette = paletteFor(route.biome);

    ctx.beginPath();
    ctx.ellipse(px, py + TILE_PX * 0.34, TILE_PX * 0.3, TILE_PX * 0.12, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fill();

    ctx.beginPath();
    ctx.roundRect(px - 7, py - 3, 14, 13, 3);
    ctx.fillStyle = "#d8524a";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#2a1b1a";
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(px, py - 7, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#e8c9a0";
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(px, py - 9, 7, Math.PI, Math.PI * 2);
    ctx.fillStyle = "#3b3038";
    ctx.fill();

    void palette;
  }, [world, state, route]);

  if (!route) return null;

  return (
    <canvas
      ref={ref}
      width={route.width * TILE_PX}
      height={route.height * TILE_PX}
      className="map"
      aria-label={`Map of ${state.route}`}
    />
  );
}
