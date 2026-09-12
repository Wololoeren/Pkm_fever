"use client";

import { useEffect } from "react";
import type { BattleState } from "@/engine/battle";
import { beatsFor, catchFor } from "@/lib/beats";
import { cuesFor, playCues } from "@/lib/sound";

/**
 * Plays a turn's sound cues when the turn arrives.
 *
 * Keyed on the turn number and the battle's tag, exactly like `useBeat`, so a
 * turn sounds once however many times the screen re-renders and a new battle
 * on the same turn number is still a new turn.
 */
export function useCues(battle: BattleState): void {
  useEffect(() => {
    const attempt = catchFor(battle.events, battle.turn);
    const shift = attempt?.outcome === "escaped" ? attempt.length : 0;
    playCues(cuesFor(battle.events, beatsFor(battle.events, shift), attempt));
    // The events are a fact about the turn, which is what the key says.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle.tag, battle.turn]);
}
