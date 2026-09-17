import { describe, expect, it } from "vitest";
import {
  arena,
  arenaBand,
  arenaBreakdown,
  arenaLevel,
  ARENA_POOL,
  ARENA_ROUNDS,
  ARENA_SIZE,
  ARENAS,
} from "@/engine/arenas";
import {
  applyInput,
  arenaFightRefusal,
  arenaPrizes,
  arenaPrizeRefusal,
  arenaRefusal,
  arenaRoundOf,
  arenaTeam,
  initialState,
  reduce,
  stateHash,
  type GameState,
  type Input,
} from "@/engine/engine";
import { routeId } from "@/engine/world";
import { creature, testWorld } from "./helpers";

/**
 * Six people running eight-player brackets out of a field.
 *
 * The PvP bracket needs three other people and a room code. This is the same
 * three rounds against the machine, one per format, at a difficulty that reads
 * how far you have come the way a gym does.
 *
 * Everything about a draw is derived from three numbers — which arena, the
 * tick it was entered on, and the round — so what is worth guarding is that
 * those three really are enough: the same log walks into the same field, and
 * losing and re-entering is a *different* one rather than a rematch.
 */

function standing(seed: string, party: number, level = 40) {
  const world = testWorld(seed);
  const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  const state: GameState = {
    ...start,
    party: Array.from({ length: party }, (_, at) =>
      creature(["machamp", "gyarados", "arcanine", "snorlax", "lapras", "vaporeon"][at], {
        uid: at + 1,
        level,
        moves: ["tackle"],
      }),
    ),
  };
  return { world, state };
}

