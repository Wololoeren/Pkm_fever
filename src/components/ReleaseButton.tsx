"use client";

import { useEffect, useState } from "react";
import { releaseRefusal, type GameState, type Input } from "@/engine/engine";
import type { Individual } from "@/engine/types";
import { displayName } from "@/lib/narrate";

/**
 * Letting one go, behind two locks.
 *
 * A release is the only thing in this game that walking back does not undo,
 * and because a save is a log it is not undone by reloading either — the
 * release is *in* the log. So it gets a confirmation step, and the
 * confirmation carries the creature's own uid rather than a boolean: a `true`
 * would be satisfied by any stray click that reached the engine, while a uid
 * can only have come from the button that showed you which one you were about
 * to lose. Reorder the list mid-click and nothing happens.
 *
 * The armed state times out. A destructive button left armed across a screen
 * change is a trap waiting for the next click that lands near it.
 */
const ARMED_MS = 4000;

export function ReleaseButton({
  state,
  from,
  index,
  creature,
  onInput,
}: {
  state: GameState;
  from: "party" | "box";
  index: number;
  creature: Individual;
  onInput: (input: Input) => void;
}) {
  const [armed, setArmed] = useState(false);
  const refusal = releaseRefusal(state, from, index, creature.uid);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), ARMED_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  if (!armed) {
    return (
      <button
        type="button"
        className="ghost small"
        disabled={Boolean(refusal)}
        title={refusal ?? `Let ${displayName(creature)} go — for good`}
        onClick={() => setArmed(true)}
      >
        Release
      </button>
    );
  }

  return (
    <button
      type="button"
      className="ghost small danger"
      title="This cannot be undone, and it is in the save log"
      onClick={() => {
        setArmed(false);
        onInput({ t: "release", from, index, confirm: creature.uid });
      }}
    >
      Really?
    </button>
  );
}
