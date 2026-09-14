"use client";

import { useMemo, useState } from "react";
import { species as speciesById } from "@/engine/dex";
import {
  BOX_NAME_MAX,
  BOX_SIZE,
  BOX_TABS_MAX,
  boxRefusal,
  type GameState,
  type Input,
} from "@/engine/engine";
import type { Individual } from "@/engine/types";
import { displayName } from "@/lib/narrate";
import { GenderMark } from "./PartyStrip";
import { Sprite } from "./Sprite";

/**
 * The box, as the handhelds laid it out: tabs of seven by seven.
 *
 * It was one long list with four buttons on every row, which is fine at ten
 * creatures and a scroll-bar at a hundred. A grid of pictures is how a person
 * finds the one they mean — by its shape and its colours — and every other
 * detail is a click away.
 *
 * - **Left click** opens its sheet, which is where releasing it and sending it
 *   to the daycare now live.
 * - **Right click** takes it out into the party.
 * - **Drag** it onto another tab to move it there.
 * - **Double-click** a tab to name it.
 * - **Search** lights up every match, in this tab and on the tabs that have
 *   one, and dims the rest.
 */

/** What a search matches against: the nickname, the species, and its types. */
function matches(creature: Individual, query: string): boolean {
  const entry = speciesById(creature.speciesId);
  const haystack = [displayName(creature), entry.name, ...entry.types].join(" ").toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export function BoxPanel({
  state,
  onInput,
  onInspect,
}: {
  state: GameState;
  onInput: (input: Input) => void;
  onInspect: (uid: number) => void;
}) {
  const [tab, setTab] = useState(0);
  const [query, setQuery] = useState("");
  const [naming, setNaming] = useState<{ tab: number; draft: string } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [why, setWhy] = useState<string | null>(null);

  const tabs = state.boxNames;
  const shown = Math.min(tab, tabs.length - 1);
  const partyFull = state.party.length + state.eggs.length >= 6;
  const searching = query.trim().length > 0;

  // Each tab's creatures in box order. A creature placed nowhere yet (a state
  // built by hand, before the engine has shelved it) sits in the first tab.
  const byTab = useMemo(() => {
    const out: { creature: Individual; index: number }[][] = tabs.map(() => []);
    state.box.forEach((creature, index) => {
      const at = state.boxOf[creature.uid] ?? 0;
      (out[at] ?? out[0]).push({ creature, index });
    });
    return out;
  }, [state.box, state.boxOf, tabs]);

  const hits = useMemo(
    () => byTab.map((members) => (searching ? members.filter((one) => matches(one.creature, query)).length : 0)),
    [byTab, query, searching],
  );

  const cells = byTab[shown] ?? [];
  const empty = Math.max(0, BOX_SIZE - cells.length);

  const saveName = () => {
    if (!naming) return;
    onInput({ t: "renameBox", tab: naming.tab, name: naming.draft });
    setNaming(null);
  };

  return (
    <div className="boxPanel">
      <div className="boxHead">
        <h3>
          Box · {state.box.length}
        </h3>
        <input
          type="search"
          className="boxSearch"
          placeholder="Search name or type…"
          value={query}
          aria-label="Search the box"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="boxTabs" role="tablist">
        {tabs.map((name, at) =>
          naming?.tab === at ? (
            <form
              key={at}
              className="boxTabName"
              onSubmit={(event) => {
                event.preventDefault();
                saveName();
              }}
            >
              <input
                autoFocus
                value={naming.draft}
                maxLength={BOX_NAME_MAX}
                aria-label="Box name"
                spellCheck={false}
                onChange={(event) => setNaming({ tab: at, draft: event.target.value })}
                onBlur={saveName}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setNaming(null);
                  }
                }}
              />
            </form>
          ) : (
            <button
              key={at}
              type="button"
              role="tab"
              aria-selected={at === shown}
              className={`tab${at === shown ? " on" : ""}${dragging !== null ? " dropTarget" : ""}${
                hits[at] ? " hasHits" : ""
              }`}
              title="Double-click to rename. Drop a creature here to move it."
              onClick={() => setTab(at)}
              onDoubleClick={() => setNaming({ tab: at, draft: name })}
              onDragOver={(event) => {
                if (dragging !== null) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging === null) return;
                const input = { t: "moveToBox" as const, uid: dragging, tab: at };
                const refusal = boxRefusal(state, input);
                setWhy(refusal);
                if (!refusal) onInput(input);
                setDragging(null);
              }}
            >
              {name}
              <span className="tabCount">
                {searching && hits[at] ? `${hits[at]} found` : `${byTab[at]?.length ?? 0}/${BOX_SIZE}`}
              </span>
            </button>
          ),
        )}
        <button
          type="button"
          className="tab"
          disabled={tabs.length >= BOX_TABS_MAX}
          title={tabs.length >= BOX_TABS_MAX ? `No more than ${BOX_TABS_MAX} boxes` : "Add a box"}
          onClick={() => {
            onInput({ t: "addBox" });
            setTab(tabs.length);
          }}
        >
          +
        </button>
      </div>

      <div className="boxGrid" onContextMenu={(event) => event.preventDefault()}>
        {cells.map(({ creature, index }) => {
          const hit = searching && matches(creature, query);
          return (
            <button
              key={creature.uid}
              type="button"
              draggable
              className={`boxCell${hit ? " hit" : ""}${searching && !hit ? " dim" : ""}`}
              title={`${displayName(creature)} · Lv${creature.level} — click for its sheet, right-click to take it out${
                partyFull ? " (party is full)" : ""
              }`}
              onClick={() => onInspect(creature.uid)}
              onContextMenu={(event) => {
                event.preventDefault();
                if (partyFull) {
                  setWhy("Your party is full");
                  return;
                }
                setWhy(null);
                onInput({ t: "retrieve", index });
              }}
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", String(creature.uid));
                event.dataTransfer.effectAllowed = "move";
                setDragging(creature.uid);
              }}
              onDragEnd={() => setDragging(null)}
            >
              <Sprite speciesId={creature.speciesId} variantId={creature.variantId} size={48} />
              <span className="boxCellFoot">
                <span>Lv{creature.level}</span>
                <GenderMark gender={creature.gender} />
              </span>
            </button>
          );
        })}
        {Array.from({ length: empty }, (_, at) => (
          <span key={`empty-${at}`} className="boxCell empty" aria-hidden="true" />
        ))}
      </div>

      <p className={why ? "error" : "hint"}>
        {why ?? "Click for its sheet · right-click to take it out · drag onto a tab to move it · double-click a tab to name it"}
      </p>
    </div>
  );
}
