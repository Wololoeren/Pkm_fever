import { describe, expect, it } from "vitest";
import {
  applyInput,
  initialState,
  printRefusal,
  cutPreview,
  cutRefusal,
  reduce,
  reforgeRefusal,
  shredReady,
  shredRefusal,
  shredValue,
  shredWait,
  stateHash,
  SHRED_COOLDOWN,
  SHRED_PER_CANDY,
  type GameState,
} from "@/engine/engine";
import { INKS, inkFor, item } from "@/engine/items";
import {
  missingInks,
  printable,
  printReady,
  printWait,
  PRINT_CONSOLATION,
  PRINT_COOLDOWN,
  PRINT_PRICE,
  PRINT_FAILS,
  PRINT_LEVEL,
  PRINTER_STOCK,
} from "@/engine/printer";
import { NPCS } from "@/engine/npc";
import { ALL_SPECIES } from "@/engine/dex";
import { rngFor } from "@/engine/rng";
import { maxHp } from "@/engine/battle";
import { NATURE_IDS } from "@/engine/natures";
import { chippedStat, hasIvsLeft, nextNature, REFORGE_COST } from "@/engine/smith";
import { STAT_IDS, type Individual } from "@/engine/types";
import {
  CUT_COOLDOWN,
  cutReady,
  stoneFor,
  stonesForType,
  typeHasStones,
} from "@/engine/lapidary";
import { CHROMA_IDS, variant } from "@/engine/variants";
import { creature, play, testWorld } from "./helpers";

/**
 * The man with the 3D printer.
 *
 * He prints the last wild creature the scanner picked up, in whatever colours
 * he has ink for — which is ivory and nothing else until you find some. One
 * print, a quarter of them fail, and then six hundred moves before the machine
 * will go again.
 *
 * All of it is derived: the species from what you last saw, the failure from
 * the seed and the tick. Which is the whole difference between this and a
 * bracket prize — nothing is carried in the log, so a bad print cannot be
 * rerolled by reloading.
 */

const IVO = "print-ivo";

/** Standing in front of the printer, having last seen this. */
function atPrinter(seed: string, lastWild: string | null, bag: Record<string, number> = {}) {
  const world = testWorld(seed);
  const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

  const where = [...world.npcs].find(([, here]) => here.some((one) => one.id === IVO));
  expect(where, "the printer is not placed in this world").toBeDefined();
  const [routeId, here] = where!;
  const him = here.find((one) => one.id === IVO)!;

  const state: GameState = {
    ...start,
    route: routeId,
    x: him.x,
    y: him.y - 1,
    talking: IVO,
    lastWild,
    bag: { ...start.bag, ...bag },
    money: PRINT_PRICE,
  };
  return { world, state };
}

describe("what he can print", () => {
  it("Q1: ivory to begin with, and nothing else", () => {
    // He never ran out of white, which is the joke and also why the first
    // thing anybody gets out of him is ivory.
    const has = () => false;
    expect(printable(has)).toEqual([PRINTER_STOCK]);
    expect(missingInks(has)).toEqual(CHROMA_IDS.filter((id) => id !== PRINTER_STOCK));
    expect(PRINTER_STOCK).toBe("ivory");
  });

  it("Q2: a cartridge opens its colour, and one exists for every colour but his", () => {
    expect(INKS).toHaveLength(CHROMA_IDS.length - 1);
    for (const one of INKS) {
      expect(item(one.id).kind).toBe("ink");
      // Never for sale at any price: an ink is found, not bought.
      expect(item(one.id).price).toBe(0);
    }

    // Every colour has exactly one key, and ivory needs none.
    expect(inkFor(PRINTER_STOCK)).toBeNull();
    for (const id of CHROMA_IDS) {
      const ink = inkFor(id);
      if (ink === null) continue;
      expect(INKS.some((one) => one.id === ink), `no cartridge for ${id}`).toBe(true);
    }

    const carrying = new Set(["ink-ember", "ink-teal"]);
    expect(printable((id) => carrying.has(id)).sort()).toEqual(["ember", "ivory", "teal"]);
  });

  it("Q3: the inks are out there, one per cabin, in every world", () => {
    // A colour the seed happened not to deal would be a door in the printer
    // that no playthrough could open — which is why they are placed rather
    // than rolled.
    for (const seed of ["A1", "B2", "C3"]) {
      const world = testWorld(seed);
      const found = new Set<string>();
      let cabins = 0;
      for (const route of world.routes.values()) {
        if (route.id.endsWith(":cabin")) cabins++;
        for (const drop of world.pickups.get(route.id) ?? []) {
          if (drop.item.startsWith("ink-")) found.add(drop.item);
        }
      }
      expect(found.size, `${seed}: ${found.size} inks in ${cabins} cabins`).toBe(
        Math.min(INKS.length, cabins),
      );
    }
  });
});

