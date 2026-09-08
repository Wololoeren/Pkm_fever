import {
  isFainted,
  maxHp,
  resolveTurn,
  startBattle,
  wildAction,
  WILD_RULES,
  type BattleAction,
  type BattleState,
} from "./battle";
import {
  breed,
  compatible,
  emptyDaycare,
  STEPS_PER_EGG,
  type BreedingItem,
  type DaycareState,
} from "./breeding";
import { ALL_SPECIES, movesAtLevel } from "./dex";
import { NATURE_IDS } from "./natures";
import { hash32, intBetween, rngFor } from "./rng";
import { clampIvs, computeStats } from "./stats";
import { STAT_IDS, type Individual, type StatTable } from "./types";
import {
  encounterTriggers,
  HUB_ID,
  routeId,
  TILE_BLOCK,
  TILE_GRASS,
  TILE_PATH,
  wildAt,
  type World,
} from "./world";

/**
 * The reducer. Everything the player does arrives here as an Input, and the
 * whole game is `reduce(world, inputs)`.
 *
 * Three rules, and they are not negotiable:
 *
 *  - No clock. Game time is `tick`, incremented per accepted input. A save
 *    replayed in two seconds and a save played over forty hours produce
 *    identical state.
 *  - No ambient randomness. Every roll goes through rngFor with a name that
 *    identifies the decision, so it can be recomputed from the seed alone.
 *  - Illegal input throws. A log containing one is corrupt, not merely
 *    surprising, and pretending otherwise is how a desync becomes invisible.
 */

export type Direction = "n" | "s" | "e" | "w";

export type Input =
  | { t: "pickStarter"; index: number }
  | { t: "move"; dir: Direction }
  | { t: "fight"; moveIndex: number }
  | { t: "switch"; partyIndex: number }
  | { t: "ball" }
  | { t: "flee" }
  /** Acknowledges the end of a battle. A real action rather than a UI detail:
   * without it the last turn's narration — what was gained, what was learned,
   * what evolved — is computed and thrown away in the same instant, and the
   * player never sees the reward for the fight they just won. */
  | { t: "continue" }
  | { t: "deposit"; from: "party" | "box"; index: number }
  | { t: "withdraw"; slot: 0 | 1 }
  | { t: "collectEgg" }
  | { t: "toggleItem"; item: BreedingItem }
  /** Moves a creature between the party and the box. */
  | { t: "store"; index: number }
  | { t: "retrieve"; index: number };

/** What just happened outside a battle, for the UI to phrase. Structured
 * rather than a string so display language is never part of the state hash;
 * battle narration lives in BattleState.events for the same reason. */
export type Notice =
  | { t: "starter" }
  | { t: "encounter" }
  | { t: "caught"; variantId: string; boxed: boolean }
  | { t: "won" }
  | { t: "fled" }
  | { t: "whiteout" }
  | { t: "found"; item: BreedingItem }
  | { t: "hatched"; boxed: boolean };

export interface GameState {
  tick: number;
  /** `battleEnd` is a battle that has been decided but not yet dismissed: the
   * result is already applied to the party, and the log is still on screen. */
  phase: "starter" | "field" | "battle" | "battleEnd";
  route: string;
  x: number;
  y: number;
  /** Steps taken in grass, per route. Drives the encounter check. */
  steps: Record<string, number>;
  /** The next encounter slot to serve, per route. */
  nextSlot: Record<string, number>;
  party: Individual[];
  box: Individual[];
  nextUid: number;
  balls: number;
  battle: BattleState | null;
  notice: Notice | null;
  /** Variant ids caught so far, sorted. The census progress the UI shows. */
  found: string[];
  daycare: DaycareState;
  /** Breeding items found, sorted. Equipment rather than stock, so this is a
   * set of what you have rather than a count of it. */
  items: BreedingItem[];
  /** Routes stepped on, sorted. Drives the one-off item finds, and is the
   * beginning of an exploration record. */
  visited: string[];
}

