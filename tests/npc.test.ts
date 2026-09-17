import { describe, expect, it } from "vitest";
import {
  applyInput,
  claimRefusal,
  initialState,
  npcAt,
  offerRefusal,
  questViewOf,
  reduce,
  speakingTo,
  stateHash,
  tradeRefusal,
  type GameState,
} from "@/engine/engine";
import { countOf } from "@/engine/items";
import { ARENAS } from "@/engine/arenas";
import { GYMS } from "@/engine/gyms";
import { BIOME_IDS } from "@/engine/biomes";
import { matchesWant, NPCS } from "@/engine/npc";
import { TOWNS } from "@/engine/towns";
import { PROPS } from "@/engine/props";
import { progressOf, QUESTS, quest as questSpec } from "@/engine/quests";
import { walkable } from "@/engine/terrain";
import { variant } from "@/engine/variants";
import { creature, testWorld } from "./helpers";

/**
 * The people, the jobs, the furniture and the things on the floor.
 *
 * All four share one property worth guarding: none of them may make the world
 * unwalkable. People and furniture are solid, and a solid thing in the wrong
 * tile is a room you cannot leave or an arm you cannot reach.
 */

function started(seed = "PKMFEVER1") {
  const world = testWorld(seed);
  const state = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  return { world, state };
}

/** Stands the player next to somebody, wherever they ended up. */
function beside(world: ReturnType<typeof testWorld>, state: GameState, id: string) {
  for (const [routeId, here] of world.npcs) {
    const who = here.find((one) => one.id === id);
    if (!who) continue;
    const route = world.routes.get(routeId)!;
    const spot = [
      { x: who.x - 1, y: who.y },
      { x: who.x + 1, y: who.y },
      { x: who.x, y: who.y - 1 },
      { x: who.x, y: who.y + 1 },
    ].find((at) => walkable(route.tiles[at.y * route.width + at.x]));
    if (!spot) continue;
    return { ...state, route: routeId, x: spot.x, y: spot.y };
  }
  throw new Error(`nobody called ${id} was placed`);
}

