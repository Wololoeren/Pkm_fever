import { describe, expect, it } from "vitest";
import {
  applyInput,
  fieldNotes,
  initialState,
  reduce,
  stateHash,
  type GameState,
  type Input,
} from "@/engine/engine";
import { startBattle } from "@/engine/battle";
import { creature, play, testWorld } from "./helpers";

/**
 * The field notes: every species met, and where.
 *
 * The property that matters is that it cannot be *avoided*. There are nine
 * roads to a battle in the engine and several roads to owning a creature
 * without one, and the record is folded in a single place precisely so that
 * none of them has to remember it. So these are mostly "come in by this door
 * and check it was still written down".
 */

/**
 * Out on a route with a party, without playing to get there.
 *
 * A route rather than the square, because half of what is under test only
 * happens outdoors: the rival does not follow you into a town.
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

/** One square, whichever way happens to be open. A fabricated position cannot
 * assume north is not a wall. */
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

describe("what you have met", () => {
  it("N1: a fresh game has met nothing", () => {
    const world = testWorld("NOTE1");
    expect(initialState(world).whereMet).toEqual({});
  });

  it("N2: the starter is written down the moment it is yours", () => {
    const world = testWorld("NOTE1");
    const state = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    const mine = state.party[0];
    expect(Object.keys(state.whereMet)).toContain(mine.speciesId);
    // Picked up in the town you wake in, which is where you met it.
    expect(state.whereMet[mine.speciesId]).toBe(state.route);
  });

  it("N3: both sides of a battlefield count", () => {
    const world = testWorld("NOTE1");
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    const foe = creature("gastly", { uid: 900 });
    const fighting: GameState = {
      ...base,
      phase: "battle",
      battle: startBattle(world.seed, "wild:notes", base.party, [foe], 0),
    };

    // The fold runs in `applyInput`, so the record is written on the next
    // input rather than by assembling the state by hand.
    const after = applyInput(world, fighting, { t: "fight", moveIndex: 0 });
    expect(Object.keys(after.whereMet)).toContain("gastly");
  });

  it("N4: something in the box stays met after it is let go", () => {
    const world = testWorld("NOTE1");
    const base = walking(world);

    const noted = step(world, { ...base, box: [creature("magikarp", { uid: 901 })] });
    expect(noted.whereMet.magikarp).toBeDefined();

    // Gone from the box, still in the notes. A record of where you have looked
    // is not a list of what you currently own.
    const emptied = step(world, { ...noted, box: [] });
    expect(emptied.whereMet.magikarp).toBeDefined();
  });

  it("N5: where it was first met is where it stays", () => {
    const world = testWorld("NOTE1");
    const base = walking(world);

    const first = step(world, { ...base, box: [creature("magikarp", { uid: 902 })] });
    const where = first.whereMet.magikarp;
    expect(where).toBe(base.route);

    // Carried somewhere else and met again, the first answer stands. A note
    // that moved with you would record where you are, not where you looked.
    const away = [...world.routes.values()].find(
      (one) => one.kind === "route" && one.id !== base.route,
    )!;
    const elsewhere = step(world, {
      ...first,
      route: away.id,
      x: away.entry.x,
      y: away.entry.y,
    });
    expect(elsewhere.whereMet.magikarp).toBe(where);
  });

  it("N6: nothing new means the same object back", () => {
    const world = testWorld("NOTE1");
    const base = walking(world);
    const once = step(world, base);
    const twice = step(world, once);

    // Not an optimisation detail: `reduce` runs this once per input and a long
    // save is ninety thousand of them.
    expect(twice.whereMet).toBe(once.whereMet);
  });

  it("N7: it survives a replay, because it is a fold over the log", () => {
    const world = testWorld("NOTE2");

    // A real walk, and then three creatures handed over on purpose.
    //
    // The walk alone is not enough to assert on: a random legal walker spends
    // some seeds going round the square without ever crossing into grass, and
    // a test whose only content is "the starter is still there" would pass
    // whatever this code did. A cheat is an input like any other — it lands in
    // the log and replays with it — so it is the honest way to put a known set
    // of species into a log rather than hoping for one.
    const { inputs: walked } = play(world, 3000);
    const inputs: Input[] = [
      ...walked,
      ...(["gastly", "machop", "psyduck"] as const).map(
        (speciesId): Input => ({
          t: "cheat",
          cheat: { op: "give", speciesId, level: 5, variantId: "normal", gender: "male" },
        }),
      ),
    ];

    const state = reduce(world, inputs);
    const again = reduce(world, inputs);

    expect(again.whereMet).toEqual(state.whereMet);
    expect(Object.keys(state.whereMet).length).toBeGreaterThan(3);
    for (const speciesId of ["gastly", "machop", "psyduck"]) {
      expect(state.whereMet[speciesId]).toBeDefined();
    }
  });

  /**
   * Two logs can end holding the same creatures having found them in different
   * places. That is the whole reason this is in the hash rather than left out
   * of it as merely derived.
   */
  it("N8: two states that met the same thing elsewhere hash differently", () => {
    const world = testWorld("NOTE1");
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    // Identical in every other respect: the same party, the same position, the
    // same everything. Only where it was found differs, which is exactly the
    // case a hash of the party alone cannot tell apart.
    const here: GameState = { ...base, whereMet: { ...base.whereMet, magikarp: "hub-0" } };
    const there: GameState = { ...base, whereMet: { ...base.whereMet, magikarp: "meadow-1" } };

    expect(stateHash(here)).not.toBe(stateHash(there));
    expect(stateHash(here)).toBe(stateHash({ ...here }));
  });
});