describe("the machine", () => {
  it("Q4: it will not run with nothing on file", () => {
    // He prints from a scan, and the scan is your last wild encounter. No
    // walk in the grass, no specimen.
    const { world, state } = atPrinter("PRINT1", null);
    expect(printRefusal(world, state, "ivory")).toBe("there is nothing on file yet");
  });

  it("Q5: it prints what you last saw, in the colour you asked for", () => {
    const { world, state } = atPrinter("PRINT2", "gyarados");
    expect(printRefusal(world, state, "ivory")).toBeNull();

    // Walked forward until one comes out rather than pinned to a seed: a
    // quarter of them fail, and which quarter is the seed's business.
    let live = state;
    let made: GameState | null = null;
    for (let tries = 0; tries < 40 && !made; tries++) {
      const tried = applyInput(world, { ...live, printedAt: null }, {
        t: "print",
        chromaId: "ivory",
      });
      if (tried.notice?.t === "printed") made = tried;
      live = { ...live, tick: live.tick + 1 };
    }

    expect(made, "forty attempts and none of them worked").not.toBeNull();
    const printed = [...made!.party, ...made!.box].at(-1)!;
    expect(printed.speciesId).toBe("gyarados");
    expect(printed.level).toBe(PRINT_LEVEL);
    expect(variant(printed.variantId).chromaId).toBe("ivory");
    // Nothing about it is taken on trust — the species is in the log, the
    // colour is in the input, the roll is the seed's — so it carries none of
    // the three marks.
    expect(printed.traded).toBe(false);
    expect(printed.prize).toBe(false);
    expect(printed.cheat).toBe(false);
  });

  it("Q6: a colour with no ink is refused, and one with ink is not", () => {
    const bare = atPrinter("PRINT3", "pikachu");
    expect(bare.state.bag["ink-ember"] ?? 0).toBe(0);
    expect(printRefusal(bare.world, bare.state, "ember")).toBe("no ember ink");

    const stocked = atPrinter("PRINT3", "pikachu", { "ink-ember": 1 });
    expect(printRefusal(stocked.world, stocked.state, "ember")).toBeNull();
    expect(printRefusal(stocked.world, stocked.state, "onyx")).toBe("no onyx ink");
    expect(printRefusal(stocked.world, stocked.state, "puce")).toBe("that is not a colour");
  });

  it("Q7: the ink is never spent — it is a key, not a cartridge you use up", () => {
    const { world, state } = atPrinter("PRINT4", "eevee", { "ink-teal": 1 });
    const after = applyInput(world, state, { t: "print", chromaId: "teal" });
    expect(after.bag["ink-teal"]).toBe(1);
  });

  it("Q8: one print, then fifteen hundred moves", () => {
    const { world, state } = atPrinter("PRINT5", "rattata");
    const after = applyInput(world, state, { t: "print", chromaId: "ivory" });

    expect(after.printedAt).toBe(state.tick);
    expect(printReady(after.tick, after.printedAt)).toBe(false);
    expect(printRefusal(world, after, "ivory")).toMatch(/warming up/);
    expect(printWait(after.tick, after.printedAt)).toBeGreaterThan(0);
    expect(PRINT_COOLDOWN).toBe(1500);

    // And it is ready again exactly then.
    const later = { ...after, tick: after.printedAt! + PRINT_COOLDOWN, money: PRINT_PRICE };
    expect(printReady(later.tick, later.printedAt)).toBe(true);
    expect(printRefusal(world, later, "ivory")).toBeNull();
  });

  it("Q8b: a go costs three thousand, paid whether it prints or not", () => {
    const { world, state } = atPrinter("PRINT5", "rattata");
    expect(PRINT_PRICE).toBe(3000);
    expect(applyInput(world, state, { t: "print", chromaId: "ivory" }).money).toBe(state.money - PRINT_PRICE);

    const short = { ...state, money: PRINT_PRICE - 1 };
    expect(printRefusal(world, short, "ivory")).toBe("a print costs ¤3,000");
    expect(() => applyInput(world, short, { t: "print", chromaId: "ivory" })).toThrow();
  });

  it("Q9: a failed print still costs the attempt, and hands over a Slurm", () => {
    // A failure that cost nothing would make the quarter free, and then the
    // only real price would be the walk.
    const { world, state } = atPrinter("PRINT6", "magikarp");

    let failed: GameState | null = null;
    for (let tick = 0; tick < 60 && !failed; tick++) {
      const tried = applyInput(world, { ...state, tick, printedAt: null }, {
        t: "print",
        chromaId: "ivory",
      });
      if (tried.notice?.t === "printFailed") failed = tried;
    }

    expect(failed, "sixty attempts and none of them failed").not.toBeNull();
    expect(failed!.notice).toEqual({ t: "printFailed", item: PRINT_CONSOLATION });
    expect(failed!.bag[PRINT_CONSOLATION]).toBeGreaterThan(0);
    // The machine ran, so the machine needs a rest.
    expect(failed!.printedAt).not.toBeNull();
    // And nothing joined the party.
    expect(failed!.party).toHaveLength(state.party.length);
  });

  it("Q10: it fails about a quarter of the time", () => {
    const { world, state } = atPrinter("PRINT7", "pidgey");
    let failures = 0;
    const runs = 400;
    for (let tick = 0; tick < runs; tick++) {
      const tried = applyInput(world, { ...state, tick, printedAt: null }, {
        t: "print",
        chromaId: "ivory",
      });
      if (tried.notice?.t === "printFailed") failures++;
    }
    const rate = (failures / runs) * 1000;
    expect(PRINT_FAILS).toBe(250);
    // Wide bands: this is four hundred coins, not a proof.
    expect(rate).toBeGreaterThan(180);
    expect(rate).toBeLessThan(330);
  });

  it("Q11: the same log always prints the same thing, or fails the same way", () => {
    // No rerolling a bad print by reloading, which is the whole reason the
    // roll is named off the seed and the tick rather than carried.
    const { world, state } = atPrinter("PRINT8", "snorlax");
    const once = applyInput(world, state, { t: "print", chromaId: "ivory" });
    const again = applyInput(world, state, { t: "print", chromaId: "ivory" });
    expect(stateHash(again)).toBe(stateHash(once));
  });

  it("Q12: he is on the roster, and he is the only one of him", () => {
    const printers = NPCS.filter((one) => one.kind === "print");
    expect(printers).toHaveLength(1);
    expect(printers[0].id).toBe(IVO);
  });
});

