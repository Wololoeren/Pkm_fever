"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { species as speciesById } from "@/engine/dex";
import { dailySeed, parseSave } from "@/lib/save";
import { entryRefusal, runTournament, seedOrder, type Entrant, type Tournament } from "@/lib/tournament";
import { verifySave } from "@/lib/verify";

/**
 * Tournament mode.
 *
 * Drop everybody's save on it. Each is replayed and checked in exactly as the
 * verify page does it; the ones that pass are seeded by hash into a bracket
 * and played out by the engine, match by match, on this machine, from the
 * tournament seed. Two organisers with the same files get the same bracket
 * and the same champion. See lib/tournament.ts.
 */

function short(entrant: Entrant): string {
  return entrant.name.replace(/\.json$/i, "");
}

export default function TournamentPage() {
  const [entrants, setEntrants] = useState<Entrant[]>([]);
  const [seed, setSeed] = useState<string>("");
  const [size, setSize] = useState(6);
  const [sameSeed, setSameSeed] = useState(true);
  const [result, setResult] = useState<Tournament | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function checkIn(files: FileList | File[]) {
    setResult(null);
    const added: Entrant[] = [];
    for (const file of Array.from(files)) {
      setBusy(`Replaying ${file.name}…`);
      // Let the line paint before each replay: a long save is a second or
      // two of arithmetic on the main thread.
      await new Promise((resolve) => setTimeout(resolve, 20));
      const save = parseSave(await file.text());
      if (!save) continue;
      added.push({ name: file.name, report: verifySave(save) });
    }
    setBusy(null);
    setEntrants((have) => [...have.filter((one) => !added.some((two) => two.name === one.name)), ...added]);
  }

  const tournamentSeed = seed || dailySeed();
  const expected = sameSeed ? tournamentSeed : null;
  const eligible = entrants.filter((entrant) => entryRefusal(entrant.report, size, expected) === null);

  return (
    <main>
      <section className="menu">
        <header className="brand">
          <h1>Tournament</h1>
          <p className="tagline">Same seed, fixed hours, bring six.</p>
        </header>

        <div
          className="menuCard dropZone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (event.dataTransfer.files?.length) void checkIn(event.dataTransfer.files);
          }}
        >
          <h2>Check-in</h2>
          <p className="muted">
            Drop everybody&apos;s save file here. Each is replayed from its seed and checked exactly as
            the <Link href="/verify">verify page</Link> does it. A save that does not replay, or that
            used a testing shortcut, cannot enter.
          </p>
          <div className="row">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
              {busy ?? "Choose files"}
            </button>
            <Link href="/" className="ghost linkButton">
              Back to the menu
            </Link>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files?.length) void checkIn(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        <div className="menuCard">
          <h2>Rules</h2>
          <div className="row">
            <label className="muted">
              Seed{" "}
              <input
                value={seed}
                placeholder={dailySeed()}
                onChange={(event) => setSeed(event.target.value)}
                aria-label="Tournament seed"
                spellCheck={false}
              />
            </label>
            <label className="muted">
              Team size{" "}
              <select value={size} onChange={(event) => setSize(Number(event.target.value))} aria-label="Team size">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="muted">
              <input type="checkbox" checked={sameSeed} onChange={(event) => setSameSeed(event.target.checked)} />{" "}
              everybody played the tournament seed
            </label>
          </div>
          <p className="muted small">
            The bracket is drawn from the entrants&apos; hashes and every match is played by the engine
            from the seed above, so anyone with these files draws the same bracket and gets the same
            champion. Both sides are driven by the same plain AI: the bracket measures the teams.
          </p>
        </div>

        <div className="menuCard">
          <h2>Entrants · {eligible.length} of {entrants.length}</h2>
          {entrants.length ? (
            <ul className="plainList">
              {seedOrder(entrants).map((entrant) => {
                const why = entryRefusal(entrant.report, size, expected);
                return (
                  <li key={entrant.name}>
                    <strong>{short(entrant)}</strong> <code>{entrant.report.hash}</code>{" "}
                    <span className="muted">
                      · {entrant.report.moves.toLocaleString()} moves ·{" "}
                      {entrant.report.roster
                        .slice(0, size)
                        .map((one) => `${speciesById(one.speciesId).name} ${one.level}`)
                        .join(", ")}
                    </span>
                    {why ? <span className="error"> · {why}</span> : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">Nobody yet.</p>
          )}
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={eligible.length < 2 || busy !== null}
              onClick={() => setResult(runTournament(eligible, tournamentSeed, size))}
            >
              Run the bracket
            </button>
          </div>
        </div>

        {result ? (
          <div className="menuCard">
            <h2>
              {result.champion ? `${short(result.champion)} wins` : "No result"} ·{" "}
              <code>{result.seed}</code>
            </h2>
            {result.rounds.map((round, at) => (
              <div key={at}>
                <h3>
                  {at === result.rounds.length - 1
                    ? "Final"
                    : at === result.rounds.length - 2
                      ? "Semi-finals"
                      : `Round ${at + 1}`}
                </h3>
                <ul className="plainList">
                  {round.map((match, index) => (
                    <li key={index}>
                      {match.a && match.b ? (
                        <>
                          <strong>{short(match.winner!)}</strong> beat{" "}
                          {short(match.winner === match.a ? match.b : match.a)}{" "}
                          <span className="muted">
                            · {match.turns} turns · {match.left[match.winner === match.a ? 0 : 1]} left standing
                            {match.note ? ` · ${match.note}` : ""}
                          </span>
                        </>
                      ) : (
                        <>
                          <strong>{match.winner ? short(match.winner) : "—"}</strong>{" "}
                          <span className="muted">· a bye</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