describe("reading them back", () => {
  it("N9: grouped by place, ordered outward, dex order within", () => {
    const world = testWorld("NOTE2");
    const { state } = play(world, 12000);
    const notes = fieldNotes(world, state);

    expect(notes.length).toBeGreaterThan(0);

    // Every species accounted for exactly once.
    const flat = notes.flatMap((one) => one.speciesIds);
    expect(flat.length).toBe(Object.keys(state.whereMet).length);
    expect(new Set(flat).size).toBe(flat.length);

    // Places run outward.
    const depth = (id: string) => world.routes.get(id)?.depth ?? 9999;
    const depths = notes.map((one) => depth(one.routeId));
    expect([...depths].sort((a, b) => a - b)).toEqual(depths);

    // And no note carries a denominator. A record of where you looked is not a
    // checklist of where to look.
    for (const note of notes) {
      expect(Object.keys(note)).toEqual(["routeId", "speciesIds"]);
    }
  });

  it("N10: an empty record reads as no places rather than throwing", () => {
    const world = testWorld("NOTE1");
    expect(fieldNotes(world, initialState(world))).toEqual([]);
  });

  it("N11: a place nothing knows about still lists what was met there", () => {
    const world = testWorld("NOTE1");
    const state: GameState = {
      ...initialState(world),
      whereMet: { pidgey: "nowhere-at-all", rattata: "hub-0" },
    };

    const notes = fieldNotes(world, state);
    expect(notes.map((one) => one.routeId).sort()).toEqual(["hub-0", "nowhere-at-all"]);
  });
});

describe("every road to a battle writes it down", () => {
  /**
   * The one that matters, and the reason the fold is outermost in the funnel.
   *
   * The rival's battle is started from inside `followed`, which runs after the
   * input has been applied. A record folded any further in would miss the one
   * opponent in this game you are not allowed to walk away from.
   */
  it("N12: a battle started by the funnel itself is still noted", () => {
    const world = testWorld("NOTE3");
    let live = step(world, walking(world, 3));

    // Anything that is not him is run from and the walk goes on: what is under
    // test is that his team is written down, not what else lives out there.
    let foes: string[] = [];
    for (let n = 0; n < 600 && !foes.length; n++) {
      if (live.phase === "battle" && live.battle?.tag.startsWith("rival:")) {
        foes = live.battle.sides[1].team.map((one) => one.speciesId);
        break;
      }
      if (live.phase === "battle") {
        live = applyInput(world, live, { t: "flee" });
        continue;
      }
      if (live.phase === "battleEnd") {
        live = applyInput(world, live, { t: "continue" });
        continue;
      }
      live = step(world, live);
    }

    expect(foes.length, "the rival never caught up").toBeGreaterThan(0);
    for (const speciesId of foes) {
      expect(
        live.whereMet[speciesId],
        `${speciesId} was fought and not written down`,
      ).toBeDefined();
    }
  });
});
