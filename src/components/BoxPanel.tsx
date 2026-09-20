"use client";

import { useMemo, useState } from "react";
import { move, species as speciesById } from "@/engine/dex";
import {
  BOX_NAME_MAX,
  BOX_SIZE,
  BOX_TABS_MAX,
  boxCount,
  boxRefusal,
  EGGOMETER,
  loadLoadoutRefusal,
  LOADOUT_NAME_MAX,
  LOADOUTS_MAX,
  saveLoadoutRefusal,
  takeHeldRefusal,
  type GameState,
  type Input,
} from "@/engine/engine";
import { abilitiesOf } from "@/engine/abilities";
import { hasItem, item } from "@/engine/items";
import { ivTotal } from "@/engine/stats";
import { TYPE_NAMES } from "@/engine/dex";
import type { Individual } from "@/engine/types";
import { variant } from "@/engine/variants";
import { displayName } from "@/lib/narrate";
import { eggMood, GenderMark } from "./PartyStrip";

/** How a tab's cells can be ordered. "box" is the order they arrived in. */
type SortBy = "box" | "level" | "ivs" | "shine" | "colour" | "abilities" | "type" | "eggGroup" | "held";

const SORTS: { id: SortBy; label: string }[] = [
  { id: "box", label: "Box order" },
  { id: "level", label: "Level" },
  { id: "ivs", label: "IV total" },
  { id: "shine", label: "Shine" },
  { id: "colour", label: "Colour" },
  { id: "abilities", label: "Abilities" },
  { id: "type", label: "Type" },
  { id: "eggGroup", label: "Egg group" },
  { id: "held", label: "Holding an item" },
];

/** Best first, for every order but the box's own and the type's. */
function sortKey(creature: Individual, by: SortBy): number | string {
  const form = variant(creature.variantId);
  switch (by) {
    case "level":
      return -creature.level;
    case "ivs":
      return -ivTotal(creature.ivs);
    case "shine":
      return -form.tier;
    case "colour":
      return form.chromaId ?? "~";
    case "abilities":
      return -abilitiesOf(creature.abilities).length;
    case "type":
      return speciesById(creature.speciesId).types[0];
    // Alphabetical by the first group it is in, which puts everything that
    // can breed with everything else together — which is the only reason
    // anybody sorts a box by egg group. Ditto sorts to itself and pairs with
    // all of them anyway.
    case "eggGroup":
      return speciesById(creature.speciesId).eggGroups[0] ?? "~";
    case "held":
      return creature.heldItem ? 0 : 1;
    default:
      return 0;
  }
}

/** What a filter keeps: everyone, a quality, or one type. */
function keeps(creature: Individual, filter: string): boolean {
  const form = variant(creature.variantId);
  switch (filter) {
    case "all":
      return true;
    case "shiny":
      return form.tier > 0;
    case "colour":
      return form.chromaId !== null;
    case "ability":
      return abilitiesOf(creature.abilities).length > 0;
    case "held":
      return creature.heldItem !== null;
    default:
      return filter.startsWith("type:") && (speciesById(creature.speciesId).types as readonly string[]).includes(filter.slice(5));
  }
}
import { EggSprite, Sprite } from "./Sprite";

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

/**
 * What a search matches against: the nickname, the species, its types, and
 * the names of its abilities.
 *
 * The abilities matter most of the three once a box is full: a hundred
 * creatures sort by level and colour at a glance and by ability not at all,
 * and "which of these has Adaptability" is exactly the question a box of a
 * hundred cannot answer by looking.
 */
function matches(creature: Individual, query: string): boolean {
  const entry = speciesById(creature.speciesId);
  const haystack = [
    displayName(creature),
    entry.name,
    ...entry.types,
    ...abilitiesOf(creature.abilities).map((spec) => spec.name),
  ]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}


