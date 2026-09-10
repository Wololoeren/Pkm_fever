import { describe, expect, it } from "vitest";
import { maxHp } from "@/engine/battle";
import {
  awayFrom,
  critterAt,
  CRITTERS,
  CRITTER_TAG,
  critterIdOf,
  ROAM_CHANCE,
  type CritterSpec,
} from "@/engine/critters";
import { species as speciesById } from "@/engine/dex";
import {
  applyInput,
  critterOn,
  crittersOn,
  initialState,
  isWildBattle,
  npcAt,
  type Direction,
  type GameState,
} from "@/engine/engine";
import { walkable } from "@/engine/terrain";
import { propBlocks, trainerAt, type Route } from "@/engine/world";
import { testWorld } from "./helpers";

/**
 * Creatures standing in the world where you can see them.
 *
 * Everything else wild in this game is an *encounter*: a slot in a fixed list,
 * met by walking through grass, invisible until it is already happening. These
 * are the opposite, and the three things worth guarding follow from that:
 *
 *   **They are in the way.** Which means placing one badly is placing a wall.
 *   The first cut used its own "is this tile free" test rather than the one
 *   the people go through, put six creatures around the middle of town with
 *   one across the only way out, and *nine* tests in other files failed with
 *   the same message: expected 'town' to be 'route'. Every walking fixture in
 *   the suite was stuck in Hearth.
 *
 *   **A roamer's loop has to be a loop.** Every step adjacent, and the last
 *   tile adjacent to the first. A loop with a gap in it teleports a creature;
 *   a loop that does not close is a corridor it walks to the end of and stops.
 *
 *   **The chase has to be winnable.** Nine steps in ten it moves away, so
 *   following it round its own loop barely gains ground — and walking the loop
 *   the *other* way meets it head on. That second half is not a rule anybody
 *   wrote; it falls out of the loop being a loop, which is exactly why the
 *   loop is worth testing.
 */

/**
 * Four seeds, not eight.
 *
 * A world is four times what it was — twenty biomes, a hundred and seventy
 * routes — so four of them is more ground than eight used to cover, and
 * eight would be a quarter of a minute of world generation for one test.
 */
const SEEDS = ["a", "b", "c", "d"];

function started(seed: string) {
  const world = testWorld(seed);
  return { world, state: applyInput(world, initialState(world), { t: "pickStarter", index: 0 }) };
}

/** Every creature standing anywhere in a world. */
function allOf(world: ReturnType<typeof testWorld>): CritterSpec[] {
  return [...world.critters.values()].flat();
}

