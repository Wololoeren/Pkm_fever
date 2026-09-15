import { describe, expect, it } from "vitest";
import {
  applyInput,
  initialState,
  workshopLeaveRefusal,
  type GameState,
} from "@/engine/engine";
import { expForLevel } from "@/engine/progression";
import { creature, testWorld } from "./helpers";

/**
 * The workshop: an Ice type makes ice cream, a Fire type roasts chickens and a
 * Water type waters the plants, each gaining one experience per step — levels,
 * but no new moves and no evolving.
 */
describe("the workshop", () => {
  const world = testWorld("PKMFEVER1");
  const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  const [routeId, people] = [...world.npcs.entries()].find(([, list]) => list.some((one) => one.id === "workshop-foreman"))!;
  const foreman = people.find((one) => one.id === "workshop-foreman")!;
  const atBench = (state: GameState): GameState => ({ ...state, route: routeId, x: foreman.x, y: foreman.y + 1, talking: "workshop-foreman" });

  /** Steps, anywhere: walking back and forth on the starting route. */
  const walk = (state: GameState, steps: number): GameState => {
    let now: GameState = { ...state, route: base.route, x: base.x, y: base.y, talking: null };
    for (let i = 0; i < steps; i++) now = applyInput(world, now, { t: "move", dir: i % 2 === 0 ? "n" : "s" });
    return now;
  };

  it("WS1: each job takes only its own type", () => {
    const party = [...base.party, creature("charmander", { uid: 800, level: 10 }), creature("squirtle", { uid: 801, level: 10 })];
    const state = atBench({ ...base, party });
    expect(workshopLeaveRefusal(world, state, "fire", 1, 800)).toBeNull();
    expect(workshopLeaveRefusal(world, state, "ice", 1, 800)).toContain("ice type");
    expect(workshopLeaveRefusal(world, state, "water", 2, 801)).toBeNull();
  });

  it("WS2: one experience per step, a level when it adds up, no new moves and no evolution", () => {
    // A Charmander one point short of level 16, which is both a Charmeleon and
    // a new move away.
    const chef = creature("charmander", { uid: 810, level: 15, moves: ["scratch"] });
    const nearly = { ...chef, exp: expForLevel(16) - 1 };
    const left = applyInput(world, atBench({ ...base, party: [...base.party, nearly] }), {
      t: "workshopLeave",
      station: "fire",
      index: 1,
      confirm: 810,
    });
    expect(left.party.some((one) => one.uid === 810)).toBe(false);
    expect(left.notice).toMatchObject({ t: "workshopLeft", station: "fire" });

    const walked = walk(left, 5);
    const working = walked.workshop.fire!.creature;
    expect(working.exp).toBe(expForLevel(16) + 4);
    expect(working.level).toBe(16);
    expect(working.speciesId).toBe("charmander");
    expect(working.moves).toEqual(["scratch"]);
    expect(walked.pendingEvolutions).toEqual(left.pendingEvolutions);
    expect(walked.pendingMoves).toEqual(left.pendingMoves);

    const back = applyInput(world, atBench(walked), { t: "workshopTake", station: "fire" });
    expect(back.workshop.fire).toBeUndefined();
    const home = back.party.find((one) => one.uid === 810)!;
    expect(home.level).toBe(16);
    expect(home.speciesId).toBe("charmander");
    expect(back.notice).toMatchObject({ t: "workshopTaken", levels: 1, boxed: false });
  });

  it("WS3: one per job, and the last one that can fight stays with you", () => {
    const party = [creature("lapras", { uid: 820, level: 20 })];
    expect(workshopLeaveRefusal(world, atBench({ ...base, party }), "ice", 0, 820)).toContain("keep something");
  });
});
