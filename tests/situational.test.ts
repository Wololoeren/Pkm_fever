import { describe, expect, it } from "vitest";
import {
  landsAs,
  maxHp,
  resolveTurn,
  startBattle,
  WILD_RULES,
  type BattleEvent,
  type BattleState,
  type SideIndex,
} from "@/engine/battle";
import type { Individual } from "@/engine/types";
import { creature } from "./helpers";

/**
 * Moves whose numbers depend on what is happening.
 *
 * The manifest carries one base power per move and Showdown works the rest out
 * in a callback, so each of these was a flat number whatever the situation.
 * Every comparison here holds the battle's tag and turn fixed, so the damage
 * roll and the critical roll are the same on both sides of it and the only
 * thing that differs is the situation under test.
 */

const SEED = "SITU1";
const TAG = "wild:situational:0";

function damageTo(events: readonly BattleEvent[], side: SideIndex): number {
  return events
    .filter((event): event is Extract<BattleEvent, { t: "damage" }> => event.t === "damage" && event.side === side)
    .reduce((total, event) => total + event.amount, 0);
}

/** One turn: ours uses its first move, theirs its first. Hands back the turn. */
function turnOf(ours: Individual, theirs: Individual, setup?: (battle: BattleState) => void): BattleState {
  const battle = startBattle(SEED, TAG, [ours], [{ ...theirs, uid: 2 }]);
  setup?.(battle);
  return resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }], WILD_RULES, 0).battle;
}

/** Damage ours dealt in that turn. */
function dealt(ours: Individual, theirs: Individual, setup?: (battle: BattleState) => void): number {
  return damageTo(turnOf(ours, theirs, setup).events, 1);
}

/** Two numbers the same situation apart should be about double, allowing for rounding. */
function aboutTimes(big: number, small: number, factor: number): void {
  expect(small, "the baseline did no damage, so nothing is being compared").toBeGreaterThan(5);
  // Within three percent: stat stages and the 3/2 steps round on the way.
  expect(big).toBeGreaterThanOrEqual(Math.floor(small * factor * 0.97) - 1);
  expect(big).toBeLessThanOrEqual(Math.ceil(small * factor * 1.03) + 1);
}

const wall = (extra: Partial<Individual> = {}) => ({
  ...creature("snorlax", { level: 50, moves: ["splash"], iv: 0 }),
  ...extra,
});

describe("power that reads the target", () => {
  it("SP1: Venoshock doubles on a poisoned target, Brine on one at half health", () => {
    const venoshock = creature("gengar", { level: 50, moves: ["venoshock"], iv: 0 });
    aboutTimes(dealt(venoshock, wall({ status: "psn" })), dealt(venoshock, wall()), 2);

    const brine = creature("lapras", { level: 50, moves: ["brine"], iv: 0 });
    const full = wall();
    aboutTimes(dealt(brine, { ...full, hp: Math.floor(maxHp(full) / 2) }), dealt(brine, full), 2);
  });

  it("SP2: Knock Off hits half again at something holding an item", () => {
    const knockoff = creature("absol", { level: 50, moves: ["knockoff"], iv: 0 });
    aboutTimes(dealt(knockoff, wall({ heldItem: "hold-leftovers" })), dealt(knockoff, wall()), 1.5);
  });

  it("SP3: Wake-Up Slap doubles on a sleeper and wakes it", () => {
    const slap = creature("machamp", { level: 25, moves: ["wakeupslap"], iv: 0 });
    const asleep = wall({ status: "slp", sleepTurns: 3 });
    aboutTimes(dealt(slap, asleep), dealt(slap, wall()), 2);
    const after = turnOf(slap, asleep);
    expect(after.sides[1].team[0].status).toBeNull();
    expect(after.events.some((event) => event.t === "volatile" && event.which === "roused")).toBe(true);
  });
});

describe("power that reads the user", () => {
  it("SP4: Facade doubles when the user has a condition, and a burn does not halve it", () => {
    const facade = creature("ursaring", { level: 50, moves: ["facade"], iv: 0 });
    aboutTimes(dealt({ ...facade, status: "brn" }, wall()), dealt(facade, wall()), 2);
  });

  it("SP5: Acrobatics doubles with nothing held", () => {
    const bare = creature("hawlucha", { level: 50, moves: ["acrobatics"], iv: 0 });
    aboutTimes(dealt(bare, wall()), dealt({ ...bare, heldItem: "hold-leftovers" }, wall()), 2);
  });

  it("SP6: Eruption falls with the user's health, and Stored Power climbs with its boosts", () => {
    const eruption = creature("typhlosion", { level: 50, moves: ["eruption"], iv: 0 });
    aboutTimes(dealt(eruption, wall()), dealt({ ...eruption, hp: Math.floor(maxHp(eruption) / 2) }, wall()), 2);

    const stored = creature("espeon", { level: 50, moves: ["storedpower"], iv: 0 });
    // +2 Defence changes nothing about a special hit except Stored Power's
    // power: 20 becomes 60.
    aboutTimes(dealt(stored, wall(), (battle) => (battle.sides[0].stages.def = 2)), dealt(stored, wall()), 3);
  });
});

