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
import { trainerAction } from "@/ai";
import { fieldKey } from "./field";
import {
  breed,
  compatible,
  eggSteps,
  emptyDaycare,
  GLITTER,
  hatchSteps,
  incubatorSlots,
  reducedHatch,
  type BreedingItem,
  type DaycareState,
  type Egg,
} from "./breeding";
import {
  ALL_SPECIES,
  canLearnMachine,
  learnableAt,
  movesAtLevel,
  species as speciesById,
} from "./dex";
import { rollGender, type Gender } from "./gender";
import { fieldUse, needsTarget } from "./fieldmoves";
import {
  RIVAL_BEHIND,
  RIVAL_NAME,
  RIVAL_PURSE,
  RIVAL_STALK,
  RIVAL_TAG,
  rivalCaughtUp,
  rivalDue,
  rivalTeam,
  TRAIL,
} from "./rival";
import { NATURE_IDS } from "./natures";
import { effortSpent, gainEffort } from "./effort";
import {
  awardExp,
  evolve,
  evolutionByItem,
  expForLevel,
  forgottenMoves,
  MAX_LEVEL,
  MOVE_SLOTS,
} from "./progression";
import { pickAbilities, rollAbilities } from "./abilities";
import { isBracketSize, type BracketSize } from "./bracket";
import { cheatPrizeOffer, prizeOffer } from "./prize";
import { heldEffects, holdOf } from "./carry";
import {
  awayFrom,
  CRITTER_TAG,
  critterIdOf,
  roamIndex,
  ROAM_CHANCE,
  standingOn,
  type CritterSpec,
} from "./critters";
import { alignPp, fullPp, ppLeft, restorePp, spendPp } from "./pp";
import { matchesWant, SHINE_GLITTER, SHINE_PRICE, wantText, type NpcSpec } from "./npc";
import {
  isQuest,
  progressOf,
  quest as questSpec,
  type QuestView,
} from "./quests";
import { gym as gymSpec, gymLevel } from "./gyms";
import { hint, type Hint } from "./hints";
import {
  contender as cupSpec,
  cupEffort,
  cupMoveset,
  cupNature,
  CUP_ABILITIES,
  CUP_HOLDS,
  CUP_POOL,
  CUP_SIZE,
  isContender,
} from "./cup";
import { hash32, intBelow, intBetween, rngFor } from "./rng";
import { clampIvs, computeStats, EV_MAX_PER_STAT, EV_MAX_TOTAL, IV_MAX } from "./stats";
import { STAT_IDS, type Individual, type StatId, type StatTable } from "./types";
import { appearanceId, chroma, CHROMA_IDS, variant } from "./variants";
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
import { inkFor } from "./items";
import { cutReady, cutWait, stoneFor } from "./lapidary";
import { chippedStat, hasIvsLeft, nextNature, REFORGE_COST } from "./smith";
import {
  arena,
  arenaBand,
  arenaLevel,
  ARENA_POOL,
  ARENA_ROUNDS,
  ARENA_SIZE,
  isArena,
} from "./arenas";
import { PRIZE_CHOICES } from "./prize";
import {
  PRINT_CONSOLATION,
  PRINT_FAILS,
  PRINT_LEVEL,
  printReady,
  printWait,
} from "./printer";

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
  /** The player's trainer name. Given once, normally before the starter. */
  | { t: "trainer"; name: string }
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
  /** `to` the incubators rather than the party; absent means the party. */
  | { t: "collectEgg"; to?: "party" | "incubator" }
  /**
   * Opens an egg that has walked its steps. An input rather than something
   * that happens on the step, because the hatching is a scene the player
   * watches, and the creature joining is the end of it.
   */
  | { t: "hatch"; index: number; from?: "party" | "incubator" }
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
   * A creature won in a bracket, and which of the three on offer was taken.
   *
   * Carried whole for exactly the reason `trade` is: the three were rolled
   * from a tournament that happened in other people's browsers, off a room
   * code this save has never seen, so there is nothing here to derive them
   * from. The log stays replayable and this one creature is taken on trust —
   * which is why it arrives marked `prize` and is reported at check-in beside
   * the trades.
   *
   * It joins the party if there is room and goes to the box if there is not,
   * the way a catch does. Refusing it for a full party would mean winning a
   * tournament and being told to come back later.
   */
  | { t: "prize"; receive: Individual }
  /**
   * Asking the printer for a copy of the last thing you saw, in this colour.
   *
   * Everything about the result is derived — the species from `lastWild`, the
   * failure roll from the world seed and the tick — so nothing is carried in
   * the input and a replay produces the same creature, or the same can of
   * Slurm. That is the whole difference between this and `prize`: a
   * tournament happened somewhere the seed cannot see, and a print happens
   * right here.
   */
  | { t: "print"; chromaId: string }
  /**
   * Handing a creature to the man with the machine, for candy.
   *
   * `confirm` is the uid, and it is a safety catch rather than ceremony: this
   * is the second irreversible thing in the game a party list can slide under
   * — the Appraiser was the first — and a mis-click on a list that moved is
   * not undoable. The same guard, for the same reason.
   */
  | { t: "shred"; index: number; confirm: number }
  /**
   * Handing one to the lapidary, for a stone of its type.
   *
   * Nothing is carried: which stone comes back is rolled from the world seed,
   * the tick and the creature, so a dual type cannot be rerolled by walking
   * out and back in, and a replay hands back the same one.
   */
  | { t: "cut"; index: number; confirm: number }
  /**
   * Putting one on the smith's anvil: a different nature, one IV point fewer.
   *
   * Nothing is carried — which nature it lands on and which IV takes the dent
   * are rolled from the seed, the tick and the creature — so a replay swings
   * the same hammer at the same place, and a bad nature cannot be reloaded
   * away.
   */
  | { t: "reforge"; index: number; confirm: number }
  /**
   * Entering the bracket the person in front of you is running.
   *
   * Nothing is carried: the draw, the seven opponents and every team in it are
   * derived from the world seed, the arena and the tick it was entered on. So
   * a replay of the same log walks into the same eight-player field — which is
   * the difference between this and the PvP bracket, where the other seven are
   * in other people's browsers and nothing about them can be derived at all.
   */
  | { t: "arenaEnter"; id: string }
  /** Starting the next round's match. */
  | { t: "arenaFight" }
  /** And taking one of the three at the end of it. */
  | { t: "arenaPrize"; index: number }
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
   * Gives a creature in the party or the box a nickname. By uid rather than by
   * index, because the box and the party are two lists and a name is the same
   * question of either. An empty name takes the nickname off again.
   */
  | { t: "rename"; uid: number; name: string }
  /** Opens another box tab. */
  | { t: "addBox" }
  /** Names a box tab. Empty gives it its default name back. */
  | { t: "renameBox"; tab: number; name: string }
  /** Moves a boxed creature into another tab, if that tab has room. */
  | { t: "moveToBox"; uid: number; tab: number }
  /**
   * Using something from the bag, on a party member.
   *
   * Out in the field only. Letting a potion be used mid-battle would mean the
   * duel protocol had to commit to it like a move, and a healing item nobody
   * can answer is the shortest road to a battle that never ends. Heal between
   * fights, like the rest of the game asks you to.
   */
  | { t: "useItem"; item: string; index: number }
  /**
   * Using one of a creature's own moves out in the world.
   *
   * `index` is the party slot whose move it is and `moveIndex` the slot in its
   * four — the same pair `fight` uses, for the same reason: a move id would be
   * ambiguous on a creature that knows one move twice, and a creature uid
   * would not say which of its four was pressed.
   *
   * `to` is the party slot being helped, for the two moves that hand health
   * over. Absent for the other five, which point at the world rather than at
   * anybody.
   */
  | { t: "fieldMove"; index: number; moveIndex: number; to?: number }
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
   * Riding the Grey Line to another of their posts.
   *
   * Its own input rather than a `fly`, because the two answer different
   * questions. Fly asks "do you have the wing, and have you been there"; this
   * asks "are you stood in front of a Greycoat, is there one at the other end,
   * and have you been there". Sharing the input would mean sharing the
   * predicate, and a coach that needed an HM would be a coach nobody rides.
   */
  | { t: "npcTravel"; route: string }
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
  /**
   * Answering an evolution: yes, or no.
   *
   * `to` is carried as well as `uid` so that an answer names the question it
   * is answering. Without it a stale click — the scene dismissed twice, an
   * input log replayed against a slightly different world — could apply an
   * evolution the player never saw offered.
   *
   * Saying no is a real answer and not a delay: the offer is cleared, the
   * creature keeps growing, and it will not be asked about this threshold
   * again. It is an input rather than a UI state precisely so that a replay
   * refuses it again, which is the whole of why evolution had to stop being
   * something `awardExp` did on its own.
   */
  | { t: "evolve"; uid: number; to: string; accept: boolean }
  /**
   * Giving a creature something to carry, or taking it back.
   *
   * `item` of null takes whatever it has. Nothing is destroyed either way: an
   * item handed over leaves the bag and an item taken back returns to it, so
   * the two together are a move rather than a spend — which is what makes
   * trying a Choice Band on something a decision you can walk back.
   */
  | { t: "holdItem"; index: number; item: string | null }
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
  /** The same creature as `give`, handed over as an egg a few steps from hatching. */
  | { op: "egg"; speciesId: string; variantId: string; steps: number }
  | { op: "heal" }
  | { op: "balls"; count: number }
  | { op: "money"; count: number }
  | { op: "items" }
  | { op: "warp"; route: string }
  | { op: "setVariant"; index: number; variantId: string }
  | { op: "setGender"; index: number; gender: Gender }
  | { op: "setLevel"; index: number; level: number }
  /**
   * One of the three a bracket of `size` would offer, without playing one.
   *
   * For looking at the prize roll, which is otherwise four wins away and
   * needs three other people in a room. `roll` picks *which* three — the
   * menu bumps it to shuffle the offer — and `index` says which of them was
   * taken. Both are in the input, so the same log always produces the same
   * creature: the offer is recomputed on replay rather than carried, which is
   * what keeps this an ordinary cheat rather than a second `prize` input with
   * a creature smuggled inside it.
   */
  | { op: "prize"; size: BracketSize; roll: number; index: number };

/** What just happened outside a battle, for the UI to phrase. Structured
 * rather than a string so display language is never part of the state hash;
 * battle narration lives in BattleState.events for the same reason. */