describe("where the brackets are", () => {
  it("W28: every arena stands somewhere that exists, in every world", () => {
    // The bug this exists for: a biome's tier decides how many copies a world
    // holds, and `fellgarden` holds two — so an arena written at `nth: 3` was
    // an address that resolves in no world at all, and the sixth host simply
    // did not exist. Nothing failed; there was just one fewer person.
    for (const seed of ["A1", "B2", "C3", "D4"]) {
      const world = testWorld(seed);
      for (const spec of ARENAS) {
        const route = world.routes.get(routeId(spec.biome, spec.nth));
        expect(route, `${seed}: ${spec.id} wants ${spec.biome}/${spec.nth}`).toBeDefined();
      }
    }
  });

  it("W29: one per format, and no two in the same place", () => {
    // Six formats, six brackets. Two in one field would be two people offering
    // the same thing, and the point of six is that each is a different one.
    expect(ARENAS.map((one) => one.teamSize).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    const places = ARENAS.map((one) => `${one.biome}/${one.nth}`);
    expect(new Set(places).size).toBe(ARENAS.length);

    // And they get harder as the format does, so walking further is walking
    // into something bigger rather than something arbitrary.
    const bySize = [...ARENAS].sort((a, b) => a.teamSize - b.teamSize);
    for (let at = 1; at < bySize.length; at++) {
      expect(bySize[at].baseLevel).toBeGreaterThan(bySize[at - 1].baseLevel);
    }
  });

  it("W30: they scale on moves and badges, and stop at a hundred", () => {
    // The gym argument, applied again: a number written when the world was
    // made is a wall at hour two and a formality at hour twenty.
    const spec = arena("arena-3");
    expect(arenaLevel(spec, 0, 0)).toBe(spec.baseLevel);
    expect(arenaLevel(spec, 5_000, 0)).toBe(spec.baseLevel + 2);
    expect(arenaLevel(spec, 0, 4)).toBe(spec.baseLevel + 12);
    // The drift is capped, so it stops climbing long before it is silly.
    expect(arenaLevel(spec, 1_000_000, 0)).toBe(spec.baseLevel + 30);
    expect(arenaLevel(spec, 1_000_000, 8)).toBeLessThanOrEqual(100);

    const shown = arenaBreakdown(spec, 3_000, 2);
    expect(shown.base + shown.fromMoves + shown.fromBadges).toBe(shown.total);
  });

  it("W31: the band slides with the level, so a low bracket is not fielding giants", () => {
    const [lowFrom, lowTo] = arenaBand(10);
    const [highFrom, highTo] = arenaBand(90);
    expect(highFrom).toBeGreaterThan(lowFrom);
    expect(highTo).toBeGreaterThan(lowTo);
    // A window rather than a floor: the far end is not the whole roster.
    expect(lowTo - lowFrom).toBeGreaterThan(10);
    expect(highTo).toBeLessThanOrEqual(ARENA_POOL.length - 1);
  });
});

describe("playing one", () => {
  it("W32: it refuses a field you cannot fill, and one you are already in", () => {
    // A 6v6 with two standing is a walkover in the wrong direction.
    const { world, state } = standing("ARENA1", 2);
    expect(arenaRefusal(state, "arena-6")).toBe("it is 6v6: bring exactly 6 (you have 2)");
    // Too many is refused as firmly as too few: a bracket is entered with the format, exactly.
    expect(arenaRefusal(state, "arena-1")).toBe("it is 1v1: bring exactly 1 (you have 2)");
    expect(arenaRefusal(state, "arena-2")).toBeNull();
    expect(arenaRefusal(state, "arena-nope")).toBe("no such bracket");
    const oneDown = { ...state, party: [state.party[0], { ...state.party[1], hp: 0 }] };
    expect(arenaRefusal(oneDown, "arena-2")).toMatch(/1 standing/);

    const entered = applyInput(world, standing("ARENA1", 1).state, { t: "arenaEnter", id: "arena-1" });
    expect(entered.arena).toEqual({ id: "arena-1", entered: state.tick, round: 0 });
    expect(arenaRefusal(entered, "arena-2")).toBe("you are already in one");
  });

  it("W33: three rounds takes it, and each one is a real battle", () => {
    const { world, state } = standing("ARENA2", 1, 60);
    let live = applyInput(world, state, { t: "arenaEnter", id: "arena-1" });

    for (let round = 0; round < ARENA_ROUNDS; round++) {
      expect(live.arena?.round, `before round ${round}`).toBe(round);
      expect(arenaFightRefusal(live)).toBeNull();

      const team = arenaTeam(world, live);
      expect(team.length, `round ${round} fielded nobody`).toBe(arena("arena-1").teamSize);

      live = applyInput(world, live, { t: "arenaFight" });
      expect(live.phase).toBe("battle");
      expect(arenaRoundOf(live.battle), `round ${round} tag`).toBe(round);

      // Won, by the shortest road a test can take: everything opposite is
      // knocked out. What is under test is the bracket, not the battle.
      const beaten = {
        ...live,
        battle: {
          ...live.battle!,
          sides: [
            live.battle!.sides[0],
            {
              ...live.battle!.sides[1],
              team: live.battle!.sides[1].team.map((one) => ({ ...one, hp: 0 })),
            },
          ] as NonNullable<typeof live.battle>["sides"],
        },
      };
      live = applyInput(world, beaten, { t: "fight", moveIndex: 0 });
      live = applyInput(world, live, { t: "continue" });
    }

    expect(live.arena?.round).toBe(ARENA_ROUNDS);
    expect(arenaFightRefusal(live)).toBe("there is nothing left to play");
  });

  it("W34: the prize is three, derived, and only after the third win", () => {
    const { world, state } = standing("ARENA3", 1);
    const entered = applyInput(world, state, { t: "arenaEnter", id: "arena-1" });

    // Not yet.
    expect(arenaPrizeRefusal(entered, 0)).toBe("you have not won it yet");

    const won: GameState = { ...entered, arena: { ...entered.arena!, round: ARENA_ROUNDS } };
    expect(arenaPrizeRefusal(won, 0)).toBeNull();
    expect(arenaPrizeRefusal(won, 9)).toBe("no such prize");

    const offered = arenaPrizes(world, won);
    expect(offered).toHaveLength(3);
    // An eight-player field, whichever arena it was — that is what the prize
    // is priced on, and it is why every one of these is a bracket of eight.
    expect(ARENA_SIZE).toBe(8);
    for (const one of offered) {
      expect(one.level).toBe(1);
      expect(one.prize).toBe(true);
    }

    const took = applyInput(world, won, { t: "arenaPrize", index: 1 });
    expect([...took.party, ...took.box].at(-1)!.speciesId).toBe(offered[1].speciesId);
    // And the bracket is over, or the panel would offer three for ever.
    expect(took.arena).toBeNull();
  });

  it("W35: losing puts you out, and re-entering is a new draw", () => {
    // A knockout you can wake up from and carry on in is not a knockout.
    const { world, state } = standing("ARENA4", 1, 5);
    const entered = applyInput(world, state, { t: "arenaEnter", id: "arena-1" });
    const first = JSON.stringify(arenaTeam(world, entered));

    // Wiped out: the whole party down is what losing a bracket match is.
    const flattened: GameState = {
      ...entered,
      phase: "battle",
      party: entered.party.map((one) => ({ ...one, hp: 0 })),
      battle: applyInput(world, entered, { t: "arenaFight" }).battle,
    };
    const after = applyInput(world, flattened, { t: "fight", moveIndex: 0 });
    expect(after.arena, "still in the bracket after being wiped out").toBeNull();

    // And entering again is a different field, because the tick names it.
    const again = applyInput(world, { ...after, phase: "field" }, {
      t: "arenaEnter",
      id: "arena-1",
    });
    expect(again.arena!.entered).not.toBe(entered.arena!.entered);
    expect(JSON.stringify(arenaTeam(world, again))).not.toBe(first);
  });

  it("W36: the whole thing replays", () => {
    // Nothing about a draw is carried in the log — not the seven opponents,
    // not their teams, not the three at the end. Three numbers on the state
    // and the world seed rebuild all of it.
    const world = testWorld("ARENA5");
    const log: Input[] = [
      { t: "pickStarter", index: 0 },
      { t: "cheat", cheat: { op: "setLevel", index: 0, level: 60 } },
      { t: "cheat", cheat: { op: "warp", route: routeId(arena("arena-1").biome, arena("arena-1").nth) } },
      { t: "arenaEnter", id: "arena-1" },
    ];
    expect(stateHash(reduce(world, log))).toBe(stateHash(reduce(world, log)));

    const built = reduce(world, log);
    expect(JSON.stringify(arenaTeam(world, built))).toBe(
      JSON.stringify(arenaTeam(world, reduce(world, log))),
    );
  });
});
