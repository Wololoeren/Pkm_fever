import { ALL_SPECIES, species as speciesById } from "@/engine/dex";
import { applyInput, initialState, stateHash, type GameState } from "@/engine/engine";
import { DEFAULT_WORLD, ENGINE_VERSION } from "@/engine/types";
import { generateWorld } from "@/engine/world";
import { normaliseSeed, type SaveFile } from "./save";

/**
 * Tournament check-in.
 *
 * A save is a seed and a list of inputs, and that is the whole reason this
 * page can exist: replaying the log *is* the verification. There is nothing
 * to trust — no signature, no server, no claim in the file about what the
 * party is. The world is generated from the seed, every input is applied in
 * order, and what comes out is what the player has. A forged team would have
 * to be an actual playthrough.
 *
 * What it prints is what an organiser needs and nothing else: the seed (was
 * it the tournament's), the move count (how long they played), the hash (two
 * organisers checking the same file get the same word), and `cheated` (the
 * shortcut menu marks the log, and the mark survives everything). The party
 * is listed because "bring six" is a rule somebody has to check by eye.
 *
 * Pure, so a test can run it without a browser; the page is a file input and
 * a table.
 */

export interface Verification {
  /** Whether every input replayed. A log the engine refuses is not a save. */
  ok: boolean;
  /** Why not, when it did not. */
  error: string | null;
  /** Which input the engine refused, when one was. */
  failedAt: number | null;
  seed: string;
  version: number;
  moves: number;
  /** The state's fingerprint after the whole log. */
  hash: string;
  cheated: boolean;
  savedAt: string;
  party: { speciesId: string; name: string; level: number; variantId: string }[];
  badges: number;
}

/**
 * Replays a save from nothing and reports on what came out.
 *
 * Input by input rather than through `reduce`, so a log that fails can say
 * *where* — "input 4,812 was refused" is something a player can act on, and
 * "corrupt" is not.
 */
export function verifySave(save: SaveFile): Verification {
  const seed = normaliseSeed(save.seed);
  const world = generateWorld(DEFAULT_WORLD, seed, ALL_SPECIES);
  let state: GameState = initialState(world);
  let failedAt: number | null = null;
  let error: string | null = null;

  for (let at = 0; at < save.inputs.length; at++) {
    try {
      state = applyInput(world, state, save.inputs[at]);
    } catch (thrown) {
      failedAt = at;
      error = thrown instanceof Error ? thrown.message : String(thrown);
      break;
    }
  }

  return {
    ok: failedAt === null && save.v === ENGINE_VERSION,
    error: failedAt === null ? (save.v === ENGINE_VERSION ? null : `written by engine version ${save.v}, this is ${ENGINE_VERSION}`) : error,
    failedAt,
    seed,
    version: save.v,
    moves: save.inputs.length,
    hash: stateHash(state),
    cheated: state.cheated,
    savedAt: save.savedAt,
    party: state.party.map((creature) => ({
      speciesId: creature.speciesId,
      name: creature.nickname ?? speciesById(creature.speciesId).name,
      level: creature.level,
      variantId: creature.variantId,
    })),
    badges: state.badges.length,
  };
}
