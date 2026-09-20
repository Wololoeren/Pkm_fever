"use client";

import type { GameState, Input } from "@/engine/engine";
import type { World } from "@/engine/world";
import { difficulty } from "@/engine/difficulty";
import { journalOf } from "@/lib/journal";

/**
 * What has happened in this run.
 *
 * Numbers first, because they are what a journal is for — the shape of a
 * playthrough at a glance — then the badges by name, then the rival, then
 * everyone still with you in the order they arrived. Nothing here is kept;
 * see lib/journal.ts for what it is read off.
 */
export function JournalPanel({
  world,
  state,
  inputs,
}: {
  world: World;
  state: GameState;
  inputs: readonly Input[];
}) {
  const journal = journalOf(world, state, inputs);

  const rows: [string, string][] = [
    // First, because it is the thing every other number on this list has
    // to be read against.
    ["Difficulty", difficulty(state.difficulty).name],
    ["Moves", journal.moves.toLocaleString()],
    ["Steps", journal.steps.toLocaleString()],
    ["Battles", journal.battles.toLocaleString()],
    ["Turns fought", journal.turnsFought.toLocaleString()],
    ["Balls thrown", journal.ballsThrown.toLocaleString()],
    ["Switches", journal.switches.toLocaleString()],
    ["Creatures obtained", journal.obtained.toLocaleString()],
    ["Species met · caught", `${journal.speciesMet} · ${journal.speciesCaught}`],
    ["Trainers beaten", `${journal.trainersBeaten} (${journal.trainerWins} wins)`],
    ["Places", `${journal.placesVisited} of ${journal.placesInAll}`],
  ];

  return (
    <div className="journal">
      <div className="scrollX">
        <table className="statTable">
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="num">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4>Badges · {journal.badges.length}</h4>
      {journal.badges.length ? (
        <ul className="plainList">
          {journal.badges.map((badge) => (
            <li key={badge.id}>
              <strong>{badge.name}</strong> <span className="muted">· {badge.leader}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">None yet.</p>
      )}

      <h4>The rival</h4>
      <p className="muted">
        {journal.rival.visits === 0
          ? "Not yet seen."
          : `${journal.rival.visits} ${journal.rival.visits === 1 ? "visit" : "visits"}, the last at move ${(journal.rival.lastVisit ?? 0).toLocaleString()}.`}
        {journal.rival.following ? " Somebody is behind you now." : ""}
      </p>

      <h4>In order of arrival · {journal.firsts.length}</h4>
      {journal.firsts.length ? (
        <ol className="plainList">
          {journal.firsts.map((one) => (
            <li key={one.uid}>
              <strong>{one.name}</strong> <span className="muted">Lv{one.level}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Nobody yet.</p>
      )}

      {journal.cheated ? <p className="error">This save has used a testing shortcut.</p> : null}
    </div>
  );
}
