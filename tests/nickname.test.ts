import { describe, expect, it } from "vitest";
import {
  applyInput,
  cleanNickname,
  initialState,
  NICKNAME_MAX,
  reduce,
  renameRefusal,
  stateHash,
  type Input,
} from "@/engine/engine";
import { displayName } from "@/lib/narrate";
import { creature, testWorld } from "./helpers";

/**
 * Nicknames.
 *
 * The field was always there — people in the world hand over creatures that
 * already have one — and every screen already reads it through `displayName`.
 * What these guard is the input that sets it: that it goes through the log,
 * that what is typed is tidied the same way on every machine, and that a name
 * is state a save hashes.
 */
describe("nicknames", () => {
  const world = testWorld("NICK1");
  const started = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

  it("NK1: renaming a party member is shown everywhere its name is", () => {
    const uid = started.party[0].uid;
    const named = applyInput(world, started, { t: "rename", uid, name: "Sprout" });
    expect(named.party[0].nickname).toBe("Sprout");
    expect(displayName(named.party[0])).toBe("Sprout");
    // A name is not state two players compare: it stays out of the hash.
    expect(stateHash(named)).toBe(stateHash(started));

    // An empty name takes it off again.
    const cleared = applyInput(world, named, { t: "rename", uid, name: "   " });
    expect(cleared.party[0].nickname).toBeNull();
  });

  it("NK2: a creature in the box can be renamed too", () => {
    const boxed = { ...started, box: [creature("pidgey", { uid: 77 })] };
    const named = applyInput(world, boxed, { t: "rename", uid: 77, name: "Hedwig" });
    expect(named.box[0].nickname).toBe("Hedwig");
  });

  it("NK3: what is typed is tidied, and cut to the limit", () => {
    expect(cleanNickname("  Big   Tom  ", "pidgey")).toBe("Big Tom");
    expect(cleanNickname("a\u0000b\u200Bc", "pidgey")).toBe("abc");
    expect(cleanNickname("ABCDEFGHIJKLMNOP", "pidgey")).toHaveLength(NICKNAME_MAX);
    // Its own species name is no nickname at all.
    expect(cleanNickname("Pidgey", "pidgey")).toBeNull();
  });

  it("NK4: refused for nobody, and in the middle of a battle", () => {
    expect(renameRefusal(started, 9999)).toBe("no such creature");
    expect(() => applyInput(world, started, { t: "rename", uid: 9999, name: "Ghost" })).toThrow();
    expect(renameRefusal({ ...started, phase: "battle" }, started.party[0].uid)).toBe(
      "not in the middle of a battle",
    );
  });

  it("NK5: a name replays from the log", () => {
    const inputs: Input[] = [
      { t: "pickStarter", index: 0 },
      { t: "rename", uid: started.party[0].uid, name: "Sprout" },
    ];
    const again = reduce(world, inputs);
    expect(again.party[0].nickname).toBe("Sprout");
  });
});