/**
 * The loadouts tab: teams you have written down.
 *
 * A loadout is an arrangement rather than a copy — see `Loadout` in the
 * engine — so what is drawn here is looked up fresh every render: a creature
 * that has evolved shows as what it is now, and one that has been released or
 * traded away shows as gone rather than quietly vanishing from the row.
 */
function LoadoutList({
  state,
  onInput,
}: {
  state: GameState;
  onInput: (input: Input) => void;
}) {
  const [draft, setDraft] = useState("");
  const cannotSave = saveLoadoutRefusal(state);
  const everyone = useMemo(
    () => new Map([...state.party, ...state.box].map((one) => [one.uid, one] as const)),
    [state.party, state.box],
  );

  return (
    <div className="loadouts">
      <div className="row">
        <input
          value={draft}
          placeholder="Name it (optional)"
          aria-label="Loadout name"
          maxLength={LOADOUT_NAME_MAX}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="button"
          className="primary"
          disabled={Boolean(cannotSave)}
          title={cannotSave ?? "Write down the party as it stands: who is in it, in what order, with their moves and what they are holding"}
          onClick={() => {
            onInput({ t: "saveLoadout", name: draft.trim() || undefined });
            setDraft("");
          }}
        >
          Save party
        </button>
        <span className="muted small">
          {state.loadouts.length}/{LOADOUTS_MAX}
        </span>
      </div>

      {state.loadouts.length ? (
        <ol className="loadoutList">
          {state.loadouts.map((loadout, at) => {
            const why = loadLoadoutRefusal(state, at);
            const gone = loadout.members.filter((who) => !everyone.has(who.uid)).length;
            return (
              <li key={`${loadout.name}:${at}`} className="loadoutItem">
                <div className="row">
                  <strong>{loadout.name}</strong>
                  <span className="muted small">
                    {loadout.members.length} · {gone ? `${gone} no longer with you` : "all still here"}
                  </span>
                  <button
                    type="button"
                    className="primary small"
                    disabled={Boolean(why)}
                    title={why ?? "Put this arrangement back: the party, the order, the moves and the items"}
                    onClick={() => onInput({ t: "loadLoadout", index: at })}
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    className="ghost small"
                    title="Forget this loadout"
                    aria-label={`Remove ${loadout.name}`}
                    onClick={() => onInput({ t: "dropLoadout", index: at })}
                  >
                    ✕
                  </button>
                </div>
                <div className="loadoutTeam">
                  {loadout.members.map((who, slot) => {
                    const one = everyone.get(who.uid);
                    return (
                      <span key={`${who.uid}:${slot}`} className={`loadoutMember${one ? "" : " gone"}`}>
                        {one ? (
                          <Sprite
                            speciesId={one.speciesId}
                            variantId={one.variantId}
                            abilities={one.abilities}
                            heldItem={who.heldItem}
                            size={48}
                          />
                        ) : (
                          <span className="loadoutGone" aria-hidden="true">
                            ?
                          </span>
                        )}
                        <span>
                          <strong>{one ? displayName(one) : "Gone"}</strong>
                          {one ? <span className="muted"> Lv{one.level}</span> : null}
                          <br />
                          <span className="muted small">
                            {who.moves.map((moveId) => move(moveId).name).join(", ")}
                            {who.heldItem ? ` · ${item(who.heldItem).name}` : ""}
                          </span>
                        </span>
                      </span>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="hint">
          Nothing written down yet. <strong>Save party</strong> remembers who is in it, in what order,
          with their moves in which order and what each one is holding — and <strong>Load</strong> puts
          that back. Nobody is copied: anything you have since let go is skipped.
        </p>
      )}
    </div>
  );
}

export function BoxPanel({
  state,
  onInput,
  onInspect,
  tab: shownTab,
  onTab,
}: {
  state: GameState;
  onInput: (input: Input) => void;
  onInspect: (uid: number) => void;
  /**
   * Which tab is open, when the parent needs to know — the hub does, so that
   * boxing a party member puts it in the tab you are looking at. Left off,
   * the panel keeps it to itself.
   */
  tab?: number;
  onTab?: (tab: number) => void;
}) {
  const [ownTab, setOwnTab] = useState(0);
  const tab = shownTab ?? ownTab;
  const setTab = (next: number) => {
    setOwnTab(next);
    onTab?.(next);
    // Picking a box is also how you leave the loadouts.
    setOnLoadouts(false);
  };
  const [query, setQuery] = useState("");
  const [naming, setNaming] = useState<{ tab: number; draft: string } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("box");
  const [filter, setFilter] = useState("all");
  /** Cells picked with shift- or ctrl-click, by uid, to drag onto a tab together. */
  const [picked, setPicked] = useState<number[]>([]);
  /** The loadouts tab, which shows arrangements rather than creatures. */
  const [onLoadouts, setOnLoadouts] = useState(false);

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

  const cells = (byTab[shown] ?? [])
    .filter((one) => keeps(one.creature, filter))
    .map((one, at) => ({ ...one, at }))
    .sort((a, b) => {
      if (sortBy === "box") return a.at - b.at;
      const ka = sortKey(a.creature, sortBy);
      const kb = sortKey(b.creature, sortBy);
      return (ka < kb ? -1 : ka > kb ? 1 : 0) || a.at - b.at;
    });
  const hiddenByFilter = (byTab[shown]?.length ?? 0) - cells.length;

  /** Every picked creature onto a tab, or nothing and a reason if they will not all fit. */
  const dropOn = (at: number, uid: number) => {
    const moving = picked.includes(uid) ? picked : [uid];
    const arriving = moving.filter((one) => state.boxOf[one] !== at);
    if (at !== state.hatchedTab && boxCount(state, at) + arriving.length > BOX_SIZE) {
      setWhy(`${state.boxNames[at]} does not have room for ${arriving.length}`);
      return;
    }
    for (const one of arriving) {
      const input = { t: "moveToBox" as const, uid: one, tab: at };
      const refusal = boxRefusal(state, input);
      if (refusal) {
        setWhy(refusal);
        return;
      }
    }
    setWhy(null);
    for (const one of arriving) onInput({ t: "moveToBox", uid: one, tab: at });
    setPicked([]);
  };
  /*
   * Eggs in the incubators hatch into the box, so they sit in it while they
   * wait: after the creatures, in cells that would otherwise be empty. Shown on
   * every tab, because they belong to none of them yet.
   */
  const incubating = state.daycare.incubating.slice(0, Math.max(0, BOX_SIZE - cells.length));
  const empty = Math.max(0, BOX_SIZE - cells.length - incubating.length - hiddenByFilter);
  const exact = hasItem(state.bag, EGGOMETER);
  const types = [...new Set(state.box.flatMap((one) => speciesById(one.speciesId).types))].sort(
    (a, b) => TYPE_NAMES.indexOf(a) - TYPE_NAMES.indexOf(b),
  );

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
          hidden={onLoadouts}
          placeholder="Search name, type or ability…"
          value={query}
          aria-label="Search the box"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="boxTools" hidden={onLoadouts}>
        <label>
          Sort{" "}
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortBy)}>
            {SORTS.map((one) => (
              <option key={one.id} value={one.id}>
                {one.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Show{" "}
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">Everyone</option>
            <option value="shiny">Any shine</option>
            <option value="colour">A colour</option>
            <option value="ability">An ability</option>
            <option value="held">Holding an item</option>
            {types.map((type) => (
              <option key={type} value={`type:${type}`}>
                {type[0].toUpperCase() + type.slice(1)} type
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="ghost small"
          disabled={Boolean(takeHeldRefusal(state, shown))}
          title={takeHeldRefusal(state, shown) ?? "Every item held by a creature in this box goes back to the bag"}
          onClick={() => onInput({ t: "takeHeldFromBox", tab: shown })}
        >
          Take back held items
        </button>
        {picked.length ? (
          <button type="button" className="ghost small" onClick={() => setPicked([])}>
            {picked.length} picked · clear
          </button>
        ) : null}
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
              title={
                at === state.hatchedTab
                  ? "Hatched: where incubated eggs hatch. Nothing can be put back in."
                  : "Double-click to rename. Drop a creature here to move it."
              }
              onClick={() => setTab(at)}
              onDoubleClick={() => {
                if (at !== state.hatchedTab) setNaming({ tab: at, draft: name });
              }}
              onDragOver={(event) => {
                if (dragging !== null) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging === null) return;
                dropOn(at, dragging);
                setDragging(null);
              }}
            >
              {at === state.hatchedTab ? "🥚 " : ""}
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
        {/* Not a box: a tab of arrangements rather than of creatures, which is
            why it sits apart and takes no drops. */}
        <button
          type="button"
          role="tab"
          aria-selected={onLoadouts}
          className={`tab loadoutTab${onLoadouts ? " on" : ""}`}
          title="Teams you have written down, ready to put back"
          onClick={() => setOnLoadouts(true)}
        >
          ⚔ Loadouts
          <span className="tabCount">{state.loadouts.length}</span>
        </button>
      </div>

      {onLoadouts ? (
        <LoadoutList state={state} onInput={onInput} />
      ) : (
      <div className="boxGrid" onContextMenu={(event) => event.preventDefault()}>
        {cells.map(({ creature, index }) => {
          const hit = searching && matches(creature, query);
          const isPicked = picked.includes(creature.uid);
          return (
            <button
              key={creature.uid}
              type="button"
              draggable
              className={`boxCell${hit ? " hit" : ""}${searching && !hit ? " dim" : ""}${isPicked ? " picked" : ""}`}
              aria-pressed={isPicked}
              title={`${displayName(creature)} · Lv${creature.level} — click for its sheet, shift-click to pick several, right-click to take it out${
                partyFull ? " (party is full)" : ""
              }`}
              onClick={(event) => {
                // Shift or ctrl picks it instead, so several can be dragged at once.
                if (event.shiftKey || event.ctrlKey || event.metaKey) {
                  setPicked(isPicked ? picked.filter((one) => one !== creature.uid) : [...picked, creature.uid]);
                  return;
                }
                onInspect(creature.uid);
              }}
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
                // Dragging something not yet picked starts a fresh pick of one.
                if (!isPicked && picked.length) setPicked([]);
                event.dataTransfer.setData("text/plain", String(creature.uid));
                event.dataTransfer.effectAllowed = "move";
                setDragging(creature.uid);
              }}
              onDragEnd={() => setDragging(null)}
            >
              <Sprite speciesId={creature.speciesId} variantId={creature.variantId} abilities={creature.abilities} heldItem={creature.heldItem} size={48} />
              <span className="boxCellFoot">
                <span>Lv{creature.level}</span>
                <GenderMark gender={creature.gender} />
                {state.locked.includes(creature.uid) ? <span title="Locked">🔒</span> : null}
              </span>
            </button>
          );
        })}
        {incubating.map((egg, at) => (
          <span key={`egg-${at}`} className="boxCell" title={`Egg in the incubator — ${eggMood(egg, exact)}`}>
            <EggSprite variantId={egg.creature.variantId} size={48} />
            <span className="boxCellFoot">
              <span>Incubating</span>
            </span>
          </span>
        ))}
        {Array.from({ length: empty }, (_, at) => (
          <span key={`empty-${at}`} className="boxCell empty" aria-hidden="true" />
        ))}
      </div>
      )}

      {onLoadouts ? null : (
        <p className={why ? "error" : "hint"}>
          {why ??
            `Click for its sheet · shift-click to pick several · right-click to take it out · drag onto a tab to move it · double-click a tab to name it${
              hiddenByFilter ? ` · ${hiddenByFilter} hidden by the filter` : ""
            }`}
        </p>
      )}
    </div>
  );
}
