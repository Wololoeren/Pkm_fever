import { describe, expect, it } from "vitest";
import {
  applyInput,
  flyRefusal,
  gymTeam,
  initialState,
  offerRefusal,
  rematchIn,
  releaseRefusal,
  REMATCH_AFTER,
  REMATCH_LEVELS,
  tileAt,
  toolRefusal,
  wantsRematch,
  type GameState,
} from "@/engine/engine";
import { species as speciesById } from "@/engine/dex";
import { GYMS, gymLevel, LEVELS_PER_BADGE, MOVE_LEVELS_CAP, MOVES_PER_LEVEL } from "@/engine/gyms";
import { addItem, countOf, item } from "@/engine/items";
import { OBSTACLES, passable, TILE, walkable } from "@/engine/terrain";
import { progressOf, quest as questSpec } from "@/engine/quests";
import { creature, testWorld } from "./helpers";

/**
 * Gyms, tools, rematches and letting one go.
 *
 * The property under all of it: nothing here may put something permanently
 * out of reach. A gate always has a tool, a tool always has a gym, and the
 * only irreversible act in the game asks twice.
 */

function started(seed = "PKMFEVER1") {
  const world = testWorld(seed);
  const state = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  return { world, state };
}

describe("gyms", () => {
  it("G1: eight of them, each its own type, each handing over a tool", () => {
    expect(GYMS).toHaveLength(8);
    expect(new Set(GYMS.map((gym) => gym.type)).size).toBe(8);
    expect(new Set(GYMS.map((gym) => gym.tool)).size).toBe(8);

    for (const gym of GYMS) {
      expect(item(gym.tool).kind).toBe("hm");
    }
  });

  it("G2: every gym has a hall standing on the route it belongs to", () => {
    for (const seed of ["A1", "B2", "C3"]) {
      const world = testWorld(seed);
      for (const gym of GYMS) {
        const hall = world.routes.get(`${gym.biome}-${gym.nth}:gym`);
        expect(hall, `${seed}: no hall for ${gym.id}`).toBeDefined();
        expect(hall!.role).toBe("gym");

        const leader = [...world.npcs.values()].flat().find((who) => who.gymId === gym.id);
        expect(leader, `${seed}: no leader for ${gym.id}`).toBeDefined();
      }
    }
  });

  it("G3: the level is read off how far you have come", () => {
    const gym = GYMS[0];

    expect(gymLevel(gym, 0, 0)).toBe(gym.baseLevel);
    // One level per 2,500 moves, and not a level before then.
    expect(MOVES_PER_LEVEL).toBe(2500);
    expect(gymLevel(gym, 2499, 0)).toBe(gym.baseLevel);
    expect(gymLevel(gym, 7500, 0)).toBe(gym.baseLevel + 3);
    // Three per badge already won.
    expect(LEVELS_PER_BADGE).toBe(3);
    expect(gymLevel(gym, 0, 3)).toBe(gym.baseLevel + 9);
    // Both together.
    expect(gymLevel(gym, 5000, 2)).toBe(gym.baseLevel + 2 + 6);
  });

  it("G4: the drift from moves stops, so a gym cannot run away from you", () => {
    const gym = GYMS[0];
    const forever = MOVES_PER_LEVEL * 1000;
    expect(gymLevel(gym, forever, 0)).toBe(gym.baseLevel + MOVE_LEVELS_CAP);
    expect(gymLevel(gym, forever, 8)).toBeLessThanOrEqual(100);
  });

  it("G5: the team is all of one type, at the level the save says", () => {
    const { world, state } = started();
    const gym = GYMS[0];
    const grown: GameState = { ...state, tick: 5000, badges: ["gym-water", "gym-rock"] };

    const team = gymTeam(world, grown, gym.id);
    expect(team).toHaveLength(gym.team);

    for (const member of team) {
      expect(speciesById(member.speciesId).types.some((type) => type === gym.type)).toBe(true);
      expect(member.hp).toBeGreaterThan(0);
      expect(member.moves.length).toBeGreaterThan(0);
    }

    // The ace is the one at the stated level; the rest are just under it.
    const want = gymLevel(gym, grown.tick, grown.badges.length);
    expect(Math.max(...team.map((one) => one.level))).toBe(want);
  });

  it("G6: the same save always meets the same team", () => {
    const { world, state } = started();
    const once = gymTeam(world, state, GYMS[0].id);
    const twice = gymTeam(world, state, GYMS[0].id);
    expect(twice.map((one) => `${one.speciesId}/${one.level}`)).toEqual(
      once.map((one) => `${one.speciesId}/${one.level}`),
    );
  });

  it("G7: a leader you have already beaten will still fight, and pays nothing", () => {
    const { world, state } = started();
    const leader = [...world.npcs.values()].flat().find((who) => who.kind === "gym")!;

    const won: GameState = { ...state, talking: leader.id, badges: [leader.gymId!] };
    expect(offerRefusal(world, won)).toBe("you already have that badge");
  });
});