describe("power that reads the turn", () => {
  it("SP7: Payback doubles for the one moving second, Revenge after being hit", () => {
    const payback = creature("slowpoke", { level: 50, moves: ["payback"], iv: 0 });
    const fastSplash = creature("rattata", { level: 50, moves: ["splash"], iv: 0 });
    // The same Payback into the same Rattata, once second and once first
    // (six stages of Speed put it in front).
    aboutTimes(dealt(payback, fastSplash), dealt(payback, fastSplash, (battle) => (battle.sides[0].stages.spe = 6)), 2);

    const revenge = creature("slowpoke", { level: 50, moves: ["revenge"], iv: 0 });
    // Revenge moves last whatever it faces, so a Snorlax that tackles has hit
    // it first and one that splashes has not.
    aboutTimes(dealt(revenge, wall({ moves: ["tackle"] })), dealt(revenge, wall()), 2);
  });
});

describe("damage rules", () => {
  it("SP8: False Swipe never takes the last point", () => {
    const swipe = creature("scyther", { level: 100, moves: ["falseswipe"] });
    const weak = creature("caterpie", { level: 2, moves: ["splash"], iv: 0 });
    const after = turnOf(swipe, weak);
    expect(after.sides[1].team[0].hp).toBe(1);
    expect(after.outcome).toBeNull();
  });

  it("SP9: Freeze-Dry is super effective on Water; Flying Press counts both its types", () => {
    const ice = creature("lapras", { level: 50, moves: ["freezedry"] });
    expect(landsAs(ice, creature("squirtle"), "freezedry")).toBe(8);
    expect(landsAs(ice, creature("quagsire"), "freezedry")).toBe(16);
    const press = creature("hawlucha", { level: 50, moves: ["flyingpress"] });
    // Grass: neutral to Fighting, weak to Flying.
    expect(landsAs(press, creature("bulbasaur"), "flyingpress")).toBe(4);
    expect(landsAs(press, creature("gastly"), "flyingpress")).toBe(0);
  });

  it("SP10: Foul Play uses the target's Attack; Body Press uses the user's Defence", () => {
    const foul = creature("umbreon", { level: 50, moves: ["foulplay"], iv: 0 });
    aboutTimes(dealt(foul, wall(), (battle) => (battle.sides[1].stages.atk = 2)), dealt(foul, wall()), 2);

    const press = creature("corviknight", { level: 50, moves: ["bodypress"], iv: 0 });
    aboutTimes(dealt(press, wall(), (battle) => (battle.sides[0].stages.def = 2)), dealt(press, wall()), 2);
  });

  it("SP11: Sacred Sword ignores Defence boosts; Psyshock hits Defence rather than Sp. Def", () => {
    const sword = creature("gallade", { level: 50, moves: ["sacredsword"], iv: 0 });
    const walled = dealt(sword, wall(), (battle) => (battle.sides[1].stages.def = 6));
    aboutTimes(walled, dealt(sword, wall()), 1);

    const psyshock = creature("alakazam", { level: 50, moves: ["psyshock"], iv: 0 });
    const plain = dealt(psyshock, wall());
    aboutTimes(dealt(psyshock, wall(), (battle) => (battle.sides[1].stages.spd = 6)), plain, 1);
    expect(dealt(psyshock, wall(), (battle) => (battle.sides[1].stages.def = 6))).toBeLessThan(plain / 2);
  });
});

describe("moves that need something to be true", () => {
  const fizzled = (battle: BattleState) => battle.events.some((event) => event.t === "fizzled" && event.side === 0);

  it("SP12: Dream Eater needs a sleeper, Sucker Punch an attack coming, Synchronoise a shared type", () => {
    const eater = creature("hypno", { level: 50, moves: ["dreameater"] });
    expect(fizzled(turnOf(eater, wall()))).toBe(true);
    expect(fizzled(turnOf(eater, wall({ status: "slp", sleepTurns: 3 })))).toBe(false);

    const punch = creature("absol", { level: 50, moves: ["suckerpunch"] });
    expect(fizzled(turnOf(punch, wall()))).toBe(true);
    expect(fizzled(turnOf(punch, wall({ moves: ["tackle"] })))).toBe(false);

    const sync = creature("alakazam", { level: 50, moves: ["synchronoise"] });
    expect(fizzled(turnOf(sync, wall()))).toBe(true);
    expect(fizzled(turnOf(sync, creature("espeon", { level: 50, moves: ["splash"] })))).toBe(false);
  });

  it("SP13: Clear Smog wipes the target's stages; Rapid Spin shakes off a seed", () => {
    const smog = creature("weezing", { level: 50, moves: ["clearsmog"] });
    const cleared = turnOf(smog, wall(), (battle) => (battle.sides[1].stages.atk = 4));
    expect(cleared.sides[1].stages.atk).toBe(0);

    const spin = creature("starmie", { level: 50, moves: ["rapidspin"] });
    const freed = turnOf(spin, wall(), (battle) => (battle.sides[0].volatiles = { seeded: true }));
    expect(freed.sides[0].volatiles?.seeded).toBeFalsy();
  });
});