/**
 * Reaching further out is what pays for the breeding items.
 *
 * A placeholder for an economy the game does not have yet — there are no
 * shops and nobody to buy from — but a defensible one: the thing that makes
 * breeding better is found by going somewhere difficult, which is the same
 * bargain the rest of the world offers.
 */
const ITEM_FOR_RING: Record<number, BreedingItem> = {
  2: "heirloom",
  4: "talisman",
  6: "catalyst",
};

const STARTING_BALLS = 30;
const PARTY_LIMIT = 6;

/** Starters roll better IVs than anything wild, and worse than anything bred.
 * Derived from the wild ceiling rather than picked out of the air, so the
 * three tiers stay in proportion if the wild cap is ever retuned. */
const STARTER_IV_MAX = 12;

export class IllegalInput extends Error {
  constructor(reason: string) {
    super(`illegal input: ${reason}`);
  }
}

export function initialState(world: World): GameState {
  const hub = world.routes.get(HUB_ID);
  if (!hub) throw new Error("world has no hub");

  return {
    tick: 0,
    phase: "starter",
    route: HUB_ID,
    x: hub.entry.x,
    y: hub.entry.y,
    steps: {},
    nextSlot: {},
    party: [],
    box: [],
    nextUid: 1,
    balls: STARTING_BALLS,
    battle: null,
    notice: null,
    found: [],
    daycare: emptyDaycare(),
    items: [],
    visited: [HUB_ID],
  };
}

function withMoves(individual: Individual): Individual {
  return { ...individual, moves: movesAtLevel(individual.speciesId, individual.level) };
}

function atFullHealth(individual: Individual): Individual {
  return { ...individual, hp: maxHp(individual) };
}

export function applyInput(world: World, state: GameState, input: Input): GameState {
  switch (input.t) {
    case "pickStarter":
      return pickStarter(world, state, input.index);
    case "move":
      return move(world, state, input.dir);
    case "fight":
      return battleTurn(world, state, { t: "fight", moveIndex: input.moveIndex });
    case "switch":
      return battleTurn(world, state, { t: "switch", partyIndex: input.partyIndex });
    case "ball":
      return battleTurn(world, state, { t: "ball" });
    case "flee":
      return battleTurn(world, state, { t: "flee" });
    case "continue":
      if (state.phase !== "battleEnd") throw new IllegalInput("nothing to dismiss");
      return { ...state, tick: state.tick + 1, phase: "field", battle: null };
    case "deposit":
      return deposit(state, input.from, input.index);
    case "withdraw":
      return withdraw(state, input.slot);
    case "collectEgg":
      return collectEgg(world, state);
    case "toggleItem":
      return toggleItem(state, input.item);
    case "store":
      return moveBetweenParty(state, input.index, "store");
    case "retrieve":
      return moveBetweenParty(state, input.index, "retrieve");
  }
}

/** The daycare is a place, not a menu: it is in the hub, and you have to walk
 * back to it. That is most of what makes going out feel like going out. */
function atDaycare(state: GameState): boolean {
  return state.phase === "field" && state.route === HUB_ID;
}

/**
 * One step's worth of daycare progress.
 *
 * Eggs are paid for in footsteps, which is what ties breeding to playing
 * rather than to waiting. An incompatible pair produces nothing and the
 * counter does not move, so the UI can say why.
 */
function walked(state: GameState): GameState {
  const [first, second] = state.daycare.slots;
  if (!first || !second || state.daycare.eggReady || !compatible(first, second)) return state;

  const steps = state.daycare.steps + 1;
  return steps < STEPS_PER_EGG
    ? { ...state, daycare: { ...state.daycare, steps } }
    : { ...state, daycare: { ...state.daycare, steps: 0, eggReady: true } };
}

/** Setting foot somewhere new for the first time, and what it pays. */
function arrive(world: World, state: GameState, routeId: string): GameState {
  if (state.visited.includes(routeId)) return state;

  const visited = [...state.visited, routeId].sort();
  const item = ITEM_FOR_RING[world.routes.get(routeId)?.ring ?? 0];
  if (!item || state.items.includes(item)) return { ...state, visited, notice: null };

  return { ...state, visited, items: [...state.items, item].sort(), notice: { t: "found", item } };
}

