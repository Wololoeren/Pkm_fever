import { describe, expect, it } from "vitest";
import { CRITTERS } from "@/engine/critters";
import { ITEMS, item as itemSpec } from "@/engine/items";
import { NPCS } from "@/engine/npc";
import { QUESTS, quest as questSpec } from "@/engine/quests";
import { TOWNS, TOWN_TRAINERS } from "@/engine/towns";
import { applyInput, initialState, type GameState } from "@/engine/engine";
import { creature, outdoorRoutes, testWorld } from "./helpers";

/**
 * The three outer towns, and the homages they are built out of.
 *
 * Each borrows the shape of a television programme — a mountain town where the
 * awful is unremarkable, a future that turned out to be a job, and a garage
 * with a hole in reality in it — and everything in the town leans the same way:
 * the people, what they say, the jobs they hand out, the shelf in the Mart and
 * the creatures pottering about.
 *
 * This file is the manifest. Listing every nod by id is the only way "at least
 * ten of them" can be a fact rather than an impression, and it is what stops a
 * town quietly losing half its cast to a refactor that only looked like it was
 * about something else. If a nod is deleted on purpose, this list is where you
 * say so.
 */

/** Every reference, by the id of the thing that carries it. */
const NODS: Record<string, { town: string; nods: readonly string[] }> = {
  southpass: {
    town: "town-1",
    nods: [
      "sp-hooded", // the boy nobody can understand, who dies weekly
      "sp-witness", // and the friend who reacts to it, every time
      "sp-gnome", // a three-phase plan with a hole in the middle
      "phase-two", // ...handed out as a job
      "sp-cook", // the school cook who answers everything with soup
      "sp-teacher", // the schoolmaster who lets his hand puppet talk
      "sp-moral", // the boy who ends the week with a moral, then leaves
      "sp-scout", // the cryptid nobody believes in
      "the-cryptid", // ...which is three animals, fetched as three animals
      "town-cartwright", // the small boy with strong views on being respected
      "town-cryptid", // man, bear and pig, fielded as a man, a bear and a pig
      "cheesypuffs", // the snack
      "schoolgruel", // what the cook is ladling
      "gnomepants", // phase one
      "sp-mountain-lion", // the town animal, unbothered by the snow
      "sp-hall-monitor", // and the one guarding the school gate
    ],
  },
  newWillow: {
    town: "town-2",
    nods: [
      "nw-thawed", // the delivery boy who was in a freezer for a while
      "nw-professor", // the professor with splendid news
      "good-news", // ...which is a job that will probably kill you
      "nw-doctor", // the doctor nobody visits, who is a crustacean
      "nw-captain", // the one-eyed captain who has crashed everything
      "nw-clerk", // the bureaucrat, thriving at Grade Thirty-Six
      "the-inventory", // ...and his form nine-b
      "nw-lucky", // the one who won the tour of the factory
      "town-bendo", // the bending unit with a drinking problem
      "town-lrrr", // and the one who announces which planet he is from
      "slurm", // the drink
      "bachelorchow", // now with flavour
      "doomsdaydevice", // one of several
      "nw-hypnotoad", // the toad you should not look at
      "nw-nibbler", // the small thing that ate something enormous
    ],
  },
  sanchford: {
    town: "town-3",
    nods: [
      "sf-grandfather", // the drunk with a hole in his garage wall
      "one-more-adventure", // ...and the one job that is never one job
      "sf-grandson", // the grandson, who would rather not
      "sf-birdman", // the solemn friend with a language for it
      "sf-squanch", // the one who has a word that does everything
      "sf-television", // eight hundred million channels of somewhere else
      "sf-sauce", // the man who has made his peace with the sauce
      "the-sauce", // ...as a job
      "town-pickle", // he turned himself into a pickle
      "town-council", // a council of himselves, fielded as five Dittos
      "meeseeksbox", // exists to do one thing, then gratefully stops
      "plumbus", // everyone has one
      "szechuansauce", // nine years of plans
      "sf-pickle-jar", // the jar, afterwards
      "sf-schwifty", // and something dancing about it
    ],
  },
};

/** Everything the game knows about, by id, so a nod can be found wherever it lives. */
function everythingById(): Map<string, string> {
  const out = new Map<string, string>();
  for (const spec of NPCS) out.set(spec.id, "npc");
  for (const spec of QUESTS) out.set(spec.id, "quest");
  for (const spec of ITEMS) out.set(spec.id, "item");
  for (const spec of TOWN_TRAINERS) out.set(spec.id, "trainer");
  for (const spec of CRITTERS) out.set(spec.id, "critter");
  return out;
}