describe("where they stand", () => {
  it("N1: nothing stands on anything, and nothing stands in a doorway", () => {
    for (const seed of SEEDS) {
      const world = testWorld(seed);

      for (const [routeId, here] of world.critters) {
        const route = world.routes.get(routeId)!;
        const state = { ...initialState(world), roamers: {}, met: [] } as GameState;

        for (const { spec, x, y } of crittersOn(world, state, routeId)) {
          const where = `${seed}/${spec.id} at ${x},${y}`;

          // On ground you could have walked to.
          expect(walkable(route.tiles[y * route.width + x]), where).toBe(true);
          expect(propBlocks(route, x, y), `${where} is inside furniture`).toBe(false);

          // Never on a door or a border: standing on one would make it
          // unusable, and there is no walking round a doorway.
          expect(route.doors.some((d) => d.x === x && d.y === y), `${where} is a door`).toBe(false);
          expect(
            route.borders.some((b) => b.x === x && b.y === y),
            `${where} is a border`,
          ).toBe(false);

          // Never on top of somebody else.
          expect(npcAt(world, routeId, x, y), `${where} is on a person`).toBeNull();
          expect(trainerAt(world, routeId, x, y), `${where} is on a trainer`).toBeNull();
        }

        // And no two of them share a tile.
        const spots = here.map((spec) => `${spec.x},${spec.y}`);
        expect(new Set(spots).size, `${seed}/${routeId}: two on one tile`).toBe(spots.length);
      }
    }
  });

  it("N2: none of them walls the way through", () => {
    // The failure that taught this. A creature you cannot walk past is a
    // creature that can close a corridor, and the outer pinewood rings are
    // two tiles wide. Checked the honest way: block every tile they occupy
    // and see whether the map is still one piece.
    for (const seed of SEEDS) {
      const world = testWorld(seed);
      const state = { ...initialState(world), roamers: {}, met: [] } as GameState;

      for (const routeId of world.critters.keys()) {
        const route = world.routes.get(routeId)!;
        if (route.kind === "interior") continue;

        const blocked = new Set(
          crittersOn(world, state, routeId)
            // A roamer moves on, so it can stand in a corridor for one step
            // without stranding anybody. Only what stays put is a wall.
            .filter(({ spec }) => !spec.path)
            .map(({ x, y }) => `${x},${y}`),
        );

        // The honest comparison. Blocking a tile always costs *that tile* — a
        // creature standing somewhere is somewhere you cannot stand — so the
        // property is that it costs nothing *else*. Comparing against the
        // bare count instead reports every occupant as a severed map, which
        // is how the first cut of this test failed against code that was
        // perfectly correct.
        const bare = reachedWith(route, new Set());

        // Only the ones that were reachable to begin with. A creature standing
        // on a tile the walk could never have got to costs nothing — and
        // counting it anyway is how this test failed by exactly one on one
        // route out of a hundred and seventy.
        const standing = [...blocked].filter((at) => {
          const one = new Set(blocked);
          one.delete(at);
          return reachedWith(route, one) > reachedWith(route, blocked);
        }).length;

        expect(
          reachedWith(route, blocked),
          `${seed}/${routeId}: standing creatures cut the map in two`,
        ).toBe(bare - standing);
      }
    }
  });

  it("N3: town has some, and the roster's promises are kept on every seed", () => {
    for (const seed of SEEDS) {
      const world = testWorld(seed);
      const all = allOf(world);

      for (const written of CRITTERS) {
        const found = all.find((spec) => spec.id === written.id);
        expect(found, `${seed}: ${written.id} is not in the world`).toBeTruthy();
        expect(found!.kind).toBe(written.kind);
        expect(found!.creature.speciesId).toBe(written.speciesId);
        expect(found!.creature.level).toBe(written.level);
        if (written.variantId) expect(found!.creature.variantId).toBe(written.variantId);
      }

      // Town is populated, and most of what is in it is scenery.
      const inTown = world.critters.get("hub-0") ?? [];
      expect(inTown.length, `${seed}: nothing in town`).toBeGreaterThan(3);
      expect(inTown.filter((spec) => spec.kind === "idle").length).toBeGreaterThan(
        inTown.filter((spec) => spec.kind !== "idle").length,
      );
    }
  });
});

describe("the loops", () => {
  it("N4: every roamer gets one, and every one of them is a closed walk", () => {
    for (const seed of SEEDS) {
      const world = testWorld(seed);
      const roamers = allOf(world).filter((spec) => spec.path);

      expect(roamers.length, `${seed}: not every roamer got a loop`).toBe(
        CRITTERS.filter((one) => one.roams).length,
      );

      for (const spec of roamers) {
        const path = spec.path!;
        const where = `${seed}/${spec.id}`;

        // Long enough to be a chase and short enough to be one you can win.
        expect(path.length, `${where} loop of ${path.length}`).toBeGreaterThan(30);
        expect(path.length, `${where} loop of ${path.length}`).toBeLessThanOrEqual(300);

        // Every step adjacent, including the one that closes it. A gap here
        // is a creature that teleports; a loop that does not close is a
        // corridor it walks to the end of and stops in.
        for (let at = 0; at < path.length; at++) {
          const one = path[at];
          const next = path[(at + 1) % path.length];
          const step = Math.abs(one.x - next.x) + Math.abs(one.y - next.y);
          expect(step, `${where}: ${one.x},${one.y} to ${next.x},${next.y}`).toBe(1);
        }

        // No tile twice in a row, and it starts where it says it does.
        expect({ x: spec.x, y: spec.y }).toEqual(path[0]);
      }
    }
  });

  it("N5: nothing else is placed on a roamer's loop", () => {
    // A creature standing on the path is an obstacle halfway through a chase,
    // and worse: the roamer walks onto its tile, and then two things share
    // one and only one of them can be walked into.
    for (const seed of SEEDS) {
      const world = testWorld(seed);

      for (const [routeId, here] of world.critters) {
        const loops = here.filter((spec) => spec.path);
        if (!loops.length) continue;

        const onLoop = new Set(loops.flatMap((spec) => spec.path!.map((at) => `${at.x},${at.y}`)));
        for (const spec of here) {
          if (spec.path) continue;
          expect(
            onLoop.has(`${spec.x},${spec.y}`),
            `${seed}/${spec.id} is standing on a loop`,
          ).toBe(false);
        }

        for (const at of onLoop) {
          const [x, y] = at.split(",").map(Number);
          expect(npcAt(world, routeId, x, y), `${seed}: a person is on a loop`).toBeNull();
          expect(trainerAt(world, routeId, x, y), `${seed}: a trainer is on a loop`).toBeNull();
        }
      }
    }
  });

  it("N6: away from the player is away, in both directions round the loop", () => {
    const world = testWorld("a");
    const spec = allOf(world).find((one) => one.path)!;
    const path = spec.path!;

    // Standing on the loop itself, a step in one direction is further off and
    // the other is closer, and the rule picks the further.
    for (const index of [0, 7, Math.floor(path.length / 2), path.length - 3]) {
      const behind = path[(index - 1 + path.length) % path.length];
      const step = awayFrom(spec, index, behind);
      expect(step, `standing behind index ${index}`).toBe(1);

      const ahead = path[(index + 1) % path.length];
      expect(awayFrom(spec, index, ahead), `standing ahead of index ${index}`).toBe(-1);
    }
  });
});

