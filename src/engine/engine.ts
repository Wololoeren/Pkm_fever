import {
  isFainted,
  maxHp,
  resolveTurn,
  startBattle,
  aiAction,
  TRAINER_RULES,
  WILD_RULES,
  type BattleAction,
  type BattleState,
} from "./battle";
import {
  breed,
  compatible,
  emptyDaycare,
  GLITTER,
  STEPS_PER_EGG,
  type BreedingItem,
  type DaycareState,
} from "./breeding";
import {
  ALL_SPECIES,
  canLearnMachine,
  learnableAt,
  movesAtLevel,
  species as speciesById,
} from "./dex";
import { rollGender, type Gender } from "./gender";
import { NATURE_IDS } from "./natures";
import { awardExp, expForLevel, MAX_LEVEL, MOVE_SLOTS } from "./progression";
import { pickAbilities, rollAbilities } from "./abilities";
import { alignPp, fullPp, ppLeft, restorePp } from "./pp";
import { matchesWant, SHINE_GLITTER, SHINE_PRICE, wantText, type NpcSpec } from "./npc";
import {
  isQuest,
  progressOf,
  quest as questSpec,
  type QuestView,
} from "./quests";
import { gym as gymSpec, gymLevel } from "./gyms";
import {
  contender as cupSpec,
  cupEffort,
  cupMoveset,
  cupNature,
  CUP_ABILITIES,
  CUP_POOL,
  CUP_SIZE,
  isContender,
} from "./cup";
import { hash32, intBelow, intBetween, rngFor } from "./rng";
import { clampIvs, computeStats, IV_MAX } from "./stats";
import { STAT_IDS, type Individual, type StatTable } from "./types";
import { variant } from "./variants";
import {
  encounterTriggers,
  fishAt,
  propBlocks,
  type Route,
  HUB_ID,
  starterAppearance,
  trainerAt,
  wildAt,
  type World,
} from "./world";
import {
  clearedBy,
  hidesEncounters,
  OBSTACLES,
  passable,
  TILE,
} from "./terrain";
import {
  addItem,
  bagEntries,
  countOf,
  hasItem,
  isItem,
  item,
  ITEMS,
  LURE_MOVES,
  removeItem,
  RODS,
  type Bag,
  type ItemSpec,
  type LureSpec,
} from "./items";

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
  /** Nothing left to fight with. Legal only when that is actually true. */
  | { t: "struggle" }
  | { t: "switch"; partyIndex: number }
  /** Which ball. Omitted means an ordinary one, so a log written before there
   * was a choice still replays. */
  | { t: "ball"; item?: string }
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
  | { t: "retrieve"; index: number }
  /**
   * A completed trade: `give` leaves the party, `receive` joins it.
   *
   * The creature received is carried whole rather than referenced, because it
   * cannot be derived — it came out of somebody else's world, from a seed this
   * save has never seen. That keeps the log replayable at the cost of the
   * property that makes a log worth replaying: this one creature is taken on
   * trust. It is marked `traded` so a format can decide whether to accept it.
   */
  | { t: "trade"; give: number; receive: Individual }
  /**
   * A testing shortcut.
   *
   * Deliberately an input like any other, rather than something that reaches
   * in and edits state. A cheat then lands in the log, replays with it, and
   * sets `cheated` — so a save that used one says so, and the verification a
   * tournament runs at check-in catches it for free. A cheat menu that
   * bypassed the log would produce saves indistinguishable from honest ones,
   * which is the opposite of what this design is for.
   */
  | { t: "cheat"; cheat: Cheat }
  /**
   * Rechooses which four of a creature's learned moves it carries.
   *
   * In town, because it is a decision worth walking back for, and because
   * being able to rebuild a moveset in front of a wild creature would make
   * every type matchup a formality.
   */
  | { t: "setMoves"; index: number; moves: string[] }
  /**
   * Moving a party member to another slot.
   *
   * Slot zero is who walks into the next fight, so this is a real decision
   * rather than tidying, and it goes through the log like every other one.
   * Refused mid-battle: reordering with a creature already out would be a
   * free switch, which is a move the battle system charges a turn for.
   */
  | { t: "reorderParty"; from: number; to: number }
  /**
   * Using something from the bag, on a party member.
   *
   * Out in the field only. Letting a potion be used mid-battle would mean the
   * duel protocol had to commit to it like a move, and a healing item nobody
   * can answer is the shortest road to a battle that never ends. Heal between
   * fights, like the rest of the game asks you to.
   */
  | { t: "useItem"; item: string; index: number }
  | { t: "buyItem"; item: string; count: number }
  | { t: "sellItem"; item: string; count: number }
  /** Casting a line at water you are standing beside. */
  | { t: "fish" }
  /** Talking to somebody. Walking into them does this for you. */
  | { t: "talk"; id: string }
  | { t: "endTalk" }
  /** Taking whatever the person you are talking to is offering. */
  | { t: "npcAccept" }
  /** Giving one of yours to a trader, by party slot. */
  | { t: "npcTrade"; index: number }
  /**
   * Selling the shine off one of yours, by party slot.
   *
   * `confirm` carries the creature's own uid for the same reason a release
   * does: this is the other input in the game that a step backwards does not
   * undo, and a boolean would be satisfied by any stray click that reached the
   * engine. `take` is the player's, not the buyer's — he pays either way.
   */
  | { t: "npcSell"; index: number; take: "money" | "glitter"; confirm: number }
  /**
   * Answering an offered move: take it in place of `forget`, or turn it down.
   *
   * `forget` is a move id rather than a slot, for the same reason a release
   * carries a uid: a slot is a position in a list the player may have
   * rearranged since, and forgetting the wrong move is not undoable.
   */
  | { t: "learnMove"; uid: number; moveId: string; forget: string | null }
  /** Claiming a finished quest. */
  | { t: "claimQuest"; id: string }
  /** Using a tool on whatever is in the way in this direction. */
  | { t: "useTool"; item: string; dir: Direction }
  /** Flying to somewhere already walked to. */
  | { t: "fly"; route: string }
  /**
   * Letting one go, for good.
   *
   * `confirm` is the safety catch, and it carries the creature's own uid
   * rather than a boolean. A `true` would be satisfied by any stray click that
   * reached the engine; a uid can only have come from the panel that showed
   * you which one you were about to lose, so a mis-click on a reordered list
   * releases nothing rather than the wrong thing.
   */
  | { t: "release"; from: "party" | "box"; index: number; confirm: number };

export type Cheat =
  | { op: "give"; speciesId: string; level: number; variantId: string; gender: Gender }
  | { op: "heal" }
  | { op: "balls"; count: number }
  | { op: "money"; count: number }
  | { op: "items" }
  | { op: "warp"; route: string }
  | { op: "setVariant"; index: number; variantId: string }
  | { op: "setGender"; index: number; gender: Gender }
  | { op: "setLevel"; index: number; level: number };

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
  | { t: "hatched"; boxed: boolean }
  | { t: "beatTrainer"; name: string; money: number }
  | { t: "traded"; given: string; received: string }
  | { t: "used"; item: string; on: string }
  | { t: "bought"; item: string; count: number }
  | { t: "sold"; item: string; count: number }
  | { t: "picked"; item: string }
  | { t: "gift"; from: string; item: string }
  | { t: "healed"; by: string }
  | { t: "swapped"; given: string; got: string }
  | { t: "questTaken"; id: string }
  | { t: "questDone"; id: string }
  | { t: "cleared"; item: string }
  | { t: "badge"; gym: string }
  | { t: "released"; name: string }
  | { t: "appraised"; name: string; tier: number; money: number; glitter: number }
  | { t: "lured"; item: string; until: number }
  | { t: "taught"; name: string; learned: string; forgot: string | null };

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
  /** Everything held, by item id. Balls, medicine, rods and breeding gear in
   * one place, because "how many of this do I have" should have one answer. */
  bag: Bag;
  money: number;
  battle: BattleState | null;
  notice: Notice | null;
  /** Variant ids caught so far, sorted. The census progress the UI shows. */
  found: string[];
  daycare: DaycareState;
  /** Routes stepped on, sorted. Drives the one-off item finds, and is the
   * beginning of an exploration record. */
  visited: string[];
  /** Trainers already beaten, sorted. They stay beaten. */
  beaten: string[];
  /** Who you are mid-conversation with, if anyone. */
  talking: string | null;
  /** People whose one-off offer has been taken, sorted. */
  helped: string[];
  /** Quests accepted, and quests already paid out. Progress itself is never
   * stored — it is asked of the save, so a quest can be retuned without
   * invalidating a single log. */
  questsTaken: string[];
  questsDone: string[];
  /** Items picked up off the floor, sorted. */
  taken: string[];
  /** Obstacles taken down for good, as "route:x,y", sorted. Surf is not here:
   * crossing water is something you are doing, not something you did. */
  cleared: string[];
  /** Gym badges won, sorted. */
  badges: string[];
  /** The move count at which each trainer was last beaten, and how many times
   * they have been. They come back stronger. */
  beatenAt: Record<string, number>;
  wins: Record<string, number>;
  /**
   * Moves grown into or taught, with no room for them yet.
   *
   * A queue rather than a flag, because a creature can pass three levels in
   * one battle and be offered three things. Kept in the save, so a level-up
   * that happened at the end of a session is still waiting to be answered at
   * the start of the next one.
   */
  pendingMoves: { uid: number; moveId: string }[];
  /**
   * Lures currently burning: item id, and the move count they die at.
   *
   * An expiry rather than a countdown, so nothing has to be decremented on
   * every step and a lure cannot drift out of step with the clock it was
   * measured against. Expired entries are swept the next time one is lit.
   */
  lures: Record<string, number>;
  /** Whether a testing shortcut was ever used in this save. Once true, always
   * true: the point is that a cheated save cannot quietly become an honest one. */
  cheated: boolean;
}

