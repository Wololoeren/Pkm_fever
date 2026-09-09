import type { PropKind } from "@/engine/props";

/**
 * Twenty-five pieces of furniture, drawn rather than loaded.
 *
 * No sprite sheet: at 26 pixels a tile, a bed is a rounded rectangle with a
 * pillow on it and a bookcase is three lines in a box, and a downloaded
 * tileset would be one more thing to license, host and keep in step with the
 * palette. They are drawn from the same handful of primitives as the terrain
 * decoration, so a room looks like it belongs to the map it is in.
 */

interface Ink {
  wood: string;
  darkWood: string;
  cloth: string;
  metal: string;
  green: string;
  glow: string;
  line: string;
}

const INK: Ink = {
  wood: "#8a6a45",
  darkWood: "#5f4a30",
  cloth: "#a8564f",
  metal: "#8d94a0",
  green: "#4f8a4a",
  glow: "#e8c46a",
  line: "rgba(20,16,12,0.55)",
};

/** Draws one piece, filling the tile box given. */
export function drawProp(
  ctx: CanvasRenderingContext2D,
  kind: PropKind,
  px: number,
  py: number,
  size: number,
): void {
  const s = size;
  const box = (x: number, y: number, w: number, h: number, fill: string, radius = 2) => {
    ctx.beginPath();
    ctx.roundRect(px + x * s, py + y * s, w * s, h * s, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = INK.line;
    ctx.stroke();
  };
  const dot = (x: number, y: number, r: number, fill: string) => {
    ctx.beginPath();
    ctx.arc(px + x * s, py + y * s, r * s, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const line = (x1: number, y1: number, x2: number, y2: number, colour = INK.line) => {
    ctx.beginPath();
    ctx.moveTo(px + x1 * s, py + y1 * s);
    ctx.lineTo(px + x2 * s, py + y2 * s);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  switch (kind) {
    case "table":
      box(0.1, 0.25, 0.8, 0.5, INK.wood);
      line(0.25, 0.75, 0.25, 0.92);
      line(0.75, 0.75, 0.75, 0.92);
      return;

    case "chair":
      box(0.28, 0.35, 0.44, 0.42, INK.wood);
      box(0.28, 0.15, 0.44, 0.2, INK.darkWood);
      return;

    case "stool":
      dot(0.5, 0.5, 0.26, INK.wood);
      dot(0.5, 0.47, 0.18, INK.darkWood);
      return;

    case "bed":
      box(0.12, 0.15, 0.76, 0.7, INK.cloth, 4);
      box(0.18, 0.2, 0.64, 0.22, "#e8e0d0", 3);
      return;

    case "bunk":
      box(0.12, 0.12, 0.76, 0.34, INK.cloth, 3);
      box(0.12, 0.54, 0.76, 0.34, INK.cloth, 3);
      return;

    case "bookcase":
      box(0.12, 0.1, 0.76, 0.8, INK.darkWood);
      for (const y of [0.3, 0.5, 0.7]) line(0.16, y, 0.84, y, "rgba(232,196,106,0.5)");
      return;

    case "shelf":
      box(0.08, 0.3, 0.84, 0.16, INK.wood, 1);
      box(0.08, 0.6, 0.84, 0.16, INK.wood, 1);
      return;

    case "cabinet":
      box(0.15, 0.15, 0.7, 0.7, INK.wood);
      line(0.5, 0.15, 0.5, 0.85);
      dot(0.42, 0.5, 0.045, INK.metal);
      dot(0.58, 0.5, 0.045, INK.metal);
      return;

    case "chest":
      box(0.14, 0.35, 0.72, 0.5, INK.darkWood, 3);
      box(0.14, 0.3, 0.72, 0.16, INK.wood, 3);
      dot(0.5, 0.55, 0.06, INK.glow);
      return;

    case "crate":
      box(0.15, 0.2, 0.7, 0.65, INK.wood);
      line(0.15, 0.2, 0.85, 0.85);
      line(0.85, 0.2, 0.15, 0.85);
      return;

    case "barrel":
      box(0.24, 0.15, 0.52, 0.72, INK.wood, 6);
      line(0.24, 0.4, 0.76, 0.4, INK.darkWood);
      line(0.24, 0.62, 0.76, 0.62, INK.darkWood);
      return;

    case "sack":
      ctx.beginPath();
      ctx.moveTo(px + 0.5 * s, py + 0.16 * s);
      ctx.quadraticCurveTo(px + 0.92 * s, py + 0.55 * s, px + 0.72 * s, py + 0.88 * s);
      ctx.lineTo(px + 0.28 * s, py + 0.88 * s);
      ctx.quadraticCurveTo(px + 0.08 * s, py + 0.55 * s, px + 0.5 * s, py + 0.16 * s);
      ctx.fillStyle = "#b8a077";
      ctx.fill();
      ctx.strokeStyle = INK.line;
      ctx.stroke();
      return;

    case "basket":
      box(0.2, 0.4, 0.6, 0.45, "#c0a06a", 3);
      for (const x of [0.35, 0.5, 0.65]) line(x, 0.4, x, 0.85);
      return;

    case "bin":
      box(0.28, 0.3, 0.44, 0.58, INK.metal, 2);
      box(0.24, 0.24, 0.52, 0.1, "#6d7481", 2);
      return;

    case "pot":
      dot(0.5, 0.6, 0.28, "#9a6a4a");
      box(0.28, 0.3, 0.44, 0.12, "#7d5238", 2);
      return;

    case "rug":
      box(0.05, 0.15, 0.9, 0.7, "#7a4a6a", 4);
      box(0.16, 0.28, 0.68, 0.44, "#9a5f84", 3);
      return;

    case "mat":
      box(0.12, 0.3, 0.76, 0.4, "#6b6152", 2);
      line(0.12, 0.5, 0.88, 0.5, "rgba(255,255,255,0.18)");
      return;

    case "plant":
      box(0.35, 0.62, 0.3, 0.26, "#9a6a4a", 2);
      dot(0.5, 0.42, 0.22, INK.green);
      dot(0.36, 0.5, 0.13, "#3f7a3c");
      dot(0.64, 0.5, 0.13, "#3f7a3c");
      return;

    case "vase":
      ctx.beginPath();
      ctx.moveTo(px + 0.38 * s, py + 0.3 * s);
      ctx.quadraticCurveTo(px + 0.2 * s, py + 0.7 * s, px + 0.5 * s, py + 0.88 * s);
      ctx.quadraticCurveTo(px + 0.8 * s, py + 0.7 * s, px + 0.62 * s, py + 0.3 * s);
      ctx.fillStyle = "#5f7f96";
      ctx.fill();
      ctx.strokeStyle = INK.line;
      ctx.stroke();
      dot(0.5, 0.24, 0.08, "#d47f9a");
      return;

    case "flowerbox":
      box(0.1, 0.5, 0.8, 0.36, "#7d5238", 2);
      dot(0.3, 0.44, 0.09, "#d47f9a");
      dot(0.5, 0.4, 0.09, "#e0c065");
      dot(0.7, 0.44, 0.09, "#b07fd4");
      return;

    case "lamp":
      line(0.5, 0.5, 0.5, 0.9, INK.darkWood);
      ctx.beginPath();
      ctx.moveTo(px + 0.3 * s, py + 0.5 * s);
      ctx.lineTo(px + 0.7 * s, py + 0.5 * s);
      ctx.lineTo(px + 0.6 * s, py + 0.18 * s);
      ctx.lineTo(px + 0.4 * s, py + 0.18 * s);
      ctx.closePath();
      ctx.fillStyle = INK.glow;
      ctx.fill();
      return;

    case "painting":
      box(0.14, 0.18, 0.72, 0.56, "#3f5f7a", 1);
      box(0.2, 0.24, 0.6, 0.44, "#6a9ab5", 1);
      dot(0.4, 0.42, 0.07, "#e8d68a");
      return;

    case "clock":
      dot(0.5, 0.45, 0.28, "#d8cbb0");
      dot(0.5, 0.45, 0.24, "#f2ead8");
      line(0.5, 0.45, 0.5, 0.28);
      line(0.5, 0.45, 0.62, 0.5);
      return;

    case "mirror":
      box(0.28, 0.14, 0.44, 0.66, "#c8b58a", 6);
      box(0.33, 0.19, 0.34, 0.56, "#9fc0cc", 5);
      return;

    case "hearth":
      box(0.1, 0.2, 0.8, 0.68, "#6b6156", 2);
      box(0.24, 0.44, 0.52, 0.44, "#2b2622", 2);
      dot(0.5, 0.72, 0.14, "#e07a3a");
      dot(0.5, 0.76, 0.08, INK.glow);
      return;
  }
}
