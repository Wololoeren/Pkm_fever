import { describe, expect, it } from "vitest";
import {
  applyInput,
  initialState,
  itemRefusal,
  learnRefusal,
  pendingOffers,
  reduce,
  stateHash,
  MAX_MOVES,
  type GameState,
  type Input,
} from "@/engine/engine";
import { canLearnMachine, learnset, MACHINE_MOVES, machinesFor, move as moveById } from "@/engine/dex";
import { item, MACHINE_ITEMS, MART_STOCK } from "@/engine/items";
import { awardExp, expForLevel } from "@/engine/progression";
import { startBattle } from "@/engine/battle";
import { NPCS } from "@/engine/npc";
import { QUESTS } from "@/engine/quests";
import { machinesUpTo } from "@/engine/world";
import { creature, testWorld } from "./helpers";

/**
 * Learning: what a creature grows into, what a machine teaches it, and the one
 * question the game has to stop and ask.
 *
 * Every other change to a creature here is decided by the engine. This one is
 * not: which of four moves to give up is a judgement, and a judgement has to
 * arrive as an input or the save cannot replay it. So growth *offers* and the
 * offer waits — which is why there is a queue in the state at all.
 */

function started(seed = "PKMFEVER1") {
  const world = testWorld(seed);
  const state = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
  return { world, state };
}

/** A species, a level it learns something at, and four other moves. */
function aboutToLearn() {
  for (const speciesId of ["bulbasaur", "charmander", "squirtle", "pidgey", "rattata"]) {
    const list = learnset(speciesId);
    for (const [level, moveId] of list) {
      if (level < 6) continue;
      const earlier = list.filter(([at]) => at < level).map(([, id]) => id);
      const four = [...new Set(earlier)].filter((id) => id !== moveId).slice(0, MAX_MOVES);
      if (four.length === MAX_MOVES) return { speciesId, level, moveId, four };
    }
  }
  throw new Error("no species in this manifest learns a fifth move");
}

