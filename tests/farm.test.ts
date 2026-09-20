import { describe, expect, it } from "vitest";
import {
  applyInput,
  farmCollectRefusal,
  farmLeaveRefusal,
  farmPlantRefusal,
  farmTakeRefusal,
  initialState,
  type GameState,
} from "@/engine/engine";
import {
  basketCount,
  farmEvery,
  farmLeft,
  farmWorking,
  ALL_BERRIES,
  FARM_BASE,
  FARM_BEDS,
  FARM_FASTEST,
  FARM_YIELD,
} from "@/engine/farm";
import { creature, testWorld } from "./helpers";

/**
 * The berry farm: three jobs, five beds, and a basket that fills while you
 * walk and waits until you come for it.
 */

const SEED = "FARM1";

/** Standing in front of Old Pell with a crew that could work for him. */
function facing(extra: Partial<GameState> = {}): { world: ReturnType<typeof testWorld>; state: GameState } {
  const world = testWorld(SEED);
  const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  const [routeId, here] = [...world.npcs].find(([, people]) => people.some((one) => one.id === "berry-farmer"))!;
  const him = here.find((one) => one.id === "berry-farmer")!;
  return {
    world,
    state: {
      ...start,
      route: routeId,
      x: him.x,
      y: him.y + 1,
      talking: "berry-farmer",
      party: [
        creature("squirtle", { uid: 1, level: 20 }),
        creature("sandshrew", { uid: 2, level: 20 }),
        creature("oddish", { uid: 3, level: 20 }),
        creature("pidgey", { uid: 4, level: 20 }),
      ],
      ...extra,
    },
  };
}

/** Puts all three to work. */
function staffed(world: ReturnType<typeof testWorld>, state: GameState): GameState {
  let here = state;
  for (const [job, uid] of [["water", 1], ["ground", 2], ["grass", 3]] as const) {
    const index = here.party.findIndex((one) => one.uid === uid);
    here = applyInput(world, here, { t: "farmLeave", job, index, confirm: uid });
  }
  return here;
}