function deposit(state: GameState, from: "party" | "box", index: number): GameState {
  if (!atDaycare(state)) throw new IllegalInput("the daycare is in the hub");

  const source = from === "party" ? state.party : state.box;
  if (index < 0 || index >= source.length) throw new IllegalInput("no such creature");

  const slot: 0 | 1 | null =
    state.daycare.slots[0] === null ? 0 : state.daycare.slots[1] === null ? 1 : null;
  if (slot === null) throw new IllegalInput("the daycare is full");

  // Handing over the last thing that can fight would strand the player in the
  // hub with no way to earn the steps that produce an egg.
  const creature = source[index];
  if (from === "party" && state.party.filter((member) => !isFainted(member)).length <= 1 && !isFainted(creature)) {
    throw new IllegalInput("keep something that can fight");
  }

  const slots: DaycareState["slots"] = [state.daycare.slots[0], state.daycare.slots[1]];
  slots[slot] = creature;

  return {
    ...state,
    tick: state.tick + 1,
    party: from === "party" ? state.party.filter((_, i) => i !== index) : state.party,
    box: from === "box" ? state.box.filter((_, i) => i !== index) : state.box,
    // A new pairing starts its own sequence of eggs.
    daycare: { ...state.daycare, slots, steps: 0, eggIndex: 0, eggReady: false },
    notice: null,
  };
}

function withdraw(state: GameState, slot: 0 | 1): GameState {
  if (!atDaycare(state)) throw new IllegalInput("the daycare is in the hub");

  const creature = state.daycare.slots[slot];
  if (!creature) throw new IllegalInput("that slot is empty");

  const slots: DaycareState["slots"] = [state.daycare.slots[0], state.daycare.slots[1]];
  slots[slot] = null;
  const boxed = state.party.length >= PARTY_LIMIT;

  return {
    ...state,
    tick: state.tick + 1,
    party: boxed ? state.party : [...state.party, creature],
    box: boxed ? [...state.box, creature] : state.box,
    daycare: { ...state.daycare, slots, steps: 0, eggReady: false },
    notice: null,
  };
}

function collectEgg(world: World, state: GameState): GameState {
  if (!atDaycare(state)) throw new IllegalInput("the daycare is in the hub");
  if (!state.daycare.eggReady) throw new IllegalInput("no egg yet");

  const [first, second] = state.daycare.slots;
  if (!first || !second) throw new IllegalInput("no pair");

  const child = breed(world.seed, first, second, state.daycare.eggIndex, state.daycare.applied);
  const hatched = { ...child, uid: state.nextUid };
  const boxed = state.party.length >= PARTY_LIMIT;

  return {
    ...state,
    tick: state.tick + 1,
    party: boxed ? state.party : [...state.party, atFullHealth(hatched)],
    box: boxed ? [...state.box, atFullHealth(hatched)] : state.box,
    nextUid: state.nextUid + 1,
    daycare: { ...state.daycare, eggReady: false, eggIndex: state.daycare.eggIndex + 1, steps: 0 },
    notice: { t: "hatched", boxed },
  };
}

function toggleItem(state: GameState, item: BreedingItem): GameState {
  if (!atDaycare(state)) throw new IllegalInput("the daycare is in the hub");
  if (!state.items.includes(item)) throw new IllegalInput("you do not have that");

  const applied = state.daycare.applied.includes(item)
    ? state.daycare.applied.filter((held) => held !== item)
    : [...state.daycare.applied, item].sort();

  return { ...state, tick: state.tick + 1, daycare: { ...state.daycare, applied }, notice: null };
}

