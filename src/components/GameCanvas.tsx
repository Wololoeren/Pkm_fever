"use client";

import { useEffect, useRef } from "react";
import type { GameState } from "@/engine/engine";
import { TILE } from "@/engine/terrain";
import type { World } from "@/engine/world";
import { TILE_PX, tileColor, VIEW_TILES_X, VIEW_TILES_Y } from "@/render/tiles";

/**
 * The world, through a window.
 *
 * Strictly one-way: this reads GameState and paints it, and never writes back.
 * The moment a value computed here fed into game state, replay would be dead
 * and nobody would notice for months.
 *
 * The window is the point. Routes are 44x34 now; drawing all of it would be a
 * 1144px image and would also undo the reason for making them bigger, which
 * was to stop a place being something you take in at a glance. The camera
 * follows the player and stops at the edges, so you never see past the world.
 */
export function GameCanvas({ world, state }: { world: World; state: GameState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const route = world.routes.get(state.route);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !route) return;

    // A map smaller than the window is drawn whole and centred rather than
    // scrolled — which is what interiors are.
    const viewW = Math.min(VIEW_TILES_X, route.width);
    const viewH = Math.min(VIEW_TILES_Y, route.height);
    const camX = clamp(state.x - Math.floor(viewW / 2), 0, route.width - viewW);
    const camY = clamp(state.y - Math.floor(viewH / 2), 0, route.height - viewH);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let row = 0; row < viewH; row++) {
      for (let col = 0; col < viewW; col++) {
        const x = camX + col;
        const y = camY + row;
        const tile = route.tiles[y * route.width + x];
        const px = col * TILE_PX;
        const py = row * TILE_PX;

        ctx.fillStyle = tileColor(route.biome, tile, x, y);
        ctx.fillRect(px, py, TILE_PX, TILE_PX);
        decorate(ctx, tile, px, py, x, y);
      }
    }

    // Trainers, drawn before the player so walking onto one puts you in front.
    for (const trainer of world.trainers.get(route.id) ?? []) {
      if (!inView(trainer.x, trainer.y, camX, camY, viewW, viewH)) continue;
      person(
        ctx,
        (trainer.x - camX) * TILE_PX + TILE_PX / 2,
        (trainer.y - camY) * TILE_PX + TILE_PX / 2,
        state.beaten.includes(trainer.id) ? "#6b7280" : "#4a6fb5",
        state.beaten.includes(trainer.id) ? 0.35 : 1,
      );
    }

    person(
      ctx,
      (state.x - camX) * TILE_PX + TILE_PX / 2,
      (state.y - camY) * TILE_PX + TILE_PX / 2,
      "#d8524a",
      1,
    );
  }, [world, state, route]);

  if (!route) return null;

  return (
    <canvas
      ref={ref}
      width={Math.min(VIEW_TILES_X, route.width) * TILE_PX}
      height={Math.min(VIEW_TILES_Y, route.height) * TILE_PX}
      className="map"
      aria-label={`Map of ${route.label}`}
    />
  );
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function inView(x: number, y: number, camX: number, camY: number, w: number, h: number): boolean {
  return x >= camX && y >= camY && x < camX + w && y < camY + h;
}

/**
 * The marks that stop a tile being a coloured square.
 *
 * Cheap shapes rather than art: blades on tall grass so you can see where an
 * encounter can start, a canopy on trees, a ripple on water. The point is to
 * tell tiles apart at a glance, not to be a tileset.
 */
function decorate(ctx: CanvasRenderingContext2D, tile: number, px: number, py: number, x: number, y: number): void {
  const jitter = ((x * 7 + y * 13) % 5) - 2;

  switch (tile) {
    case TILE.GRASS:
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let blade = 0; blade < 3; blade++) {
        const bx = px + 5 + blade * 7;
        const by = py + TILE_PX - 5;
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + 2, by - 7);
      }
      ctx.stroke();
      return;

    case TILE.TREE:
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.beginPath();
      ctx.arc(px + TILE_PX / 2 + jitter, py + TILE_PX / 2, TILE_PX * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      ctx.beginPath();
      ctx.arc(px + TILE_PX / 2 - 3 + jitter, py + TILE_PX / 2 - 3, TILE_PX * 0.2, 0, Math.PI * 2);
      ctx.fill();
      return;

    case TILE.ROCK:
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath();
      ctx.ellipse(px + TILE_PX / 2, py + TILE_PX * 0.6, TILE_PX * 0.3, TILE_PX * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      return;

    case TILE.WATER:
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px + 5, py + TILE_PX / 2 + jitter);
      ctx.lineTo(px + TILE_PX - 5, py + TILE_PX / 2 + jitter);
      ctx.stroke();
      return;

    case TILE.FLOWER:
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath();
      ctx.arc(px + TILE_PX / 2 + jitter, py + TILE_PX / 2, 2.4, 0, Math.PI * 2);
      ctx.fill();
      return;

    case TILE.ROOF:
      ctx.strokeStyle = "rgba(0,0,0,0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, py + TILE_PX / 2);
      ctx.lineTo(px + TILE_PX, py + TILE_PX / 2);
      ctx.stroke();
      return;

    case TILE.DOOR:
    case TILE.EXIT:
      ctx.fillStyle = "rgba(255,220,150,0.85)";
      ctx.fillRect(px + TILE_PX * 0.3, py + TILE_PX * 0.25, TILE_PX * 0.4, TILE_PX * 0.75);
      return;

    case TILE.FENCE:
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + 3, py + TILE_PX * 0.4);
      ctx.lineTo(px + TILE_PX - 3, py + TILE_PX * 0.4);
      ctx.moveTo(px + TILE_PX / 2, py + TILE_PX * 0.25);
      ctx.lineTo(px + TILE_PX / 2, py + TILE_PX * 0.75);
      ctx.stroke();
      return;

    default:
      return;
  }
}

/** A small figure, so facing reads at a glance even at this size. */
function person(ctx: CanvasRenderingContext2D, px: number, py: number, colour: string, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.beginPath();
  ctx.ellipse(px, py + TILE_PX * 0.34, TILE_PX * 0.3, TILE_PX * 0.12, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fill();

  ctx.beginPath();
  ctx.roundRect(px - 7, py - 3, 14, 13, 3);
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#1b2330";
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

  ctx.restore();
}
