import { describe, expect, it } from "vitest";
import { BIOMES, copiesOf, placesWanted } from "@/engine/biomes";
import { species as speciesById, TYPE_NAMES } from "@/engine/dex";
import { NPCS } from "@/engine/npc";
import { QUESTS } from "@/engine/quests";
import { variant } from "@/engine/variants";
import { routeId } from "@/engine/world";
import {
  applyInput,
  initialState,
  offerRefusal,
  tradeRefusal,
  type GameState,
} from "@/engine/engine";
import { ALL_SPECIES } from "@/engine/dex";
import { walkable } from "@/engine/terrain";
import { creature, outdoorRoutes, testWorld } from "./helpers";

/** Standing next to somebody, on whichever route they turned out to be on. */
function beside(world: ReturnType<typeof testWorld>, state: GameState, id: string): GameState {
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

/**
 * The survey: somebody to talk to on every route, and enough people to fight.
 *
 * A route is 88x68 with a real maze through it and about eighty steps from one
 * side to the other. One or two trainers and nobody to talk to makes that a
 * corridor with encounters in it rather than somewhere anybody lives — so there
 * are four to seven people who will fight you, and exactly one who will trade
 * with you or hand you a job, on every one of the fifty.
 *
 * The fifty are an expedition: officers by department, a diplomat or two, and
 * the merchants who followed the fleet because merchants always do. What these
 * guard is not the jokes — it is that the *coverage* is real, because "there is
 * somebody on every route" stops being a reason to walk down one the moment it
 * is only true of most of them.
 */

/** Everyone the survey put out there, wherever they are. */
const SURVEY = NPCS.filter((who) => who.id.startsWith("trek-"));

describe("the survey", () => {
  it("S1: there is one of them on every route, and never two", () => {
    // The addresses have to cover the fifty exactly once, and that is the sort
    // of thing which is obviously true right up until somebody adds a biome
    // and quietly leaves four routes with nobody on them.
    expect(SURVEY.length).toBe(placesWanted());

    const wanted = new Set<string>();
    for (const spec of BIOMES) {
      for (let nth = 1; nth <= copiesOf(spec.tier); nth++) wanted.add(`${spec.id}:${nth}`);
    }
    expect(wanted.size).toBe(placesWanted());

    const covered = new Set<string>();
    for (const who of SURVEY) {
      expect(who.where.at, `${who.id} is not on a route`).toBe("route");
      if (who.where.at !== "route") continue;

      const key = `${who.where.biome}:${who.where.nth}`;
      expect(covered.has(key), `two of them on ${key}`).toBe(false);
      expect(wanted.has(key), `${who.id} is on ${key}, which is not a route`).toBe(true);
      covered.add(key);
    }

    expect([...wanted].filter((key) => !covered.has(key))).toEqual([]);
  });

  it("S2: every one of them trades or hands out a job", () => {
    // A hint-giver on every route would be fifty people saying words. The ask
    // was somebody you can *do something with*.
    for (const who of SURVEY) {
      expect(["trade", "quest"], `${who.id} is a ${who.kind}`).toContain(who.kind);

      if (who.kind === "trade") {
        expect(who.wants, `${who.id} wants nothing`).toBeTruthy();
        expect(who.gives, `${who.id} gives nothing`).toBeTruthy();
      } else {
        expect(who.questId, `${who.id} hands out no job`).toBeTruthy();
        expect(
          QUESTS.some((quest) => quest.id === who.questId),
          `${who.id} hands out ${who.questId}, which does not exist`,
        ).toBe(true);
      }
    }

    // Both kinds are represented, or "trade or quest" is one thing wearing two
    // names.
    const kinds = new Set(SURVEY.map((who) => who.kind));
    expect(kinds.has("trade")).toBe(true);
    expect(kinds.has("quest")).toBe(true);
  });

  it("S3: what they ask for can be brought, and what they give is real", () => {
    for (const who of SURVEY) {
      if (who.kind !== "trade") continue;

      const want = who.wants!;
      expect(want.type, `${who.id} wants no particular type`).toBeTruthy();
      expect(TYPE_NAMES, `${who.id} wants a ${want.type}`).toContain(want.type!);
      // A trade nobody can meet is a person standing in a field refusing you.
      expect(want.minLevel ?? 0, `${who.id} asks too much`).toBeLessThanOrEqual(40);

      const gives = who.gives!;
      expect(() => speciesById(gives.speciesId), `${who.id} gives a nonexistent creature`).not.toThrow();
      expect(() => variant(gives.variantId), `${who.id} gives a nonexistent appearance`).not.toThrow();
      // And what comes back is worth roughly what went out, or a trade is
      // either a gift or a robbery.
      expect(gives.level, `${who.id}`).toBeGreaterThanOrEqual((want.minLevel ?? 0) - 2);
      expect(gives.level, `${who.id}`).toBeLessThanOrEqual((want.minLevel ?? 0) + 8);
    }
  });

  it("S4: they turn up in a world, on the route they were written for", () => {
    for (const seed of ["A1", "B2", "C3"]) {
      const world = testWorld(seed);

      for (const who of SURVEY) {
        if (who.where.at !== "route") continue;
        const home = routeId(who.where.biome, who.where.nth);

        const where = [...world.npcs].find(([, here]) => here.some((one) => one.id === who.id))?.[0];
        expect(where, `${seed}: ${who.id} was never placed`).toBeTruthy();

        // Indoors counts: a cabin on the route is on the route.
        const route = world.routes.get(where!)!;
        const outer = route.kind === "interior" ? (route.parent ?? where!) : where!;
        expect(outer, `${seed}: ${who.id}`).toBe(home);
      }
    }
  });

  it("S5: every route has somebody to talk to and enough people to fight", () => {
    for (const seed of ["A1", "B2", "C3"]) {
      const world = testWorld(seed);

      for (const route of outdoorRoutes(world)) {
        const here = world.npcs.get(route.id) ?? [];
        const useful = here.filter((who) => who.kind === "trade" || who.kind === "quest");
        expect(useful.length, `${seed}: nothing to do on ${route.id}`).toBeGreaterThanOrEqual(1);

        // Four is the floor, and the floor is the number that matters: it used
        // to be one, on a map four times the size it was written for.
        const fighters = world.trainers.get(route.id) ?? [];
        expect(fighters.length, `${seed}: ${route.id} is empty`).toBeGreaterThanOrEqual(4);
        expect(fighters.length, `${seed}: ${route.id} is a queue`).toBeLessThanOrEqual(8);
      }

      // And no two people are standing on the same tile anywhere.
      for (const route of outdoorRoutes(world)) {
        const taken = [
          ...(world.npcs.get(route.id) ?? []).map((who) => `${who.x},${who.y}`),
          ...(world.trainers.get(route.id) ?? []).map((who) => `${who.x},${who.y}`),
        ];
        expect(new Set(taken).size, `${seed}: two people share a tile on ${route.id}`).toBe(
          taken.length,
        );
      }
    }
  });

  it("S6: every one of the trades actually goes through", () => {
    // Forty-four new traders is a lot of `wants` and `gives` riding on data
    // nobody has typed twice. This walks up to each of them with exactly what
    // they asked for and checks the swap lands — and, first, that turning up
    // with the wrong thing is refused, because a trader who takes anything is
    // not a trader.
    const world = testWorld("A1");
    const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    for (const who of SURVEY) {
      if (who.kind !== "trade") continue;
      const want = who.wants!;

      const standing = beside(world, start, who.id);

      // Something they do not want: a low-level Normal one, unless that is
      // exactly what they asked for.
      const dull = want.type === "normal" ? "geodude" : "rattata";
      const wrong: GameState = {
        ...standing,
        party: [creature(dull, { uid: 1, level: 5 }), creature("machop", { uid: 2, level: 30 })],
      };
      const refused = applyInput(world, wrong, { t: "talk", id: who.id });
      expect(tradeRefusal(world, refused, 0), `${who.id} took the wrong thing`).toBeTruthy();

      // And something they do: any creature of the type, at the level asked.
      const match = ALL_SPECIES.find((spec) => spec.types.some((one) => one === want.type))!;
      const right: GameState = {
        ...standing,
        party: [
          creature(match.id, { uid: 1, level: want.minLevel ?? 10 }),
          creature("machop", { uid: 2, level: 30 }),
        ],
      };
      const ready = applyInput(world, right, { t: "talk", id: who.id });
      expect(tradeRefusal(world, ready, 0), `${who.id} refused what it asked for`).toBeNull();

      const done = applyInput(world, ready, { t: "npcTrade", index: 0 });
      expect(done.party[0].speciesId, who.id).toBe(who.gives!.speciesId);
      expect(done.party[0].variantId, who.id).toBe(who.gives!.variantId);
      expect(done.party[0].level, who.id).toBe(who.gives!.level);
      expect(done.party[0].traded, who.id).toBe(true);

      // Once, and then never again.
      expect(offerRefusal(world, done), who.id).toBe("they have already traded with you");
    }
  });
});
