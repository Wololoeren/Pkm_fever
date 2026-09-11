import { describe, expect, it } from "vitest";
import { BIOME_IDS } from "@/engine/biomes";
import {
  applyInput,
  initialState,
  stations,
  travelRefusal,
  type GameState,
} from "@/engine/engine";
import { walkable } from "@/engine/terrain";
import { TOWNS } from "@/engine/towns";
import type { World } from "@/engine/world";
import { testWorld } from "./helpers";

/**
 * The Grey Line.
 *
 * One authored person standing at twenty-four posts: the nearest copy of each
 * of the twenty biomes, and each of the four towns. Talk to one, name another,
 * and you are there.
 *
 * What makes it worth guarding is that it is a *network*, and a network has
 * properties no single post has. Every destination has to have somebody
 * standing at it, or the coach is a one-way trip to nowhere. The gate has to
 * be the same one Fly uses, or two ways of going somewhere disagree about
 * where you have been. And the ride home has to always be there, because
 * "travel" that can only take you further out is a trap with a uniform.
 *
 * No new state pays for any of it. A post is open exactly when its route is in
 * `visited`, which the save already records, so the network is derived from
 * where you have walked rather than from a second list of what you have
 * unlocked — two lists being the shortest road to a coach that will not take
 * you somewhere you are standing.
 */

/** The Greycoat posted on a route. */
function post(world: World, routeId: string) {
  const who = (world.npcs.get(routeId) ?? []).find((one) => one.kind === "travel");
  if (!who) throw new Error(`no Grey Line post on ${routeId}`);
  return who;
}

/**
 * Standing beside the post on a route, mid-conversation, having been to
 * `been` as well.
 *
 * The position is set rather than walked to, which is the usual trade for a
 * fixture: walking from Hearth to the Boneyard is forty routes of real
 * encounters, and none of what is under test here depends on how you arrived.
 * `visited` is widened the same way, since the only thing that reads it is the
 * refusal.
 */
function beside(world: World, state: GameState, routeId: string, been: string[] = []) {
  const who = post(world, routeId);
  const route = world.routes.get(routeId)!;

  const spot = [
    { x: who.x - 1, y: who.y },
    { x: who.x + 1, y: who.y },
    { x: who.x, y: who.y - 1 },
    { x: who.x, y: who.y + 1 },
  ].find((at) => walkable(route.tiles[at.y * route.width + at.x]));
  if (!spot) throw new Error(`nowhere to stand beside the post on ${routeId}`);

  const stood: GameState = {
    ...state,
    route: routeId,
    x: spot.x,
    y: spot.y,
    visited: [...new Set([...state.visited, routeId, ...been])].sort(),
  };

  return applyInput(world, stood, { t: "talk", id: who.id });
}

function started(seed: string) {
  const world = testWorld(seed);
  return { world, state: applyInput(world, initialState(world), { t: "pickStarter", index: 0 }) };
}

