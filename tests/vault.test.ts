import { describe, expect, it } from "vitest";
import { applyInput, initialState, reduce, VAULT_LEVEL, vaultArrival, type Input } from "@/engine/engine";
import { ENGINE_VERSION } from "@/engine/types";
import { encodeSave, makeSave, parseAnySave } from "@/lib/save";
import { verifySave } from "@/lib/verify";
import { entriesFromRun, entriesFromSave, entriesFromVaultFile, mergeEntries, rosterOf, vaultFile } from "@/lib/vault";
import { effortSpent } from "@/engine/effort";
import { creature, testWorld } from "./helpers";

describe("the vault", () => {
  const world = testWorld("VAULT1");
  const inputs: Input[] = [
    { t: "trainer", name: "Ash" },
    { t: "pickStarter", index: 0 },
  ];

  it("VT1: a vault creature arrives at level 5 with no EVs, keeping IVs, abilities, item and look, tagged Vault", () => {
    const original = {
      ...creature("dragonite", { uid: 40, level: 88, abilities: ["hardworker", "notreal"], heldItem: "hold-leftovers" }),
      ivs: { hp: 31, atk: 30, def: 29, spa: 28, spd: 27, spe: 99 },
      evs: { hp: 252, atk: 252, def: 6, spa: 0, spd: 0, spe: 0 },
      variantId: "shiny",
      natureId: "adamant",
      caughtBy: "Misty",
    };
    const arrived = vaultArrival(original, 1);
    expect(arrived.level).toBe(VAULT_LEVEL);
    expect(Object.values(arrived.evs).every((ev) => ev === 0)).toBe(true);
    expect(arrived.ivs).toEqual({ hp: 31, atk: 30, def: 29, spa: 28, spd: 27, spe: 31 });
    expect(arrived.abilities).toEqual(["hardworker"]);
    expect(arrived.heldItem).toBe("hold-leftovers");
    expect(arrived.variantId).toBe("shiny");
    expect(arrived.natureId).toBe("adamant");
    expect(arrived.caughtBy).toBe("Misty");
    expect(arrived.vault).toBe(true);
    expect(arrived.moves.length).toBeGreaterThan(0);
    expect(arrived.hp).toBeGreaterThan(0);
  });

  it("VT2: a Vault Adventure begins with the copy instead of a starter, replays, and verify says so", () => {
    const pick = creature("dratini", { uid: 7, level: 40 });
    const log: Input[] = [{ t: "trainer", name: "Ash" }, { t: "vaultStart", creature: pick }];
    const state = reduce(world, log);
    expect(state.phase).toBe("field");
    expect(state.party).toHaveLength(1);
    expect(state.party[0]).toMatchObject({ speciesId: "dratini", level: 5, vault: true });
    expect(() => applyInput(world, state, { t: "vaultStart", creature: pick })).toThrow();

    const report = verifySave(makeSave("VAULT1", log));
    expect(report.ok).toBe(true);
    expect(report.vaultStart?.speciesId).toBe("dratini");
    expect(report.party[0].vault).toBe(true);
  });

  it("VT2b: a team of them sets out together, and three is the most it can be", () => {
    const three = [
      creature("dratini", { uid: 7, level: 40 }),
      creature("larvitar", { uid: 8, level: 55 }),
      creature("gible", { uid: 9, level: 30 }),
    ];
    const team = reduce(world, [
      { t: "trainer", name: "Ash" },
      { t: "vaultStart", creature: three[0], creatures: three },
    ]);
    expect(team.party).toHaveLength(3);
    expect(team.party.map((one) => one.speciesId)).toEqual(["dratini", "larvitar", "gible"]);
    // Every one of them reset and marked, exactly as one of them always was.
    for (const one of team.party) {
      expect(one.level).toBe(5);
      expect(one.vault).toBe(true);
      expect(effortSpent(one.evs)).toBe(0);
    }
    // And their uids do not collide.
    expect(new Set(team.party.map((one) => one.uid)).size).toBe(3);

    // A fourth is refused, and the old shape still means what it meant.
    expect(() =>
      reduce(world, [
        { t: "trainer", name: "Ash" },
        { t: "vaultStart", creature: three[0], creatures: [...three, creature("bagon", { uid: 10 })] },
      ]),
    ).toThrow();
    expect(reduce(world, [{ t: "trainer", name: "Ash" }, { t: "vaultStart", creature: three[0] }]).party).toHaveLength(1);
  });

  it("VT3: adding a save replays it, and a later save of the same run updates instead of duplicating", () => {
    const early = entriesFromSave(encodeSave(makeSave("VAULT1", inputs, undefined, "RUN-A")));
    if ("error" in early) throw new Error(early.error);
    expect(early.entries).toHaveLength(1);
    expect(early.entries[0].proven).toBe(true);

    const later = [...inputs, ...Array.from({ length: 30 }, (_, i): Input => ({ t: "move", dir: i % 2 ? "n" : "s" }))];
    const again = entriesFromSave(encodeSave(makeSave("VAULT1", later, undefined, "RUN-A")));
    if ("error" in again) throw new Error(again.error);
    const merged = mergeEntries(early.entries, again.entries);
    expect(merged.added).toBe(0);
    expect(merged.updated).toBe(1);
    expect(merged.vault).toHaveLength(1);

    // The live run names itself the same way.
    const live = entriesFromRun("VAULT1", later, reduce(world, later), "RUN-A");
    expect(live.map((one) => one.id)).toEqual(again.entries.map((one) => one.id));

    // Another run on the same seed, starting the same way, is a different run.
    const other = entriesFromSave(encodeSave(makeSave("VAULT1", inputs, undefined, "RUN-B")));
    if ("error" in other) throw new Error(other.error);
    expect(mergeEntries(merged.vault, other.entries).added).toBe(1);
  });

  it("VT4: a save from another engine version is read from its roster snapshot, unproven", () => {
    const state = reduce(world, inputs);
    const saved = JSON.parse(encodeSave(makeSave("VAULT1", inputs, rosterOf(state))));
    const older = JSON.stringify({ ...saved, v: ENGINE_VERSION - 1 });
    expect(parseAnySave(older)?.inputs).toBeNull();
    const read = entriesFromSave(older);
    if ("error" in read) throw new Error(read.error);
    expect(read.entries).toHaveLength(1);
    expect(read.entries[0].proven).toBe(false);

    const bare = JSON.stringify({ ...saved, v: ENGINE_VERSION - 1, roster: undefined });
    expect(entriesFromSave(bare)).toHaveProperty("error");
  });

  it("VT5: a vault file round-trips, and comes back unproven", () => {
    const read = entriesFromSave(encodeSave(makeSave("VAULT1", inputs)));
    if ("error" in read) throw new Error(read.error);
    const back = entriesFromVaultFile(vaultFile(read.entries))!;
    expect(back.map((one) => one.id)).toEqual(read.entries.map((one) => one.id));
    expect(back.every((one) => !one.proven)).toBe(true);
    expect(entriesFromVaultFile("{\"kind\":\"nope\"}")).toBeNull();
    expect(initialState(world).phase).toBe("starter");
  });
});
