import { ALL_SPECIES, species as speciesById } from "@/engine/dex";
import { applyInput, initialState, stateHash, type GameState } from "@/engine/engine";
import { DEFAULT_WORLD, ENGINE_VERSION, type Individual } from "@/engine/types";
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
 * **With one exception, and it is the whole reason `trades` exists.** A
 * creature received in a trade came out of another player's world, from a seed
 * this save has never seen, so it cannot be derived — it is carried whole in
 * the input that brought it and taken on trust. That is a deliberate trade-off
 * made where the `trade` input is declared, and it was an *invisible* one:
 * cheat a level 50 into one save, trade it into another, and the second save
 * checks in with `cheated: no`, because the second log never touched the
 * shortcut menu. Which is true, and useless.
 *
 * So the exception is reported rather than hidden. Every trade is listed with
 * the move it happened on, and every creature in the party that arrived in one
 * is marked. `cheated` still means exactly what it always meant — this log
 * used the menu — because a flag that meant two things would be a flag that
 * proves neither, and legitimate trading is a feature rather than an offence.
 * What an organiser needs is both facts, and which of them disqualifies a team
 * is the format's business, not this file's.
 *
 * What it prints is what an organiser needs and nothing else: the seed (was
 * it the tournament's), the move count (how long they played), the hash (two
 * organisers checking the same file get the same word), `cheated`, and what
 * came in from outside. The party is listed because "bring six" is a rule
 * somebody has to check by eye.
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
  /**
   * Every trade in the log, and the move it happened on.
   *
   * The one hole in "replaying the log is the verification", and until this
   * existed it was an invisible one. Everything else in a save is *derived* —
   * the world from the seed, the creatures from the world, the battles from
   * the inputs — but a creature received in a trade came out of somebody
   * else's world and is carried whole in the input that brought it. It is
   * taken on trust, and nothing on this page said so.
   *
   * Which is how a level 50 raised by a cheat in one save walks into another
   * and checks in clean: the receiving log never touched the cheat menu, so
   * `cheated` is honestly `false`, and the creature that could not have been
   * earned sat in the party list looking like the rest of them.
   *
   * `at` is the index in the log, which is what "at what move" means here —
   * an organiser can point at it, and two organisers point at the same one.
   */
  trades: {
    at: number;
    gave: { speciesId: string; name: string; level: number };
    got: { speciesId: string; name: string; level: number; variantId: string };
  }[];
  /**
   * Every bracket prize in the log, and the move it was taken on.
   *
   * The same hole as `trades` and reported the same way: the three on offer
   * were rolled from a tournament in other people's browsers, so the creature
   * is carried whole in the input rather than derived from this seed. A
   * separate list because they are separate claims — a trade is somebody
   * else's raising, a prize is the game's own — and a format may well accept
   * one and not the other.
   */
  prizes: { at: number; speciesId: string; name: string; level: number; variantId: string }[];
  savedAt: string;
  party: {
    speciesId: string;
    name: string;
    level: number;
    variantId: string;
    /**
     * Whether this one arrived in a trade rather than being earned here.
     *
     * Read off the creature rather than off the trade list, because the two
     * answer different questions: the list is what happened, and this is what
     * is standing in the party *now*. A creature traded in and then traded
     * away again is on the list and not in the party, which is exactly the
     * distinction an organiser checking a team cares about.
     */
    traded: boolean;
    /** Whether this one was won in a bracket rather than raised. */
    prize: boolean;
    /**
     * Whether a testing shortcut made or altered this one.
     *
     * The half of `cheated` that travels. A save that never touched the menu
     * can still be holding something that was conjured out of one and traded
     * across, and this is the only thing on the party line that says so.
     */
    cheat: boolean;
  }[];
  /** The party itself, for a bracket to fight with. */
  roster: Individual[];
  badges: number;
}

/** What to call one, which is its nickname if it has been given one. */
function nameOf(creature: Individual): string {
  return creature.nickname ?? speciesById(creature.speciesId).name;
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
  const trades: Verification["trades"] = [];
  const prizes: Verification["prizes"] = [];

  for (let at = 0; at < save.inputs.length; at++) {
    const input = save.inputs[at];
    try {
      // Read *before* it is applied, because the creature handed over is only
      // in the party until the trade replaces it — and read off the state
      // rather than off the input, because the input names a slot and a slot
      // is meaningless without the party it indexes into.
      const gave = input.t === "trade" ? state.party[input.give] : null;

      state = applyInput(world, state, input);

      if (input.t === "trade" && gave) {
        const got = state.party[input.give];
        trades.push({
          at,
          gave: { speciesId: gave.speciesId, name: nameOf(gave), level: gave.level },
          got: {
            speciesId: got.speciesId,
            name: nameOf(got),
            level: got.level,
            variantId: got.variantId,
          },
        });
      }
      if (input.t === "prize") {
        // The arrival is the last thing added, in the party or the box —
        // `takePrize` puts it wherever there was room, so it is looked up by
        // the uid it was given rather than by a position.
        const won = [...state.party, ...state.box].find((one) => one.prize && one.uid === state.nextUid - 1);
        if (won) {
          prizes.push({
            at,
            speciesId: won.speciesId,
            name: nameOf(won),
            level: won.level,
            variantId: won.variantId,
          });
        }
      }
    } catch (thrown) {
      failedAt = at;
      // Which input, not just which index. "Refused at input 54" is a number
      // to stare at; "refused at input 54 (continue)" is usually the whole
      // diagnosis, and it costs one word.
      const kind = input && typeof input === "object" && "t" in input ? String(input.t) : "unknown";
      error = `${thrown instanceof Error ? thrown.message : String(thrown)} (input ${at + 1} of ${save.inputs.length}, a "${kind}")`;
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
    trades,
    prizes,
    savedAt: save.savedAt,
    party: state.party.map((creature) => ({
      speciesId: creature.speciesId,
      name: nameOf(creature),
      level: creature.level,
      variantId: creature.variantId,
      traded: creature.traded,
      prize: creature.prize,
      cheat: creature.cheat,
    })),
    roster: state.party,
    badges: state.badges.length,
  };
}
