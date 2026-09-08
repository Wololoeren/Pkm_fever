import { ENGINE_VERSION } from "@/engine/types";
import type { Input } from "@/engine/engine";

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

export function writeAutosave(seed: string, inputs: readonly Input[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(makeSave(seed, inputs)));
  } catch {
    // A full or blocked store costs the autosave, not the session.
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
  const candidate = parsed as Partial<SaveFile>;
  if (typeof candidate.seed !== "string" || !Array.isArray(candidate.inputs)) return null;
  if (candidate.v !== ENGINE_VERSION) return null;

  return {
    v: candidate.v,
    seed: candidate.seed,
    inputs: candidate.inputs as Input[],
    savedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : "",
  };
}

/** Hands the player a file. The browser owns where it goes. */
export function downloadSave(seed: string, inputs: readonly Input[]): void {
  const blob = new Blob([JSON.stringify(makeSave(seed, inputs), null, 2)], { type: "application/json" });
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