describe("growing into a move", () => {
  it("L1: a full set is offered the move, never overwritten", () => {
    const { speciesId, level, moveId, four } = aboutToLearn();
    const before = creature(speciesId, { level: level - 1, moves: [...four] });

    const growth = awardExp(before, expForLevel(level) - before.exp);

    expect(growth.individual.level).toBe(level);
    expect(growth.movesOffered).toContain(moveId);
    expect(growth.movesLearned).not.toContain(moveId);
    // The whole point: nothing it was carrying is gone.
    expect(growth.individual.moves).toEqual(four);
  });

  it("L2: room means it simply learns, and is not asked", () => {
    const { speciesId, level, moveId, four } = aboutToLearn();
    const before = creature(speciesId, { level: level - 1, moves: four.slice(0, 2) });

    const growth = awardExp(before, expForLevel(level) - before.exp);

    expect(growth.movesLearned).toContain(moveId);
    expect(growth.movesOffered).toEqual([]);
    expect(growth.individual.moves).toContain(moveId);
  });

  it("L3: an offer survives into the save and is answered by an input", () => {
    const { world, state } = started("LEARN1");
    const { speciesId, level, moveId, four } = aboutToLearn();

    const mine = creature(speciesId, { uid: 700, level: level - 1, moves: [...four] });
    const growth = awardExp(mine, expForLevel(level) - mine.exp);

    const waiting: GameState = {
      ...state,
      party: [growth.individual],
      pendingMoves: [{ uid: 700, moveId }],
    };

    expect(pendingOffers(waiting).map((offer) => offer.moveId)).toEqual([moveId]);

    const taught = applyInput(world, waiting, {
      t: "learnMove",
      uid: 700,
      moveId,
      forget: four[1],
    });

    // Swapped in place: the slot it was in is the slot the new one takes, so a
    // moveset does not silently reorder itself under the player.
    expect(taught.party[0].moves).toEqual([four[0], moveId, four[2], four[3]]);
    expect(taught.pendingMoves).toEqual([]);
  });

  it("L4: turning it down clears the offer and changes nothing", () => {
    const { world, state } = started("LEARN2");
    const mine = creature("pidgey", { uid: 701, moves: ["tackle", "gust", "growl", "quickattack"] });
    const waiting: GameState = {
      ...state,
      party: [mine],
      pendingMoves: [{ uid: 701, moveId: "wingattack" }],
    };

    const skipped = applyInput(world, waiting, {
      t: "learnMove",
      uid: 701,
      moveId: "wingattack",
      forget: null,
    });

    expect(skipped.party[0].moves).toEqual(mine.moves);
    expect(skipped.pendingMoves).toEqual([]);
    // Asked once. A prompt that comes back is one people stop reading.
    expect(pendingOffers(skipped)).toEqual([]);
  });

  it("L5: it refuses what it should refuse", () => {
    const { world, state } = started("LEARN3");
    const mine = creature("pidgey", { uid: 702, moves: ["tackle", "gust", "growl", "quickattack"] });
    const waiting: GameState = {
      ...state,
      party: [mine],
      pendingMoves: [{ uid: 702, moveId: "wingattack" }],
    };

    expect(learnRefusal(waiting, 702, "wingattack", "gust")).toBeNull();
    expect(learnRefusal(waiting, 702, "wingattack", null)).toBeNull();
    expect(learnRefusal(waiting, 702, "hyperbeam", "gust")).toBe("nothing was offered");
    expect(learnRefusal(waiting, 999, "wingattack", "gust")).toBe("nothing was offered");
    expect(learnRefusal(waiting, 702, "wingattack", "surf")).toBe("it does not know that one");
    expect(learnRefusal(waiting, 702, "wingattack", "wingattack")).toBe(
      "that is the one being offered",
    );

    // Gone from the party and the box: there is no "it" to teach.
    const alone = { ...waiting, party: [creature("rattata", { uid: 5 })] };
    expect(learnRefusal(alone, 702, "wingattack", null)).toBe("it is not here any more");
    expect(pendingOffers(alone)).toEqual([]);
  });

  it("L6: a Rare Candy grows it rather than rebuilding it", () => {
    const { world, state } = started("CANDY1");

    // A hand-picked moveset that the species list would not produce.
    const mine = creature("caterpie", {
      uid: 703,
      level: 6,
      moves: ["tackle", "stringshot"],
    });
    const holding: GameState = { ...state, party: [mine], bag: { ...state.bag, rarecandy: 1 } };

    expect(itemRefusal(holding, "rarecandy", 0)).toBeNull();
    const after = applyInput(world, holding, { t: "useItem", item: "rarecandy", index: 0 });

    expect(after.party[0].level).toBe(7);
    // Setting the level and rebuilding the moveset threw away the choice and
    // never evolved anything. Growth does both properly.
    expect(after.party[0].speciesId).toBe("metapod");
    expect(after.party[0].moves).toContain("tackle");
  });

  it("L8: an offer made mid-battle reaches the save when the battle ends", () => {
    const { world, state } = started("LEARN4");
    const { speciesId, level, moveId, four } = aboutToLearn();

    // One level short, a full set, and something across from it worth enough
    // experience to close the gap several times over.
    const mine = creature(speciesId, { uid: 800, level: level - 1, moves: [...four] });
    // Worth a great deal of experience, on one hit point, and armed with
    // nothing that can hurt anybody. A level-40 foe that could actually swing
    // would flatten a level-8 attacker before it ever levelled up.
    const foe = creature("chansey", { uid: 801, level: 40, moves: ["growl"], hp: 1 });

    let fighting: GameState = {
      ...state,
      phase: "battle",
      party: [mine],
      battle: startBattle(world.seed, "wild:test", [mine], [foe], 0),
    };

    // Whichever of its four actually does damage — the earliest moves a
    // species learns are as often a growl as a tackle, and a battle settled by
    // lowering somebody's attack is a long one.
    const hit = Math.max(
      0,
      four.findIndex((id) => moveById(id).category !== "status"),
    );

    for (let turn = 0; turn < 12 && fighting.battle?.outcome === null; turn++) {
      fighting = applyInput(world, fighting, { t: "fight", moveIndex: hit });
    }

    expect(fighting.party[0].level).toBeGreaterThanOrEqual(level);
    // The move it grew into is not in its set, and the question is waiting.
    expect(fighting.party[0].moves).not.toContain(moveId);
    expect(fighting.pendingMoves).toContainEqual({ uid: 800, moveId });

    // And it is asked once, however many turns the battle ran for.
    const asked = fighting.pendingMoves.filter((offer) => offer.moveId === moveId);
    expect(asked.length).toBe(1);
  });

  it("L7: offering, answering and skipping all replay", () => {
    const world = testWorld("REPLAY11");
    const inputs: Input[] = [
      { t: "pickStarter", index: 0 },
      { t: "cheat", cheat: { op: "setLevel", index: 0, level: 30 } },
      { t: "cheat", cheat: { op: "items" } },
    ];

    expect(stateHash(reduce(world, inputs))).toBe(stateHash(reduce(world, inputs)));

    // The queue is part of what a hash covers, so a save with a question
    // outstanding cannot be mistaken for one without.
    const once = reduce(world, inputs);
    const asked = { ...once, pendingMoves: [{ uid: once.party[0].uid, moveId: "tackle" }] };
    expect(stateHash(asked)).not.toBe(stateHash(once));
  });
});

