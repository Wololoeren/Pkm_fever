"use client";

import { useEffect, useRef, useState } from "react";
import { FriendsRoom, roomsSummary, type FriendsFeed } from "./FriendsRoom";
import { createPortal } from "react-dom";
import { hasSeen, peopleOn, wantsRematch, type GameState } from "@/engine/engine";
import { TILE } from "@/engine/terrain";
import { arena as arenaSpec } from "@/engine/arenas";
import { gym as gymSpec, type GymSpec } from "@/engine/gyms";
import type { NpcKind } from "@/engine/npc";
import { HUB_ID, type Route, type World } from "@/engine/world";
import { NPC_COLOURS } from "@/render/people";
import { paletteFor, tileColor } from "@/render/tiles";

/**
 * Two maps, because there are two questions.
 *
 * "Where am I on this route" and "where is this route in the world" are not
 * the same thing, and one picture answers them badly. So: a scaled-down view
 * of the map you are standing on, and under it the corridor diagram of the
 * region.
 *
 * The region diagram is not a shrunken map either — it is the graph. Fifty
 * places on a lattice around one town, a dot each, joined by a line wherever
 * you can walk from one to the other.
 *
 * It used to be a fan of twenty arms, and a fan was the honest picture of a
 * world where the only questions were which arm and how far out. There are no
 * arms now: there are loops, junctions and a few blind ends, and the useful
 * question is "what have I not walked yet". So the dots are drawn at the cells
 * the places actually occupy and the lines at the crossings that actually
 * exist, which makes this a drawing of the world rather than a diagram of it.
 */

const MINI_WIDTH = 176;

/** Which of the two big map windows are open. Kept by the page, not the minimap. */
export interface BigMapsOpen {
  local: boolean;
  region: boolean;
}

/**
 * The two big map windows. Rendered by the page outside the field, because the
 * minimap is not on screen during a battle and a window that belonged to it
 * closed with every fight.
 *
 * One window each: the route and the region are read at different moments,
 * and a player with two screens wants to put them in different places.
 */
export function BigMaps({
  world,
  state,
  open,
  onOpen,
  onTileClick,
}: {
  world: World;
  state: GameState;
  open: BigMapsOpen;
  onOpen: (change: Partial<BigMapsOpen>) => void;
  onTileClick?: (x: number, y: number) => void;
}) {
  const route = world.routes.get(state.route);
  const outer = route?.kind === "interior" ? (route.parent ?? state.route) : state.route;
  const setPoppedLocal = (local: boolean) => onOpen({ local });
  const setPoppedRegion = (region: boolean) => onOpen({ region });
  return (
    <>
      {open.local ? (
        <BigMapWindow name="pkm-fever-map" title="Pkm Fever — map" width={BIG_LOCAL + 60} height={900} onClose={() => setPoppedLocal(false)}>
          <h2 className="bigWhere">{route?.label ?? "Nowhere"}</h2>
          <LocalMap world={world} state={state} width={BIG_LOCAL} onTileClick={onTileClick} />
        </BigMapWindow>
      ) : null}
      {open.region ? (
        <BigMapWindow name="pkm-fever-region" title="Pkm Fever — region" width={BIG_REGION + 60} height={BIG_REGION + 110} onClose={() => setPoppedRegion(false)}>
          <h2 className="bigWhere">{route?.label ?? "Nowhere"}</h2>
          <RegionMap world={world} state={state} outer={outer} size={BIG_REGION} />
        </BigMapWindow>
      ) : null}
    </>
  );
}