/** Party to box, or box to party. */
function moveBetweenParty(state: GameState, index: number, direction: "store" | "retrieve"): GameState {
  if (state.phase !== "field") throw new IllegalInput("not now");

  if (direction === "store") {
    if (index < 0 || index >= state.party.length) throw new IllegalInput("no such creature");
    if (state.party.length <= 1) throw new IllegalInput("keep at least one");
    return {
      ...state,
      tick: state.tick + 1,
      party: state.party.filter((_, i) => i !== index),
      box: [...state.box, state.party[index]],
      notice: null,
    };
  }

  if (index < 0 || index >= state.box.length) throw new IllegalInput("no such creature");
  if (state.party.length >= PARTY_LIMIT) throw new IllegalInput("your party is full");
  return {
    ...state,
    tick: state.tick + 1,
    party: [...state.party, state.box[index]],
    box: state.box.filter((_, i) => i !== index),
    notice: null,
  };
}

function pickStarter(world: World, state: GameState, index: number): GameState {
  if (state.phase !== "starter") throw new IllegalInput("starter already chosen");
  if (!Number.isInteger(index) || index < 0 || index >= world.starters.length) {
    throw new IllegalInput("no such starter");
  }

  const rng = rngFor(world.seed, "starter", index);
  const ivs = {} as StatTable;
  for (const stat of STAT_IDS) ivs[stat] = intBetween(rng, 0, STARTER_IV_MAX);

  const starter = withMoves({
    uid: state.nextUid,
    speciesId: world.starters[index],
    level: 5,
    exp: 5 * 5 * 5,
    ivs: clampIvs(ivs),
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    natureId: NATURE_IDS[intBetween(rng, 0, NATURE_IDS.length - 1)],
    variantId: "normal",
    hp: 0,
    status: null,
    sleepTurns: 0,
    moves: [],
    nickname: null,
    parents: null,
  });

  return {
    ...state,
    tick: state.tick + 1,
    phase: "field",
    party: [atFullHealth(starter)],
    nextUid: state.nextUid + 1,
    notice: { t: "starter" },
  };
}

const DELTA: Record<Direction, [number, number]> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
};

/**
 * Where a border tile leads.
 *
 * The world is radial: west runs inward toward the hub, east runs outward
 * into higher rings, and the hub's four gaps open onto the four biomes. That
 * is the whole map graph — no connection table to author or keep in sync.
 */
function exitFrom(world: World, from: string, x: number, y: number): { route: string; x: number; y: number } | null {
  const route = world.routes.get(from);
  if (!route) return null;

  const midY = Math.floor(route.height / 2);
  const lastX = route.width - 1;
  const lastY = route.height - 1;

  if (from === HUB_ID) {
    const biomes = world.config.biomes;
    const side = x === 0 ? 0 : y === 0 ? 1 : x === lastX ? 2 : y === lastY ? 3 : -1;
    if (side < 0 || side >= biomes.length) return null;
    const target = world.routes.get(routeId(biomes[side], 1));
    return target ? { route: target.id, x: 1, y: Math.floor(target.height / 2) } : null;
  }

  if (x === 0) {
    if (route.ring <= 1) return { route: HUB_ID, x: 1, y: midY };
    const inward = world.routes.get(routeId(route.biome, route.ring - 1));
    return inward ? { route: inward.id, x: inward.width - 2, y: Math.floor(inward.height / 2) } : null;
  }

  if (x === lastX) {
    const outward = world.routes.get(routeId(route.biome, route.ring + 1));
    return outward ? { route: outward.id, x: 1, y: Math.floor(outward.height / 2) } : null;
  }

  // Hub gaps are the only north/south doors; a route's own top and bottom are
  // solid, so reaching here means the border tile is decorative.
  return null;
}

