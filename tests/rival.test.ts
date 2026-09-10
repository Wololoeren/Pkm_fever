import { describe, expect, it } from "vitest";
import { effectiveness, species as speciesById } from "@/engine/dex";
import {
  applyInput,
  initialState,
  isWildBattle,
  opponentLabel,
  reduce,
  rivalAt,
  rivalCountdown,
  rivalIdOf,
  stateHash,
  type GameState,
  type Input,
} from "@/engine/engine";
import {
  RIVAL_BEHIND,
  RIVAL_EVERY,
  RIVAL_STALK,
  rivalDue,
  rivalTeam,
} from "@/engine/rival";
import { variant } from "@/engine/variants";
import { creature, testWorld } from "./helpers";

/**
 * The one thing in this world that comes after you.
 *
 * Every other trainer stands still and waits, which is what makes them scenery
 * you choose to walk into — and it means nothing here has ever *chased* anybody.
 * The rival turns up three steps behind, walks where you have just walked for
 * twenty moves, and then catches up.
 *
 * Almost none of him is stored. Where he is standing is your own position three
 * moves ago, read off a trail the state keeps anyway; what he is carrying is
 * computed from your party at the moment he catches you. So what these check is
 * mostly that the *derivation* holds: that he is where the trail says, that he
 * arrives on the tick he is due, and that a save which replays walks him over
 * the same ground.
 */

/**
 * Out on a route with a party, without playing to get there.
 *
 * On a route rather than in the square, because he does not follow you into a
 * town — which is the whole reason a Center is somewhere to run to.
 */
function walking(world: ReturnType<typeof testWorld>, party = 1): GameState {
  const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  const route = [...world.routes.values()].find((one) => one.kind === "route" && one.ring === 1)!;

  return {
    ...start,
    route: route.id,
    x: route.entry.x,
    y: route.entry.y,
    party: Array.from({ length: party }, (_, at) =>
      creature(["treecko", "geodude", "psyduck", "machop", "gastly", "pidgey"][at], {
        uid: at + 1,
        level: 20 + at * 2,
      }),
    ),
  };
}

/** The first step onto the route, which is what brings him out. */
function arrived(world: ReturnType<typeof testWorld>, state: GameState): GameState {
  return step(world, state);
}

/** Steps one square, whichever way is open. */
function step(world: ReturnType<typeof testWorld>, state: GameState): GameState {
  for (const dir of ["n", "s", "e", "w"] as const) {
    try {
      const next = applyInput(world, state, { t: "move", dir });
      if (next.x !== state.x || next.y !== state.y || next.route !== state.route) return next;
    } catch {
      /* walled that way */
    }
  }
  throw new Error("nowhere to walk");
}

