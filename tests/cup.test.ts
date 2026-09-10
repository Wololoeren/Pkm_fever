import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { maxHp } from "@/engine/battle";
import { ALL_SPECIES, move as moveById, species as speciesById } from "@/engine/dex";
import {
  contender as cupSpec,
  cupEffort,
  cupMoveset,
  cupNature,
  CUP_ABILITIES,
  CUP_BIOME,
  CUP_IDS,
  CUP_RING,
  CUP_ROSTER,
  CUP_SIZE,
} from "@/engine/cup";
import {
  applyInput,
  claimRefusal,
  cupIdOf,
  cupTeam,
  initialState,
  offerRefusal,
  questViewOf,
  type GameState,
} from "@/engine/engine";
import { countOf, item } from "@/engine/items";
import { displayPower } from "@/engine/moves";
import { nature } from "@/engine/natures";
import { NPCS, type NpcKind } from "@/engine/npc";
import { progressOf, quest as questSpec, QUESTS } from "@/engine/quests";
import { EV_MAX_TOTAL, IV_MAX } from "@/engine/stats";
import { DEFAULT_WORLD, STAT_IDS } from "@/engine/types";
import { CUP_LABEL, routeId } from "@/engine/world";
import { creature, testWorld } from "./helpers";

/**
 * The Cup: a house at the far end of the ash flats with five people in it.
 *
 * What is worth guarding here is not "does the battle work" — battle.ts is
 * tested to death elsewhere — but the four promises the feature makes, each of
 * which is the sort of thing that can quietly stop being true:
 *
 *   The house **exists on every seed**. It is one route in the world and six
 *   people are written to be standing in it, so a generator that declines to
 *   find room is a quest with no end. The Appraiser's cabin taught this lesson
 *   the expensive way: he stood outdoors on every seed for weeks.
 *
 *   The five are **hard**. Every input to that — perfect IVs, the full 510,
 *   two abilities, four moves that actually do something — is a line of code
 *   that could be deleted without anything failing to compile.
 *
 *   The five **do not scale**. The one thing the Cup is that a gym is not.
 *
 *   The chain **holds end to end**: eight badges buy an invitation, the
 *   invitation buys your name on a list, the list is what the five will
 *   answer to, and beating all five buys the Cup.
 */

const SEEDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];

/** The state of somebody standing in the house with a team worth fielding. */
function atTheDoor(seed: string): { world: ReturnType<typeof testWorld>; state: GameState } {
  const world = testWorld(seed);
  const house = world.routes.get(`${routeId(CUP_BIOME, CUP_RING)}:cup`);
  if (!house) throw new Error(`${seed} grew no house`);

  const base = initialState(world);
  return {
    world,
    state: {
      ...base,
      phase: "field",
      route: house.id,
      x: house.entry.x,
      y: house.entry.y,
      party: [creature("machamp", { uid: 1, level: 100, moves: ["closecombat"] })],
    },
  };
}

/** Stands next to somebody in the house and starts talking to them. */
function talkingTo(world: ReturnType<typeof testWorld>, state: GameState, id: string): GameState {
  const person = (world.npcs.get(state.route) ?? []).find((who) => who.id === id);
  if (!person) throw new Error(`${id} is not in ${state.route}`);
  return { ...state, x: person.x, y: person.y + 1, talking: id };
}