function move(world: World, state: GameState, dir: Direction): GameState {
  if (state.phase !== "field") throw new IllegalInput("cannot walk right now");

  const route = world.routes.get(state.route);
  if (!route) throw new IllegalInput("not on a known route");

  const [dx, dy] = DELTA[dir];
  const nx = state.x + dx;
  const ny = state.y + dy;
  if (nx < 0 || ny < 0 || nx >= route.width || ny >= route.height) throw new IllegalInput("off the map");

  const tile = route.tiles[ny * route.width + nx];
  if (tile === TILE_BLOCK) throw new IllegalInput("blocked");

  const onBorder = nx === 0 || ny === 0 || nx === route.width - 1 || ny === route.height - 1;
  if (onBorder && tile === TILE_PATH) {
    const exit = exitFrom(world, state.route, nx, ny);
    if (exit) {
      const arrived = arrive(world, state, exit.route);
      return walked({ ...arrived, tick: state.tick + 1, route: exit.route, x: exit.x, y: exit.y });
    }
    throw new IllegalInput("blocked");
  }

  const moved: GameState = walked({ ...state, tick: state.tick + 1, x: nx, y: ny, notice: null });
  if (tile !== TILE_GRASS || route.ring < 1) return moved;

  const stepped = (state.steps[state.route] ?? 0) + 1;
  const steps = { ...state.steps, [state.route]: stepped };
  if (!encounterTriggers(world.seed, state.route, stepped)) return { ...moved, steps };

  // Nothing able to fight means nothing to fight with, so the grass stays
  // quiet rather than starting a battle that cannot be played.
  const leadIndex = state.party.findIndex((creature) => !isFainted(creature));
  if (leadIndex < 0) return { ...moved, steps };

  const slot = state.nextSlot[state.route] ?? 0;
  const wild = atFullHealth(withMoves(wildAt(world, ALL_SPECIES, state.route, slot, state.nextUid)));

  return {
    ...moved,
    steps,
    nextSlot: { ...state.nextSlot, [state.route]: slot + 1 },
    phase: "battle",
    // The tag keeps this encounter's rolls distinct from every other one in
    // the world, so two battles never share a critical hit.
    battle: startBattle(world.seed, `wild:${state.route}:${slot}`, state.party, [wild], leadIndex),
    nextUid: state.nextUid + 1,
    notice: { t: "encounter" },
  };
}

function battleTurn(world: World, state: GameState, action: BattleAction): GameState {
  if (state.phase !== "battle" || !state.battle) throw new IllegalInput("not in a battle");

  let result;
  try {
    // Side 1 is the wild creature; its move is derived from the battle's own
    // seed, so it is as unrerollable as the encounter that produced it.
    result = resolveTurn(state.battle, [action, wildAction(state.battle)], WILD_RULES, state.balls);
  } catch (error) {
    throw new IllegalInput(error instanceof Error ? error.message : "bad battle action");
  }

  const base: GameState = {
    ...state,
    tick: state.tick + 1,
    // The party fought inside the battle, so it comes back out of it.
    party: result.battle.sides[0].team,
    balls: state.balls - result.ballsUsed,
    battle: result.battle,
    notice: null,
  };

  // Winning and being wiped out are not mutually exclusive: a creature that
  // faints on the same turn it lands the killing blow leaves the outcome as
  // "won" with nothing left standing. Without this, the player walks away
  // with a fainted party, `move` quietly refuses every encounter, and the game
  // looks like it has stopped working rather than saying anything.
  const wipedOut = base.party.length > 0 && base.party.every(isFainted);

  // A decided battle stays on screen until it is dismissed. The result is
  // applied here and now — nothing is held back — but the phase keeps the log
  // up so the player can read what they won.
  const outcome = result.battle.outcome;
  if (!outcome) return base;

  switch (outcome.t) {
    case "caught": {
      const caught = result.caught;
      if (!caught) throw new IllegalInput("caught nothing");
      const boxed = base.party.length >= PARTY_LIMIT;
      const found = base.found.includes(caught.variantId)
        ? base.found
        : [...base.found, caught.variantId].sort();

      const kept: GameState = {
        ...base,
        phase: "battleEnd",
        party: boxed ? base.party : [...base.party, caught],
        box: boxed ? [...base.box, caught] : base.box,
        found,
        notice: { t: "caught", variantId: caught.variantId, boxed },
      };
      // The creature just caught is at full health, so catching with a wiped
      // party is a rescue rather than a blackout.
      return kept.party.every(isFainted) ? whiteout(world, kept) : kept;
    }

    case "fled":
      return wipedOut ? whiteout(world, base) : { ...base, phase: "battleEnd", notice: { t: "fled" } };

    case "draw":
      return whiteout(world, base);

    case "win":
      return outcome.side === 1 || wipedOut
        ? whiteout(world, base)
        : { ...base, phase: "battleEnd", notice: { t: "won" } };
  }
}

