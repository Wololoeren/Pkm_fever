import type { GameState, Input } from "@/engine/engine";
import { species as speciesById } from "@/engine/dex";
import { gym, isGym } from "@/engine/gyms";
import type { World } from "@/engine/world";

/**
 * The journal: what has happened in this run, worked out rather than kept.
 *
 * Quests set the pattern — progress is a question asked of the save, never a
 * counter that could disagree with the world it was counting — and a journal
 * is the same idea with nothing to pay out. Half of it is read off the state,
 * which is itself a fold over the log; the other half is read off the log
 * directly, because "how many steps" and "how many balls" are facts about
 * what was pressed rather than about where it left you.
 *
 * Two things had to be recorded for it, and both are one number: how many
 * times the rival has turned up, and which species have been owned. Neither
 * could be recovered from the state after the fact — the rival's visits are a
 * schedule, not a list, and a creature released is a creature gone.
 *
 * Display, and pure. The panel is a list of what comes back.
 */

export interface Journal {
  moves: number;
  steps: number;
  /** Battles brought to an end and dismissed. */
  battles: number;
  turnsFought: number;
  ballsThrown: number;
  switches: number;
  /** Creatures that have ever been yours: starter, catches, eggs, gifts, trades. */
  obtained: number;
  speciesMet: number;
  speciesCaught: number;
  trainersBeaten: number;
  /** Trainer battles won, rematches included. */
  trainerWins: number;
  badges: { id: string; name: string; leader: string }[];
  rival: { visits: number; lastVisit: number | null; following: boolean };
  placesVisited: number;
  placesInAll: number;
  variantsFound: number;
  /** Everyone still with you, in the order they became yours. */
  firsts: { uid: number; speciesId: string; name: string; level: number }[];
  cheated: boolean;
}

export function journalOf(world: World, state: GameState, inputs: readonly Input[]): Journal {
  const count = (t: Input["t"]) => inputs.filter((input) => input.t === t).length;
  const outdoors = [...world.routes.values()].filter((route) => route.kind === "route");
  const everyone = [...state.party, ...state.box].sort((a, b) => a.uid - b.uid);

  return {
    moves: inputs.length,
    steps: count("move"),
    battles: count("continue"),
    turnsFought: count("fight") + count("struggle"),
    ballsThrown: count("ball"),
    switches: count("switch"),
    obtained: Math.max(0, state.nextUid - 1),
    speciesMet: Object.keys(state.whereMet).length,
    speciesCaught: state.caught.length,
    trainersBeaten: state.beaten.length,
    trainerWins: Object.values(state.wins).reduce((sum, wins) => sum + wins, 0),
    badges: state.badges
      .filter(isGym)
      .map((id) => ({ id, name: gym(id).name, leader: gym(id).leader })),
    rival: {
      visits: state.rivalVisits,
      lastVisit: state.rivalLast,
      following: state.rivalSince !== null,
    },
    placesVisited: state.visited.filter((id) => world.routes.get(id)?.kind === "route").length,
    placesInAll: outdoors.length,
    variantsFound: state.found.length,
    firsts: everyone.map((one) => ({
      uid: one.uid,
      speciesId: one.speciesId,
      name: one.nickname ?? speciesById(one.speciesId).name,
      level: one.level,
    })),
    cheated: state.cheated,
  };
}
