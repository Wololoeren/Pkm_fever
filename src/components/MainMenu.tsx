"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TRAINER_NAME_MAX, cleanTrainerName } from "@/engine/engine";
import { dailySeed, parseSave, randomSeed, type SaveFile } from "@/lib/save";

/** Where the last trainer name typed is remembered, so the next game starts with it. */
const NAME_KEY = "pkmfever.trainerName";

export function rememberedTrainerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberTrainerName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* private window: nothing to remember it in */
  }
}

/**
 * The four ways in.
 *
 * Two of them are honest about not existing yet. A menu entry that opens a
 * "coming soon" dialog is worse than one that says so on its face.
 */
export function MainMenu({
  autosave,
  onNew,
  onLoad,
}: {
  autosave: SaveFile | null;
  /** A new game in this world, played under this trainer name. */
  onNew: (seed: string, trainer: string) => void;
  onLoad: (save: SaveFile) => void;
}) {
  const [seed, setSeed] = useState(() => randomSeed());
  const [trainer, setTrainer] = useState("");
  useEffect(() => setTrainer(rememberedTrainerName()), []);
  const named = cleanTrainerName(trainer).length > 0;
  // Read once the page is in a browser, not while the static export is
  // rendered: the build machine's date is not the player's.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(dailySeed()), []);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function importFile(file: File) {
    const save = parseSave(await file.text());
    if (!save) {
      setError("That file is not a save this version can replay.");
      return;
    }
    setError(null);
    onLoad(save);
  }

  return (
    <section className="menu">
      <header className="brand">
        <h1>Pkm Fever</h1>
        <p className="tagline">Nothing is rolled at the moment it is needed.</p>
      </header>

      <div className="menuCard">
        <h2>Start new adventure</h2>
        <p className="muted">
          The seed decides the whole world — the three starters you are offered, what lives in
          which grass, and where the one true shiny is hiding. Share it and you share the world.
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
        </div>
        <div className="row">
          <input
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
            aria-label="World seed"
            spellCheck={false}
          />
          <button type="button" className="ghost" onClick={() => setSeed(randomSeed())}>
            Reroll
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => setSeed(today ?? dailySeed())}
            title="The same seed for everyone, today — compare hashes and times with no server"
          >
            Today&apos;s
          </button>
          <button
            type="button"
            className="primary"
            disabled={!named}
            title={named ? undefined : "Choose a trainer name first — it goes on everything you catch"}
            onClick={() => {
              rememberTrainerName(cleanTrainerName(trainer));
              onNew(seed, trainer);
            }}
          >
            Begin
          </button>
        </div>
        {today ? (
          <p className="muted small">
            Today&apos;s seed is <code>{today}</code>. Everyone who begins it gets the same world,
            so a hash or a time is worth comparing.
          </p>
        ) : null}
      </div>

      <div className="menuCard">
        <h2>Load game</h2>
        {autosave ? (
          <p className="muted">
            Autosave from seed <code>{autosave.seed}</code>, {autosave.inputs.length} moves in
            {autosave.savedAt ? ` · ${new Date(autosave.savedAt).toLocaleString()}` : ""}.
          </p>
        ) : (
          <p className="muted">No autosave in this browser yet. You can still open a save file.</p>
        )}
        <div className="row">
          <button type="button" disabled={!autosave} onClick={() => autosave && onLoad(autosave)}>
            Continue
          </button>
          <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
            Open save file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
              event.target.value = "";
            }}
          />
        </div>
        {error ? <p className="error">{error}</p> : null}
      </div>

      <div className="menuCard dim">
        <h2>PvP</h2>
        <p className="muted">
          Battling and trading with other people happen in town, not from this menu — load a save
          and walk to Hearth. The <Link href="/verify">verify page</Link> is a tournament&apos;s
          check-in — drop a save on it and it replays the log and prints the seed, the move count,
          the hash and the cheated mark — and the <Link href="/tournament">bracket</Link> seeds
          itself from verified saves and plays the matches out.
        </p>
      </div>

    </section>
  );
}
