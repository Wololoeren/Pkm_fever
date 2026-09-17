import { describe, expect, it } from "vitest";
import { bagUse, item } from "@/engine/items";
import { NPCS } from "@/engine/npc";
import { passesThrough } from "@/engine/world";
import { walkable } from "@/engine/terrain";
import { testWorld } from "./helpers";

/**
 * The Pokémon Handbook, and where things are left lying about.
 */

describe("the Pokémon Handbook", () => {
  it("HB1: a key item you open from the bag", () => {
    const book = item("handbook");
    expect(book.kind).toBe("key");
    expect(book.price).toBe(0);
    expect(bagUse(book)).toBe("read");
  });

  it("HB2: the Librarian in Hearth hands it over", () => {
    const librarian = NPCS.find((entry) => entry.id === "gift-librarian");
    expect(librarian?.kind).toBe("gift");
    expect(librarian?.item).toBe("handbook");

    for (const seed of ["BOOK1", "BOOK2"]) {
      const world = testWorld(seed);
      const where = [...world.npcs].find(([, here]) => here.some((one) => one.id === "gift-librarian"));
      expect(where?.[0], seed).toBe("hub-0");
    }
  });
});

describe("where things are left lying about", () => {
  it("HB3: nothing lies on a door, an exit, a crossing or the way in — it could never be picked up", () => {
    for (const seed of ["DOORS1", "DOORS2", "DOORS3", "A1", "Z4J5P5"]) {
      const world = testWorld(seed);
      for (const [routeId, lying] of world.pickups) {
        const route = world.routes.get(routeId)!;
        for (const drop of lying) {
          expect(passesThrough(route, drop.x, drop.y), `${seed} ${drop.id} at ${drop.x},${drop.y}`).toBe(false);
          expect(walkable(route.tiles[drop.y * route.width + drop.x]), `${seed} ${drop.id}`).toBe(true);
        }
      }
    }
  });
});