export type Notice =
  | { t: "starter" }
  | { t: "encounter" }
  | { t: "caught"; variantId: string; boxed: boolean }
  | { t: "won" }
  | { t: "fled" }
  /** `at` is the place you woke up, for the message to name. */
  | { t: "whiteout"; at: string }
  | { t: "found"; item: BreedingItem }
  /** An egg went into the bag, and how long it will take. */
  | { t: "eggTaken"; steps: number }
  | { t: "hatched"; speciesId: string; variantId: string; boxed: boolean }
  /** The Exp. Share, handed over because `on` reached level 40. */
  | { t: "expShare"; on: string }
  | { t: "beatTrainer"; name: string; money: number }
  | { t: "traded"; given: string; received: string }
  /** A bracket won, and which of the three was taken. */
  | { t: "prize"; speciesId: string; variantId: string; boxed: boolean }
  /** The machine worked. */
  | { t: "printed"; speciesId: string; chromaId: string; boxed: boolean }
  /** And the quarter of the time it does not. */
  | { t: "printFailed"; item: string }
  /** One handed to the shredder, and what it came to. */
  | { t: "shredded"; name: string; level: number; candy: number }
  /** And one handed to the lapidary. */
  | { t: "cut"; name: string; item: string }
  /** Off the anvil: which nature it was, which it is, and what it cost. */
  | { t: "reforged"; name: string; from: string; to: string; stat: StatId }
  /** A round of a bracket, taken. */
  | { t: "arenaRound"; id: string; round: number }
  /** And the last one. */
  | { t: "arenaWon"; id: string }
  | { t: "used"; item: string; on: string }
  /** A move used out in the world, for the ones whose effect is not itself
   * visible — a map filled in, a walk home, health handed over. */
  | { t: "usedMove"; move: string }
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
  | { t: "taught"; name: string; learned: string; forgot: string | null }
  /**
   * Changed into something else outside a battle.
   *
   * Its own notice rather than a `used`, because the screen wants to show it:
   * levelling into an evolution gets the whole twenty-second reveal, and a
   * stone doing the same thing should not be a line of small text. Both halves
   * are carried for the same reason the battle event carries both — the
   * creature has already changed by the time anything reads this.
   *
   * And `uid` for the same reason the battle's `exp` event carries one: the
   * scene shows a creature, and "which species" does not say which creature.
   * Two Gloom in a party and a Leaf Stone on one of them is enough for the
   * scene to pick the wrong appearance, and a shiny watching itself evolve in
   * factory colours is the version of this bug that got noticed.
   */
  /**
   * `watched` when the change was the answer to an offer: the player has just
   * sat through the scene that asked, so there is nothing left to show. A
   * stone's evolution has no such question in front of it and is revealed.
   */
  | { t: "evolved"; from: string; to: string; uid: number; watched?: true }
  /** Put down somewhere else by the Grey Line. The route, for the UI to name. */
  | { t: "travelled"; route: string }
  | { t: "given"; item: string; on: string }
  | { t: "took"; item: string; on: string }
  /** Walked up to something standing about that had nothing to offer. */
  /** `critterId` finds what it was doing; see `critterDoing`. */
  | { t: "noticed"; speciesId: string; critterId: string }
  /** Something standing about came along. */
  /** `critterId` finds what it was doing as it came along; see `critterDoing`. */
  | { t: "joined"; speciesId: string; boxed: boolean; critterId: string };

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
  /**
   * Which parts of each route you have laid eyes on.
   *
   * The small map is a memory rather than a satellite: it shows the ground you
   * have actually walked past, and the rest of the route stays dark until you
   * go and look. This is what it remembers.
   *
   * Stored rather than derived, and in the state rather than beside it. It has
   * to survive a save, a save is a log of inputs, and so anything that has to
   * survive one must be a fold over them — the same reason `roamers` is here.
   * It is folded once, centrally, in `applyInput`: every way of arriving
   * somewhere reveals what you can see from it, including the ones nobody
   * remembers to think about (a door, a border, Fly, an Escape Rope, waking up
   * in a Center after everything fainted).
   *
   * A route is 88x68, which is 5,984 tiles, and there are fifty of them. So
   * this is a *bitset in hexadecimal over blocks of `FOG` tiles* rather than a
   * list of coordinates: three hundred and seventy-four bits a route, ninety-
   * four characters, against the eighteen thousand numbers the readable version
   * would have cost. Blocks also make the map look like a map — fog that
   * retreats a tile at a time reads as a torch, and this is not a torch.
   */
  seen: Record<string, string>;
  /**
   * The Poké Center you were last inside, or null before you have been in one.
   *
   * Where you wake up when everything faints. With one town that was Hearth and
   * needed no remembering; with four it is the difference between losing the
   * walk back from a route and losing the walk back from the far side of the
   * world. Walking in is what counts, not healing — a Center you have stood in
   * is a Center you know the way to.
   *
   * State rather than a note beside it, because it changes what an input
   * *does*: the same log with a different Center in it puts you somewhere
   * else. It is in the hash for that reason.
   */
  centre: string | null;
  /**
   * Where you have just been, newest first.
   *
   * Four entries, which is all anything needs to walk three steps behind you.
   * Kept whether or not anybody is following, because the rival appears on a
   * tick nobody chose and has to already know where you were.
   *
   * This is the whole of what it takes to have something chase you: his
   * position is not stored, it *is* `trail[RIVAL_BEHIND]`. There is no second
   * copy of where he is to disagree with the first, and a save that replays
   * walks him over the same ground.
   */
  trail: { route: string; x: number; y: number }[];
  /**
   * The tick the rival turned up on, or null when nobody is out there.
   *
   * One number. How far behind he is, where he is standing, how long until he
   * catches you and what he will be carrying are all read off this and the
   * trail.
   */
  rivalSince: number | null;
  /**
   * The tick he last turned up on, or null before the first time.
   *
   * The schedule, kept apart from `rivalSince` because they are two facts: one
   * is "is somebody out there now", the other is "when was the last time". Null
   * is what makes his first appearance the first move of a new game.
   */
  rivalLast: number | null;
  /**
   * How many times he has turned up. The journal's number; `rivalLast` is a
   * schedule and a schedule is not a count.
   */
  rivalVisits: number;
  party: Individual[];
  box: Individual[];
  /**
   * The box's tabs, by name. Always at least one. A tab holds `BOX_SIZE`.
   *
   * Which tab a creature sits in is `boxOf`, by uid, rather than a list per
   * tab: `box` stays one flat list so every input that already names a box
   * index keeps meaning what it meant.
   */
  boxNames: string[];
  boxOf: Record<number, number>;
  /** Whether the Exp. Share has been handed over. Once per save. */
  expShareGiven: boolean;
  /** The player's trainer name, written on everything they catch. Null until chosen. */
  trainerName: string | null;
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
  /**
   * Every species you have met, and where you first met it.
   *
   * The other half of the exploration record `visited` began. `visited` says
   * which of the fifty places you have stood in; this says what was standing
   * there — so between them they answer "have I combed this route" rather than
   * merely "have I crossed it", which is the question a world with fifty-eight
   * decorated creatures hidden in it actually asks.
   *
   * A route id rather than a boolean, because *where* is the useful half. A
   * list of names you have seen is a collection; a list of names against the
   * places they were is a map of where you have actually looked.
   *
   * Folded centrally in `noted`, for the reason `cloneSide` taught this
   * codebase the hard way: there are nine roads to a battle in this file —
   * grass, a rod, a tree, Sweet Scent, a person on a path, a gym, the Cup, a
   * creature standing about, and the rival, who starts his from inside the
   * funnel itself — and a fold written at each of them is nine chances to
   * forget the tenth.
   *
   * In the hash, and for the same reason `seen` is: it is state, and a claim
   * that two logs produce the same state should not have an exception in it.
   * It is deliberately **not** an `ENGINE_VERSION` bump, because no input does
   * anything different — nobody has moved, nothing new is solid, and an old
   * log replays to exactly the game it always did, now also carrying a record
   * of what it met on the way.
   *
   * `whereMet` rather than `met`, because `met` was taken: that one is the
   * list of idle creatures already walked up to, which is a fact about the
   * *map* rather than about the player's knowledge. Two records with the same
   * name would be the shortest road to reading one and meaning the other.
   */
  whereMet: Record<string, string>;
  /**
   * Every species that has ever been yours, sorted.
   *
   * The Pokédex's "caught". Folded in the same place `whereMet` is, from the
   * party and the box, so a starter, a catch, an egg, a gift and a trade all
   * count and releasing one later does not unwrite having had it. Not
   * derivable after the fact — a creature released is a creature gone — which
   * is why it is one of the few things here that is recorded.
   */
  caught: string[];
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
   * Creatures standing at the edge of becoming something else.
   *
   * The same shape and the same reasoning as `pendingMoves` beside it, and it
   * arrived for the same reason: an evolution used to be applied by `awardExp`
   * the instant the level was gained, which meant the scene the game stops
   * everything to play was a picture of something already true and there was
   * nowhere to stand to say no. These games have always let you say no.
   *
   * A queue, because one battle can take a creature past two thresholds and
   * because a party of six can all come out of a Cup run ready at once. Kept
   * in the save, so an evolution offered at the end of a session is still
   * waiting at the start of the next one rather than silently taken.
   */
  pendingEvolutions: { uid: number; to: string }[];
  /** Eggs carried in the bag, oldest first, each counting down its steps. */
  eggs: Egg[];
  /**
   * The species of the last wild creature you saw, or null.
   *
   * Written on sight rather than on a catch, because it is a scan: the
   * printer works from what its camera last picked up, and losing to
   * something does not unsee it. Only wild encounters count — a gym leader's
   * ace is somebody's creature, not a specimen.
   */
  lastWild: string | null;
  /**
   * The bracket you are part-way through, or null.
   *
   * Only ever one, because you cannot be in two knockouts at once and a queue
   * of them would be a queue nobody asked for. Three fields and no more: the
   * whole draw is *derived* from these — who you face in each round, what they
   * bring, and how the other half of the board went — so there is nothing here
   * that could disagree with what is on screen.
   *
   * `entered` is the tick it began on, which is what every roll in it is named
   * after. Two brackets entered at the same arena on different ticks are two
   * different draws, and re-entering after losing gives you a new one rather
   * than the one you just lost.
   */
  arena: { id: string; entered: number; round: number } | null;
  /**
   * The tick of the last print, or null before the first.
   *
   * A stamp rather than a countdown, the same shape a rematch uses: a number
   * decremented every step is a number that can drift out of step with the
   * clock it was measured against.
   */
  printedAt: number | null;
  /**
   * The tick the shredder last took one, or null before the first.
   *
   * The same shape the printer's stamp has, and for the same reason: a number
   * decremented on every step is a number that can drift out of step with the
   * clock it was measured against. A thousand moves is deliberately longer
   * than the printer's six hundred — the printer costs you a walk, and this
   * costs you a creature.
   */
  shreddedAt: number | null;
  /**
   * The tick the lapidary last took one, or null before the first.
   *
   * Its own stamp rather than sharing the shredder's: two people, two
   * machines, and one gate covering both would mean using one locked you out
   * of the other for reasons no sign anywhere explains.
   */
  cutAt: number | null;
  /**
   * Lures currently burning: item id, and the move count they die at.
   *
   * An expiry rather than a countdown, so nothing has to be decremented on
   * every step and a lure cannot drift out of step with the clock it was
   * measured against. Expired entries are swept the next time one is lit.
   */
  lures: Record<string, number>;
  /**
   * How far along its loop each roamer has walked.
   *
   * A number per roamer, and the only thing about a creature standing in the
   * world that the save has to remember. The *loop itself* is in the world,
   * because it is a fact about the place; this is a fact about the
   * playthrough. Absent means the beginning.
   *
   * Stored rather than derived, unlike almost everything else here, and for a
   * reason worth writing down: it *could* be derived by folding every step
   * ever taken, but that fold is O(moves) and a save reaches ninety thousand
   * of them. An index is the fold, cached at the only moment it changes.
   */
  roamers: Record<string, number>;
  /**
   * Creatures standing in the world that have been dealt with, sorted.
   *
   * One that joined you, or one you beat or caught. They are gone from the map
   * afterwards, the same way a picked-up item is: a creature you already have
   * standing in the same spot forever would be a promise the world keeps
   * breaking.
   */
  met: string[];
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
 * Something shaken out of a tree.
 *
 * Its own tag so a creature met in the grass and one that fell out of a tree
 * never share a roll even at the same census slot — the tag is what makes one
 * encounter's criticals independent of another's.
 */
const TREE_TAG = "tree:";

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
  5: "talisman",
  8: "catalyst",
};

/**
 * The lenses and the prism are keyed to a *particular place*.
 *
 * The three above are the core of breeding and drop from any route at the
 * right distance, so nobody can miss them. These fourteen are specialised —
 * each aims a pairing at one colour — so each asks you to have been somewhere
 * specific rather than merely far.
 *
 * The key is `biome:nth`: the biome, and which copy of it counted outward from
 * town. Eight colours over four biomes used to mean two apiece at whichever
 * two depths were free; there are twenty kinds of place now, so each colour
 * gets one that suits it — ember in the Emberfields, onyx on the slag, ivory
 * in the boneyard — and finding the right one is a place you can be told
 * about rather than a depth you happen to reach.
 */
const ITEM_FOR_PLACE: Record<string, BreedingItem> = {
  "emberfields:1": "lens-ember",
  "stormcoast:1": "lens-tide",
  "thunderplain:1": "lens-static",
  "meadow:1": "lens-verdant",
  "duskhollow:2": "lens-umbral",
  "sunkenreach:1": "lens-teal",
  "slagheap:1": "lens-onyx",
  "boneyard:1": "lens-ivory",

  // The five flat additions to the climb, laid out by how far you have to go
  // for one. A percent is a stroll; ten percent is the far end of the world,
  // and there is exactly one of it.
  "meadow:2": "glint",
  "dunes:1": "gleam",
  "frostmire:3": "lustre",
  "glacier:2": "radiance",
  "cloudreach:1": "brilliance",
  "crystalvault:1": "prism",

  // The rare three that raise the mutation rate, one to a world and further
  // out the stronger they are: the spores in the second fungus wood, the amber
  // in the far garden, the seed in the deepest ash.
  "mycelia:2": "sporeofchange",
  "fellgarden:2": "livingamber",
  "ashflats:3": "primordialseed",

  // The daycare's stronger kit; the weaker half of it is at the Mart.
  "meadow:3": "courtingsong",
  "duskhollow:1": "moonlitcharm",
  "emberfields:2": "embercradle",
  "saltpan:2": "broodlamp",
  "glacier:1": "hatcherystone",
};

const STARTING_BALLS = 30;

/** Enough to restock balls a few times, not enough to skip the early routes. */
const STARTING_MONEY = 3000;
const PARTY_LIMIT = 6;

/**
 * Whether the party has no room. An egg takes a slot like anybody else: it is
 * carried, and six is how many things can be carried.
 */
function partyFull(state: Pick<GameState, "party" | "eggs">): boolean {
  return state.party.length + state.eggs.length >= PARTY_LIMIT;
}

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

  // Wrapped so the town you open your eyes in is already on the map. Every
  // other reveal happens in `applyInput`; this is the one that has no input
  // behind it.
  return look(world, {
    tick: 0,
    phase: "starter",
    route: HUB_ID,
    x: hub.entry.x,
    y: hub.entry.y,
    steps: {},
    nextSlot: {},
    seen: {},
    centre: null,
    trail: [],
    rivalSince: null,
    rivalLast: null,
    rivalVisits: 0,
    party: [],
    box: [],
    boxNames: [defaultBoxName(0)],
    boxOf: {},
    expShareGiven: false,
    trainerName: null,
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
    pendingEvolutions: [],
    eggs: [],
    lastWild: null,
    printedAt: null,
    shreddedAt: null,
    cutAt: null,
    arena: null,
    lures: {},
    questsTaken: [],
    questsDone: [],
    taken: [],
    cleared: [],
    badges: [],
    beatenAt: {},
    wins: {},
    roamers: {},
    met: [],
    whereMet: {},
    caught: [],
    cheated: false,
  });
}

/** Which appearance of the rival this battle is, or null. */
export function rivalIdOf(battle: BattleState | null): string | null {
  return battle?.tag.startsWith(RIVAL_TAG) ? battle.tag.slice(RIVAL_TAG.length) : null;
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
  // A creature standing in the open is as wild as one in the grass — it is
  // the same creature, met by a different road — so balls and running are
  // legal against it. This is also what decides the battle's *rules*, so
  // getting it wrong here would make a roamer uncatchable, which would take
  // the point out of chasing one.
  // A tree counts. It is the same census met by a different road, so refusing
  // a ball at one would make Headbutt a way to find creatures you cannot keep.
  return Boolean(
    battle &&
      (battle.tag.startsWith(WILD_TAG) ||
        battle.tag.startsWith(TREE_TAG) ||
        critterIdOf(battle.tag)),
  );
}

/**
 * The moves a creature of this species and level would know, and full uses.
 *
 * Exported because a creature can now arrive from outside the world — a
 * bracket prize is rolled bare, the way `wildAt` leaves one, and something has
 * to give it a moveset before it can be shown or fought with. Both of these
 * are pure functions of the creature, so handing them out costs nothing.
 */
export function withMoves(individual: Individual): Individual {
  const moves = movesAtLevel(individual.speciesId, individual.level);
  return { ...individual, moves, pp: fullPp(moves) };
}

