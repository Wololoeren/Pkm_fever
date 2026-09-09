import { describe, expect, it } from "vitest";
import { resolveTurn, startBattle, DUEL_RULES, WILD_RULES } from "@/engine/battle";
import { species } from "@/engine/dex";
import { effortFull, effortSpent, effortYield, gainEffort } from "@/engine/effort";
import { applyInput, initialState, partyOrderRefusal, reduce, stateHash } from "@/engine/engine";
import { computeStats, EV_MAX_PER_STAT, EV_MAX_TOTAL } from "@/engine/stats";
import { STAT_IDS, type StatTable } from "@/engine/types";
import { creature, testWorld } from "./helpers";

/**
 * Effort, and the party order.
 *
 * Effort is the half of a creature a player chooses: IVs are inherited and
 * bred, effort is earned by picking what to fight. Both caps live in the
 * engine rather than the display, because a creature carrying more than it
 * should would compute one set of numbers and replay as another.
 */

const zero = (): StatTable => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });

describe("what a species is worth", () => {
  it("E1: yield goes to what the species is best at", () => {
    // Machop is an attacker; Shuckle is famously two defences and nothing else.
    expect(effortYield("machop").stats).toEqual(["atk"]);
    expect(effortYield("shuckle").stats.slice().sort()).toEqual(["def", "spd"]);
  });

  it("E2: stronger species are worth more", () => {
    expect(effortYield("caterpie").amount).toBe(1);
    expect(effortYield("machamp").amount).toBe(3);
    expect(effortYield("caterpie").amount).toBeLessThan(effortYield("machoke").amount);
  });

  it("E3: every species yields something, in a real stat", () => {
    for (const id of ["ditto", "shedinja", "magikarp", "wobbuffet", "arceus"]) {
      const yielded = effortYield(id);
      expect(yielded.amount).toBeGreaterThan(0);
      expect(yielded.stats.length).toBeGreaterThan(0);
      for (const stat of yielded.stats) expect(STAT_IDS).toContain(stat);
    }
  });
});

describe("earning it", () => {
  it("E4: effort accumulates in the stat that was fought", () => {
    let evs = zero();
    for (let i = 0; i < 10; i++) evs = gainEffort(evs, effortYield("machop"));
    expect(evs.atk).toBe(10);
    expect(evs.hp).toBe(0);
  });

  it("E5: the per-stat cap holds, and overflow is not earned elsewhere", () => {
    let evs = { ...zero(), atk: EV_MAX_PER_STAT - 1 };
    evs = gainEffort(evs, { stats: ["atk"], amount: 3 });
    expect(evs.atk).toBe(EV_MAX_PER_STAT);

    // Not spilled into another stat, and not exceeded by trying again.
    evs = gainEffort(evs, { stats: ["atk"], amount: 3 });
    expect(evs.atk).toBe(EV_MAX_PER_STAT);
    expect(effortSpent(evs)).toBe(EV_MAX_PER_STAT);
  });

  it("E6: the total cap holds across stats", () => {
    let evs = { ...zero(), hp: EV_MAX_PER_STAT, atk: EV_MAX_PER_STAT };
    expect(effortSpent(evs)).toBe(504);

    // Six left before the wall, then nothing.
    evs = gainEffort(evs, { stats: ["spe"], amount: 3 });
    evs = gainEffort(evs, { stats: ["spe"], amount: 3 });
    expect(effortSpent(evs)).toBe(EV_MAX_TOTAL);

    evs = gainEffort(evs, { stats: ["spe"], amount: 3 });
    expect(effortSpent(evs)).toBe(EV_MAX_TOTAL);
    expect(effortFull({ ...creature("machop"), evs })).toBe(true);
  });

  it("E7: effort changes the stats it is spent on, and only those", () => {
    const plain = creature("machop", { level: 50, iv: 0 });
    const trained = { ...plain, evs: { ...zero(), atk: EV_MAX_PER_STAT } };

    const before = computeStats(species("machop"), plain);
    const after = computeStats(species("machop"), trained);

    // 252 effort is 63 raw, which at level 50 is 31 stat points.
    expect(after.atk).toBe(before.atk + 31);
    expect(after.def).toBe(before.def);
    expect(after.spe).toBe(before.spe);
  });

  it("E8: beating something in battle actually pays it", () => {
    const mine = creature("machamp", { uid: 1, level: 60, moves: ["karatechop"] });
    const theirs = creature("machop", { uid: 2, level: 3, moves: ["tackle"] });

    let battle = startBattle("SEED", "wild:test:0", [mine], [theirs]);
    for (let i = 0; i < 20 && !battle.outcome; i++) {
      battle = resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], WILD_RULES).battle;
    }

    expect(battle.outcome?.t).toBe("win");
    // Machop yields Attack, so that is where it landed.
    const victor = battle.sides[0].team[0];
    expect(victor.evs.atk).toBeGreaterThan(0);
    expect(victor.evs.def).toBe(0);
  });

  it("E9: a duel pays no effort, because a duel pays nothing", () => {
    const mine = creature("machamp", { uid: 1, level: 60, moves: ["karatechop"] });
    const theirs = creature("machop", { uid: 2, level: 3, moves: ["tackle"] });

    let battle = startBattle("SEED", "duel:test", [mine], [theirs]);
    for (let i = 0; i < 20 && !battle.outcome; i++) {
      battle = resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], DUEL_RULES).battle;
    }

    expect(battle.outcome?.t).toBe("win");
    expect(effortSpent(battle.sides[0].team[0].evs)).toBe(0);
  });
});

