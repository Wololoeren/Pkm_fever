import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  aiAction,
  landsAs,
  resolveTurn,
  startBattle,
  WILD_RULES,
  type Combatant,
} from "@/engine/battle";
import { effectiveness, species as speciesById } from "@/engine/dex";
import { badgesFor } from "@/lib/tags";
import { creature } from "./helpers";

/**
 * What the battle screen says about a battle.
 *
 * Two readouts, one file, because they fail the same way: both of them are a
 * *second* account of something the engine already knows, and a second account
 * is only useful for as long as it agrees with the first. An arrow that
 * promises double damage from a move that cannot touch the target is worse
 * than no arrow, and a creature that has been seeded for four turns with
 * nothing on screen to say so is how Leech Seed came to be reported as doing
 * nothing at all.
 */

const SEED = "PLATE1";
const TAG = "wild:meadow-1:0";

/** A side with nothing going on, which is what most turns look like. */
function quiet(): Combatant {
  return {
    team: [creature("rattata")],
    active: 0,
    stages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  };
}

describe("how a move lands", () => {
  it("M1: the chart's four answers come through in quarters", () => {
    const rattata = creature("rattata");
    const bulbasaur = creature("bulbasaur", { uid: 2 });

    // Normal on Normal.
    expect(landsAs(rattata, rattata, "tackle")).toBe(4);
    // Fire on Grass/Poison: doubled once by the Grass, untouched by the Poison.
    expect(landsAs(rattata, bulbasaur, "ember")).toBe(8);
    // Grass on Grass/Poison: halved twice.
    expect(landsAs(rattata, bulbasaur, "vinewhip")).toBe(1);
  });

  it("M2: nothing to say about a status move or about Struggle", () => {
    const rattata = creature("rattata");
    const misdreavus = creature("misdreavus", { uid: 2 });

    // Null rather than 4, because "neutral" and "the chart does not apply"
    // are different facts and the arrow has to draw nothing for the second.
    expect(landsAs(rattata, rattata, "growl")).toBeNull();
    // Struggle is outside the chart on purpose: a creature out of moves
    // facing a Ghost has to have some way to end the fight.
    expect(landsAs(rattata, misdreavus, "struggle")).toBeNull();
  });

  it("M3: Scrappy reaches a Ghost, and says so before it swings", () => {
    // The guard the whole exported predicate exists for. The type chart says
    // Normal cannot touch a Ghost, full stop; the attacker's own ability says
    // otherwise, and the ability wins. A button reading `effectiveness`
    // directly drew a red cross over a move that then hit for full.
    const scrappy = creature("rattata", { abilities: ["scrappy"] });
    const plain = creature("rattata", { uid: 3 });
    const ghost = creature("misdreavus", { uid: 2 });

    expect(effectiveness("normal", speciesById("misdreavus").types)).toBe(0);
    expect(landsAs(scrappy, ghost, "tackle")).toBe(4);
    expect(landsAs(plain, ghost, "tackle")).toBe(0);

    // And the battle agrees, which is the half that matters.
    const battle = startBattle(SEED, TAG, [scrappy], [ghost]);
    const events = resolveTurn(
      battle,
      [{ t: "fight", moveIndex: 0 }, aiAction(battle)],
      WILD_RULES,
      10,
    ).battle.events;
    expect(events.some((one) => one.t === "damage" && one.side === 1)).toBe(true);
    expect(events.some((one) => one.t === "immune" && one.side === 1)).toBe(false);
  });

  it("M4: an ability that drinks a move counts as no effect", () => {
    // Levitate is not a Flying type, so the chart has nothing to say about it
    // — it reports a clean neutral hit and the move lands for nothing.
    const rattata = creature("rattata", { moves: ["earthquake"] });
    const floating = creature("rattata", { uid: 2, abilities: ["levitate"] });
    const grounded = creature("rattata", { uid: 3 });

    expect(effectiveness("ground", speciesById("rattata").types)).toBe(4);
    expect(landsAs(rattata, floating, "earthquake")).toBe(0);
    expect(landsAs(rattata, grounded, "earthquake")).toBe(4);

    // Water Absorb and its family are the same shape, and heal on top.
    const drinker = creature("rattata", { uid: 4, abilities: ["absorb-water"] });
    expect(landsAs(rattata, drinker, "watergun")).toBe(0);
  });

  it("M5: what it promises is what the turn delivers", () => {
    // Across a spread of matchups: if it says nothing lands, nothing lands;
    // if it says a multiplier, that is the multiplier on the damage event.
    const matchups: [string, string, string][] = [
      ["rattata", "bulbasaur", "ember"],
      ["rattata", "bulbasaur", "vinewhip"],
      ["rattata", "misdreavus", "tackle"],
      ["rattata", "aerodactyl", "thunderbolt"],
      ["rattata", "rattata", "tackle"],
    ];

    for (const [mine, theirs, moveId] of matchups) {
      const ours = creature(mine, { moves: [moveId] });
      const foe = creature(theirs, { uid: 2 });
      const said = landsAs(ours, foe, moveId);

      const battle = startBattle(SEED, `${TAG}:${moveId}:${theirs}`, [ours], [foe]);
      const events = resolveTurn(
        battle,
        [{ t: "fight", moveIndex: 0 }, aiAction(battle)],
        WILD_RULES,
        10,
      ).battle.events;

      const landed = events.find((one) => one.t === "damage" && one.side === 1);
      const refused = events.some((one) => one.t === "immune" && one.side === 1);

      if (said === 0) {
        expect(refused, `${moveId} on ${theirs} was promised nothing`).toBe(true);
      } else if (landed && landed.t === "damage") {
        expect(landed.quarters, `${moveId} on ${theirs}`).toBe(said);
      }
    }
  });
});