describe("the network", () => {
  it("J1: there is a post at every kind of place, and nowhere else", () => {
    // The set of destinations *is* the set of people, read off the roster
    // rather than written down a second time. A second list would be a list
    // that disagreed the first time somebody moved a post, and the symptom
    // would be a stop you can ride to with nobody there to ride you back.
    for (const seed of ["TRAVEL1", "TRAVEL2"]) {
      const { world } = started(seed);
      const wanted = [...BIOME_IDS.map((id) => `${id}-1`), ...TOWNS.map((town) => town.id)].sort();

      expect(stations(world).sort()).toEqual(wanted);
      // Twenty biomes and four towns, and nothing has quietly become optional.
      expect(wanted.length).toBe(24);
    }
  });

  it("J2: a post stands within two steps of the tile you arrive on", () => {
    // The reason the post wishes for the route's entry while the rest of the
    // cast is deliberately tucked away: a stop you have to hunt for is a stop
    // you walk past, and stepping off one coach should leave the next one in
    // reach. Two rather than one because the entry tile itself is barred to
    // everybody — see `nearestSpot` — so the closest legal ground includes the
    // diagonals, which are two steps by the rule `talk` measures with. It was
    // measured: sixty-eight of a hundred and twenty land at one, the rest at
    // two, none further.
    for (const seed of ["TRAVEL1", "TRAVEL2"]) {
      const { world } = started(seed);
      for (const routeId of stations(world)) {
        const who = post(world, routeId);
        const route = world.routes.get(routeId)!;
        const steps = Math.abs(who.x - route.entry.x) + Math.abs(who.y - route.entry.y);
        expect(steps, `${seed}: the post on ${routeId} is ${steps} steps from the door`).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe("who will take you where", () => {
  it("J3: only somewhere you have already walked to", () => {
    const { world, state } = started("TRAVEL3");
    const [, far] = stations(world).filter((id) => id !== "hub-0");

    const cold = beside(world, state, "hub-0");
    expect(travelRefusal(world, cold, far)).toBe("you have never been there");
    expect(() => applyInput(world, cold, { t: "npcTravel", route: far })).toThrow();

    // The same rule Fly is gated on, in the same words, because it is the same
    // rule about the same thing.
    const warm = beside(world, state, "hub-0", [far]);
    expect(travelRefusal(world, warm, far)).toBeNull();
  });

  it("J4: and nowhere they do not keep somebody, however well you know it", () => {
    const { world, state } = started("TRAVEL3");
    // A second copy of a biome. Every bit as walked-to, and no post on it.
    const spare = [...world.routes.values()].find(
      (route) => route.kind === "route" && route.nth === 2,
    );
    expect(spare, "no biome has a second copy on this seed").toBeDefined();

    const talking = beside(world, state, "hub-0", [spare!.id]);
    expect(talking.visited).toContain(spare!.id);
    expect(travelRefusal(world, talking, spare!.id)).toBe("nobody of ours is standing there");
    expect(() => applyInput(world, talking, { t: "npcTravel", route: spare!.id })).toThrow();
  });

  it("J5: nobody who is not a Greycoat will take you anywhere", () => {
    const { world, state } = started("TRAVEL3");
    const somewhere = stations(world).find((id) => id !== "hub-0")!;

    // Nobody at all.
    expect(travelRefusal(world, { ...state, visited: [...state.visited, somewhere] }, somewhere)).toBe(
      "nobody is talking",
    );

    // And somebody, who does something else for a living. The nurse is the one
    // person guaranteed to be standing in a room on every seed.
    const nurse = [...world.npcs.values()].flat().find((who) => who.id === "nurse")!;
    const withNurse: GameState = {
      ...state,
      route: nurse.route,
      x: nurse.x,
      y: nurse.y + 1,
      visited: [...new Set([...state.visited, somewhere])].sort(),
      talking: nurse.id,
    };
    expect(travelRefusal(world, withNurse, somewhere)).toBe("they are not going anywhere");
  });

  it("J6: and not to the post you are leaning on", () => {
    const { world, state } = started("TRAVEL3");
    const talking = beside(world, state, "hub-0");
    expect(travelRefusal(world, talking, "hub-0")).toBe("you are already there");
  });
});

describe("the ride", () => {
  it("J7: puts you on the tile you would have walked in on, and ends the talk", () => {
    const { world, state } = started("TRAVEL4");
    const there = stations(world).find((id) => id !== "hub-0")!;
    const route = world.routes.get(there)!;

    const talking = beside(world, state, "hub-0", [there]);
    const arrived = applyInput(world, talking, { t: "npcTravel", route: there });

    expect(arrived.route).toBe(there);
    expect([arrived.x, arrived.y]).toEqual([route.entry.x, route.entry.y]);
    // Through the same landing Fly and an Escape Rope use, which is where both
    // of these come from: you are no longer in a conversation with somebody a
    // day's walk away, and the notice is the arrival rather than whatever was
    // on screen before it.
    expect(arrived.talking).toBeNull();
    expect(arrived.notice).toEqual({ t: "travelled", route: there });
    expect(arrived.tick).toBeGreaterThan(talking.tick);
  });

  it("J8: leaves the way back on offer", () => {
    // The property that makes it a network rather than a one-way door. It
    // falls out of the gate being `visited` and nothing else: you cannot get
    // anywhere without having walked there, and having walked there is exactly
    // what keeps the return leg open. Worth pinning anyway, because a future
    // gate that asked "have you talked to this one" instead would quietly
    // strand somebody at the far end of the map.
    const { world, state } = started("TRAVEL4");
    const there = stations(world).find((id) => id !== "hub-0")!;

    const arrived = applyInput(
      world,
      beside(world, state, "hub-0", [there]),
      { t: "npcTravel", route: there },
    );

    const home = beside(world, arrived, there);
    expect(travelRefusal(world, home, "hub-0")).toBeNull();

    const back = applyInput(world, home, { t: "npcTravel", route: "hub-0" });
    expect(back.route).toBe("hub-0");
  });

  it("J9: the party, the bag and the log are none of its business", () => {
    // Travel is a position and a tick. Anything else it touched would be a
    // reason not to use it.
    const { world, state } = started("TRAVEL4");
    const there = stations(world).find((id) => id !== "hub-0")!;

    const talking = beside(world, state, "hub-0", [there]);
    const arrived = applyInput(world, talking, { t: "npcTravel", route: there });

    expect(arrived.party).toEqual(talking.party);
    expect(arrived.bag).toEqual(talking.bag);
    expect(arrived.money).toBe(talking.money);
    // And it is not a way of discovering somewhere: you were already counted
    // as having been there, which is the only reason you could go.
    expect(arrived.visited).toEqual(talking.visited);
  });
});
