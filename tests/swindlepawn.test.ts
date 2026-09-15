import { describe, expect, it } from "vitest";
import {
  applyInput,
  initialState,
  offerRefusal,
  PAWN_COOLDOWN,
  pawnRefusal,
  type GameState,
} from "@/engine/engine";
import { dialogueOf, NPCS } from "@/engine/npc";
import { creature, testWorld } from "./helpers";

/**
 * Two people in town: one who promises a Mew and hands over a Metapod, and a
 * pawnbroker who buys a creature for fifty a level and then needs a long walk
 * before he buys another.
 */
describe("the swindler and the pawnbroker", () => {
  const world = testWorld("PKMFEVER1");
  const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

  const standingBy = (id: string, state: GameState): GameState => {
    const [routeId, people] = [...world.npcs.entries()].find(([, list]) => list.some((one) => one.id === id))!;
    const person = people.find((one) => one.id === id)!;
    return { ...state, route: routeId, x: person.x, y: person.y + 1, talking: id };
  };

  it("SW1: he shows a level 1 Mew, takes a level 10 Pikachu, and hands over a Metapod called Mew", () => {
    const spec = NPCS.find((one) => one.id === "trade-swindler")!;
    expect(spec.gives).toMatchObject({ speciesId: "mew", level: 1 });
    expect(dialogueOf({ ...spec, x: 0, y: 0, route: "" }).join(" ")).toContain("Mew");

    const pikachu = creature("pikachu", { uid: 600, level: 10 });
    const state = standingBy("trade-swindler", { ...base, party: [...base.party, pikachu] });
    expect(offerRefusal(world, state)).toBeNull();

    const conned = applyInput(world, state, { t: "npcTrade", index: 1 });
    const got = conned.party[1];
    expect(got.speciesId).toBe("metapod");
    expect(got.level).toBe(1);
    expect(got.nickname).toBe("Mew");
    expect(conned.party.some((one) => one.speciesId === "pikachu")).toBe(false);
    expect(conned.notice).toMatchObject({ t: "swindled", promised: "Mew", got: "Metapod", given: "Pikachu" });

    // And he has a different tune once he has had you.
    expect(dialogueOf({ ...spec, x: 0, y: 0, route: "" }, true).join(" ")).toContain("No refunds");
  });

  it("SW2: a Pikachu below level 10 will not do", () => {
    const state = standingBy("trade-swindler", { ...base, party: [...base.party, creature("pikachu", { uid: 601, level: 9 })] });
    expect(offerRefusal(world, state)).not.toBeNull();
  });

  it("PB1: the pawnbroker pays fifty a level, gives back the held item, and waits 1200 steps", () => {
    const seller = creature("rattata", { uid: 700, level: 23, heldItem: "berry-oran" });
    const state = standingBy("pawn-broker", { ...base, party: [...base.party, seller] });
    const sold = applyInput(world, state, { t: "pawn", index: 1, confirm: 700 });
    expect(sold.money).toBe(state.money + 23 * 50);
    expect(sold.party.some((one) => one.uid === 700)).toBe(false);
    expect(sold.bag["berry-oran"]).toBe((state.bag["berry-oran"] ?? 0) + 1);
    expect(sold.notice).toMatchObject({ t: "pawned", level: 23, money: 1150 });

    const again = { ...sold, party: [...sold.party, creature("pidgey", { uid: 701, level: 5 })] };
    expect(pawnRefusal(world, again, 1, 701)).toContain("steps");
    const later = { ...again, stepsTaken: again.stepsTaken + PAWN_COOLDOWN };
    expect(pawnRefusal(world, later, 1, 701)).toBeNull();
  });

  it("PB2: every step on the map counts towards his clock", () => {
    let state = base;
    for (let i = 0; i < 6; i++) state = applyInput(world, state, { t: "move", dir: i % 2 === 0 ? "n" : "s" });
    expect(state.stepsTaken).toBe(6);
  });
});
