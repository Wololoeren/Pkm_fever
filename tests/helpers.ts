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
export function stepToward(
  route: { width: number; height: number; tiles: number[] },
  x: number,
  y: number,
  wanted: (x: number, y: number, tile: number) => boolean,
  /**
   * Tiles somebody is standing on, which the walk has to go around.
   *
   * People are solid to *movement* and invisible to the tile array: walking
   * into one starts a conversation instead of a step. So a search that only
   * reads tiles will happily route through a person, hand back that direction
   * for ever, and get a conversation every time — a legal input that consumes
   * the step and moves nobody.
   *
   * That is exactly how a twenty-thousand-step fixture came to visit one route
   * out of fifty: the walker ended up west of a Tactician standing in a
   * one-wide corridor, and spent the rest of the run talking to him.
   */
  solid: ReadonlySet<string> = new Set(),
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
      if (!walkable(tile) || solid.has(`${nx},${ny}`)) continue;
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
 * itself into a corner, and an occasional push toward a *gate* carries it out
 * across the world rather than farming one route forever.
 *
 * That push used to be "step east", which was the way onward when the world
 * was a star. On a graph east is a way on for some places and a wall for
 * others, so a fixed direction spent most of its pushes walking into trees:
 * trainer battles over a sixty-thousand-step probe fell to single figures.
 * Heading for a gap in the wall is the same idea expressed in terms the new
 * world has.
 */
export function walkCandidates(world: World, state: GameState, rng: () => number): Input[] {
  const route = world.routes.get(state.route);
  const order: Direction[] = [];

  /**
   * Everybody standing about on this map.
   *
   * They are solid to *movement* and invisible in the tile array: walking into
   * one starts a conversation instead of a step. So every candidate that steps
   * onto one of these is dropped — it is a legal input, which is exactly the
   * problem, because it succeeds and moves nobody and the walker offers it
   * again next step.
   *
   * Trainers are deliberately absent: walking into one is how a trainer battle
   * starts, and that is a step worth spending.
   */
  const solid = new Set([
    ...(world.npcs.get(state.route) ?? []).map((who) => `${who.x},${who.y}`),
    ...(world.critters.get(state.route) ?? []).map((one) => `${one.x},${one.y}`),
  ]);

  /** The candidates, minus any step into somebody, with those as a last resort. */
  const offer = (wanted: readonly Direction[], rest: readonly Direction[]): Input[] => {
    const free = [...wanted, ...rest].filter((dir) => {
      const x = state.x + (dir === "e" ? 1 : dir === "w" ? -1 : 0);
      const y = state.y + (dir === "s" ? 1 : dir === "n" ? -1 : 0);
      return !solid.has(`${x},${y}`);
    });
    // The unfiltered list still trails it, so a walker boxed in on all four
    // sides has something to do rather than nothing.
    return [...free, ...wanted, ...rest].map((dir) => ({ t: "move", dir }) as Input);
  };

  if (!route || route.kind !== "route") {
    // Town and interiors are lobbies rather than anything under test: leave.
    //
    // The filter matters most here. Hearth's crossroads has people standing on
    // it, the way out is due east along it, and "walk east" into one of them is
    // a conversation the walker will hold for the rest of the run: one seed
    // spent thirty-four thousand of its sixty thousand steps in town, half of
    // them not moving at all.
    const midY = route ? Math.floor(route.height / 2) : 9;
    if (state.y < midY) order.push("s");
    else if (state.y > midY) order.push("n");
    else order.push("e");
    return offer(order, DIRECTIONS);
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
  // Somewhere it has not been, if there is anywhere. Chosen by *where the
  // border leads* rather than at random, and asked before the grass rather
  // than after it — both of those are the difference between a fixture that
  // walks the world and one that does not.
  //
  // A random gate each time is a push in a different direction each time, and
  // the pull back toward the grass cancels it out. And two thirds of some
  // routes are tall grass, so a push that only fires when the walker happens
  // to be standing on bare ground almost never fires at all: twenty thousand
  // steps of that visited exactly one route out of fifty.
  //
  // Preferring an unwalked neighbour makes this a depth-first walk of the
  // world: head for a border, cross it, and the next route's unwalked side is
  // the next thing aimed at.
  //
  // Taken three steps in four rather than one, because the alternative is not
  // neutral: it seeks out grass and then mills about in it, which is a random
  // walk over a region twenty tiles across. At one in four the walker reached
  // the far corner of its first route exactly once in sixty thousand steps and
  // never left the route at all.
  //
  // It is asked *after* the grass, though, not before. Nothing is lost by
  // hurrying a walker along bare ground; hurrying it out of the grass is
  // hurrying it past the only thing on a route that bites.
  // Unwalked neighbours first, and once they have all been walked, any of
  // them — rotated on the tick so the choice is stable for five hundred steps
  // at a time. Aiming at an unvisited neighbour *only* made the walker settle
  // the moment its first route's three neighbours had each been stepped into
  // once: nowhere left to aim at, and forty thousand steps of milling about.
  // Rotating keeps it touring, and a target that holds still long enough to
  // walk to is the whole reason it is chosen on the tick rather than the die.
  const unseen = route.borders.filter((border) => !state.visited.includes(border.to));
  const choices = unseen.length ? unseen : route.borders;
  const outward = choices.length
    ? choices[Math.floor(state.tick / 500) % choices.length]
    : null;

  if (rival && intBelow(rng, 2) === 0) {
    // Half the steps, and first. Any share left to wandering is a share the
    // walker spends drifting back out of arm's reach — it reached a rival's
    // neighbouring tile exactly once in four thousand steps and wandered off
    // again, and the probe recorded no trainer battles at all. Wild encounters
    // are not lost by this: the way to somebody standing on open ground runs
    // through the grass either side of them.
    //
    // Half rather than all of them, though. Chasing unconditionally is a trap
    // of its own: a rival the walker cannot get to — standing beyond somebody
    // else in a one-wide corridor, or behind a bush — is a rival it will chase
    // for the whole run. One seed spent sixty thousand steps on it and beat
    // nobody. Leaving half the steps to everything else means an unreachable
    // rival costs half a run's pace instead of all of it.
    order.push(
      stepToward(route, state.x, state.y, (x, y) => x === rival.x && y === rival.y, solid) ?? "e",
    );
  } else if (here === TILE.GRASS && intBelow(rng, 2) !== 0) {
    // Standing in grass, mill about half the time. The grass is what the
    // fixture is *for* — it is where the encounters are — so it wins here even
    // though the walker also has somewhere to be. Letting the journey win
    // everywhere took the replay fixture's fights over five hundred inputs
    // from thirty-odd down to fourteen.
    order.push(roam[intBelow(rng, roam.length)]);
  } else if (outward && intBelow(rng, 4) !== 0) {
    order.push(
      stepToward(route, state.x, state.y, (x, y) => x === outward.x && y === outward.y, solid) ??
        "e",
    );
  } else {
    order.push(
      stepToward(route, state.x, state.y, (_x, _y, tile) => tile === TILE.GRASS, solid) ?? "e",
    );
  }

  // The fallbacks are shuffled rather than always n, s, e, w. A fixed order
  // means a wedge is permanent: if the first fallback is legal but useless —
  // and walking into a person is exactly that — the walker takes it for ever
  // and the ones that would have freed it are never tried.
  const rest = [...DIRECTIONS];
  for (let index = rest.length - 1; index > 0; index--) {
    const swapWith = intBelow(rng, index + 1);
    [rest[index], rest[swapWith]] = [rest[swapWith], rest[index]];
  }

  return offer(order, rest);
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
