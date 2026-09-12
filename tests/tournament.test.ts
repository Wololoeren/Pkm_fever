import { describe, expect, it } from "vitest";
import { makeSave } from "@/lib/save";
import { entryRefusal, playMatch, runTournament, seedOrder, type Entrant } from "@/lib/tournament";
import { verifySave } from "@/lib/verify";
import { play, testWorld } from "./helpers";

/**
 * Tournament mode.
 *
 * The property is the same one the rest of the project rests on, one level
 * up: two organisers with the same files draw the same bracket and get the
 * same champion, and nobody has to be trusted about a result.
 */

const SEED = "PKMFEVER1";

function entrant(name: string, moves: number, salt: string): Entrant {
  const world = testWorld(SEED);
  const { inputs } = play(world, moves, salt);
  return { name, report: verifySave(makeSave(SEED, inputs)) };
}

describe("tournament mode", () => {
  const entrants = [entrant("ada.json", 300, "a"), entrant("bob.json", 320, "b"), entrant("cy.json", 340, "c")];
  const size = Math.min(...entrants.map((one) => one.report.roster.length));

  it("T1: the check-in refuses what the desk would refuse", () => {
    const [ada] = entrants;
    expect(entryRefusal(ada.report, size, null)).toBeNull();
    expect(entryRefusal({ ...ada.report, cheated: true }, size, null)).toContain("shortcut");
    expect(entryRefusal({ ...ada.report, ok: false }, size, null)).toContain("replay");
    const more = ada.report.roster.length + 1;
    expect(entryRefusal(ada.report, more, null)).toBe(`brings ${ada.report.roster.length}, and ${more} are needed`);
    expect(entryRefusal(ada.report, size, "OTHER1")).toContain("not OTHER1");
  });

  it("T2: three entrants make two rounds with a bye, seeded by hash", () => {
    const result = runTournament(entrants, "CUP1", size);
    expect(result.rounds).toHaveLength(2);
    expect(result.rounds[0]).toHaveLength(2);
    expect(result.rounds[0].filter((match) => match.note === "a bye")).toHaveLength(1);
    expect(result.rounds[1]).toHaveLength(1);
    expect(result.champion).not.toBeNull();

    // The top seed is the lowest hash, and it gets the bye against the gap.
    const ordered = seedOrder(entrants);
    expect(result.rounds[0][0].a).toBe(ordered[0]);
    expect(result.rounds[0][0].b).toBeNull();
  });

  it("T3: the same files and seed give the same champion, and a different seed may not", () => {
    const once = runTournament(entrants, "CUP1", size);
    const twice = runTournament([...entrants].reverse(), "cup1", size);
    expect(twice.champion?.name).toBe(once.champion?.name);
    expect(twice.rounds.map((round) => round.map((match) => match.turns))).toEqual(
      once.rounds.map((round) => round.map((match) => match.turns)),
    );
  });

  it("T4: a match is played to an outcome by the engine, with both sides driven the same way", () => {
    const [ada, bob] = entrants;
    const match = playMatch("CUP1", size, ada, bob);
    expect(match.winner === ada || match.winner === bob).toBe(true);
    expect(match.turns).toBeGreaterThan(0);
    const loser = match.winner === ada ? 1 : 0;
    // Under duel rules the loser has nothing standing, unless it went to the
    // limit and was decided on health.
    if (!match.note) expect(match.left[loser]).toBe(0);
  });

  it("T5: teams start as if from a Center, whatever state the save was in", () => {
    // The first bracket run had a final over in one turn: the loser had saved
    // with one creature standing and one already down.
    const [ada, bob] = entrants;
    const down = { ...bob, report: { ...bob.report, roster: bob.report.roster.map((one) => ({ ...one, hp: 0, status: "psn" as const })) } };
    const match = playMatch("CUP1", size, ada, down);
    // Nobody down before the first blow means the match cannot end on turn one
    // with more than one creature a side.
    if (size > 1) expect(match.turns).toBeGreaterThan(1);
  });
});
