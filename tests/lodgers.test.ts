import { describe, expect, it } from "vitest";
import {
  applyInput,
  initialState,
  inviteRefusal,
  npcAt,
  peopleOn,
  sendHomeRefusal,
  type GameState,
} from "@/engine/engine";
import { walkable } from "@/engine/terrain";
import { appearanceId } from "@/engine/variants";
import { GUEST_ROOMS, guestRooms, HUB_ID, lodgerSpot, TOWN_HEIGHT } from "@/engine/world";
import { creature, testWorld } from "./helpers";

/**
 * Hearth's terraces, and the people who can be invited to live in them.
 */

const SEED = "LODGE1";
const GUS = "egg-buyer";

describe("the terraces", () => {
  it("LG1: a daycare and ten guest rooms, every door reachable, the front row on the road", () => {
    for (const seed of [SEED, "LODGE2"]) {
      const world = testWorld(seed);
      const hub = world.routes.get(HUB_ID)!;
      const rooms = guestRooms(world);
      expect(rooms).toHaveLength(GUEST_ROOMS);
      expect(rooms.map((room) => room.label)).toEqual(Array.from({ length: GUEST_ROOMS }, (_, at) => `Terrace, No. ${at + 1}`));
      expect([...world.routes.values()].filter((route) => route.role === "daycare")).toHaveLength(1);

      // Walk the town from the way in, around everybody standing in it.
      const solid = new Set((world.npcs.get(HUB_ID) ?? []).map((who) => `${who.x},${who.y}`));
      const seen = new Set([`${hub.entry.x},${hub.entry.y}`]);
      const queue = [hub.entry];
      for (let head = 0; head < queue.length; head++) {
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const x = queue[head].x + dx;
          const y = queue[head].y + dy;
          const key = `${x},${y}`;
          if (x < 0 || y < 0 || x >= hub.width || y >= hub.height || seen.has(key) || solid.has(key)) continue;
          if (!walkable(hub.tiles[y * hub.width + x])) continue;
          seen.add(key);
          queue.push({ x, y });
        }
      }
      for (const door of hub.doors) {
        expect(seen.has(`${door.x},${door.y + 1}`), `${seed}: the step in front of ${door.to}`).toBe(true);
      }

      // The daycare's door opens straight onto the east-west road.
      const daycare = hub.doors.find((door) => world.routes.get(door.to)?.role === "daycare")!;
      expect(daycare.y + 1).toBe(Math.floor(TOWN_HEIGHT / 2) - 1);

      // And somewhere to stand in every room.
      for (const room of rooms) {
        const spot = lodgerSpot(room);
        expect(walkable(room.tiles[spot.y * room.width + spot.x]), room.id).toBe(true);
      }
    }
  });
});

describe("inviting people", () => {
  /** Talking to Gus where the world put him, with an egg to sell. */
  function atGus() {
    const world = testWorld(SEED);
    const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const [routeId, here] = [...world.npcs].find(([, people]) => people.some((one) => one.id === GUS))!;
    const him = here.find((one) => one.id === GUS)!;
    const egg = { creature: creature("togepi", { uid: 77, level: 1, variantId: appearanceId(0, null) }), steps: 500, total: 500 };
    const state: GameState = { ...start, route: routeId, x: him.x, y: him.y - 1, talking: GUS, eggs: [egg] };
    return { world, state, routeId, him };
  }

  it("LG2: only after doing business with them", () => {
    const { world, state } = atGus();
    expect(inviteRefusal(world, state)).toBe("do business with them first");
    // Talking is not business.
    expect(applyInput(world, state, { t: "endTalk" }).served).toEqual([]);

    const sold = applyInput(world, state, { t: "sellEgg", index: 0, confirm: 77 });
    expect(sold.served).toEqual([GUS]);
    expect(inviteRefusal(world, sold)).toBeNull();
  });

  it("LG3: an invited person lives in their room, and only there — and does business there — until sent home", () => {
    const { world, state, routeId, him } = atGus();
    const sold = applyInput(world, state, { t: "sellEgg", index: 0, confirm: 77 });
    const invited = applyInput(world, sold, { t: "invite" });

    const room = guestRooms(world)[0];
    expect(invited.lodgers).toEqual({ [room.id]: GUS });
    expect(invited.talking).toBeNull();
    expect(invited.notice).toEqual({ t: "invited", name: "Gus", room: "Terrace, No. 1" });

    // Gone from where he stood, and standing in the room.
    expect(peopleOn(world, invited, routeId).some((one) => one.id === GUS)).toBe(false);
    expect(npcAt(world, routeId, him.x, him.y, invited)).toBeNull();
    const spot = lodgerSpot(room);
    expect(npcAt(world, room.id, spot.x, spot.y, invited)?.id).toBe(GUS);

    // Walk into him in the room: it is a conversation, and he still buys eggs.
    const inRoom: GameState = {
      ...invited,
      route: room.id,
      x: spot.x,
      y: spot.y + 1,
      eggs: [{ creature: creature("togepi", { uid: 78, level: 1 }), steps: 500, total: 500 }],
    };
    const talking = applyInput(world, inRoom, { t: "move", dir: "n" });
    expect(talking.talking).toBe(GUS);
    const soldAgain = applyInput(world, talking, { t: "sellEgg", index: 0, confirm: 78 });
    expect(soldAgain.eggsSold).toBe(2);
    expect(inviteRefusal(world, soldAgain)).toBe("they already live in Hearth");

    // Sent home: back where he was, and the room is empty.
    expect(sendHomeRefusal(world, soldAgain)).toBeNull();
    const home = applyInput(world, soldAgain, { t: "sendHome" });
    expect(home.lodgers).toEqual({});
    expect(npcAt(world, routeId, him.x, him.y, home)?.id).toBe(GUS);
    expect(npcAt(world, room.id, spot.x, spot.y, home)).toBeNull();
  });

  it("LG4: ten rooms, and not a quest giver among them", () => {
    const { world, state } = atGus();
    const sold = applyInput(world, state, { t: "sellEgg", index: 0, confirm: 77 });
    const full = {
      ...sold,
      lodgers: Object.fromEntries(guestRooms(world).map((room, at) => [room.id, `somebody-${at}`])),
    };
    expect(inviteRefusal(world, full)).toBe(`all ${GUEST_ROOMS} guest rooms are taken`);

    const elder = { ...sold, talking: "quest-elder", served: [...sold.served, "quest-elder"] };
    expect(inviteRefusal(world, elder)).toBe("they have nowhere to be but here");
  });
});
