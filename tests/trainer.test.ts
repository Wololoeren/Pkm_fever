import { describe, expect, it } from "vitest";
import {
  applyInput,
  initialState,
  reduce,
  stateHash,
  TRAINER_NAME_MAX,
  trainerRefusal,
  type Input,
} from "@/engine/engine";
import { creature, testWorld } from "./helpers";

/**
 * Trainer names, and "caught by".
 *
 * The name is an input like any other, so it is in the save and replays. The
 * engine signs everything of yours that nobody has signed, whatever road it
 * came by; what arrives already signed — a trade, a gift from somebody in the
 * world — keeps the signature it came with.
 */
describe("trainer names", () => {
  const world = testWorld("TRAINER1");

  it("TR1: the name goes on the starter and on everything that joins after", () => {
    const named = applyInput(world, initialState(world), { t: "trainer", name: "  Ash  " });
    expect(named.trainerName).toBe("Ash");

    const started = applyInput(world, named, { t: "pickStarter", index: 0 });
    expect(started.party[0].caughtBy).toBe("Ash");

    const withSpare = { ...started, party: [...started.party, creature("rattata", { uid: 70 })] };
    const stored = applyInput(world, withSpare, { t: "store", index: 1 });
    expect(stored.box[0].caughtBy).toBe("Ash");
  });

  it("TR2: once only, and never empty", () => {
    const named = applyInput(world, initialState(world), { t: "trainer", name: "Ash" });
    expect(trainerRefusal(named, "Misty")).toBe("you already have a trainer name");
    expect(() => applyInput(world, named, { t: "trainer", name: "Misty" })).toThrow();
    expect(trainerRefusal(initialState(world), "   ")).not.toBeNull();
    expect(applyInput(world, initialState(world), { t: "trainer", name: "A".repeat(40) }).trainerName).toHaveLength(TRAINER_NAME_MAX);
  });

  it("TR3: a save that chooses a name late has everything already caught signed at once", () => {
    const started = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    const boxed = { ...started, box: [creature("pidgey", { uid: 80 })] };
    expect(started.party[0].caughtBy).toBeUndefined();

    const named = applyInput(world, boxed, { t: "trainer", name: "Brock" });
    expect(named.party[0].caughtBy).toBe("Brock");
    expect(named.box[0].caughtBy).toBe("Brock");
  });

  it("TR4: a creature that arrives signed keeps its signature", () => {
    const named = applyInput(world, initialState(world), { t: "trainer", name: "Ash" });
    const started = applyInput(world, named, { t: "pickStarter", index: 0 });
    const stranger = { ...creature("pidgey", { uid: 90 }), caughtBy: "Gary" };
    const kept = applyInput(world, { ...started, box: [stranger] }, { t: "addBox" });
    expect(kept.box[0].caughtBy).toBe("Gary");
  });

  it("TR5: the name replays, and does not change what the game hashes to", () => {
    const inputs = (name: string): Input[] => [
      { t: "trainer", name },
      { t: "pickStarter", index: 0 },
    ];
    const ash = reduce(world, inputs("Ash"));
    const misty = reduce(world, inputs("Misty"));
    expect(ash.party[0].caughtBy).toBe("Ash");
    expect(misty.party[0].caughtBy).toBe("Misty");
    // Two people on today's seed compare hashes whatever they are called.
    expect(stateHash(ash)).toBe(stateHash(misty));
  });
});