export function MiniMap({
  world,
  state,
  onTileClick,
  bigMaps,
  onBigMaps,
  friends,
}: {
  world: World;
  state: GameState;
  /** A tile tapped or clicked on the local map, in route coordinates. */
  onTileClick?: (x: number, y: number) => void;
  bigMaps: BigMapsOpen;
  onBigMaps: (change: Partial<BigMapsOpen>) => void;
  /** The room of friends, when the page is holding one. */
  friends?: FriendsFeed;
}) {
  /** Whether the subscribe row is showing. Closed by default: it is a thing
   * you do once and then forget about. */
  const [asking, setAsking] = useState(false);
  const route = world.routes.get(state.route);
  // Standing indoors, the region map should still light up the town you are
  // indoors in — a door is not a journey.
  const outer = route?.kind === "interior" ? (route.parent ?? state.route) : state.route;
  const poppedLocal = bigMaps.local;
  const poppedRegion = bigMaps.region;
  const setPoppedLocal = (local: boolean) => onBigMaps({ local });
  const setPoppedRegion = (region: boolean) => onBigMaps({ region });

  return (
    <div className="miniMap">
      {/* Where you are, over the map of it. The header at the top of the page
          says it too, but the header is a long way from the picture and the
          picture is the thing you are reading when you want to know. */}
      <h3 className="miniWhere">{route?.label ?? "Nowhere"}</h3>
      <LocalMap world={world} state={state} onTileClick={onTileClick} />
      <RegionMap world={world} state={state} outer={outer} />
      <div className="mapPops">
        <button
          type="button"
          className="ghost small mapPop"
          title={poppedLocal ? "Close the map window" : "This route's map, big, in a window you can put on another screen"}
          onClick={() => setPoppedLocal(!poppedLocal)}
        >
          {poppedLocal ? "Close big map" : "Big map"}
        </button>
        <button
          type="button"
          className="ghost small mapPop"
          title={poppedRegion ? "Close the node map window" : "The region's node map, big, in a window of its own"}
          onClick={() => setPoppedRegion(!poppedRegion)}
        >
          {poppedRegion ? "Close node map" : "Big node map"}
        </button>
      </div>

      {/* Under the node map, because playing alongside somebody is a thing
          you decide at the start rather than when you eventually find a
          Doomscroller — which is where this used to be the only way in. */}
      {friends ? (
        <div className="miniFriends">
          <button
            type="button"
            className={`ghost small mapPop${friends.codes.length ? " on" : ""}`}
            aria-expanded={asking}
            title={
              friends.codes.length
                ? `Subscribed to ${roomsSummary(friends)}`
                : "Type a friend's room code and hear their game: what they catch, what beats them, and what they have up for trade at Tim's. You can be in several at once."
            }
            onClick={() => setAsking(!asking)}
          >
            {friends.codes.length ? `Friends · ${roomsSummary(friends)}` : "Subscribe to a friend"}
          </button>
          {asking ? (
            <>
              <FriendsRoom friends={friends} />
              <p className="muted small">
                A code shared between you, and as many of them as you have circles of friends. Nothing
                that arrives touches your save: it is their word about their own game.
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** How wide the maps are drawn in windows of their own. */
const BIG_LOCAL = 1060;
const BIG_REGION = 900;

/**
 * A second browser window, with the same two maps drawn large in it.
 *
 * A portal rather than a page: the window is fed by the React tree that is
 * already running, so it redraws every time the game does — walk a step and
 * the dot moves in both places. A route of its own would need the state
 * shipped across, and two copies of a save is exactly the thing this project
 * spends its time not doing.
 *
 * The page's stylesheets are cloned into it on open. In development Next
 * serves them as <link> elements and in a build as <style>, so both are
 * copied; nothing here knows which it got.
 */
function BigMapWindow({
  children,
  name,
  title,
  width,
  height,
  onClose,
}: {
  children: React.ReactNode;
  name: string;
  title: string;
  width: number;
  height: number;
  onClose: () => void;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  // Held in a ref: the parent hands a fresh arrow every render, and every step
  // is a render. With it in the effect's dependencies the window was closed
  // and opened again on each move.
  const closing = useRef(onClose);
  closing.current = onClose;

  useEffect(() => {
    const onClose = () => closing.current();
    const popup = window.open("", name, `width=${width},height=${height},scrollbars=yes`);
    // Blocked by the browser: nothing to draw into, and the button goes back
    // to saying "open" rather than pretending something happened.
    if (!popup) {
      onClose();
      return;
    }

    popup.document.title = title;
    // Emptied first: a window under this name may be one this effect already
    // furnished — React mounts an effect twice in development, and the player
    // can press the button again after the window was left open — and two sets
    // of stylesheets in a head is two of everything.
    popup.document.head.replaceChildren();
    popup.document.body.replaceChildren();
    for (const sheet of document.querySelectorAll('style, link[rel="stylesheet"]')) {
      popup.document.head.appendChild(sheet.cloneNode(true));
    }
    const mount = popup.document.createElement("div");
    mount.className = "bigMap";
    popup.document.body.appendChild(mount);
    setHost(mount);

    // Closing the window is the other way of pressing the button, and the
    // parent has to hear about it or the button lies. `unload` covers the
    // player closing it; the interval covers the browser closing it for them.
    const gone = () => onClose();
    popup.addEventListener("unload", gone);
    const watch = window.setInterval(() => {
      if (popup.closed) onClose();
    }, 500);

    return () => {
      window.clearInterval(watch);
      popup.removeEventListener("unload", gone);
      popup.close();
    };
    // Opened once, with the size and name it was first given.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return host ? createPortal(children, host) : null;
}

/**
 * The map you are standing on, small, and only the parts you have looked at.
 *
 * It drew the whole route before, which made it a satellite photograph: you
 * arrived somewhere new and the map already knew the way through. Fog turns it
 * into what a small map should be — a record of where you have been, and a
 * picture of how much of a place is left.
 *
 * What counts as looked at is `hasSeen`, folded in the engine from what the
 * camera showed you. Coarser than a tile, so it reads as regions of a route
 * rather than a torch beam; see `FOG`.
 */
function LocalMap({
  world,
  state,
  width = MINI_WIDTH,
  onTileClick,
}: {
  world: World;
  state: GameState;
  width?: number;
  onTileClick?: (x: number, y: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const route = world.routes.get(state.route);
  // Routes are 88x68, so the floor has to come down or the local map is half
  // again wider than the column it sits in. Interiors, being tiny, still get
  // fat pixels. The ceiling rises with the width asked for: in a window of its
  // own there is room for a tile you can actually see.
  const cell = route ? Math.max(2, Math.min(Math.round(width / 20), Math.floor(width / route.width))) : 4;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !route) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const seen = (x: number, y: number) => hasSeen(state, route, x, y);

    for (let y = 0; y < route.height; y++) {
      for (let x = 0; x < route.width; x++) {
        const tile = route.tiles[y * route.width + x];
        // Unwalked ground is drawn rather than left blank, so the shape of the
        // canvas still tells you how big the place is.
        ctx.fillStyle = seen(x, y) ? tileColor(route.biome, tile, x, y) : "#141920";
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }

    // Doors, because on a map the size of a stamp a brown tile in a red roof
    // is invisible and knowing where you can go in is the whole point.
    ctx.fillStyle = "#ffd98a";
    for (const door of route.doors) {
      if (!seen(door.x, door.y)) continue;
      ctx.fillRect(door.x * cell, door.y * cell, cell, cell);
    }
    for (let y = 0; y < route.height; y++) {
      for (let x = 0; x < route.width; x++) {
        if (route.tiles[y * route.width + x] !== TILE.EXIT) continue;
        if (!seen(x, y)) continue;
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }

    // People still standing. Trainers resting after a loss are off the map:
    // drawing them would suggest a fight that is not there. Once they want a
    // rematch they are back on it.
    // Nor is anybody drawn on ground you have not looked at — the map cannot
    // know about somebody you have never seen.
    ctx.fillStyle = "#5b86d6";
    for (const trainer of world.trainers.get(route.id) ?? []) {
      if (!wantsRematch(state, trainer.id)) continue;
      if (!seen(trainer.x, trainer.y)) continue;
      ctx.fillRect(trainer.x * cell, trainer.y * cell, cell, cell);
    }

    const px = state.x * cell + cell / 2;
    const py = state.y * cell + cell / 2;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2.5, cell * 0.7), 0, Math.PI * 2);
    ctx.fillStyle = "#d8524a";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#12161d";
    ctx.stroke();
  }, [world, state, route, cell]);

  if (!route) return null;

  return (
    // No caption: the header above the map already names where you are, and
    // saying it twice on one screen is one label too many.
    <div className="miniLocal">
      <canvas
        ref={ref}
        width={route.width * cell}
        height={route.height * cell}
        aria-label={`Map of ${route.label}`}
        className={onTileClick ? "walkable" : undefined}
        onClick={(event) => {
          if (!onTileClick) return;
          const box = event.currentTarget.getBoundingClientRect();
          const px = ((event.clientX - box.left) * event.currentTarget.width) / box.width;
          const py = ((event.clientY - box.top) * event.currentTarget.height) / box.height;
          onTileClick(Math.floor(px / cell), Math.floor(py / cell));
        }}
      />
    </div>
  );
}

/** A ring the Pokédex asks for: where a species was met, or where it lives. */
export interface MapMark {
  routeId: string;
  kind: "met" | "lives";
}

/**
 * The region: the whole graph, and which dot you are standing on.
 *
 * Exported for the Pokédex, which draws the same map with rings on it. The
 * same drawing on purpose: a second region map that placed a route
 * differently would be a second world.
 */
export function RegionMap({
  world,
  state,
  outer,
  marks = [],
  size = MINI_WIDTH,
  reachable,
  onPick,
  onSelect,
  selected,
}: {
  world: World;
  state: GameState;
  outer: string;
  marks?: readonly MapMark[];
  /** How wide to draw it. The default is the one under the field map. */
  size?: number;
  /**
   * Places a coach will take you, ringed in bright green and clickable.
   *
   * The travel post reads the same drawing the field map does rather than a
   * list of its own: a rider picks a dot on the map of the region, which is
   * how you would ask for a journey out loud.
   */
  reachable?: readonly string[];
  onPick?: (routeId: string) => void;
  /**
   * Every place clickable, for a map that is being *read* rather than
   * travelled: the Pokédex asks which zone you want to know about, and the
   * answer is any of them, ringed or not.
   */
  onSelect?: (routeId: string) => void;
  /** The place `onSelect` last picked, ringed so the map says what it is showing. */
  selected?: string | null;
}) {
  const pad = 9;
  const canGo = new Set(reachable ?? []);
  const gyms = gymsOnMap(world, state);
  const people = peopleOnMap(world, state);

  // Every place that has a cell — the fifty routes and the town. Interiors do
  // not: a room behind a door is not anywhere on the lattice.
  const places = [...world.routes.values()].filter(
    (route) => route.kind === "route" || route.kind === "town",
  );

  // The lattice is lumpy and off-centre by construction, so its extent is
  // measured rather than assumed, and the shorter axis is centred inside the
  // square. Scaled by the longer axis so a world that grew wide is drawn
  // wide rather than squashed to fit.
  const minX = Math.min(...places.map((place) => place.cell.x));
  const maxX = Math.max(...places.map((place) => place.cell.x));
  const minY = Math.min(...places.map((place) => place.cell.y));
  const maxY = Math.max(...places.map((place) => place.cell.y));
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const step = (size - pad * 2) / span;

  const at = (cell: { x: number; y: number }) => ({
    x: pad + (cell.x - minX) * step + ((span - (maxX - minX)) * step) / 2,
    y: pad + (cell.y - minY) * step + ((span - (maxY - minY)) * step) / 2,
  });

  const dot = Math.max(2.4, Math.min(5, step * 0.34));

  // One line per crossing rather than two. Borders are written from both
  // sides — that is what makes stepping out and back a round trip — so the
  // pairs are deduplicated here by name.
  const drawn = new Set<string>();
  const edges: { from: Route; to: Route; walked: boolean }[] = [];
  for (const place of places) {
    for (const border of place.borders) {
      const other = world.routes.get(border.to);
      if (!other || (other.kind !== "route" && other.kind !== "town")) continue;
      const key = place.id < other.id ? `${place.id}|${other.id}` : `${other.id}|${place.id}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      edges.push({
        from: place,
        to: other,
        // Both ends walked. Drawn brighter, which is what turns the picture
        // from a diagram of the world into a record of where you have been:
        // the dim lines are the ones still to take.
        walked: [place, other].every(
          (end) => end.id === HUB_ID || state.visited.includes(end.id),
        ),
      });
    }
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Map of the region">
      {edges.map(({ from, to, walked }) => {
        const a = at(from.cell);
        const b = at(to.cell);
        return (
          <line
            key={`${from.id}|${to.id}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            // `--line` is a hairline against a panel and vanished entirely at
            // this size: sixty-four crossings were being drawn and none of
            // them could be seen, which left the map a field of loose dots.
            stroke="var(--muted)"
            strokeOpacity={walked ? 0.85 : 0.3}
            strokeWidth={walked ? 2 : 1.25}
          />
        );
      })}

      {/* Rings under the dots, so a marked place is still the colour it was.
          Solid for where a thing was met, dashed for where it lives. */}
      {marks.map((mark) => {
        const place = world.routes.get(mark.routeId);
        if (!place || (place.kind !== "route" && place.kind !== "town")) return null;
        const here = at(place.cell);
        return (
          <circle
            key={`${mark.kind}:${mark.routeId}`}
            cx={here.x}
            cy={here.y}
            r={dot + (mark.kind === "met" ? 5 : 7)}
            fill="none"
            stroke={mark.kind === "met" ? "var(--accent)" : "var(--muted)"}
            strokeWidth={mark.kind === "met" ? 2.5 : 1.5}
            strokeDasharray={mark.kind === "met" ? undefined : "3 2"}
          >
            <title>{`${place.label} — ${mark.kind === "met" ? "first met here" : "lives here"}`}</title>
          </circle>
        );
      })}

      {/* The bright ring: where this coach goes. Over the lines and under the
          dots, so it reads as a halo around the place rather than a dot of
          its own. */}
      {places
        .filter((place) => canGo.has(place.id))
        .map((place) => {
          const here = at(place.cell);
          return (
            <circle
              key={`go:${place.id}`}
              cx={here.x}
              cy={here.y}
              r={dot + 4}
              fill="none"
              stroke="var(--go)"
              strokeWidth={2.5}
            />
          );
        })}

      {places.map((place) => {
        const here = at(place.cell);
        // By kind, not by id: there are four towns now and only one of them
        // is home.
        const town = place.kind === "town";
        // `town ||` used to be here, from when there was one town and it was
        // where you started. With four of them that read as "every town has
        // been visited", so the map handed you the location of three towns you
        // had never walked to.
        const visited = state.visited.includes(place.id);
        const current = place.id === outer;
        const palette = paletteFor(place.biome);

        const travel = canGo.has(place.id) && onPick;
        const go = travel || Boolean(onSelect);
        const act = () => {
          if (travel) onPick(place.id);
          else onSelect?.(place.id);
        };
        const hall = gyms.get(place.id);

        return (
          // No labels. Fifty names in a 176px square would be ink rather than
          // answer; the places are told apart by the colour of the ones you
          // have walked, and hovering one names it.
          <circle
            key={place.id}
            className={go ? "mapGo" : undefined}
            role={go ? "button" : undefined}
            tabIndex={go ? 0 : undefined}
            onClick={go ? act : undefined}
            onKeyDown={
              go
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      act();
                    }
                  }
                : undefined
            }
            cx={here.x}
            cy={here.y}
            r={place.id === selected ? dot + 3 : current ? dot + 2 : town ? dot + 1 : dot}
            // Unwalked places are drawn but empty: the shape of the world is
            // not a secret, only what is in it.
            fill={town ? (visited ? "var(--accent)" : "var(--panel-2)") : visited ? palette.grass : "var(--bg)"}
            stroke={place.id === selected ? "var(--warn)" : current ? "var(--accent)" : "var(--muted)"}
            strokeOpacity={current || visited ? 1 : 0.45}
            strokeWidth={place.id === selected || current ? 3 : 1.25}
          >
            <title>
              {`${place.label}${town ? " — a town" : ""}${visited ? "" : " — not yet visited"}${
                hall ? ` — ${gymLine(hall)}` : ""
              }${
                people.get(place.id)?.length
                  ? ` — ${people.get(place.id)!.map((who) => who.name).join(", ")}`
                  : ""
              }${travel ? " — click to travel here" : onSelect ? " — click for what lives here" : ""}`}
            </title>
          </circle>
        );
      })}

      {/* Who runs something where, in the colours they are drawn in out in
          the world — the same plaque colour as the door of the room they
          move into, if they have moved into Hearth. A ring of beads around
          the place rather than a legend: the hover already names them, and
          what the map is for is noticing that a place has somebody at all. */}
      {places.flatMap((place) => {
        const here = people.get(place.id) ?? [];
        if (!here.length) return [];
        const spot = at(place.cell);
        // Six at most, because seven beads around a four-pixel dot is a blob.
        return here.slice(0, 6).map((who, index, shown) => {
          const turn = (index / shown.length) * Math.PI * 2 - Math.PI / 2;
          const away = dot + 4.5;
          return (
            <circle
              key={`who:${place.id}:${who.name}`}
              cx={spot.x + Math.cos(turn) * away}
              cy={spot.y + Math.sin(turn) * away}
              r={Math.max(1.6, dot * 0.45)}
              fill={NPC_COLOURS[who.kind]}
              stroke="var(--bg)"
              strokeWidth={0.75}
            >
              <title>{`${who.name} — ${place.label}`}</title>
            </circle>
          );
        });
      })}

      {/* A tick on every place whose gym has been beaten. Over the dots, and
          not clickable, so a ringed travel stop still takes the click. */}
      {places.map((place) => {
        const hall = gyms.get(place.id);
        if (!hall?.beaten) return null;
        const here = at(place.cell);
        const size = Math.max(9, dot * 2.6);
        return (
          <text
            key={`gym:${place.id}`}
            x={here.x + dot * 0.9}
            y={here.y - dot * 0.6}
            fontSize={size}
            fontWeight={700}
            fill="var(--good)"
            stroke="var(--bg)"
            strokeWidth={2}
            paintOrder="stroke"
            pointerEvents="none"
            aria-hidden="true"
          >
            ✓
          </text>
        );
      })}
    </svg>
  );
}

/**
 * The kinds of person worth naming on the map: somebody who runs something you
 * come back for. Not quest givers, gyms or the Cup, which the map and the quest
 * panel already cover; not hints; and not the nurses and Grey Line posts, which
 * stand in so many places that naming them would say nothing.
 */
const SERVICES: ReadonlySet<NpcKind> = new Set<NpcKind>([
  "buy",
  "trade",
  "print",
  "arena",
  "shred",
  "cut",
  "forge",
  "pawn",
  "auction",
  "workshop",
  "eggbuy",
  "chromabuy",
  "tutor",
  "giftswap",
  "therapy",
  "insure",
  "influence",
  "stream",
  "pageant",
  "photoshoot",
  "fightclub",
]);

/** Somebody worth naming on the map: what they are called, and what sort they are. */
interface Somebody {
  name: string;
  kind: NpcKind;
}

/** The people you have met who run something, by the route on the map they stand at (or inside). */
function peopleOnMap(world: World, state: GameState): Map<string, Somebody[]> {
  const found = new Map<string, Somebody[]>();
  // Asked of every map through `peopleOn`, so somebody who has moved into
  // Hearth is named at Hearth and no longer where you first found them.
  for (const routeId of world.routes.keys()) {
    for (const person of peopleOn(world, state, routeId)) {
      if (!SERVICES.has(person.kind) || !state.spokenTo.includes(person.id)) continue;
      const standing = world.routes.get(routeId);
      const outside = standing?.kind === "interior" ? (standing.parent ?? routeId) : routeId;
      // The six who run brackets are told apart by their format, not by
      // their names: "Odds" says nothing, "Odds (1v1)" says which of the six
      // this is and whether your party is the right size for it.
      const name = person.kind === "arena" && person.arenaId
        ? `${person.name} (${arenaSpec(person.arenaId).teamSize}v${arenaSpec(person.arenaId).teamSize})`
        : person.name;
      found.set(
        outside,
        [...(found.get(outside) ?? []), { name, kind: person.kind }].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );
    }
  }
  return found;
}

/** What the map knows about one gym. */
interface GymOnMap {
  spec: GymSpec;
  /** You have been inside its hall — or, where no hall was built, on its route. */
  visited: boolean;
  beaten: boolean;
}

/**
 * Every gym, by the route on the map it belongs to.
 *
 * Found through its leader rather than recomputed from the gym's biome: the
 * leader is wherever the world actually put them — in the hall, or out on the
 * route when no hall could be built — so the map cannot disagree with where
 * you would walk to fight.
 */
function gymsOnMap(world: World, state: GameState): Map<string, GymOnMap> {
  const found = new Map<string, GymOnMap>();
  for (const [routeId, people] of world.npcs) {
    for (const person of people) {
      if (person.kind !== "gym" || !person.gymId) continue;
      const standing = world.routes.get(routeId);
      const outside = standing?.kind === "interior" ? (standing.parent ?? routeId) : routeId;
      found.set(outside, {
        spec: gymSpec(person.gymId),
        visited: state.visited.includes(routeId),
        beaten: state.badges.includes(person.gymId),
      });
    }
  }
  return found;
}

/**
 * The hover line for a place with a gym. Nothing about which gym until you
 * have been inside: the map shows you where things are, not what they are.
 */
function gymLine(hall: GymOnMap): string {
  if (hall.beaten) return `✓ ${hall.spec.name} (${hall.spec.leader}) — defeated`;
  if (hall.visited) return `${hall.spec.name} (${hall.spec.leader}, ${hall.spec.type}) — not yet beaten`;
  return "a gym";
}