describe("what the scanner picks up", () => {
  it("Q13: the last wild creature seen, not the last one beaten", () => {
    // Written on sight rather than on a catch: losing to something does not
    // unsee it, and you do not have to win to be scanned.
    //
    // Played with the walker the replay tests use rather than by stepping in
    // a direction — the grass is out on the routes and a naive walk spends
    // four hundred steps in the town square.
    const world = testWorld("SCAN1");
    const { inputs, state } = play(world, 400);
    expect(state.lastWild, "the walker never met anything").not.toBeNull();

    // Whatever it is, it is a species — and it is one this world holds.
    expect(typeof state.lastWild).toBe("string");

    // It is part of the state, so a save with a specimen on file cannot be
    // mistaken for one without, and a replay puts the same one on file.
    expect(stateHash({ ...state, lastWild: null })).not.toBe(stateHash(state));
    expect(reduce(world, inputs).lastWild).toBe(state.lastWild);
  });
});

/**
 * The man who takes them off your hands.
 *
 * One Rare Candy for every three levels, one at a time, a thousand moves
 * between. He is the box's only exit: the daycare makes creatures and the box
 * stores them, and until now nothing *spent* one.
 *
 * The rate is deliberately bad. A candy is a level, so one-for-three is a
 * two-thirds loss — the exchange has to be worth doing and must never be worth
 * farming, because a Rare Candy buys the one thing this game is otherwise
 * entirely about.
 */