describe("the rival", () => {
  it("V1: he is there from the first move, and he is behind you", () => {
    // Tick nought counts: the first thing that happens to you is that
    // somebody starts following you.
    const world = testWorld("A1");
    const state = arrived(world, walking(world));

    expect(state.rivalSince, "nobody is following yet").not.toBeNull();
    expect(rivalCountdown(state)).toBe(RIVAL_STALK);

    // He walks the ground you have just left, so once the trail is long
    // enough he is exactly `RIVAL_BEHIND` steps back down it.
    let live = state;
    const path: string[] = [`${live.route}@${live.x},${live.y}`];
    for (let n = 0; n < RIVAL_BEHIND + 1 && live.phase === "field"; n++) {
      live = step(world, live);
      path.unshift(`${live.route}@${live.x},${live.y}`);
    }

    const behind = rivalAt(live)!;
    expect(behind, "nobody on the map").toBeTruthy();
    expect(`${behind.route}@${behind.x},${behind.y}`).toBe(path[RIVAL_BEHIND]);

    // And never on top of you, which is what makes him a chase rather than an
    // obstacle you keep bumping into.
    expect([behind.x, behind.y]).not.toEqual([live.x, live.y]);
  });

  it("V2: he catches up after twenty moves, and it is a battle you cannot run from", () => {
    const world = testWorld("A1");
    let live = arrived(world, walking(world, 3));
    const before = live.rivalSince!;

    // Walking through grass means walking into things. Anything that is not
    // him is run from and the walk goes on, because what is under test is that
    // *he* arrives, not what else lives on the route.
    for (let n = 0; n < RIVAL_STALK * 20; n++) {
      if (live.phase === "battle" && rivalIdOf(live.battle)) break;

      if (live.phase === "battle") {
        live = applyInput(world, live, { t: "flee" });
        continue;
      }
      if (live.phase === "battleEnd") {
        live = applyInput(world, live, { t: "continue" });
        continue;
      }

      const left = rivalCountdown(live);
      if (left !== null) expect(left).toBeLessThanOrEqual(RIVAL_STALK);
      live = step(world, live);
    }

    expect(live.phase, "he never caught up").toBe("battle");
    expect(rivalIdOf(live.battle)).toBe(String(before));
    expect(opponentLabel(world, live.battle)).toBe("Rival's");

    // Not a wild battle, so there is no ball and no running. You do not get to
    // walk away from this one.
    expect(isWildBattle(live.battle)).toBe(false);

    // And he is off the map while the fight is on.
    expect(live.rivalSince).toBeNull();
    expect(rivalAt(live)).toBeNull();
  });

  it("V3: he brings as many as you have, three levels up", () => {
    const world = testWorld("A1");

    for (const size of [1, 3, 6]) {
      const party = Array.from({ length: size }, (_, at) =>
        creature("pidgey", { uid: at + 1, level: 10 + at * 4 }),
      );
      const team = rivalTeam(world.seed, 0, party);

      expect(team.length, `party of ${size}`).toBe(size);

      const average = Math.round(
        party.reduce((total, one) => total + one.level, 0) / party.length,
      );
      for (const one of team) expect(one.level, `party of ${size}`).toBe(average + 3);
    }
  });

  it("V4: every one of his is picked to beat one of yours", () => {
    // The claim that makes him worth preparing for. A party that has grown
    // lopsided is a party he has noticed.
    const world = testWorld("A1");
    const party = [
      creature("treecko", { uid: 1, level: 30 }),
      creature("charmander", { uid: 2, level: 30 }),
      creature("squirtle", { uid: 3, level: 30 }),
      creature("machop", { uid: 4, level: 30 }),
    ];
    const team = rivalTeam(world.seed, 0, party);

    team.forEach((his, slot) => {
      const mine = speciesById(party[slot].speciesId).types;
      const best = Math.max(
        ...speciesById(his.speciesId).types.map((type) => effectiveness(type, mine)),
      );
      // Better than neutral: four quarters is even, so anything above it is a
      // type advantage he chose on purpose.
      expect(best, `${his.speciesId} against ${party[slot].speciesId}`).toBeGreaterThan(4);
    });
  });

  it("V5: he is decorated far past anything else in the world", () => {
    // The quiet insult: the colours you have spent forty hours hunting are what
    // he turns up wearing. Over a good many parties, most of his are dressed.
    const world = testWorld("A1");
    let dressed = 0;
    let all = 0;

    for (let at = 0; at < 60; at++) {
      const party = [creature("pidgey", { uid: 1, level: 30 })];
      for (const one of rivalTeam(world.seed, at, party)) {
        all++;
        const form = variant(one.variantId);
        if (form.tier > 0 || form.chromaId) dressed++;
      }
    }

    expect(all).toBe(60);
    expect(dressed / all, "he turned up plain").toBeGreaterThan(0.75);
  });

  it("V6: he comes back, on the clock, and the clock is in the save", () => {
    // Once beaten he is gone until the next multiple. `rivalDue` is a modulo
    // on the tick rather than a countdown, so a save cannot drift out of step
    // with it.
    const world = testWorld("A1");
    const state = arrived(world, walking(world));

    // Straight after he is dealt with, nobody is following.
    const cleared: GameState = { ...state, rivalSince: null, tick: 5 };
    expect(rivalCountdown(cleared)).toBeNull();

    // Never before is always due, which is what makes his first appearance the
    // first move of a new game rather than the two-thousand-five-hundredth.
    expect(rivalDue(1, null)).toBe(true);

    // And afterwards the gap is measured from when he last came, so a long
    // encounter does not eat into the next one.
    expect(rivalDue(500, 0)).toBe(false);
    expect(rivalDue(RIVAL_EVERY - 1, 0)).toBe(false);
    expect(rivalDue(RIVAL_EVERY, 0)).toBe(true);
    expect(rivalDue(RIVAL_EVERY + 400, 400)).toBe(true);
  });

  it("V7: all of it replays, because none of it is rolled when it is needed", () => {
    const world = testWorld("B2");
    const inputs: Input[] = [{ t: "pickStarter", index: 0 }];

    let live = applyInput(world, initialState(world), inputs[0]);
    for (let n = 0; n < 40 && live.phase === "field"; n++) {
      for (const dir of ["s", "e", "n", "w"] as const) {
        try {
          const next = applyInput(world, live, { t: "move", dir });
          inputs.push({ t: "move", dir });
          live = next;
          break;
        } catch {
          /* walled */
        }
      }
    }

    const again = reduce(world, inputs);
    expect(stateHash(again)).toBe(stateHash(live));
    expect(again.rivalSince).toBe(live.rivalSince);
    expect(again.trail).toEqual(live.trail);
    expect(rivalAt(again)).toEqual(rivalAt(live));
  });
});