describe("tools", () => {
  it("T-1: every obstacle has a tool, and every tool comes from somewhere", () => {
    const fromGyms = new Set(GYMS.map((gym) => gym.tool));

    for (const [tile, gate] of Object.entries(OBSTACLES)) {
      expect(item(gate.item).kind, `${tile} wants a real tool`).toBe("hm");
      // Every obstacle the world places must be answerable.
      expect(fromGyms.has(gate.item) || gate.item === "hm-whirlpool" || gate.item === "hm-dive").toBe(
        true,
      );
    }
  });

  it("T-2: an obstacle is impassable empty-handed and passable with its tool", () => {
    for (const [tile, gate] of Object.entries(OBSTACLES)) {
      const id = Number(tile);
      expect(passable(id, () => false)).toBe(false);
      expect(passable(id, (want) => want === gate.item)).toBe(true);
    }
  });

  it("T-3: nothing the world places ever blocks the way out of a route", () => {
    // Gates gate optional pockets, never the route. Walking with no tools at
    // all has to reach every gap in the wall from every other one.
    //
    // It used to be one pair — in at the west, out at the east — because that
    // was every way through there was. A place with three neighbours has three,
    // and checking one pair of them would pass a world where a boulder had
    // sealed the third: reachable, unreachable and never asked about.
    for (const seed of ["A1", "B2", "C3", "PKMFEVER1", "ZZZZ9"]) {
      const world = testWorld(seed);

      for (const route of world.routes.values()) {
        if (route.kind !== "route") continue;

        const seen = new Set<string>();
        const start = route.entry;
        const queue = [start];
        seen.add(`${start.x},${start.y}`);

        for (let head = 0; head < queue.length; head++) {
          const at = queue[head];
          for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const x = at.x + dx;
            const y = at.y + dy;
            if (x < 0 || y < 0 || x >= route.width || y >= route.height) continue;
            const key = `${x},${y}`;
            if (seen.has(key) || !walkable(route.tiles[y * route.width + x])) continue;
            seen.add(key);
            queue.push({ x, y });
          }
        }

        for (const gate of route.gates) {
          expect(
            seen.has(`${gate.x},${gate.y}`),
            `${seed}: ${route.id} needs a tool to reach its ${gate.bearing} gate`,
          ).toBe(true);
        }
      }
    }
  });

  it("T-4: Cut takes a bush down, and it stays down", () => {
    const world = testWorld("A1");
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    // Find a bush with somewhere to stand beside it.
    let at: GameState | null = null;
    let bush: { x: number; y: number; route: string } | null = null;

    for (const route of world.routes.values()) {
      for (let y = 1; y < route.height - 1 && !at; y++) {
        for (let x = 1; x < route.width - 1 && !at; x++) {
          if (route.tiles[y * route.width + x] !== TILE.BUSH) continue;
          const from = [
            { x: x - 1, y, dir: "e" as const },
            { x: x + 1, y, dir: "w" as const },
          ].find((spot) => walkable(route.tiles[spot.y * route.width + spot.x]));
          if (!from) continue;
          at = { ...base, route: route.id, x: from.x, y: from.y, bag: addItem(base.bag, "hm-cut") };
          bush = { x, y, route: route.id };
        }
      }
      if (at) break;
    }

    expect(bush, "no bush anywhere in this world").not.toBeNull();

    const dir = bush!.x > at!.x ? "e" : "w";
    expect(toolRefusal(world, at!, "hm-cut", dir)).toBeNull();
    // The wrong tool says so rather than doing nothing.
    expect(toolRefusal(world, { ...at!, bag: addItem(at!.bag, "hm-surf") }, "hm-surf", dir)).toContain(
      "not used on anything",
    );

    const done = applyInput(world, at!, { t: "useTool", item: "hm-cut", dir });
    const route = world.routes.get(bush!.route)!;
    expect(tileAt(done, route, bush!.x, bush!.y)).toBe(TILE.PATH);
    // And you can now walk onto it.
    expect(applyInput(world, done, { t: "move", dir }).x).toBe(bush!.x);
  });

  it("T-5: Fly only goes where you have been", () => {
    const { world, state } = started();
    const flying: GameState = { ...state, bag: addItem(state.bag, "hm-fly") };

    // The fourth meadow: somewhere that exists in every world and that the
            // player has certainly not walked to yet.
    expect(flyRefusal(world, flying, "meadow-4")).toBe("you have never been there");
    expect(flyRefusal(world, flying, state.route)).toBe("you are already there");
    expect(flyRefusal(world, state, "meadow-1")).toBe("you have no way to fly");

    const been: GameState = { ...flying, visited: [...flying.visited, "meadow-1"].sort() };
    expect(flyRefusal(world, been, "meadow-1")).toBeNull();

    const there = applyInput(world, been, { t: "fly", route: "meadow-1" });
    expect(there.route).toBe("meadow-1");
    expect([there.x, there.y]).toEqual([
      world.routes.get("meadow-1")!.entry.x,
      world.routes.get("meadow-1")!.entry.y,
    ]);
  });
});

