import { afterEach, describe, expect, it, vi } from "vitest";
import { ABILITIES } from "@/engine/abilities";
import { turnServers, trysteroConfig } from "@/lib/relays";
import { testWorld } from "./helpers";

describe("the Master Ball, found", () => {
  it("MB1: exactly one lies in every world, on the outermost ring", () => {
    for (const seed of ["PKMFEVER1", "MASTER2"]) {
      const world = testWorld(seed);
      const found = [...world.pickups.entries()].flatMap(([routeId, drops]) =>
        drops.filter((drop) => drop.item === "masterball").map(() => routeId),
      );
      expect(found).toHaveLength(1);
      const outer = Math.max(...[...world.routes.values()].filter((r) => r.kind === "route").map((r) => r.ring));
      expect(world.routes.get(found[0])!.ring).toBe(outer);
    }
  });

  it("MB2: Ball Collector finds one half a percent of the time", () => {
    const spec = ABILITIES.find((one) => one.id === "ballcollector")!;
    expect(spec.effect).toMatchObject({ t: "forage", rare: { item: "masterball", perMille: 5 } });
    expect(spec.blurb).toContain("0.5%");
  });
});

describe("TURN servers for strict networks", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("MB3: none configured leaves the room config as it was", () => {
    vi.stubEnv("NEXT_PUBLIC_TURN_URLS", "");
    expect(turnServers()).toEqual([]);
    expect(trysteroConfig()).not.toHaveProperty("turnConfig");
  });

  it("MB4: configured ones are passed to every room", () => {
    vi.stubEnv("NEXT_PUBLIC_TURN_URLS", "turn:example.org:80, turns:example.org:443?transport=tcp");
    vi.stubEnv("NEXT_PUBLIC_TURN_USERNAME", "user");
    vi.stubEnv("NEXT_PUBLIC_TURN_CREDENTIAL", "secret");
    expect(trysteroConfig().turnConfig).toEqual([
      { urls: ["turn:example.org:80", "turns:example.org:443?transport=tcp"], username: "user", credential: "secret" },
    ]);
  });
});