describe("the three outer towns", () => {
  it("Z1: each of them carries at least ten references, and all of them exist", () => {
    const known = everythingById();

    for (const [name, { nods }] of Object.entries(NODS)) {
      expect(nods.length, `${name} is thin`).toBeGreaterThanOrEqual(10);
      expect(new Set(nods).size, `${name} lists something twice`).toBe(nods.length);

      for (const id of nods) {
        expect(known.has(id), `${name}: ${id} is on the list and nowhere in the game`).toBe(true);
      }
    }

    // And no two towns claim the same thing.
    const all = Object.values(NODS).flatMap((entry) => entry.nods);
    expect(new Set(all).size, "two towns claim one reference").toBe(all.length);
  });

  it("Z2: they are spread across the kinds of thing a town is made of", () => {
    // A town that is ten NPCs is a town of people standing about saying words.
    // The point of doing this across quests, battles, items and creatures is
    // that the homage is something you *do* rather than something you read.
    const known = everythingById();

    for (const [name, { nods }] of Object.entries(NODS)) {
      const kinds = new Set(nods.map((id) => known.get(id)));
      expect(kinds.size, `${name} is all one kind of thing: ${[...kinds]}`).toBeGreaterThanOrEqual(4);

      for (const wanted of ["npc", "quest", "item", "trainer", "critter"]) {
        expect(kinds.has(wanted), `${name} has no ${wanted}`).toBe(true);
      }
    }
  });

  it("Z3: everybody, everything and every creature actually turns up in a world", () => {
    for (const seed of ["A1", "B2", "C3"]) {
      const world = testWorld(seed);

      const people = new Set([...world.npcs.values()].flat().map((who) => who.id));
      const fighters = new Set([...world.trainers.values()].flat().map((who) => who.id));
      const standing = new Set([...world.critters.values()].flat().map((one) => one.id));

      for (const { nods } of Object.values(NODS)) {
        for (const id of nods) {
          if (NPCS.some((spec) => spec.id === id)) {
            expect(people.has(id), `${seed}: ${id} was never placed`).toBe(true);
          }
          if (TOWN_TRAINERS.some((spec) => spec.id === id)) {
            expect(fighters.has(id), `${seed}: ${id} was never placed`).toBe(true);
          }
          if (CRITTERS.some((spec) => spec.id === id)) {
            expect(standing.has(id), `${seed}: ${id} was never placed`).toBe(true);
          }
        }
      }
    }
  });

  it("Z4: the cast of a town is in that town", () => {
    // The whole point is that a town has a character. Somebody written for
    // Sanchford who ends up in Hearth is a joke with the setup missing.
    for (const seed of ["A1", "B2"]) {
      const world = testWorld(seed);

      for (const [name, { town, nods }] of Object.entries(NODS)) {
        for (const id of nods) {
          const where =
            [...world.npcs].find(([, here]) => here.some((one) => one.id === id))?.[0] ??
            [...world.trainers].find(([, here]) => here.some((one) => one.id === id))?.[0] ??
            [...world.critters].find(([, here]) => here.some((one) => one.id === id))?.[0];
          if (!where) continue;

          // Indoors counts as in the town it is indoors in.
          const route = world.routes.get(where)!;
          const outer = route.kind === "interior" ? (route.parent ?? where) : where;
          expect(outer, `${seed}: ${name}'s ${id} is on ${outer}`).toBe(town);
        }
      }
    }
  });

  it("Z5: every job a town hands out can actually be finished", () => {
    // A fetch quest for something nothing in the world places is a job that
    // cannot be done, and it looks exactly like a job that can. Two of these
    // were written that way and this is what caught them.
    const world = testWorld("A1");
    const findable = new Set(
      [...world.pickups.values()].flat().map((drop) => drop.item),
    );
    const given = new Set(
      NPCS.flatMap((who) => (who.kind === "gift" && who.item ? [who.item] : [])),
    );
    const paid = new Set(QUESTS.flatMap((one) => (one.reward.item ? [one.reward.item] : [])));

    for (const { nods } of Object.values(NODS)) {
      for (const id of nods) {
        if (!QUESTS.some((one) => one.id === id)) continue;
        const goal = questSpec(id).goal;
        if (goal.t !== "carryItem") continue;

        expect(
          findable.has(goal.item) || given.has(goal.item) || paid.has(goal.item),
          `${id} wants ${itemSpec(goal.item).name}, which nothing in the world hands out`,
        ).toBe(true);
      }
    }
  });


  it("Z7: the people standing in a town will actually fight you, with the written team", () => {
    // A town trainer is an ordinary `TrainerSpec` on an ordinary map, so
    // walking into one goes through the same door as walking into anybody out
    // on a route. What is different is the team, and the team is the joke: five
    // of the same creature, or a man and a bear and a pig.
    const world = testWorld("A1");
    const state = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    for (const spec of TOWN_TRAINERS) {
      const placed = (world.trainers.get(spec.town) ?? []).find((one) => one.id === spec.id);
      expect(placed, `${spec.id} is not standing in ${spec.town}`).toBeTruthy();

      // The written team, in the written order, at the written levels.
      expect(placed!.team).toEqual(spec.team);
      expect(placed!.name).toBe(spec.name);

      const beside: GameState = {
        ...state,
        route: spec.town,
        x: placed!.x - 1,
        y: placed!.y,
        party: [creature("machamp", { uid: 1, level: 60, moves: ["tackle"] })],
      };
      const fight = applyInput(world, beside, { t: "move", dir: "e" });

      expect(fight.phase, `${spec.id} did not fight`).toBe("battle");
      expect(fight.battle?.tag).toContain(spec.id);
      expect(fight.battle?.sides[1].team.length).toBe(spec.team.length);
      expect(fight.battle?.sides[1].team[0].speciesId).toBe(spec.team[0].speciesId);
    }
  });

  it("Z6: the towns are named, and the three outer ones are not Hearth", () => {
    expect(TOWNS.length).toBe(4);
    expect(TOWNS[0].name).toBe("Hearth");

    const named = TOWNS.map((spec) => spec.name);
    expect(new Set(named).size).toBe(named.length);

    for (const [, { town }] of Object.entries(NODS)) {
      const spec = TOWNS.find((one) => one.id === town);
      expect(spec, `${town} is not a town`).toBeTruthy();
      // Every one of them has somewhere to heal and somewhere to shop, or a
      // town three hops from anywhere is a row of houses.
      expect(spec!.roles).toContain("centre");
      expect(spec!.roles).toContain("mart");
    }

    // And they are places, not routes.
    const world = testWorld("A1");
    for (const spec of TOWNS) {
      const route = world.routes.get(spec.id)!;
      expect(route.kind).toBe("town");
      expect(route.label).toBe(spec.name);
      expect(outdoorRoutes(world).some((one) => one.id === spec.id)).toBe(false);
    }
  });
});