/** What a trainer hands over. There is no money yet, and balls are the one
 * thing the game already spends, so they are the reward that fits. */

/** A battle against somebody standing on a route, rather than against the
 * grass. Encoded in the tag so nothing extra has to live in state. */
const TRAINER_TAG = "trainer:";

/** A battle against the grass. The counterpart to TRAINER_TAG. */
const WILD_TAG = "wild:";

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

/**
 * The lenses and the prism are keyed to a biome as well as a ring.
 *
 * The three above are the core of breeding and drop from any route at the
 * right distance, so nobody can miss them. These nine are specialised — each
 * aims a pairing at one colour — so each asks you to have been somewhere
 * specific rather than merely far. Eight colours over four biomes means two
 * apiece, at the two depths that were not already spoken for.
 */
const ITEM_FOR_PLACE: Record<string, BreedingItem> = {
  "ashflats:1": "lens-ember",
  "marsh:1": "lens-tide",
  "pinewood:1": "lens-static",
  "meadow:1": "lens-verdant",
  "pinewood:3": "lens-umbral",
  "marsh:3": "lens-teal",
  "ashflats:5": "lens-onyx",
  "meadow:5": "lens-ivory",

  // The five flat additions to the climb, laid out by how far you have to go
  // for one. A percent is a two-ring walk; ten percent is the far end of the
  // world, and there is exactly one of it.
  "meadow:2": "glint",
  "ashflats:2": "gleam",
  "pinewood:4": "lustre",
  "marsh:6": "radiance",
  "meadow:6": "brilliance",
  "pinewood:5": "prism",
};

const STARTING_BALLS = 30;

/** Enough to restock balls a few times, not enough to skip the early routes. */
const STARTING_MONEY = 3000;
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
    bag: { pokeball: STARTING_BALLS },
    money: STARTING_MONEY,
    battle: null,
    notice: null,
    found: [],
    daycare: emptyDaycare(),
    visited: [HUB_ID],
    beaten: [],
    talking: null,
    helped: [],
    pendingMoves: [],
    lures: {},
    questsTaken: [],
    questsDone: [],
    taken: [],
    cleared: [],
    badges: [],
    beatenAt: {},
    wins: {},
    cheated: false,
  };
}

function trainerIdOf(battle: BattleState | null): string | null {
  return battle?.tag.startsWith(TRAINER_TAG) ? battle.tag.slice(TRAINER_TAG.length) : null;
}

/**
 * Whether balls and running are legal here.
 *
 * The UI has to ask, rather than inferring it from whether it was handed a
 * ball count. It used to infer: page.tsx passed `balls` unconditionally and
 * BattleView read `balls !== undefined` as "this is wild", so "Throw ball"
 * and "Run" were rendered in trainer battles, where resolveTurn throws and
 * dispatch swallows it. Buttons that visibly did nothing.
 */
export function isWildBattle(battle: BattleState | null): boolean {
  return Boolean(battle?.tag.startsWith(WILD_TAG));
}

function withMoves(individual: Individual): Individual {
  const moves = movesAtLevel(individual.speciesId, individual.level);
  return { ...individual, moves, pp: fullPp(moves) };
}

function atFullHealth(individual: Individual): Individual {
  return { ...individual, hp: maxHp(individual) };
}

/**
 * Everything back: health, status and uses.
 *
 * The one place the three are restored together, because they are restored
 * together in exactly two situations — the centre patching up the whole party,
 * and being beaten, which does the same thing on the way home. Anything that
 * heals one creature heals one creature; this is what "you are fine now"
 * means, and power points come back only here.
 */
function restored(individual: Individual): Individual {
  return { ...restorePp(atFullHealth(individual)), status: null, sleepTurns: 0 };
}

export function applyInput(world: World, state: GameState, input: Input): GameState {
  switch (input.t) {
    case "pickStarter":
      return pickStarter(world, state, input.index);
    case "move":
      return move(world, state, input.dir);
    case "fight":
      return battleTurn(world, state, { t: "fight", moveIndex: input.moveIndex });
    case "struggle":
      return battleTurn(world, state, { t: "struggle" });
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
      return deposit(world, state, input.from, input.index);
    case "withdraw":
      return withdraw(world, state, input.slot);
    case "collectEgg":
      return collectEgg(world, state);
    case "toggleItem":
      return toggleItem(world, state, input.item);
    case "store":
      return moveBetweenParty(state, input.index, "store");
    case "retrieve":
      return moveBetweenParty(state, input.index, "retrieve");
    case "trade":
      return trade(world, state, input.give, input.receive);
    case "cheat":
      return cheat(world, state, input.cheat);
    case "setMoves":
      return setMoves(world, state, input.index, input.moves);
    case "reorderParty":
      return reorderParty(state, input.from, input.to);
    case "useItem":
      return applyItem(state, input.item, input.index);
    case "buyItem":
      return buyItem(world, state, input.item, input.count);
    case "sellItem":
      return sellItem(world, state, input.item, input.count);
    case "fish":
      return fish(world, state);
    case "talk":
      return talk(world, state, input.id);
    case "endTalk":
      return { ...state, tick: state.tick + 1, talking: null, notice: null };
    case "npcAccept":
      return npcAccept(world, state);
    case "npcTrade":
      return npcTrade(world, state, input.index);
    case "npcSell":
      return npcSell(world, state, input.index, input.take, input.confirm);
    case "learnMove":
      return learnMove(state, input.uid, input.moveId, input.forget);
    case "claimQuest":
      return claimQuest(world, state, input.id);
    case "useTool":
      return applyTool(world, state, input.item, input.dir);
    case "fly":
      return fly(world, state, input.route);
    case "release":
      return release(state, input.from, input.index, input.confirm);
  }
}

export const MAX_MOVES = MOVE_SLOTS;

/**
 * Why this moveset would be refused, or null if it is fine.
 *
 * Exported so the UI disables for exactly what the engine refuses. That has
 * gone wrong twice already — the daycare button and the ball button both
 * carried their own approximation of a rule the engine owned.
 */
export function movesRefusal(
  world: World,
  state: GameState,
  index: number,
  moves: readonly string[],
): string | null {
  if (!inTown(world, state)) return "moves are rearranged in town";
  if (index < 0 || index >= state.party.length) return "no such creature";
  if (!moves.length) return "keep at least one move";
  if (moves.length > MAX_MOVES) return `no more than ${MAX_MOVES}`;
  if (new Set(moves).size !== moves.length) return "no duplicates";

  const creature = state.party[index];
  const pool = new Set(learnableAt(creature.speciesId, creature.level));
  for (const moveId of moves) {
    if (!pool.has(moveId)) return "it has not learned that";
  }
  return null;
}

function setMoves(world: World, state: GameState, index: number, moves: string[]): GameState {
  const refusal = movesRefusal(world, state, index, moves);
  if (refusal) throw new IllegalInput(refusal);

  return {
    ...state,
    tick: state.tick + 1,
    party: state.party.map((creature, at) => (at === index ? { ...creature, moves: [...moves] } : creature)),
    notice: null,
  };
}

/**
 * Applies a testing shortcut, and marks the save as having used one.
 *
 * The mark is the point. Everything else here is a convenience; `cheated` is
 * what keeps the save honest about itself.
 */
function cheat(world: World, state: GameState, op: Cheat): GameState {
  const next = { ...state, tick: state.tick + 1, cheated: true, notice: null };

  switch (op.op) {
    case "give": {
      const level = Math.max(1, Math.min(100, Math.floor(op.level)));
      const built = withMoves({
        pp: [],
        // A cheat hands over exactly what was asked for and nothing else.
        abilities: [],
        uid: state.nextUid,
        speciesId: speciesById(op.speciesId).id,
        level,
        exp: expForLevel(level),
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
        evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        natureId: NATURE_IDS[level % NATURE_IDS.length],
        variantId: variant(op.variantId).id,
        hp: 0,
        status: null,
        sleepTurns: 0,
        moves: [],
        nickname: null,
        traded: false,
        parents: null,
        gender: op.gender,
      });
      const arrival = atFullHealth(built);
      const boxed = state.party.length >= PARTY_LIMIT;
      return {
        ...next,
        party: boxed ? state.party : [...state.party, arrival],
        box: boxed ? [...state.box, arrival] : state.box,
        nextUid: state.nextUid + 1,
      };
    }

    case "heal":
      return {
        ...next,
        party: state.party.map(restored),
      };

    case "balls":
      return { ...next, bag: addItem(next.bag, "pokeball", Math.max(0, Math.floor(op.count))) };

    case "money":
      return { ...next, money: Math.max(0, next.money + Math.floor(op.count)) };

    case "items":
      return {
        ...next,
        bag: ITEMS.reduce((bag, spec) => addItem(bag, spec.id, spec.stacks ? 20 : 1), next.bag),
      };

    case "warp": {
      const route = world.routes.get(op.route);
      if (!route) throw new IllegalInput("no such route");
      return {
        ...next,
        route: route.id,
        x: route.entry.x,
        y: route.entry.y,
        visited: state.visited.includes(route.id) ? state.visited : [...state.visited, route.id].sort(),
      };
    }

    case "setVariant": {
      if (op.index < 0 || op.index >= state.party.length) throw new IllegalInput("no such creature");
      const variantId = variant(op.variantId).id;
      return {
        ...next,
        party: state.party.map((creature, index) =>
          index === op.index ? atFullHealth({ ...creature, variantId }) : creature,
        ),
      };
    }

    case "setGender": {
      if (op.index < 0 || op.index >= state.party.length) throw new IllegalInput("no such creature");
      return {
        ...next,
        party: state.party.map((creature, index) =>
          index === op.index ? { ...creature, gender: op.gender } : creature,
        ),
      };
    }

    case "setLevel": {
      if (op.index < 0 || op.index >= state.party.length) throw new IllegalInput("no such creature");
      const level = Math.max(1, Math.min(100, Math.floor(op.level)));
      return {
        ...next,
        party: state.party.map((creature, index) =>
          index === op.index
            ? atFullHealth(withMoves({ ...creature, level, exp: expForLevel(level) }))
            : creature,
        ),
      };
    }
  }
}

