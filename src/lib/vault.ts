import { ALL_SPECIES } from "@/engine/dex";
import { initialState, reduce, type GameState, type Input } from "@/engine/engine";
import { DEFAULT_WORLD, ENGINE_VERSION, type Individual } from "@/engine/types";
import { generateWorld } from "@/engine/world";
import { packInputs } from "./pack";
import { parseAnySave } from "./save";

/**
 * The vault: every creature from every run the player has added, in one place.
 *
 * There is no server, so it lives in this browser and travels as a file. It
 * is a collection rather than a store — nothing is taken out of it. A Vault
 * Adventure starts a new run with a *copy* of one (see `vaultArrival` in the
 * engine), and the original stays where it is.
 *
 * Every creature is named by the run it came from and its uid in that run,
 * so adding a later save of the same run updates what is there instead of
 * adding everybody twice. A run is named by its seed and the first few inputs
 * of its log, which two runs on the same seed stop sharing within moments.
 */

const KEY = "pkm-fever.vault";

export interface VaultEntry {
  /** `run:uid` — the same creature in a later save of the same run is the same entry. */
  id: string;
  creature: Individual;
  runId: string;
  seed: string;
  /** The engine version that wrote the save it came from. */
  engine: number;
  /**
   * Whether it was read by replaying the save's log with this engine, from a
   * run that never used the testing shortcuts. The other road in is the roster
   * snapshot a save carries, which works across versions and proves nothing.
   */
  proven: boolean;
  addedAt: string;
}

/** Everything a run owns: the party, the box, the daycare and the workshop. Eggs are not creatures yet. */
export function rosterOf(state: GameState): Individual[] {
  return [
    ...state.party,
    ...state.box,
    ...state.daycare.slots.filter((one): one is Individual => one !== null),
    ...Object.values(state.workshop).flatMap((held) => (held ? [held.creature] : [])),
  ];
}

/** A short, stable fingerprint of a string. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** How many tokens from the start of a packed log name the run. */
const RUN_HEAD = 24;

function runIdOf(seed: string, head: unknown): string {
  return `${seed}-${fingerprint(JSON.stringify(head))}`;
}

/**
 * The creatures in a save file, ready to go into the vault — or an error
 * saying why there are none.
 */
export function entriesFromSave(raw: string, now = new Date()): { entries: VaultEntry[] } | { error: string } {
  const save = parseAnySave(raw);
  if (!save) return { error: "That file is not a save." };

  let roster: Individual[] | null = null;
  let proven = false;
  let head: unknown = null;

  if (save.inputs) {
    // The packed log's first tokens, which is exactly what the file holds, so a
    // save read by replay and one read by its snapshot name the run the same way.
    head = packInputs(save.inputs).slice(0, RUN_HEAD);
    try {
      const world = generateWorld(DEFAULT_WORLD, save.seed, ALL_SPECIES);
      const state = save.inputs.length ? reduce(world, save.inputs) : initialState(world);
      roster = rosterOf(state);
      proven = !state.cheated;
    } catch {
      roster = null;
    }
  }
  if (!roster && save.roster) {
    roster = save.roster;
    proven = false;
    try {
      head ??= (JSON.parse(raw) as { log?: unknown[]; inputs?: unknown[] }).log?.slice(0, RUN_HEAD) ?? null;
    } catch {
      head = null;
    }
  }
  if (!roster) {
    return {
      error:
        save.v === ENGINE_VERSION
          ? "That save would not replay, and it carries no list of its creatures."
          : `That save is from engine version ${save.v} and carries no list of its creatures, so they cannot be read out of it.`,
    };
  }

  // The run's own name when the save has one; the start of its log when it
  // is older than run names.
  const runId = save.run ? `${save.seed}-${save.run}` : runIdOf(save.seed, head);
  const addedAt = now.toISOString();
  return {
    entries: roster
      .filter((creature) => creature && typeof creature.speciesId === "string" && typeof creature.uid === "number")
      .map((creature) => ({
        id: `${runId}:${creature.uid}`,
        creature,
        runId,
        seed: save.seed,
        engine: save.v,
        proven,
        addedAt,
      })),
  };
}

/** The creatures of a run being played right now, read off its live state. */
export function entriesFromRun(
  seed: string,
  inputs: readonly Input[],
  state: GameState,
  run?: string,
  now = new Date(),
): VaultEntry[] {
  const runId = run ? `${seed}-${run}` : runIdOf(seed, packInputs(inputs).slice(0, RUN_HEAD));
  const addedAt = now.toISOString();
  return rosterOf(state).map((creature) => ({
    id: `${runId}:${creature.uid}`,
    creature,
    runId,
    seed,
    engine: ENGINE_VERSION,
    // The live state *is* the replay of this log, by this engine.
    proven: !state.cheated,
    addedAt,
  }));
}

/**
 * The vault with these added: an entry already there is replaced by the newer
 * copy (a later save of the same run), everything else is appended.
 */
export function mergeEntries(vault: readonly VaultEntry[], incoming: readonly VaultEntry[]): { vault: VaultEntry[]; added: number; updated: number } {
  const byId = new Map(vault.map((entry) => [entry.id, entry]));
  let added = 0;
  let updated = 0;
  for (const entry of incoming) {
    if (byId.has(entry.id)) updated++;
    else added++;
    byId.set(entry.id, entry);
  }
  return { vault: [...byId.values()], added, updated };
}

export function readVault(): VaultEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { entries?: unknown };
    return Array.isArray(parsed.entries) ? (parsed.entries as VaultEntry[]) : [];
  } catch {
    return [];
  }
}

export function writeVault(entries: readonly VaultEntry[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, entries }));
    return true;
  } catch {
    return false;
  }
}

/** The vault as a file, for another browser or a backup. */
export function vaultFile(entries: readonly VaultEntry[]): string {
  return JSON.stringify({ kind: "pkm-fever-vault", v: 1, entries });
}

/**
 * A vault file's entries, or null. Marked unproven: a file is a file, and
 * whatever it says about itself was checked in somebody else's browser.
 */
export function entriesFromVaultFile(raw: string): VaultEntry[] | null {
  try {
    const parsed = JSON.parse(raw) as { kind?: string; entries?: unknown };
    if (parsed.kind !== "pkm-fever-vault" || !Array.isArray(parsed.entries)) return null;
    return (parsed.entries as VaultEntry[])
      .filter((entry) => entry && typeof entry.id === "string" && entry.creature && typeof entry.creature.speciesId === "string")
      .map((entry) => ({ ...entry, proven: false }));
  } catch {
    return null;
  }
}
