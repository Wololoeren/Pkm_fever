import { describe, expect, it } from "vitest";
import { reduce, stateHash, type Input } from "@/engine/engine";
import { ENGINE_VERSION } from "@/engine/types";
import { dailySeed, makeSave, normaliseSeed } from "@/lib/save";
import { verifySave } from "@/lib/verify";
import { prizeOffer } from "@/engine/prize";
import { atFullHealth, withMoves } from "@/engine/engine";
import { play, testWorld } from "./helpers";

/**
 * The verify page and the daily seed.
 *
 * Both are the same claim as the replay tests, seen from a tournament desk:
 * a save replays to one state, and a date names one world.
 */

const SEED = "PKMFEVER1";

describe("the verify page", () => {
  it("VF1: a played save replays to the hash the engine would give it", () => {
    const world = testWorld(SEED);
    const { inputs } = play(world, 300);
    const report = verifySave(makeSave(SEED, inputs));

    expect(report.ok).toBe(true);
    expect(report.error).toBeNull();
    expect(report.moves).toBe(300);
    expect(report.seed).toBe(normaliseSeed(SEED));
    expect(report.hash).toBe(stateHash(reduce(world, inputs)));
    expect(report.cheated).toBe(false);
    expect(report.party.length).toBeGreaterThan(0);
    expect(report.version).toBe(ENGINE_VERSION);
  });

  it("VF2: a cheat leaves its mark, and the mark survives everything after it", () => {
    const world = testWorld(SEED);
    const { inputs } = play(world, 120);
    const cheat: Input = { t: "cheat", cheat: { op: "heal" } };
    const report = verifySave(makeSave(SEED, [...inputs.slice(0, 60), cheat, ...inputs.slice(60)]));

    // The rest of the log may or may not still replay after a heal; either
    // way the mark is what the desk reads.
    expect(report.cheated || !report.ok).toBe(true);
    if (report.ok) expect(report.cheated).toBe(true);
  });

  it("VF3: a log the engine refuses says where, rather than 'corrupt'", () => {
    const world = testWorld(SEED);
    const { inputs } = play(world, 50);
    // Dismissing a battle that is not there is refused by the engine.
    const broken: Input[] = [...inputs, { t: "continue" }, ...inputs.slice(0, 3)];
    const report = verifySave(makeSave(SEED, broken));

    expect(report.ok).toBe(false);
    expect(report.failedAt).toBe(inputs.length);
    expect(report.error).toBeTruthy();
    // And it still reports the state it reached, so the desk can see what
    // was there before the log went wrong.
    expect(report.moves).toBe(broken.length);
  });

  it("VF4: a save from another engine version is not verified, and says so", () => {
    const world = testWorld(SEED);
    const { inputs } = play(world, 20);
    const report = verifySave({ ...makeSave(SEED, inputs), v: ENGINE_VERSION + 1 });
    expect(report.ok).toBe(false);
    expect(report.error).toContain("engine version");
  });
});

describe("today's seed", () => {
  it("VF5: one seed per day, in the alphabet a seed can be read out loud in", () => {
    const a = dailySeed(new Date("2026-09-12T00:00:01Z"));
    const b = dailySeed(new Date("2026-09-12T23:59:59Z"));
    const c = dailySeed(new Date("2026-09-13T00:00:01Z"));
    expect(a).toBe("DAY20260912");
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(normaliseSeed(a)).toBe(a);
  });

  it("VF6: and it is the same world for two people who begin it", () => {
    const seed = dailySeed(new Date("2026-09-12T12:00:00Z"));
    const one = testWorld(seed);
    const two = testWorld(seed);
    expect(one.starters).toEqual(two.starters);
    expect(stateHash(reduce(one, []))).toBe(stateHash(reduce(two, [])));
  });
});

/**
 * The hole in "replaying the log is the verification", and the reason it is
 * now visible.
 *
 * Everything in a save is derived — the world from the seed, the creatures
 * from the world, the battles from the inputs — except one thing. A creature
 * received in a trade came out of another player's world and is carried whole
 * in the input that brought it, because there is no seed here it could be
 * derived from.
 *
 * Which means the check-in desk can be walked straight past: cheat a level 50
 * into one save, trade it into a second, and the second replays perfectly with
 * `cheated: false` — honestly, because the second log never touched the
 * shortcut menu. The team is impossible and the page said it was fine.
 */