/**
 * Swaps one of ours for one of theirs.
 *
 * Trading happens in town for the same reason battling does: it is a place you
 * walk to. The received creature is renumbered on arrival — uids are only
 * unique within one save, and two players who both started a world have both
 * been handing out uid 1.
 */
function trade(world: World, state: GameState, give: number, receive: Individual): GameState {
  if (!inTown(world, state)) throw new IllegalInput("trading happens in town");
  if (give < 0 || give >= state.party.length) throw new IllegalInput("no such creature");

  const arrival: Individual = {
    ...receive,
    uid: state.nextUid,
    traded: true,
    // Whatever their client claimed, health is clamped to what this creature
    // can actually have here.
    hp: Math.max(0, Math.min(receive.hp, maxHp({ ...receive, uid: state.nextUid }))),
  };

  return {
    ...state,
    tick: state.tick + 1,
    party: state.party.map((creature, index) => (index === give ? arrival : creature)),
    nextUid: state.nextUid + 1,
    notice: { t: "traded", given: state.party[give].speciesId, received: arrival.speciesId },
  };
}

/**
 * Whether the player is standing in a town.
 *
 * The daycare, trading and matches against other people all live here rather
 * than in a menu you carry, and for the same reason: walking back is what
 * makes walking out mean anything. Today there is one town; when there are
 * more, this is the one place that has to learn about them.
 */
export function inTown(world: World, state: GameState): boolean {
  if (state.phase !== "field") return false;
  const route = world.routes.get(state.route);
  if (!route) return false;
  return route.kind === "town" || (route.kind === "interior" && world.routes.get(route.parent ?? "")?.kind === "town");
}

/** Inside a building with a given job. */
function inside(world: World, state: GameState, role: string): boolean {
  if (state.phase !== "field") return false;
  return world.routes.get(state.route)?.role === role;
}

/**
 * The daycare is a building you walk into now, not a panel that follows you.
 * That is most of what makes a town somewhere rather than a menu.
 */
function atDaycare(world: World, state: GameState): boolean {
  return inside(world, state, "daycare");
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
  const route = world.routes.get(routeId);
  const found =
    (route ? ITEM_FOR_PLACE[`${route.biome}:${route.ring}`] : undefined) ??
    ITEM_FOR_RING[route?.ring ?? 0];
  if (!found || hasItem(state.bag, found)) return { ...state, visited, notice: null };

  return { ...state, visited, bag: addItem(state.bag, found), notice: { t: "found", item: found } };
}

/**
 * Why this deposit would be refused, or null if it would be accepted.
 *
 * Exported because the UI has to disable the button for exactly the cases the
 * engine refuses, and it used to hand-copy an approximation of this rule:
 * HubPanel disabled the party button on `party.length <= 1` while the engine
 * refused on the count of members that can still *fight*, so a party of three
 * with two fainted offered a button that threw. Worse, the box route was never
 * offered at all — a player who boxed their spares had a party of one, no
 * party deposit and no box deposit, and breeding was simply unreachable.
 *
 * One predicate, two callers, no drift.
 */
export function depositRefusal(
  world: World,
  state: GameState,
  from: "party" | "box",
  index: number,
): string | null {
  if (!atDaycare(world, state)) return "you are not in the daycare";

  const source = from === "party" ? state.party : state.box;
  if (index < 0 || index >= source.length) return "no such creature";

  if (state.daycare.slots[0] !== null && state.daycare.slots[1] !== null) {
    return "the daycare is full";
  }

  // Handing over the last thing that can fight would strand the player in the
  // hub with no way to earn the steps that produce an egg.
  const creature = source[index];
  if (
    from === "party" &&
    state.party.filter((member) => !isFainted(member)).length <= 1 &&
    !isFainted(creature)
  ) {
    return "keep something that can fight";
  }

  return null;
}

