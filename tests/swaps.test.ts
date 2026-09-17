import { describe, expect, it } from "vitest";
import { ABILITIES, swappedType } from "@/engine/abilities";
import { landsAs, resolveTurn, startBattle, TRAINER_RULES } from "@/engine/battle";
import { creature } from "./helpers";

/**
 * The swaps: two types trade places on its own attacks.
 */

const SWAPS = ABILITIES.filter((spec) => spec.effect.t === "swap");

describe("the swaps", () => {
  it("SW1: fifteen of them, each a different pair of two different types", () => {
    expect(SWAPS).toHaveLength(15);
    const pairs = new Set(
      SWAPS.map((spec) => {
        if (spec.effect.t !== "swap") throw new Error("not a swap");
        const [first, second] = spec.effect.types;
        expect(first).not.toBe(second);
        return [first, second].sort().join("/");
      }),
    );
    expect(pairs.size).toBe(15);
    expect(ABILITIES.find((spec) => spec.name === "Green Fire")?.id).toBe("swap-greenfire");
  });

  it("SW2: Green Fire turns Grass into Fire and Fire into Grass, and leaves Water alone", () => {
    const green = ["swap-greenfire"];
    expect(swappedType(green, "grass")).toBe("fire");
    expect(swappedType(green, "fire")).toBe("grass");
    expect(swappedType(green, "water")).toBe("water");
    expect(swappedType([], "grass")).toBe("grass");
  });

  it("SW3: in battle a swapped attack lands as its new type", () => {
    // A Grass move into a Fire type is resisted; swapped to Fire it is resisted still,
    // but into a Grass type the swap turns "resisted" into "super effective".
    const plain = creature("bulbasaur", { uid: 1, level: 50, moves: ["vinewhip"] });
    const swapped = { ...plain, abilities: ["swap-greenfire"] };
    const grassFoe = creature("oddish", { uid: 2, level: 50, moves: ["splash"] });

    expect(landsAs(plain, grassFoe, "vinewhip")).toBeLessThan(4);
    expect(landsAs(swapped, grassFoe, "vinewhip")).toBeGreaterThan(4);

    const hit = (attacker: typeof plain) => {
      const battle = startBattle("SWAP1", "trainer:swap", [attacker], [grassFoe]);
      const after = resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], TRAINER_RULES).battle;
      return after.events.find((event) => event.t === "damage" && event.side === 1);
    };
    const normal = hit(plain);
    const turned = hit(swapped);
    expect(normal && normal.t === "damage" && normal.quarters).toBeLessThan(4);
    expect(turned && turned.t === "damage" && turned.quarters).toBeGreaterThan(4);
  });

  it("SW4: status moves are not attacks: the move menu has nothing to promise for them either way", () => {
    const user = { ...creature("pikachu", { uid: 1, level: 50, moves: ["thunderwave"] }), abilities: ["swap-frozenspark"] };
    const foe = creature("sandshrew", { uid: 2, level: 50, moves: ["splash"] });
    expect(landsAs(user, foe, "thunderwave")).toBeNull();
  });
});
