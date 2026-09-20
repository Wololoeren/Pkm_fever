import { describe, expect, it } from "vitest";
import { isFainted } from "@/engine/battle";
import {
  applyInput,
  clubBoutRefusal,
  clubRefusal,
  CLUB_BONUS,
  CLUB_PURSE,
  initialState,
  type GameState,
} from "@/engine/engine";
import { creature, testWorld } from "./helpers";

/**
 * The fight club: he takes one of yours and the rest of your party answers
 * for it, bout after bout, until one of them is the only one left standing.
 */

const SEED = "CLUB1";

/** Standing in front of him, with this party. */
function facing(party: GameState["party"]): { world: ReturnType<typeof testWorld>; state: GameState } {
  const world = testWorld(SEED);
  const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  const [routeId, here] = [...world.npcs].find(([, people]) => people.some((one) => one.id === "fight-club"))!;
  const him = here.find((one) => one.id === "fight-club")!;
  return {
    world,
    state: { ...start, route: routeId, x: him.x, y: him.y + 1, talking: "fight-club", party, money: 0 },
  };
}

/** A party of `n`, all able to fight and all able to knock each other out. */
const squad = (n: number) =>
  Array.from({ length: n }, (_, at) =>
    creature("machamp", { uid: at + 1, level: 40 + at, moves: ["closecombat", "earthquake"] }),
  );

/** Plays a bout to the end, whichever way it goes. */
function fightOut(world: ReturnType<typeof testWorld>, state: GameState): GameState {
  let here = state;
  for (let turn = 0; turn < 200 && here.phase === "battle"; turn++) {
    try {
      here = applyInput(world, here, { t: "fight", moveIndex: 0 });
    } catch {
      here = applyInput(world, here, { t: "fight", moveIndex: 1 });
    }
  }
  expect(here.phase, "the bout never ended").toBe("battleEnd");
  return applyInput(world, here, { t: "continue" });
}

describe("the fight club", () => {
  it("FC1: two of yours have to be standing, and he is somewhere in the world", () => {
    const world = testWorld(SEED);
    const found = [...world.npcs.values()].flat().filter((one) => one.id === "fight-club");
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("fightclub");

    const { state } = facing(squad(1));
    expect(clubRefusal(state)).toBe("you need two standing");
    expect(clubRefusal({ ...state, party: squad(3) })).toBeNull();
    expect(clubBoutRefusal({ ...state, party: squad(3) })).toBe("no series is running");
  });

  it("FC2: he takes one out of the party and stands it across the field from the rest", () => {
    const { world, state } = facing(squad(3));
    const inside = applyInput(world, state, { t: "clubEnter" });

    expect(inside.phase).toBe("battle");
    expect(inside.club).toEqual({ round: 0, slot: expect.any(Number) });
    // Two of yours on your side, the third one facing them — and it is one of
    // yours, not a copy of something: same uid.
    expect(inside.party).toHaveLength(2);
    const held = inside.battle!.sides[1].team[0];
    expect(state.party.map((one) => one.uid)).toContain(held.uid);
    expect(inside.party.map((one) => one.uid)).not.toContain(held.uid);
    expect(inside.battle!.sides[0].team).toHaveLength(2);
  });

  it("FC3: the one he held comes back into its own slot, and a won bout pays and offers another", () => {
    const { world, state } = facing(squad(3));
    const inside = applyInput(world, state, { t: "clubEnter" });
    const slot = inside.club!.slot;
    const held = inside.battle!.sides[1].team[0];

    const after = fightOut(world, inside);
    expect(after.party).toHaveLength(3);
    expect(after.party[slot].uid, "it went back where it came from").toBe(held.uid);
    expect(after.money).toBe(CLUB_PURSE);
    // One of them went down, and the series is still on.
    expect(after.party.filter(isFainted).length).toBeGreaterThan(0);
    expect(after.club).toEqual({ round: 1, slot });
    expect(clubBoutRefusal(after)).toBeNull();
  });

  it("FC4: it runs until one is left standing, and then it pays the bonus and stops", () => {
    const { world, state } = facing(squad(4));
    let here = fightOut(world, applyInput(world, state, { t: "clubEnter" }));
    for (let bout = 0; bout < 6 && here.club; bout++) {
      here = fightOut(world, applyInput(world, here, { t: "clubFight" }));
    }

    expect(here.club, "the series never ended").toBeNull();
    expect(here.party.filter((one) => !isFainted(one))).toHaveLength(1);
    // Nobody was lost along the way: four went in, four came out.
    expect(here.party).toHaveLength(4);
    expect(here.notice).toMatchObject({ t: "clubDone" });
    expect(here.money).toBeGreaterThanOrEqual(CLUB_PURSE + CLUB_BONUS);
    // And losing the last bout is not a blackout: somebody of yours is up.
    expect(here.route).toBe(state.route);
  });

  it("FC5: the whole thing replays from the log", () => {
    const { world, state } = facing(squad(3));
    const inside = applyInput(world, state, { t: "clubEnter" });
    const once = fightOut(world, inside);
    const twice = fightOut(world, applyInput(world, state, { t: "clubEnter" }));
    expect(twice.party.map((one) => `${one.uid}:${one.hp}`)).toEqual(once.party.map((one) => `${one.uid}:${one.hp}`));
    expect(twice.club).toEqual(once.club);
  });
});