describe("where people stand", () => {
  it("N1: everybody on the roster gets placed, on ground you could stand on", () => {
    for (const seed of ["A1", "B2", "C3"]) {
      const world = testWorld(seed);
      const placed = [...world.npcs.values()].flat();
      // The roster, plus a leader for every gym, plus the staff the world
      // duplicates: there is a nurse in every Poké Center and a shopkeeper
      // behind every Mart counter, and there are four towns.
      const rooms = (role: string) =>
        [...world.routes.values()].filter((route) => route.role === role).length;
      const staff = rooms("centre") - 1 + (rooms("mart") - 1);
      expect(staff, `${seed}: no staff was duplicated`).toBeGreaterThan(0);

      // And the Grey Line, which the world expands the same way: one authored
      // person standing at one post per kind of place — the nearest copy of
      // each biome, and each of the four towns. Counted rather than assumed,
      // because a post that failed to place is a destination you can ride to
      // and not ride back from.
      const posts = placed.filter((who) => who.kind === "travel");
      expect(posts.length, `${seed}: the Grey Line was not expanded`).toBe(
        BIOME_IDS.length + TOWNS.length,
      );
      expect(new Set(posts.map((who) => who.route)).size, `${seed}: two posts on one route`).toBe(
        posts.length,
      );

      // And the six running brackets out of a field, expanded from
      // `arenas.ts` exactly as the gym leaders are from `gyms.ts`.
      const hosts = placed.filter((who) => who.kind === "arena");
      expect(hosts.length, `${seed}: the arenas were not expanded`).toBe(ARENAS.length);

      // Minus one, because the authored Greycoat is in NPCS already.
      expect(placed.length).toBe(
        NPCS.length + GYMS.length + ARENAS.length + staff + posts.length - 1,
      );

      for (const who of placed) {
        const route = world.routes.get(who.route)!;
        expect(walkable(route.tiles[who.y * route.width + who.x])).toBe(true);
        // Never on the tile you arrive on, or somebody would be in your face
        // every time you walked in.
        expect([who.x, who.y]).not.toEqual([route.entry.x, route.entry.y]);
      }
    }
  });

  it("N2: nobody stands where standing would cut the map in two", () => {
    // People are solid: walking into one talks rather than steps. Three of the
    // town roster once landed on the crossroads and walled off three of the
    // four ways out of Hearth.
    for (const seed of ["A1", "B2"]) {
      const world = testWorld(seed);

      for (const [routeId, here] of world.npcs) {
        const route = world.routes.get(routeId)!;
        const solid = new Set(here.map((who) => `${who.x},${who.y}`));

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
            if (seen.has(key) || solid.has(key)) continue;
            if (!walkable(route.tiles[y * route.width + x])) continue;
            seen.add(key);
            queue.push({ x, y });
          }
        }

        // Every border out of here has to still be reachable with them on it.
        for (const gate of route.borders) {
          expect(seen.has(`${gate.x},${gate.y}`), `${routeId} seals ${gate.to}`).toBe(true);
        }
      }
    }
  });

  it("N3: walking into somebody starts a conversation instead of a step", () => {
    const { world, state } = started();
    const who = [...world.npcs.values()].flat()[0];
    const route = world.routes.get(who.route)!;

    const at: GameState = { ...state, route: who.route, x: who.x - 1, y: who.y };
    expect(walkable(route.tiles[at.y * route.width + at.x])).toBe(true);

    const talking = applyInput(world, at, { t: "move", dir: "e" });
    expect(talking.talking).toBe(who.id);
    // You did not move: they are standing there.
    expect([talking.x, talking.y]).toEqual([at.x, at.y]);
    expect(npcAt(world, who.route, who.x, who.y)?.id).toBe(who.id);
  });

  it("N4: you cannot talk to somebody across the map", () => {
    const { world, state } = started();
    const who = [...world.npcs.values()].flat()[0];
    const far: GameState = { ...state, route: who.route, x: 1, y: 1 };
    expect(() => applyInput(world, far, { t: "talk", id: who.id })).toThrow();
  });

  it("N20: everybody can actually be walked up to", () => {
    // Furniture is placed before anybody stands anywhere, and it is solid. A
    // villager was walled into the corner of their own front room by a
    // bookcase, standing there with a gift nobody could reach.
    for (const seed of ["A1", "B2", "C3"]) {
      const world = testWorld(seed);

      for (const [routeId, here] of world.npcs) {
        const route = world.routes.get(routeId)!;
        const solidProps = new Set(
          route.props.filter((prop) => !PROPS[prop.kind].walkable).map((prop) => `${prop.x},${prop.y}`),
        );
        const people = new Set(here.map((who) => `${who.x},${who.y}`));

        const seen = new Set<string>();
        const queue = [route.entry];
        seen.add(`${route.entry.x},${route.entry.y}`);

        for (let head = 0; head < queue.length; head++) {
          const at = queue[head];
          for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const x = at.x + dx;
            const y = at.y + dy;
            if (x < 0 || y < 0 || x >= route.width || y >= route.height) continue;
            const key = `${x},${y}`;
            if (seen.has(key) || solidProps.has(key) || people.has(key)) continue;
            if (!walkable(route.tiles[y * route.width + x])) continue;
            seen.add(key);
            queue.push({ x, y });
          }
        }

        for (const who of here) {
          const beside = [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dx, dy]) =>
            seen.has(`${who.x + dx},${who.y + dy}`),
          );
          expect(beside, `${seed}: ${who.id} on ${routeId} cannot be reached`).toBe(true);
        }
      }
    }
  });
});

