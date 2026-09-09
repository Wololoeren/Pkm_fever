import { maxHp } from "@/engine/battle";
import { ALL_SPECIES, species } from "@/engine/dex";
import { applyInput, initialState, type GameState, type Input } from "@/engine/engine";
import { expForLevel } from "@/engine/progression";
import { intBelow, rngFor } from "@/engine/rng";
import { DEFAULT_WORLD, type Individual, type StatusId } from "@/engine/types";
import { generateWorld, HUB_ID, type World } from "@/engine/world";

/** A world built the way the game builds one. */
export function testWorld(seed: string): World {
  return generateWorld(DEFAULT_WORLD, seed, ALL_SPECIES);
}

/**
 * A creature built to order, for tests that need a specific matchup rather
 * than whatever the world happened to place. Everything defaults to something
 * neutral so a test only states the part it cares about.
 */
export function creature(
  speciesId: string,
  options: {
    level?: number;
    moves?: string[];
    iv?: number;
    natureId?: string;
    variantId?: string;
    status?: StatusId | null;
    hp?: number;
    uid?: number;
  } = {},
): Individual {
  const level = options.level ?? 50;
  const iv = options.iv ?? 31;
  const built: Individual = {
    uid: options.uid ?? 1,
    speciesId: species(speciesId).id,
    level,
    exp: expForLevel(level),
    ivs: { hp: iv, atk: iv, def: iv, spa: iv, spd: iv, spe: iv },
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    natureId: options.natureId ?? "hardy",
    variantId: options.variantId ?? "normal",
    hp: 0,
    status: options.status ?? null,
    sleepTurns: options.status === "slp" ? 3 : 0,
    moves: options.moves ?? ["tackle"],
    nickname: null,
    traded: false,
    parents: null,
  };
  return { ...built, hp: options.hp ?? maxHp(built) };
}

type Direction = "n" | "s" | "e" | "w";
const DIRECTIONS: readonly Direction[] = ["n", "s", "e", "w"];

/**
 * Where the walker tries to go next, best candidate first.
 *
 * A uniform random walk makes a terrible fixture. The hub is a 24x18 room
 * whose four exits are one tile each, so a random walk spends hundreds of
 * steps failing to find one; and on a route, the entry tile sits one step
 * from the western exit, so any real chance of going west sends the walker
 * straight back to the hub again. The first attempt at this produced 495
 * moves and 12 steps in grass, which would have made the replay test pass
 * while covering none of the battle system.
 *
 * So: beeline out of the hub, which is a lobby rather than anything under
 * test, and wander north/south with an eastward drift once on a route — north
 * and south step off the horizontal path into the grass, east leads outward
 * into higher rings. Every direction stays available as a fallback, so the
 * walker can never wedge itself into a corner.
 */
function walkCandidates(world: World, state: GameState, rng: () => number): Input[] {
  const route = world.routes.get(state.route);
  const midY = route ? Math.floor(route.height / 2) : 9;
  const order: Direction[] = [];

  if (state.route === HUB_ID) {
    if (state.y < midY) order.push("s");
    else if (state.y > midY) order.push("n");
    else order.push("e");
  } else {
    const weighted: Direction[] = ["n", "n", "n", "n", "s", "s", "s", "s", "e", "e", "e"];
    order.push(weighted[intBelow(rng, weighted.length)]);
  }

  return [...order, ...DIRECTIONS].map((dir) => ({ t: "move", dir }) as Input);
}

/**
 * Plays a legal session of a given length, choosing inputs from its own seeded
 * generator so the log is reproducible.
 *
 * Illegal moves — walking into a tree, into the map edge — are discarded
 * rather than recorded, so what comes back is a log the engine will accept
 * without complaint. That matters: a replay test whose fixture contains an
 * illegal input tests the error path instead of determinism.
 */
export function play(world: World, count: number, salt = "walk"): { inputs: Input[]; state: GameState } {
  let state = initialState(world);
  const inputs: Input[] = [];

  for (let i = 0; inputs.length < count && i < count * 12; i++) {
    const rng = rngFor(salt, i);
    const candidates: Input[] = [];

    if (state.phase === "starter") {
      candidates.push({ t: "pickStarter", index: intBelow(rng, world.starters.length) });
    } else if (state.phase === "battleEnd") {
      candidates.push({ t: "continue" });
    } else if (state.phase === "battle") {
      const battle = state.battle!;
      // Side 0 is us. Reading the array itself here rather than its first
      // element would be permanently truthy, and the walker would offer
      // nothing but switches — which is exactly what it did once
      // `awaitingSwitch` became a pair.
      if (battle.awaitingSwitch[0]) {
        // Only a replacement is legal; offer every slot and let the engine
        // reject the fainted ones.
        for (let i = 0; i < state.party.length; i++) candidates.push({ t: "switch", partyIndex: i });
      } else {
        // Weighted toward fighting, so the log exercises damage, status and
        // levelling rather than being a sequence of thrown balls.
        const die = intBelow(rng, 10);
        if (die === 0) candidates.push({ t: "flee" });
        else if (die <= 2) candidates.push({ t: "ball" });
        for (let i = 0; i < 4; i++) candidates.push({ t: "fight", moveIndex: intBelow(rng, 4) });
        candidates.push({ t: "fight", moveIndex: 0 });
      }
    } else {
      candidates.push(...walkCandidates(world, state, rng));
    }

    for (const input of candidates) {
      try {
        state = applyInput(world, state, input);
        inputs.push(input);
        break;
      } catch {
        // Blocked or out of phase; try the next candidate.
      }
    }
  }

  return { inputs, state };
}