export function atFullHealth(individual: Individual): Individual {
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

/**
 * One input, and then the map remembers where it left you.
 *
 * The reveal is folded here rather than in `move`, because moving is only one
 * of the ways to end up somewhere new: a door, a border, Fly, an Escape Rope,
 * a warp, and waking up in a Center with everything fainted are the others.
 * Six places to remember to call something is six places to forget.
 */
export function applyInput(world: World, state: GameState, input: Input): GameState {
  return signed(shared(shelved(state, onFile(noted(followed(world, checkedIn(world, look(world, applyOne(world, state, input)))))))));
}

/** The longest a trainer name may be. */
export const TRAINER_NAME_MAX = 12;

/** A typed trainer name, tidied the way a nickname is. Empty means none. */
export function cleanTrainerName(name: string): string {
  return [...name.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim()]
    .slice(0, TRAINER_NAME_MAX)
    .join("")
    .trim();
}

/** Why this trainer name would be refused, or null. */
export function trainerRefusal(state: GameState, name: string): string | null {
  if (state.trainerName) return "you already have a trainer name";
  return cleanTrainerName(name) ? null : "a trainer name needs at least one letter";
}

/**
 * Signs everything of yours that nobody has signed.
 *
 * In the funnel, for the reason `shelved` is: a creature joins by a dozen
 * roads — the starter, a ball, an egg, a prize, a stranger on a route — and a
 * thirteenth would quietly go unsigned. What arrives already signed keeps its
 * signature: a traded creature, or one handed over by somebody in the world.
 *
 * Nothing happens before a name is chosen, and then everything already caught
 * is signed at once, so an old save that picks a name later loses nothing.
 */
function signed(state: GameState): GameState {
  const name = state.trainerName;
  if (!name) return state;
  const unsigned = (one: Individual) => one.caughtBy == null;
  if (!state.party.some(unsigned) && !state.box.some(unsigned)) return state;
  const sign = (one: Individual) => (unsigned(one) ? { ...one, caughtBy: name } : one);
  return { ...state, party: state.party.map(sign), box: state.box.map(sign) };
}

/** The level at which the Exp. Share is handed over. */
export const EXP_SHARE_LEVEL = 40;
export const EXP_SHARE = "hold-expshare";

/**
 * The Exp. Share, the first time anybody of yours reaches level 40.
 *
 * In the funnel, for the reason `shelved` is: a level can come from a battle,
 * a Rare Candy, a bracket prize or a trade, and a fifth road would quietly not
 * give it. Out in the field only, and only on an input that left nothing else
 * to say: a stone's evolution, a hatching or a battle's result is never
 * written over, and the Exp. Share arrives with the next step instead.
 *
 * Once per save, by a flag rather than by looking for the item, because the
 * item can be held, sold, or go with a creature that is released.
 */
function shared(state: GameState): GameState {
  if (state.expShareGiven || state.phase !== "field" || state.notice) return state;
  const grown = [...state.party, ...state.box].find((one) => one.level >= EXP_SHARE_LEVEL);
  if (!grown) return state;
  return {
    ...state,
    expShareGiven: true,
    bag: addItem(state.bag, EXP_SHARE),
    notice: { t: "expShare", on: grown.nickname ?? speciesById(grown.speciesId).name },
  };
}

/** How many a box tab holds: a seven by seven grid. */
export const BOX_SIZE = 49;
/** How many tabs can be added by hand. More appear on their own if every one fills. */
export const BOX_TABS_MAX = 32;
/** The longest a tab's name may be. */
export const BOX_NAME_MAX = 16;

function defaultBoxName(tab: number): string {
  return `Box ${tab + 1}`;
}

/**
 * Every boxed creature in a tab, and no tab entry for anyone not boxed.
 *
 * In the funnel rather than at the dozen places a creature can land in the
 * box — a catch with a full party, a trade, a gift, storing — for the reason
 * `onFile` gives: a thirteenth road would quietly not be one of them. A new
 * arrival goes in the first tab with room, and a new tab is opened if none
 * has any.
 *
 * Skipped when neither the box nor the placements changed, which is nearly
 * every input: this runs once per input and a long save is ninety thousand.
 */
function shelved(before: GameState, state: GameState): GameState {
  if (state.box === before.box && state.boxOf === before.boxOf) return state;

  const boxOf: Record<number, number> = {};
  const count: number[] = state.boxNames.map(() => 0);
  const unplaced: Individual[] = [];
  for (const creature of state.box) {
    const tab = state.boxOf[creature.uid];
    if (tab !== undefined && tab < count.length) {
      boxOf[creature.uid] = tab;
      count[tab]++;
    } else {
      unplaced.push(creature);
    }
  }

  const boxNames = [...state.boxNames];
  for (const creature of unplaced) {
    let tab = count.findIndex((n) => n < BOX_SIZE);
    if (tab < 0) {
      tab = boxNames.length;
      boxNames.push(defaultBoxName(tab));
      count.push(0);
    }
    boxOf[creature.uid] = tab;
    count[tab]++;
  }

  return { ...state, boxNames, boxOf };
}

/** How many creatures sit in a tab. */
export function boxCount(state: GameState, tab: number): number {
  return state.box.reduce((n, creature) => n + (state.boxOf[creature.uid] === tab ? 1 : 0), 0);
}

/** Why a box input would be refused, or null. */
export function boxRefusal(state: GameState, input: Extract<Input, { t: "addBox" | "renameBox" | "moveToBox" }>): string | null {
  if (state.phase === "battle") return "not in the middle of a battle";
  switch (input.t) {
    case "addBox":
      return state.boxNames.length >= BOX_TABS_MAX ? `no more than ${BOX_TABS_MAX} boxes` : null;
    case "renameBox":
      return input.tab >= 0 && input.tab < state.boxNames.length ? null : "no such box";
    case "moveToBox": {
      if (!state.box.some((one) => one.uid === input.uid)) return "that is not in the box";
      if (input.tab < 0 || input.tab >= state.boxNames.length) return "no such box";
      if (state.boxOf[input.uid] === input.tab) return null;
      return boxCount(state, input.tab) >= BOX_SIZE ? "that box is full" : null;
    }
  }
}

/** A typed box name, tidied the way a nickname is; empty gives the default back. */
export function cleanBoxName(name: string, tab: number): string {
  const clean = [...name.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim()]
    .slice(0, BOX_NAME_MAX)
    .join("")
    .trim();
  return clean || defaultBoxName(tab);
}

function boxInput(state: GameState, input: Extract<Input, { t: "addBox" | "renameBox" | "moveToBox" }>): GameState {
  const refusal = boxRefusal(state, input);
  if (refusal) throw new IllegalInput(refusal);
  const next = { ...state, tick: state.tick + 1, notice: null };
  switch (input.t) {
    case "addBox":
      return { ...next, boxNames: [...state.boxNames, defaultBoxName(state.boxNames.length)] };
    case "renameBox":
      return {
        ...next,
        boxNames: state.boxNames.map((name, tab) => (tab === input.tab ? cleanBoxName(input.name, tab) : name)),
      };
    case "moveToBox":
      return { ...next, boxOf: { ...state.boxOf, [input.uid]: input.tab } };
  }
}

/**
 * The last wild creature you laid eyes on, remembered.
 *
 * In the funnel rather than at the four places a wild battle can begin —
 * grass, a tree, a rod, a creature standing in the world — because "the last
 * one you saw" is a fact about the game rather than about any one of those
 * roads, and a fifth road added later would silently not be one of them.
 *
 * On *seeing* rather than on beating or catching, which is what the printer
 * asks about: it prints from a scan, and you do not have to win to be scanned.
 *
 * Returns the same object when nothing is new, like `noted` above and for the
 * same reason: this runs once per input and a long save is ninety thousand of
 * them.
 */
function onFile(state: GameState): GameState {
  if (!state.battle || !isWildBattle(state.battle)) return state;
  const side = state.battle.sides[1];
  const wild = side.team[side.active];
  if (!wild || state.lastWild === wild.speciesId) return state;
  return { ...state, lastWild: wild.speciesId };
}

/**
 * What you have met, written down.
 *
 * Outermost in the funnel on purpose. `followed` can *start* a battle — the
 * rival catches up from in there — so a fold placed inside it would miss the
 * one opponent in the game you cannot walk away from.
 *
 * Both sides of the battlefield, and the party and the box. Both sides because
 * a creature somebody else sent out is one you have met; the party and the box
 * because a gift, an egg and a trade are all roads to owning something you
 * never fought, and releasing it later should not unwrite having had it.
 *
 * Returns the *same object* when nothing is new, which is not an optimisation
 * detail: `reduce` calls this once per input and a long save is ninety
 * thousand of them, so allocating a fresh record ninety thousand times to
 * write nothing into it is the whole cost of the feature.
 */
function noted(state: GameState): GameState {
  const here = new Set<string>();
  for (const one of state.party) here.add(one.speciesId);
  for (const one of state.box) here.add(one.speciesId);
  if (state.battle) {
    for (const side of state.battle.sides) {
      for (const one of side.team) here.add(one.speciesId);
    }
  }

  let whereMet: Record<string, string> | null = null;
  for (const speciesId of here) {
    if (state.whereMet[speciesId] !== undefined) continue;
    whereMet ??= { ...state.whereMet };
    whereMet[speciesId] = state.route;
  }

  // And what is *yours*, for the dex: the party and the box, not the other
  // side of a battlefield. Same rule about allocation — nothing new, same
  // object back.
  let caught: string[] | null = null;
  const owned = new Set(state.caught);
  for (const one of [...state.party, ...state.box]) {
    if (owned.has(one.speciesId)) continue;
    owned.add(one.speciesId);
    caught = [...owned].sort();
  }

  if (!whereMet && !caught) return state;
  return { ...state, whereMet: whereMet ?? state.whereMet, caught: caught ?? state.caught };
}

/**
 * Somebody is behind you.
 *
 * In the funnel with the map's fog and the Center you last stood in, and for
 * the same reason: he follows where you *are*, and there are half a dozen ways
 * to end up somewhere.
 *
 * Three jobs in order. Remember where you just were, so he has ground to walk.
 * Turn him up when he is due. And when he has followed for long enough, let him
 * catch you.
 */
function followed(world: World, state: GameState): GameState {
  if (state.phase !== "field") return state;

  // Out on the routes only. He does not follow you into a town and he does not
  // walk into a Poké Center after you — partly because being jumped at a shop
  // counter is silly, and partly because a refuge you can reach is what makes
  // the twenty moves a decision rather than a countdown you watch.
  //
  // It also puts his first appearance where it belongs: not in the square you
  // wake up in, but on the first route you walk out onto.
  if (world.routes.get(state.route)?.kind !== "route") return state;

  const here = { route: state.route, x: state.x, y: state.y };
  const head = state.trail[0];
  const moved = !head || head.route !== here.route || head.x !== here.x || head.y !== here.y;

  const trail = moved ? [here, ...state.trail].slice(0, TRAIL) : state.trail;
  const walked: GameState = moved ? { ...state, trail } : state;

  // He appears on the tick, and only in the field, and only if he is not
  // already out there.
  if (walked.rivalSince === null) {
    return rivalDue(walked.tick, walked.rivalLast)
      ? { ...walked, rivalSince: walked.tick, rivalLast: walked.tick, rivalVisits: walked.rivalVisits + 1 }
      : walked;
  }

  if (!rivalCaughtUp(walked.tick, walked.rivalSince)) return walked;

  // He catches up. If there is nothing of yours standing he simply keeps
  // following — being ambushed with a fainted party is a blackout you could not
  // have avoided, which is a different game.
  const lead = walked.party.findIndex((one) => !isFainted(one));
  if (lead < 0) return walked;

  // `rivalVisits` was incremented when he appeared, twenty ticks ago, so it
  // already counts the meeting that is about to happen. What his level edge is
  // measured against is the ones *before* it, which is why this is one less:
  // the first time he catches you he is at your average exactly.
  const team = rivalTeam(world.seed, walked.rivalSince, walked.party, walked.rivalVisits - 1);
  if (!team.length) return { ...walked, rivalSince: null };

  let uid = walked.nextUid;
  const built = team.map((one) => atFullHealth(withMoves({ ...one, uid: uid++ })));

  return {
    ...walked,
    phase: "battle",
    rivalSince: null,
    nextUid: uid,
    battle: startBattle(
      world.seed,
      `${RIVAL_TAG}${walked.rivalSince}`,
      walked.party,
      built,
      lead,
    ),
    notice: null,
  };
}

/** Where the rival is standing, or null when nobody is following. */
export function rivalAt(state: GameState): { route: string; x: number; y: number } | null {
  if (state.rivalSince === null) return null;
  // The oldest thing on the trail, which is where you were three moves ago.
  // Early on the trail is short, so he starts on top of you and falls back.
  return state.trail[Math.min(RIVAL_BEHIND, state.trail.length - 1)] ?? null;
}

/** How many moves before he catches you, or null when nobody is following. */
export function rivalCountdown(state: GameState): number | null {
  if (state.rivalSince === null) return null;
  return Math.max(0, RIVAL_STALK - (state.tick - state.rivalSince));
}

/**
 * Notes the Poké Center you are standing in, so a blackout knows where to
 * carry you.
 *
 * Beside the map's fog in the same funnel, and for the same reason: walking
 * through the door is only one of the ways to end up inside one.
 */
function checkedIn(world: World, state: GameState): GameState {
  if (world.routes.get(state.route)?.role !== "centre") return state;
  return state.centre === state.route ? state : { ...state, centre: state.route };
}

function applyOne(world: World, state: GameState, input: Input): GameState {
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
      // Which ball is passed through. It used to be dropped here, so a Great
      // or Ultra Ball could be bought and never thrown.
      return battleTurn(world, state, input.item ? { t: "ball", item: input.item } : { t: "ball" });
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
      return collectEgg(world, state, input.to ?? "party");
    case "hatch":
      return hatchEgg(state, input.index, input.from ?? "party");
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
    case "rename":
      return rename(state, input.uid, input.name);
    case "trainer": {
      const refusal = trainerRefusal(state, input.name);
      if (refusal) throw new IllegalInput(refusal);
      return { ...state, tick: state.tick + 1, trainerName: cleanTrainerName(input.name), notice: null };
    }
    case "addBox":
    case "renameBox":
    case "moveToBox":
      return boxInput(state, input);
    case "useItem":
      return applyItem(world, state, input.item, input.index);
    case "fieldMove":
      return applyFieldMove(world, state, input.index, input.moveIndex, input.to);
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
    case "npcTravel":
      return npcTravel(world, state, input.route);
    case "npcSell":
      return npcSell(world, state, input.index, input.take, input.confirm);
    case "learnMove":
      return learnMove(state, input.uid, input.moveId, input.forget);
    case "prize":
      return takePrize(state, input.receive);
    case "print":
      return print3d(world, state, input.chromaId);
    case "shred":
      return shred(world, state, input.index, input.confirm);
    case "cut":
      return cut(world, state, input.index, input.confirm);
    case "reforge":
      return reforge(world, state, input.index, input.confirm);
    case "arenaEnter":
      return enterArena(state, input.id);
    case "arenaFight":
      return arenaFight(world, state);
    case "arenaPrize":
      return takeArenaPrize(world, state, input.index);
    case "evolve":
      return answerEvolution(state, input.uid, input.to, input.accept);
    case "holdItem":
      return setHeld(world, state, input.index, input.item);
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
 * Applies a testing shortcut, and marks both the save and whatever it touched.
 *
 * The mark is the point, and there are two of them because they answer
 * different questions. `state.cheated` says *this log* used the menu, and it
 * cannot travel: hand the creature to another save and the receiving log is
 * honestly clean. `Individual.cheat` travels with the thing, so a level 100
 * conjured out of the menu says so wherever it ends up — including in a party
 * checked in at a tournament desk on the other side of a trade.
 *
 * Every shortcut that *makes* or *edits* a creature sets it. The ones that
 * only add money, balls, items or move you around do not: a save full of free
 * Ultra Balls is a cheated save, and the creatures in it were still caught.
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
        heldItem: null,
        nickname: null,
        traded: false,
        prize: false,
        // The whole point. `state.cheated` says this *log* used the menu, and
        // cannot survive the creature being traded into another save; this
        // travels with the thing itself.
        cheat: true,
        parents: null,
        gender: op.gender,
      });
      const arrival = atFullHealth(built);
      const boxed = partyFull(state);
      return {
        ...next,
        party: boxed ? state.party : [...state.party, arrival],
        box: boxed ? [...state.box, arrival] : state.box,
        nextUid: state.nextUid + 1,
      };
    }

    case "egg": {
      const steps = Math.max(0, Math.min(5000, Math.floor(op.steps)));
      const baby = atFullHealth(
        withMoves({
          pp: [],
          abilities: [],
          uid: 0,
          speciesId: speciesById(op.speciesId).id,
          level: 1,
          exp: expForLevel(1),
          ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
          evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
          natureId: NATURE_IDS[0],
          variantId: variant(op.variantId).id,
          hp: 0,
          status: null,
          sleepTurns: 0,
          moves: [],
          heldItem: null,
          nickname: null,
          traded: false,
          prize: false,
          cheat: true,
          parents: null,
          gender: "female",
        }),
      );
      return { ...next, eggs: [...state.eggs, { creature: baby, steps, total: Math.max(1, steps) }] };
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
          index === op.index ? atFullHealth({ ...creature, variantId, cheat: true }) : creature,
        ),
      };
    }

    case "setGender": {
      if (op.index < 0 || op.index >= state.party.length) throw new IllegalInput("no such creature");
      return {
        ...next,
        party: state.party.map((creature, index) =>
          index === op.index ? { ...creature, gender: op.gender, cheat: true } : creature,
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
            ? atFullHealth(withMoves({ ...creature, level, exp: expForLevel(level), cheat: true }))
            : creature,
        ),
      };
    }

    case "prize": {
      if (!isBracketSize(op.size)) throw new IllegalInput("no bracket is that size");
      // Recomputed from the input rather than carried in it. `takePrize` has
      // to carry the creature because a real tournament happened somewhere
      // this seed cannot see; this one happened nowhere, so there is nothing
      // to take on trust and the log can simply say which roll it wanted.
      const offered = cheatPrizeOffer(world.seed, op.roll, op.size, state.nextUid);
      const taken = offered[op.index];
      if (!taken) throw new IllegalInput("no such prize");

      const arrival = atFullHealth(withMoves({ ...taken, uid: state.nextUid, cheat: true }));
      const boxed = partyFull(state);
      return {
        ...next,
        party: boxed ? state.party : [...state.party, arrival],
        box: boxed ? [...state.box, arrival] : state.box,
        nextUid: state.nextUid + 1,
        notice: {
          t: "prize",
          speciesId: arrival.speciesId,
          variantId: arrival.variantId,
          boxed,
        },
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
    // Whoever caught it, as their save signed it — or a plain "Unknown" from a
    // client too old to say, rather than letting this save sign it as its own.
    caughtBy: typeof receive.caughtBy === "string" && cleanTrainerName(receive.caughtBy)
      ? cleanTrainerName(receive.caughtBy)
      : "Unknown",
    // `prize` is *not* cleared, and is spread through from whatever arrived.
    // The two flags answer different questions — "somebody else raised this"
    // and "a bracket produced this" — and a prize that changed hands is
    // honestly both. Clearing it would let a creature launder its origin by
    // being passed between two saves.
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
function walked(before: GameState): GameState {
  const step = (eggs: Egg[]) => eggs.map((egg) => (egg.steps > 0 ? { ...egg, steps: egg.steps - 1 } : egg));

  // Every egg carried is walked, and every egg in an incubator too: the
  // daycare keeps them warm, but it is still your walking that hatches them.
  let state = before.eggs.some((egg) => egg.steps > 0) ? { ...before, eggs: step(before.eggs) } : before;
  if (state.daycare.incubating.some((egg) => egg.steps > 0)) {
    state = { ...state, daycare: { ...state.daycare, incubating: step(state.daycare.incubating) } };
  }

  const [first, second] = state.daycare.slots;
  if (!first || !second || state.daycare.eggReady || !compatible(first, second)) return state;

  const steps = state.daycare.steps + 1;
  return steps < eggSteps(state.daycare.applied)
    ? { ...state, daycare: { ...state.daycare, steps } }
    : { ...state, daycare: { ...state.daycare, steps: 0, eggReady: true } };
}

/** Setting foot somewhere new for the first time, and what it pays. */
function arrive(world: World, state: GameState, routeId: string): GameState {
  if (state.visited.includes(routeId)) return state;

  const visited = [...state.visited, routeId].sort();
  const route = world.routes.get(routeId);
  const found =
    (route ? ITEM_FOR_PLACE[`${route.biome}:${route.nth}`] : undefined) ??
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
  const boxed = partyFull(state);

  return {
    ...state,
    tick: state.tick + 1,
    party: boxed ? state.party : [...state.party, creature],
    box: boxed ? [...state.box, creature] : state.box,
    daycare: { ...state.daycare, slots, steps: 0, eggReady: false },
    notice: null,
  };
}

/**
 * Taking one of the three a bracket offered.
 *
 * The twin of `trade`, and it makes the same trade-off for the same reason:
 * the creature is carried whole in the input because a tournament happened
 * somewhere this seed knows nothing about. Everything the engine can still
 * insist on, it does — a fresh uid, the `prize` mark, and health clamped to
 * what this creature can actually have here rather than whatever a client
 * claimed.
 *
 * Deliberately not gated on being in town. A trade is two people standing in
 * the same place; a prize is the end of a bracket, and whatever screen the
 * champion is looking at when they pick is where they are.
 */
function takePrize(state: GameState, receive: Individual): GameState {
  const boxed = partyFull(state);
  const arrival: Individual = {
    ...receive,
    uid: state.nextUid,
    prize: true,
    cheat: false,
    hp: Math.max(0, Math.min(receive.hp, maxHp({ ...receive, uid: state.nextUid }))),
  };

  return {
    ...state,
    tick: state.tick + 1,
    party: boxed ? state.party : [...state.party, arrival],
    box: boxed ? [...state.box, arrival] : state.box,
    nextUid: state.nextUid + 1,
    notice: { t: "prize", speciesId: arrival.speciesId, variantId: arrival.variantId, boxed },
  };
}

/**
 * Why the printer will not run, or null.
 *
 * One predicate, two callers: the panel greys the button for exactly what the
 * engine is about to refuse. The same shape every other refusal in this file
 * has, and for the same reason.
 */
export function printRefusal(
  world: World,
  state: GameState,
  chromaId: string,
): string | null {
  if (state.phase !== "field") return "not in the middle of this";
  if (!atPrinter(world, state)) return "you are not at the printer";
  if (!state.lastWild) return "there is nothing on file yet";
  if (!printReady(state.tick, state.printedAt)) {
    return `still warming up — ${printWait(state.tick, state.printedAt)} moves`;
  }
  if (!CHROMA_IDS.includes(chromaId)) return "that is not a colour";

  const ink = inkFor(chromaId);
  if (ink !== null && !hasItem(state.bag, ink)) return `no ${chroma(chromaId).name.toLowerCase()} ink`;
  return null;
}

/** Whether the person you are talking to is the one with the machine. */
function atPrinter(world: World, state: GameState): boolean {
  const person = speakingTo(world, state);
  return person?.kind === "print";
}

/**
 * A print.
 *
 * The cooldown is stamped whether it worked or not: the machine ran, and it
 * is the *attempt* you come back for. A failed print that cost nothing would
 * make the twenty-five percent free, and then the only real cost would be the
 * walk.
 */
function print3d(world: World, state: GameState, chromaId: string): GameState {
  const refusal = printRefusal(world, state, chromaId);
  if (refusal) throw new IllegalInput(refusal);

  const next = { ...state, tick: state.tick + 1, printedAt: state.tick, talking: state.talking };
  const rng = rngFor(world.seed, "print", state.tick);

  // Rolled from the seed and the tick, so a bad print cannot be rerolled by
  // reloading — the same log always fails in the same places.
  if (intBelow(rng, 1000) < PRINT_FAILS) {
    return {
      ...next,
      bag: addItem(next.bag, PRINT_CONSOLATION),
      notice: { t: "printFailed", item: PRINT_CONSOLATION },
    };
  }

  const built = atFullHealth(
    withMoves({
      pp: [],
      abilities: rollAbilities(rng),
      uid: state.nextUid,
      speciesId: state.lastWild!,
      level: PRINT_LEVEL,
      exp: expForLevel(PRINT_LEVEL),
      // A print is a copy of a scan, not a bred creature: the numbers are the
      // machine's rather than a lineage's, and they are the same every time.
      ivs: { hp: 15, atk: 15, def: 15, spa: 15, spd: 15, spe: 15 },
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      natureId: NATURE_IDS[intBelow(rng, NATURE_IDS.length)],
      variantId: appearanceId(0, chromaId),
      hp: 0,
      status: null,
      sleepTurns: 0,
      moves: [],
      heldItem: null,
      nickname: null,
      // Nothing about it is taken on trust: the species is in the log, the
      // colour is in the input, and the roll is the seed's. A replay makes the
      // same one, which is why it carries none of the three marks.
      traded: false,
      prize: false,
      cheat: false,
      parents: null,
      gender: rollGender(rng),
    }),
  );

  const boxed = partyFull(state);
  return {
    ...next,
    party: boxed ? state.party : [...state.party, built],
    box: boxed ? [...state.box, built] : state.box,
    nextUid: state.nextUid + 1,
    notice: { t: "printed", speciesId: built.speciesId, chromaId, boxed },
  };
}

/*
 * ---------------------------------------------------------------- the arena
 *
 * An eight-player knockout against the machine, run out of a field by one of
 * six people. Everything about it is derived from three numbers on the state —
 * which arena, the tick it was entered on, and which round you are in — so
 * there is exactly one copy of the draw and it is computed rather than stored.
 *
 * You play your own three matches. The other half of the board is decided by
 * the seed rather than simulated, and the panel says so: simulating seven AI
 * matches with the search would cost about two seconds *on every replay of the
 * save*, which is a price the log cannot pay. What it buys — a name on a draw
 * sheet that lost to another name — is flavour, and flavour is not worth
 * making every load slower.
 */

/** What an opponent in this bracket is called. Named rather than numbered, so
 * a bracket reads like a draw sheet instead of a spreadsheet. */
const ARENA_NAMES: readonly string[] = [
  "Bex",
  "Corr",
  "Dov",
  "Esk",
  "Fen",
  "Gale",
  "Hale",
  "Ives",
  "Juno",
  "Kes",
  "Lark",
  "Mos",
  "Nell",
  "Orr",
  "Pike",
  "Quill",
];

/** The seven the machine fields, by name, for this draw. */
export function arenaField(state: GameState): string[] {
  if (!state.arena) return [];
  const rng = rngFor(state.arena.id, "field", state.arena.entered);
  const pool = [...ARENA_NAMES];
  const picked: string[] = [];
  while (picked.length < ARENA_SIZE - 1 && pool.length) {
    picked.push(...pool.splice(intBelow(rng, pool.length), 1));
  }
  return picked;
}

/**
 * The team you face this round.
 *
 * Drawn from the band `arenas.ts` picks for the level, at the format's size.
 * Named off the arena, the tick and the round, so the same bracket always
 * fields the same opponents — and losing one and re-entering gets a different
 * draw rather than a rematch of the fight you just lost.
 */
export function arenaTeam(world: World, state: GameState): Individual[] {
  if (!state.arena) return [];
  const spec = arena(state.arena.id);
  const level = arenaLevel(spec, state.tick, state.badges.length);
  const [from, upto] = arenaBand(level);

  const team: Individual[] = [];
  let uid = state.nextUid;

  for (let slot = 0; slot < spec.teamSize; slot++) {
    const rng = rngFor(
      world.seed,
      "arena",
      state.arena.id,
      state.arena.entered,
      state.arena.round,
      slot,
    );
    const pick = ARENA_POOL[intBetween(rng, from, upto)];
    // The last one is the ace and comes in at the full level; the rest are a
    // shade under, which is the same shape a gym has and for the same reason:
    // six identical levels reads as a wall rather than as a team.
    const ace = slot === spec.teamSize - 1;

    team.push(
      atFullHealth(
        withMoves({
          pp: [],
          abilities: rollAbilities(rng),
          uid: uid++,
          speciesId: pick,
          level: ace ? level : Math.max(2, level - 1 - intBelow(rng, 3)),
          exp: expForLevel(level),
          // Better bred than a route trainer and short of the Cup, which is
          // where a bracket belongs: somebody who came to win.
          ivs: { hp: 24, atk: 24, def: 24, spa: 24, spd: 24, spe: 24 },
          evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
          natureId: NATURE_IDS[intBelow(rng, NATURE_IDS.length)],
          variantId: "normal",
          hp: 0,
          status: null,
          sleepTurns: 0,
          moves: [],
          heldItem: null,
          nickname: null,
          traded: false,
          prize: false,
          cheat: false,
          parents: null,
          gender: rollGender(rng),
        }),
      ),
    );
  }

  return team;
}

/** Why you cannot enter, or null. */
export function arenaRefusal(state: GameState, id: string): string | null {
  if (state.phase !== "field") return "not in the middle of this";
  if (!isArena(id)) return "no such bracket";
  if (state.arena) return "you are already in one";
  const spec = arena(id);
  const able = state.party.filter((one) => !isFainted(one)).length;
  if (able < spec.teamSize) {
    return `it is ${spec.teamSize}v${spec.teamSize}, and you have ${able} standing`;
  }
  return null;
}

function enterArena(state: GameState, id: string): GameState {
  const refusal = arenaRefusal(state, id);
  if (refusal) throw new IllegalInput(refusal);

  return {
    ...state,
    tick: state.tick + 1,
    // Named after the tick it began on, so re-entering after a loss is a new
    // draw rather than the one that was just lost.
    arena: { id, entered: state.tick, round: 0 },
    talking: null,
    notice: null,
  };
}

/** Why the next match cannot start, or null. */
export function arenaFightRefusal(state: GameState): string | null {
  if (state.phase !== "field") return "not in the middle of this";
  if (!state.arena) return "you are not in a bracket";
  if (state.arena.round >= ARENA_ROUNDS) return "there is nothing left to play";
  const spec = arena(state.arena.id);
  const able = state.party.filter((one) => !isFainted(one)).length;
  if (able < spec.teamSize) return `you need ${spec.teamSize} standing`;
  return null;
}

function arenaFight(world: World, state: GameState): GameState {
  const refusal = arenaFightRefusal(state);
  if (refusal) throw new IllegalInput(refusal);

  const team = arenaTeam(world, state);
  if (!team.length) throw new IllegalInput("nobody to field");
  const lead = state.party.findIndex((one) => !isFainted(one));

  return {
    ...state,
    tick: state.tick + 1,
    phase: "battle",
    // Its own tag, so which round this was can be read back off the battle
    // when it ends and nothing else has to remember.
    battle: startBattle(
      world.seed,
      `${ARENA_TAG}${state.arena!.id}:${state.arena!.entered}:${state.arena!.round}`,
      state.party,
      team,
      lead,
    ),
    nextUid: state.nextUid + team.length,
    notice: null,
  };
}

/** Which round of a bracket this battle is, or null if it is not one. */
export function arenaRoundOf(battle: BattleState | null): number | null {
  if (!battle?.tag.startsWith(ARENA_TAG)) return null;
  const round = Number(battle.tag.split(":").at(-1));
  return Number.isInteger(round) ? round : null;
}

/**
 * The three a won bracket offers.
 *
 * Derived, unlike the PvP bracket's. That one happens in other people's
 * browsers and has to carry the creature whole; this one happens here, so the
 * log can simply say which of the three was taken and a replay rebuilds it.
 */
export function arenaPrizes(world: World, state: GameState): Individual[] {
  if (!state.arena) return [];
  return prizeOffer(
    `${world.seed}|${state.arena.id}`,
    String(state.arena.entered),
    ARENA_SIZE,
    state.nextUid,
  ).map((one) => atFullHealth(withMoves(one)));
}

/** Why the prize cannot be taken, or null. */
export function arenaPrizeRefusal(state: GameState, index: number): string | null {
  if (state.phase !== "field") return "not in the middle of this";
  if (!state.arena) return "you are not in a bracket";
  if (state.arena.round < ARENA_ROUNDS) return "you have not won it yet";
  if (index < 0 || index >= PRIZE_CHOICES) return "no such prize";
  return null;
}

function takeArenaPrize(world: World, state: GameState, index: number): GameState {
  const refusal = arenaPrizeRefusal(state, index);
  if (refusal) throw new IllegalInput(refusal);

  const won = arenaPrizes(world, state)[index];
  if (!won) throw new IllegalInput("no such prize");

  const arrival = { ...won, uid: state.nextUid, prize: true };
  const boxed = partyFull(state);

  return {
    ...state,
    tick: state.tick + 1,
    // The bracket is over the moment its prize is taken. Left standing, the
    // panel would go on offering three creatures for ever.
    arena: null,
    party: boxed ? state.party : [...state.party, arrival],
    box: boxed ? [...state.box, arrival] : state.box,
    nextUid: state.nextUid + 1,
    notice: { t: "prize", speciesId: arrival.speciesId, variantId: arrival.variantId, boxed },
  };
}

/** Why an egg cannot be taken to that place, or null. */
export function collectRefusal(world: World, state: GameState, to: "party" | "incubator"): string | null {
  if (!atDaycare(world, state)) return "you are not in the daycare";
  if (!state.daycare.eggReady) return "no egg yet";
  if (to === "party" && partyFull(state)) return "your party is full — an egg needs a slot";
  if (to === "incubator" && state.daycare.incubating.length >= incubatorSlots(state.daycare.applied)) {
    return incubatorSlots(state.daycare.applied) ? "every incubator is taken" : "no incubator applied";
  }
  return null;
}

function collectEgg(world: World, state: GameState, to: "party" | "incubator"): GameState {
  const refusal = collectRefusal(world, state, to);
  if (refusal) throw new IllegalInput(refusal);

  const [first, second] = state.daycare.slots;
  if (!first || !second) throw new IllegalInput("no pair");

  const child = breed(world.seed, first, second, state.daycare.eggIndex, state.daycare.applied);
  const steps = reducedHatch(
    hatchSteps(world.seed, first, second, state.daycare.eggIndex, child),
    state.daycare.applied,
  );
  const egg: Egg = { creature: atFullHealth({ ...child, uid: 0 }), steps, total: steps };

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
    eggs: to === "party" ? [...state.eggs, egg] : state.eggs,
    bag,
    daycare: {
      ...state.daycare,
      incubating: to === "incubator" ? [...state.daycare.incubating, egg] : state.daycare.incubating,
      applied,
      eggReady: false,
      eggIndex: state.daycare.eggIndex + 1,
      steps: 0,
    },
    notice: { t: "eggTaken", steps },
  };
}

/** Why an egg cannot be opened, or null when it can. */
export function hatchRefusal(state: GameState, index: number, from: "party" | "incubator" = "party"): string | null {
  if (state.phase !== "field") return "not now";
  const egg = (from === "party" ? state.eggs : state.daycare.incubating)[index];
  if (!egg) return "no such egg";
  if (egg.steps > 0) return "it is not ready to hatch";
  return null;
}

/**
 * The first egg ready to open, or null. What the page plays the scene for.
 * A carried one first, then the incubators.
 */
export function readyEgg(state: GameState): { index: number; egg: Egg; from: "party" | "incubator" } | null {
  const carried = state.eggs.findIndex((egg) => egg.steps === 0);
  if (carried >= 0) return { index: carried, egg: state.eggs[carried], from: "party" };
  const kept = state.daycare.incubating.findIndex((egg) => egg.steps === 0);
  return kept < 0 ? null : { index: kept, egg: state.daycare.incubating[kept], from: "incubator" };
}

function hatchEgg(state: GameState, index: number, from: "party" | "incubator"): GameState {
  const refusal = hatchRefusal(state, index, from);
  if (refusal) throw new IllegalInput(refusal);

  if (from === "incubator") {
    // Into the box always: an incubated egg never had a party slot to hatch into.
    const born = { ...state.daycare.incubating[index].creature, uid: state.nextUid };
    return {
      ...state,
      tick: state.tick + 1,
      daycare: { ...state.daycare, incubating: state.daycare.incubating.filter((_, at) => at !== index) },
      box: [...state.box, born],
      nextUid: state.nextUid + 1,
      notice: { t: "hatched", speciesId: born.speciesId, variantId: born.variantId, boxed: true },
    };
  }

  const hatched = { ...state.eggs[index].creature, uid: state.nextUid };

  // Into the party always: it was already taking the slot it hatches into.
  return {
    ...state,
    tick: state.tick + 1,
    eggs: state.eggs.filter((_, at) => at !== index),
    party: [...state.party, hatched],
    nextUid: state.nextUid + 1,
    notice: { t: "hatched", speciesId: hatched.speciesId, variantId: hatched.variantId, boxed: false },
  };
}

function toggleItem(world: World, state: GameState, item: BreedingItem): GameState {
  if (!atDaycare(world, state)) throw new IllegalInput("you are not in the daycare");
  if (!hasItem(state.bag, item)) throw new IllegalInput("you do not have that");

  const applied = state.daycare.applied.includes(item)
    ? state.daycare.applied.filter((held) => held !== item)
    : [...state.daycare.applied, item].sort();
  // An incubator cannot be taken away from under an egg that is in it.
  if (incubatorSlots(applied) < state.daycare.incubating.length) {
    throw new IllegalInput("an egg is still in that incubator");
  }

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
  if (partyFull(state)) throw new IllegalInput("your party is full");
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
      heldItem: null,
      nickname: null,
      traded: false,
      prize: false,
      cheat: false,
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

/** The longest a nickname may be. The handhelds allowed twelve. */
export const NICKNAME_MAX = 12;

/**
 * A typed name, as it will be stored: control characters out, runs of spaces
 * folded, trimmed, and cut to the limit. Null means "no nickname" — nothing
 * typed, or exactly the species name, which is what it is called anyway.
 */
export function cleanNickname(name: string, speciesId: string): string | null {
  const clean = [...name.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim()]
    .slice(0, NICKNAME_MAX)
    .join("")
    .trim();
  return clean && clean !== speciesById(speciesId).name ? clean : null;
}

/** Why this creature cannot be renamed right now, or null. */
export function renameRefusal(state: GameState, uid: number): string | null {
  if (state.phase === "battle") return "not in the middle of a battle";
  if (!state.party.some((one) => one.uid === uid) && !state.box.some((one) => one.uid === uid)) {
    return "no such creature";
  }
  return null;
}

function rename(state: GameState, uid: number, name: string): GameState {
  const refusal = renameRefusal(state, uid);
  if (refusal) throw new IllegalInput(refusal);

  const named = (one: Individual) =>
    one.uid === uid ? { ...one, nickname: cleanNickname(name, one.speciesId) } : one;
  return { ...state, tick: state.tick + 1, party: state.party.map(named), box: state.box.map(named), notice: null };
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
export function itemRefusal(
  world: World,
  state: GameState,
  itemId: string,
  index: number,
): string | null {
  if (state.phase !== "field") return "not right now";
  if (!isItem(itemId)) return "no such item";
  if (!hasItem(state.bag, itemId)) return "you have none";

  // A lure is lit, not used on anybody, so the party slot is not consulted at
  // all — asking a lure which creature it is for is asking the wrong question.
  const spec = item(itemId);
  if (spec.lure) return lureLeft(state, itemId) > 0 ? "that one is already burning" : null;

  // A repel is asked exactly what a lure is asked, because it is the same
  // record. An Escape Rope is asked where you are standing instead.
  if (spec.repel) return lureLeft(state, itemId) > 0 ? "that one is still working" : null;
  if (spec.escape) return inTown(world, state) ? "you are already in town" : null;

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

  // A stone works on the creature in front of it or on nothing at all, and
  // saying which is the whole of what makes a shelf of twenty-two navigable.
  if (spec.evolves) {
    return evolutionByItem(target, spec.name)
      ? null
      : `a ${speciesById(target.speciesId).name} has no use for that`;
  }

  // Effort in both directions, refused for the cap it would run into rather
  // than silently doing nothing. `gainEffort` enforces the caps; this only
  // explains them.
  if (spec.effort) {
    const here = target.evs[spec.effort.stat];
    if (spec.effort.delta > 0) {
      if (here >= EV_MAX_PER_STAT) return "that stat holds all the effort it can";
      if (effortSpent(target.evs) >= EV_MAX_TOTAL) return "it has spent every point it has";
      return null;
    }
    return here <= 0 ? "there is no effort there to take back out" : null;
  }

  if (spec.natureId) {
    return target.natureId === spec.natureId ? "it already has that nature" : null;
  }

  if (spec.relearn) {
    return forgottenMoves(target).length ? null : "there is nothing it has grown past";
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

function applyItem(world: World, state: GameState, itemId: string, index: number): GameState {
  const refusal = itemRefusal(world, state, itemId, index);
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

  // A repel shares the lure's record exactly, so "is the grass quiet" and
  // "is anything being drawn" are answered from one place and can never
  // disagree about what move it is.
  if (spec.repel) {
    const until = state.tick + 1 + spec.repel;
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

  // Through the same landing `fly` uses, so there is one place that decides
  // where you end up standing — but not through `fly` itself, which wants a
  // wing you may not have. A rope is not a wing.
  if (spec.escape) {
    const home = landAt(world, { ...state, bag: removeItem(state.bag, itemId) }, HUB_ID);
    return { ...home, notice: { t: "used", item: itemId, on: "the walk home" } };
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

  // A stone. Straight to the new species, with the scene to go with it —
  // levelling into one gets a twenty-second reveal and there is no reason a
  // stone should be a line of small text.
  if (spec.evolves) {
    const into = evolutionByItem(target, spec.name);
    if (!into) throw new IllegalInput("that does nothing to this one");

    // Health is kept as a proportion, exactly as levelling into an evolution
    // keeps it: a stone is not a free potion, and a Magikarp on one hit point
    // should come out of it a Gyarados on very few.
    const before = maxHp(target);
    const grown: Individual = { ...target, speciesId: into };
    const after = maxHp(grown);
    party[index] = { ...grown, hp: Math.max(1, Math.round((target.hp * after) / Math.max(1, before))) };

    return {
      ...state,
      tick: state.tick + 1,
      party,
      bag: removeItem(state.bag, itemId),
      notice: { t: "evolved", from: target.speciesId, to: into, uid: target.uid },
    };
  }

  // Effort, in whichever direction. Through `gainEffort` going up so the caps
  // are enforced in the one place that owns them; taken straight off going
  // down, because there is no cap on having less.
  if (spec.effort) {
    const { stat, delta } = spec.effort;
    const evs =
      delta > 0
        ? gainEffort(target.evs, { stats: [stat], amount: delta })
        : { ...target.evs, [stat]: Math.max(0, target.evs[stat] + delta) };

    // Health is a stat like any other, so moving its effort moves the bar. The
    // proportion is kept rather than the number, for the same reason an
    // evolution keeps it.
    const grown: Individual = { ...target, evs };
    const after = maxHp(grown);
    party[index] = { ...grown, hp: Math.min(after, Math.max(1, Math.round((target.hp * after) / Math.max(1, max)))) };

    return {
      ...state,
      tick: state.tick + 1,
      party,
      bag: removeItem(state.bag, itemId),
      notice: { t: "used", item: itemId, on: speciesById(target.speciesId).name },
    };
  }

  if (spec.natureId) {
    party[index] = { ...target, natureId: spec.natureId };
    return {
      ...state,
      tick: state.tick + 1,
      party,
      bag: removeItem(state.bag, itemId),
      notice: { t: "used", item: itemId, on: speciesById(target.speciesId).name },
    };
  }

  // A Heart Scale offers back the first thing it has grown past, through the
  // same queue a level-up uses. Which means the choice of what to forget is
  // asked in one place, in the same words, and a replay makes it the same way.
  if (spec.relearn) {
    const back = forgottenMoves(target);
    if (!back.length) throw new IllegalInput("there is nothing it has grown past");

    const room = target.moves.length < MAX_MOVES;
    party[index] = room ? alignPp({ ...target, moves: [...target.moves, back[0]] }, target) : target;

    return {
      ...state,
      tick: state.tick + 1,
      party,
      bag: removeItem(state.bag, itemId),
      pendingMoves: room
        ? state.pendingMoves
        : withOffers(state, [{ uid: target.uid, moveId: back[0] }]),
      notice: room
        ? { t: "taught", name: speciesById(target.speciesId).name, learned: back[0], forgot: null }
        : null,
    };
  }

  let next: Individual = target;
  /** What a candy grew it into, if it grew into anything. */
  let became: string | null = null;

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
    became = growth.evolveTo;
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
    /*
     * A candy that grew it to the edge of something else *offers* it.
     *
     * It used to apply it, because `awardExp` did — the level path is the same
     * one a battle uses, deliberately — and this notice was where that showed
     * up. Both roads now stop one step short and ask, which is the point: a
     * candy is bought, and spending money to be evolved against your will is
     * a worse deal than the same thing happening in the grass.
     *
     * The notice goes back to the ordinary one. The reveal is driven by the
     * offer rather than by a notice, so a candy and a battle produce the same
     * scene from the same state instead of two screens that have to be kept
     * in step.
     */
    pendingEvolutions: became
      ? withEvolutions(state, [{ uid: next.uid, to: became }])
      : state.pendingEvolutions,
    notice: { t: "used", item: itemId, on: speciesById(next.speciesId).name },
  };
}

/**
 * Why this one cannot be handed over, or null.
 *
 * One predicate, two callers. The two interesting refusals are both about
 * *place*: swapping what a creature carries in the middle of a battle would be
 * a free action nothing else in this game has, and the daycare reads what its
 * pair is holding when the egg is made, so a creature deposited with a Destiny
 * Knot has already committed it.
 */
export function holdRefusal(
  world: World,
  state: GameState,
  index: number,
  itemId: string | null,
): string | null {
  if (state.phase !== "field") return "not in the middle of this";

  const target = state.party[index];
  if (!target) return "nobody there";

  if (itemId === null) {
    return target.heldItem ? null : "it is not carrying anything";
  }

  if (!isItem(itemId)) return "no such item";
  if (!hasItem(state.bag, itemId)) return "you have none";

  const spec = item(itemId);
  if (!holdOf(itemId)) return `nothing happens while it holds ${spec.name}`;
  if (target.heldItem === itemId) return "it is already carrying that";

  return null;
}

/**
 * Hands one over, or takes it back.
 *
 * A swap is both at once: what it was carrying goes back in the bag and the
 * new one comes out, so nothing is ever destroyed by changing your mind. That
 * is the whole reason this is not two inputs.
 */
function setHeld(
  world: World,
  state: GameState,
  index: number,
  itemId: string | null,
): GameState {
  const refusal = holdRefusal(world, state, index, itemId);
  if (refusal) throw new IllegalInput(refusal);

  const target = state.party[index];
  let bag = state.bag;

  // Back in the bag first, so handing over the only Leftovers to the creature
  // already holding them is not a way to make a second pair.
  if (target.heldItem) bag = addItem(bag, target.heldItem);
  if (itemId) bag = removeItem(bag, itemId);

  const party = [...state.party];
  party[index] = { ...target, heldItem: itemId };

  return {
    ...state,
    tick: state.tick + 1,
    party,
    bag,
    notice: itemId
      ? { t: "given", item: itemId, on: speciesById(target.speciesId).name }
      : { t: "took", item: target.heldItem!, on: speciesById(target.speciesId).name },
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

/**
 * The repel still working, and how long it has, or null.
 *
 * The strongest one burning rather than the sum, because two repels at once is
 * not twice the quiet — and the same record holds both, so a player who lit
 * a Max Repel over a Repel gets the longer of the two rather than a surprise.
 */
export function activeRepel(state: GameState): { item: string; left: number } | null {
  const burning = Object.entries(state.lures)
    .filter(([id, until]) => until > state.tick && isItem(id) && item(id).repel)
    .map(([id, until]) => ({ item: id, left: until - state.tick }))
    .sort((a, b) => b.left - a.left);

  return burning[0] ?? null;
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

/* ------------------------------------------------------- moves in the world
 *
 * `fieldmoves.ts` says what each one does; this is the half that knows where
 * you are standing. Two functions and no more, on the pattern the rest of the
 * engine uses: one predicate the panel and the engine both ask, and one
 * handler that trusts it.
 */

/** A tree you could reach from where you are standing, or null. */
function treeBeside(route: Route, state: GameState): { x: number; y: number } | null {
  // Adjacency rather than facing, because nothing in this game stores which
  // way you are pointing — and a headbutt you have to line up in a world with
  // no turn animation would read as the move being broken.
  for (const [dx, dy] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ] as const) {
    const x = state.x + dx;
    const y = state.y + dy;
    if (x < 0 || y < 0 || x >= route.width || y >= route.height) continue;
    if (tileAt(state, route, x, y) === TILE.TREE) return { x, y };
  }
  return null;
}

/**
 * Why this move cannot be used here, or null.
 *
 * Exported for the same reason `buyRefusal` and `itemRefusal` are: the panel
 * greys exactly what the engine refuses, in the same words, because it is the
 * same function. A second opinion computed in the UI is how a button that
 * throws gets shipped.
 */
export function fieldMoveRefusal(
  world: World,
  state: GameState,
  index: number,
  moveIndex: number,
  to?: number,
): string | null {
  if (state.phase !== "field") return "not right now";

  const user = state.party[index];
  if (!user) return "nobody there";
  if (isFainted(user)) return "it is in no state to";

  const moveId = user.moves[moveIndex];
  if (!moveId) return "no such move";

  const use = fieldUse(moveId);
  if (!use) return "that one is for battles";

  // Power points are spent, so an empty slot is a refusal rather than a free
  // use — the same rule a battle applies to the same four slots.
  if (ppLeft(user, moveIndex) <= 0) return "no uses left in that one";

  const route = world.routes.get(state.route);
  if (!route) return "not right now";

  if (needsTarget(use) && (to === undefined || !state.party[to])) return "on whom?";

  switch (use.t) {
    case "shake":
      if (route.kind !== "route") return "there are no trees in here";
      if (!treeBeside(route, state)) return "stand next to a tree first";
      // Nothing able to fight means nothing to shake a tree at, exactly as
      // the grass stays quiet with a fainted party.
      if (state.party.every(isFainted)) return "nothing of yours could answer it";
      return null;

    case "draw":
      if (route.kind !== "route") return "nothing lives in here";
      if (!hidesEncounters(tileAt(state, route, state.x, state.y))) {
        return "stand in the tall grass first";
      }
      if (state.party.every(isFainted)) return "nothing of yours could answer it";
      return null;

    case "escape":
      return inTown(world, state) ? "you are already in town" : null;

    case "recall":
      if (!state.centre) return "you have not been to a Poké Center yet";
      return state.route === state.centre ? "you are standing in one" : null;

    case "reveal": {
      if (route.kind !== "route") return "there is no map of one room";
      return state.seen[route.id] === wholeMap(route) ? "this one is already drawn" : null;
    }

    case "transfuse": {
      const target = state.party[to!];
      if (to === index) return "it cannot give to itself";
      if (isFainted(target)) return "it is past helping this way";
      if (target.hp >= maxHp(target)) return "that one is already well";
      // It gives a fixed share of its own maximum whether or not all of it is
      // needed, so giving with too little left would be a faint.
      if (user.hp <= Math.floor(maxHp(user) / use.share)) return "it has too little to spare";
      return null;
    }
  }
}

/** One of a creature's moves, used out in the world. */
function applyFieldMove(
  world: World,
  state: GameState,
  index: number,
  moveIndex: number,
  to?: number,
): GameState {
  const refusal = fieldMoveRefusal(world, state, index, moveIndex, to);
  if (refusal) throw new IllegalInput(refusal);

  const user = state.party[index];
  const moveId = user.moves[moveIndex];
  const use = fieldUse(moveId)!;
  const route = world.routes.get(state.route)!;

  // Spent first, and on every road out of here. A field move costs a use the
  // way a battle move does, which is the whole reason Sweet Scent is not
  // simply a better way to walk.
  const party = [...state.party];
  party[index] = spendPp(user, moveIndex);
  const spent: GameState = { ...state, party, tick: state.tick + 1 };

  switch (use.t) {
    case "shake": {
      // Out of the route's own census, in the route's own order. A tree is
      // another door onto the same population rather than a second population
      // — the census is what a route *is*, and a move that rolled fresh would
      // be a way to fish for the one true shiny.
      const slot = nextEncounterSlot(world, spent, state.route);
      const wild = atFullHealth(withMoves(wildAt(world, ALL_SPECIES, state.route, slot, spent.nextUid)));
      const lead = party.findIndex((one) => !isFainted(one));

      return {
        ...spent,
        nextSlot: { ...spent.nextSlot, [state.route]: slot + 1 },
        phase: "battle",
        // Its own tag, so a creature shaken out of a tree and one met in the
        // grass never share a roll even at the same slot.
        battle: startBattle(world.seed, `${TREE_TAG}${state.route}:${slot}`, party, [wild], lead),
        nextUid: spent.nextUid + 1,
        notice: { t: "encounter" },
      };
    }

    case "draw": {
      const slot = nextEncounterSlot(world, spent, state.route);
      const wild = atFullHealth(withMoves(wildAt(world, ALL_SPECIES, state.route, slot, spent.nextUid)));
      const lead = party.findIndex((one) => !isFainted(one));

      return {
        ...spent,
        nextSlot: { ...spent.nextSlot, [state.route]: slot + 1 },
        phase: "battle",
        // The grass tag, because this *is* the grass — drawn out early rather
        // than walked into, and it should be the same encounter either way.
        battle: startBattle(world.seed, `${WILD_TAG}${state.route}:${slot}`, party, [wild], lead),
        nextUid: spent.nextUid + 1,
        notice: { t: "encounter" },
      };
    }

    case "escape":
      return { ...landAt(world, spent, HUB_ID), notice: { t: "usedMove", move: moveId } };

    case "recall":
      return { ...landAt(world, spent, spent.centre!), notice: { t: "usedMove", move: moveId } };

    case "reveal":
      return {
        ...spent,
        seen: { ...spent.seen, [route.id]: wholeMap(route) },
        notice: { t: "usedMove", move: moveId },
      };

    case "transfuse": {
      const given = Math.max(1, Math.floor(maxHp(user) / use.share));
      const target = party[to!];
      const room = maxHp(target) - target.hp;

      // The giver pays the whole share; the taker is capped at full. That
      // asymmetry is the cost of the move, and it is why it refuses at the
      // point where paying it would be a faint.
      party[index] = { ...party[index], hp: Math.max(1, party[index].hp - given) };
      party[to!] = { ...target, hp: target.hp + Math.min(room, given) };

      return { ...spent, party, notice: { t: "usedMove", move: moveId } };
    }
  }
}

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

/**
 * How coarse the small map's fog is, in tiles a side.
 *
 * Four, so a block is eight pixels on a map drawn at two pixels a tile: big
 * enough to read as a region of the route rather than a pixel, small enough
 * that a corridor you have walked shows as a corridor.
 */
export const FOG = 4;

function fogCols(route: Route): number {
  return Math.ceil(route.width / FOG);
}

/**
 * Whether this tile is on the map you have drawn for yourself.
 *
 * Interiors are exempt: a room is one screen and you have seen all of it the
 * moment you are standing in it, so fogging one would only ever hide the door
 * you came in through.
 */
export function hasSeen(state: GameState, route: Route, x: number, y: number): boolean {
  if (route.kind === "interior") return true;

  const bits = state.seen[route.id];
  if (!bits) return false;

  const block = Math.floor(y / FOG) * fogCols(route) + Math.floor(x / FOG);
  const nibble = bits.charCodeAt(bits.length - 1 - (block >> 2));
  if (Number.isNaN(nibble)) return false;

  // Hex, read from the least significant end so the string can be stored
  // without leading zeroes.
  const value =
    nibble >= 97 ? nibble - 87 : nibble >= 65 ? nibble - 55 : nibble >= 48 ? nibble - 48 : 0;
  return (value & (1 << (block & 3))) !== 0;
}

/**
 * The corner of the route on screen, worked out the way the camera works it
 * out: centred on you, and stopped at the edges of the world.
 *
 * In the engine rather than in the canvas because it is the answer to "what can
 * you see from here", which decides what the map remembers as well as what gets
 * painted. Two copies of that arithmetic would be two answers.
 */
export function sightCorner(route: Route, x: number, y: number): { x: number; y: number } {
  const wide = Math.min(SIGHT_TILES_X, route.width);
  const tall = Math.min(SIGHT_TILES_Y, route.height);
  return {
    x: Math.max(0, Math.min(x - Math.floor(wide / 2), route.width - wide)),
    y: Math.max(0, Math.min(y - Math.floor(tall / 2), route.height - tall)),
  };
}

/**
 * How many tiles of a route you take in from one spot.
 *
 * This is the camera as well: the window shows exactly what you can see, which
 * is why the number lives here and `render/tiles.ts` reads it rather than
 * keeping its own. A route is 88x68 and would be 2,288 pixels wide drawn whole,
 * which is both too wide for the page and too much of a place to take in at
 * once.
 */
export const SIGHT_TILES_X = 23;
export const SIGHT_TILES_Y = 17;

/**
 * Puts whatever you can see from where you are standing onto your map.
 *
 * In the dark that is the few tiles around you, which is what makes Flash a
 * tool worth having twice over: it lights the route *and* it is the difference
 * between mapping a place in one walk and mapping it in ten.
 */
function look(world: World, state: GameState): GameState {
  const route = world.routes.get(state.route);
  if (!route || route.kind === "interior") return state;

  const cols = fogCols(route);
  const rows = Math.ceil(route.height / FOG);
  const bits = new Uint8Array(cols * rows);

  // What is already known, unpacked.
  const known = state.seen[route.id] ?? "";
  for (let block = 0; block < bits.length; block++) {
    if (hasSeen(state, route, (block % cols) * FOG, Math.floor(block / cols) * FOG)) bits[block] = 1;
  }

  const dark = !canSee(state, route);
  if (dark) {
    for (let dy = -DARK_RADIUS; dy <= DARK_RADIUS; dy++) {
      for (let dx = -DARK_RADIUS; dx <= DARK_RADIUS; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > DARK_RADIUS) continue;
        const x = state.x + dx;
        const y = state.y + dy;
        if (x < 0 || y < 0 || x >= route.width || y >= route.height) continue;
        bits[Math.floor(y / FOG) * cols + Math.floor(x / FOG)] = 1;
      }
    }
  } else {
    const corner = sightCorner(route, state.x, state.y);
    const wide = Math.min(SIGHT_TILES_X, route.width);
    const tall = Math.min(SIGHT_TILES_Y, route.height);
    for (let y = corner.y; y < corner.y + tall; y++) {
      for (let x = corner.x; x < corner.x + wide; x++) {
        bits[Math.floor(y / FOG) * cols + Math.floor(x / FOG)] = 1;
      }
    }
  }

  const out = packFog(bits);
  return out === known ? state : { ...state, seen: { ...state.seen, [route.id]: out } };
}

/**
 * A fog bitset, back to the hex it is stored as.
 *
 * Four blocks a character, most significant first so the string carries no
 * leading zeroes to keep in step with. Pulled out of `look` when Defog needed
 * to write the same format from the other direction — two encoders for one
 * string is the kind of pair that agrees until it does not.
 */
function packFog(bits: Uint8Array): string {
  let out = "";
  for (let nibble = Math.ceil(bits.length / 4) - 1; nibble >= 0; nibble--) {
    let value = 0;
    for (let bit = 0; bit < 4; bit++) {
      if (bits[nibble * 4 + bit]) value |= 1 << bit;
    }
    if (value !== 0 || out.length > 0) out += value.toString(16);
  }
  return out === "" ? "0" : out;
}

/** Every block of a route's map, known. What Defog writes. */
function wholeMap(route: Route): string {
  const blocks = Math.ceil(route.width / FOG) * Math.ceil(route.height / FOG);
  return packFog(new Uint8Array(blocks).fill(1));
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

/**
 * Every place the Grey Line keeps somebody, in the order they were posted.
 *
 * Derived from the roster rather than written down twice. A second list of
 * "where the stations are" would be a list that disagrees with where the
 * people are standing the first time somebody moves one, and the symptom
 * would be a destination you can ride to with nobody there to ride you back.
 */
export function stations(world: World): string[] {
  const found: string[] = [];
  for (const [route, here] of world.npcs) {
    if (here.some((who) => who.kind === "travel")) found.push(route);
  }
  return found;
}

/**
 * Why the Greycoat in front of you will not take you there, or null.
 *
 * One predicate, two callers, as everywhere: the destination is greyed out for
 * exactly the reason the engine would refuse it, in the same words. The
 * "never been there" wording is lifted from `flyRefusal` deliberately — it is
 * the same rule about the same thing, and two phrasings of one rule read as
 * two rules.
 */
export function travelRefusal(world: World, state: GameState, id: string): string | null {
  if (state.phase !== "field") return "not right now";

  const person = speakingTo(world, state);
  if (!person) return "nobody is talking";
  if (person.kind !== "travel") return "they are not going anywhere";

  const route = world.routes.get(id);
  if (!route) return "no such place";
  if (!stations(world).includes(id)) return "nobody of ours is standing there";
  if (!state.visited.includes(id)) return "you have never been there";
  if (id === state.route) return "you are already there";
  return null;
}

function npcTravel(world: World, state: GameState, id: string): GameState {
  const refusal = travelRefusal(world, state, id);
  if (refusal) throw new IllegalInput(refusal);
  // Through the same landing Fly and an Escape Rope use, so there is one place
  // that decides where you end up standing.
  return { ...landAt(world, state, id), notice: { t: "travelled", route: id } };
}

function fly(world: World, state: GameState, id: string): GameState {
  const refusal = flyRefusal(world, state, id);
  if (refusal) throw new IllegalInput(refusal);
  return landAt(world, state, id);
}

/**
 * Put down somewhere else, with no opinion about whether you were allowed to.
 *
 * Split out from `fly` so an Escape Rope can borrow the landing without
 * borrowing the requirement: a rope is not a wing, and routing it through
 * `fly` meant a player with no HM Fly could not use one — which is not what
 * an escape rope is for. What the two share is where you end up standing, and
 * that is the part worth having in one place.
 */
function landAt(world: World, state: GameState, id: string): GameState {
  const route = world.routes.get(id);
  if (!route) throw new IllegalInput("no such place");

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

/**
 * Every creature standing on this map, and where.
 *
 * The one place that folds the world's record together with the save's, so
 * nothing else has to know that a roamer's position is derived from an index
 * and an idle one's is written down.
 */
/**
 * What a creature standing about was doing, in words.
 *
 * The notice carries its id rather than the sentence: the words are display
 * language and belong on the world, not in the state. Everything else about a
 * creature works this way already.
 */
export function critterDoing(world: World, routeId: string, id: string): string | null {
  return (world.critters.get(routeId) ?? []).find((one) => one.id === id)?.line ?? null;
}

export function crittersOn(
  world: World,
  state: GameState,
  routeId: string,
): { spec: CritterSpec; x: number; y: number }[] {
  return standingOn(world.critters.get(routeId) ?? [], state.roamers, state.met);
}

/** Whatever is standing on this exact tile, if anything. */
export function critterOn(
  world: World,
  state: GameState,
  routeId: string,
  x: number,
  y: number,
): CritterSpec | null {
  return crittersOn(world, state, routeId).find((one) => one.x === x && one.y === y)?.spec ?? null;
}

/**
 * Every roamer on this route moved on, one step of its loop.
 *
 * Called once per step the player takes, and only for the route they are
 * standing on: a creature circling the marsh does not care what you are doing
 * in the meadow, and making it care would mean every step in the world
 * advanced every loop in it.
 *
 * Nine steps in ten it moves one tile *away* from you. The tenth it hesitates,
 * which is the only reason a chase can ever be won going the same way round —
 * and going the other way round is the reason it can be won at all. See
 * critters.ts.
 */
function roamed(world: World, state: GameState, at: { x: number; y: number }): Record<string, number> {
  const here = world.critters.get(state.route);
  if (!here?.length) return state.roamers;

  let moved = state.roamers;
  for (const spec of here) {
    if (!spec.path?.length || state.met.includes(spec.id)) continue;

    // Named from the move count, so the same walk shifts the same creature the
    // same way on every machine, and a hesitation is as unrerollable as an
    // encounter.
    if (intBelow(rngFor(world.seed, "roam", spec.id, state.tick), 1000) >= ROAM_CHANCE) continue;

    const index = roamIndex(moved, spec);
    const step = awayFrom(spec, index, at);
    if (moved === state.roamers) moved = { ...state.roamers };
    moved[spec.id] = index + step;
  }

  return moved;
}

/**
 * Walking into a creature that was standing there.
 *
 * Three outcomes and one shape, because the difference between them is what
 * the creature *is* rather than how you met it. Each is the same as its
 * counterpart elsewhere in the game, deliberately: joining is a gift NPC's
 * hand-over, fighting is a wild encounter, and looking at one is a hint
 * NPC — nothing here is a new kind of event, only a new way of reaching one.
 */
function metCritter(world: World, state: GameState, spec: CritterSpec): GameState {
  // Built the way `wildAt`'s is built, by the caller that knows the stat
  // table, so a creature standing about and one met in the grass come out
  // identical.
  const creature = atFullHealth(withMoves({ ...spec.creature, uid: state.nextUid }));

  if (spec.kind === "idle") {
    // Nothing, and nothing recorded: it is still standing there tomorrow,
    // which is the whole of what makes it scenery rather than a reward.
    return {
      ...state,
      tick: state.tick + 1,
      talking: null,
      notice: { t: "noticed", speciesId: spec.creature.speciesId, critterId: spec.id },
    };
  }

  if (spec.kind === "joins") {
    const boxed = partyFull(state);
    const found = state.found.includes(creature.variantId)
      ? state.found
      : [...state.found, creature.variantId].sort();

    return {
      ...state,
      tick: state.tick + 1,
      party: boxed ? state.party : [...state.party, creature],
      box: boxed ? [...state.box, creature] : state.box,
      nextUid: state.nextUid + 1,
      found,
      met: [...state.met, spec.id].sort(),
      talking: null,
      notice: { t: "joined", speciesId: creature.speciesId, boxed, critterId: spec.id },
    };
  }

  // It fights. As a wild battle, so it can be caught — which is the point of
  // being able to see one before you decide, and the point of a roamer.
  const lead = state.party.findIndex((one) => !isFainted(one));
  if (lead < 0) {
    return {
      ...state,
      tick: state.tick + 1,
      talking: null,
      notice: { t: "noticed", speciesId: spec.creature.speciesId, critterId: spec.id },
    };
  }

  return {
    ...state,
    tick: state.tick + 1,
    phase: "battle",
    battle: startBattle(world.seed, `${CRITTER_TAG}${spec.id}`, state.party, [creature], lead),
    nextUid: state.nextUid + 1,
    talking: null,
    notice: { t: "encounter" },
  };
}

/** Adds one to the met list, kept sorted, and idempotent. */
function withMet(state: GameState, id: string | null): string[] {
  if (!id || state.met.includes(id)) return state.met;
  return [...state.met, id].sort();
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

    // There is no yes to say to a Greycoat. They are not offering a thing,
    // they are asking a question, and every answer to it is its own option
    // with its own refusal — see `travelRefusal`. This branch exists so that
    // `npcAccept` on one is refused rather than quietly doing nothing.
    case "travel":
      return "they want to know where to, not whether";

    case "trade":
      if (state.helped.includes(person.id)) return "they have already traded with you";
      if (!person.wants) return "there is nothing to take";
      if (!state.party.some((one) => matchesWant(one, person.wants!))) {
        return "you have nothing they want - " + wantText(person.wants);
      }
      return null;

    // Neither of these has a yes to say either, for the same reason the Grey
    // Line does not: the printer is asking *which colour* and the arena is
    // asking whether you are ready, and both answers are their own input with
    // their own refusal. This branch is what makes `npcAccept` on one refuse
    // rather than quietly do nothing.
    case "print":
      if (!state.lastWild) return "there is nothing on file yet";
      if (!printReady(state.tick, state.printedAt)) {
        return `the machine is still warming up — ${printWait(state.tick, state.printedAt)} moves`;
      }
      return "they want to know which colour, not whether";

    case "arena":
      return "they want to know whether you are entering, which is its own button";

    // Also no yes. He wants to know *which one*, and every answer is a
    // different creature with a different refusal — see `shredRefusal`.
    case "shred":
      if (!shredReady(state.tick, state.shreddedAt)) {
        return `the machine is still running — ${shredWait(state.tick, state.shreddedAt)} moves`;
      }
      if (state.party.length <= 1) return "keep something that can fight";
      return "they want to know which one, not whether";

    // The same shape again: which one, not whether.
    case "cut":
      if (!cutReady(state.tick, state.cutAt)) {
        return `the wheel is still turning — ${cutWait(state.tick, state.cutAt)} moves`;
      }
      if (state.party.length <= 1) return "keep something that can fight";
      return "they want to know which one, not whether";

    // And once more, with no gate to report: see `smith.ts` for why he has
    // none.
    case "forge":
      return "they want to know which one, not whether";
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

/*
 * ------------------------------------------------------------- the shredder
 *
 * A man who takes a creature off your hands and pays in Rare Candy, one for
 * every three levels it had. He is very clear that he is not going to say what
 * happens next, and he says it in a way that makes it perfectly obvious.
 *
 * ## What it is for
 *
 * A way to turn a creature you are done with into levels for one you are not.
 * The daycare makes creatures and the box stores them; nothing until now
 * *spent* one. A box of forty things you caught once and never used is a box
 * with no exit, and this is the exit.
 *
 * ## Why one for three, and why a thousand moves
 *
 * A candy is a level, so one-for-three is a two-thirds loss: it is a bad rate
 * on purpose. Feeding a level 60 in returns twenty levels, which is a real
 * amount and nowhere near sixty — the exchange has to be worth doing and must
 * never be worth *farming*, because a Rare Candy is the one item that buys the
 * thing this game is otherwise entirely about.
 *
 * The thousand-move gate is the other half of that. Without it a stack of
 * bred throwaways is an escalator: breed, shred, candy the good one, repeat.
 * With it, the exchange is a decision you make about eight times an hour of
 * walking, which is roughly how often you should be asked to think about it.
 */

/** How many levels buy one candy. */
export const SHRED_PER_CANDY = 3;

/** And how long before he will take another. */
export const SHRED_COOLDOWN = 1000;

/** What he pays for this one. Floor, so a level 2 is worth nothing at all. */
export function shredValue(creature: Individual): number {
  return Math.floor(creature.level / SHRED_PER_CANDY);
}

/** Whether he will take another yet. */
export function shredReady(tick: number, shreddedAt: number | null): boolean {
  return shreddedAt === null || tick - shreddedAt >= SHRED_COOLDOWN;
}

/** How many moves until he will. Zero when he is ready. */
export function shredWait(tick: number, shreddedAt: number | null): number {
  if (shreddedAt === null) return 0;
  return Math.max(0, SHRED_COOLDOWN - (tick - shreddedAt));
}

/**
 * Why he will not take this one, or null.
 *
 * One predicate, two callers: the panel greys the row for exactly what the
 * engine is about to refuse, in the same words.
 */
export function shredRefusal(
  world: World,
  state: GameState,
  index: number,
  confirm: number,
): string | null {
  // The standing checks by hand rather than through `offerRefusal`, the way
  // `travelRefusal` does them. `offerRefusal` answers "is there a plain yes to
  // say", and for this kind there deliberately is not — it returns the
  // sentence that says so, which would refuse every row on the panel.
  if (state.phase !== "field") return "not right now";

  const person = speakingTo(world, state);
  if (!person) return "nobody is talking";
  if (person.kind !== "shred") return "they are not taking anything";
  if (!shredReady(state.tick, state.shreddedAt)) {
    return `the machine is still running — ${shredWait(state.tick, state.shreddedAt)} moves`;
  }

  const creature = state.party[index];
  if (!creature) return "nobody there";
  if (creature.uid !== confirm) return "that is not the one you were shown";
  if (shredValue(creature) < 1) return "it is not worth a candy yet";
  // The same rule the Appraiser follows: walking out of a town with nothing
  // that can fight is a game that has quietly stopped working.
  if (state.party.length <= 1) return "keep something that can fight";
  return null;
}

function shred(world: World, state: GameState, index: number, confirm: number): GameState {
  const refusal = shredRefusal(world, state, index, confirm);
  if (refusal) throw new IllegalInput(refusal);

  const going = state.party[index];
  const paid = shredValue(going);

  return {
    ...state,
    tick: state.tick + 1,
    party: state.party.filter((_, slot) => slot !== index),
    bag: addItem(state.bag, "rarecandy", paid),
    shreddedAt: state.tick,
    // `found` is untouched, exactly as it is when the Appraiser buys one: the
    // census remembers what you have caught, not what you still hold, and
    // handing one over does not un-see it.
    notice: {
      t: "shredded",
      name: speciesById(going.speciesId).name,
      level: going.level,
      candy: paid,
    },
  };
}

/*
 * -------------------------------------------------------------- the lapidary
 *
 * A creature in, an evolution stone of its type out. See `engine/lapidary.ts`
 * for where the type-to-stone table comes from, which is the interesting half:
 * there isn't one, it is derived from the manifest's own item evolutions.
 */

/**
 * Why he will not take this one, or null.
 *
 * The standing checks by hand rather than through `offerRefusal`, for the
 * reason the shredder's does the same: `offerRefusal` answers "is there a
 * plain yes to say", and for this kind there deliberately is not.
 */
export function cutRefusal(
  world: World,
  state: GameState,
  index: number,
  confirm: number,
): string | null {
  if (state.phase !== "field") return "not right now";

  const person = speakingTo(world, state);
  if (!person) return "nobody is talking";
  if (person.kind !== "cut") return "they are not cutting anything";
  if (!cutReady(state.tick, state.cutAt)) {
    return `the wheel is still turning — ${cutWait(state.tick, state.cutAt)} moves`;
  }

  const creature = state.party[index];
  if (!creature) return "nobody there";
  // The uid, as at the Appraiser and the shredder: this is irreversible and a
  // party list can slide under a click.
  if (creature.uid !== confirm) return "that is not the one you were shown";
  if (state.party.length <= 1) return "keep something that can fight";
  return null;
}

/** What he would hand back for this one, without handing it over. */
export function cutPreview(world: World, state: GameState, index: number): string | null {
  const creature = state.party[index];
  if (!creature) return null;
  return stoneFor(
    rngFor(world.seed, "cut", state.tick, creature.uid),
    speciesById(creature.speciesId).types,
  );
}

function cut(world: World, state: GameState, index: number, confirm: number): GameState {
  const refusal = cutRefusal(world, state, index, confirm);
  if (refusal) throw new IllegalInput(refusal);

  const going = state.party[index];
  // Named off the seed, the tick and the creature, so a dual type cannot be
  // rerolled by walking out and back in — and so a replay hands back the same
  // stone. The same discipline the printer's failure roll follows.
  const stone = stoneFor(
    rngFor(world.seed, "cut", state.tick, going.uid),
    speciesById(going.speciesId).types,
  );

  return {
    ...state,
    tick: state.tick + 1,
    party: state.party.filter((_, slot) => slot !== index),
    bag: addItem(state.bag, stone),
    cutAt: state.tick,
    // `found` is untouched, as it is everywhere one changes hands: the census
    // remembers what you have caught, not what you still hold.
    notice: {
      t: "cut",
      name: speciesById(going.speciesId).name,
      item: stone,
    },
  };
}

/*
 * ----------------------------------------------------------------- the smith
 *
 * A new nature, paid for with one IV point. See `engine/smith.ts` for why it is
 * random, why it is always a *different* nature, and why — unlike everybody
 * else in the game who changes a creature — he has no cooldown.
 */

/**
 * Why he will not swing at this one, or null.
 *
 * The standing checks by hand rather than through `offerRefusal`, for the
 * reason the shredder's and the lapidary's do: there is no plain yes to say to
 * him, only a choice of which creature, and `offerRefusal` returns the sentence
 * that says so.
 */
export function reforgeRefusal(
  world: World,
  state: GameState,
  index: number,
  confirm: number,
): string | null {
  if (state.phase !== "field") return "not right now";

  const person = speakingTo(world, state);
  if (!person) return "nobody is talking";
  if (person.kind !== "forge") return "they are not holding a hammer";

  const creature = state.party[index];
  if (!creature) return "nobody there";
  // The uid, as everywhere a creature changes for good: the party list can
  // slide under a click, and an IV point does not come back.
  if (creature.uid !== confirm) return "that is not the one you were shown";
  if (!hasIvsLeft(creature)) return "there is nothing left in it to take";
  return null;
}

function reforge(world: World, state: GameState, index: number, confirm: number): GameState {
  const refusal = reforgeRefusal(world, state, index, confirm);
  if (refusal) throw new IllegalInput(refusal);

  const target = state.party[index];
  // Named off the seed, the tick and the creature, so the swing cannot be
  // taken back by reloading — the same log lands the same blow on the same
  // stat every time, which is what stops a bad nature being rerolled for free.
  const rng = rngFor(world.seed, "forge", state.tick, target.uid);
  const natureId = nextNature(rng, target.natureId);
  const stat = chippedStat(rng, target.ivs);
  // `reforgeRefusal` has already said there is something to take, so this is
  // a guard against the two disagreeing rather than a live case.
  if (!stat) throw new IllegalInput("there is nothing left in it to take");

  const ivs = { ...target.ivs, [stat]: target.ivs[stat] - REFORGE_COST };
  // The health fraction is kept, the way an evolution keeps it. A nature can
  // lower maximum HP by a point or two, and coming off the anvil on the same
  // *number* would quietly lose a slice of the bar.
  const before = maxHp(target);
  const changed: Individual = { ...target, natureId, ivs };
  const after = maxHp(changed);
  const hp = before > 0 ? Math.max(target.hp > 0 ? 1 : 0, Math.round((target.hp * after) / before)) : 0;

  return {
    ...state,
    tick: state.tick + 1,
    party: state.party.map((one, slot) => (slot === index ? { ...changed, hp } : one)),
    notice: {
      t: "reforged",
      name: speciesById(target.speciesId).name,
      from: target.natureId,
      to: natureId,
      stat,
    },
  };
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
/**
 * Everything standing at the edge of a change, and what it would become.
 *
 * The twin of `pendingOffers`, and it drops the same rows for the same
 * reason: a creature that has been released, sold or traded away is not
 * waiting on an answer, and asking about one that is not here is a prompt with
 * nothing behind it.
 */
export function pendingChanges(
  state: GameState,
): { uid: number; to: string; creature: Individual }[] {
  return state.pendingEvolutions.flatMap((offer) => {
    const creature =
      state.party.find((one) => one.uid === offer.uid) ??
      state.box.find((one) => one.uid === offer.uid);
    return creature ? [{ ...offer, creature }] : [];
  });
}

/**
 * Why this answer would be refused, or null if it would be taken.
 *
 * Saying no is always allowed — that is the entire point of being asked, and
 * the reason this exists at all.
 */
export function evolveRefusal(state: GameState, uid: number, to: string): string | null {
  if (state.phase !== "field" && state.phase !== "battleEnd") return "not right now";

  const waiting = state.pendingEvolutions.some(
    (offer) => offer.uid === uid && offer.to === to,
  );
  if (!waiting) return "nothing was offered";

  const creature =
    state.party.find((one) => one.uid === uid) ?? state.box.find((one) => one.uid === uid);
  if (!creature) return "it is not here any more";
  if (creature.speciesId === to) return "it is already that";
  return null;
}

/**
 * Taking the change, or turning it down.
 *
 * Either answer clears the offer, exactly as `learnMove` does: being asked
 * twice about the same thing is how a prompt becomes something a player clicks
 * through without reading, and this is the prompt it matters most for.
 *
 * Turning it down clears *this* offer and nothing more. The creature keeps
 * growing, and the next level it gains offers again — which is exactly what
 * these games do, and why an Everstone is a thing you can give something you
 * never want to change. Refusing once is a decision about this moment; the
 * item is the decision about all of them.
 *
 * Either way the answer has to be in the save. A replay that re-derived it
 * would evolve what the player refused, which is the one thing a log that
 * claims to reproduce a playthrough cannot be allowed to do.
 */
function answerEvolution(state: GameState, uid: number, to: string, accept: boolean): GameState {
  const refusal = evolveRefusal(state, uid, to);
  if (refusal) throw new IllegalInput(refusal);

  const pendingEvolutions = state.pendingEvolutions.filter(
    (offer) => !(offer.uid === uid && offer.to === to),
  );

  if (!accept) {
    return { ...state, tick: state.tick + 1, pendingEvolutions, notice: null };
  }

  const was =
    state.party.find((one) => one.uid === uid) ?? state.box.find((one) => one.uid === uid)!;
  const change = (one: Individual) => (one.uid === uid ? evolve(one, to) : one);

  return {
    ...state,
    tick: state.tick + 1,
    party: state.party.map(change),
    box: state.box.map(change),
    pendingEvolutions,
    notice: { t: "evolved", from: was.speciesId, to, uid, watched: true },
  };
}

/**
 * Evolutions a turn produced, folded into what is already waiting.
 *
 * Deduplicated on the way in, like `withOffers`. One creature can only be at
 * one threshold at a time, so a second row for the same uid is a bug either
 * way — and being asked the same question twice is a bug the player has to
 * click through regardless of which of us caused it.
 */
function withEvolutions(
  state: GameState,
  offers: readonly { uid: number; to: string }[],
): { uid: number; to: string }[] {
  if (!offers.length) return state.pendingEvolutions;

  const next = [...state.pendingEvolutions];
  for (const offer of offers) {
    if (!next.some((held) => held.uid === offer.uid)) next.push(offer);
  }
  return next;
}

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
      heldItem: null,
      nickname: offer.nickname ?? null,
      // Signed by the person who handed it over, not by you.
      caughtBy: person.name,
      traded: true,
      prize: false,
      cheat: false,
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

/**
 * What an Amulet Coin does to a purse.
 *
 * Read off whoever was standing when the battle ended, which is the reading
 * that matches the item: it doubles the money *this* creature won you. Asked
 * here rather than in battle.ts because money is not something a battle knows
 * about — the battle deals in health and experience, and the purse is the
 * engine's business.
 */
function withAmuletCoin(battle: BattleState | null, purse: number): number {
  if (!battle) return purse;
  const standing = battle.sides[0].team[battle.sides[0].active];
  if (!standing) return purse;

  let paid = purse;
  for (const effect of heldEffects(standing.heldItem)) {
    if (effect.t === "purse") paid = Math.floor((paid * effect.mille) / 1000);
  }
  return paid;
}

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
const ARENA_TAG = "arena:";

/**
 * What a round of a bracket pays.
 *
 * Per round rather than at the end, because losing the semi-final of a
 * three-round knockout should not be worth exactly nothing — you beat two
 * people to get there. Modest, because the prize is the prize.
 */
const ARENA_PURSE = 1200;

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
          heldItem: null,
          nickname: null,
          traded: false,
          prize: false,
          cheat: false,
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

/**
 * Whose creature you are looking at, as a possessive to hang on its name.
 *
 * The log reads `${label} ${name}`, and the label defaulted to "Wild" for
 * everything — so a gym leader's ace announced itself as "Wild Metagross",
 * and so did every trainer on every route. Nobody noticed for a long time
 * because the wild case is the common one; it became impossible to ignore the
 * first time the Cup opened with "Wild Iron Crown is out!".
 *
 * The battle tag already knows which kind of battle this is, so the answer is
 * derived here rather than guessed at the call site. Empty string for a duel:
 * two people who both know whose creature it is do not need telling.
 */
export function opponentLabel(world: World, battle: BattleState | null): string {
  if (!battle) return "";
  if (isWildBattle(battle)) return "Wild";

  const cupId = cupIdOf(battle);
  if (cupId) return `${cupSpec(cupId).name}'s`;

  const gymId = gymIdOf(battle);
  if (gymId) return `${gymSpec(gymId).leader}'s`;

  if (rivalIdOf(battle)) return `${RIVAL_NAME}'s`;

  const trainerId = trainerIdOf(battle);
  if (trainerId) {
    const who = [...world.trainers.values()].flat().find((one) => one.id === trainerId);
    return who ? `${who.name}'s` : "";
  }

  return "";
}

/**
 * What the person you have just walked into opens with, or null.
 *
 * Route trainers only. A gym leader, a Cup contender and the rival all have
 * written lines of their own and are characters rather than passers-by; the
 * town trainers are jokes whose punchline is their team. The two hundred and
 * seventy anonymous people out on the routes are the ones who were previously
 * furniture, and they are what this is for.
 *
 * Looked up through the world rather than carried on the battle, the same way
 * `opponentLabel` is. A battle is a pure function of its seed and a line of
 * dialogue is display: putting it in `BattleState` would put display language
 * in the state hash, which is the rule `narrate.ts` exists to keep.
 */
export function opponentHint(world: World, battle: BattleState | null): Hint | null {
  if (!battle || isWildBattle(battle)) return null;
  if (cupIdOf(battle) || gymIdOf(battle) || rivalIdOf(battle)) return null;

  const trainerId = trainerIdOf(battle);
  if (!trainerId) return null;

  const who = [...world.trainers.values()].flat().find((one) => one.id === trainerId);
  return who?.hintId ? hint(who.hintId) : null;
}

/** A place you have looked, and what you found standing there. */
export interface FieldNote {
  routeId: string;
  /** Species first met here, in dex order. */
  speciesIds: string[];
}

/**
 * What you have met, by where you met it.
 *
 * In the engine rather than in the panel because it is the same grouping every
 * caller wants, and this codebase has been bitten twice by one question with
 * two implementations — the Scrappy rule written out either side of the type
 * chart, and the crossing arithmetic that disagreed with itself about which
 * gap in town a walk home arrived at.
 *
 * Ordered by how far out the place is, so the list reads as the journey did.
 * Within a place, dex order, because that is the order every other list of
 * creatures in this game is in.
 *
 * Deliberately carries **no denominator.** It would be easy to say "7 of the
 * 23 that live here", and it would turn a record of where you have looked into
 * a checklist of where to look — which is the whole of what this game is
 * trying not to be. What lives on a route is for the route to tell you.
 */
export function fieldNotes(world: World, state: GameState): FieldNote[] {
  const byRoute = new Map<string, string[]>();
  for (const speciesId of Object.keys(state.whereMet)) {
    const routeId = state.whereMet[speciesId];
    const here = byRoute.get(routeId);
    if (here) here.push(speciesId);
    else byRoute.set(routeId, [speciesId]);
  }

  const order = (id: string) => {
    const route = world.routes.get(id);
    return route ? route.depth * 100 + route.ring : 9999;
  };

  return [...byRoute.entries()]
    .map(([routeId, speciesIds]): FieldNote => ({
      routeId,
      speciesIds: speciesIds.sort((a, b) => speciesById(a).num - speciesById(b).num),
    }))
    .sort((a, b) => order(a.routeId) - order(b.routeId) || a.routeId.localeCompare(b.routeId));
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
        // One item apiece, the same one on every seed: what they chose to do
        // with a perfect creature is part of who they are.
        heldItem: CUP_HOLDS[id] ?? null,
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
        prize: false,
        cheat: false,
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

  // A creature standing where you can see it. Checked here, beside the people,
  // because it occupies its tile the same way they do: you do not walk onto
  // it, you walk *into* it, and something happens.
  //
  // Note the player does not move. That is what makes a roamer a chase rather
  // than a formality — catching up to one and pressing into it does not push
  // it along, and it does not get its flee roll either, because the roll comes
  // with a step and this was not one.
  const standing = critterOn(world, state, state.route, nx, ny);
  if (standing) return metCritter(world, state, standing);

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
    // Away from where the player has arrived, not from where they left: a
    // roamer reacts to the step, and the step has already happened.
    roamers: roamed(world, state, { x: nx, y: ny }),
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
          heldItem: null,
          nickname: null,
          traded: false,
          prize: false,
          cheat: false,
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

  // A repel. Checked after the roll and before the creature is built, which is
  // the one ordering that keeps its promise: the step is spent, the roll is
  // spent, and `nextSlot` — the census — is not. Whatever is waiting in that
  // grass is still waiting, in the same order, when the repel runs out.
  if (activeRepel(state)) return { ...moved, steps };

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
    const wild = isWildBattle(state.battle);
    const rules = wild ? WILD_RULES : TRAINER_RULES;
    // The grass picks at random; a person picks. Both are derived from the
    // battle state alone, which is what keeps the other side's choices out of
    // the input log — they are recomputed from it. See src/ai.
    const theirs = wild ? aiAction(state.battle) : trainerAction(state.battle);
    result = resolveTurn(state.battle, [action, theirs], rules, ballAt(state, action));
  } catch (error) {
    throw new IllegalInput(error instanceof Error ? error.message : "bad battle action");
  }

  // Moves grown into mid-battle with no room for them. Collected here rather
  // than at the end, because a battle can be fled or lost and the level was
  // still gained.
  const offers = result.battle.events.flatMap((event) =>
    event.t === "exp" ? event.offered.map((moveId) => ({ uid: event.uid, moveId })) : [],
  );

  // And the evolutions grown into, for the same reason and collected the same
  // way: the level was gained even if the battle is then fled or lost, so the
  // offer has to survive the outcome.
  const changes = result.battle.events.flatMap((event) =>
    event.t === "exp" && event.evolved ? [{ uid: event.uid, to: event.evolved }] : [],
  );

  const base: GameState = {
    ...state,
    tick: state.tick + 1,
    // The party fought inside the battle, so it comes back out of it.
    party: result.battle.sides[0].team,
    pendingMoves: withOffers(state, offers),
    pendingEvolutions: withEvolutions(state, changes),
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
      const boxed = partyFull(base);
      const found = base.found.includes(caught.variantId)
        ? base.found
        : [...base.found, caught.variantId].sort();

      const kept: GameState = {
        ...base,
        phase: "battleEnd",
        party: boxed ? base.party : [...base.party, caught],
        box: boxed ? [...base.box, caught] : base.box,
        found,
        // A creature standing in the open, once caught, is not standing there
        // any more. Fleeing does *not* record it: it is still out there, which
        // is the whole reason a roamer is worth a second attempt.
        met: withMet(base, critterIdOf(base.battle?.tag)),
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

      // A round of a bracket, won. Advanced here rather than by a separate
      // input because the win *is* the advance: an input to confirm it would
      // be a button that can only be pressed one way.
      const arenaRound = arenaRoundOf(base.battle);
      if (arenaRound !== null && base.arena) {
        const round = base.arena.round + 1;
        return {
          ...base,
          phase: "battleEnd",
          arena: { ...base.arena, round },
          money: base.money + withAmuletCoin(base.battle, ARENA_PURSE),
          notice:
            round >= ARENA_ROUNDS
              ? { t: "arenaWon", id: base.arena.id }
              : { t: "arenaRound", id: base.arena.id, round },
        };
      }
      if (gymId) {
        // A badge is won once. Beating the same leader again — which you can,
        // there is nothing stopping you — pays nothing further, because what
        // a badge does is make every *other* gym harder.
        const already = base.badges.includes(gymId);
        return {
          ...base,
          phase: "battleEnd",
          badges: already ? base.badges : [...base.badges, gymId].sort(),
          money: base.money + (already ? 0 : withAmuletCoin(base.battle, GYM_PURSE)),
          bag: already ? base.bag : addItem(base.bag, gymSpec(gymId).tool),
          notice: already ? { t: "won" } : { t: "badge", gym: gymId },
        };
      }

      // Something that was standing in the world, beaten. Recorded before the
      // trainer and gym branches because it is neither, and because a battle
      // has exactly one tag.
      const standingId = critterIdOf(base.battle?.tag);
      if (standingId) {
        return {
          ...base,
          phase: "battleEnd",
          met: withMet(base, standingId),
          notice: { t: "won" },
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

      // The rival. He pays properly, because he is the hardest thing that will
      // happen to you between gyms and because he turned up uninvited.
      const rivalId = rivalIdOf(base.battle);
      if (rivalId) {
        const purse = withAmuletCoin(base.battle, RIVAL_PURSE);
        return {
          ...base,
          phase: "battleEnd",
          money: base.money + purse,
          notice: { t: "beatTrainer", name: RIVAL_NAME, money: purse },
        };
      }

      if (!trainerId) return { ...base, phase: "battleEnd", notice: { t: "won" } };

      const trainer = [...world.trainers.values()].flat().find((who) => who.id === trainerId);
      const wins = (base.wins[trainerId] ?? 0) + 1;
      const purse = withAmuletCoin(
        result.battle,
        trainerPurse(trainer?.team.length ?? 1, world.routes.get(base.route)?.ring ?? 1) * wins,
      );

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
 * Carried to the last Poké Center you were in, with everything healed.
 *
 * Losing costs progress and time, never a creature — a roguelike is a
 * different game. Reached from a lost battle, and from any other ending that
 * happens to leave nothing standing.
 *
 * It used to be Hearth, always, which was the only answer when Hearth was the
 * only town. With four of them, fainting nine hops out and waking at the
 * origin is not a cost, it is a punishment: the walk back is most of an hour
 * and none of it is play. The Center you last stood in is the one you know the
 * way to, and it is where a beaten trainer would go.
 *
 * Before you have been inside one — which is most of the first walk, since you
 * start in the square rather than in the building — it is still Hearth.
 */
function whiteout(world: World, state: GameState): GameState {
  const centre = state.centre ? world.routes.get(state.centre) : null;
  const woke = centre ?? world.routes.get(HUB_ID);
  if (!woke) throw new Error("world has no hub");

  return {
    ...state,
    phase: "battleEnd",
    route: woke.id,
    x: woke.entry.x,
    y: woke.entry.y,
    // Beaten, carried in, and put right — uses included. Losing is the one
    // thing in this game that costs you nothing but the walk back.
    party: state.party.map(restored),
    // And out of the bracket, which is the one thing losing *does* cost. A
    // knockout you could wake up from and carry on in is not a knockout —
    // re-entering is a fresh draw, because the tick it was entered on names
    // every roll in it.
    arena: null,
    // The town rather than the room, because "you woke up in the Poké Center"
    // is true of every one of them and says nothing.
    notice: { t: "whiteout", at: woke.parent ?? woke.id },
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
      // Encoded, so a colon or a bar typed into a name cannot fake a boundary.
      encodeURIComponent(creature.nickname ?? ""),
      // Not who caught it: a trainer name is who is playing, not what is
      // happening, and two people on today's seed should be able to compare
      // hashes whatever they are called.
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
        fieldKey(state.battle.field),
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
    state.daycare.incubating.map((egg) => `${individual(egg.creature)}@${egg.steps}/${egg.total}`).join("|"),
  ].join(":");

  const canonical = [
    state.tick,
    state.phase,
    state.route,
    state.x,
    state.y,
    counters(state.steps),
    counters(state.nextSlot),
    // In the hash because it is state, folded from the inputs like everything
    // else here. Nothing reads it but the map, and a claim that two logs
    // produce the same state should not have an exception in it.
    Object.keys(state.seen)
      .sort()
      .map((id) => `${id}=${state.seen[id]}`)
      .join(","),
    // Where each species was first met. Not redundant with the party: two
    // logs can end holding the same six creatures having found them in
    // different places, and this is the field that says so.
    Object.keys(state.whereMet)
      .sort()
      .map((id) => `${id}@${state.whereMet[id]}`)
      .join(","),
    state.caught.join(","),
    state.centre ?? "-",
    state.trail.map((at) => `${at.route}@${at.x},${at.y}`).join(">"),
    state.rivalSince ?? "-",
    state.rivalLast ?? "-",
    state.rivalVisits,
    state.party.map(individual).join("|"),
    state.box.map(individual).join("|"),
    state.boxNames.map((name) => encodeURIComponent(name)).join(","),
    state.expShareGiven ? "1" : "0",
    Object.keys(state.boxOf)
      .map(Number)
      .sort((a, b) => a - b)
      .map((uid) => `${uid}>${state.boxOf[uid]}`)
      .join(","),
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
    // An unanswered evolution is state: two peers that disagreed about one
    // would agree about the whole game right up until somebody answered it.
    state.pendingEvolutions.map((offer) => `${offer.uid}>${offer.to}`).join(","),
    state.eggs.map((egg) => `${individual(egg.creature)}@${egg.steps}/${egg.total}`).join("|"),
    // What the printer has on file, and when it last ran. Both decide what a
    // later input is allowed to do, so both are state.
    state.lastWild ?? "-",
    state.printedAt ?? "-",
    state.shreddedAt ?? "-",
    state.cutAt ?? "-",
    state.arena ? `${state.arena.id}:${state.arena.entered}:${state.arena.round}` : "-",
    state.cheated ? "1" : "0",
  ].join(";");

  return hash32(canonical).toString(16).padStart(8, "0");
}

/** Full stats for a creature, re-exported so the UI has one place to ask. */
export { computeStats };