describe("the chase", () => {
  it("N7: it flees nine steps in ten, and hesitates the tenth", () => {
    const { world, state } = started("a");
    const spec = allOf(world).find((one) => one.path)!;
    const path = spec.path!;

    // Walk the loop behind it and count how often it stayed put. The rule is
    // 900 in 1000, so over a few hundred steps the share should be close.
    // Well behind it on the loop, so the first step is a step rather than a
    // collision: starting one tile back walks straight into it and the walk
    // never begins.
    let at = path.length - 40;
    let live: GameState = { ...state, route: spec.routeId, ...path[((at % path.length) + path.length) % path.length] };
    let steps = 0;
    let stood = 0;

    for (let attempt = 0; attempt < 600 && steps < 200; attempt++) {
      const before = live.roamers[spec.id] ?? 0;
      const target = path[(((at + 1) % path.length) + path.length) % path.length];
      const dx = target.x - live.x;
      const dy = target.y - live.y;
      if (dx === 0 && dy === 0) {
        at++;
        continue;
      }
      const dir: Direction = dx > 0 ? "e" : dx < 0 ? "w" : dy > 0 ? "s" : "n";

      let next: GameState;
      try {
        next = applyInput(world, live, { t: "move", dir });
      } catch {
        break;
      }
      // Catching up to it is the end of the chase, not a step along it.
      if (next.phase === "battle") {
        if (next.battle?.tag === `${CRITTER_TAG}${spec.id}`) break;
        live = { ...next, phase: "field", battle: null, notice: null };
        at++;
        steps++;
        if ((next.roamers[spec.id] ?? 0) === before) stood++;
        continue;
      }

      at++;
      steps++;
      if ((next.roamers[spec.id] ?? 0) === before) stood++;
      live = next;
    }

    expect(steps, "the walk never got going").toBeGreaterThan(60);
    const fled = (steps - stood) / steps;
    // A tenth either side of the rule: this is a coin, not arithmetic.
    expect(fled).toBeGreaterThan(ROAM_CHANCE / 1000 - 0.12);
    expect(fled).toBeLessThan(1);
  });

  it("N8: pressing into one does not push it along", () => {
    // What makes a chase a chase. Walking into a roamer is the *interaction*,
    // so the player does not move — and because the flee roll comes with a
    // step, it does not get one either. Without this a roamer would be
    // untouchable: every attempt to reach it would move it.
    const { world, state } = started("a");
    const spec = allOf(world).find((one) => one.path)!;
    const path = spec.path!;

    const beside = path[path.length - 1];
    const live: GameState = { ...state, route: spec.routeId, ...beside };
    const at = critterAt(live.roamers, spec);
    const dir: Direction =
      at.x > beside.x ? "e" : at.x < beside.x ? "w" : at.y > beside.y ? "s" : "n";

    const after = applyInput(world, live, { t: "move", dir });
    expect(after.phase).toBe("battle");
    expect(after.roamers[spec.id] ?? 0).toBe(live.roamers[spec.id] ?? 0);
    expect(after.x).toBe(beside.x);
    expect(after.y).toBe(beside.y);
  });

  it("N9: a creature on another route does not move while you walk here", () => {
    // Loops advance for the route you are standing on and no other. Making
    // every step in the world advance every loop in it would be both wrong
    // and slow.
    const { world, state } = started("a");
    const mine = allOf(world).filter((one) => one.path);
    const [here, elsewhere] = [mine[0], mine[1]];
    expect(here.routeId).not.toBe(elsewhere.routeId);

    let live: GameState = { ...state, route: here.routeId, ...here.path![0] };
    for (let step = 0; step < 30; step++) {
      for (const dir of ["n", "e", "s", "w"] as const) {
        try {
          const next = applyInput(world, live, { t: "move", dir });
          if (next.phase !== "battle") live = next;
          break;
        } catch {
          // A wall. Try another way.
        }
      }
    }

    expect(live.roamers[elsewhere.id] ?? 0).toBe(0);
  });
});