describe("the house at the far end", () => {
  it("C1: it is on the outermost ring, indoors, on every seed, with all six inside", () => {
    expect(CUP_RING).toBe(DEFAULT_WORLD.rings);

    for (const seed of SEEDS) {
      const world = testWorld(seed);
      const house = world.routes.get(`${routeId(CUP_BIOME, CUP_RING)}:cup`);

      expect(house, `${seed}: no house`).toBeTruthy();
      expect(house!.role, seed).toBe("cup");
      expect(house!.kind, seed).toBe("interior");
      expect(house!.label, seed).toBe(CUP_LABEL);

      // Everybody written to be in it, actually in it. A person who is
      // sometimes outside in the rain is a bug with a name.
      const inside = (world.npcs.get(house!.id) ?? []).map((who) => who.id);
      for (const id of CUP_IDS) expect(inside, `${seed}: ${id}`).toContain(id);
      expect(inside, `${seed}: steward`).toContain("cup-steward");

      // And a door out here that says what it is, so it can be found at all.
      const outside = world.routes.get(routeId(CUP_BIOME, CUP_RING))!;
      expect(outside.doors.some((door) => door.to === house!.id), seed).toBe(true);
      expect(outside.signs.some((sign) => sign.text === CUP_LABEL), seed).toBe(true);
    }
  });

  it("C2: nobody stands on anybody, and everybody can be reached", () => {
    for (const seed of SEEDS) {
      const world = testWorld(seed);
      const house = world.routes.get(`${routeId(CUP_BIOME, CUP_RING)}:cup`)!;
      const people = world.npcs.get(house.id) ?? [];

      const spots = new Set(people.map((who) => `${who.x},${who.y}`));
      expect(spots.size, `${seed}: two people on one tile`).toBe(people.length);

      // Talking needs a tile beside them, so a person walled in on all four
      // sides is a person you cannot speak to.
      for (const who of people) {
        const beside = [
          [0, 1],
          [0, -1],
          [1, 0],
          [-1, 0],
        ].some(([dx, dy]) => {
          const x = who.x + dx;
          const y = who.y + dy;
          if (x < 1 || y < 1 || x >= house.width - 1 || y >= house.height - 1) return false;
          if (spots.has(`${x},${y}`)) return false;
          return !house.props.some((prop) => prop.x === x && prop.y === y);
        });
        expect(beside, `${seed}: ${who.id} is boxed in`).toBe(true);
      }
    }
  });
});