describe("what came in from outside", () => {
  /** Standing in the hub, where trading is allowed, with a party. */
  function inTown(seed: string) {
    const world = testWorld(seed);
    const inputs: Input[] = [{ t: "pickStarter", index: 0 }];
    return { world, inputs };
  }

  it("VF7: a cheated creature traded into a clean save is reported, not hidden", () => {
    // The first save cheats. Nothing subtle: a level 100 Mewtwo out of the
    // menu, which is exactly the shape of the thing that should never survive
    // a check-in.
    const { world, inputs: dirty } = inTown(SEED);
    const cheated = reduce(world, [
      ...dirty,
      { t: "cheat", cheat: { op: "give", speciesId: "mewtwo", level: 100, variantId: "shiny", gender: "female" } },
    ]);
    const monster = [...cheated.party, ...cheated.box].at(-1)!;
    expect(monster.level).toBe(100);
    expect(verifySave(makeSave(SEED, [
      ...dirty,
      { t: "cheat", cheat: { op: "give", speciesId: "mewtwo", level: 100, variantId: "shiny", gender: "female" } },
    ])).cheated).toBe(true);

    // The second save never touches the menu. It only receives.
    const clean: Input[] = [...inTown(SEED).inputs, { t: "trade", give: 0, receive: monster }];
    const report = verifySave(makeSave(SEED, clean));

    expect(report.ok, report.error ?? "").toBe(true);
    // Still honestly false: this log did not cheat, and a flag that meant two
    // things would prove neither.
    expect(report.cheated).toBe(false);

    // But the trade is on the record, with the move it happened on — which is
    // what "the save should contain the trades done at what moves" asks for.
    expect(report.trades).toHaveLength(1);
    expect(report.trades[0].at).toBe(clean.length - 1);
    expect(report.trades[0].got.speciesId).toBe("mewtwo");
    expect(report.trades[0].got.level).toBe(100);
    expect(report.trades[0].gave.speciesId).not.toBe("mewtwo");

    // And the creature standing in the party says where it came from, so a
    // level 100 in a party of level 5s is not something anybody has to notice
    // by eye.
    const arrival = report.party.find((one) => one.speciesId === "mewtwo");
    expect(arrival, "the traded creature is not in the party").toBeDefined();
    expect(arrival!.traded).toBe(true);
    expect(report.party.filter((one) => one.traded)).toHaveLength(1);
  });

  it("VF8: a save that never traded says so, and its party is all its own", () => {
    // The other half, and the one that keeps the row worth reading: if it said
    // something on every save it would say nothing on any of them.
    const world = testWorld(SEED);
    const { inputs } = play(world, 200);
    const report = verifySave(makeSave(SEED, inputs));

    expect(report.trades).toEqual([]);
    expect(report.party.every((one) => !one.traded)).toBe(true);
  });

  it("VF9: a creature traded in and then away is on the record but not in the party", () => {
    // The distinction the two fields exist to draw. `trades` is what happened;
    // `party[].traded` is what is standing there now, and a team check cares
    // about the second.
    const { world, inputs } = inTown(SEED);
    const first = reduce(world, inputs);
    const incoming = { ...first.party[0], uid: 4242, speciesId: "squirtle", level: 40, traded: false };
    const later = { ...first.party[0], uid: 4243, speciesId: "bulbasaur", level: 41, traded: false };

    const log: Input[] = [
      ...inputs,
      { t: "trade", give: 0, receive: incoming },
      { t: "trade", give: 0, receive: later },
    ];
    const report = verifySave(makeSave(SEED, log));

    expect(report.ok, report.error ?? "").toBe(true);
    expect(report.trades).toHaveLength(2);
    // The second trade gave away the first arrival, which is a thing the list
    // records and the party cannot.
    expect(report.trades[1].gave.speciesId).toBe("squirtle");
    expect(report.party[0].speciesId).toBe("bulbasaur");
  });

  it("VF10: a refused input says which kind it was, not only where", () => {
    // "Refused at input 54" is a number to stare at. The kind is usually the
    // whole diagnosis — a `continue` that landed outside a battle means the
    // log and the engine disagree about what phase the game was in, which is a
    // very different bug from a `move` walking into a tree.
    const world = testWorld(SEED);
    const { inputs } = play(world, 60);
    const broken: Input[] = [...inputs, { t: "continue" }, { t: "continue" }, { t: "continue" }];

    const report = verifySave(makeSave(SEED, broken));
    if (report.failedAt === null) return; // the fixture happened to end mid-battle

    expect(report.ok).toBe(false);
    expect(report.error).toContain("continue");
    expect(report.error).toContain(`input ${report.failedAt + 1}`);
  });
});

/**
 * The other thing a log cannot derive: a bracket prize.
 *
 * Same hole as a trade, same treatment. The three on offer are rolled from a
 * tournament that happened in other people's browsers, off a room code this
 * save has never seen, so the creature is carried whole in the input and
 * reported at check-in rather than sitting in the party looking like the rest
 * of them.
 */