describe("machines", () => {
  it("T1: one machine per teachable move, and every one teaches something real", () => {
    expect(MACHINE_MOVES.length).toBeGreaterThan(200);
    expect(MACHINE_ITEMS.length).toBe(MACHINE_MOVES.length);

    for (const spec of MACHINE_ITEMS) {
      expect(spec.kind).toBe("tm");
      expect(spec.teaches).toBeDefined();
      // Throws if the manifest has no row for it, which is the failure that
      // adding machine moves to the move table exists to prevent.
      expect(moveById(spec.teaches!).id).toBe(spec.teaches);
      expect(spec.name).toBe(`TM ${moveById(spec.teaches!).name}`);
      // Kept, not spent.
      expect(spec.stacks).toBe(false);
    }

    // Ranked by what they teach, weakest first.
    const powers = MACHINE_ITEMS.map((spec) => moveById(spec.teaches!).power);
    expect([...powers].sort((a, b) => a - b)).toEqual(powers);
  });

  it("T2: a machine refuses the species that will not take it", () => {
    const { state } = started("TM1");

    // Something every machine list disagrees about, found from the data rather
    // than assumed: one species that takes it and one that does not.
    const moveId = MACHINE_MOVES.find(
      (id) => canLearnMachine("pidgey", id) && !canLearnMachine("magikarp", id),
    );
    expect(moveId, "no move separates a Pidgey from a Magikarp").toBeDefined();

    const held = { ...state, bag: { ...state.bag, [`tm-${moveId}`]: 1 } };
    const can = { ...held, party: [creature("pidgey", { uid: 1, moves: ["tackle"] })] };
    const cannot = { ...held, party: [creature("magikarp", { uid: 1, moves: ["splash"] })] };

    expect(itemRefusal(can, `tm-${moveId}`, 0)).toBeNull();
    expect(itemRefusal(cannot, `tm-${moveId}`, 0)).toMatch(/will not take/);

    // And it will not teach the same move twice.
    const knows = { ...held, party: [creature("pidgey", { uid: 1, moves: [moveId!] })] };
    expect(itemRefusal(knows, `tm-${moveId}`, 0)).toBe("it already knows that");
  });

  it("T3: room teaches at once, a full set asks", () => {
    const { world, state } = started("TM2");
    const teachable = machinesFor("pidgey");
    expect(teachable.length).toBeGreaterThan(4);

    const moveId = teachable.find((id) => id !== "tackle")!;
    const bag = { ...state.bag, [`tm-${moveId}`]: 1 };

    const room = applyInput(
      world,
      { ...state, bag, party: [creature("pidgey", { uid: 1, moves: ["tackle"] })] },
      { t: "useItem", item: `tm-${moveId}`, index: 0 },
    );
    expect(room.party[0].moves).toContain(moveId);
    expect(room.pendingMoves).toEqual([]);
    // Kept: the machine is still in the bag.
    expect(room.bag[`tm-${moveId}`]).toBe(1);

    const four = teachable.filter((id) => id !== moveId).slice(0, MAX_MOVES);
    const full = applyInput(
      world,
      { ...state, bag, party: [creature("pidgey", { uid: 1, moves: four })] },
      { t: "useItem", item: `tm-${moveId}`, index: 0 },
    );
    expect(full.party[0].moves).toEqual(four);
    expect(full.pendingMoves).toEqual([{ uid: 1, moveId }]);
  });

  it("T4: found rather than sold, and found three different ways", () => {
    // A Mart list three hundred rows long is not a shop.
    for (const spec of MART_STOCK) expect(spec.kind).not.toBe("tm");
    for (const spec of MACHINE_ITEMS) expect(spec.price).toBe(0);

    // People hand them over.
    const given = NPCS.filter((who) => who.item && item(who.item).kind === "tm");
    expect(given.length).toBeGreaterThan(0);

    // Jobs pay them.
    const paid = QUESTS.filter((quest) => quest.reward.item && item(quest.reward.item).kind === "tm");
    expect(paid.length).toBeGreaterThan(0);

    // And they lie about on the floor.
    const world = testWorld("TMFLOOR");
    const dropped = [...world.pickups.values()]
      .flat()
      .filter((drop) => item(drop.item).kind === "tm");
    expect(dropped.length).toBeGreaterThan(0);
  });

  it("T5: the strong ones are only ever a long walk away", () => {
    const rings = 6;

    // The rule itself, rather than a sample of it: about a dozen machines lie
    // about in a whole world, which is far too few to argue from.
    expect(machinesUpTo(1, rings).length).toBeLessThan(machinesUpTo(6, rings).length);
    expect(machinesUpTo(6, rings).length).toBe(MACHINE_ITEMS.length);

    const strongest = MACHINE_ITEMS[MACHINE_ITEMS.length - 1].id;
    expect(machinesUpTo(1, rings)).not.toContain(strongest);
    expect(machinesUpTo(6, rings)).toContain(strongest);

    // And nothing on any floor of any world breaks it.
    for (const seed of ["TMFLOOR", "TMFLOOR2", "TMFLOOR3"]) {
      const world = testWorld(seed);
      for (const [routeId, drops] of world.pickups) {
        const ring = world.routes.get(routeId)?.ring ?? 0;
        for (const drop of drops) {
          if (item(drop.item).kind !== "tm") continue;
          expect(
            machinesUpTo(ring, rings),
            `${drop.item} is lying about on ring ${ring}`,
          ).toContain(drop.item);
        }
      }
    }
  });
});