describe("what the five bring", () => {
  it("C3: six each, all at the stated level, bred rather than caught", () => {
    const { world, state } = atTheDoor("alpha");

    for (const spec of CUP_ROSTER) {
      const team = cupTeam(world, state, spec.id);
      expect(team.length, spec.id).toBe(CUP_SIZE);

      for (const one of team) {
        // All six at the same level: nobody in this house pads a team out.
        expect(one.level, `${spec.id} level`).toBe(spec.level);

        // Perfect where it counts, the whole 510 spent, and a nature chosen.
        for (const stat of STAT_IDS) expect(one.ivs[stat], `${spec.id} iv`).toBe(IV_MAX);
        expect(STAT_IDS.reduce((sum, stat) => sum + one.evs[stat], 0), `${spec.id} ev`).toBe(
          EV_MAX_TOTAL,
        );
        const chosen = nature(one.natureId);
        expect(chosen.plus, `${spec.id} nature`).not.toBeNull();
        expect(chosen.minus, `${spec.id} nature`).not.toBeNull();

        // Two abilities apiece, which in the wild is one creature in a hundred.
        expect(one.abilities.length, `${spec.id} abilities`).toBe(CUP_ABILITIES);
        expect(new Set(one.abilities).size, `${spec.id} duplicate ability`).toBe(
          one.abilities.length,
        );

        expect(one.hp, `${spec.id} health`).toBe(maxHp(one));
      }

      // Six distinct: a team that lost a slot to the dice is a team of five.
      expect(new Set(team.map((one) => one.speciesId)).size, spec.id).toBe(CUP_SIZE);
    }
  });

  it("C4: a slanted contender fields its own type, and the Sovereign fields anything", () => {
    const { world, state } = atTheDoor("alpha");

    for (const spec of CUP_ROSTER) {
      const team = cupTeam(world, state, spec.id);
      if (spec.slant === null) continue;

      for (const one of team) {
        expect(
          speciesById(one.speciesId).types,
          `${spec.id} fielded a ${speciesById(one.speciesId).name}`,
        ).toContain(spec.slant);
      }
    }

    // And exactly one of them leans on nothing, which is what makes it the
    // last one rather than a sixth gym.
    expect(CUP_ROSTER.filter((spec) => spec.slant === null).length).toBe(1);
    expect(CUP_ROSTER[CUP_ROSTER.length - 1].slant).toBeNull();
  });

  it("C5: every one of the thirty can hurt you", () => {
    // The reason `cupMoveset` exists. `movesAtLevel` takes the last four a
    // species learned, and at level a hundred that is close to random:
    // Calyrex-Ice learns Leech Seed, Heal Pulse, Solar Beam and Future Sight
    // last, so a 453-Attack physical monster used to turn up holding two heals
    // and cannot beat anybody. This is the guard on that.
    const { world, state } = atTheDoor("alpha");

    for (const spec of CUP_ROSTER) {
      for (const one of cupTeam(world, state, spec.id)) {
        const name = `${spec.id}/${speciesById(one.speciesId).name}`;
        expect(one.moves.length, `${name} knows nothing`).toBe(4);

        const damaging = one.moves.filter(
          (moveId) => (displayPower(moveById(moveId)) ?? 0) > 0,
        );
        expect(damaging.length, `${name} has ${damaging.length} damaging moves`).toBeGreaterThanOrEqual(3);

        // And every slot full, so the tank is a real number.
        expect(one.pp.length, `${name} pp`).toBe(one.moves.length);
      }
    }
  });

  it("C6: the moveset favours what the creature is actually for", () => {
    // A physical attacker carrying four special moves is a team member the
    // player never has to think about.
    for (const speciesId of ["machamp", "alakazam", "snorlax", "gengar"]) {
      const base = speciesById(speciesId).base;
      const moves = cupMoveset(speciesId, 100, base);
      const wanted = base.atk >= base.spa ? "physical" : "special";

      const right = moves.filter((moveId) => moveById(moveId).category === wanted).length;
      expect(right, `${speciesId} brought ${moves.join("/")}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("C7: the Cup does not scale — it is the same wall on your first badge as your eighth", () => {
    // The one decision the Cup takes opposite to a gym. A gym reads how far
    // you have come; this reads nothing, so "am I ready" is a number you can
    // look up rather than a thing you find out.
    const { world, state } = atTheDoor("alpha");

    const fresh = cupTeam(world, state, "cup-sovereign");
    const veteran = cupTeam(
      world,
      {
        ...state,
        tick: 90_000,
        badges: ["gym-bug", "gym-water", "gym-rock", "gym-grass", "gym-fire", "gym-electric", "gym-ghost", "gym-dragon"],
      },
      "cup-sovereign",
    );

    expect(veteran.map((one) => `${one.speciesId}:${one.level}`)).toEqual(
      fresh.map((one) => `${one.speciesId}:${one.level}`),
    );

    // Levels climb across the five and end at the ceiling.
    const levels = CUP_ROSTER.map((spec) => spec.level);
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
    expect(levels[levels.length - 1]).toBe(100);
  });
});

describe("the effort and the nature, derived rather than authored", () => {
  it("C8: the spread is 252/252/6 into the stats the species is best at", () => {
    const base = speciesById("machamp").base;
    const evs = cupEffort(base);

    expect(STAT_IDS.reduce((sum, stat) => sum + evs[stat], 0)).toBe(EV_MAX_TOTAL);
    expect([...STAT_IDS].map((stat) => evs[stat]).sort((a, b) => b - a)).toEqual([
      252, 252, 6, 0, 0, 0,
    ]);

    // And it lands on the two it is best at, not on any two.
    const ranked = [...STAT_IDS].sort((a, b) => base[b] - base[a] || STAT_IDS.indexOf(a) - STAT_IDS.indexOf(b));
    expect(evs[ranked[0]]).toBe(252);
    expect(evs[ranked[1]]).toBe(252);
  });

  it("C9: every species in the dex resolves to a real, non-neutral nature", () => {
    // The pair is (best battle stat, worst battle stat). All twenty trades
    // exist in the vanilla twenty-five, so there is no fallback to reason
    // about — but "no fallback" is a claim, and this is the claim being tested
    // against all 1,100-odd of them rather than against four.
    for (const entry of ALL_SPECIES) {
      const chosen = nature(cupNature(entry.base));
      expect(chosen.plus, entry.id).not.toBeNull();
      expect(chosen.minus, entry.id).not.toBeNull();
      expect(chosen.plus, entry.id).not.toBe(chosen.minus);
    }
  });
});

describe("the chain", () => {
  it("C10: the Steward will not write your name down without the invitation", () => {
    const { world, state } = atTheDoor("alpha");
    const talking = talkingTo(world, state, "cup-steward");

    const why = offerRefusal(world, talking);
    expect(why).toBe(`they will not talk terms without ${item("worldcup").name}`);
    expect(() => applyInput(world, talking, { t: "npcAccept" })).toThrow();

    // With it in the bag, he will.
    const invited = { ...talking, bag: { ...talking.bag, worldcup: 1 } };
    expect(offerRefusal(world, invited)).toBeNull();

    const taken = applyInput(world, invited, { t: "npcAccept" });
    expect(taken.questsTaken).toContain("the-cup");
    // And it is never spent: he wanted to see one, not collect one.
    expect(countOf(taken.bag, "worldcup")).toBe(1);
  });

  it("C11: the invitation is what eight badges buy, and it is the gate on this", () => {
    expect(questSpec("world-cup").reward.item).toBe("worldcup");
    expect(questSpec("world-cup").goal).toEqual({ t: "badges", count: 8 });
    expect(questSpec("the-cup").needs).toBe("worldcup");

    // Exactly one quest has a price of admission. If a second ever does, the
    // panel that explains this one should be looked at again.
    const gated = QUESTS.filter((spec) => spec.needs !== undefined);
    expect(gated.map((spec) => spec.id)).toEqual(["the-cup"]);
  });

  it("C12: the five will not play until your name is down", () => {
    const { world, state } = atTheDoor("alpha");

    for (const id of CUP_IDS) {
      const talking = talkingTo(world, state, id);
      expect(offerRefusal(world, talking), id).toBe("your name is not down - speak to the Steward");
      expect(() => applyInput(world, talking, { t: "npcAccept" })).toThrow();
    }

    // Name down, and they will.
    const entered = { ...state, questsTaken: ["the-cup"] };
    for (const id of CUP_IDS) {
      expect(offerRefusal(world, talkingTo(world, entered, id)), id).toBeNull();
    }
  });

  it("C13: beating one records it by name, and beating all five pays the Cup", () => {
    const { world, state } = atTheDoor("alpha");
    const entered = { ...state, questsTaken: ["the-cup"] };
    const view = (from: GameState) => progressOf(questViewOf(world, from), questSpec("the-cup").goal);

    expect(view(entered)).toEqual({ have: 0, need: 5, done: false });

    // One down.
    const one = { ...entered, beaten: [CUP_IDS[0]] };
    expect(view(one)).toEqual({ have: 1, need: 5, done: false });
    expect(claimRefusal(world, one, "the-cup")).toBe("not done yet");

    // Beating five people who are not in this house does nothing for it — the
    // goal names the five rather than counting a list.
    const elsewhere = { ...entered, beaten: ["meadow-1:0", "meadow-1:1", "marsh-2:0", "marsh-2:1", "ashflats-3:0"] };
    expect(view(elsewhere)).toEqual({ have: 0, need: 5, done: false });

    // All five, and it pays.
    const all = { ...entered, beaten: [...CUP_IDS] };
    expect(view(all)).toEqual({ have: 5, need: 5, done: true });
    expect(claimRefusal(world, all, "the-cup")).toBeNull();

    const paid = applyInput(world, all, { t: "claimQuest", id: "the-cup" });
    expect(paid.questsDone).toContain("the-cup");
    expect(countOf(paid.bag, "thecup")).toBe(1);
    expect(paid.money).toBe(all.money + questSpec("the-cup").reward.money!);
  });

  it("C14: somebody already beaten will not go again", () => {
    const { world, state } = atTheDoor("alpha");
    const after = { ...state, questsTaken: ["the-cup"], beaten: [CUP_IDS[0]] };

    expect(offerRefusal(world, talkingTo(world, after, CUP_IDS[0]))).toBe("you already beat them");
    // The other four still will.
    expect(offerRefusal(world, talkingTo(world, after, CUP_IDS[1]))).toBeNull();
  });

  it("C15: challenging one starts a Cup battle, and winning it records the name", () => {
    const { world, state } = atTheDoor("alpha");
    const entered = { ...state, questsTaken: ["the-cup"] };

    const started = applyInput(world, talkingTo(world, entered, "cup-bastion"), { t: "npcAccept" });
    expect(started.phase).toBe("battle");
    expect(cupIdOf(started.battle)).toBe("cup-bastion");
    expect(started.battle!.sides[1].team.length).toBe(CUP_SIZE);
    expect(started.talking).toBeNull();
  });

  it("C16: nothing in this house is catchable", () => {
    // The fix that came with it. `battleTurn` used to choose its rules by
    // asking "is this somebody on a route", so every battle that was neither
    // that nor the grass got WILD_RULES and `catchable: true` — a gym leader's
    // level-hundred team was catchable as far as the engine was concerned, and
    // only the UI declined to draw the button.
    const { world, state } = atTheDoor("alpha");
    const entered = {
      ...state,
      questsTaken: ["the-cup"],
      bag: { ...state.bag, ultraball: 20 },
    };

    const started = applyInput(world, talkingTo(world, entered, "cup-bastion"), { t: "npcAccept" });
    expect(() => applyInput(world, started, { t: "ball", item: "ultraball" })).toThrow();
    expect(() => applyInput(world, started, { t: "flee" })).toThrow();
  });

  it("C17: losing to them sends you home patched up, and keeps what you won", () => {
    const { world, state } = atTheDoor("alpha");
    const entered = {
      ...state,
      questsTaken: ["the-cup"],
      beaten: [CUP_IDS[0]],
      party: [creature("magikarp", { uid: 1, level: 5, moves: ["splash"] })],
    };

    let live = applyInput(world, talkingTo(world, entered, "cup-sovereign"), { t: "npcAccept" });
    for (let turn = 0; turn < 200 && live.phase === "battle"; turn++) {
      live = applyInput(world, live, { t: "fight", moveIndex: 0 });
    }

    expect(live.notice).toEqual({ t: "whiteout" });
    // Healed on the way home, and the one already beaten stays beaten.
    expect(live.party.every((one) => one.hp === maxHp(one))).toBe(true);
    expect(live.beaten).toContain(CUP_IDS[0]);
    expect(live.beaten).not.toContain("cup-sovereign");
  });
});

describe("the prize", () => {
  it("C18: the Cup is the largest thing that buys the climb, and is not lying anywhere", () => {
    const spec = item("thecup");
    expect(spec.kind).toBe("breeding");
    expect(spec.climbBonus).toBe(1500);
    expect(spec.stacks).toBe(false);
    // Found nowhere and sold nowhere: it is won, and that is the whole of it.
    expect(spec.price).toBe(0);
    expect(spec.sell).toBe(0);

    // Bigger than everything on the floor, so "the best there is" is true.
    const floor = ["glint", "gleam", "lustre", "radiance", "brilliance"].map(
      (id) => item(id).climbBonus ?? 0,
    );
    expect(spec.climbBonus!).toBeGreaterThan(Math.max(...floor));

    // And it is genuinely not on the floor. `ITEM_FOR_PLACE` and the pickup
    // table are the two ways an item reaches the ground; neither names it.
    const engine = readFileSync(join(process.cwd(), "src", "engine", "engine.ts"), "utf8");
    const world = readFileSync(join(process.cwd(), "src", "engine", "world.ts"), "utf8");
    expect(engine.includes('"thecup"')).toBe(false);
    expect(world.includes('"thecup"')).toBe(false);
  });

  it("C19: no seed leaves one lying about either", () => {
    for (const seed of SEEDS) {
      const found = [...testWorld(seed).pickups.values()]
        .flat()
        .filter((drop) => drop.item === "thecup");
      expect(found, seed).toEqual([]);
    }
  });
});

describe("the roster reads the same everywhere", () => {
  it("C20: the five in the world are the five in cup.ts, in order", () => {
    const written = NPCS.filter((who) => who.kind === "cup").map((who) => who.cupId);
    expect(written).toEqual([...CUP_IDS]);

    // And each of them says what their own spec says, rather than a copy.
    for (const spec of CUP_ROSTER) {
      const placed = NPCS.find((who) => who.cupId === spec.id)!;
      expect(placed.name).toBe(spec.name);
      expect(placed.lines).toEqual(spec.lines);
      expect(cupSpec(spec.id)).toBe(spec);
    }
  });

  it("C21: every kind of person has a colour on the map", () => {
    // Not cosmetic. `person()` assigns the colour to `ctx.fillStyle`, and
    // assigning an invalid value to a canvas context is *ignored* — so a
    // missing entry paints the figure in whatever was set last, which was the
    // shadow. Gym leaders and the Appraiser were being drawn in near-black
    // and nothing failed.
    const source = readFileSync(
      join(process.cwd(), "src", "components", "GameCanvas.tsx"),
      "utf8",
    );
    const block = source.slice(source.indexOf("const NPC_COLOURS"));
    const listed = new Set(
      [...block.slice(0, block.indexOf("};")).matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]),
    );

    const kinds: NpcKind[] = ["hint", "gift", "heal", "trade", "quest", "gym", "buy", "cup"];
    for (const kind of kinds) expect(listed, kind).toContain(kind);
    // And every kind the roster actually uses is one of those.
    for (const who of NPCS) expect(kinds, who.id).toContain(who.kind);
  });
});