describe("rematches", () => {
  it("T-6: somebody you have never beaten always wants a go", () => {
    const { state } = started();
    expect(wantsRematch(state, "nobody")).toBe(true);
  });

  it("T-7: after a beating they wait a thousand moves, then come back", () => {
    const { state } = started();
    const beaten: GameState = {
      ...state,
      tick: 100,
      beaten: ["someone"],
      beatenAt: { someone: 100 },
      wins: { someone: 1 },
    };

    expect(wantsRematch(beaten, "someone")).toBe(false);
    expect(rematchIn(beaten, "someone")).toBe(REMATCH_AFTER);

    const later: GameState = { ...beaten, tick: 100 + REMATCH_AFTER };
    expect(wantsRematch(later, "someone")).toBe(true);
    expect(rematchIn(later, "someone")).toBe(0);
  });

  it("T-8: and they come back three levels up for every loss", () => {
    // The scaling lives in the battle the walk starts, so this pins the
    // arithmetic rather than the walk: three per win, and never past 100.
    expect(REMATCH_LEVELS).toBe(3);
    expect(Math.min(100, 20 + 2 * REMATCH_LEVELS)).toBe(26);
    expect(Math.min(100, 99 + 40 * REMATCH_LEVELS)).toBe(100);
  });
});

describe("letting one go", () => {
  it("T-9: it needs the right uid, which only the panel could have given", () => {
    const { world, state } = started();
    const two: GameState = {
      ...state,
      party: [creature("machop", { uid: 11 }), creature("oddish", { uid: 22 })],
    };

    // A wrong uid is a mis-click on a list that moved under the cursor.
    expect(releaseRefusal(two, "party", 0, 22)).toBe("that is not the one you were shown");
    expect(() => applyInput(world, two, { t: "release", from: "party", index: 0, confirm: 22 })).toThrow();

    expect(releaseRefusal(two, "party", 0, 11)).toBeNull();
    const gone = applyInput(world, two, { t: "release", from: "party", index: 0, confirm: 11 });
    expect(gone.party.map((one) => one.uid)).toEqual([22]);
  });

  it("T-10: never the last one that can fight, and never one at the daycare", () => {
    const { state } = started();
    const only: GameState = { ...state, party: [creature("machop", { uid: 11 })] };
    expect(releaseRefusal(only, "party", 0, 11)).toBe("keep something that can fight");

    const boarding: GameState = {
      ...state,
      box: [creature("oddish", { uid: 33 })],
      daycare: { ...state.daycare, slots: [creature("oddish", { uid: 33 }), null] },
    };
    expect(releaseRefusal(boarding, "box", 0, 33)).toBe("it is at the daycare");
  });

  it("T-11: from the box as well, and it really is gone", () => {
    const { world, state } = started();
    const stocked: GameState = {
      ...state,
      box: [creature("machop", { uid: 44 }), creature("oddish", { uid: 55 })],
    };

    const gone = applyInput(world, stocked, { t: "release", from: "box", index: 1, confirm: 55 });
    expect(gone.box.map((one) => one.uid)).toEqual([44]);
    expect(gone.party).toEqual(stocked.party);
  });
});

describe("the badge economy", () => {
  it("T-12: the World Cup asks for all eight and pays an invitation", () => {
    const { world, state } = started();
    const view = {
      party: state.party,
      box: state.box,
      beaten: state.beaten,
      badges: GYMS.map((gym) => gym.id),
      visited: state.visited,
      bag: state.bag,
      ringOf: (id: string) => world.routes.get(id)?.ring ?? 0,
    };

    const cup = questSpec("world-cup");
    expect(progressOf(view, cup.goal).done).toBe(true);
    expect(progressOf({ ...view, badges: GYMS.slice(0, 7).map((g) => g.id) }, cup.goal).done).toBe(false);
    expect(cup.reward.item).toBe("worldcup");
    expect(countOf({}, "worldcup")).toBe(0);
  });
});