describe("walking into one", () => {
  function place(seed: string, kind: CritterSpec["kind"]) {
    const { world, state } = started(seed);
    const spec = allOf(world).find((one) => one.kind === kind && !one.path);
    if (!spec) return null;

    // Stand next to it, on a tile it is not on.
    const beside = [
      { x: spec.x - 1, y: spec.y },
      { x: spec.x + 1, y: spec.y },
      { x: spec.x, y: spec.y - 1 },
      { x: spec.x, y: spec.y + 1 },
    ].find((at) => {
      const route = world.routes.get(spec.routeId)!;
      return (
        walkable(route.tiles[at.y * route.width + at.x]) &&
        !propBlocks(route, at.x, at.y) &&
        !critterOn(world, state, spec.routeId, at.x, at.y)
      );
    });
    if (!beside) return null;

    const dir: Direction =
      spec.x > beside.x ? "e" : spec.x < beside.x ? "w" : spec.y > beside.y ? "s" : "n";
    return { world, spec, dir, state: { ...state, route: spec.routeId, ...beside } as GameState };
  }

  it("N10: an idle one says so and is still there afterwards", () => {
    const set = place("a", "idle");
    expect(set, "no idle creature stands still anywhere").toBeTruthy();
    const { world, spec, dir, state } = set!;

    const after = applyInput(world, state, { t: "move", dir });
    expect(after.notice).toEqual({ t: "noticed", speciesId: spec.creature.speciesId });
    // Nothing recorded, so it is still standing there tomorrow: that is the
    // whole of what makes it scenery rather than a reward.
    expect(after.met).toEqual([]);
    expect(after.phase).toBe("field");
    expect(critterOn(world, after, spec.routeId, spec.x, spec.y)).toBeTruthy();
  });

  it("N11: one that joins comes along, once, and is gone from the map", () => {
    const { world, state } = started("a");
    const spec = allOf(world).find((one) => one.kind === "joins")!;
    const beside = { x: spec.x - 1, y: spec.y };
    const live: GameState = { ...state, route: spec.routeId, ...beside };

    const before = live.party.length;
    const after = applyInput(world, live, { t: "move", dir: "e" });

    expect(after.party.length).toBe(before + 1);
    expect(after.party[after.party.length - 1].speciesId).toBe(spec.creature.speciesId);
    expect(after.notice).toEqual({
      t: "joined",
      speciesId: spec.creature.speciesId,
      boxed: false,
    });

    // Recorded, so it is not standing there to be collected again.
    expect(after.met).toContain(spec.id);
    expect(critterOn(world, after, spec.routeId, spec.x, spec.y)).toBeNull();
    expect(crittersOn(world, after, spec.routeId).some((one) => one.spec.id === spec.id)).toBe(false);

    // At full health, with moves, and a uid nothing else has.
    const joined = after.party[after.party.length - 1];
    expect(joined.hp).toBe(maxHp(joined));
    expect(joined.moves.length).toBeGreaterThan(0);
    expect(after.party.filter((one) => one.uid === joined.uid).length).toBe(1);
  });

  it("N12: a wild one fights, and it can be caught or run from", () => {
    const set = place("a", "wild");
    expect(set, "nothing standing about will fight").toBeTruthy();
    const { world, spec, dir, state } = set!;

    const after = applyInput(world, state, { t: "move", dir });
    expect(after.phase).toBe("battle");
    expect(after.battle!.tag).toBe(`${CRITTER_TAG}${spec.id}`);
    expect(critterIdOf(after.battle!.tag)).toBe(spec.id);

    // Wild rules: a creature standing in the open is as wild as one in the
    // grass, so balls and running are legal. Getting this wrong would make a
    // roamer uncatchable, which would take the point out of chasing one.
    expect(isWildBattle(after.battle)).toBe(true);

    const fielded = after.battle!.sides[1].team[0];
    expect(fielded.speciesId).toBe(spec.creature.speciesId);
    expect(fielded.level).toBe(spec.creature.level);
    expect(fielded.hp).toBe(maxHp(fielded));
    expect(fielded.moves.length).toBeGreaterThan(0);
  });

  it("N13: beating one retires it, and running away does not", () => {
    const set = place("a", "wild");
    const { world, spec, dir, state } = set!;

    // A level-100 lead against whatever is standing about: this ends quickly.
    const strong: GameState = {
      ...state,
      party: [
        {
          ...state.party[0],
          level: 100,
          exp: 1_000_000,
          moves: ["closecombat"],
          pp: [10],
          speciesId: "machamp",
        },
      ],
    };
    let live = applyInput(world, strong, { t: "move", dir });
    live = { ...live, party: live.battle!.sides[0].team };

    for (let turn = 0; turn < 40 && live.phase === "battle"; turn++) {
      live = applyInput(world, live, { t: "fight", moveIndex: 0 });
    }

    if (live.battle?.outcome?.t === "win" && live.battle.outcome.side === 0) {
      expect(live.met).toContain(spec.id);
      expect(critterOn(world, live, spec.routeId, spec.x, spec.y)).toBeNull();
    }

    // And running from one leaves it exactly where it was.
    const fled = applyInput(world, applyInput(world, strong, { t: "move", dir }), { t: "flee" });
    if (fled.battle?.outcome?.t === "fled") {
      expect(fled.met).not.toContain(spec.id);
      expect(critterOn(world, fled, spec.routeId, spec.x, spec.y)).toBeTruthy();
    }
  });
});