describe("the shredder", () => {
  const MARV = "shred-marv";

  /** Standing in front of him, with this party. */
  function atMarv(seed: string, levels: number[], shreddedAt: number | null = null) {
    const world = testWorld(seed);
    const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    const where = [...world.npcs].find(([, here]) => here.some((one) => one.id === MARV));
    expect(where, "the shredder is not placed in this world").toBeDefined();
    const [routeId, here] = where!;
    const him = here.find((one) => one.id === MARV)!;

    const state: GameState = {
      ...start,
      route: routeId,
      x: him.x,
      y: him.y - 1,
      talking: MARV,
      shreddedAt,
      party: levels.map((level, at) =>
        creature("rattata", { uid: 100 + at, level, moves: ["tackle"] }),
      ),
    };
    return { world, state };
  }

  it("Q14: one candy per three levels, rounded down", () => {
    for (const [level, candy] of [
      [1, 0],
      [2, 0],
      [3, 1],
      [5, 1],
      [30, 10],
      [59, 19],
      [100, 33],
    ] as const) {
      expect(shredValue(creature("rattata", { uid: 1, level })), `level ${level}`).toBe(candy);
    }
    expect(SHRED_PER_CANDY).toBe(3);
  });

  it("Q15: he pays, takes it, and it does not come back", () => {
    const { world, state } = atMarv("SHRED1", [30, 20]);
    const before = state.bag.rarecandy ?? 0;
    const going = state.party[0];

    expect(shredRefusal(world, state, 0, going.uid)).toBeNull();
    const after = applyInput(world, state, { t: "shred", index: 0, confirm: going.uid });

    expect(after.bag.rarecandy).toBe(before + 10);
    expect(after.party.map((one) => one.uid)).toEqual([state.party[1].uid]);
    // Not in the box either. Handed over is handed over.
    expect(after.box.some((one) => one.uid === going.uid)).toBe(false);
    expect(after.notice).toEqual({ t: "shredded", name: "Rattata", level: 30, candy: 10 });
  });

  it("Q16: the uid is the safety catch, as it is at the Appraiser", () => {
    // The second irreversible thing in the game a party list can slide under.
    // A mis-click on a list that moved is not undoable.
    const { world, state } = atMarv("SHRED2", [30, 20]);
    expect(shredRefusal(world, state, 1, state.party[0].uid)).toBe(
      "that is not the one you were shown",
    );
    expect(shredRefusal(world, state, 9, 999)).toBe("nobody there");
  });

  it("Q17: he will not take your last one, or one worth nothing", () => {
    const alone = atMarv("SHRED3", [40]);
    expect(shredRefusal(alone.world, alone.state, 0, alone.state.party[0].uid)).toBe(
      "keep something that can fight",
    );

    const tiny = atMarv("SHRED4", [2, 40]);
    expect(shredRefusal(tiny.world, tiny.state, 0, tiny.state.party[0].uid)).toBe(
      "it is not worth a candy yet",
    );
  });

  it("Q18: one at a time, a thousand moves apart", () => {
    const { world, state } = atMarv("SHRED5", [30, 30, 30]);
    const after = applyInput(world, state, { t: "shred", index: 0, confirm: state.party[0].uid });

    expect(after.shreddedAt).toBe(state.tick);
    expect(shredReady(after.tick, after.shreddedAt)).toBe(false);
    expect(shredRefusal(world, after, 0, after.party[0].uid)).toMatch(/still running/);
    expect(shredWait(after.tick, after.shreddedAt)).toBeGreaterThan(0);
    expect(SHRED_COOLDOWN).toBe(1000);

    // Ready again exactly then, and not a move before.
    const nearly = { ...after, tick: after.shreddedAt! + SHRED_COOLDOWN - 1 };
    expect(shredReady(nearly.tick, nearly.shreddedAt)).toBe(false);
    const later = { ...after, tick: after.shreddedAt! + SHRED_COOLDOWN };
    expect(shredReady(later.tick, later.shreddedAt)).toBe(true);
    expect(shredRefusal(world, later, 0, later.party[0].uid)).toBeNull();
  });

  it("Q19: the rate is a loss, so it can never be an escalator", () => {
    // Feed a level 60 in and twenty levels come back. If it ever returned
    // more than it took, breed-and-shred would be an infinite ladder.
    for (const level of [3, 12, 30, 60, 99]) {
      expect(shredValue(creature("rattata", { uid: 1, level }))).toBeLessThan(level);
    }
  });

  it("Q20: it replays, and the cooldown is part of the save", () => {
    const { world, state } = atMarv("SHRED6", [33, 20]);
    const once = applyInput(world, state, { t: "shred", index: 0, confirm: state.party[0].uid });
    const again = applyInput(world, state, { t: "shred", index: 0, confirm: state.party[0].uid });
    expect(stateHash(again)).toBe(stateHash(once));

    // A save that has just used him cannot be mistaken for one that has not.
    expect(stateHash({ ...once, shreddedAt: null })).not.toBe(stateHash(once));
  });
});

