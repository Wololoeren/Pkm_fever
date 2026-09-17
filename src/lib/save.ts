import { ENGINE_VERSION, type Individual } from "@/engine/types";
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
  /**
   * Every creature the run owned when it was saved, written out whole.
   *
   * Never read by the engine either: the log is still the save. This is for
   * the vault, and it is there so a *later* engine can still read the
   * creatures out of a save it can no longer replay — a rules change
   * refuses an old log, and without this it would take the creatures with it.
   */
  roster?: Individual[];
  /**
   * A random name for the run, made when it began and kept by every save of
   * it. Not game state — two runs on one seed are the same game — but the
   * vault needs to tell them apart, and to know a later save of this run from
   * a different run that happens to start the same way.
   */
  run?: string;
}

export function makeSave(
  seed: string,
  inputs: readonly Input[],
  roster?: readonly Individual[],
  run?: string,
): SaveFile {
  return {
    v: ENGINE_VERSION,
    seed,
    inputs: [...inputs],
    savedAt: new Date().toISOString(),
    ...(roster ? { roster: [...roster] } : {}),
    ...(run ? { run } : {}),
  };
}

/** A fresh run name. Random, and never read by the engine. */
export function newRunId(): string {
  return randomSeed() + randomSeed();
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
    ...(save.roster ? { roster: save.roster } : {}),
    ...(save.run ? { run: save.run } : {}),
  });
}

/** Where the last few runs' autosaves are kept, newest first. */
const SLOTS_KEY = "pkm-fever.saves";

/** How many runs keep an autosave. Starting a fourth lets the oldest go. */
export const AUTOSAVE_SLOTS = 3;

/** The stored autosaves as raw strings, newest first, with a single old-style autosave folded in. */
function readSlots(): string[] {
  let slots: string[] = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(SLOTS_KEY) ?? "[]");
    if (Array.isArray(parsed)) slots = parsed.filter((one): one is string => typeof one === "string");
  } catch {
    slots = [];
  }
  // A browser that saved before there were slots has its one save under the
  // old key: kept as a slot rather than lost.
  try {
    const legacy = localStorage.getItem(KEY);
    if (legacy && !slots.includes(legacy) && !slots.some((one) => sameRun(one, legacy))) slots.push(legacy);
  } catch {
    // No storage at all.
  }
  return slots.slice(0, AUTOSAVE_SLOTS);
}

/** Whether two stored saves are the same run: the run name where both have one, the seed where they do not. */
function sameRun(a: string, b: string): boolean {
  try {
    const one = JSON.parse(a) as { run?: string; seed?: string };
    const two = JSON.parse(b) as { run?: string; seed?: string };
    if (one.run && two.run) return one.run === two.run;
    return !one.run && !two.run && one.seed === two.seed;
  } catch {
    return false;
  }
}

export function writeAutosave(seed: string, inputs: readonly Input[], roster?: readonly Individual[], run?: string): void {
  try {
    const raw = encodeSave(makeSave(seed, inputs, roster, run));
    // This run's slot moves to the front; the others keep theirs, and the
    // oldest falls off the end once there are more runs than slots.
    const slots = [raw, ...readSlots().filter((one) => !sameRun(one, raw))].slice(0, AUTOSAVE_SLOTS);
    localStorage.setItem(SLOTS_KEY, JSON.stringify(slots));
    // The newest is also kept under the old key, which is what the vault reads.
    localStorage.setItem(KEY, raw);
  } catch {
    // A full or blocked store costs the autosave, not the session.
  }
}

/** Every autosave this browser keeps that this version can open, newest first. */
export function readAutosaves(): SaveFile[] {
  try {
    return readSlots().flatMap((raw) => {
      const save = parseSave(raw);
      return save ? [save] : [];
    });
  } catch {
    return [];
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
let owed: { seed: string; inputs: readonly Input[]; roster?: readonly Individual[]; run?: string } | null = null;

/**
 * Writes the autosave soon.
 *
 * The most recent call wins, so a burst of steps costs one write. What is owed
 * is held rather than captured per timer, which is what makes `flushAutosave`
 * able to pay it early.
 */
export function scheduleAutosave(seed: string, inputs: readonly Input[], roster?: readonly Individual[], run?: string): void {
  owed = { seed, inputs, roster, run };
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
  const { seed, inputs, roster, run } = owed;
  owed = null;
  writeAutosave(seed, inputs, roster, run);
}

/** The autosave exactly as stored, for the vault to read creatures out of. */
export function readAutosaveRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
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
  // second later. The saved slots stay: a new run takes a slot of its own, and
  // only pushes the oldest out once it has been played.
  if (pending !== null) {
    clearTimeout(pending);
    pending = null;
  }
  owed = null;
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
    ...(Array.isArray(candidate.roster) ? { roster: candidate.roster as Individual[] } : {}),
    ...(typeof candidate.run === "string" ? { run: candidate.run } : {}),
  };
}

/**
 * A save from *any* engine version, as far as it can be read.
 *
 * `parseSave` refuses another version outright, because replaying it would be
 * a different game. The vault only wants the creatures, so it takes what it
 * can: the log when this engine can replay it, and the roster snapshot when
 * there is one, whatever version wrote it.
 */
export function parseAnySave(
  raw: string,
): { v: number; seed: string; inputs: Input[] | null; roster: Individual[] | null; savedAt: string; run: string | null } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Partial<SaveFile> & { log?: unknown };
  if (typeof candidate.seed !== "string" || typeof candidate.v !== "number") return null;
  const readable = candidate.v === ENGINE_VERSION ? parseSave(raw) : null;
  return {
    v: candidate.v,
    seed: candidate.seed,
    inputs: readable?.inputs ?? null,
    roster: Array.isArray(candidate.roster) ? (candidate.roster as Individual[]) : null,
    savedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : "",
    run: typeof candidate.run === "string" ? candidate.run : null,
  };
}

/**
 * When a save was written, in the shape a filename can carry: `20260916-1432`.
 *
 * Local time rather than UTC, and no punctuation beyond the one dash, because
 * this is read in a folder listing by the person who made it. Sortable by
 * name, which is the only thing a folder gives you for free.
 */
export function fileStamp(savedAt: string): string {
  const when = new Date(savedAt);
  if (Number.isNaN(when.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}` +
    `-${pad(when.getHours())}${pad(when.getMinutes())}`
  );
}

/**
 * Hands the player a file. The browser owns where it goes.
 *
 * The name carries the seed and the moment: one run saved twice used to be one
 * name twice, so the second download became "(1)" and a folder of them was a
 * folder of guesses. The time is in the file as `savedAt` either way — this is
 * so it can be read without opening anything.
 */
export function downloadSave(seed: string, inputs: readonly Input[], roster?: readonly Individual[], run?: string): void {
  const save = makeSave(seed, inputs, roster, run);
  const blob = new Blob([encodeSave(save)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const stamp = fileStamp(save.savedAt);
  link.download = `pkm-fever-${seed}${stamp ? `-${stamp}` : ""}.json`;
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
