"use client";

import { fieldNotes, type GameState } from "@/engine/engine";
import { species as speciesById } from "@/engine/dex";
import type { World } from "@/engine/world";
import { routeLabel } from "@/render/tiles";
import { typeColor } from "@/render/palette";

/**
 * Where you have looked, and what was standing there.
 *
 * The companion to the small map, and the opposite half of the same question.
 * The map remembers the *ground* you have walked past; this remembers the
 * *creatures* you walked past on it — so between them they answer "have I
 * combed this route", which is the question a world with fifty-eight decorated
 * creatures hidden in it actually asks, and which nothing here could answer
 * before.
 *
 * Grouped by place rather than listed as one long roll of names, because the
 * name of a creature is not the useful half. A list of everything you have met
 * is a collection; a list of the places you have been with what each one gave
 * up is a record of where you have actually looked, and it makes the thin
 * entries obvious — a route you crossed once and never combed sits there with
 * two names against it.
 *
 * ## What it deliberately does not say
 *
 * **No denominator.** It would be easy, and nearly free, to print "7 of the 23
 * that live here" — the encounter table is right there. It would also turn a
 * record of where you have been into a checklist of where to go, and hand over
 * the shape of every route's population before you had walked any of it. What
 * lives on a route is for the route to tell you. The same reason the Grey
 * Line's destination list is filtered rather than greyed, and the same reason
 * there are ninety-nine people out there who will tell you things rather than
 * one panel that tells you everything.
 *
 * **Nothing about rarity.** Which of these was a chroma is on the creature and
 * in the header's census count. This is a record of meeting, not of catching.
 */
export function NotesPanel({ world, state }: { world: World; state: GameState }) {
  const notes = fieldNotes(world, state);
  const total = notes.reduce((count, one) => count + one.speciesIds.length, 0);

  if (!total) {
    return (
      <p className="muted">
        Nothing yet. Everything you meet gets written down here, against the place you met it.
      </p>
    );
  }

  return (
    <div className="notes">
      <p className="muted notesCount">
        <strong>{total}</strong> {total === 1 ? "creature" : "creatures"} met, across{" "}
        <strong>{notes.length}</strong> {notes.length === 1 ? "place" : "places"}.
      </p>

      {notes.map((note) => (
        <div key={note.routeId} className="notesPlace">
          <div className="notesTop">
            <strong>{routeLabel(note.routeId)}</strong>
            <span className="muted">{note.speciesIds.length}</span>
          </div>
          <div className="notesList">
            {note.speciesIds.map((id) => {
              const spec = speciesById(id);
              return (
                <span
                  key={id}
                  className="notesName"
                  // The creature's own first type, which is how every other
                  // list of creatures in this game is coloured. Two lists of
                  // the same things wearing different colours would be two
                  // answers to "what is this".
                  style={{ borderBottomColor: typeColor(spec.types[0]) }}
                  title={spec.types.join(" · ")}
                >
                  {spec.name}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