/**
 * The lapidary.
 *
 * A creature in, an evolution stone of its type out. What is worth guarding is
 * not that it hands over a stone but *which* stone, because the table it picks
 * from is derived from the manifest rather than written down — so the guard is
 * that the derivation still lands where intuition does, and that a two-type
 * creature really is a coin toss.
 */
describe("the lapidary", () => {
  const HESSA = "cut-hessa";

  function atHessa(seed: string, species: string[], cutAt: number | null = null) {
    const world = testWorld(seed);
    const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    const where = [...world.npcs].find(([, here]) => here.some((one) => one.id === HESSA));
    expect(where, "the lapidary is not placed in this world").toBeDefined();
    const [routeId, here] = where!;
    const her = here.find((one) => one.id === HESSA)!;

    const state: GameState = {
      ...start,
      route: routeId,
      x: her.x,
      y: her.y - 1,
      talking: HESSA,
      cutAt,
      party: species.map((id, at) => creature(id, { uid: 200 + at, level: 20, moves: ["tackle"] })),
    };
    return { world, state };
  }

  it("Q21: the obvious types give the obvious stones", () => {
    // The derivation is only worth having if it lands where intuition does.
    // Nobody wrote these down — they fall out of what the manifest says each
    // stone actually opens.
    for (const [type, stone] of [
      ["fire", "stone-firestone"],
      ["water", "stone-waterstone"],
      ["electric", "stone-thunderstone"],
      ["grass", "stone-leafstone"],
      ["ice", "stone-icestone"],
    ] as const) {
      const rows = stonesForType(type);
      expect(rows.length, `${type} has no stones at all`).toBeGreaterThan(0);
      // Heaviest first, and the heaviest is the one everybody would name.
      expect(rows[0].id, `${type}`).toBe(stone);
    }
  });

  it("Q22: a type with nothing of its own still gets something", () => {
    // `ground` today: no ground type in this roster evolves by stone. Refusing
    // a Diglett at the counter would be a rule nobody could guess and a panel
    // row that greys out for reasons living in a data file.
    expect(typeHasStones("ground")).toBe(false);
    expect(stonesForType("ground").length).toBeGreaterThan(0);
    expect(stoneFor(rngFor("SEED", "ground"), ["ground"])).toMatch(/^stone-/);
  });

  it("Q23: two types is a coin toss between them", () => {
    // The one thing the request pinned down: uniform *between* the types. Only
    // the split is uniform — which stone comes out of a given type is weighted
    // by what the manifest says — which is why this counts types, not stones.
    const fire = new Set(stonesForType("fire").map((one) => one.id));
    const water = new Set(stonesForType("water").map((one) => one.id));
    // The two tables have to be tellable apart, or this measures nothing.
    expect([...fire].some((id) => !water.has(id))).toBe(true);

    let fires = 0;
    let waters = 0;
    const runs = 2000;
    for (let at = 0; at < runs; at++) {
      const got = stoneFor(rngFor("SPLIT", at), ["fire", "water"]);
      if (water.has(got) && !fire.has(got)) waters++;
      else if (fire.has(got) && !water.has(got)) fires++;
    }

    expect(fires + waters, "neither table produced anything distinctive").toBeGreaterThan(runs / 2);
    const share = fires / (fires + waters);
    // Two thousand coins: wide bands, but nowhere near a table that favours
    // whichever type happens to be listed first.
    expect(share).toBeGreaterThan(0.42);
    expect(share).toBeLessThan(0.58);
  });

  it("Q24: she takes it, hands back a stone, and it does not come back", () => {
    const { world, state } = atHessa("CUT1", ["vulpix", "rattata"]);
    const going = state.party[0];
    expect(cutRefusal(world, state, 0, going.uid)).toBeNull();

    const wanted = cutPreview(world, state, 0);
    const after = applyInput(world, state, { t: "cut", index: 0, confirm: going.uid });

    // What the panel showed is what arrived.
    expect(wanted).not.toBeNull();
    expect(after.bag[wanted!]).toBeGreaterThan(0);
    // A Vulpix is a fire type, and fire comes off as a Fire Stone.
    expect(wanted).toBe("stone-firestone");

    expect(after.party.map((one) => one.uid)).toEqual([state.party[1].uid]);
    expect(after.box.some((one) => one.uid === going.uid)).toBe(false);
    expect(after.notice).toEqual({ t: "cut", name: "Vulpix", item: "stone-firestone" });
  });

  it("Q25: the same refusals as the shredder, and its own gate", () => {
    const alone = atHessa("CUT2", ["vulpix"]);
    expect(cutRefusal(alone.world, alone.state, 0, alone.state.party[0].uid)).toBe(
      "keep something that can fight",
    );

    // Three, so that the cooldown check below is not standing on the
    // last-one rule instead: taking one from a party of two leaves one, and
    // she would refuse that for a different reason entirely.
    const two = atHessa("CUT3", ["vulpix", "poliwag", "rattata"]);
    expect(cutRefusal(two.world, two.state, 1, two.state.party[0].uid)).toBe(
      "that is not the one you were shown",
    );
    expect(cutRefusal(two.world, two.state, 9, 999)).toBe("nobody there");

    const after = applyInput(two.world, two.state, {
      t: "cut",
      index: 0,
      confirm: two.state.party[0].uid,
    });
    expect(after.cutAt).toBe(two.state.tick);
    expect(cutReady(after.tick, after.cutAt)).toBe(false);
    expect(cutRefusal(two.world, after, 0, after.party[0].uid)).toMatch(/wheel is still turning/);
    expect(CUT_COOLDOWN).toBe(1000);

    const later = { ...after, tick: after.cutAt! + CUT_COOLDOWN };
    expect(cutReady(later.tick, later.cutAt)).toBe(true);
    expect(cutRefusal(two.world, later, 0, later.party[0].uid)).toBeNull();
  });

  it("Q26: her gate is her own, not shared with the shredder", () => {
    // Two people, two machines. One gate covering both would mean using one
    // locked you out of the other for reasons no sign anywhere explains.
    const { world, state } = atHessa("CUT4", ["vulpix", "rattata"]);
    const after = applyInput(world, state, { t: "cut", index: 0, confirm: state.party[0].uid });
    expect(after.cutAt).not.toBeNull();
    expect(after.shreddedAt).toBeNull();
  });

  it("Q27: a dual type cannot be rerolled by walking out and back in", () => {
    // The roll is named off the seed, the tick and the creature — so the same
    // log always hands back the same stone, and there is no reloading for the
    // other half of a coin toss.
    const { world, state } = atHessa("CUT5", ["bulbasaur", "rattata"]);
    const once = applyInput(world, state, { t: "cut", index: 0, confirm: state.party[0].uid });
    const again = applyInput(world, state, { t: "cut", index: 0, confirm: state.party[0].uid });
    expect(stateHash(again)).toBe(stateHash(once));

    // And a save that has used her cannot be mistaken for one that has not.
    expect(stateHash({ ...once, cutAt: null })).not.toBe(stateHash(once));
  });

  it("Q28: everything she can hand out is a real stone that opens a real door", () => {
    // The derivation reads the manifest, so a stone it produced that nothing
    // could use would mean the read has drifted.
    const seen = new Set<string>();
    for (const type of new Set(ALL_SPECIES.flatMap((one) => one.types))) {
      for (const row of stonesForType(type)) seen.add(row.id);
    }
    expect(seen.size).toBeGreaterThan(10);
    for (const id of seen) {
      expect(item(id).evolves, `${id} is not an evolution stone`).toBe(true);
    }
  });
});