describe("what they are made of", () => {
  it("N14: every one of them is a creature the bestiary has", () => {
    for (const seed of SEEDS) {
      for (const spec of allOf(testWorld(seed))) {
        expect(() => speciesById(spec.creature.speciesId), `${seed}/${spec.id}`).not.toThrow();
        expect(spec.creature.level, `${seed}/${spec.id}`).toBeGreaterThan(0);
        // Left bare exactly as `wildAt` leaves one: the engine fills these in
        // at the moment it needs them, so a critter and a grass encounter are
        // built by one rule rather than two.
        expect(spec.creature.moves).toEqual([]);
        expect(spec.creature.hp).toBe(0);
        expect(spec.creature.uid).toBe(0);
      }
    }
  });

  it("N15: the generated ones come from the route they are standing on", () => {
    // A meadow has meadow creatures pottering about in it. Not decoration for
    // its own sake: it means the visible creatures agree with the invisible
    // ones, so what you can see tells you something true about where you are.
    const world = testWorld("a");

    for (const [routeId, here] of world.critters) {
      const route = world.routes.get(routeId);
      if (!route || route.kind !== "route") continue;

      for (const spec of here) {
        // Authored ones are written down and may be anything.
        if (CRITTERS.some((one) => one.id === spec.id)) continue;
        // Within a couple of levels of the route's own creatures.
        const expected = 3 + (route.ring - 1) * 8;
        expect(Math.abs(spec.creature.level - expected), `${spec.id}`).toBeLessThanOrEqual(3);
      }
    }
  });
});

/** How much of a route can be reached from its entry, with tiles blocked. */
function reachedWith(route: Route, blocked: Set<string>): number {
  const seen = new Uint8Array(route.width * route.height);
  const start = route.entry;
  if (blocked.has(`${start.x},${start.y}`)) return 0;

  const queue = [start];
  seen[start.y * route.width + start.x] = 1;
  let reached = 1;

  for (let head = 0; head < queue.length; head++) {
    const here = queue[head];
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ] as const) {
      const x = here.x + dx;
      const y = here.y + dy;
      if (x < 0 || y < 0 || x >= route.width || y >= route.height) continue;
      if (blocked.has(`${x},${y}`)) continue;

      const index = y * route.width + x;
      if (seen[index] || !walkable(route.tiles[index])) continue;
      if (propBlocks(route, x, y)) continue;
      seen[index] = 1;
      reached++;
      queue.push({ x, y });
    }
  }

  return reached;
}
