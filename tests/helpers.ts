import { maxHp } from "@/engine/battle";
import { ALL_SPECIES, species } from "@/engine/dex";
import { applyInput, initialState, type GameState, type Input } from "@/engine/engine";
import { expForLevel } from "@/engine/progression";
import { intBelow, rngFor } from "@/engine/rng";
import { fullPp } from "@/engine/pp";
import { TILE, walkable } from "@/engine/terrain";
import { DEFAULT_WORLD, type Gender, type Individual, type StatusId } from "@/engine/types";
import { generateWorld, type World } from "@/engine/world";

/**
 * A world built the way the game builds one, and built once per seed.
 *
 * Memoised, because a world is a pure function of (config, seed) and nothing
 * in this suite mutates one — every test reads. That was a nicety at four
 * biomes and is now the difference between a suite that runs and one that does
 * not: twenty biomes is a hundred and seventy routes and about a second and a
 * half to generate, and the suite asks for a world roughly two hundred times.
 * Five minutes of the same arithmetic, for a value that cannot differ.
 *
 * If a test ever needs to change a world, it must build its own with
 * `generateWorld` rather than editing this one — the cache hands every caller
 * the same object.
 */
const worlds = new Map<string, World>();

export function testWorld(seed: string): World {
  const built = worlds.get(seed);
  if (built) return built;

  const made = generateWorld(DEFAULT_WORLD, seed, ALL_SPECIES);
  worlds.set(seed, made);
  return made;
}

/** Every outdoor route. Interiors are maps too, and almost nothing that is
 * true of a route is true of a room inside a cabin. */
export function outdoorRoutes(world: World) {
  return [...world.routes.values()].filter((route) => route.kind === "route");
}

/**
 * Puts the player inside the building with this job.
 *
 * The daycare and the centre are places you walk into now, so a fixture that
 * stands in the town square and expects to deposit a creature is standing
 * outside a closed door.
 */
export function standInside(
  world: World,
  state: GameState,
  role: "daycare" | "centre" | "mart",
): GameState {
  const room = [...world.routes.values()].find((route) => route.role === role);
  if (!room) throw new Error(`no ${role} in this world`);
  return { ...state, route: room.id, x: room.entry.x, y: room.entry.y };
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
    gender?: Gender;
    hp?: number;
    uid?: number;
    /** Uses left, slot by slot. Full unless a test is about running out. */
    pp?: number[];
    /** None unless a test is about one. */
    abilities?: string[];
    /** Nothing unless a test is about what it is carrying. */
    heldItem?: string | null;
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
    pp: options.pp ?? fullPp(options.moves ?? ["tackle"]),
    abilities: options.abilities ?? [],
    heldItem: options.heldItem ?? null,
    nickname: null,
    traded: false,
    parents: null,
    gender: options.gender ?? "female",
  };
  return { ...built, hp: options.hp ?? maxHp(built) };
}

type Direction = "n" | "s" | "e" | "w";
const DIRECTIONS: readonly Direction[] = ["n", "s", "e", "w"];

/**
 * The first step toward the nearest tile of a kind, or null if there is none.
 *
 * A breadth-first search over walkable tiles, run fresh each step. Wasteful,
 * and it does not matter: this is a fixture generator, not the game.
 */
function stepToward(
  route: { width: number; height: number; tiles: number[] },
  x: number,
  y: number,
  wanted: (x: number, y: number, tile: number) => boolean,
): Direction | null {
  const seen = new Uint8Array(route.width * route.height);
  const queue: { x: number; y: number; first: Direction | null }[] = [{ x, y, first: null }];
  seen[y * route.width + x] = 1;

  for (let head = 0; head < queue.length; head++) {
    const at = queue[head];
    for (const dir of DIRECTIONS) {
      const nx = at.x + (dir === "e" ? 1 : dir === "w" ? -1 : 0);
      const ny = at.y + (dir === "s" ? 1 : dir === "n" ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= route.width || ny >= route.height) continue;

      const index = ny * route.width + nx;
      if (seen[index]) continue;
      seen[index] = 1;

      const tile = route.tiles[index];
      const first = at.first ?? dir;
      if (wanted(nx, ny, tile)) return first;

      // Checked after the target, so something standing on an unwalkable tile
      // can still be walked *at* — which is how a trainer is challenged.
      if (!walkable(tile)) continue;
      queue.push({ x: nx, y: ny, first });
    }
  }
  return null;
}

/**
 * Where the walker tries to go next, best candidate first.
 *
 * A uniform random walk makes a terrible fixture. It used to be enough to
 * wander north and south off a straight path, because the path was a cross
 * and everything beside it was tall grass. On the built world it is not:
 * routes are 44x34, most of the ground is meadow you can cross without
 * meeting anything, and the tall grass sits in a handful of clumps. A random
 * walk on that produced 499 moves and no fights at all — a determinism test
 * over a log of pure footsteps, covering none of the battle system.
 *
 * So the walker hunts. Off the grass it searches for the nearest patch and
 * steps toward it; on the grass it mills about, which is what triggers
 * encounters. Every direction stays as a fallback, so it can never wedge
 * itself into a corner, and an occasional eastward push carries it out to the
 * higher rings rather than farming ring one forever.
 */
export function walkCandidates(world: World, state: GameState, rng: () => number): Input[] {
  const route = world.routes.get(state.route);
  const order: Direction[] = [];

  if (!route || route.kind !== "route") {
    // Town and interiors are lobbies rather than anything under test: leave.
    const midY = route ? Math.floor(route.height / 2) : 9;
    if (state.y < midY) order.push("s");
    else if (state.y > midY) order.push("n");
    else order.push("e");
    return [...order, ...DIRECTIONS].map((dir) => ({ t: "move", dir }) as Input);
  }

  const here = route.tiles[state.y * route.width + state.x];
  const roam: Direction[] = ["n", "n", "s", "s", "e", "w"];

  // Somebody still standing on this route, if there is one. Hunted rarely and
  // deliberately: the walker got so good at finding grass that it stopped
  // meeting anybody at all, and the probe's trainer battles fell to zero while
  // its wild ones went up thirty-fold.
  const rival = (world.trainers.get(route.id) ?? []).find(
    (trainer) => !state.beaten.includes(trainer.id),
  );

  // The pull toward a rival is not re-rolled: a one-in-six nudge each step
  // never accumulates against a four-in-six pull the other way, and the walker
  // spent five thousand steps on a route with somebody standing on it without
  // ever arriving. Unbeaten people are dealt with first, then the grass.
  if (rival) {
    // Unconditionally, and first. Any share left to wandering is a share the
    // walker spends drifting back out of arm's reach — it reached a rival's
    // neighbouring tile exactly once in four thousand steps and wandered off
    // again, and the probe recorded no trainer battles at all. Wild encounters
    // are not lost by this: the way to somebody standing on open ground runs
    // through the grass either side of them.
    order.push(stepToward(route, state.x, state.y, (x, y) => x === rival.x && y === rival.y) ?? "e");
  } else if (here === TILE.GRASS && intBelow(rng, 4) !== 0) {
    order.push(roam[intBelow(rng, roam.length)]);
  } else if (intBelow(rng, 12) === 0) {
    order.push("e");
  } else {
    order.push(stepToward(route, state.x, state.y, (_x, _y, tile) => tile === TILE.GRASS) ?? "e");
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

  for (let i = 0; inputs.length < count && i < count * 16; i++) {
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
