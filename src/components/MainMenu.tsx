"use client";

import { useRef, useState } from "react";
import { parseSave, randomSeed, type SaveFile } from "@/lib/save";

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
  onDuel,
}: {
  autosave: SaveFile | null;
  onNew: (seed: string) => void;
  onLoad: (save: SaveFile) => void;
  onDuel: () => void;
}) {
  const [seed, setSeed] = useState(() => randomSeed());
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
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
            aria-label="World seed"
            spellCheck={false}
          />
          <button type="button" className="ghost" onClick={() => setSeed(randomSeed())}>
            Reroll
          </button>
          <button type="button" className="primary" onClick={() => onNew(seed)}>
            Begin
          </button>
        </div>
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

      <div className="menuCard">
        <h2>1v1</h2>
        <p className="muted">
          Bring three from your save and share a room code. The browsers talk to each other
          directly — no server, no account. Moves are committed as hashes before either side
          reveals, so neither of you can read the other&apos;s choice, and the dice come from both
          your nonces so neither can bias a critical hit.
        </p>
        <div className="row">
          <button type="button" disabled={!autosave} onClick={onDuel}>
            1v1
          </button>
          <button type="button" disabled title="Run it from a spreadsheet: a bracket, and 1v1 for each match.">
            Host tournament
          </button>
        </div>
        {autosave ? null : <p className="muted">Play a little first — you need something to bring.</p>}
      </div>
    </section>
  );
}
