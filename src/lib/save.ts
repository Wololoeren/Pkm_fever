import { ENGINE_VERSION } from "@/engine/types";
import type { Input } from "@/engine/engine";
import { packInputs, unpackInputs } from "./pack";

/**
 * A save file is a seed and a list of inputs. That is the whole thing.
 *
 * Not a snapshot of state: replaying the log *is* the load, which means a save
 * is small, portable, and verifiable — a forged team would have to be an
 * actual playthrough. The engine version travels with it because a rules
 * change would replay an old log differently, and a save that silently means
 * something new is worse than one that refuses to open.
 *
 * Tamper-evidence (a hash chain, then signatures) belongs here rather than in
 * the engine, because this layer is allowed to be asynchronous and reach for
 * WebCrypto. It is not built yet; the shape is ready for it.
 */

const KEY = "pkm-fever.save";

export interface SaveFile {
  v: number;
  seed: string;
  inputs: Input[];
  /** Wall-clock, for showing the player which save is which. Never read by
   * the engine — nothing derived from it may touch game state. */
  savedAt: string;
}

export function makeSave(seed: string, inputs: readonly Input[]): SaveFile {
  return { v: ENGINE_VERSION, seed, inputs: [...inputs], savedAt: new Date().toISOString() };
}

/**
 * A save as it is written down: the log packed, under a different key.
 *
 * `log` rather than `inputs`, deliberately, so the two spellings cannot be
 * mistaken for one another by a reader that only understands one of them. A
 * file with `inputs` in it is a plain log and a file with `log` in it is a
 * packed one, and `parseSave` reads both — see `pack.ts` for why there are
 * two.
 */
export function encodeSave(save: SaveFile): string {
  return JSON.stringify({
    v: save.v,
    seed: save.seed,
    log: packInputs(save.inputs),
    savedAt: save.savedAt,
  });
}

export function writeAutosave(seed: string, inputs: readonly Input[]): void {
  try {
    localStorage.setItem(KEY, encodeSave(makeSave(seed, inputs)));
  } catch {
    // A full or blocked store costs the autosave, not the session.
  }
}

/**
 * How long a burst of walking is allowed to go unwritten.
 *
 * The autosave used to be written on every single input, from inside the
 * reducer's own state updater — so holding a direction key down meant
 * serialising the entire log, once per step, on the main thread. That is fine
 * at a hundred inputs and measured at 4.6ms for forty thousand, which is a
 * dropped frame every step by the time a save is worth having.
 *
 * A trailing debounce makes the cost proportional to *time played* rather than
 * to inputs pressed, which is the right shape: a fast walker should not pay
 * more than a slow one. Half a second, so the most a crash can cost is the
 * half second before it.
 */
const AUTOSAVE_DELAY = 500;

let pending: ReturnType<typeof setTimeout> | null = null;
let owed: { seed: string; inputs: readonly Input[] } | null = null;

/**
 * Writes the autosave soon.
 *
 * The most recent call wins, so a burst of steps costs one write. What is owed
 * is held rather than captured per timer, which is what makes `flushAutosave`
 * able to pay it early.
 */
export function scheduleAutosave(seed: string, inputs: readonly Input[]): void {
  owed = { seed, inputs };
  if (pending !== null) return;
  pending = setTimeout(() => {
    pending = null;
    flushAutosave();
  }, AUTOSAVE_DELAY);
}

/**
 * Pays whatever is owed, now.
 *
 * Called when the page is being hidden or closed, which is the one moment a
 * debounce is a liability rather than a saving: a timer that has not fired
 * when the tab goes away is half a second of walking thrown in the bin.
 */
export function flushAutosave(): void {
  if (pending !== null) {
    clearTimeout(pending);
    pending = null;
  }
  if (!owed) return;
  const { seed, inputs } = owed;
  owed = null;
  writeAutosave(seed, inputs);
}

export function readAutosave(): SaveFile | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseSave(raw) : null;
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  // Anything owed is dropped rather than written. Without this, starting a new
  // game inside the debounce window lets the old one land on top of it half a
  // second later.
  if (pending !== null) {
    clearTimeout(pending);
    pending = null;
  }
  owed = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do; the next write will overwrite it anyway.
  }
}

/** Reads an untrusted string into a save, or returns null. Deliberately
 * strict: a half-understood save would replay into a different game. */
export function parseSave(raw: string): SaveFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Partial<SaveFile> & { log?: unknown };
  if (typeof candidate.seed !== "string") return null;
  if (candidate.v !== ENGINE_VERSION) return null;

  // Both spellings, because a save written before the log was packed is still
  // a save. `log` is the packed one; `inputs` is the plain list, which is also
  // what a hand-written fixture looks like.
  const inputs =
    candidate.log !== undefined
      ? unpackInputs(candidate.log)
      : Array.isArray(candidate.inputs)
        ? (candidate.inputs as Input[])
        : null;
  if (!inputs) return null;

  return {
    v: candidate.v,
    seed: candidate.seed,
    inputs,
    savedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : "",
  };
}

/** Hands the player a file. The browser owns where it goes. */
export function downloadSave(seed: string, inputs: readonly Input[]): void {
  const blob = new Blob([encodeSave(makeSave(seed, inputs))], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pkm-fever-${seed}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Crockford's base32 alphabet: no I, L, O or U, so a seed survives being
 * read out loud — which is how a tournament will share one. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function randomSeed(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

/**
 * Today's seed, the same for everybody.
 *
 * A date-derived seed is a tournament with no organiser: everyone who begins
 * it gets the same world, the same starters and the same shiny, and two
 * players comparing hashes or times at the end of the day are comparing the
 * same run. UTC, so "today" does not depend on where the player is standing
 * — the seed changes at the same moment for everyone, or it is not one seed.
 *
 * Readable rather than hashed, on purpose. `DAY20260912` says which day it
 * was, and a seed that can be read out loud is what `ALPHABET` is for.
 */
export function dailySeed(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return normaliseSeed(`DAY${year}${month}${day}`);
}

/** Folds anything the player typed into the same alphabet, so "my seed" and
 * "MY SEED" are one world and a stray character cannot make two. */
export function normaliseSeed(input: string): string {
  const folded = input
    .toUpperCase()
    .replace(/[ILO]/g, (c) => (c === "I" || c === "L" ? "1" : "0"))
    .replace(/U/g, "V")
    .replace(/[^0-9A-Z]/g, "");
  return folded.slice(0, 12) || randomSeed();
}