/**
 * Back to the hub with everything healed.
 *
 * Losing costs progress and time, never a creature — a roguelike is a
 * different game. Reached from a lost battle, and from any other ending that
 * happens to leave nothing standing.
 */
function whiteout(world: World, state: GameState): GameState {
  const hub = world.routes.get(HUB_ID);
  if (!hub) throw new Error("world has no hub");

  return {
    ...state,
    phase: "battleEnd",
    route: HUB_ID,
    x: hub.entry.x,
    y: hub.entry.y,
    party: state.party.map((creature) => ({
      ...atFullHealth(creature),
      status: null,
      sleepTurns: 0,
    })),
    notice: { t: "whiteout" },
  };
}

/**
 * Replays a whole log. The one entry point a save file, a verifier and the
 * live game all share, so there is no second implementation to drift.
 */
export function reduce(world: World, inputs: readonly Input[]): GameState {
  let state = initialState(world);
  for (const input of inputs) state = applyInput(world, state, input);
  return state;
}

/**
 * A fingerprint of everything that matters, for spotting divergence between
 * two clients and for pinning replay in tests.
 *
 * FNV-1a over a canonical serialisation: a checksum, deliberately not a
 * security boundary. Tamper-evidence is the save layer's job, with WebCrypto,
 * where being asynchronous is allowed.
 *
 * BattleState.events is left out on purpose — it is narration derived from
 * everything else, and hashing it would make the fingerprint sensitive to a
 * change in how the game describes itself rather than in what happened.
 */
export function stateHash(state: GameState): string {
  const individual = (creature: Individual) =>
    [
      creature.uid,
      creature.speciesId,
      creature.level,
      creature.exp,
      STAT_IDS.map((stat) => creature.ivs[stat]).join(","),
      STAT_IDS.map((stat) => creature.evs[stat]).join(","),
      creature.natureId,
      creature.variantId,
      creature.hp,
      creature.status ?? "-",
      creature.sleepTurns,
      creature.moves.join("/"),
    ].join(":");

  const counters = (table: Record<string, number>) =>
    Object.keys(table)
      .sort()
      .map((key) => `${key}=${table[key]}`)
      .join(",");

  const battle = state.battle
    ? [
        state.battle.tag,
        state.battle.turn,
        state.battle.awaitingSwitch.join(","),
        state.battle.outcome ? JSON.stringify(state.battle.outcome) : "-",
        state.battle.sides
          .map((side) =>
            [
              side.active,
              side.team.map(individual).join("|"),
              (["atk", "def", "spa", "spd", "spe"] as const).map((stat) => side.stages[stat]).join(","),
            ].join("/"),
          )
          .join("~"),
      ].join(":")
    : "-";

  const daycare = [
    state.daycare.slots.map((creature) => (creature ? individual(creature) : "-")).join("|"),
    state.daycare.steps,
    state.daycare.eggIndex,
    state.daycare.eggReady ? "1" : "0",
    state.daycare.applied.join(","),
  ].join(":");

  const canonical = [
    state.tick,
    state.phase,
    state.route,
    state.x,
    state.y,
    counters(state.steps),
    counters(state.nextSlot),
    state.party.map(individual).join("|"),
    state.box.map(individual).join("|"),
    state.nextUid,
    state.balls,
    battle,
    state.found.join(","),
    daycare,
    state.items.join(","),
    state.visited.join(","),
  ].join(";");

  return hash32(canonical).toString(16).padStart(8, "0");
}

/** Full stats for a creature, re-exported so the UI has one place to ask. */
export { computeStats };