/**
 * The smith: a different nature, for one IV point.
 *
 * What is worth guarding is the shape of the cost. It must always be paid, it
 * must always buy a change, and it must come out of breeding — the one thing
 * this game will not sell — rather than out of nothing.
 */
describe("the smith", () => {
  const BRENN = "forge-brenn";

  function atBrenn(seed: string, party: Individual[]) {
    const world = testWorld(seed);
    const start = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    const where = [...world.npcs].find(([, here]) => here.some((one) => one.id === BRENN));
    expect(where, "the smith is not placed in this world").toBeDefined();
    const [routeId, here] = where!;
    const him = here.find((one) => one.id === BRENN)!;

    const state: GameState = {
      ...start,
      route: routeId,
      x: him.x,
      y: him.y - 1,
      talking: BRENN,
      party,
    };
    return { world, state };
  }

  const total = (one: Individual) => STAT_IDS.reduce((sum, stat) => sum + one.ivs[stat], 0);

  it("Q29: a different nature, and exactly one IV point fewer", () => {
    const creatureIn = creature("machop", { uid: 300, level: 30, moves: ["tackle"] });
    const { world, state } = atBrenn("FORGE1", [creatureIn]);
    expect(reforgeRefusal(world, state, 0, creatureIn.uid)).toBeNull();

    const after = applyInput(world, state, { t: "reforge", index: 0, confirm: creatureIn.uid });
    const out = after.party[0];

    expect(out.natureId).not.toBe(creatureIn.natureId);
    expect(total(out)).toBe(total(creatureIn) - REFORGE_COST);

    // Exactly one stat moved, by exactly one.
    const moved = STAT_IDS.filter((stat) => out.ivs[stat] !== creatureIn.ivs[stat]);
    expect(moved).toHaveLength(1);
    expect(creatureIn.ivs[moved[0]] - out.ivs[moved[0]]).toBe(1);

    // And the notice names both natures and the stat that paid.
    expect(after.notice).toEqual({
      t: "reforged",
      name: "Machop",
      from: creatureIn.natureId,
      to: out.natureId,
      stat: moved[0],
    });
  });

  it("Q30: it never lands on the nature it started with", () => {
    // The price is paid either way, so a swing that could land where it began
    // would take an IV point for nothing — one time in twenty-five.
    for (const current of NATURE_IDS) {
      for (let at = 0; at < 40; at++) {
        expect(nextNature(rngFor("NATURE", current, at), current)).not.toBe(current);
      }
    }
  });

  it("Q31: every other nature is reachable", () => {
    // Uniform over the other twenty-four. A smith with an opinion about which
    // temperament you ought to have is a smith selling something.
    const seen = new Set<string>();
    for (let at = 0; at < 2000; at++) seen.add(nextNature(rngFor("REACH", at), "hardy"));
    expect(seen.size).toBe(NATURE_IDS.length - 1);
    expect(seen.has("hardy")).toBe(false);
  });

  it("Q32: the dent never lands on an IV already at nought", () => {
    // You cannot take a point from nothing, and a blow that landed on an empty
    // stat and cost nothing would be a free reroll hidden in a rounding rule.
    const ivs = { hp: 0, atk: 0, def: 5, spa: 0, spd: 0, spe: 0 };
    for (let at = 0; at < 200; at++) {
      expect(chippedStat(rngFor("DENT", at), ivs)).toBe("def");
    }
  });

  it("Q33: a creature with nothing left in it is refused", () => {
    const empty = creature("magikarp", { uid: 301, level: 10, moves: ["splash"], iv: 0 });
    expect(STAT_IDS.every((stat) => empty.ivs[stat] === 0)).toBe(true);

    const { world, state } = atBrenn("FORGE2", [empty]);
    expect(reforgeRefusal(world, state, 0, empty.uid)).toBe("there is nothing left in it to take");
    expect(hasIvsLeft(empty)).toBe(false);
  });

  it("Q34: the uid is the safety catch, and he keeps the creature in the party", () => {
    const one = creature("machop", { uid: 302, level: 30, moves: ["tackle"] });
    const two = creature("geodude", { uid: 303, level: 30, moves: ["tackle"] });
    const { world, state } = atBrenn("FORGE3", [one, two]);

    expect(reforgeRefusal(world, state, 1, one.uid)).toBe("that is not the one you were shown");
    expect(reforgeRefusal(world, state, 9, 999)).toBe("nobody there");

    // Unlike the other three, nothing leaves: the same creature comes back.
    const after = applyInput(world, state, { t: "reforge", index: 0, confirm: one.uid });
    expect(after.party.map((creatureOut) => creatureOut.uid)).toEqual([one.uid, two.uid]);
  });

  it("Q35: no gate — the IVs are the limit", () => {
    // Everybody else who changes a creature has a thousand moves between goes.
    // This one cannot be farmed, because fishing for one nature costs about
    // twenty-four IV points: the breeding runs out long before the patience.
    const start = creature("machop", { uid: 304, level: 30, moves: ["tackle"] });
    const { world, state: first } = atBrenn("FORGE4", [start]);
    let state = first;

    for (let swing = 0; swing < 5; swing++) {
      expect(reforgeRefusal(world, state, 0, start.uid), `swing ${swing}`).toBeNull();
      state = applyInput(world, state, { t: "reforge", index: 0, confirm: start.uid });
    }
    expect(total(state.party[0])).toBe(total(start) - 5);
  });

  it("Q36: a swing cannot be reloaded away", () => {
    // Rolled from the seed, the tick and the creature, so the same log lands
    // the same blow on the same stat every time.
    const one = creature("machop", { uid: 305, level: 30, moves: ["tackle"] });
    const { world, state } = atBrenn("FORGE5", [one]);
    const once = applyInput(world, state, { t: "reforge", index: 0, confirm: one.uid });
    const again = applyInput(world, state, { t: "reforge", index: 0, confirm: one.uid });
    expect(stateHash(again)).toBe(stateHash(once));
  });

  it("Q37: health keeps its fraction, not its number", () => {
    // A nature can move maximum HP by a point or two, and coming off the anvil
    // on the same number would quietly lose a slice of the bar.
    const hurt = creature("chansey", { uid: 306, level: 50, moves: ["tackle"] });
    const half = { ...hurt, hp: Math.floor(maxHp(hurt) / 2) };
    const { world, state } = atBrenn("FORGE6", [half]);

    const after = applyInput(world, state, { t: "reforge", index: 0, confirm: half.uid });
    const out = after.party[0];
    const fraction = out.hp / maxHp(out);
    expect(fraction).toBeGreaterThan(0.45);
    expect(fraction).toBeLessThan(0.55);
  });
});