describe("party order", () => {
  function walked() {
    const world = testWorld("PKMFEVER1");
    let state = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    state = {
      ...state,
      party: [
        creature("machop", { uid: 1 }),
        creature("bulbasaur", { uid: 2 }),
        creature("oddish", { uid: 3 }),
      ],
    };
    return { world, state };
  }

  it("O1: moving a member reorders the party and nothing else", () => {
    const { world, state } = walked();
    const moved = applyInput(world, state, { t: "reorderParty", from: 2, to: 0 });

    expect(moved.party.map((c) => c.uid)).toEqual([3, 1, 2]);
    expect(moved.party.length).toBe(state.party.length);
  });

  it("O2: it works in both directions and is its own inverse", () => {
    const { world, state } = walked();
    const down = applyInput(world, state, { t: "reorderParty", from: 0, to: 2 });
    expect(down.party.map((c) => c.uid)).toEqual([2, 3, 1]);

    const back = applyInput(world, down, { t: "reorderParty", from: 2, to: 0 });
    expect(back.party.map((c) => c.uid)).toEqual(state.party.map((c) => c.uid));
  });

  it("O3: the refusal says why, and the engine agrees with it", () => {
    const { world, state } = walked();

    expect(partyOrderRefusal(state, 0, 9)).toBe("no such slot");
    expect(partyOrderRefusal(state, -1, 0)).toBe("no such slot");
    expect(partyOrderRefusal(state, 1, 1)).toBe("already there");
    expect(partyOrderRefusal(state, 0, 1)).toBeNull();

    // One predicate, two callers: whatever the panel greys out, the engine
    // refuses, and for the same stated reason.
    for (const [from, to] of [
      [0, 9],
      [-1, 0],
      [1, 1],
    ] as const) {
      expect(() => applyInput(world, state, { t: "reorderParty", from, to })).toThrow();
    }
  });

  it("O4: not in the middle of a battle, because that would be a free switch", () => {
    const { world, state } = walked();
    const fighting = { ...state, phase: "battle" as const };
    expect(partyOrderRefusal(fighting, 0, 1)).toBe("not in the middle of a battle");
    expect(() => applyInput(world, fighting, { t: "reorderParty", from: 0, to: 1 })).toThrow();
  });

  it("O5: it goes through the log, so a reordered party replays", () => {
    // A second party member is put there deliberately rather than hoped for
    // from the walk: whether 200 steps happens to catch something depends on
    // the shape of the maps, and this test is about the log, not about that.
    const world = testWorld("PKMFEVER1");
    const inputs = [
      { t: "pickStarter" as const, index: 0 },
      {
        t: "cheat" as const,
        cheat: { op: "give" as const, speciesId: "machop", level: 20, variantId: "normal", gender: "male" as const },
      },
      { t: "reorderParty" as const, from: 0, to: 1 },
    ];

    const once = reduce(world, inputs);
    expect(once.party.length).toBe(2);
    expect(once.party[0].speciesId).toBe("machop");
    expect(stateHash(reduce(world, inputs))).toBe(stateHash(once));
  });
});