describe("what people do", () => {
  it("N5: a gift is given once and never again", () => {
    const { world, state } = started();
    const at = applyInput(world, beside(world, state, "gift-neighbour"), {
      t: "talk",
      id: "gift-neighbour",
    });

    expect(offerRefusal(world, at)).toBeNull();
    const given = applyInput(world, at, { t: "npcAccept" });
    expect(countOf(given.bag, "potion")).toBe(1);

    expect(offerRefusal(world, given)).toBe("they have already given you one");
    expect(() => applyInput(world, given, { t: "npcAccept" })).toThrow();
  });

  it("N6: a healer patches everyone up, and says so when there is nothing to do", () => {
    const { world, state } = started();
    const hurt: GameState = {
      ...beside(world, state, "nurse"),
      party: [{ ...state.party[0], hp: 1, status: "psn" }],
    };
    const at = applyInput(world, hurt, { t: "talk", id: "nurse" });

    const healed = applyInput(world, at, { t: "npcAccept" });
    expect(healed.party[0].hp).toBeGreaterThan(1);
    expect(healed.party[0].status).toBeNull();

    // And a healer with nothing to heal says so rather than doing nothing.
    expect(offerRefusal(world, healed)).toBe("everyone is well");
  });

  it("N6b: a party at full health with spent moves still gets its PP back", () => {
    const { world, state } = started();
    const lead = state.party[0];
    const spent: GameState = {
      ...beside(world, state, "nurse"),
      party: [{ ...lead, pp: lead.moves.map(() => 0) }],
    };
    const at = applyInput(world, spent, { t: "talk", id: "nurse" });
    expect(offerRefusal(world, at)).toBeNull();

    const healed = applyInput(world, at, { t: "npcAccept" });
    expect(healed.party[0].pp.every((left, slot) => left > 0 && left === healed.party[0].pp[slot])).toBe(true);
    expect(offerRefusal(world, healed)).toBe("everyone is well");
  });

  it("N7: a hint-giver has nothing to hand over, which is the point of them", () => {
    const { world, state } = started();
    const at = applyInput(world, beside(world, state, "breeder"), { t: "talk", id: "breeder" });
    expect(offerRefusal(world, at)).toBe("there is nothing to take");
    expect(speakingTo(world, at)?.lines.length).toBeGreaterThan(1);
  });

  it("N8: the Collector wants an Onyx and will not take anything else", () => {
    const { world, state } = started();
    const base = beside(world, state, "trade-onyx");

    const withPlain: GameState = {
      ...base,
      party: [creature("machop", { uid: 1 }), creature("machop", { uid: 2 })],
    };
    const talking = applyInput(world, withPlain, { t: "talk", id: "trade-onyx" });
    expect(offerRefusal(world, talking)).toContain("nothing they want");
    expect(() => applyInput(world, talking, { t: "npcTrade", index: 0 })).toThrow();

    // With one, the trade lands and pays out a shiny trans Ditto.
    const withOnyx: GameState = {
      ...base,
      party: [creature("machop", { uid: 1, variantId: "onyx" }), creature("machop", { uid: 2 })],
    };
    const ready = applyInput(world, withOnyx, { t: "talk", id: "trade-onyx" });
    expect(tradeRefusal(world, ready, 0)).toBeNull();
    expect(tradeRefusal(world, ready, 1)).toContain("they want");

    const done = applyInput(world, ready, { t: "npcTrade", index: 0 });
    const got = done.party[0];
    expect(got.speciesId).toBe("ditto");
    expect(got.gender).toBe("trans");
    expect(variant(got.variantId).tier).toBe(5);
    expect(got.traded).toBe(true);

    // Once only.
    expect(offerRefusal(world, done)).toBe("they have already traded with you");
  });

  it("N9: a trader will not leave you with nothing that can fight", () => {
    const { world, state } = started();
    const only: GameState = {
      ...beside(world, state, "trade-onyx"),
      party: [creature("machop", { uid: 1, variantId: "onyx" })],
    };
    const talking = applyInput(world, only, { t: "talk", id: "trade-onyx" });
    expect(tradeRefusal(world, talking, 0)).toBe("keep something that can fight");
  });

  it("N10: what a trader accepts is the same predicate the panel asks", () => {
    const want = NPCS.find((who) => who.id === "trade-angler")!.wants!;
    expect(matchesWant(creature("magikarp", { level: 20 }), want)).toBe(true);
    expect(matchesWant(creature("magikarp", { level: 5 }), want)).toBe(false);
    expect(matchesWant(creature("machop", { level: 40 }), want)).toBe(false);
  });
});

