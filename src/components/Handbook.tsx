"use client";

import { useMemo, useState } from "react";
import { ABILITIES } from "@/engine/abilities";
import { ITEMS, type ItemKind } from "@/engine/items";
import { STAT_IDS, type StatId } from "@/engine/types";
import { appearanceId, CHROMAS, TIER_MULT, TIER_NAMES, variant } from "@/engine/variants";
import { swatchFor, typeColor } from "@/render/palette";
import { ALL_SPECIES, effectiveness, species as speciesById, TYPE_NAMES } from "@/engine/dex";
import { describeSpecialEvolution, LINKING_CORD, SOOTHE_BELL } from "@/engine/evolutions";
import { FIELD_TURNS, ROOMS, SPORTS, TERRAINS, WEATHERS, WEATHER_TYPE, type FieldFact } from "@/engine/field";

/**
 * The Pokémon Handbook, open.
 *
 * Everything in it is read straight from the tables the engine uses — the
 * rung multipliers, each colour's stat shifts, every ability's description and
 * every item's — so it cannot say one thing while the game does another.
 */

type Section = "shine" | "colour" | "types" | "abilities" | "items" | "evolving" | "field";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "shine", label: "Shine" },
  { id: "colour", label: "Colours" },
  { id: "types", label: "Types" },
  { id: "abilities", label: "Abilities" },
  { id: "items", label: "Items" },
  { id: "evolving", label: "Evolving" },
  { id: "field", label: "Weather" },
];

/** A multiplier as the handbook says it: 1500 → "×1.5". */
function times(mille: number): string {
  return `×${(mille / 1000).toFixed(mille % 100 === 0 ? 1 : 3).replace(/0+$/, "").replace(/\.$/, ".0")}`;
}

/** One weather, terrain or sport: what it moves, and what else it does. */
function FieldRow({ fact, ball }: { fact: FieldFact; ball?: string }) {
  return (
    <div>
      <dt>
        {fact.name}
        {/* Only when the move is called something else: "Hail · Hail" is not
            a fact, it is a stutter. */}
        {fact.from === fact.name ? null : <span className="muted"> · {fact.from}</span>}
      </dt>
      <dd>
        {fact.power.length ? (
          <>
            {fact.power.map((one, at) => (
              <span key={one.type}>
                {at ? ", " : ""}
                <strong>{times(one.mille)}</strong> on {one.type[0].toUpperCase()}
                {one.type.slice(1)}
                {one.grounded === "attacker"
                  ? " for an attacker on the ground"
                  : one.grounded === "target"
                    ? " into a target on the ground"
                    : ""}
              </span>
            ))}
            .{" "}
          </>
        ) : null}
        {fact.notes.join(" ")}
        {ball ? ` Weather Ball becomes ${ball[0].toUpperCase()}${ball.slice(1)}.` : ""}
      </dd>
    </div>
  );
}

/**
 * Every evolution in the game, in one list, said in the terms this game uses.
 *
 * Built from the same two places the engine evolves things out of — the
 * manifest's `evolvesTo` for the plain ones, `describeSpecialEvolution` for
 * everything with a rule — so the handbook cannot promise a door the game
 * does not open. Sorted by what you are holding rather than what you want,
 * because that is the question somebody actually has: *this* thing, now what?
 */
interface EvolutionLine {
  from: string;
  fromName: string;
  toName: string;
  how: string;
}

function evolutionLines(): EvolutionLine[] {
  const out: EvolutionLine[] = [];
  for (const entry of ALL_SPECIES) {
    for (const step of entry.evolvesTo) {
      const into = speciesById(step.id);
      const special = describeSpecialEvolution(entry.id, step.id);
      const how =
        special ??
        (step.method === "useItem" && step.item
          ? `use a ${step.item}`
          : step.level > 0
            ? `reach level ${step.level}`
            : "level up");
      out.push({ from: entry.id, fromName: entry.name, toName: into.name, how });
    }
  }
  return out.sort((a, b) => a.fromName.localeCompare(b.fromName) || a.toName.localeCompare(b.toName));
}

