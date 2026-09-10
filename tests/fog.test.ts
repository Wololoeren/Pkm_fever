import { describe, expect, it } from "vitest";
import {
  applyInput,
  FOG,
  hasSeen,
  initialState,
  reduce,
  sightCorner,
  SIGHT_TILES_X,
  SIGHT_TILES_Y,
  stateHash,
  type GameState,
  type Input,
} from "@/engine/engine";
import { walkable } from "@/engine/terrain";
import { HUB_ID, type Route } from "@/engine/world";
import { creature, outdoorRoutes, play, testWorld } from "./helpers";

/**
 * The small map is a memory, not a satellite.
 *
 * It used to draw the whole route the moment you stepped onto it, which meant
 * arriving somewhere new and already knowing the way through. What you have
 * looked at is now folded in the engine, because it has to survive a save and
 * a save is a log of inputs — so anything that survives one has to be a fold
 * over them.
 *
 * These pin the three things that makes it worth having: it starts closed, it
 * opens where you go and only there, and it replays.
 */

/** How much of a route is on the map, as a share of its blocks. */
function share(state: GameState, route: Route): number {
  let seen = 0;
  let all = 0;
  for (let y = 0; y < route.height; y += FOG) {
    for (let x = 0; x < route.width; x += FOG) {
      all++;
      if (hasSeen(state, route, x, y)) seen++;
    }
  }
  return seen / all;
}


/**
 * Stands the player on a walkable tile near the middle of a route.
 *
 * Not an input the game offers — these tests are about what one *position*
 * reveals, and the middle is the only spot where the sight window is not
 * clamped by an edge. The middle tile itself is usually a wall, which is what
 * a maze is, so the nearest open one will do.
 */
function standingMidway(world: ReturnType<typeof testWorld>, route: Route, from: GameState): GameState {
  const mid = { x: Math.floor(route.width / 2), y: Math.floor(route.height / 2) };
  for (let radius = 0; radius < 20; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = mid.x + dx;
        const y = mid.y + dy;
        if (x < 1 || y < 1 || x >= route.width - 1 || y >= route.height - 1) continue;
        if (!walkable(route.tiles[y * route.width + x])) continue;

        // And it has to be able to take a step, or there is no input to apply.
        const at: GameState = { ...from, route: route.id, x, y };
        for (const dir of ["n", "s", "e", "w"] as const) {
          try {
            return applyInput(world, at, { t: "move", dir });
          } catch {
            /* walled that way */
          }
        }
      }
    }
  }
  throw new Error(`nowhere to stand on ${route.id}`);
}

describe("what you have seen", () => {
  it("F1: a route you have never been to is not on the map at all", () => {
    const world = testWorld("A1");
    const state = initialState(world);

    for (const route of outdoorRoutes(world)) {
      expect(share(state, route), route.id).toBe(0);
      expect(hasSeen(state, route, route.entry.x, route.entry.y), route.id).toBe(false);
    }
  });

  it("F2: the town you wake up in is, because you can see it", () => {
    // The one reveal with no input behind it, which is why `initialState` has
    // to do it as well as `applyInput`.
    const world = testWorld("A1");
    const state = initialState(world);
    const town = world.routes.get(HUB_ID)!;

    expect(hasSeen(state, town, state.x, state.y)).toBe(true);
    // Not the whole of it: Hearth is 40x28 and one look is 23x17, so standing
    // in the square shows you the square and not the corners.
    expect(share(state, town)).toBeGreaterThan(0.35);
    expect(share(state, town)).toBeLessThan(1);
  });

  it("F3: standing somewhere reveals what the camera shows and nothing else", () => {
    const world = testWorld("A1");
    const state = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const route = outdoorRoutes(world).find((one) => one.width > SIGHT_TILES_X)!;

    const there = standingMidway(world, route, state);

    const corner = sightCorner(route, there.x, there.y);
    for (let y = 0; y < route.height; y++) {
      for (let x = 0; x < route.width; x++) {
        const onScreen =
          x >= corner.x &&
          y >= corner.y &&
          x < corner.x + Math.min(SIGHT_TILES_X, route.width) &&
          y < corner.y + Math.min(SIGHT_TILES_Y, route.height);
        // A block counts as seen if any of its tiles was on screen, so only
        // tiles well outside the window are certainly unseen.
        if (onScreen) expect(hasSeen(there, route, x, y), `${x},${y} was on screen`).toBe(true);
      }
    }

    // And nearly all of the route is still dark: one look is not a map.
    // A 23x17 window over an 88x68 route is about a twelfth of it, so mapping
    // a place takes a dozen good vantage points and a walk between them.
    expect(share(there, route)).toBeGreaterThan(0.04);
    expect(share(there, route)).toBeLessThan(0.2);
  });

  it("F4: walking opens more of it, and never closes any", () => {
    const world = testWorld("A1");
    let state = initialState(world);
    state = applyInput(world, state, { t: "pickStarter", index: 0 });

    const town = world.routes.get(HUB_ID)!;
    const before = share(state, town);
    const opened = new Set<string>();

    // Every block on the map stays on the map, whatever happens next.
    const remember = (at: GameState) => {
      for (const route of [...world.routes.values()]) {
        if (route.kind !== "route" && route.kind !== "town") continue;
        for (let y = 0; y < route.height; y += FOG) {
          for (let x = 0; x < route.width; x += FOG) {
            if (hasSeen(at, route, x, y)) opened.add(`${route.id}:${x},${y}`);
          }
        }
      }
    };
    remember(state);

    const { state: after } = play(world, 400);
    for (const key of opened) {
      const [id, spot] = key.split(":");
      const [x, y] = spot.split(",").map(Number);
      expect(hasSeen(after, world.routes.get(id)!, x, y), `${key} was forgotten`).toBe(true);
    }

    // And it grew: four hundred inputs go somewhere.
    const grown = [...world.routes.values()]
      .filter((route) => route.kind === "route")
      .reduce((total, route) => total + share(after, route), 0);
    expect(grown, "four hundred inputs revealed nothing").toBeGreaterThan(0);
    expect(share(after, town)).toBeGreaterThanOrEqual(before);
  });

  it("F5: it replays, which is the whole reason it is state", () => {
    const world = testWorld("B2");
    const { inputs, state } = play(world, 300);
    const again = reduce(world, inputs as Input[]);

    expect(stateHash(again)).toBe(stateHash(state));
    for (const route of outdoorRoutes(world)) {
      expect(state.seen[route.id] ?? "", route.id).toBe(again.seen[route.id] ?? "");
    }
  });

  it("F6: in the dark you map a route a handful of tiles at a time", () => {
    // Flash is worth having twice over: it lights the route, and it is the
    // difference between mapping a place in one walk and mapping it in ten.
    const world = testWorld("A1");
    const state = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    const deep = outdoorRoutes(world)
      .filter((route) => route.ring >= 5)
      .sort((a, b) => b.ring - a.ring)[0];
    expect(deep, "no dark route in this world").toBeTruthy();

    const dark = standingMidway(world, deep, state);

    // Two blocks across at most, against the eight or so a lit look gives.
    expect(share(dark, deep), `${deep.id} in the dark`).toBeLessThan(0.05);
    expect(share(dark, deep), `${deep.id} in the dark`).toBeGreaterThan(0);

    // And with Flash in the bag, the same spot shows the whole window.
    const lit = standingMidway(world, deep, { ...state, bag: { ...state.bag, "hm-flash": 1 } });
    expect(share(lit, deep)).toBeGreaterThan(share(dark, deep) * 3);
  });
});