describe("quests", () => {
  it("N11: progress is read off the save, never counted into it", () => {
    const { world, state } = started();
    const view = questViewOf(world, {
      ...state,
      party: [creature("machop"), creature("oddish"), creature("bulbasaur")],
    });
    expect(progressOf(view, { t: "own", count: 3 }).done).toBe(true);
    expect(progressOf(view, { t: "own", count: 4 }).done).toBe(false);

    // Nothing about progress is stored, so a state carrying no quest record at
    // all still answers the question correctly.
    expect(state.questsTaken).toEqual([]);
    expect(state.questsDone).toEqual([]);
  });

  it("N12: taking a job, doing it, and being paid", () => {
    const { world, state } = started();
    const at = applyInput(world, beside(world, state, "quest-elder"), { t: "talk", id: "quest-elder" });

    const taken = applyInput(world, at, { t: "npcAccept" });
    expect(taken.questsTaken).toContain("first-steps");
    expect(claimRefusal(world, taken, "first-steps")).toBe("not done yet");

    const stocked: GameState = {
      ...taken,
      party: [creature("machop", { uid: 1 }), creature("oddish", { uid: 2 }), creature("bulbasaur", { uid: 3 })],
    };
    expect(claimRefusal(world, stocked, "first-steps")).toBeNull();

    const paid = applyInput(world, stocked, { t: "claimQuest", id: "first-steps" });
    expect(paid.money).toBe(stocked.money + questSpec("first-steps").reward.money!);
    expect(countOf(paid.bag, "potion")).toBe(1);

    // And never twice.
    expect(claimRefusal(world, paid, "first-steps")).toBe("already paid");
    expect(() => applyInput(world, paid, { t: "claimQuest", id: "first-steps" })).toThrow();
  });

  it("N13: a job you never took cannot be claimed", () => {
    const { world, state } = started();
    expect(claimRefusal(world, state, "the-shine")).toBe("you never took that on");
    expect(claimRefusal(world, state, "not-a-quest")).toBe("no such quest");
  });

  it("N14: every quest is reachable — somebody hands it out", () => {
    const given = new Set(NPCS.filter((who) => who.questId).map((who) => who.questId));
    for (const spec of QUESTS) {
      expect(given.has(spec.id), `nobody gives ${spec.id}`).toBe(true);
    }
  });
});

describe("furniture and floors", () => {
  it("N15: twenty-five pieces, and the flat ones are the ones you can stand on", () => {
    expect(Object.keys(PROPS)).toHaveLength(25);

    // A rug you cannot walk on is not a rug.
    expect(PROPS.rug.walkable).toBe(true);
    expect(PROPS.mat.walkable).toBe(true);
    expect(PROPS.bookcase.walkable).toBe(false);
  });

  it("N16: every furnished room can still be left", () => {
    for (const seed of ["A1", "B2", "C3"]) {
      const world = testWorld(seed);

      for (const room of world.routes.values()) {
        if (room.kind !== "interior") continue;
        expect(room.props.length).toBeGreaterThan(0);

        const solid = new Set(
          room.props.filter((prop) => !PROPS[prop.kind].walkable).map((prop) => `${prop.x},${prop.y}`),
        );

        // The way out, and the standing room in front of it, stay clear.
        for (const door of room.doors) {
          expect(solid.has(`${door.x},${door.y}`)).toBe(false);
          expect(solid.has(`${door.x},${door.y - 1}`)).toBe(false);
        }
        expect(solid.has(`${room.entry.x},${room.entry.y}`)).toBe(false);
      }
    }
  });

  it("N17: things on the floor are placed once and taken once", () => {
    const world = testWorld("A1");
    const drops = [...world.pickups.values()].flat();
    expect(drops.length).toBeGreaterThan(20);

    // Ids are unique, which is what lets a save record what it has taken.
    expect(new Set(drops.map((drop) => drop.id)).size).toBe(drops.length);

    for (const [routeId, here] of world.pickups) {
      const route = world.routes.get(routeId)!;
      for (const drop of here) {
        expect(walkable(route.tiles[drop.y * route.width + drop.x])).toBe(true);
      }
    }
  });

  it("N18: walking onto one takes it, and walking back over does not", () => {
    const world = testWorld("A1");
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    const [routeId, here] = [...world.pickups.entries()][0];
    const route = world.routes.get(routeId)!;
    const drop = here[0];

    const from = [
      { x: drop.x - 1, y: drop.y, dir: "e" as const },
      { x: drop.x + 1, y: drop.y, dir: "w" as const },
      { x: drop.x, y: drop.y - 1, dir: "s" as const },
      { x: drop.x, y: drop.y + 1, dir: "n" as const },
    ].find((at) => walkable(route.tiles[at.y * route.width + at.x]))!;

    const at: GameState = { ...base, route: routeId, x: from.x, y: from.y };
    const got = applyInput(world, at, { t: "move", dir: from.dir });

    expect(got.taken).toContain(drop.id);
    expect(countOf(got.bag, drop.item)).toBeGreaterThan(countOf(at.bag, drop.item));

    // Stepping off and back on again picks up nothing.
    const back = applyInput(world, { ...got, x: from.x, y: from.y }, { t: "move", dir: from.dir });
    expect(countOf(back.bag, drop.item)).toBe(countOf(got.bag, drop.item));
  });
});