const STAT_LABEL: Record<StatId, string> = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };

/** Where the item kinds are listed, and what each is called. The bag's order. */
const KIND_LABEL: Record<ItemKind, string> = {
  medicine: "Medicine",
  ball: "Balls",
  field: "Field",
  hold: "Held",
  berry: "Berries",
  stone: "Stones",
  tonic: "Tonics",
  hm: "Tools",
  tm: "Machines",
  rod: "Rods",
  lure: "Lures",
  treasure: "Valuables",
  breeding: "Breeding",
  key: "Keys",
  ink: "Inks",
};

/** A per-mille multiplier as a signed percentage: 1085 → "+8.5%". */
function percent(mille: number): string {
  const change = (mille - 1000) / 10;
  if (change === 0) return "—";
  return `${change > 0 ? "+" : ""}${change}%`;
}

function tone(mille: number): string {
  return mille > 1000 ? "good" : mille < 1000 ? "error" : "muted";
}

/** Case-insensitive, every word somewhere in the text. */
function matches(text: string, query: string): boolean {
  const haystack = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export function Handbook({
  owned,
  onClose,
}: {
  /**
   * Every ability something of yours is carrying. The list is the point: an
   * ability belongs to an individual, so the only way to know whether you
   * have one is to look at everything you own, and nobody is doing that by
   * hand across a box of two hundred.
   */
  owned?: ReadonlySet<string>;
  onClose: () => void;
}) {
  const [section, setSection] = useState<Section>("shine");
  const [query, setQuery] = useState("");

  const abilities = useMemo(
    () =>
      [...ABILITIES]
        .sort((a, b) => a.name.localeCompare(b.name))
        .filter((one) => matches(`${one.name} ${one.blurb}`, query)),
    [query],
  );

  const items = useMemo(() => {
    const shown = ITEMS.filter((one) => matches(`${one.name} ${one.blurb}`, query));
    const groups = new Map<string, typeof shown>();
    for (const one of shown) {
      const label = KIND_LABEL[one.kind] ?? one.kind;
      groups.set(label, [...(groups.get(label) ?? []), one]);
    }
    return [...groups.entries()].map(([label, list]) => [label, [...list].sort((a, b) => a.name.localeCompare(b.name))] as const);
  }, [query]);

  // Built once: it is a walk over the whole dex, and it cannot change while
  // the handbook is open.
  const allEvolutions = useMemo(evolutionLines, []);
  const evolutions = useMemo(
    () => allEvolutions.filter((one) => matches(`${one.fromName} ${one.toName} ${one.how}`, query)),
    [allEvolutions, query],
  );

  const searchable = section === "abilities" || section === "items" || section === "evolving";

  return (
    <div className="cheatBackdrop" role="dialog" aria-label="Pokémon Handbook">
      <section className="cheatPanel handbook">
        <header className="handbookHead">
          <div className="cheatHead">
            <h2>Pokémon Handbook</h2>
            <button type="button" className="ghost" onClick={onClose}>
              Close
            </button>
          </div>
          <div className="tabs" role="tablist">
            {SECTIONS.map((one) => (
              <button
                key={one.id}
                type="button"
                role="tab"
                aria-selected={section === one.id}
                className={`tab${section === one.id ? " on" : ""}`}
                onClick={() => setSection(one.id)}
              >
                {one.label}
              </button>
            ))}
          </div>
          {searchable ? (
            <input
              type="search"
              className="boxSearch"
              placeholder={
                section === "abilities"
                  ? "Search abilities…"
                  : section === "items"
                    ? "Search items…"
                    : "Search a name, an item, a move…"
              }
              value={query}
              aria-label="Search the handbook"
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : null}
        </header>

        {section === "shine" ? (
          <>
            <p className="muted">
              Six rungs, from ordinary to a true shiny. Each rung multiplies every stat by the same amount — the
              climb is small until the very top.
            </p>
            <div className="tableScroll">
              <table className="handbookTable">
                <thead>
                  <tr>
                    <th>Rung</th>
                    <th>Name</th>
                    <th className="num">Every stat</th>
                  </tr>
                </thead>
                <tbody>
                  {TIER_NAMES.map((name, tier) => (
                    <tr key={name}>
                      <td className="num">{tier}</td>
                      <td>{tier === TIER_NAMES.length - 1 ? `★ ${name}` : tier ? `✦${tier} ${name}` : name}</td>
                      <td className={`num ${tone(TIER_MULT[tier])}`}>{percent(TIER_MULT[tier])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {section === "colour" ? (
          <>
            <p className="muted">
              Eight colours, each with its own stat shape. A colour stacks with a shine rung: both multiply.
            </p>
            <div className="tableScroll">
              <table className="handbookTable">
                <thead>
                  <tr>
                    <th>Colour</th>
                    {STAT_IDS.map((stat) => (
                      <th key={stat} className="num">
                        {STAT_LABEL[stat]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CHROMAS.map((form) => (
                    <tr key={form.id}>
                      <td>
                        <span
                          className="handbookSwatch"
                          style={{ background: swatchFor(variant(appearanceId(0, form.id))) }}
                          aria-hidden
                        />
                        {form.name}
                      </td>
                      {STAT_IDS.map((stat) => (
                        <td key={stat} className={`num ${tone(form.mult[stat])}`}>
                          {percent(form.mult[stat])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {section === "types" ? (
          <>
            <p className="muted">
              Down the side, the attacking move&apos;s type; across the top, the type it hits. A creature with two
              types multiplies both. Hover a cell for it in words.
            </p>
            <div className="tableScroll">
              <table className="handbookTable typeChart">
                <thead>
                  <tr>
                    <th />
                    {TYPE_NAMES.map((type) => (
                      <th key={type} title={type}>
                        <span className="typePill" style={{ background: typeColor(type) }}>
                          {type.slice(0, 3)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TYPE_NAMES.map((attack) => (
                    <tr key={attack}>
                      <th>
                        <span className="typePill" style={{ background: typeColor(attack) }}>
                          {attack}
                        </span>
                      </th>
                      {TYPE_NAMES.map((defend) => {
                        const quarters = effectiveness(attack, [defend]);
                        const text = quarters === 0 ? "0" : quarters === 2 ? "½" : quarters === 8 ? "2" : "";
                        const tone = quarters === 0 ? "immune" : quarters < 4 ? "resist" : quarters > 4 ? "super" : "";
                        return (
                          <td
                            key={defend}
                            className={`typeCell ${tone}`}
                            title={`${attack} against ${defend}: ×${quarters / 4}`}
                          >
                            {text}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {section === "abilities" ? (
          <>
            <p className="muted">
              {abilities.length} of {ABILITIES.length}. An ability belongs to the individual, not the species — most
              wild creatures have none.
              {owned ? (
                <>
                  {" "}
                  You are carrying <strong>{[...owned].filter((id) => ABILITIES.some((one) => one.id === id)).length}</strong>{" "}
                  of them: <span className="abilityHad">✓</span> is one you have, <span className="abilityWant">▲</span> one
                  you do not.
                </>
              ) : null}
            </p>
            <dl className="handbookList">
              {abilities.map((one) => (
                <div key={one.id}>
                  <dt>
                    {owned ? <AbilityMark had={owned.has(one.id)} /> : null}
                    {one.name}
                  </dt>
                  <dd>{one.blurb}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}

        {section === "field" ? (
          <>
            <p className="muted">
              What is true of the battle rather than of either side. A weather, a terrain and a sport
              each hold for <strong>{FIELD_TURNS} turns</strong>, and one of each can be up at once —
              a second weather replaces the first. The numbers below are the ones the damage formula
              actually applies; a test measures a real swing against each of them.
            </p>

            <h3>Weather</h3>
            <dl className="handbookList">
              {WEATHERS.map((fact) => (
                <FieldRow key={fact.id} fact={fact} ball={WEATHER_TYPE[fact.id as keyof typeof WEATHER_TYPE]} />
              ))}
            </dl>

            <h3>Terrain</h3>
            <p className="muted small">
              A terrain is the ground, so it only reaches what is standing on it: anything Flying, or
              held up by Levitate or a balloon, is above all of this.
            </p>
            <dl className="handbookList">
              {TERRAINS.map((fact) => (
                <FieldRow key={fact.id} fact={fact} />
              ))}
            </dl>

            <h3>Sports</h3>
            <dl className="handbookList">
              {SPORTS.map((fact) => (
                <FieldRow key={fact.id} fact={fact} />
              ))}
            </dl>

            <h3>Rooms</h3>
            <p className="muted small">
              Not weather and not ground, and several can be up together.
            </p>
            <dl className="handbookList">
              {ROOMS.map((one) => (
                <div key={one.id}>
                  <dt>{one.name}</dt>
                  <dd>{one.note}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}

        {section === "evolving" ? (
          <>
            <p className="muted">
              Everything that grows into something else, and what it takes. Four of the ways the games
              ask for are things this game has no way to do — there is nobody to trade a creature back
              to you, nothing measures friendship, and there is no clock — so each is answered with
              something you can carry:
            </p>
            <dl className="handbookList">
              <div>
                <dt>A trade</dt>
                <dd>
                  A <strong>{LINKING_CORD}</strong>, used from the bag like a stone. Where the trade
                  wanted an item held as well, hold that item and level up — or use the cord while
                  holding it — and the item is used up.
                </dd>
              </div>
              <div>
                <dt>Friendship</dt>
                <dd>
                  A <strong>{SOOTHE_BELL}</strong> carried at a level-up. It is not used up, so one
                  bell raises a whole party, one creature at a time.
                </dd>
              </div>
              <div>
                <dt>Knowing a move</dt>
                <dd>Exactly that: know the move, then level up. The move stays.</dd>
              </div>
              <div>
                <dt>A place, a time of day, a spin of the console</dt>
                <dd>
                  Each gets the nearest honest thing this world has — an item, a move it learns, or a
                  level. What it is says so in the list below.
                </dd>
              </div>
            </dl>
            <p className="muted">
              {evolutions.length} of {allEvolutions.length}.
            </p>
            <div className="tableScroll">
              <table className="handbookTable">
                <thead>
                  <tr>
                    <th>From</th>
                    <th>Into</th>
                    <th>What it takes</th>
                  </tr>
                </thead>
                <tbody>
                  {evolutions.map((one) => (
                    <tr key={`${one.from}>${one.toName}`}>
                      <td>{one.fromName}</td>
                      <td>{one.toName}</td>
                      <td className="muted">{one.how}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {section === "items" ? (
          <>
            <p className="muted">
              {items.reduce((total, [, list]) => total + list.length, 0)} of {ITEMS.length}.
            </p>
            {items.map(([label, list]) => (
              <div key={label}>
                <h3>
                  {label} <span className="muted">· {list.length}</span>
                </h3>
                <dl className="handbookList">
                  {list.map((one) => (
                    <div key={one.id}>
                      <dt>
                        {one.name}
                        {one.price > 0 ? <span className="muted"> · ¤{one.price.toLocaleString()}</span> : null}
                      </dt>
                      <dd>{one.blurb}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </>
        ) : null}
      </section>
    </div>
  );
}

/**
 * Whether you are carrying one of these: a tick, or a yellow angle.
 *
 * Exported because a wild creature's sheet asks the same question in the
 * same words — one mark, one meaning, wherever it is drawn.
 */
export function AbilityMark({ had }: { had: boolean }) {
  return had ? (
    <span className="abilityHad" title="One of yours already has this" aria-label="already have">
      ✓
    </span>
  ) : (
    <span className="abilityWant" title="Nothing of yours has this" aria-label="do not have">
      ▲
    </span>
  );
}