describe("what a bracket paid", () => {
  it("VF11: a prize is in the save, at the move it was taken, and marked", () => {
    const world = testWorld(SEED);
    const start: Input[] = [{ t: "pickStarter", index: 0 }];
    const before = reduce(world, start);

    // Whatever a four-player bracket would have offered. Built the same way
    // the screen builds it, so this breaks if the two ever drift.
    const [won] = prizeOffer("ROOMAB", "champ", 4, 9_000).map((one) =>
      atFullHealth(withMoves(one)),
    );
    expect(won.prize).toBe(true);
    expect(won.level).toBe(1);

    const log: Input[] = [...start, { t: "prize", receive: won }];
    const report = verifySave(makeSave(SEED, log));

    expect(report.ok, report.error ?? "").toBe(true);
    expect(report.cheated).toBe(false);
    expect(report.prizes).toHaveLength(1);
    expect(report.prizes[0].at).toBe(log.length - 1);
    expect(report.prizes[0].speciesId).toBe(won.speciesId);
    expect(report.prizes[0].level).toBe(1);

    // It joined the party, renumbered, and says where it came from.
    const arrival = report.party.find((one) => one.speciesId === won.speciesId)!;
    expect(arrival, "the prize is not in the party").toBeDefined();
    expect(arrival.prize).toBe(true);
    expect(arrival.traded).toBe(false);
    expect(report.party.length).toBe(before.party.length + 1);
  });

  it("VF12: a prize survives being traded away, so an origin cannot be laundered", () => {
    // `trade` spreads the arriving creature through and does *not* clear
    // `prize`. Two saves passing one back and forth would otherwise wash the
    // mark off it.
    const world = testWorld(SEED);
    const start: Input[] = [{ t: "pickStarter", index: 0 }];
    const [won] = prizeOffer("ROOMAB", "champ", 16, 9_000).map((one) =>
      atFullHealth(withMoves(one)),
    );

    const mine = reduce(world, [...start, { t: "prize", receive: won }]);
    const handed = mine.party.find((one) => one.prize)!;

    const theirs = verifySave(makeSave(SEED, [...start, { t: "trade", give: 0, receive: handed }]));
    expect(theirs.ok, theirs.error ?? "").toBe(true);

    const arrival = theirs.party.find((one) => one.speciesId === handed.speciesId)!;
    expect(arrival.traded, "a trade is a trade").toBe(true);
    expect(arrival.prize, "and it is still a prize").toBe(true);
    // On both lists, because both are true of it.
    expect(theirs.trades).toHaveLength(1);
    expect(theirs.prizes).toHaveLength(0); // no prize was *taken* in this log
  });

  it("VF14: a cheated creature says so wherever it ends up", () => {
    // The half of `cheated` that travels, and the reason it had to exist:
    // `state.cheated` is a fact about a *log*, so trading the creature into a
    // clean save leaves the flag behind and carries the level 100 across. The
    // mark on the creature goes with it.
    const world = testWorld(SEED);
    const start: Input[] = [{ t: "pickStarter", index: 0 }];
    const dirty = reduce(world, [
      ...start,
      { t: "cheat", cheat: { op: "give", speciesId: "mewtwo", level: 100, variantId: "shiny", gender: "female" } },
    ]);

    const monster = [...dirty.party, ...dirty.box].at(-1)!;
    expect(monster.cheat, "the menu did not mark what it made").toBe(true);

    // Into a save that never touched the menu.
    const clean = verifySave(makeSave(SEED, [...start, { t: "trade", give: 0, receive: monster }]));
    expect(clean.ok, clean.error ?? "").toBe(true);
    expect(clean.cheated, "this log really did not cheat").toBe(false);

    const arrival = clean.party.find((one) => one.speciesId === "mewtwo")!;
    expect(arrival.traded).toBe(true);
    expect(arrival.cheat, "the mark washed off in the trade").toBe(true);
  });

  it("VF15: editing a creature in place marks it, and only that creature", () => {
    // Setting a level, a variant or a gender is making a creature that was
    // never caught that way. Balls and money are not: a save full of free
    // Ultra Balls is a cheated save, and the creatures in it were still
    // caught honestly.
    const world = testWorld(SEED);
    const start: Input[] = [{ t: "pickStarter", index: 0 }];

    const levelled = reduce(world, [
      ...start,
      { t: "cheat", cheat: { op: "setLevel", index: 0, level: 100 } },
    ]);
    expect(levelled.party[0].cheat).toBe(true);
    expect(levelled.party[0].level).toBe(100);

    const rich = reduce(world, [...start, { t: "cheat", cheat: { op: "balls", count: 50 } }]);
    expect(rich.cheated, "the save is still marked").toBe(true);
    expect(rich.party[0].cheat, "but the starter was not touched").toBe(false);
  });

  it("VF13: an ordinary save reports neither, so the rows mean something", () => {
    const world = testWorld(SEED);
    const { inputs } = play(world, 150);
    const report = verifySave(makeSave(SEED, inputs));

    expect(report.prizes).toEqual([]);
    expect(report.party.every((one) => !one.prize)).toBe(true);
    expect(report.party.every((one) => !one.cheat)).toBe(true);
  });
});
