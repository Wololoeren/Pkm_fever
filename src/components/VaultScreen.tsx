"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { species as speciesById } from "@/engine/dex";
import { cleanTrainerName, TRAINER_NAME_MAX, VAULT_LEVEL } from "@/engine/engine";
import type { Individual } from "@/engine/types";
import { displayName } from "@/lib/narrate";
import { fileStamp, randomSeed } from "@/lib/save";
import {
  entriesFromSave,
  entriesFromVaultFile,
  mergeEntries,
  readVault,
  vaultFile,
  writeVault,
  type VaultEntry,
} from "@/lib/vault";
import { rememberedTrainerName, rememberTrainerName } from "./MainMenu";
import { GenderMark } from "./PartyStrip";
import { Sprite } from "./Sprite";
import { StatHover } from "./StatHover";

/** Cells per page, the box's seven by seven. */
const PAGE = 49;

/** What a search matches: nickname, species, types, who caught it, and the seed it came from. */
function matches(entry: VaultEntry, query: string): boolean {
  const kind = speciesById(entry.creature.speciesId);
  const haystack = [displayName(entry.creature), kind.name, ...kind.types, entry.creature.caughtBy ?? "", entry.seed]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/**
 * The vault, as a screen of its own off the main menu.
 *
 * A box you cannot take anything out of: every creature from every run added
 * to it, seven by seven, searchable. Pick one and begin a Vault Adventure with
 * a copy of it.
 */
export function VaultScreen({
  autosave,
  onBegin,
  onExit,
}: {
  /** The raw autosave in this browser, if there is one, so it can be added in a click. */
  autosave: string | null;
  onBegin: (seed: string, trainer: string, creature: Individual) => void;
  onExit: () => void;
}) {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  useEffect(() => setEntries(readVault()), []);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState(() => randomSeed());
  const [trainer, setTrainer] = useState("");
  useEffect(() => setTrainer(rememberedTrainerName()), []);
  const saveRef = useRef<HTMLInputElement>(null);
  const vaultRef = useRef<HTMLInputElement>(null);

  const searching = query.trim().length > 0;
  const shown = useMemo(
    () => (searching ? entries.filter((entry) => matches(entry, query)) : entries),
    [entries, query, searching],
  );
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const onPage = shown.slice(Math.min(page, pages - 1) * PAGE, (Math.min(page, pages - 1) + 1) * PAGE);
  const chosen = entries.find((entry) => entry.id === picked) ?? null;

  const keep = (next: VaultEntry[], text: string) => {
    if (!writeVault(next)) {
      setMessage({ text: "This browser would not store the vault — it may be full or blocked.", bad: true });
      return;
    }
    setEntries(next);
    setMessage({ text, bad: false });
  };

  const addSave = (raw: string) => {
    setBusy(true);
    // A tick first, so the "reading" state paints before a long replay.
    setTimeout(() => {
      const read = entriesFromSave(raw);
      setBusy(false);
      if ("error" in read) {
        setMessage({ text: read.error, bad: true });
        return;
      }
      const merged = mergeEntries(entries, read.entries);
      keep(
        merged.vault,
        `${merged.added} added, ${merged.updated} updated${read.entries.some((one) => one.proven) ? " — proven by replaying the save" : ""}.`,
      );
    }, 20);
  };

  const exportVault = () => {
    const blob = new Blob([vaultFile(entries)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pkm-fever-vault-${fileStamp(new Date().toISOString())}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const named = cleanTrainerName(trainer).length > 0;

  return (
    <section className="menu vault">
      <div className="menuCard">
        <div className="row">
          <h2>Vault · {entries.length}</h2>
          <button type="button" className="ghost" onClick={onExit}>
            Back
          </button>
        </div>
        <p className="muted">
          Every creature from every run you add, kept in this browser. Adding a later save of the same run updates
          what is here instead of adding everybody twice. A Vault Adventure starts a new run with a copy of one — level{" "}
          {VAULT_LEVEL}, no EVs, and its IVs, abilities and held item kept.
        </p>
        <div className="row">
          <button type="button" disabled={!autosave || busy} onClick={() => autosave && addSave(autosave)}>
            Add this browser&apos;s autosave
          </button>
          <button type="button" className="ghost" disabled={busy} onClick={() => saveRef.current?.click()}>
            Add a save file
          </button>
          <button type="button" className="ghost" disabled={!entries.length} onClick={exportVault}>
            Export vault
          </button>
          <button type="button" className="ghost" onClick={() => vaultRef.current?.click()}>
            Import vault file
          </button>
          <input
            ref={saveRef}
            type="file"
            accept="application/json"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) addSave(await file.text());
            }}
          />
          <input
            ref={vaultRef}
            type="file"
            accept="application/json"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const incoming = entriesFromVaultFile(await file.text());
              if (!incoming) {
                setMessage({ text: "That file is not a vault.", bad: true });
                return;
              }
              const merged = mergeEntries(entries, incoming);
              keep(merged.vault, `${merged.added} added, ${merged.updated} updated from the vault file.`);
            }}
          />
        </div>
        {busy ? <p className="muted">Reading the save…</p> : null}
        {message ? <p className={message.bad ? "error" : "good"}>{message.text}</p> : null}
      </div>

      <div className="menuCard">
        <div className="boxHead">
          <input
            type="search"
            className="boxSearch"
            placeholder="Search name, type, trainer or seed…"
            value={query}
            aria-label="Search the vault"
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
          <span className="muted">
            {searching ? `${shown.length} found · ` : ""}page {Math.min(page, pages - 1) + 1} of {pages}
          </span>
          <button type="button" className="ghost" disabled={page <= 0} onClick={() => setPage(page - 1)}>
            ‹
          </button>
          <button type="button" className="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            ›
          </button>
        </div>
        <div className="boxGrid">
          {onPage.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`boxCell${picked === entry.id ? " hit" : ""}`}
              title={`${displayName(entry.creature)} · Lv${entry.creature.level} · seed ${entry.seed}${entry.proven ? " · proven" : ""}`}
              onClick={() => setPicked(entry.id)}
            >
              <Sprite speciesId={entry.creature.speciesId} variantId={entry.creature.variantId} abilities={entry.creature.abilities} heldItem={entry.creature.heldItem} size={48} />
              <span className="boxCellFoot">
                <span>Lv{entry.creature.level}</span>
                <GenderMark gender={entry.creature.gender} />
              </span>
            </button>
          ))}
          {Array.from({ length: Math.max(0, PAGE - onPage.length) }, (_, at) => (
            <span key={`empty-${at}`} className="boxCell empty" aria-hidden="true" />
          ))}
        </div>
        {!entries.length ? <p className="hint">Nothing here yet — add a save to fill it.</p> : null}
      </div>

      {chosen ? (
        <div className="menuCard">
          <StatHover creature={chosen.creature} />
          <p className="muted small">
            From seed <code>{chosen.seed}</code> (engine {chosen.engine}) ·{" "}
            {chosen.proven ? "proven: read by replaying its save" : "unproven: read from a snapshot or a vault file"}
          </p>
          <div className="row">
            <input
              value={trainer}
              onChange={(event) => setTrainer(event.target.value)}
              maxLength={TRAINER_NAME_MAX}
              placeholder="Trainer name"
              aria-label="Trainer name"
              spellCheck={false}
            />
            <input value={seed} onChange={(event) => setSeed(event.target.value)} aria-label="World seed" spellCheck={false} />
            <button type="button" className="ghost" onClick={() => setSeed(randomSeed())}>
              Reroll
            </button>
            <button
              type="button"
              className="primary"
              disabled={!named}
              title={named ? undefined : "Choose a trainer name first"}
              onClick={() => {
                rememberTrainerName(cleanTrainerName(trainer));
                onBegin(seed, trainer, chosen.creature);
              }}
            >
              Begin Vault Adventure
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                keep(
                  entries.filter((entry) => entry.id !== chosen.id),
                  `${displayName(chosen.creature)} was removed from the vault.`,
                );
                setPicked(null);
              }}
            >
              Remove from vault
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