describe("where you wake up", () => {
  /**
   * Loses a fight properly, rather than reaching in and setting the party to
   * nought.
   *
   * A blackout is only reachable through a battle that ends with nothing
   * standing, so the fixture walks into somebody with a level one Magikarp
   * that knows Splash. It cannot win, it runs out of Splash, it Struggles
   * itself to death, and the engine does the rest — which means this exercises
   * the real path and not a shortcut past it.
   */
  function beatenSomewhere(
    world: ReturnType<typeof testWorld>,
    state: GameState,
  ): GameState {
    const [routeId, here] =
      [...world.trainers].find(([, group]) => group.length > 0) ?? [];
    if (!routeId || !here) throw new Error("nobody to lose to");
    const rival = here[0];

    let live: GameState = {
      ...state,
      route: routeId,
      x: rival.x - 1,
      y: rival.y,
      party: [creature("magikarp", { uid: 1, level: 1, moves: ["splash"] })],
    };

    live = applyInput(world, live, { t: "move", dir: "e" });
    for (let turn = 0; turn < 300 && live.phase === "battle"; turn++) {
      for (const input of [
        { t: "fight", moveIndex: 0 } as const,
        { t: "struggle" } as const,
      ]) {
        try {
          live = applyInput(world, live, input);
          break;
        } catch {
          /* nothing left of that sort */
        }
      }
    }
    return live;
  }

  it("W1: before you have been in a Center, it is still Hearth", () => {
    const world = testWorld("A1");
    const state = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    expect(state.centre, "you start in the square, not in the building").toBeNull();

    const woke = beatenSomewhere(world, state);
    expect(woke.notice?.t, "the fixture did not actually lose").toBe("whiteout");
    expect(woke.route).toBe(HUB_ID);
    expect(woke.notice).toMatchObject({ t: "whiteout", at: HUB_ID });
  });

  it("W2: walking into one is what makes it the one you wake in", () => {
    // Walking in, not healing. A Center you have stood in is a Center you know
    // the way to, and that is the promise the message makes.
    const world = testWorld("A1");
    let state = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    const centres = [...world.routes.values()].filter((route) => route.role === "centre");
    expect(centres.length, "a world with one Center proves nothing").toBeGreaterThan(1);

    // The one that is *not* Hearth's, so the fallback cannot pass this by
    // accident.
    const far = centres.find((room) => room.parent !== HUB_ID)!;
    state = { ...state, route: far.id, x: far.entry.x, y: far.entry.y };
    state = applyInput(world, state, { t: "move", dir: "n" });

    expect(state.centre).toBe(far.id);

    const woke = beatenSomewhere(world, state);
    expect(woke.notice?.t, "the fixture did not actually lose").toBe("whiteout");
    expect(woke.route).toBe(far.id);
    expect(woke.notice).toMatchObject({ t: "whiteout", at: far.parent });
    // And put right, which is the other half of the bargain.
    expect(woke.party.every((one) => one.hp > 0)).toBe(true);
  });

  it("W3: the newest one wins, and it survives a replay", () => {
    const world = testWorld("B2");
    let state = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    const centres = [...world.routes.values()].filter((route) => route.role === "centre");
    const [first, second] = centres.filter((room) => room.parent !== HUB_ID);
    expect(second, "not enough towns to tell one Center from another").toBeTruthy();

    const step = (room: (typeof centres)[number]) => {
      state = { ...state, route: room.id, x: room.entry.x, y: room.entry.y };
      state = applyInput(world, state, { t: "move", dir: "n" });
    };

    step(first);
    expect(state.centre).toBe(first.id);
    step(second);
    expect(state.centre, "the older one is still remembered").toBe(second.id);

    // It is in the hash, because it changes what a later input does.
    expect(stateHash({ ...state, centre: first.id })).not.toBe(stateHash(state));
  });
});
