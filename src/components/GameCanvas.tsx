"use client";

import { useEffect, useRef, useState } from "react";
import {
  canSee,
  crittersOn,
  DARK_RADIUS,
  rivalAt,
  rivalCountdown,
  sightCorner,
  tileAt,
  type GameState,
} from "@/engine/engine";
import type { NpcKind } from "@/engine/npc";
import { TILE } from "@/engine/terrain";
import { drawProp } from "@/render/props";
import type { World } from "@/engine/world";
import { cachedMapArt, loadMapArt } from "@/render/icons";
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
  const standing = crittersOn(world, state, state.route);


  /**
   * Sprites arrive over the network, so the first paint of a route has none
   * of them and there is nothing to draw. This is the nudge: once one lands,
   * bump a counter and the effect below runs again with it in the cache.
   *
   * A counter rather than the sprite itself, because the cache is the sprite
   * store — holding a second copy in React state would be two answers to
   * "is it loaded" and they would disagree the moment a route changed.
   */
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    let alive = true;
    for (const { spec } of standing) {
      const { speciesId, variantId } = spec.creature;
      if (cachedMapArt(speciesId, variantId)) continue;
      void loadMapArt(speciesId, variantId).then(() => {
        if (alive) setLoaded((seen) => seen + 1);
      });
    }
    return () => {
      alive = false;
    };
    // The list is rebuilt every render, so it is compared by what is in it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standing.map(({ spec }) => spec.id).join(",")]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !route) return;

    // A map smaller than the window is drawn whole and centred rather than
    // scrolled — which is what interiors are.
    const viewW = Math.min(VIEW_TILES_X, route.width);
    const viewH = Math.min(VIEW_TILES_Y, route.height);
    // From the engine, because the small map's fog is filled in from the same
    // answer: what the camera shows and what you are recorded as having seen
    // are one fact, and computing it twice is two facts that agree until they
    // do not.
    const { x: camX, y: camY } = sightCorner(route, state.x, state.y);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let row = 0; row < viewH; row++) {
      for (let col = 0; col < viewW; col++) {
        const x = camX + col;
        const y = camY + row;
        const tile = tileAt(state, route, x, y);
        const px = col * TILE_PX;
        const py = row * TILE_PX;

        ctx.fillStyle = tileColor(route.biome, tile, x, y);
        ctx.fillRect(px, py, TILE_PX, TILE_PX);
        decorate(ctx, tile, px, py, x, y);
      }
    }

    // Furniture, over the floor and under everything that moves.
    for (const prop of route.props) {
      if (!inView(prop.x, prop.y, camX, camY, viewW, viewH)) continue;
      drawProp(ctx, prop.kind, (prop.x - camX) * TILE_PX, (prop.y - camY) * TILE_PX, TILE_PX);
    }

    // Things on the floor. Drawn as a ball whatever they are: what it is, is
    // the reward for walking over to it.
    for (const drop of world.pickups.get(route.id) ?? []) {
      if (state.taken.includes(drop.id)) continue;
      if (!inView(drop.x, drop.y, camX, camY, viewW, viewH)) continue;
      ball(ctx, (drop.x - camX) * TILE_PX + TILE_PX / 2, (drop.y - camY) * TILE_PX + TILE_PX / 2);
    }

    // Signs, over the tiles and under the people: a board says what a
    // building is for, which is the difference between a town you can read
    // and four identical red roofs.
    for (const sign of route.signs) {
      if (!inView(sign.x, sign.y, camX, camY, viewW, viewH)) continue;
      signpost(ctx, (sign.x - camX) * TILE_PX, (sign.y - camY) * TILE_PX, sign.text);
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

    // People who talk rather than fight, in their own colour so you can tell
    // at a glance which sort of person is standing in your way.
    for (const who of world.npcs.get(route.id) ?? []) {
      if (!inView(who.x, who.y, camX, camY, viewW, viewH)) continue;
      person(
        ctx,
        (who.x - camX) * TILE_PX + TILE_PX / 2,
        (who.y - camY) * TILE_PX + TILE_PX / 2,
        NPC_COLOURS[who.kind],
        1,
      );
      if (who.kind === "quest" && !state.questsTaken.includes(who.questId ?? "")) {
        mark(ctx, (who.x - camX) * TILE_PX + TILE_PX / 2, (who.y - camY) * TILE_PX);
      }
    }

    // Creatures standing about, drawn under the player so walking into one
    // puts you in front of it.
    //
    // The art arrives at the size it is drawn — see render/icons.ts. Nothing
    // is scaled here, which is the whole fix: this used to hand a 96-pixel
    // battle sprite to a 24-pixel box with smoothing off, and a quarter-size
    // nearest-neighbour downscale throws away three pixels in four.
    for (const { spec, x, y } of standing) {
      if (!inView(x, y, camX, camY, viewW, viewH)) continue;

      const px = (x - camX) * TILE_PX;
      const py = (y - camY) * TILE_PX;
      const art = cachedMapArt(spec.creature.speciesId, spec.creature.variantId);

      // A shadow first, so it sits on the floor rather than floating over it,
      // and so an unloaded sprite still reads as something being there.
      ctx.beginPath();
      ctx.ellipse(px + TILE_PX / 2, py + TILE_PX * 0.82, TILE_PX * 0.3, TILE_PX * 0.1, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fill();

      if (art) {
        // Centred on the tile and standing on its floor line, so a creature
        // taller than a tile overhangs upward into the empty air above rather
        // than sinking into the ground it is standing on.
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          art,
          Math.round(px + (TILE_PX - art.width) / 2),
          Math.round(py + TILE_PX * 0.86 - art.height),
        );
      } else {
        // Still loading. A dot rather than nothing: a tile you cannot walk
        // through and cannot see the reason for is worse than a placeholder.
        ctx.beginPath();
        ctx.arc(px + TILE_PX / 2, py + TILE_PX / 2, TILE_PX * 0.26, 0, Math.PI * 2);
        ctx.fillStyle = "#5a6b7a";
        ctx.fill();
      }

      // A mark over the ones that will fight, so walking up to one is a
      // decision rather than a surprise. The idlers get nothing, which is
      // what makes them read as scenery.
      if (spec.kind !== "idle") {
        mark(ctx, px + TILE_PX / 2, py, spec.kind === "joins" ? "#4f9e7a" : "#c9524a");
      }
    }

    // Whoever is behind you, three steps back on ground you have just left.
    //
    // Drawn before the dark, so a rival out past the torchlight is a rival you
    // cannot see — which is worse, and correct.
    const chasing = rivalAt(state);
    if (chasing && chasing.route === route.id && inView(chasing.x, chasing.y, camX, camY, viewW, viewH)) {
      person(
        ctx,
        (chasing.x - camX) * TILE_PX + TILE_PX / 2,
        (chasing.y - camY) * TILE_PX + TILE_PX / 2,
        "#b45cd8",
        1,
      );
      // How long you have, over his head. A number counting down is the whole
      // of the pressure: there is nothing to do about him except be ready.
      mark(
        ctx,
        (chasing.x - camX) * TILE_PX + TILE_PX / 2,
        (chasing.y - camY) * TILE_PX,
        "#b45cd8",
        String(rivalCountdown(state) ?? ""),
      );
    }

    // What you cannot see. The outer bands are dark without Flash, which is
    // the whole of what that tool is for.
    //
    // Painted **last**, over everything, and that is the fix rather than a
    // detail. It used to go on straight after the floor, so it hid the ground
    // and then the trainers, the people, the creatures, the signs and the
    // items on the floor were all drawn on top of it — every one of them
    // clearly lit, floating on a black square. The dark concealed the one
    // thing on a route that was never a surprise and revealed everything that
    // was.
    if (!canSee(state, route)) {
      for (let row = 0; row < viewH; row++) {
        for (let col = 0; col < viewW; col++) {
          const far =
            Math.abs(camX + col - state.x) + Math.abs(camY + row - state.y) > DARK_RADIUS;
          if (!far) continue;
          ctx.fillStyle = "#0b0e13";
          ctx.fillRect(col * TILE_PX, row * TILE_PX, TILE_PX, TILE_PX);
        }
      }
    }

    // You, after the dark, because you are the one thing that is never hidden
    // from you. Your own tile is inside the lit radius by definition, so this
    // is belt and braces rather than an exception.
    person(
      ctx,
      (state.x - camX) * TILE_PX + TILE_PX / 2,
      (state.y - camY) * TILE_PX + TILE_PX / 2,
      "#d8524a",
      1,
    );
    // `loaded` is read so the effect re-runs when a sprite lands.
  }, [world, state, route, standing, loaded]);

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

    case TILE.BUSH:
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      for (const [bx, by] of [[0.3, 0.4], [0.6, 0.35], [0.45, 0.62]]) {
        ctx.beginPath();
        ctx.arc(px + bx * TILE_PX, py + by * TILE_PX, TILE_PX * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
      return;

    case TILE.BOULDER:
      ctx.fillStyle = "rgba(0,0,0,0.32)";
      ctx.beginPath();
      ctx.arc(px + TILE_PX / 2, py + TILE_PX / 2, TILE_PX * 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath();
      ctx.arc(px + TILE_PX * 0.38, py + TILE_PX * 0.38, TILE_PX * 0.14, 0, Math.PI * 2);
      ctx.fill();
      return;

    case TILE.RUBBLE:
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      for (const [bx, by, r] of [[0.32, 0.38, 0.15], [0.62, 0.44, 0.12], [0.46, 0.66, 0.13]]) {
        ctx.beginPath();
        ctx.arc(px + bx * TILE_PX, py + by * TILE_PX, TILE_PX * r, 0, Math.PI * 2);
        ctx.fill();
      }
      return;

    case TILE.WATERFALL:
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 2;
      for (const bx of [0.28, 0.5, 0.72]) {
        ctx.beginPath();
        ctx.moveTo(px + bx * TILE_PX, py);
        ctx.lineTo(px + bx * TILE_PX, py + TILE_PX);
        ctx.stroke();
      }
      return;

    case TILE.WHIRLPOOL:
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let turn = 0; turn < 22; turn++) {
        const angle = turn * 0.55;
        const radius = TILE_PX * 0.04 * turn * 0.4;
        const fx = px + TILE_PX / 2 + Math.cos(angle) * radius;
        const fy = py + TILE_PX / 2 + Math.sin(angle) * radius;
        if (turn === 0) ctx.moveTo(fx, fy);
        else ctx.lineTo(fx, fy);
      }
      ctx.stroke();
      return;

    case TILE.CLIFF:
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.lineWidth = 2;
      for (const by of [0.3, 0.55, 0.8]) {
        ctx.beginPath();
        ctx.moveTo(px + 2, py + by * TILE_PX);
        ctx.lineTo(px + TILE_PX - 2, py + by * TILE_PX - 4);
        ctx.stroke();
      }
      return;

    case TILE.DEEP:
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath();
      ctx.arc(px + TILE_PX / 2, py + TILE_PX / 2, TILE_PX * 0.3, 0, Math.PI * 2);
      ctx.fill();
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

/**
 * A board on a post, with its text on a plate above it.
 *
 * The text is drawn over the tile rather than on it, because a tile is 26px
 * and "Poké Center" is not. The plate is sized to the text and centred on
 * the post, so a long name grows sideways instead of becoming unreadable.
 */
function signpost(ctx: CanvasRenderingContext2D, px: number, py: number, text: string): void {
  const cx = px + TILE_PX / 2;

  ctx.save();

  // The post and its board.
  ctx.fillStyle = "#6b4f33";
  ctx.fillRect(cx - 2, py + TILE_PX * 0.45, 4, TILE_PX * 0.5);
  ctx.fillStyle = "#c9a468";
  ctx.strokeStyle = "#4a3527";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(px + 3, py + TILE_PX * 0.18, TILE_PX - 6, TILE_PX * 0.34, 2);
  ctx.fill();
  ctx.stroke();

  // The plate, floating above so it never covers the door beside it.
  ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = ctx.measureText(text).width + 10;
  const plateY = py - 5;

  ctx.fillStyle = "rgba(20,24,32,0.82)";
  ctx.strokeStyle = "rgba(201,164,104,0.75)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(cx - width / 2, plateY, width, 13, 3);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#f2e4c9";
  ctx.fillText(text, cx, plateY + 7);

  ctx.restore();
}

/**
 * What sort of person this is, in one colour.
 *
 * Every kind needs an entry. A missing one is not a default — `person` sets
 * `ctx.fillStyle` to it, and assigning an invalid value to a canvas context is
 * *ignored*, so the figure keeps whatever colour was set last. That was the
 * shadow ellipse drawn a line earlier, which is why gym leaders and the
 * Appraiser were being painted in near-black instead of failing loudly.
 * `tests/palette.test.ts` now asks every NpcKind for its colour.
 */
const NPC_COLOURS: Record<NpcKind, string> = {
  hint: "#8a7fc4",
  gift: "#4f9e7a",
  heal: "#4a9ec9",
  trade: "#c98a4a",
  quest: "#c9a83a",
  gym: "#c95a7a",
  buy: "#b09a5a",
  // The machine, and the man running a bracket out of a field.
  print: "#7ab0c9",
  arena: "#c97a4a",
  // A colour you would not want to look at for long, which is the idea.
  shred: "#9a5a5a",
  cut: "#8a8ac4",
  // Forge-coloured, which is to say the colour of something that has just been hit.
  forge: "#c9844a",
  // The five at the end of the world, and the one who keeps their door.
  cup: "#a55ac9",
  // Grey, and grey is the point. Every other colour here says something
  // happens at this tile; the Grey Line is how you get to a different tile, so
  // it is the one sort of person on the map who is infrastructure rather than
  // an event. Light enough to read against a rock wall, which is where a good
  // few of them stand.
  travel: "#9aa4b0",
};

/** An item on the floor. A ball whatever it holds — finding out is the point
 * of walking over to it. */
function ball(ctx: CanvasRenderingContext2D, px: number, py: number): void {
  const r = TILE_PX * 0.28;

  ctx.beginPath();
  ctx.ellipse(px, py + r * 0.9, r * 0.9, r * 0.32, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(px, py, r, Math.PI, 0);
  ctx.fillStyle = "#d8524a";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI);
  ctx.fillStyle = "#f0ece4";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#1b2330";
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(px - r, py);
  ctx.lineTo(px + r, py);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(px, py, r * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = "#f0ece4";
  ctx.fill();
  ctx.stroke();
}

/** The mark over somebody with work going spare. */
function mark(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  colour = "#f2d14a",
  glyph = "!",
): void {
  ctx.save();
  ctx.font = "700 15px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(20,24,32,0.9)";
  ctx.strokeText(glyph, px, py - 4);
  ctx.fillStyle = colour;
  ctx.fillText(glyph, px, py - 4);
  ctx.restore();
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
