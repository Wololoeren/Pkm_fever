import { describe, expect, it } from "vitest";
import { applyInput, initialState, reduce, stateHash, type Input } from "@/engine/engine";
import { ENGINE_VERSION } from "@/engine/types";
import { packInputs, unpackInputs } from "@/lib/pack";
import { encodeSave, makeSave, parseSave } from "@/lib/save";
import { play, testWorld } from "./helpers";

/**
 * The log codec.
 *
 * A save is a seed and a list of inputs, and this is how the list is written
 * down. The only property that matters is that it survives the round trip
 * exactly — an input dropped, reordered or subtly changed is a save that
 * loads, replays, and is a different game. So the test that counts is not
 * "does it decode" but "does the decoded log hash to the same state".
 */
describe("packing a log", () => {
  it("PK1: a real playthrough survives the round trip, to the same state hash", () => {
    const world = testWorld("PACK1");
    const { inputs } = play(world, 4000);

    const back = unpackInputs(packInputs(inputs));
    expect(back).toEqual([...inputs]);
    expect(stateHash(reduce(world, back!))).toBe(stateHash(reduce(world, inputs)));
  });

  it("PK2: a run of moves is one string, and everything else is one array", () => {
    const packed = packInputs([
      { t: "move", dir: "n" },
      { t: "move", dir: "e" },
      { t: "move", dir: "e" },
      { t: "fish" },
      { t: "move", dir: "w" },
      { t: "fight", moveIndex: 2 },
    ]);

    expect(packed).toHaveLength(4);
    expect(packed[0]).toBe("nee");
    // No payload, so no second element at all.
    expect(packed[1]).toHaveLength(1);
    expect(packed[2]).toBe("w");
    expect(packed[3]).toEqual([expect.any(Number), { moveIndex: 2 }]);
  });

  /**
   * The reason the thing exists, stated as a number.
   *
   * Not a tight bound — it is a ratio on generated input and the generator can
   * change. It is here so that a change which quietly stops packing anything
   * fails rather than merely getting slower, which is exactly how a codec
   * rots: it keeps decoding correctly and stops earning its keep.
   *
   * Three and a half, not four. It was four until trainers started choosing
   * their moves, at which point their battles in the fixture got shorter and
   * the walk between them longer, and the ratio landed at 3.97 — the
   * generator changing, exactly as promised above, not the codec.
   */
  it("PK3: a walking log packs at least three and a half times smaller", () => {
    const world = testWorld("PACK2");
    const { inputs } = play(world, 4000);

    const plain = JSON.stringify(inputs).length;
    const packed = JSON.stringify(packInputs(inputs)).length;
    expect(packed * 7).toBeLessThan(plain * 2);
  });

  it("PK4: every input the engine can take has an opcode", () => {
    // One of each shape the union allows, including the ones with awkward
    // payloads — an object, a nested union, an optional field left off.
    const each: Input[] = [
      { t: "pickStarter", index: 0 },
      { t: "move", dir: "s" },
      { t: "fight", moveIndex: 3 },
      { t: "struggle" },
      { t: "switch", partyIndex: 1 },
      { t: "ball" },
      { t: "ball", item: "greatball" },
      { t: "flee" },
      { t: "continue" },
      { t: "deposit", from: "box", index: 2 },
      { t: "withdraw", slot: 1 },
      { t: "collectEgg" },
      { t: "toggleItem", item: "prism" },
      { t: "store", index: 0 },
      { t: "retrieve", index: 0 },
      { t: "cheat", cheat: { op: "warp", route: "meadow-1" } },
      { t: "setMoves", index: 0, moves: ["tackle", "growl"] },
      { t: "reorderParty", from: 0, to: 1 },
      { t: "useItem", item: "potion", index: 0 },
      { t: "fieldMove", index: 0, moveIndex: 1 },
      { t: "fieldMove", index: 0, moveIndex: 1, to: 2 },
      { t: "buyItem", item: "pokeball", count: 5 },
      { t: "sellItem", item: "nugget", count: 1 },
      { t: "fish" },
      { t: "talk", id: "nurse" },
      { t: "endTalk" },
      { t: "npcAccept" },
      { t: "npcTrade", index: 0 },
      { t: "npcTravel", route: "hub-0" },
      { t: "npcSell", index: 0, take: "money", confirm: 7 },
      { t: "learnMove", uid: 3, moveId: "ember", forget: "tackle" },
      { t: "holdItem", index: 0, item: null },
      { t: "claimQuest", id: "first-steps" },
      { t: "useTool", item: "cut", dir: "e" },
      { t: "fly", route: "hub-0" },
      { t: "release", from: "party", index: 1, confirm: 11 },
    ];

    expect(unpackInputs(packInputs(each))).toEqual(each);
  });

  it("PK5: it refuses a log it does not understand rather than guessing", () => {
    expect(unpackInputs("not a list")).toBeNull();
    // A letter that is not a direction.
    expect(unpackInputs(["nex"])).toBeNull();
    // An opcode nothing was ever given.
    expect(unpackInputs([[9999]])).toBeNull();
    // A payload that is not an object.
    expect(unpackInputs([[1, 4]])).toBeNull();
  });
});

describe("a save file", () => {
  it("PK6: writes packed and reads back to the same inputs", () => {
    const world = testWorld("PACK3");
    const { inputs } = play(world, 800);

    const parsed = parseSave(encodeSave(makeSave(world.seed, inputs)));
    expect(parsed).not.toBeNull();
    expect(parsed!.seed).toBe(world.seed);
    expect(parsed!.inputs).toEqual([...inputs]);
  });

  /**
   * A file written before the log was packed is still a file.
   *
   * The packing changed how a log is *spelled*, not what it means, so it is
   * deliberately not an `ENGINE_VERSION` bump — and that promise is only true
   * if the reader can still read the old spelling.
   */
  it("PK7: a plain `inputs` log still opens", () => {
    const plain = JSON.stringify({
      v: ENGINE_VERSION,
      seed: "OLDSAVE",
      inputs: [{ t: "pickStarter", index: 1 }, { t: "move", dir: "e" }],
      savedAt: "",
    });

    const parsed = parseSave(plain);
    expect(parsed?.inputs).toEqual([{ t: "pickStarter", index: 1 }, { t: "move", dir: "e" }]);
  });

  it("PK8: a save from another engine version is refused either way round", () => {
    const world = testWorld("PACK4");
    const state = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    expect(state.phase).not.toBe("starter");

    const written = JSON.parse(encodeSave(makeSave(world.seed, [{ t: "pickStarter", index: 0 }])));
    expect(parseSave(JSON.stringify({ ...written, v: ENGINE_VERSION - 1 }))).toBeNull();
    expect(parseSave(JSON.stringify({ ...written, log: "rubbish" }))).toBeNull();
  });
});