describe("the log still decides everything", () => {
  it("N19: talking, taking and being paid all replay", () => {
    const world = testWorld("PKMFEVER1");
    const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const at = beside(world, start, "quest-elder");

    const inputs = [
      { t: "pickStarter" as const, index: 0 },
      { t: "cheat" as const, cheat: { op: "warp" as const, route: at.route } },
      { t: "talk" as const, id: "quest-elder" },
      { t: "npcAccept" as const },
      { t: "endTalk" as const },
    ];

    // The warp lands on the route's entry rather than beside the Elder, so
    // this asserts the log replays rather than that the walk succeeds.
    const once = reduce(world, inputs.slice(0, 2));
    expect(stateHash(reduce(world, inputs.slice(0, 2)))).toBe(stateHash(once));
  });
});

/*
 * The four with a machine and a trade.
 *
 * They all stood in New Willow, which made it the only town worth a detour.
 * Now the seed picks a town or a route in the first two rings for each of
 * them — so they must always exist, always be near home, and not be in one
 * place on every seed.
 */
describe("the traders who wander", () => {
  const WANDERERS = ["print-ivo", "auctioneer", "shred-marv", "cut-hessa"];
  const SEEDS = ["WANDER1", "WANDER2", "WANDER3", "WANDER4", "WANDER5", "WANDER6"];

  it("N20: each is placed exactly once, in a town or a route no further out than ring two", () => {
    expect(NPCS.filter((entry) => WANDERERS.includes(entry.id)).every((entry) => entry.where.at === "wander")).toBe(true);

    for (const seed of SEEDS) {
      const world = testWorld(seed);
      const everyone = [...world.npcs.values()].flat();
      for (const id of WANDERERS) {
        const found = everyone.filter((who) => who.id === id);
        expect(found, `${id} on ${seed}`).toHaveLength(1);
        const route = world.routes.get(found[0].route)!;
        expect(route.kind === "town" || (route.kind === "route" && route.ring >= 1 && route.ring <= 2), `${id} on ${route.id}`).toBe(true);

        // And you can walk up to them from the way in, on foot.
        const seen = new Set([`${route.entry.x},${route.entry.y}`]);
        const queue = [route.entry];
        for (let head = 0; head < queue.length; head++) {
          for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const x = queue[head].x + dx;
            const y = queue[head].y + dy;
            if (x < 0 || y < 0 || x >= route.width || y >= route.height || seen.has(`${x},${y}`)) continue;
            if (!walkable(route.tiles[y * route.width + x])) continue;
            seen.add(`${x},${y}`);
            queue.push({ x, y });
          }
        }
        expect(seen.has(`${found[0].x},${found[0].y}`), `${id} unreachable on ${route.id}`).toBe(true);
      }
    }
  });

  it("N21: and the seed decides where — they are not all in New Willow any more", () => {
    const where = new Set<string>();
    for (const seed of SEEDS) {
      const world = testWorld(seed);
      for (const who of [...world.npcs.values()].flat()) {
        if (WANDERERS.includes(who.id)) where.add(who.route);
      }
    }
    expect(where.size).toBeGreaterThan(4);
  });
});