function deposit(world: World, state: GameState, from: "party" | "box", index: number): GameState {
  const refusal = depositRefusal(world, state, from, index);
  if (refusal) throw new IllegalInput(refusal);

  const source = from === "party" ? state.party : state.box;
  const slot: 0 | 1 = state.daycare.slots[0] === null ? 0 : 1;
  const creature = source[index];

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

function withdraw(world: World, state: GameState, slot: 0 | 1): GameState {
  if (!atDaycare(world, state)) throw new IllegalInput("you are not in the daycare");

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
  if (!atDaycare(world, state)) throw new IllegalInput("you are not in the daycare");
  if (!state.daycare.eggReady) throw new IllegalInput("no egg yet");

  const [first, second] = state.daycare.slots;
  if (!first || !second) throw new IllegalInput("no pair");

  const child = breed(world.seed, first, second, state.daycare.eggIndex, state.daycare.applied);
  const hatched = { ...child, uid: state.nextUid };
  const boxed = state.party.length >= PARTY_LIMIT;

  // Glitter is spent on the egg, not on the outcome. It bought the roll, the
  // roll happened, and whether it came up shine is not the Glitter's business.
  // The last one lifts itself off the pairing on the way out, because a pinch
  // of dust still applied with none in the bag is the daycare quoting odds it
  // cannot pay.
  const spending = state.daycare.applied.includes(GLITTER) && hasItem(state.bag, GLITTER);
  const bag = spending ? removeItem(state.bag, GLITTER) : state.bag;
  const applied = spending && !hasItem(bag, GLITTER)
    ? state.daycare.applied.filter((one) => one !== GLITTER)
    : state.daycare.applied;

  return {
    ...state,
    tick: state.tick + 1,
    party: boxed ? state.party : [...state.party, atFullHealth(hatched)],
    box: boxed ? [...state.box, atFullHealth(hatched)] : state.box,
    nextUid: state.nextUid + 1,
    bag,
    daycare: {
      ...state.daycare,
      applied,
      eggReady: false,
      eggIndex: state.daycare.eggIndex + 1,
      steps: 0,
    },
    notice: { t: "hatched", boxed },
  };
}

function toggleItem(world: World, state: GameState, item: BreedingItem): GameState {
  if (!atDaycare(world, state)) throw new IllegalInput("you are not in the daycare");
  if (!hasItem(state.bag, item)) throw new IllegalInput("you do not have that");

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

/**
 * The creature behind one of the three cards, before anything is chosen.
 *
 * Pure in (world, index, uid), which is what lets the pick screen show the
 * real thing — its nature, its IVs, the appearance the seed rolled — rather
 * than the species' base stats and a normal-coloured sprite. Showing a plain
 * sprite there was a quiet lie: forty rerolls could pass a chroma starter and
 * never say so, because the appearance only became visible after choosing.
 */
export function offeredStarter(world: World, index: number, uid = 1): Individual {
  if (!Number.isInteger(index) || index < 0 || index >= world.starters.length) {
    throw new IllegalInput("no such starter");
  }

  const rng = rngFor(world.seed, "starter", index);
  const ivs = {} as StatTable;
  for (const stat of STAT_IDS) ivs[stat] = intBetween(rng, 0, STARTER_IV_MAX);

  return atFullHealth(
    withMoves({
      pp: [],
      // Starters roll like anything else in the world does.
      abilities: rollAbilities(rng),
      uid,
      speciesId: world.starters[index],
      level: 5,
      exp: 5 * 5 * 5,
      ivs: clampIvs(ivs),
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      natureId: NATURE_IDS[intBetween(rng, 0, NATURE_IDS.length - 1)],
      // Its own named roll, so adding or removing anything above cannot shift
      // which seeds deal a shiny starter.
      variantId: starterAppearance(world.seed, index),
      hp: 0,
      status: null,
      sleepTurns: 0,
      moves: [],
      nickname: null,
      traded: false,
      parents: null,
      // Last, so the IVs and nature a seed already dealt do not move.
      gender: rollGender(rng),
    }),
  );
}

function pickStarter(world: World, state: GameState, index: number): GameState {
  if (state.phase !== "starter") throw new IllegalInput("starter already chosen");

  const starter = { ...offeredStarter(world, index, state.nextUid), uid: state.nextUid };

  return {
    ...state,
    tick: state.tick + 1,
    phase: "field",
    party: [starter],
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
 * The world is radial: four arms of rings running out from the town at the
 * centre. Each route knows which of its border tiles leads back and which
 * leads on, and the world wires both ends of every crossing when it is built.
 */
function exitFrom(
  world: World,
  from: string,
  x: number,
  y: number,
): { route: string; x: number; y: number } | null {
  const route = world.routes.get(from);
  if (!route) return null;

  // A lookup rather than a derivation. Working out where a border leads from
  // which edge it sits on meant the two sides of a crossing were computed
  // separately, and they disagreed: every walk back from ring one arrived at
  // the western gap whichever arm you had come from. Both directions are
  // written from the same pair of gates when the world is built now, so a
  // round trip is a property of the map rather than of two sums matching.
  const border = route.borders.find((gate) => gate.x === x && gate.y === y);
  return border ? { route: border.to, x: border.at.x, y: border.at.y } : null;
}

/**
 * Why this party cannot be reordered right now, or null if it can.
 *
 * The same shape as depositRefusal and movesRefusal, and for the same reason:
 * the panel has to say *what* is wrong, and a panel that works it out
 * separately from the engine will eventually work out something different.
 */
export function partyOrderRefusal(state: GameState, from: number, to: number): string | null {
  if (state.phase === "battle") return "not in the middle of a battle";
  if (state.phase === "starter") return "you have nobody yet";
  if (!Number.isInteger(from) || !Number.isInteger(to)) return "no such slot";
  if (from < 0 || to < 0 || from >= state.party.length || to >= state.party.length) {
    return "no such slot";
  }
  if (from === to) return "already there";
  return null;
}

function reorderParty(state: GameState, from: number, to: number): GameState {
  const refusal = partyOrderRefusal(state, from, to);
  if (refusal) throw new IllegalInput(refusal);

  const party = [...state.party];
  const [moved] = party.splice(from, 1);
  party.splice(to, 0, moved);

  return { ...state, tick: state.tick + 1, party, notice: null };
}

/**
 * Why this item cannot be used on this creature, or null if it can.
 *
 * The same shape as every other refusal here: the panel needs the reason, not
 * just the verdict, and a panel that derives one separately will eventually
 * derive a different one.
 */
export function itemRefusal(state: GameState, itemId: string, index: number): string | null {
  if (state.phase !== "field") return "not right now";
  if (!isItem(itemId)) return "no such item";
  if (!hasItem(state.bag, itemId)) return "you have none";

  // A lure is lit, not used on anybody, so the party slot is not consulted at
  // all — asking a lure which creature it is for is asking the wrong question.
  const spec = item(itemId);
  if (spec.lure) return lureLeft(state, itemId) > 0 ? "that one is already burning" : null;

  const target = state.party[index];
  if (!target) return "nobody there";

  // A machine is used on a creature like medicine is, and refuses for its own
  // reasons: the wrong species, or one that already knows the move.
  if (spec.teaches) {
    if (target.moves.includes(spec.teaches)) return "it already knows that";
    if (!canLearnMachine(target.speciesId, spec.teaches)) {
      return `a ${speciesById(target.speciesId).name} will not take that one`;
    }
    return null;
  }

  if (spec.kind !== "medicine") return `the ${spec.name} is not used on a creature`;

  const fainted = target.hp <= 0;
  if (spec.revives) return fainted ? null : "it is still standing";
  if (fainted) return "it has fainted";

  if (spec.levels) return target.level >= MAX_LEVEL ? "it cannot grow further" : null;
  if (spec.heals && target.hp < maxHp(target)) return null;
  if (spec.cures && target.status) return null;

  return spec.heals ? "it is already well" : "nothing to cure";
}

function applyItem(state: GameState, itemId: string, index: number): GameState {
  const refusal = itemRefusal(state, itemId, index);
  if (refusal) throw new IllegalInput(refusal);

  const spec = item(itemId);
  let offered: { uid: number; moveId: string }[] = [];

  if (spec.lure) {
    const until = state.tick + 1 + LURE_MOVES;
    // Dead lures are swept here rather than every step: this is the only
    // moment the record grows, so it is the only moment it needs tidying.
    const burning = Object.fromEntries(
      Object.entries(state.lures).filter(([, ends]) => ends > state.tick),
    );

    return {
      ...state,
      tick: state.tick + 1,
      bag: removeItem(state.bag, itemId),
      lures: { ...burning, [itemId]: until },
      notice: { t: "lured", item: itemId, until },
    };
  }

  const party = [...state.party];
  const target = party[index];
  const max = maxHp(target);

  // A machine teaches straight away where there is room, and asks where there
  // is not — the same question a level-up asks, through the same queue, so
  // there is only ever one place that decides what gets forgotten.
  if (spec.teaches) {
    const room = target.moves.length < MAX_MOVES;
    party[index] = room
      ? alignPp({ ...target, moves: [...target.moves, spec.teaches] }, target)
      : target;

    return {
      ...state,
      tick: state.tick + 1,
      party,
      // Machines keep. Three hundred of them, all found rather than bought:
      // one that burned itself out would be one nobody dared spend.
      pendingMoves: room
        ? state.pendingMoves
        : withOffers(state, [{ uid: target.uid, moveId: spec.teaches }]),
      notice: room
        ? { t: "taught", name: speciesById(target.speciesId).name, learned: spec.teaches, forgot: null }
        : null,
    };
  }

  let next: Individual = target;

  if (spec.revives) {
    next = { ...next, hp: Math.max(1, Math.floor(max / spec.revives)), status: null, sleepTurns: 0 };
  } else if (spec.levels) {
    // Through the same growth every battle uses, rather than by setting the
    // level. Setting it and calling `withMoves` rebuilt the moveset from the
    // species list, which quietly threw away a hand-picked one — and it never
    // evolved anything, so a Rare Candy could take a creature five levels past
    // the point it should have changed and leave it exactly as it was.
    const want = Math.min(MAX_LEVEL, next.level + spec.levels);
    const growth = awardExp(next, Math.max(0, expForLevel(want) - next.exp));
    next = atFullHealth(growth.individual);
    offered = growth.movesOffered.map((moveId) => ({ uid: next.uid, moveId }));
  } else {
    if (spec.heals) next = { ...next, hp: Math.min(max, next.hp + spec.heals) };
    if (spec.cures) next = { ...next, status: null, sleepTurns: 0 };
  }

  party[index] = next;

  return {
    ...state,
    tick: state.tick + 1,
    party,
    bag: removeItem(state.bag, itemId),
    pendingMoves: withOffers(state, offered),
    notice: { t: "used", item: itemId, on: speciesById(next.speciesId).name },
  };
}

/**
 * The lures still burning, at this move count.
 *
 * Derived from the expiry written down when each was lit, rather than counted
 * down every step — the same reason quest progress is asked of the save rather
 * than stored in it. A lure whose number has passed is simply not in the list.
 */
export function activeLures(state: GameState): ItemSpec[] {
  return Object.entries(state.lures)
    .filter(([id, until]) => until > state.tick && isItem(id) && item(id).lure)
    .map(([id]) => item(id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** How many moves this lure has left, or zero. */
export function lureLeft(state: GameState, id: string): number {
  return Math.max(0, (state.lures[id] ?? 0) - state.tick);
}

/** Whether a lure would come to this appearance. */
function lureTakes(lure: LureSpec, variantId: string): boolean {
  const form = variant(variantId);
  if (lure.chromaId) return form.chromaId === lure.chromaId;
  if (lure.shine) return form.tier > 0;
  return false;
}

/**
 * Which encounter this route serves next, given what is burning.
 *
 * Ordinarily the answer is "the one after the last": a route's encounters are
 * a fixed list decided when the world was made, walked one at a time, and that
 * is what makes hunting exploration rather than rerolling.
 *
 * A lure does not add anything to that list. It reaches down it. If something
 * unusual is standing within the lure's pull, and it is the kind the lure
 * draws, the encounters between here and there are spent and you meet it now.
 *
 * The loop stops at the *first* marked slot whether or not it matches, and
 * that is the whole safety of the thing: a Chroma Lure can never burn past a
 * true shiny to reach an Ember. It fires only when the next rare thing on this
 * route is the one it was hunting, and otherwise costs nothing but the money.
 *
 * Exported so a test can ask the grass's own question rather than a copy of
 * it. Nothing in the UI reads it: a lure that told you what it was about to
 * find would not be a lure.
 */
export function nextEncounterSlot(world: World, state: GameState, routeId: string): number {
  const from = state.nextSlot[routeId] ?? 0;
  const lures = activeLures(state);
  if (!lures.length) return from;

  const pull = Math.max(...lures.map((spec) => spec.lure!.pull));
  for (let ahead = 0; ahead <= pull; ahead++) {
    const marked = world.census.get(`${routeId}:${from + ahead}`);
    if (!marked) continue;
    return lures.some((spec) => lureTakes(spec.lure!, marked)) ? from + ahead : from;
  }

  return from;
}

/**
 * The best rod in the bag, or null if there is none.
 *
 * Rods are equipment and strictly better as they go, so there is never a
 * reason to ask which one to use — the bag answers it.
 */
export function bestRod(bag: Bag): ItemSpec | null {
  return [...RODS].reverse().find((rod) => hasItem(bag, rod.id)) ?? null;
}

/** Water you could cast into from here, or null. */
function waterBeside(world: World, state: GameState): boolean {
  const route = world.routes.get(state.route);
  if (!route) return false;

  return [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ].some(([dx, dy]) => {
    const x = state.x + dx;
    const y = state.y + dy;
    if (x < 0 || y < 0 || x >= route.width || y >= route.height) return false;
    return route.tiles[y * route.width + x] === TILE.WATER;
  });
}

/** Why you cannot fish here, or null if you can. */
export function fishRefusal(world: World, state: GameState): string | null {
  if (state.phase !== "field") return "not right now";
  if (!bestRod(state.bag)) return "you have no rod";
  if (!waterBeside(world, state)) return "no water within reach";
  if (!state.party.some((creature) => creature.hp > 0)) return "nothing that could fight it";
  return null;
}

function fish(world: World, state: GameState): GameState {
  const refusal = fishRefusal(world, state);
  if (refusal) throw new IllegalInput(refusal);

  const rod = bestRod(state.bag)!;
  const key = `${state.route}:rod`;
  const index = state.nextSlot[key] ?? 0;

  const hooked = atFullHealth(
    withMoves(fishAt(world, ALL_SPECIES, state.route, rod.reach ?? 1, index, state.nextUid)),
  );
  const leadIndex = state.party.findIndex((creature) => creature.hp > 0);

  return {
    ...state,
    tick: state.tick + 1,
    // Its own counter, so casting a line never consumes a patch of grass and
    // walking the grass never consumes the pond.
    nextSlot: { ...state.nextSlot, [key]: index + 1 },
    phase: "battle",
    battle: startBattle(world.seed, `${WILD_TAG}${state.route}:rod:${index}`, state.party, [hooked], leadIndex),
    nextUid: state.nextUid + 1,
    notice: null,
  };
}

/** Whether you are standing in a shop. */
function atMart(world: World, state: GameState): boolean {
  return inside(world, state, "mart");
}

export function buyRefusal(
  world: World,
  state: GameState,
  itemId: string,
  count: number,
): string | null {
  if (!atMart(world, state)) return "you are not in the Mart";
  if (!isItem(itemId)) return "no such item";
  if (!Number.isInteger(count) || count < 1) return "buy at least one";

  const spec = item(itemId);
  if (spec.price <= 0) return "that is not for sale";
  if (!spec.stacks && hasItem(state.bag, itemId)) return "you already have one";
  if (!spec.stacks && count > 1) return "one is all there is";
  if (spec.price * count > state.money) return "you cannot afford that";
  return null;
}

function buyItem(world: World, state: GameState, itemId: string, count: number): GameState {
  const refusal = buyRefusal(world, state, itemId, count);
  if (refusal) throw new IllegalInput(refusal);

  const spec = item(itemId);
  return {
    ...state,
    tick: state.tick + 1,
    money: state.money - spec.price * count,
    bag: addItem(state.bag, itemId, count),
    notice: { t: "bought", item: itemId, count },
  };
}

export function sellRefusal(
  world: World,
  state: GameState,
  itemId: string,
  count: number,
): string | null {
  if (!atMart(world, state)) return "you are not in the Mart";
  if (!isItem(itemId)) return "no such item";
  if (!Number.isInteger(count) || count < 1) return "sell at least one";
  if (countOf(state.bag, itemId) < count) return "you do not have that many";

  const spec = item(itemId);
  if (spec.sell <= 0) return "nobody will buy that";
  return null;
}

function sellItem(world: World, state: GameState, itemId: string, count: number): GameState {
  const refusal = sellRefusal(world, state, itemId, count);
  if (refusal) throw new IllegalInput(refusal);

  const spec = item(itemId);
  return {
    ...state,
    tick: state.tick + 1,
    money: state.money + spec.sell * count,
    bag: removeItem(state.bag, itemId, count),
    notice: { t: "sold", item: itemId, count },
  };
}

/**
 * The tile as it stands *now*, which is not always the tile the world made.
 *
 * Cut, Strength and Rock Smash take an obstacle away for good, and a save
 * records that rather than the world doing so — the world is a pure function
 * of the seed and has to stay one, or two players sharing a seed would stop
 * sharing a map the moment either of them picked up an axe.
 */
export function tileAt(state: GameState, route: Route, x: number, y: number): number {
  const raw = route.tiles[y * route.width + x];
  if (!OBSTACLES[raw]?.clears) return raw;
  return state.cleared.includes(`${route.id}:${x},${y}`) ? TILE.PATH : raw;
}

/** Why this tool will not work here, or null if it will. */
export function toolRefusal(
  world: World,
  state: GameState,
  itemId: string,
  dir: Direction,
): string | null {
  if (state.phase !== "field") return "not right now";
  if (!isItem(itemId)) return "no such tool";
  if (!hasItem(state.bag, itemId)) return "you do not have that";

  const spec = item(itemId);
  if (spec.kind !== "hm") return `the ${spec.name} is not that sort of thing`;
  if (spec.field !== "clear") return `${spec.name} is not used on anything — carrying it is enough`;

  const route = world.routes.get(state.route);
  if (!route) return "nowhere to use it";

  const [dx, dy] = DELTA[dir];
  const x = state.x + dx;
  const y = state.y + dy;
  if (x < 0 || y < 0 || x >= route.width || y >= route.height) return "nothing there";

  const tile = tileAt(state, route, x, y);
  if (!clearedBy(tile, itemId)) return `nothing ${spec.name} can do that way`;
  return null;
}

function applyTool(world: World, state: GameState, itemId: string, dir: Direction): GameState {
  const refusal = toolRefusal(world, state, itemId, dir);
  if (refusal) throw new IllegalInput(refusal);

  const route = world.routes.get(state.route)!;
  const [dx, dy] = DELTA[dir];
  const key = `${state.route}:${state.x + dx},${state.y + dy}`;
  void route;

  return {
    ...state,
    tick: state.tick + 1,
    cleared: [...state.cleared, key].sort(),
    notice: { t: "cleared", item: itemId },
  };
}

/** Whether the whole of a route is visible, or only what is close. */
export function canSee(state: GameState, route: Route): boolean {
  return route.ring < DARK_FROM_RING || hasItem(state.bag, "hm-flash");
}

/** Rings this far out are dark without Flash. */
export const DARK_FROM_RING = 5;
/** How far you can see in the dark. */
export const DARK_RADIUS = 3;

/** Why you cannot fly there, or null if you can. */
export function flyRefusal(world: World, state: GameState, id: string): string | null {
  if (state.phase !== "field") return "not right now";
  if (!hasItem(state.bag, "hm-fly")) return "you have no way to fly";
  const route = world.routes.get(id);
  if (!route) return "no such place";
  if (route.kind === "interior") return "you cannot fly indoors";
  if (!state.visited.includes(id)) return "you have never been there";
  if (id === state.route) return "you are already there";
  return null;
}

function fly(world: World, state: GameState, id: string): GameState {
  const refusal = flyRefusal(world, state, id);
  if (refusal) throw new IllegalInput(refusal);

  const route = world.routes.get(id)!;
  return {
    ...state,
    tick: state.tick + 1,
    route: id,
    x: route.entry.x,
    y: route.entry.y,
    talking: null,
    notice: null,
  };
}

/** Everyone standing on this map. */
export function npcAt(world: World, route: string, x: number, y: number): NpcSpec | null {
  return (world.npcs.get(route) ?? []).find((who) => who.x === x && who.y === y) ?? null;
}

/** The person a save is mid-conversation with, if any. */
export function speakingTo(world: World, state: GameState): NpcSpec | null {
  if (!state.talking) return null;
  for (const here of world.npcs.values()) {
    const found = here.find((who) => who.id === state.talking);
    if (found) return found;
  }
  return null;
}

function talk(world: World, state: GameState, id: string): GameState {
  if (state.phase !== "field") throw new IllegalInput("not right now");

  const person = (world.npcs.get(state.route) ?? []).find((who) => who.id === id);
  if (!person) throw new IllegalInput("nobody there");

  const near = Math.abs(person.x - state.x) + Math.abs(person.y - state.y);
  if (near > 1) throw new IllegalInput("too far away to talk");

  return { ...state, tick: state.tick + 1, talking: id, notice: null };
}

/**
 * Why the person you are talking to cannot help you, or null if they can.
 *
 * One predicate, two callers, as everywhere else: a button is greyed out for
 * exactly the reason the engine would have refused, in the same words.
 */
export function offerRefusal(world: World, state: GameState): string | null {
  const person = speakingTo(world, state);
  if (!person) return "nobody is talking";

  switch (person.kind) {
    case "hint":
      return "there is nothing to take";

    case "gift":
      if (state.helped.includes(person.id)) return "they have already given you one";
      return null;

    case "heal":
      if (!state.party.length) return "you have nothing to heal";
      if (state.party.every((one) => one.hp >= maxHp(one) && !one.status)) return "everyone is well";
      return null;

    case "quest": {
      if (!person.questId) return "there is nothing to take";
      if (state.questsDone.includes(person.questId)) return "that one is finished";
      if (state.questsTaken.includes(person.questId)) return "you already took that";
      // A job with a price of admission. Only the Cup has one, and it wants to
      // *see* the invitation rather than take it: the item is never spent, so
      // this reads the bag and changes nothing in it.
      const needs = questSpec(person.questId).needs;
      if (needs && !countOf(state.bag, needs)) {
        return `they will not talk terms without ${item(needs).name}`;
      }
      return null;
    }

    case "gym": {
      if (!person.gymId) return "there is nothing to take";
      if (state.badges.includes(person.gymId)) return "you already have that badge";
      if (!state.party.some((one) => one.hp > 0)) return "nothing that could fight";
      return null;
    }

    case "cup": {
      if (!person.cupId) return "there is nothing to take";
      // Beaten once and that is the whole of it, as with a badge. What the Cup
      // pays is the quest at the end of it, so a rematch could only ever be
      // for the experience — and five people who can be farmed at level a
      // hundred is not a tournament, it is a treadmill.
      if (state.beaten.includes(person.cupId)) return "you already beat them";
      if (!state.questsTaken.includes(CUP_QUEST)) {
        return "your name is not down - speak to the Steward";
      }
      if (!state.party.some((one) => one.hp > 0)) return "nothing that could fight";
      return null;
    }

    case "buy":
      if (!state.party.some((one) => variant(one.variantId).tier > 0)) {
        return "nothing you are carrying has any shine on it";
      }
      return null;

    case "trade":
      if (state.helped.includes(person.id)) return "they have already traded with you";
      if (!person.wants) return "there is nothing to take";
      if (!state.party.some((one) => matchesWant(one, person.wants!))) {
        return "you have nothing they want - " + wantText(person.wants);
      }
      return null;
  }
}

function npcAccept(world: World, state: GameState): GameState {
  const refusal = offerRefusal(world, state);
  if (refusal) throw new IllegalInput(refusal);

  const person = speakingTo(world, state)!;

  switch (person.kind) {
    case "gift":
      return {
        ...state,
        tick: state.tick + 1,
        bag: addItem(state.bag, person.item!),
        helped: [...state.helped, person.id].sort(),
        notice: { t: "gift", from: person.name, item: person.item! },
      };

    case "heal":
      return {
        ...state,
        tick: state.tick + 1,
        party: state.party.map(restored),
        notice: { t: "healed", by: person.name },
      };

    case "quest":
      return {
        ...state,
        tick: state.tick + 1,
        questsTaken: [...state.questsTaken, person.questId!].sort(),
        notice: { t: "questTaken", id: person.questId! },
      };

    case "gym":
      return challengeGym(world, state, person.gymId!);

    case "cup":
      return challengeCup(world, state, person.cupId!);

    default:
      throw new IllegalInput("that is not something they offer");
  }
}

/**
 * Why this one cannot be sold to the buyer in front of you.
 *
 * The `confirm` uid is the same safety catch a release carries, for the same
 * reason: selling is the other thing in this game that walking back does not
 * undo, and the save being a log means reloading does not undo it either.
 *
 * One predicate, two callers — the panel greys the button for exactly what the
 * engine would refuse, in the engine's own words.
 */
export function appraiseRefusal(
  world: World,
  state: GameState,
  index: number,
  confirm: number,
): string | null {
  const standing = offerRefusal(world, state);
  if (standing) return standing;

  const person = speakingTo(world, state)!;
  if (person.kind !== "buy") return "they are not buying";

  const creature = state.party[index];
  if (!creature) return "nobody there";
  if (creature.uid !== confirm) return "that is not the one you were shown";
  if (variant(creature.variantId).tier <= 0) return "there is no shine on that one";
  if (state.party.length <= 1) return "keep something that can fight";
  return null;
}

/** What the buyer pays for this one, either way round. */
export function appraisal(creature: Individual): { money: number; glitter: number } {
  const tier = variant(creature.variantId).tier;
  return { money: tier * SHINE_PRICE, glitter: tier * SHINE_GLITTER };
}

function npcSell(
  world: World,
  state: GameState,
  index: number,
  take: "money" | "glitter",
  confirm: number,
): GameState {
  const refusal = appraiseRefusal(world, state, index, confirm);
  if (refusal) throw new IllegalInput(refusal);

  const going = state.party[index];
  const paid = appraisal(going);
  const tier = variant(going.variantId).tier;

  return {
    ...state,
    tick: state.tick + 1,
    party: state.party.filter((_, slot) => slot !== index),
    money: take === "money" ? state.money + paid.money : state.money,
    bag: take === "glitter" ? addItem(state.bag, GLITTER, paid.glitter) : state.bag,
    // `found` is untouched on purpose. The census remembers what you have
    // caught, not what you still hold; selling one does not un-see it.
    notice: {
      t: "appraised",
      name: speciesById(going.speciesId).name,
      tier,
      money: take === "money" ? paid.money : 0,
      glitter: take === "glitter" ? paid.glitter : 0,
    },
  };
}

/**
 * Everything waiting to be answered, with the creature it is about.
 *
 * Offers for creatures that are no longer anywhere — released, sold, traded
 * away — are dropped rather than shown: the answer to "what should it forget"
 * is nothing at all when there is no it.
 */
export function pendingOffers(
  state: GameState,
): { uid: number; moveId: string; creature: Individual }[] {
  return state.pendingMoves.flatMap((offer) => {
    const creature =
      state.party.find((one) => one.uid === offer.uid) ??
      state.box.find((one) => one.uid === offer.uid);
    return creature ? [{ ...offer, creature }] : [];
  });
}

/**
 * Why this answer would be refused, or null if it would be taken.
 *
 * Turning an offer down is always allowed — that is the whole point of being
 * asked — so a null `forget` only has to clear the standing checks.
 */
export function learnRefusal(
  state: GameState,
  uid: number,
  moveId: string,
  forget: string | null,
): string | null {
  if (state.phase !== "field") return "not right now";

  const waiting = state.pendingMoves.some(
    (offer) => offer.uid === uid && offer.moveId === moveId,
  );
  if (!waiting) return "nothing was offered";

  const creature =
    state.party.find((one) => one.uid === uid) ?? state.box.find((one) => one.uid === uid);
  if (!creature) return "it is not here any more";
  if (creature.moves.includes(moveId)) return "it already knows that";

  if (forget === null) return null;
  if (forget === moveId) return "that is the one being offered";
  if (!creature.moves.includes(forget)) return "it does not know that one";
  return null;
}

/**
 * Taking an offered move, or turning it down.
 *
 * Either answer clears the offer. Being asked twice about the same move is
 * how a prompt becomes something a player clicks through without reading.
 */
function learnMove(
  state: GameState,
  uid: number,
  moveId: string,
  forget: string | null,
): GameState {
  const refusal = learnRefusal(state, uid, moveId, forget);
  if (refusal) throw new IllegalInput(refusal);

  const pendingMoves = state.pendingMoves.filter(
    (offer) => !(offer.uid === uid && offer.moveId === moveId),
  );

  if (forget === null) {
    return { ...state, tick: state.tick + 1, pendingMoves, notice: null };
  }

  const swap = (one: Individual) =>
    one.uid === uid
      ? alignPp({ ...one, moves: one.moves.map((held) => (held === forget ? moveId : held)) }, one)
      : one;

  const creature =
    state.party.find((one) => one.uid === uid) ?? state.box.find((one) => one.uid === uid)!;

  return {
    ...state,
    tick: state.tick + 1,
    party: state.party.map(swap),
    box: state.box.map(swap),
    pendingMoves,
    notice: {
      t: "taught",
      name: speciesById(creature.speciesId).name,
      learned: moveId,
      forgot: forget,
    },
  };
}

/**
 * Offers a turn produced, folded into what is already waiting.
 *
 * Deduplicated on the way in: the same creature can pass the same level twice
 * in a long battle only if something went wrong, but being asked the same
 * question twice is a bug the player has to click through either way.
 */
function withOffers(
  state: GameState,
  offers: readonly { uid: number; moveId: string }[],
): { uid: number; moveId: string }[] {
  if (!offers.length) return state.pendingMoves;

  const next = [...state.pendingMoves];
  for (const offer of offers) {
    const known = next.some((held) => held.uid === offer.uid && held.moveId === offer.moveId);
    if (!known) next.push(offer);
  }
  return next;
}

/** Why this creature will not do for the trader in front of you. */
export function tradeRefusal(world: World, state: GameState, index: number): string | null {
  const standing = offerRefusal(world, state);
  if (standing) return standing;

  const person = speakingTo(world, state)!;
  if (person.kind !== "trade") return "they are not trading";

  const giving = state.party[index];
  if (!giving) return "nobody there";
  if (!matchesWant(giving, person.wants!)) return "they want " + wantText(person.wants!);
  if (state.party.length <= 1) return "keep something that can fight";
  return null;
}

function npcTrade(world: World, state: GameState, index: number): GameState {
  const refusal = tradeRefusal(world, state, index);
  if (refusal) throw new IllegalInput(refusal);

  const person = speakingTo(world, state)!;
  const given = state.party[index];
  const offer = person.gives!;

  const got = atFullHealth(
    withMoves({
      pp: [],
      // A traded creature came out of somebody else's story, and the offer
      // says what it is. Nothing is rolled here.
      abilities: [],
      uid: state.nextUid,
      speciesId: offer.speciesId,
      level: offer.level,
      exp: expForLevel(offer.level),
      // A traded creature came out of somebody else's story, so the offer
      // fixes its stats rather than a roll here. Marked `traded`, like every
      // arrival a save cannot derive from its own seed.
      ivs: { hp: 20, atk: 20, def: 20, spa: 20, spd: 20, spe: 20 },
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      natureId: NATURE_IDS[offer.level % NATURE_IDS.length],
      variantId: variant(offer.variantId).id,
      hp: 0,
      status: null,
      sleepTurns: 0,
      moves: [],
      nickname: offer.nickname ?? null,
      traded: true,
      parents: null,
      gender: offer.gender,
    }),
  );

  const party = [...state.party];
  party[index] = got;

  return {
    ...state,
    tick: state.tick + 1,
    party,
    nextUid: state.nextUid + 1,
    helped: [...state.helped, person.id].sort(),
    found: state.found.includes(got.variantId) ? state.found : [...state.found, got.variantId].sort(),
    notice: {
      t: "swapped",
      given: speciesById(given.speciesId).name,
      got: speciesById(got.speciesId).name,
    },
  };
}

/**
 * Why this one cannot be let go, or null if it can.
 *
 * Three catches, and they are all the same catch wearing different hats: a
 * release is the one thing in this game that cannot be undone by walking back.
 * A save is a log, so it is not even undoable by reloading — the release is in
 * the log.
 */
export function releaseRefusal(
  state: GameState,
  from: "party" | "box",
  index: number,
  confirm: number,
): string | null {
  if (state.phase !== "field") return "not right now";

  const list = from === "party" ? state.party : state.box;
  const creature = list[index];
  if (!creature) return "nobody there";

  if (creature.uid !== confirm) return "that is not the one you were shown";
  if (from === "party" && state.party.length <= 1) return "keep something that can fight";

  const inDaycare = state.daycare.slots.some((slot) => slot?.uid === creature.uid);
  if (inDaycare) return "it is at the daycare";

  return null;
}

function release(
  state: GameState,
  from: "party" | "box",
  index: number,
  confirm: number,
): GameState {
  const refusal = releaseRefusal(state, from, index, confirm);
  if (refusal) throw new IllegalInput(refusal);

  const list = from === "party" ? state.party : state.box;
  const going = list[index];
  const rest = list.filter((_, slot) => slot !== index);

  return {
    ...state,
    tick: state.tick + 1,
    party: from === "party" ? rest : state.party,
    box: from === "box" ? rest : state.box,
    notice: { t: "released", name: speciesById(going.speciesId).name },
  };
}

/** What beating a gym leader pays the first time. */
const GYM_PURSE = 5000;

/** How long a beaten trainer needs before they will go again. */
export const REMATCH_AFTER = 1000;

/** How much stronger a trainer comes back each time. */
export const REMATCH_LEVELS = 3;

/**
 * Whether this trainer will fight you now.
 *
 * Somebody you have never beaten always will. Somebody you have is sore about
 * it for a thousand moves and then wants another go — and comes back with
 * three levels on them for every time you have won, which is what stops the
 * first ring being worthless by the fourth badge.
 */
export function wantsRematch(state: GameState, id: string): boolean {
  if (!state.beaten.includes(id)) return true;
  return state.tick - (state.beatenAt[id] ?? 0) >= REMATCH_AFTER;
}

/** How many moves until they are ready again, or zero if they are. */
export function rematchIn(state: GameState, id: string): number {
  if (wantsRematch(state, id)) return 0;
  return REMATCH_AFTER - (state.tick - (state.beatenAt[id] ?? 0));
}

/** The tag a gym battle carries, so winning one can be recognised. */
const GYM_TAG = "gym:";

/** Which gym a battle is against, or null. */
export function gymIdOf(battle: BattleState | null): string | null {
  return battle?.tag.startsWith(GYM_TAG) ? battle.tag.slice(GYM_TAG.length) : null;
}

/**
 * What a gym is fielding, built when you walk in rather than when the world
 * was made — because what it fields depends on how far you have come.
 */
export function gymTeam(world: World, state: GameState, id: string): Individual[] {
  const spec = gymSpec(id);
  const level = gymLevel(spec, state.tick, state.badges.length);

  // Everything of the right type, weakest first, so a gym at level twelve is
  // not fielding the same creature as a gym at level eighty.
  const power = (base: StatTable) => STAT_IDS.reduce((sum, stat) => sum + base[stat], 0);
  const pool = ALL_SPECIES.filter((entry) => entry.types.some((type) => type === spec.type)).sort(
    (a, b) => power(a.base) - power(b.base),
  );
  if (!pool.length) return [];

  const team: Individual[] = [];
  let uid = state.nextUid;

  for (let slot = 0; slot < spec.team; slot++) {
    const rng = rngFor(world.seed, "gym", id, level, slot);

    // The ace goes last and comes from the strong end of the pool; the rest
    // are drawn from the whole of it, so a gym has a shape rather than five
    // copies of its best answer.
    const ace = slot === spec.team - 1;
    const from = ace ? Math.floor(pool.length * 0.75) : 0;
    const upto = ace ? pool.length - 1 : pool.length - 1;
    const pick = pool[intBetween(rng, from, upto)];

    team.push(
      atFullHealth(
        withMoves({
          pp: [],
          abilities: rollAbilities(rng),
          uid: uid++,
          speciesId: pick.id,
          level: ace ? level : Math.max(2, level - 2 - intBelow(rng, 3)),
          exp: expForLevel(level),
          ivs: { hp: 20, atk: 20, def: 20, spa: 20, spd: 20, spe: 20 },
          evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
          natureId: NATURE_IDS[intBelow(rng, NATURE_IDS.length)],
          variantId: "normal",
          hp: 0,
          status: null,
          sleepTurns: 0,
          moves: [],
          nickname: null,
          traded: false,
          parents: null,
          gender: rollGender(rng),
        }),
      ),
    );
  }

  return team;
}

function challengeGym(world: World, state: GameState, id: string): GameState {
  const team = gymTeam(world, state, id);
  if (!team.length) throw new IllegalInput("that gym has nobody to field");

  const lead = state.party.findIndex((one) => !isFainted(one));
  if (lead < 0) throw new IllegalInput("nothing that could fight");

  return {
    ...state,
    tick: state.tick + 1,
    talking: null,
    phase: "battle",
    battle: startBattle(world.seed, `${GYM_TAG}${id}`, state.party, team, lead),
    nextUid: state.nextUid + team.length,
    notice: null,
  };
}

/** Which quest puts your name down for the Cup. */
const CUP_QUEST = "the-cup";

/** What beating one of the five pays. Five times a gym, once each. */
const CUP_PURSE = 25000;

/** The tag a Cup battle carries, so winning one can be recognised. */
const CUP_TAG = "cup:";

/** Which contender a battle is against, or null. */
export function cupIdOf(battle: BattleState | null): string | null {
  return battle?.tag.startsWith(CUP_TAG) ? battle.tag.slice(CUP_TAG.length) : null;
}

/**
 * What one of the five is fielding.
 *
 * Built when you walk up to them rather than when the world was made, like a
 * gym team — but for the opposite reason. A gym is built late because what it
 * fields depends on how far you have come; the Cup is built late only because
 * a team needs uids, and uids belong to the save. Nothing here reads the save
 * at all, which is the point: these six are the same six on your first badge
 * as on your eighth.
 *
 * Every number in it comes from somewhere the player can already see:
 *
 *   **Species** from the strong end of the dex, by base stat total. Slanted
 *   contenders draw from their own type; the Sovereign draws from everything,
 *   which is what having no type means.
 *
 *   **IVs** perfect. This is a bred creature and that is what bred means.
 *
 *   **Effort** the whole 510, spent on the two stats the species is for — see
 *   `cupEffort`, which derives the spread rather than listing thirty of them.
 *
 *   **Nature** chosen, up in its best and down in its worst.
 *
 *   **Abilities** two apiece, which in the wild is one creature in a hundred.
 *
 * The seed still decides *which* six of the strongest twelve turn up, so the
 * wall is a fixed height and not a fixed photograph.
 */
export function cupTeam(world: World, state: GameState, id: string): Individual[] {
  const spec = cupSpec(id);

  const power = (base: StatTable) => STAT_IDS.reduce((sum, stat) => sum + base[stat], 0);
  const ranked = ALL_SPECIES.filter(
    (entry) => spec.slant === null || entry.types.some((type) => type === spec.slant),
  ).sort((a, b) => power(b.base) - power(a.base) || a.id.localeCompare(b.id));

  const pool = ranked.slice(0, CUP_POOL);
  if (!pool.length) return [];

  const team: Individual[] = [];
  const used: string[] = [];
  let uid = state.nextUid;

  for (let slot = 0; slot < CUP_SIZE; slot++) {
    const rng = rngFor(world.seed, "cup", id, slot);

    // Six distinct, walking the pool from wherever the draw landed. A team
    // with the same species twice is a team that lost a slot to the dice.
    let pick = pool[intBelow(rng, pool.length)];
    for (let step = 0; used.includes(pick.id) && step < pool.length; step++) {
      pick = pool[(pool.indexOf(pick) + 1) % pool.length];
    }
    used.push(pick.id);

    // The one place a moveset is chosen rather than inherited from the last
    // four levels — see `cupMoveset` for why, and for why nothing else does.
    const moves = cupMoveset(pick.id, spec.level, pick.base);

    team.push(
      atFullHealth({
        pp: fullPp(moves),
        abilities: pickAbilities(rng, CUP_ABILITIES),
        uid: uid++,
        speciesId: pick.id,
        level: spec.level,
        exp: expForLevel(spec.level),
        ivs: { hp: IV_MAX, atk: IV_MAX, def: IV_MAX, spa: IV_MAX, spd: IV_MAX, spe: IV_MAX },
        evs: cupEffort(pick.base),
        natureId: cupNature(pick.base),
        variantId: "normal",
        hp: 0,
        status: null,
        sleepTurns: 0,
        moves,
        nickname: null,
        traded: false,
        parents: null,
        gender: rollGender(rng),
      }),
    );
  }

  return team;
}

function challengeCup(world: World, state: GameState, id: string): GameState {
  if (!isContender(id)) throw new IllegalInput("nobody of that name is in the running");

  const team = cupTeam(world, state, id);
  if (!team.length) throw new IllegalInput("they have nobody to field");

  const lead = state.party.findIndex((one) => !isFainted(one));
  if (lead < 0) throw new IllegalInput("nothing that could fight");

  return {
    ...state,
    tick: state.tick + 1,
    talking: null,
    phase: "battle",
    battle: startBattle(world.seed, `${CUP_TAG}${id}`, state.party, team, lead),
    nextUid: state.nextUid + team.length,
    notice: null,
  };
}

/** What the quest rules are allowed to look at, from this save. */
export function questViewOf(world: World, state: GameState): QuestView {
  return {
    party: state.party,
    box: state.box,
    beaten: state.beaten,
    badges: state.badges,
    visited: state.visited,
    bag: state.bag,
    ringOf: (id) => world.routes.get(id)?.ring ?? 0,
  };
}

/** Why a quest cannot be claimed yet, or null if it can. */
export function claimRefusal(world: World, state: GameState, id: string): string | null {
  if (!isQuest(id)) return "no such quest";
  if (!state.questsTaken.includes(id)) return "you never took that on";
  if (state.questsDone.includes(id)) return "already paid";
  if (!progressOf(questViewOf(world, state), questSpec(id).goal).done) return "not done yet";
  return null;
}

function claimQuest(world: World, state: GameState, id: string): GameState {
  const refusal = claimRefusal(world, state, id);
  if (refusal) throw new IllegalInput(refusal);

  const { reward } = questSpec(id);
  return {
    ...state,
    tick: state.tick + 1,
    money: state.money + (reward.money ?? 0),
    bag: reward.item ? addItem(state.bag, reward.item) : state.bag,
    questsDone: [...state.questsDone, id].sort(),
    notice: { t: "questDone", id },
  };
}

/** Which ball an action names, defaulting to the ordinary one. */
function ballIdOf(action: BattleAction): string {
  return action.t === "ball" ? (action.item ?? "pokeball") : "pokeball";
}

/** How many of the named ball are to hand, for the turn to spend. */
function ballAt(state: GameState, action: BattleAction): number {
  if (action.t !== "ball") return 0;
  const id = ballIdOf(action);
  if (item(id).kind !== "ball") throw new IllegalInput("that is not a ball");
  return countOf(state.bag, id);
}

/**
 * What beating a trainer is worth.
 *
 * Trainers used to hand over five balls, which made the only currency in the
 * game a thing you could not spend on anything else. They pay money now, and
 * balls are bought — so a purse scales with what it took to earn it.
 */
export function trainerPurse(teamSize: number, ring: number): number {
  return 150 * teamSize * Math.max(1, ring);
}

function move(world: World, state: GameState, dir: Direction): GameState {
  if (state.phase !== "field") throw new IllegalInput("cannot walk right now");

  const route = world.routes.get(state.route);
  if (!route) throw new IllegalInput("not on a known route");

  const [dx, dy] = DELTA[dir];
  const nx = state.x + dx;
  const ny = state.y + dy;
  if (nx < 0 || ny < 0 || nx >= route.width || ny >= route.height) throw new IllegalInput("off the map");

  const tile = tileAt(state, route, nx, ny);
  if (!passable(tile, (item) => hasItem(state.bag, item))) throw new IllegalInput("blocked");

  // Furniture is a layer above the floor rather than a kind of floor, so what
  // it blocks is asked of the prop and not of the tile under it.
  if (propBlocks(route, nx, ny)) throw new IllegalInput("blocked");

  // A door is a transition rather than a step: stepping onto one puts you on
  // the other side of it.
  const door = route.doors.find((entry) => entry.x === nx && entry.y === ny);
  if (door) {
    const arrived = arrive(world, state, door.to);
    return walked({ ...arrived, tick: state.tick + 1, route: door.to, x: door.at.x, y: door.at.y });
  }

  const onBorder = nx === 0 || ny === 0 || nx === route.width - 1 || ny === route.height - 1;
  if (onBorder) {
    const exit = exitFrom(world, state.route, nx, ny);
    if (exit) {
      const arrived = arrive(world, state, exit.route);
      return walked({ ...arrived, tick: state.tick + 1, route: exit.route, x: exit.x, y: exit.y });
    }
    throw new IllegalInput("blocked");
  }

  // Somebody who wants to talk rather than fight. They stand on open ground
  // like a trainer does, so walking into one is a choice and not an ambush,
  // and they do not step aside: the conversation happens where they stand.
  const person = npcAt(world, state.route, nx, ny);
  if (person) {
    return { ...state, tick: state.tick + 1, talking: person.id, notice: null };
  }

  // Walking away is a way of ending a conversation, and the commonest one.
  // Leaving `talking` set would keep the panel open above a map you had
  // already left the speaker behind on.
  const moved: GameState = walked({
    ...state,
    tick: state.tick + 1,
    x: nx,
    y: ny,
    talking: null,
    notice: null,
  });

  // Something on the floor. Picked up by standing on it, once ever.
  const lying = (world.pickups.get(state.route) ?? []).find(
    (drop) => drop.x === nx && drop.y === ny && !state.taken.includes(drop.id),
  );
  if (lying) {
    return {
      ...moved,
      bag: addItem(moved.bag, lying.item),
      taken: [...moved.taken, lying.id].sort(),
      notice: { t: "picked", item: lying.item },
    };
  }

  // Somebody standing in the way. They are on the path and therefore visible,
  // so walking into one is a choice rather than an ambush.
  const trainer = trainerAt(world, state.route, nx, ny);
  if (trainer && wantsRematch(state, trainer.id)) {
    const lead = state.party.findIndex((creature) => !isFainted(creature));
    if (lead >= 0) {
      let uid = state.nextUid;
      const team = trainer.team.map((member, slot) => {
        const built = withMoves({
          pp: [],
          // The people out on the routes roll too, from the trainer's own
          // named stream, so the same trainer fields the same team forever.
          abilities: rollAbilities(rngFor(world.seed, "trainer-ability", trainer.id, slot)),
          uid: uid++,
          speciesId: member.speciesId,
          // Three levels for every beating they have already taken from you,
          // which is what stops the first ring being worthless by the fourth
          // badge — the people on it grew up too.
          level: Math.min(100, member.level + (state.wins[trainer.id] ?? 0) * REMATCH_LEVELS),
          exp: member.level * member.level * member.level,
          ivs: { hp: 8, atk: 8, def: 8, spa: 8, spd: 8, spe: 8 },
          evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
          natureId: NATURE_IDS[member.level % NATURE_IDS.length],
          variantId: "normal",
          hp: 0,
          status: null,
          sleepTurns: 0,
          moves: [],
          nickname: null,
          traded: false,
          parents: null,
          gender: rollGender(rngFor(world.seed, "trainer-gender", trainer.id, slot)),
        });
        return atFullHealth(built);
      });

      return {
        ...moved,
        phase: "battle",
        battle: startBattle(world.seed, `${TRAINER_TAG}${trainer.id}`, state.party, team, lead),
        nextUid: uid,
        notice: null,
      };
    }
  }

  if (!hidesEncounters(tile) || route.kind !== "route") return moved;

  const stepped = (state.steps[state.route] ?? 0) + 1;
  const steps = { ...state.steps, [state.route]: stepped };
  if (!encounterTriggers(world.seed, state.route, stepped)) return { ...moved, steps };

  // Nothing able to fight means nothing to fight with, so the grass stays
  // quiet rather than starting a battle that cannot be played.
  const leadIndex = state.party.findIndex((creature) => !isFainted(creature));
  if (leadIndex < 0) return { ...moved, steps };

  const slot = nextEncounterSlot(world, state, state.route);
  const wild = atFullHealth(withMoves(wildAt(world, ALL_SPECIES, state.route, slot, state.nextUid)));

  return {
    ...moved,
    steps,
    nextSlot: { ...state.nextSlot, [state.route]: slot + 1 },
    phase: "battle",
    // The tag keeps this encounter's rolls distinct from every other one in
    // the world, so two battles never share a critical hit.
    battle: startBattle(world.seed, `${WILD_TAG}${state.route}:${slot}`, state.party, [wild], leadIndex),
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
    //
    // Asked as "is this the grass" rather than "is this somebody on a route",
    // which is what it used to ask. Every battle that was neither was left
    // with WILD_RULES and therefore `catchable: true`, so a gym leader's team
    // was catchable as far as the engine was concerned — only the UI declined
    // to draw the button. A third kind of trainer battle would have walked
    // into the same hole, so the question is now the one that was meant.
    const rules = isWildBattle(state.battle) ? WILD_RULES : TRAINER_RULES;
    result = resolveTurn(state.battle, [action, aiAction(state.battle)], rules, ballAt(state, action));
  } catch (error) {
    throw new IllegalInput(error instanceof Error ? error.message : "bad battle action");
  }

  // Moves grown into mid-battle with no room for them. Collected here rather
  // than at the end, because a battle can be fled or lost and the level was
  // still gained.
  const offers = result.battle.events.flatMap((event) =>
    event.t === "exp" ? event.offered.map((moveId) => ({ uid: event.uid, moveId })) : [],
  );

  const base: GameState = {
    ...state,
    tick: state.tick + 1,
    // The party fought inside the battle, so it comes back out of it.
    party: result.battle.sides[0].team,
    pendingMoves: withOffers(state, offers),
    bag: result.ballsUsed ? removeItem(state.bag, ballIdOf(action), result.ballsUsed) : state.bag,
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

    case "win": {
      if (outcome.side === 1 || wipedOut) return whiteout(world, base);

      const trainerId = trainerIdOf(result.battle);
      const gymId = gymIdOf(base.battle);
      if (gymId) {
        // A badge is won once. Beating the same leader again — which you can,
        // there is nothing stopping you — pays nothing further, because what
        // a badge does is make every *other* gym harder.
        const already = base.badges.includes(gymId);
        return {
          ...base,
          phase: "battleEnd",
          badges: already ? base.badges : [...base.badges, gymId].sort(),
          money: base.money + (already ? 0 : GYM_PURSE),
          bag: already ? base.bag : addItem(base.bag, gymSpec(gymId).tool),
          notice: already ? { t: "won" } : { t: "badge", gym: gymId },
        };
      }

      const cupId = cupIdOf(base.battle);
      if (cupId) {
        // Recorded in `beaten` with everybody else you have beaten, because
        // that is what the list is — and the quest counts the five by name
        // rather than by how long the list is, so nothing else has to care
        // that these five are in it. `beatenAt` and `wins` are set for the
        // same reason a trainer's are: they are what the world uses to answer
        // "again?", and the refusal above already says no.
        const already = base.beaten.includes(cupId);
        return {
          ...base,
          phase: "battleEnd",
          beaten: already ? base.beaten : [...base.beaten, cupId].sort(),
          beatenAt: { ...base.beatenAt, [cupId]: base.tick },
          wins: { ...base.wins, [cupId]: (base.wins[cupId] ?? 0) + 1 },
          money: base.money + (already ? 0 : CUP_PURSE),
          notice: {
            t: "beatTrainer",
            name: cupSpec(cupId).name,
            money: already ? 0 : CUP_PURSE,
          },
        };
      }

      if (!trainerId) return { ...base, phase: "battleEnd", notice: { t: "won" } };

      const trainer = [...world.trainers.values()].flat().find((who) => who.id === trainerId);
      const wins = (base.wins[trainerId] ?? 0) + 1;
      const purse = trainerPurse(trainer?.team.length ?? 1, world.routes.get(base.route)?.ring ?? 1) * wins;

      return {
        ...base,
        phase: "battleEnd",
        beaten: base.beaten.includes(trainerId) ? base.beaten : [...base.beaten, trainerId].sort(),
        // When, and how many times. Both are needed: one decides when they are
        // willing to go again, the other decides what they bring.
        beatenAt: { ...base.beatenAt, [trainerId]: base.tick },
        wins: { ...base.wins, [trainerId]: wins },
        money: base.money + purse,
        notice: { t: "beatTrainer", name: trainer?.name ?? "They", money: purse },
      };
    }
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
    // Beaten, carried home, and put right — uses included. Losing is the one
    // thing in this game that costs you nothing but the walk back.
    party: state.party.map(restored),
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
      creature.gender,
      creature.hp,
      creature.status ?? "-",
      creature.sleepTurns,
      creature.moves.join("/"),
      // Uses left is state a player can lose a battle over, so a save that
      // has spent its Surf cannot hash the same as one that has not.
      creature.moves.map((_, at) => ppLeft(creature, at)).join("/"),
      creature.abilities.join("+"),
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
    state.money,
    bagEntries(state.bag).map(([id, count]) => `${id}x${count}`).join(","),
    battle,
    state.found.join(","),
    daycare,
    state.visited.join(","),
    state.beaten.join(","),
    counters(state.lures),
    state.pendingMoves.map((offer) => `${offer.uid}:${offer.moveId}`).join(","),
    state.cheated ? "1" : "0",
  ].join(";");

  return hash32(canonical).toString(16).padStart(8, "0");
}

/** Full stats for a creature, re-exported so the UI has one place to ask. */
export { computeStats };