describe("the berry farm", () => {
  it("FM1: every job wants its own type, and nothing grows until all three are filled", () => {
    const { world, state } = facing();
    expect(farmWorking(state.farm)).toBe(false);
    expect(farmLeft(state.farm)).toBeNull();

    // A Flying type is no use on any of them.
    const bird = state.party.findIndex((one) => one.uid === 4);
    expect(farmLeaveRefusal(world, state, "water", bird, 4)).toBe("that job needs a water type");

    const one = applyInput(world, state, { t: "farmLeave", job: "water", index: 0, confirm: 1 });
    expect(one.party.map((each) => each.uid)).not.toContain(1);
    expect(one.farm.hands.water?.creature.uid).toBe(1);
    expect(farmLeaveRefusal(world, one, "water", 0, one.party[0].uid)).toBe("somebody is already on that job");
    expect(farmWorking(one.farm)).toBe(false);

    const all = staffed(world, state);
    expect(farmWorking(all.farm)).toBe(true);
    expect(all.party).toHaveLength(1);

    // And they can be fetched back.
    const back = applyInput(world, all, { t: "farmTake", job: "ground" });
    expect(back.party.map((each) => each.uid)).toContain(2);
    expect(farmTakeRefusal(world, back, "ground")).toBe("nobody is on that job");
  });

  it("FM2: the workers set the pace — the base less their levels, and never quicker than the floor", () => {
    const { world, state } = facing();
    const all = staffed(world, state);
    expect(farmEvery(all.farm)).toBe(FARM_BASE - 60);

    const strong = {
      ...all,
      farm: {
        ...all.farm,
        hands: {
          water: { creature: creature("squirtle", { uid: 1, level: 100 }) },
          ground: { creature: creature("sandshrew", { uid: 2, level: 100 }) },
          grass: { creature: creature("oddish", { uid: 3, level: 100 }) },
        },
      },
    };
    // Three level hundreds is 300 off the base, which is as quick as three
    // creatures can make it; the floor is there for a farm whose hands are
    // somehow better than that.
    expect(farmEvery(strong.farm)).toBe(FARM_BASE - 300);
    expect(farmEvery({ ...strong.farm, hands: { ...strong.farm.hands } })).toBeGreaterThanOrEqual(FARM_FASTEST);
  });

  it("FM3: it harvests while you walk, five at a time, and the basket piles up", () => {
    const { world, state } = facing({ bag: {} });
    const all = staffed(world, state);
    const every = farmEvery(all.farm);

    // A sitting with the feed is as good a walk as any.
    const scroll = (from: GameState, steps: number) =>
      applyInput(world, { ...from, talking: null, bag: { ...from.bag, doomscroller: 1 } }, { t: "doomscroll", steps });

    const nearly = scroll(all, 100);
    expect(basketCount(nearly.farm.basket)).toBe(0);
    expect(farmLeft(nearly.farm)).toBe(every - 100);

    // One more sitting, from just short of the harvest.
    const once = scroll({ ...nearly, farm: { ...nearly.farm, steps: every - 50 } }, 100);
    expect(basketCount(once.farm.basket)).toBe(FARM_YIELD);
    for (const id of Object.keys(once.farm.basket)) expect(ALL_BERRIES).toContain(id);

    // It piles up: nothing is pushed into the bag behind your back.
    const twice = scroll({ ...once, farm: { ...once.farm, steps: every - 50 } }, 100);
    expect(basketCount(twice.farm.basket)).toBe(FARM_YIELD * 2);
    expect(Object.keys(twice.bag).filter((id) => ALL_BERRIES.includes(id))).toHaveLength(0);

    // And then it is yours, all at once.
    const taken = applyInput(world, { ...twice, talking: "berry-farmer" }, { t: "farmCollect" });
    expect(basketCount(taken.farm.basket)).toBe(0);
    const held = Object.entries(taken.bag).filter(([id]) => ALL_BERRIES.includes(id));
    expect(held.reduce((sum, [, count]) => sum + count, 0)).toBe(FARM_YIELD * 2);
    expect(taken.notice).toMatchObject({ t: "harvest", berries: FARM_YIELD * 2 });
    expect(farmCollectRefusal(world, taken)).toBe("the basket is empty");
  });

  it("FM4: a planted bed grows what is in it; a fallow one grows anything at all", () => {
    const { world, state } = facing({ bag: { "berry-oran": 2 } });
    const all = staffed(world, state);

    expect(farmPlantRefusal(world, all, FARM_BEDS, "berry-oran")).toBe("no such bed");
    expect(farmPlantRefusal(world, all, 0, "potion")).toBe("that is not a berry");
    expect(farmPlantRefusal(world, all, 0, "berry-sitrus")).toBe("you have none of those");

    // Every bed the same, so every harvest is that berry whichever bed it rolls.
    let planted = all;
    for (let bed = 0; bed < FARM_BEDS; bed++) {
      planted = {
        ...planted,
        bag: { ...planted.bag, "berry-oran": 1 },
        farm: { ...planted.farm, beds: planted.farm.beds.map(() => null) },
      };
      planted = applyInput(world, planted, { t: "farmPlant", bed, item: "berry-oran" });
      planted = { ...planted, farm: { ...planted.farm, beds: all.farm.beds.map(() => "berry-oran") } };
    }
    // The berry is spent on the planting.
    expect(planted.bag["berry-oran"] ?? 0).toBe(0);

    const grown = applyInput(
      world,
      {
        ...planted,
        talking: null,
        bag: { ...planted.bag, doomscroller: 1 },
        farm: { ...planted.farm, steps: farmEvery(planted.farm) - 50 },
      },
      { t: "doomscroll", steps: 100 },
    );
    expect(grown.farm.basket).toEqual({ "berry-oran": FARM_YIELD });

    // Dug up, the bed is fallow again — and the berry stays in the ground.
    const dug = applyInput(world, { ...grown, talking: "berry-farmer" }, { t: "farmPlant", bed: 0, item: null });
    expect(dug.farm.beds[0]).toBeNull();
    expect(dug.bag["berry-oran"] ?? 0).toBe(0);
    expect(farmPlantRefusal(world, dug, 0, null)).toBe("that bed is already fallow");
  });
});