describe("what is happening to a creature", () => {
  it("M6: a side with nothing going on wears no badges at all", () => {
    // The row is absent rather than empty, which is why this matters: a plate
    // that grew a blank strip on every creature in perfect health would be a
    // row nobody reads by the time something is actually in it.
    const side = quiet();
    expect(badgesFor(side, side.team[0])).toEqual([]);
  });

  it("M7: a status keeps its own colour and a stage gets a direction", () => {
    const side = quiet();
    side.team[0] = creature("rattata", { status: "brn" });
    side.stages = { atk: 0, def: -2, spa: 0, spd: 0, spe: 1 };

    const badges = badgesFor(side, side.team[0]);
    const burn = badges.find((one) => one.label === "BRN");
    // Not `fall` — the five statuses are conditions rather than directions and
    // have had their own five colours since before this row existed.
    expect(burn?.cls).toBe("st-brn");

    const defence = badges.find((one) => one.key === "stage:def");
    expect(defence?.label).toBe("DEF ↓2");
    expect(defence?.cls).toBe("fall");

    // One stage shows the arrow alone; anything further counts.
    const speed = badges.find((one) => one.key === "stage:spe");
    expect(speed?.label).toBe("SPE ↑");
    expect(speed?.cls).toBe("rise");
  });

  it("M8: the order is fixed rather than the order things happened in", () => {
    // A row that reshuffles itself has to be re-read every turn.
    const side = quiet();
    side.team[0] = creature("rattata", { status: "psn" });
    side.stages = { atk: 0, def: 0, spa: 2, spd: 0, spe: -1 };
    side.aim = { accuracy: -1, evasion: 0 };
    side.volatiles = { seeded: true };
    side.screens = { reflect: 4 };

    expect(badgesFor(side, side.team[0]).map((one) => one.key)).toEqual([
      "status:psn",
      "stage:spa",
      "stage:spe",
      "aim:accuracy",
      "seeded",
      "screen:reflect",
    ]);
  });

  it("M9: every volatile the engine can set has something to show for it", () => {
    // The invariant, and the reason this file exists. A condition the player
    // cannot see is a condition they will report as broken, which is exactly
    // what happened to Leech Seed — it worked, and nothing said so.
    //
    // Read out of the source rather than written down here, because a list
    // written down here is a list that agrees with the engine on the day it
    // was written and never again. `Volatiles` is a TypeScript interface and
    // has no runtime shape to enumerate, so the interface itself is the list.
    const source = readFileSync(join(process.cwd(), "src", "engine", "battle.ts"), "utf8");
    const block = source.match(/export interface Volatiles \{([\s\S]*?)\n\}/);
    expect(block, "the Volatiles interface moved or was renamed").not.toBeNull();

    const fields = [...block![1].matchAll(/^\s{2}(\w+)\?:/gm)].map((one) => one[1]);
    // If this ever drops to a handful the test has stopped testing anything.
    expect(fields.length).toBeGreaterThan(8);

    /** Bookkeeping rather than a condition, and the one honest exemption:
     * `shieldStreak` is how the engine remembers that the last two turns were
     * also spent shielding, so the third one usually fails. It is not
     * something being done to the creature and there is nothing to show. */
    const exempt = new Set(["shieldStreak"]);

    // One value per field that reads as "on". Every kind the engine writes is
    // either a flag, a count or one of two words.
    const on: Record<string, unknown> = {
      seeded: true,
      confusion: 2,
      shield: "protect",
      crit: 1,
      yawn: 1,
      nightmare: true,
      perish: 3,
      trapped: true,
      rooted: true,
      infatuated: true,
      stats: { atk: 40 },
      stockpile: 2,
      sure: true,
      bonded: true,
      wish: 1,
      blessing: true,
      afloat: 3,
      types: ["water"],
      seen: "ghost",
    };

    for (const field of fields) {
      if (exempt.has(field)) continue;
      expect(on[field], `${field} has no test value, so it is untested`).toBeDefined();

      const side = quiet();
      side.volatiles = { [field]: on[field] };
      const badges = badgesFor(side, side.team[0]);
      expect(
        badges.length,
        `nothing on the plate says a creature is ${field}`,
      ).toBeGreaterThan(0);
    }
  });

  it("M10: a screen says how long it has, and a volatile does not pretend to", () => {
    const side = quiet();
    side.screens = { reflect: 3, tailwind: 1 };

    const badges = badgesFor(side, side.team[0]);
    expect(badges.find((one) => one.key === "screen:reflect")?.label).toBe("REFLECT 3");
    // Singular, because "1 turns left" on the last turn of a screen is the
    // sort of thing a player reads once and stops trusting the rest of.
    expect(badges.find((one) => one.key === "screen:tailwind")?.title).toContain("1 turn left");

    // A screen that has run out is gone rather than shown at nought.
    side.screens = { reflect: 0 };
    expect(badgesFor(side, side.team[0])).toEqual([]);
  });

  it("M11: it reads a real battle, and a switch takes the right half away", () => {
    // The lifetimes, out of the engine rather than hand-built. Being seeded
    // belongs to whoever is standing there; a Reflect belongs to the side and
    // survives the switch. The row is the only place both are visible, so it
    // is the only place that can get this wrong.
    const ours = creature("bulbasaur", { level: 50, moves: ["leechseed", "reflect"] });
    const bench = creature("rattata", { level: 50, uid: 3 });
    const theirs = creature("rattata", { level: 50, moves: ["tackle"], uid: 2 });

    let battle = startBattle(SEED, TAG, [ours, bench], [theirs]);
    battle = resolveTurn(
      battle,
      [{ t: "fight", moveIndex: 0 }, aiAction(battle)],
      WILD_RULES,
      10,
    ).battle;
    battle = resolveTurn(
      battle,
      [{ t: "fight", moveIndex: 1 }, aiAction(battle)],
      WILD_RULES,
      10,
    ).battle;

    const theirLabels = () =>
      badgesFor(battle.sides[1], battle.sides[1].team[battle.sides[1].active]).map(
        (one) => one.label,
      );
    const ourKeys = () =>
      badgesFor(battle.sides[0], battle.sides[0].team[battle.sides[0].active]).map(
        (one) => one.key,
      );

    expect(theirLabels(), "the seed never showed up").toContain("SEEDED");
    expect(ourKeys()).toContain("screen:reflect");

    battle = resolveTurn(battle, [{ t: "switch", partyIndex: 1 }, aiAction(battle)], WILD_RULES, 10)
      .battle;

    // Our Reflect is still up over somebody else. Nothing of the appearance
    // that raised it came along.
    expect(ourKeys()).toContain("screen:reflect");
    expect(ourKeys().some((key) => key.startsWith("stage:"))).toBe(false);
  });
});
