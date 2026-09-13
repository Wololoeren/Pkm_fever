"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { species as speciesById } from "@/engine/dex";
import { parseSave } from "@/lib/save";
import { verifySave, type Verification } from "@/lib/verify";
import { variant } from "@/engine/variants";

/**
 * Tournament check-in, as a page.
 *
 * Drop a save file on it and it replays the whole log from the seed and
 * prints what an organiser needs: the seed, how many moves, the hash, whether
 * the shortcut menu was ever used, and who is in the party. Nothing is sent
 * anywhere — it is a static page, and the file never leaves the browser —
 * which is the point: two organisers with the same file get the same word,
 * and neither had to trust the other's screen.
 *
 * The replay is the verification. See lib/verify.ts.
 */

function Result({ report }: { report: Verification }) {
  // How much of the team did not come from this playthrough. The count that
  // matters for "bring six", as opposed to how many trades ever happened.
  const tradedNow = report.party.filter((one) => one.traded).length;
  const prizedNow = report.party.filter((one) => one.prize).length;
  const cheatedNow = report.party.filter((one) => one.cheat).length;

  return (
    <div className="menuCard">
      <h2>{report.ok ? "Replays cleanly" : "Does not replay"}</h2>
      {report.error ? <p className="error">{report.error}</p> : null}
      <div className="scrollX">
        <table className="statTable">
          <tbody>
            <tr>
              <td>Seed</td>
              <td className="num">
                <code>{report.seed}</code>
              </td>
            </tr>
            <tr>
              <td>Moves</td>
              <td className="num">
                {report.moves}
                {report.failedAt !== null ? (
                  <span className="error"> · refused at input {report.failedAt + 1}</span>
                ) : null}
              </td>
            </tr>
            <tr>
              <td>Hash</td>
              <td className="num">
                <code>{report.hash}</code>
              </td>
            </tr>
            <tr>
              <td>Cheated</td>
              <td className={`num ${report.cheated || cheatedNow ? "error" : "good"}`}>
                {report.cheated ? "yes" : "no"}
                {/* A save that never touched the menu can still be holding
                    something that was conjured out of one somewhere else and
                    traded across. `cheated` cannot say that; the mark on the
                    creature can. */}
                {cheatedNow ? (
                  <span className="error">
                    {" "}
                    · {cheatedNow} cheated {cheatedNow === 1 ? "creature" : "creatures"} in the party
                  </span>
                ) : null}
              </td>
            </tr>
            {/* Beside `Cheated` rather than below the party, because the two
                are read together or not at all: "cheated: no" on its own, next
                to a creature that came out of somebody else's save, is the
                misleading half of a true statement. */}
            <tr>
              <td>Traded in</td>
              <td className={`num ${tradedNow ? "warn" : "good"}`}>
                {report.trades.length === 0
                  ? "none"
                  : `${report.trades.length} ${report.trades.length === 1 ? "trade" : "trades"}`}
                {tradedNow ? (
                  <span className="warn">
                    {" "}
                    · {tradedNow} still in the party
                  </span>
                ) : null}
              </td>
            </tr>
            <tr>
              <td>Won in a bracket</td>
              <td className={`num ${prizedNow ? "warn" : "good"}`}>
                {report.prizes.length === 0
                  ? "none"
                  : `${report.prizes.length} ${report.prizes.length === 1 ? "prize" : "prizes"}`}
                {prizedNow ? <span className="warn"> · {prizedNow} still in the party</span> : null}
              </td>
            </tr>
            <tr>
              <td>Engine</td>
              <td className="num">v{report.version}</td>
            </tr>
            <tr>
              <td>Badges</td>
              <td className="num">{report.badges}</td>
            </tr>
            <tr>
              <td>Saved</td>
              <td className="num muted">{report.savedAt ? new Date(report.savedAt).toLocaleString() : "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3>Party · {report.party.length}</h3>
      {report.party.length ? (
        <ul className="plainList">
          {report.party.map((one, at) => (
            <li key={at}>
              <strong>{one.name}</strong>
              {one.name !== speciesById(one.speciesId).name ? (
                <span className="muted"> ({speciesById(one.speciesId).name})</span>
              ) : null}{" "}
              <span className="muted">Lv{one.level}</span>
              {one.variantId !== "normal" ? <span className="tag"> {variant(one.variantId).name}</span> : null}
              {/* The one thing on this page that is not derived from the seed,
                  said on the line where somebody is looking at it. */}
              {one.traded ? <span className="tag warn"> TRADED IN</span> : null}
              {one.prize ? <span className="tag warn"> PRIZE</span> : null}
              {one.cheat ? <span className="tag fall"> CHEAT</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nobody. The log ends before a starter was picked.</p>
      )}

      {report.prizes.length ? (
        <>
          <h3>Prizes · {report.prizes.length}</h3>
          <p className="muted">
            Won by taking a bracket. The three on offer are rolled from the tournament that
            produced them, in other people&apos;s browsers, so like a trade this one is carried
            whole in the log rather than derived from this seed.
          </p>
          <ul className="plainList">
            {report.prizes.map((one) => (
              <li key={one.at}>
                <span className="muted">move {one.at + 1}</span> · <strong>{one.name}</strong>{" "}
                <span className="muted">Lv{one.level}</span>
                {one.variantId !== "normal" ? (
                  <span className="tag"> {variant(one.variantId).name}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {report.trades.length ? (
        <>
          <h3>Trades · {report.trades.length}</h3>
          <p className="muted">
            A traded creature was raised in another save and is carried whole in the log rather
            than derived from this seed. Replaying proves everything else; it cannot prove these.
          </p>
          <ul className="plainList">
            {report.trades.map((one) => (
              <li key={one.at}>
                <span className="muted">move {one.at + 1}</span> · gave{" "}
                <strong>{one.gave.name}</strong> <span className="muted">Lv{one.gave.level}</span> ·
                got <strong>{one.got.name}</strong>{" "}
                <span className="muted">Lv{one.got.level}</span>
                {one.got.variantId !== "normal" ? (
                  <span className="tag"> {variant(one.got.variantId).name}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

export default function VerifyPage() {
  const [report, setReport] = useState<Verification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function check(file: File) {
    setBusy(true);
    setError(null);
    setReport(null);
    const save = parseSave(await file.text());
    if (!save) {
      setError("That file is not a save this version can replay.");
      setBusy(false);
      return;
    }
    // Let the "replaying" line paint before the world is generated: a long
    // save is a second or two of arithmetic on the main thread.
    await new Promise((resolve) => setTimeout(resolve, 20));
    setReport(verifySave(save));
    setBusy(false);
  }

  return (
    <main>
      <section className="menu">
        <header className="brand">
          <h1>Verify a save</h1>
          <p className="tagline">
            The replay is the check. Nothing leaves this page.
          </p>
        </header>

        <div
          className={`menuCard dropZone${over ? " over" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void check(file);
          }}
        >
          <h2>Drop a save file here</h2>
          <p className="muted">
            It is replayed from its seed, input by input, and what comes out is what the
            player has. The seed, the move count, the hash and the cheated mark are what a
            tournament check-in needs; the party is listed so &quot;bring six&quot; can be checked by
            eye.
          </p>
          <p className="muted">
            Anything received in a trade is called out separately, with the move it arrived on.
            It was raised in another save and is carried whole in the log rather than derived
            from this seed — so it is the one thing on the page that replaying cannot prove.
          </p>
          <div className="row">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? "Replaying…" : "Choose a file"}
            </button>
            <Link href="/" className="ghost linkButton">
              Back to the menu
            </Link>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void check(file);
              event.target.value = "";
            }}
          />
          {error ? <p className="error">{error}</p> : null}
        </div>

        {report ? <Result report={report} /> : null}
      </section>
    </main>
  );
}
