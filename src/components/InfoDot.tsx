"use client";

import type { ReactNode } from "react";

/**
 * An explanation you can ask for.
 *
 * The stat screen had four paragraphs under it explaining what a nature is,
 * what an IV is and what effort is worth. All true, all needed exactly once,
 * and all of it standing between the numbers and the moves every time
 * afterwards. The numbers stay on screen; the prose is one hover away.
 *
 * A `<span>` with a tabindex rather than a `<button>`: it lives inside an
 * `<h3>`, it does nothing when pressed, and a button that does nothing is a
 * promise the markup does not keep. Focus still opens it, so it is reachable
 * without a pointer.
 */
export function InfoDot({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="infoDot" tabIndex={0} role="note" aria-label={label}>
      i
      <span className="infoNote">{children}</span>
    </span>
  );
}
