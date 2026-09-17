"use client";

import type { Direction } from "@/engine/engine";

/**
 * Arrow buttons for a touch screen.
 *
 * Holding one walks, exactly as holding an arrow key does: pressed starts the
 * same walk, released ends it. Pointer events rather than touch events, so a
 * mouse on a narrow window works the same way, and captured, so a thumb that
 * slides off the button while walking still gets its release.
 *
 * Hidden by the stylesheet wherever there is a keyboard and room for the map.
 */
const PAD: { dir: Direction; label: string; className: string; name: string }[] = [
  { dir: "n", label: "▲", className: "padUp", name: "Walk up" },
  { dir: "w", label: "◀", className: "padLeft", name: "Walk left" },
  { dir: "e", label: "▶", className: "padRight", name: "Walk right" },
  { dir: "s", label: "▼", className: "padDown", name: "Walk down" },
];

export function TouchPad({ onDown, onUp }: { onDown: (dir: Direction) => void; onUp: (dir: Direction) => void }) {
  return (
    <div className="touchPad" role="group" aria-label="Walk">
      {PAD.map((one) => (
        <button
          key={one.dir}
          type="button"
          className={`ghost ${one.className}`}
          aria-label={one.name}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onDown(one.dir);
          }}
          onPointerUp={() => onUp(one.dir)}
          onPointerCancel={() => onUp(one.dir)}
          onContextMenu={(event) => event.preventDefault()}
        >
          {one.label}
        </button>
      ))}
    </div>
  );
}
