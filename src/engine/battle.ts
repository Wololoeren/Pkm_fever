import {
  ALL_MOVES,
  effectiveness,
  move as moveById,
  species as speciesById,
  TYPE_NAMES,
  type Boosts,
  type MoveEntry,
  type StageStat,
} from "./dex";
import { effortYield, gainEffort } from "./effort";
import { awardExp, expYield } from "./progression";
import { abilitiesOf, effectApplies, type AbilityEffect } from "./abilities";
import { heldEffects, isConsumedOnUse } from "./carry";
import { canStillEvolve } from "./progression";
import { hasVariableDamage, powerOfBlow, variableDamage, type DamageContext } from "./moves";
import {
  actsOnSomething,
  extraEffects,
  UNCALLABLE,
  type AimStat,
  type MoveEffect,
  type SideConditionId,
} from "./statusmoves";
import { anyPp, hasPp, ppLeft, spendPp, STRUGGLE, STRUGGLE_RECOIL } from "./pp";
import { intBelow, rngFor } from "./rng";
import { gendersPair } from "./gender";
import {
  FIELD_SHARE,
  FIELD_TURNS,
  fieldKey,
  HAIL_PROOF,
  SAND_PROOF,
  WEATHER_TYPE,
  type Field,
  type SportId,
  type TerrainId,
  type WeatherId,
} from "./field";
import { computeStats } from "./stats";
import { STAT_IDS, type Individual, type StatId, type StatusId } from "./types";

/**
 * Battles, with two symmetric sides.
 *
 * Side 0 is always the local player. Side 1 is a wild creature driven by the
 * AI, or another person over the wire — and the rules do not know which. That
 * symmetry is not tidiness: a duel is checked independently by both peers, and
 * a second implementation of the rules for "versus" would drift from the one
 * used against wild creatures until the two disagreed mid-tournament. One
 * engine, two drivers.
 *
 * Every roll is named — `rngFor(seed, tag, turn, "0-crit")` — so a battle is a
 * pure function of its seed and how many turns have passed. For a wild battle
 * the seed is the world's, which is what makes encounters unrerollable. For a
 * duel it is derived from both players' nonces, so neither can bias a critical
 * hit.
 *
 * Integer arithmetic throughout. Type effectiveness travels in quarters and
 * stage multipliers as numerator/denominator pairs, so no step ever produces a
 * float that could round differently on another machine.
 */

export type SideIndex = 0 | 1;
export type Stages = Record<StageStat, number>;

/**
 * The other two ladders.
 *
 * Accuracy and evasion are stages like the five stats, but they are not stats:
 * they multiply a *probability* rather than a number, on their own
 * `(3 + n) / 3` rungs rather than the stats' `(2 + n) / 2`. Kept separate from
 * `Stages` for that reason and one more — `StageStat` is what the ability
 * table is written against, and widening it would make every ability that
 * raises a stat have to say what it means about accuracy.
 */
export type AimStages = Record<AimStat, number>;

/**
 * Everything true of a creature's *appearance* rather than of the creature.
 *
 * Gone the moment it switches out, exactly like stat stages and for the same
 * reason: being seeded is a fact about standing there, not about the animal.
 * Anything that must outlive a switch belongs on the side (see `screens`) and
 * anything that must outlive the battle belongs on the Individual.
 *
 * Optional throughout, and absent rather than zero when nothing is going on,
 * so a battle with none of this in it hashes exactly as it did before any of
 * it existed — every saved duel and every replayed battle log still checks.
 */
export interface Volatiles {
  /** Leech Seed. Drained at the end of every turn, into whoever is opposite. */
  seeded?: boolean;
  /** Turns of confusion left. */
  confusion?: number;
  /** Shielded for this turn only; `endure` survives at one instead. */
  shield?: "protect" | "endure";
  /**
   * Consecutive turns a shield has been put up.
   *
   * What stops Protect from being an answer to everything: the second one in a
   * row works one time in three, the third one in nine.
   */
  shieldStreak?: number;
  /** Stages up the critical ladder, from Focus Energy. */
  crit?: number;
  /** Turns until Yawn puts it to sleep. */
  yawn?: number;
  /** Nightmare, which only bites while it sleeps. */
  nightmare?: boolean;
  /** Perish Song's count, on both sides at once. */
  perish?: number;
  /** Mean Look: it cannot switch and it cannot run. */
  trapped?: boolean;
  /** Aqua Ring, Ingrain: a sixteenth back every turn. */
  rooted?: boolean;
  /** Attract: half its turns lost. */
  infatuated?: boolean;
  /**
   * Power Split, Guard Split, Speed Swap: the numbers the stages multiply,
   * rewritten. A stat not named here is still the creature's own.
   */
  stats?: Partial<Record<StageStat, number>>;
  /** Stockpile's counter, one to three. */
  stockpile?: number;
  /** Lock-On: its next move cannot miss. */
  sure?: boolean;
  /** Destiny Bond: whatever knocks it out goes down with it. */
  bonded?: boolean;
  /** Turns until Wish comes true, for whoever is standing here. */
  wish?: number;
  /** Healing Wish: it fainted so that whoever comes next arrives whole. */
  blessing?: boolean;
  /** Turns left off the ground, from Magnet Rise or Telekinesis. */
  afloat?: number;
  /**
   * What types it is *now*, if a move changed them. Absent, it is what its
   * species is. Every place the battle asks about a type asks through
   * `typesOf`, so a Soaked creature is Water to the chart, to STAB, to a
   * status immunity and to a seed alike.
   */
  types?: readonly string[];
  /** Foresight and Miracle Eye: the immunity that has been seen through. */
  seen?: "ghost" | "dark";

  /*
   * ------------------------------------------------------------------
   * The seven below are what a *damaging* move can leave behind.
   *
   * Everything above this line arrived with the status moves, and the gate in
   * `dex.ts` meant a status move whose shape was missing was never dealt at
   * all. Damaging moves went through no such gate — `actsOnSomething` returns
   * true for every one of them — so a move whose entire identity is a flag
   * was handed out with its power and none of its cost. Hyper Beam was a
   * hundred and fifty power with no recharge; Fly hit the turn it was used;
   * Fake Out was a forty-power priority move that did nothing a Quick Attack
   * does not do better.
   * ------------------------------------------------------------------
   */

  /**
   * The move it is part-way through, and cannot stop doing.
   *
   * One field for three mechanics that are the same shape — a move id the
   * next turn is spent on, whether the creature likes it or not — because
   * they cannot overlap and one field is one thing to clear on a switch:
   *
   * - **charging** (`charge`): Fly, Dig, Solar Beam. Turn one is spent going
   *   up, down or gathering light; turn two is the blow.
   * - **raging** (`lockedmove`): Outrage, Thrash. Two or three turns of the
   *   same move, and confusion at the end of it.
   * - **rolling**: Rollout and Ice Ball, whose power doubles every turn it
   *   keeps landing.
   *
   * `commitment` says which of the three, because what happens when it ends
   * differs: a charge releases, a rampage confuses, and a roll simply stops.
   */
  committed?: string;
  commitment?: "charge" | "rage" | "roll";
  /** Turns of `committed` still to run. A charge is always one. */
  commitTurns?: number;
  /**
   * How many blows a Rollout has landed in a row, which is what doubles it.
   *
   * Separate from `commitTurns` because it counts *up* and survives what the
   * lock does not: a Rollout that misses loses the lock and the streak
   * together, but a Defence Curl before it starts is worth a doubling that no
   * turn counter could hold.
   */
  rolled?: number;
  /** Defence Curl, which Rollout is worth twice as much after. */
  curled?: boolean;
  /**
   * Where it went while charging: up, under, below or out of the world.
   *
   * Nothing reaches it there, bar the handful of moves that specifically do —
   * Earthquake finds a Dig, Gust and Thunder find a Fly, Surf finds a Dive,
   * and nothing at all finds a Phantom Force. Without this a two-turn move is
   * strictly worse than a one-turn one, which is not what it is meant to be:
   * the turn spent is bought back by the turn spent untouchable.
   */
  hidden?: "sky" | "ground" | "water" | "shadow";
  /** Hyper Beam and the nine other beams: the next turn is spent recovering. */
  recharging?: boolean;
  /**
   * It flinched, and does not move this turn.
   *
   * Set by whoever moved first and read by whoever moves second, then cleared
   * at the end of the turn whether or not it was ever read — which is the
   * whole of the mechanic, and the reason a flinch from the slower side is
   * worth nothing.
   */
  flinched?: boolean;
  /** Wrap, Fire Spin, Whirlpool: turns left in the bind, and who is holding
   * it there. It cannot leave, and it loses an eighth every turn. */
  bound?: number;
  /**
   * Bide: turns of taking it, and what has been taken so far.
   *
   * Both, because unleashing needs the second and knowing when needs the
   * first, and a Bide with nothing stored still has to end.
   */
  biding?: number;
  bided?: number;
  /**
   * It has not had a turn yet, which is the whole of what Fake Out asks.
   *
   * Written on arrival and taken off again the moment the slot has had a turn
   * — that direction round, rather than a `hasActed` set every turn forever,
   * because a volatile written on every creature in every battle would throw
   * away the absent-unless-something-is-happening property that `X41` exists
   * to hold: a battle with none of this in it has to hash exactly as it did
   * before any of it existed.
   *
   * Being swept on arrival is what makes the three cases agree with no turn
   * counting anywhere: a lead can Fake Out on turn one, a creature switched
   * in on turn five can Fake Out on turn six, and one dragged in by a Roar
   * can do the same.
   */
  fresh?: boolean;
}

export type BattleOutcome =
  | { t: "win"; side: SideIndex }
  | { t: "caught" }
  | { t: "fled" }
  | { t: "draw" };

export type BattleAction =
  | { t: "fight"; moveIndex: number }
  /**
   * Everything spent, and still standing.
   *
   * Its own action rather than a magic move index, because it is a different
   * decision: `fight` names a slot, and a creature reduced to Struggle has no
   * slots left to name. Legal only when nothing else is.
   */
  | { t: "struggle" }
  | { t: "switch"; partyIndex: number }
  /** Wild battles only. */
  /** Which ball. Omitted means an ordinary one. */
  | { t: "ball"; item?: string }
  | { t: "flee" }
  /** Nothing to do — a side with a fainted active that owes no replacement. */
  | { t: "pass" };

/** What `volatile` events can be about. */
export type VolatileKind =
  | "seeded"
  /**
   * The seed *biting*, which is a different sentence from being seeded.
   *
   * Both were "was seeded!" for a moment, so the turn it landed read
   * "Amaura was seeded! Amaura was seeded! Amaura took 5." — the game
   * appearing to stutter rather than a seed taking hold and then drawing.
   */
  | "sapped"
  | "confused"
  /** Hit itself, which is a different sentence from having become confused. */
  | "selfhit"
  | "snapped"
  | "shield"
  | "endure"
  | "crit"
  | "yawn"
  | "nightmare"
  /** And the nightmare biting, for the same reason as `sapped`. */
  | "dreaming"
  | "trapped"
  | "drowsy"
  | "rooted"
  | "infatuated"
  /** And love biting, which costs the turn. */
  | "smitten"
  | "copied"
  | "swapped"
  | "split"
  | "stockpiled"
  | "sure"
  | "bonded"
  /** The bond biting: the attacker goes down too. */
  | "avenged"
  | "wished"
  | "blessed"
  | "afloat"
  | "retyped"
  | "seen"
  | "inverted"
  /** Gathering light, going up, going under: a charge turn spent. */
  | "charging"
  /** And the turn spent getting its breath back afterwards. */
  | "recharging"
  /** It flinched, and lost the turn. */
  | "flinched"
  /** Caught in a bind, and the bind squeezing — the same two-sentence split
   * `seeded` and `sapped` have, for the same reason. */
  | "bound"
  | "squeezed"
  /** The bind wearing off, which the player needs told or the freedom is
   * invisible. */
  | "freed"
  /** Thrashing about, and the confusion that ends it. */
  | "raging"
  /** Taking it, and giving it back twice over. */
  | "biding"
  | "unleashed";

export type BattleEvent =
  | { t: "use"; side: SideIndex; moveId: string }
  /** Nothing left to use it with. */
  | { t: "struggling"; side: SideIndex }
  /** Something a creature can do that its species cannot. */
  | { t: "ability"; side: SideIndex; abilityId: string }
  /**
   * Something it is *carrying* did that.
   *
   * A separate event from `ability`, because the two read differently and a
   * player needs to be able to tell them apart: an ability is a fact about
   * the creature and an item is a decision you made. `spent` says the item is
   * gone, which is the whole difference between a berry and a Choice Band.
   */
  | { t: "item"; side: SideIndex; itemId: string; spent: boolean }
  /**
   * A move whose damage depends on the battle, in a battle where it comes to
   * nothing. Endeavor against something weaker, Counter with nothing to
   * counter. Its own event, because "it failed" and "it hit for zero" are
   * different things and a log that says the second is lying.
   */
  | { t: "fizzled"; side: SideIndex; moveId: string }
  | { t: "miss"; side: SideIndex }
  | { t: "immune"; side: SideIndex }
  | { t: "damage"; side: SideIndex; amount: number; quarters: number; crit: boolean }
  | { t: "status"; side: SideIndex; status: StatusId }
  | { t: "boost"; side: SideIndex; stat: StageStat; delta: number }
  /**
   * A move of one of the two probability ladders.
   *
   * Its own event rather than a `boost` with a wider stat, because the log
   * phrases them differently — "its Attack fell" and "its accuracy fell" are
   * not the same sentence — and because `boost` is typed against the ability
   * table's `StageStat`.
   */
  | { t: "aim"; side: SideIndex; which: AimStat; delta: number }
  /** Something happened to a creature that is not a stat and not a status. */
  | { t: "volatile"; side: SideIndex; which: VolatileKind }
  /** And something happened to a whole side. */
  | { t: "screen"; side: SideIndex; which: SideConditionId }
  /** A screen, a shield or a trap said no. */
  | { t: "shielded"; side: SideIndex }
  /**
   * How many times a multi-strike move landed.
   *
   * Said once at the end rather than folded into the blows, because each blow
   * already has its own `damage` event and needs one: they roll their own crit
   * and their own spread, so three hits are three different numbers and a log
   * that added them up would be hiding the interesting part. This is the
   * summary on top — "Hit 3 times!" — and it is only emitted when there was
   * more than one, so nothing in the log ever says a move hit once.
   */
  | { t: "hits"; side: SideIndex; count: number }
  /** Perish Song's count, spoken once per turn per side. */
  | { t: "perish"; side: SideIndex; turns: number }
  /** Ditto, mid-battle. */
  | { t: "transformed"; side: SideIndex; into: string }
  /** Smeargle, for good. */
  | { t: "sketched"; side: SideIndex; moveId: string }
  /** Revival Blessing: somebody in reserve is back on their feet. */
  | { t: "revived"; side: SideIndex; speciesId: string }
  /** Spite: uses taken off a move. `side` is whose move. */
  | { t: "spite"; side: SideIndex; moveId: string; amount: number }
  /** Weather, terrain or a sport starting, or ending. */
  | { t: "field"; kind: "weather" | "terrain" | "sport"; id: string; over: boolean }
  /** Sand or hail biting. */
  | { t: "weathered"; side: SideIndex; weather: WeatherId; amount: number }
  | { t: "heal"; side: SideIndex; amount: number }
  | { t: "recoil"; side: SideIndex; amount: number }
  | { t: "blocked"; side: SideIndex; reason: StatusId }
  | { t: "woke"; side: SideIndex }
  | { t: "thawed"; side: SideIndex }
  | { t: "residual"; side: SideIndex; status: StatusId; amount: number }
  | { t: "faint"; side: SideIndex }
  | { t: "switch"; side: SideIndex; partyIndex: number }
  | {
      t: "exp";
      amount: number;
      levels: number;
      /** Who earned it. Without this an offer that arrives in the log has no
       * way to say which creature it is about. */
      uid: number;
      learned: string[];
      /** Grew into it, had no room for it. The player is asked later. */
      offered: string[];
      /**
       * What it is ready to become, if anything.
       *
       * An offer rather than a fact, the way `offered` above is. A battle no
       * longer changes anybody's species: whoever owns the party turns this
       * into a question and applies the answer, because saying no has to be a
       * decision the save records or a replay would evolve what the player
       * refused.
       */
      evolved: string | null;
      /** And what it is now, carried so a screen showing the change has both
       * halves of it without looking the creature up. */
      evolvedFrom: string | null;
    }
  | { t: "effort"; stats: StatId[]; amount: number }
  | { t: "catchFailed" }
  | { t: "caught" }
  | { t: "fleeFailed" }
  | { t: "fled" }
  | { t: "noBalls" }
  | { t: "timeout" };

export interface Combatant {
  /** Everything this side can send out. A wild creature is a team of one. */
  team: Individual[];
  /** Which of them is out. */
  active: number;
  stages: Stages;
  /**
   * The one move a Choice item has committed this side to, or null.
   *
   * On the side rather than on the creature, because it is a fact about *this
   * appearance* rather than about the creature: switching out clears it, which
   * is the whole cost-and-escape of the Choice items. Storing it on the
   * Individual would follow the creature into the box.
   */
  locked?: string | null;
  /**
   * The last move this side actually got off.
   *
   * Beside `locked` rather than in `volatiles`, because it is the same kind of
   * thing — a memory of what was used, not a condition the creature is under
   * — and because putting it in `volatiles` meant every battle in the game
   * had a volatile record from its first turn, which threw away the
   * absent-unless-something-is-happening property the rest of them depend on.
   *
   * Sketch is the only reader today. Mirror Move and Encore want it too, when
   * move restriction gets its pass.
   */
  lastMove?: string | null;
  /**
   * The two probability ladders, which belong to the slot like `stages` does.
   */
  aim?: AimStages;
  /**
   * Everything true only while this one is standing there.
   */
  volatiles?: Volatiles;
  /**
   * Conditions that belong to the *side* and outlive whoever is out.
   *
   * Reflect does not stop mattering because you switched — that is the whole
   * point of a screen, and it is why these are here rather than in
   * `volatiles`. Turn counts, decremented once per turn and deleted at nought.
   */
  screens?: Partial<Record<SideConditionId, number>>;
  /**
   * A blow already thrown that has not arrived yet: Future Sight, Doom Desire.
   *
   * On the side rather than in `volatiles` because that is precisely what
   * makes the move worth using — it lands on whoever is standing there in two
   * turns, which may well be somebody who was not there when it was thrown,
   * and a volatile would be swept away by the very switch the move is aimed
   * at punishing.
   *
   * `amount` is settled when the move is used rather than when it lands. That
   * is a deviation and it is deliberate: the alternative is storing the
   * attacker whole and running the damage formula against a slot it is no
   * longer standing in, and a snapshot of a creature that has since evolved,
   * fainted or been swapped for another is a worse lie than a fixed number.
   * What the player is promised — "this much, in two turns, whoever is there"
   * — is exactly what happens.
   */
  future?: { turns: number; moveId: string; amount: number; quarters: number };
}

export interface BattleState {
  /** Names every roll, together with `tag`. */
  seed: string;
  /** Distinguishes this battle from every other one under the same seed. */
  tag: string;
  turn: number;
  sides: [Combatant, Combatant];
  /** Sides that owe a replacement before anything else can happen. */
  awaitingSwitch: [boolean, boolean];
  /**
   * Which of our team have stood opposite whatever the other side has out.
   *
   * Indices into `sides[0].team`, and the whole of what "took part" means: the
   * experience for beating something is split between everybody on this list
   * rather than handed to whoever landed the last hit.
   *
   * Reset the moment the *other* side sends somebody new out, which is what
   * keeps it honest — otherwise beating a team of six would pay the whole
   * party six times over for work it did against the first one.
   *
   * On the battle rather than in `volatiles`, because volatiles are cleared by
   * the very switch this exists to remember.
   */
  sharing: number[];
  /**
   * Weather, terrain and the sports. Absent when nothing is up, so a battle
   * with no weather in it hashes as it did before the field existed.
   */
  field?: Field;
  outcome: BattleOutcome | null;
  /** Narration for the turn just resolved. Derived from everything else, so
   * stateHash leaves it out. */
  events: BattleEvent[];
}

/**
 * What a battle allows.
 *
 * Two independent questions, not one: a wild creature can be caught and run
 * from and is worth experience; a trainer is worth experience but cannot be
 * caught; another person is neither. Collapsing them into a single "is this
 * wild" flag cannot express the middle case.
 */
export interface BattleRules {
  /** Whether balls and running are legal. */
  catchable: boolean;
  /** Whether beating it is worth experience. */
  awardsExp: boolean;
}

export const WILD_RULES: BattleRules = { catchable: true, awardsExp: true };
export const TRAINER_RULES: BattleRules = { catchable: false, awardsExp: true };
export const DUEL_RULES: BattleRules = { catchable: false, awardsExp: false };

/**
 * The turn after which a battle is decided on health rather than allowed to
 * continue.
 *
 * Not a nicety — without it some battles genuinely never end. Rowlet is
 * Grass/Flying, so Wooper-Paldea's Mud Shot is a zero-times no-op, and if the
 * Rowlet answers with Growl neither side can reduce the other's HP by a single
 * point, ever. A wild battle could be run from; a trainer battle could not,
 * and the game simply stopped.
 *
 * These games solve it with PP: moves run out and the attacker is forced into
 * Struggle, which always damages and always recoils. That is the more faithful
 * answer and it needs a PP system to mean anything. This is the guarantee
 * underneath it — even with Struggle, two creatures healing each other back up
 * would still need a stop — and 300 turns is far beyond any real battle.
 */
export const MAX_TURNS = 300;

const NO_STAGES: Stages = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const NO_AIM: AimStages = { accuracy: 0, evasion: 0 };

/** Leech Seed's bite, and Nightmare's. An eighth and a quarter. */
const SEED_SHARE = 8;
const NIGHTMARE_SHARE = 4;

/** Rest, and how long Yawn takes to land. */
const REST_TURNS = 3;
const YAWN_TURNS = 2;

/** Power points a copied moveset comes out with. */
const TRANSFORM_PP = 5;

/** Named because `applyMoveEffect` has to find the slot it is standing in. */
const SKETCH = "sketch";

/** Perish Song's count, and confusion's. */
const PERISH_TURNS = 4;
const CONFUSED_TURNS = 4;

/** Aqua Ring and Ingrain: a sixteenth back a turn. */
const ROOTS_SHARE = 16;

/** How often an infatuated creature cannot bring itself to move, in percent. */
const INFATUATED_CHANCE = 50;

/** How long a Wish takes to come true, and how much it is worth. */
const WISH_TURNS = 2;
const WISH_SHARE = 2;

/**
 * Stockpile's ceiling, and what Swallow mends at each count: a quarter, a
 * half, everything.
 */
const STOCKPILE_MAX = 3;
const SWALLOW_SHARES = [4, 2, 1];

/**
 * How deep a move may call a move.
 *
 * A chosen move is depth nought and the move it calls is one. Nothing legal
 * reaches two — `UNCALLABLE` keeps every caller off every caller's menu —
 * and this is the floor under that: a Metronome that somehow called a
 * Metronome stops here rather than hanging the battle.
 */
const MAX_CALL_DEPTH = 1;

/** What Spite takes off. */
const SPITE_USES = 4;

/**
 * Everything Metronome can land on.
 *
 * The manifest's order, so the roll means the same thing on both peers of a
 * duel; filtered to what the engine honours, so a Metronome never spends a
 * turn on a move that does nothing — which is the one guarantee this whole
 * design makes.
 */
const CALLABLE: readonly string[] = ALL_MOVES.filter(
  (entry) => actsOnSomething(entry) && !UNCALLABLE.has(entry.id),
).map((entry) => entry.id);

/** How often a confused creature hits itself instead, in percent. */
const CONFUSED_CHANCE = 33;

/** What a confused creature hits itself with, as base power. */
const CONFUSED_POWER = 40;

/**
 * The accuracy and evasion ladder.
 *
 * Thirds rather than the stats' halves, which is the real ladder and not a
 * simplification: at +6 a stat is four times itself, but evasion is three.
 */
export function aimFactor(stage: number): [number, number] {
  const clamped = Math.max(-6, Math.min(6, stage));
  return clamped >= 0 ? [3 + clamped, 3] : [3, 3 - clamped];
}

/**
 * Everything a creature's abilities say about one question.
 *
 * The battle never asks "what does Adaptability do"; it asks "does anything
 * change the same-type bonus" and takes what comes back. That is what keeps
 * the ability list open — a new entry that answers an existing question needs
 * no change here at all — and it is why the effects are shapes rather than
 * callbacks. A closed set of questions is a battle whose behaviour can still
 * be read off one file.
 */
/**
 * Everything about this creature that answers one question.
 *
 * Its abilities *and* what it is holding, folded into one list, because a held
 * item is an ability you can take off — see the header of carry.ts. This one
 * function is why sixty-odd held items cost the battle about a dozen new
 * questions instead of sixty: a Charcoal is `power` with a type on it, a Scope
 * Lens is `luck`, an Assault Vest is `stat`, and every one of those questions
 * was already being asked here.
 *
 * Abilities first, deliberately. Where two answers to one question compound
 * they compound in a fixed order, so a Choice Band on something with Huge
 * Power lands the same way on every machine.
 */
function effects<K extends AbilityEffect["t"]>(
  creature: Individual,
  kind: K,
): Extract<AbilityEffect, { t: K }>[] {
  const mine = abilitiesOf(creature.abilities).map((spec) => spec.effect);
  const carried = heldEffects(creature.heldItem);
  return [...mine, ...carried].filter(
    (effect): effect is Extract<AbilityEffect, { t: K }> =>
      // A Thick Club does nothing unless a Cubone is holding it, and that is
      // a whole family of items rather than one. Filtered here so no caller
      // has to remember to ask.
      effect.t === kind && effectApplies(effect, creature.speciesId),
  );
}

/** What it is holding, if that is what answered. For the log to name it. */
function whichItem(creature: Individual, kind: AbilityEffect["t"]): string | null {
  return heldEffects(creature.heldItem).some((effect) => effect.t === kind)
    ? creature.heldItem
    : null;
}

/** Whether a creature carries any ability answering this question. */
function has(creature: Individual, kind: AbilityEffect["t"]): boolean {
  return effects(creature, kind).length > 0;
}

/** The ability id behind a shape, for the log to name it. */
function whichAbility(creature: Individual, kind: AbilityEffect["t"]): string | null {
  return abilitiesOf(creature.abilities).find((spec) => spec.effect.t === kind)?.id ?? null;
}

/**
 * Notes that a held item did something, and spends it if it is the spending
 * kind.
 *
 * One place, so "the log said so" and "it is gone" cannot come apart — which
 * is the specific way a consumable goes wrong: a berry that logs and stays, or
 * one that vanishes silently. Nothing has to carry the news out of the battle,
 * because the party *is* `sides[0].team`.
 */
function usedItem(turn: Turn, side: SideIndex, kind: AbilityEffect["t"]): void {
  const creature = active(turn, side);
  const itemId = whichItem(creature, kind);
  if (!itemId) return;

  const spent = isConsumedOnUse(itemId);
  if (spent) setActive(turn, side, { ...active(turn, side), heldItem: null });
  turn.events.push({ t: "item", side, itemId, spent });
}

/**
 * The defender's types as *this* attacker sees them.
 *
 * One place, because two callers want it: the immunity check and the damage
 * multiplier, which have to agree or a move announces that it cannot touch
 * something and then touches it. Scrappy is applied by pretending the target
 * has no Ghost in it, which is exactly what the ability says.
 */
function typesAgainst(
  attacker: Individual,
  defender: Individual,
  move: MoveEntry,
  /** What is true of the defender's appearance: a Soak, a Foresight. */
  defending: Volatiles = {},
): readonly string[] {
  const reaching =
    has(attacker, "reach") && (move.type === "normal" || move.type === "fighting");
  // Foresight is Scrappy for one battle, and Miracle Eye is the same thing
  // said about Dark: the immunity is taken out of the defender before the
  // chart is consulted.
  const seen =
    (defending.seen === "ghost" && (move.type === "normal" || move.type === "fighting")) ||
    (defending.seen === "dark" && move.type === "psychic");
  const types = defending.types ?? speciesById(defender.speciesId).types;
  if (reaching || seen) {
    const through = defending.seen === "dark" && seen ? "dark" : "ghost";
    return types.filter((type) => type !== through);
  }
  return types;
}

/**
 * What types a creature is right now.
 *
 * Its species' unless a move said otherwise, and every question about a type
 * in a battle is asked here — the chart, the same-type bonus, a status
 * immunity, a seed, a Prankster, a Black Sludge — so a Soak cannot be true
 * in one place and not another.
 */
function typesOf(turn: Turn, side: SideIndex): readonly string[] {
  return volatiles(turn, side).types ?? speciesById(active(turn, side).speciesId).types;
}

/**
 * Whether it is standing on the ground, which is what every terrain asks.
 *
 * Flying, Levitate and Magnet Rise are the three ways off it, and the
 * deferred list was right that they had to be asked in one place: a terrain
 * that reached a Flying type but not a Levitate would be a terrain nobody
 * could reason about.
 */
function grounded(turn: Turn, side: SideIndex): boolean {
  if (typesOf(turn, side).includes("flying")) return false;
  if ((volatiles(turn, side).afloat ?? 0) > 0) return false;
  return !effects(active(turn, side), "immune").some((effect) => effect.type === "ground");
}

// ------------------------------------------------------------------ the field

/**
 * The weather, or null when there is none or nobody can feel it.
 *
 * Cloud Nine and Air Lock do not end the weather; they stop it mattering
 * while their owner stands there, and it resumes when they leave. Asked
 * through here so every reader — damage, speed, residuals, accuracy, the
 * heals — agrees about whether it is raining.
 */
function weatherNow(turn: Turn): WeatherId | null {
  const weather = turn.battle.field?.weather?.id ?? null;
  if (!weather) return null;
  for (const side of [0, 1] as SideIndex[]) {
    if (!isFainted(active(turn, side)) && has(active(turn, side), "calm")) return null;
  }
  return weather;
}

function terrainNow(turn: Turn): TerrainId | null {
  return turn.battle.field?.terrain?.id ?? null;
}

function sportNow(turn: Turn): SportId | null {
  return turn.battle.field?.sport?.id ?? null;
}

function setField(turn: Turn, next: Field): void {
  const live: Field = {};
  if (next.weather) live.weather = next.weather;
  if (next.terrain) live.terrain = next.terrain;
  if (next.sport) live.sport = next.sport;
  turn.battle.field = Object.keys(live).length ? live : undefined;
}

/** Puts up one of the three, or refuses because it is already up. */
function raiseField(turn: Turn, kind: "weather" | "terrain" | "sport", id: string): boolean {
  const field = turn.battle.field ?? {};
  if (field[kind]?.id === id) return false;
  setField(turn, { ...field, [kind]: { id, turns: FIELD_TURNS } });
  turn.events.push({ t: "field", kind, id, over: false });
  return true;
}

/** A turn off each of the three, and the expired ones gone, out loud. */
function ageField(turn: Turn): void {
  const field = turn.battle.field;
  if (!field) return;
  const next: Field = { ...field };
  for (const kind of ["weather", "terrain", "sport"] as const) {
    const held = field[kind];
    if (!held) continue;
    if (held.turns > 1) {
      next[kind] = { ...held, turns: held.turns - 1 } as never;
    } else {
      delete next[kind];
      turn.events.push({ t: "field", kind, id: held.id, over: true });
    }
  }
  setField(turn, next);
}

/**
 * What the field does to a stat, in per-mille: sand's Rock and snow's Ice,
 * and the abilities that read the weather or the terrain for a number.
 */
function fieldStatMille(turn: Turn, side: SideIndex, stat: StageStat): number {
  let mille = 1000;
  const weather = weatherNow(turn);
  const terrain = terrainNow(turn);
  const creature = active(turn, side);
  if (weather === "sand" && stat === "spd" && typesOf(turn, side).includes("rock")) mille = 1500;
  if (weather === "snow" && stat === "def" && typesOf(turn, side).includes("ice")) mille = 1500;
  for (const effect of effects(creature, "weatherStat")) {
    if (effect.stat === stat && weather && effect.weather.includes(weather)) mille = Math.floor((mille * effect.mille) / 1000);
  }
  for (const effect of effects(creature, "terrainStat")) {
    if (effect.stat === stat && terrain === effect.terrain && grounded(turn, side)) mille = Math.floor((mille * effect.mille) / 1000);
  }
  return mille;
}

/**
 * Sand and hail biting, the abilities that drink the weather, and Grassy
 * Terrain's mending. After the burn and the poison, before the seeds.
 */
function weatherResidual(turn: Turn, side: SideIndex): void {
  if (isFainted(active(turn, side))) return;
  const weather = weatherNow(turn);
  const creature = active(turn, side);

  if (weather === "sand" || weather === "hail") {
    const immune = weather === "sand" ? SAND_PROOF : HAIL_PROOF;
    if (!typesOf(turn, side).some((type) => immune.includes(type))) {
      const bite = applyDamage(turn, side, Math.max(1, Math.floor(maxHp(creature) / FIELD_SHARE)));
      if (bite > 0) turn.events.push({ t: "weathered", side, weather, amount: bite });
    }
  }
  if (isFainted(active(turn, side))) return;

  for (const effect of effects(creature, "weatherMend")) {
    if (!weather || !effect.weather.includes(weather)) continue;
    const mended = applyHeal(turn, side, Math.max(1, Math.floor(maxHp(creature) / effect.share)));
    if (mended > 0) {
      const named = whichAbility(creature, "weatherMend");
      if (named) turn.events.push({ t: "ability", side, abilityId: named });
      turn.events.push({ t: "heal", side, amount: mended });
    }
  }

  if (terrainNow(turn) === "grassy" && grounded(turn, side)) {
    const mended = applyHeal(turn, side, Math.max(1, Math.floor(maxHp(creature) / FIELD_SHARE)));
    if (mended > 0) turn.events.push({ t: "heal", side, amount: mended });
  }

  for (const effect of effects(creature, "weatherCure")) {
    const now = active(turn, side);
    if (!weather || !effect.weather.includes(weather) || !now.status) continue;
    setActive(turn, side, { ...now, status: null, sleepTurns: 0 });
    const named = whichAbility(creature, "weatherCure");
    if (named) turn.events.push({ t: "ability", side, abilityId: named });
    turn.events.push({ t: "volatile", side, which: "snapped" });
  }
}

/**
 * The ability that drinks this move rather than taking it, or null.
 *
 * Absorb and Levitate. Asked before the type chart, because an ability that
 * grants an immunity the chart does not have is the whole point of it.
 */
function drinker(defender: Individual, move: MoveEntry) {
  if (move.category === "status" || move.id === STRUGGLE) return null;
  return (
    abilitiesOf(defender.abilities).find(
      (spec) =>
        (spec.effect.t === "absorb" || spec.effect.t === "immune") &&
        spec.effect.type === move.type,
    ) ?? null
  );
}

/**
 * How a move lands on what is actually standing there, in quarters.
 *
 * Exported because the move buttons draw an arrow from it, and the type chart
 * alone cannot answer the question. Two things sit either side of it: Scrappy,
 * which takes the Ghost out of the defender before the chart is consulted, and
 * the absorb-and-immune abilities, which stop a move the chart has nothing to
 * say about — a Levitate is not a Flying type. A button asking
 * `effectiveness` directly would cross out a Scrappy's Tackle against a Gengar
 * and promise full damage from an Earthquake into a Levitate, which is the UI
 * holding a second opinion about a question the engine already answers.
 *
 * Null when the chart does not apply. A status move has no multiplier, and
 * Struggle is outside the chart by design so that a creature out of moves
 * always has a way to end the fight.
 */
export function landsAs(
  attacker: Individual,
  defender: Individual,
  moveId: string,
  /**
   * What is true of the defender's appearance. Magnet Rise is the one thing
   * here that is neither a type nor an ability, and a button that did not
   * know about it would promise an Earthquake into something floating.
   */
  defending: Volatiles = {},
): number | null {
  const move = moveById(moveId);
  if (move.category === "status" || move.id === STRUGGLE) return null;
  if (drinker(defender, move)) return 0;
  if (move.type === "ground" && (defending.afloat ?? 0) > 0) return 0;
  return effectiveness(move.type, typesAgainst(attacker, defender, move, defending));
}

/** Multiplying by per-mille, kept in integers like everything else. */
function scaled(value: number, mille: number): number {
  return Math.floor((value * mille) / 1000);
}

/**
 * Whether a status will take at all.
 *
 * One predicate, and every road to a status goes down it: a move's own status,
 * a secondary effect, and anything added later. An immunity that only covered
 * the direct case would be an immunity that quietly fails against the very
 * moves people carry it for.
 */
function statusSticks(target: Individual, status: StatusId): boolean {
  return !effects(target, "ignore").some((effect) => effect.status === status);
}

/** One in this many, by the move's crit ratio. */
const CRIT_ODDS = [24, 8, 2, 1];

/**
 * How many times this move lands.
 *
 * The manifest says either a fixed number — Double Kick twice, Surging
 * Strikes three times, Population Bomb ten — or a range, which in practice is
 * always two to five, and the two are the same field so this reads one shape.
 *
 * The range is not uniform, and the shape of it is the whole character of the
 * move: **three eighths two, three eighths three, one eighth four, one eighth
 * five**. That is the classic distribution, and eighths are used rather than
 * the later games' 35/35/15/15 for one reason worth stating — eighths divide
 * exactly into a single roll of eight, and this codebase does not have a
 * rounding step to spare. It averages three hits and a bit, so Fury Swipes at
 * 18 power is a little over 54, which is where a move of that shape should
 * sit.
 *
 * The roll is named like every other, so a battle stays a pure function of its
 * seed. A wider range than two-to-five would need more of the die; nothing in
 * the manifest has one, and a move that did would fall back to its floor
 * rather than silently mis-rolling.
 */
function hitsOf(turn: Turn, side: SideIndex, move: MoveEntry): number {
  const range = move.multihit;
  if (!range) return 1;

  const [least, most] = range;
  if (most <= least) return Math.max(1, least);
  if (most - least !== 3) return Math.max(1, least);

  const die = intBelow(
    rngFor(turn.battle.seed, turn.battle.tag, turn.battle.turn, `${side}-hits`),
    8,
  );
  return least + (die < 3 ? 0 : die < 6 ? 1 : die < 7 ? 2 : 3);
}

/** Types that simply cannot catch a given condition. */
const STATUS_IMMUNE: Record<StatusId, string[]> = {
  brn: ["fire"],
  frz: ["ice"],
  par: ["electric"],
  psn: ["poison", "steel"],
  slp: [],
};

/**
 * The manifest's word for a condition, as one of the five this game has.
 *
 * There are five status conditions here and the manifest knows six: Toxic
 * carries `tox`, which is poison that gets worse every turn. That mechanic does
 * not exist in this engine, so Toxic lands as ordinary poison — the same
 * immunities, the same damage, without the escalation.
 *
 * It is a *normaliser* rather than a special case in one caller, and the table
 * lookup below falls back rather than indexing blind, because the alternative
 * is what happened: `STATUS_IMMUNE["tox"]` is `undefined`, `.includes` on it
 * throws, and the throw comes back as "illegal input" from a move that is
 * perfectly legal. TypeScript could not see it — the field is typed `StatusId`
 * and the manifest is cast to that shape on the way in, so a value outside the
 * union type-checks all the way to the crash.
 *
 * It survived this long because nothing ever used Toxic. The people on the
 * routes draw their moves from the route's own table; the rival draws his from
 * the whole dex, and found it inside a hundred battles.
 */
export function conditionOf(status: string): StatusId | null {
  switch (status) {
    case "tox":
      return "psn";
    case "brn":
    case "frz":
    case "par":
    case "psn":
    case "slp":
      return status;
    default:
      return null;
  }
}

export function startBattle(
  seed: string,
  tag: string,
  ours: readonly Individual[],
  theirs: readonly Individual[],
  ourActive = 0,
): BattleState {
  return {
    seed,
    tag,
    turn: 0,
    sides: [
      { team: ours.map((creature) => ({ ...creature })), active: ourActive, stages: { ...NO_STAGES }, locked: null },
      { team: theirs.map((creature) => ({ ...creature })), active: 0, stages: { ...NO_STAGES }, locked: null },
    ],
    awaitingSwitch: [false, false],
    // Whoever we lead with has taken part in whatever is standing opposite.
    sharing: [ourActive],
    outcome: null,
    events: [],
  };
}

export function maxHp(individual: Individual): number {
  return computeStats(speciesById(individual.speciesId), individual).hp;
}

export function isFainted(individual: Individual): boolean {
  return individual.hp <= 0;
}

export function activeOf(state: BattleState, side: SideIndex): Individual {
  const combatant = state.sides[side];
  return combatant.team[combatant.active];
}

/**
 * Stage multipliers as a fraction, never a float.
 *
 * Exported for the stat sheet's Mod column, which shows the same fraction
 * beside the number it multiplies. The sheet must not have a ladder of its
 * own to disagree with this one.
 */
export function stageFactor(stage: number): [number, number] {
  const clamped = Math.max(-6, Math.min(6, stage));
  return clamped >= 0 ? [2 + clamped, 2] : [2, 2 - clamped];
}

function effectiveStat(
  individual: Individual,
  stat: StageStat,
  stage: number,
  /**
   * Power Split, Guard Split and Speed Swap: a number to use in place of
   * the creature's own. Before the stage, so a split Attack is still raised
   * by a Swords Dance — the split rewrote the base, not the ladder.
   */
  override?: Partial<Record<StageStat, number>>,
): number {
  const base = override?.[stat] ?? computeStats(speciesById(individual.speciesId), individual)[stat];
  const [numerator, denominator] = stageFactor(stage);
  let value = Math.floor((base * numerator) / denominator);
  if (stat === "spe" && individual.status === "par") value = Math.floor(value / 2);

  // Huge Power, Hustle, Guts, Marvel Scale, Quick Feet, Defeatist. Applied
  // after the stage and after paralysis, so a creature with Quick Feet that is
  // paralysed ends up faster than one that is merely paralysed — which is what
  // carrying it is for.
  for (const effect of effects(individual, "stat")) {
    const applies =
      effect.when === "always" ||
      (effect.when === "statused" && individual.status !== null) ||
      (effect.when === "hurt" && individual.hp * 2 <= maxHp(individual)) ||
      // Eviolite. "Fully evolved" is not a flag in the bestiary, it is the
      // absence of any door at all, so the question is asked of the data.
      (effect.when === "unfinished" && canStillEvolve(individual));
    if (!applies) continue;

    const named = effect.stat === "offence" ? stat === "atk" || stat === "spa" : effect.stat === stat;
    if (named) value = scaled(value, effect.mille);
  }

  return Math.max(1, value);
}

// --------------------------------------------------------------- turn context

/**
 * Working state for one turn. Copied in at the top of resolveTurn and handed
 * back out, so callers never see a half-resolved battle and nothing outside
 * this module is ever mutated.
 */
interface Turn {
  battle: BattleState;
  events: BattleEvent[];
  /**
   * What this battle allows.
   *
   * On the turn because two moves need it: Roar drives a *wild* creature off
   * for good and merely replaces a trainer's, and Teleport is an escape out of
   * the grass and a free switch against a person. Neither can be written
   * without knowing which kind of battle it is in.
   */
  rules: BattleRules;
  /** Which side moves second this turn, once that is known. Analytic asks. */
  movingLast?: SideIndex;
  /**
   * Move damage each side has taken this turn, by category.
   *
   * The counter family reads it, and only *move* damage counts: recoil and
   * poison are not something there is anybody to retaliate against. Held on
   * the turn rather than on the creature because it is answered within the
   * turn and forgotten after it.
   */
  taken: [{ physical: number; special: number }, { physical: number; special: number }];
  /**
   * Whether each side's move actually connected this turn.
   *
   * Indexed by *attacker*, and set by `landDamage` — so it is true for a blow
   * that landed for one point and false for a miss, an immunity, a shield or
   * a fizzle. `afterMove` is the only reader, and it needs the distinction for
   * four separate things: a Rollout that misses loses its run, a U-turn that
   * misses does not leave, a Dragon Tail that misses drives nobody out, and a
   * Hyper Beam that misses still has to recharge.
   */
  connected: [boolean, boolean];
  /**
   * The move each side actually got off this turn, if any.
   *
   * Not the same question as `Combatant.lastMove`, which remembers across
   * turns and is what Sketch copies. `afterMove` needs "what happened *this*
   * turn", and reading `lastMove` for it was wrong in a way that took a test
   * to find: a creature spending its turn recharging never sets `lastMove`,
   * so the beam it used the turn before was still sitting there — and
   * `afterMove` dutifully set the recharge again, every turn, forever.
   *
   * Written where the `use` event is, at whatever depth, so a Metronome that
   * landed on Hyper Beam recharges: the creature used the beam, whatever it
   * meant to use.
   */
  used: [string | null, string | null];
  /**
   * Which side is catching something on its way out with Pursuit.
   *
   * Set by `resolveTurn` before either move resolves, because it is the one
   * fact a move needs that only the turn knows: what the *other* side chose.
   */
  pursuing?: SideIndex;
}

function active(turn: Turn, side: SideIndex): Individual {
  return activeOf(turn.battle, side);
}

function setActive(turn: Turn, side: SideIndex, individual: Individual): void {
  const combatant = turn.battle.sides[side];
  combatant.team = combatant.team.map((member, index) => (index === combatant.active ? individual : member));
}

function roll(turn: Turn, tag: string): number {
  return rngFor(turn.battle.seed, turn.battle.tag, turn.battle.turn, tag)();
}

function chance(turn: Turn, tag: string, percent: number): boolean {
  return Math.floor(roll(turn, tag) * 100) < percent;
}

function other(side: SideIndex): SideIndex {
  return side === 0 ? 1 : 0;
}

/**
 * How fast a side is right now, Tailwind included.
 *
 * Three places asked for speed and all three had the stage read written out
 * by hand: who moves first, how well running works, and the two moves that
 * divide one speed by the other. Tailwind has to be in all three or it is a
 * move that helps you strike first and not escape, which is not what it says.
 */
function speedOf(turn: Turn, side: SideIndex): number {
  const base = scaled(
    effectiveStat(active(turn, side), "spe", turn.battle.sides[side].stages.spe, volatiles(turn, side).stats),
    fieldStatMille(turn, side, "spe"),
  );
  return screened(turn, side, "tailwind") ? base * 2 : base;
}

// --------------------------------------------------------------- mechanics

/**
 * A blow landing, with everything that hangs off it.
 *
 * Sturdy, the damage event, the tally the counter family reads, and Moxie —
 * four things that used to sit inline in one branch and now have to serve
 * three (a move with power, a move that states a number, and a move whose
 * power was computed). One place, so the three cannot drift.
 */
function landDamage(
  turn: Turn,
  side: SideIndex,
  move: MoveEntry,
  wanted: number,
  quarters: number,
  crit: boolean,
): number {
  const defender = active(turn, other(side));
  const attacker = active(turn, side);

  // Sturdy: from full health, one hit never finishes it. Trimmed here rather
  // than in the damage formula, because it is about the blow landing rather
  // than about how hard it was.
  let amount = wanted;
  if (amount >= defender.hp) {
    // Sturdy and a Focus Sash want full health and always work; a Focus Band
    // wants neither and sometimes does. One loop, because the difference
    // between them is two fields rather than two mechanics.
    const saving = effects(defender, "endure").find((effect) => {
      const whole = effect.whole !== false;
      if (whole && defender.hp < maxHp(defender)) return false;
      return effect.mille === undefined || roll(turn, `${side}-brace`) * 1000 < effect.mille;
    });

    // Endure the move, folded into the same branch as Sturdy and a Focus
    // Sash: three ways to ask for the same thing, and one place that grants
    // it, so they cannot come to disagree about what "survive at one" means.
    if (volatiles(turn, other(side)).shield === "endure") {
      amount = Math.max(0, defender.hp - 1);
      turn.events.push({ t: "volatile", side: other(side), which: "endure" });
    } else if (saving) {
      amount = Math.max(0, defender.hp - 1);
      const named = whichAbility(defender, "endure");
      if (named) turn.events.push({ t: "ability", side: other(side), abilityId: named });
      // A Focus Sash is spent doing it, which is the whole difference between
      // it and Sturdy.
      usedItem(turn, other(side), "endure");
    }
  }

  const dealt = applyDamage(turn, other(side), amount);
  turn.events.push({ t: "damage", side: other(side), amount: dealt, quarters, crit });

  // Destiny Bond: the blow that finished it finishes whoever threw it. Only
  // here, because only a *move* can be bonded to — a poison has nobody
  // standing behind it. Taken off as it fires, so a second blow of a
  // multi-strike cannot collect twice.
  if (
    isFainted(active(turn, other(side))) &&
    volatiles(turn, other(side)).bonded &&
    !isFainted(active(turn, side))
  ) {
    mergeVolatiles(turn, other(side), { bonded: undefined });
    applyDamage(turn, side, active(turn, side).hp);
    turn.events.push({ t: "volatile", side, which: "avenged" });
  }

  // The resist berry that took the edge off this one, spent now the blow is
  // known to have landed.
  if (quarters > 4) {
    for (const effect of effects(defender, "soften")) {
      if (effect.types.includes(move.type)) usedItem(turn, other(side), "soften");
    }
  }

  // Shell Bell: a share of what it just dealt, back. Read off `dealt` rather
  // than off `wanted`, so a blow that was trimmed by Sturdy or clamped by the
  // target's remaining health heals what actually landed.
  for (const effect of effects(attacker, "siphon")) {
    const back = Math.max(1, Math.floor(dealt / effect.share));
    const room = maxHp(attacker) - active(turn, side).hp;
    if (room <= 0 || dealt <= 0) continue;
    setActive(turn, side, { ...active(turn, side), hp: active(turn, side).hp + Math.min(room, back) });
    usedItem(turn, side, "siphon");
  }

  // Jaboca and Rowap: the attacker pays for having swung. By category rather
  // than by contact, because the manifest carries no contact flag — see the
  // shape's own comment.
  if (dealt > 0) {
    for (const effect of effects(active(turn, other(side)), "barb")) {
      if (effect.category !== move.category) continue;
      const bite = Math.max(1, Math.floor(maxHp(attacker) / effect.share));
      applyDamage(turn, side, bite);
      turn.events.push({ t: "recoil", side, amount: bite });
      usedItem(turn, other(side), "barb");
    }
  }

  // Weakness Policy: hit where it hurts and it hits back harder.
  if (quarters > 4 && dealt > 0 && !isFainted(active(turn, other(side)))) {
    for (const effect of effects(active(turn, other(side)), "policy")) {
      const boosts: Boosts = {};
      for (const stat of effect.stats) boosts[stat] = effect.delta;
      applyBoosts(turn, other(side), boosts);
      usedItem(turn, other(side), "policy");
    }

    // The Enigma Berry, which is the one thing in the bag that is paid for
    // being hit rather than for hitting.
    for (const effect of effects(active(turn, other(side)), "solace")) {
      const hurt = active(turn, other(side));
      const back = Math.max(1, Math.floor(maxHp(hurt) / effect.share));
      const room = maxHp(hurt) - hurt.hp;
      if (room <= 0) continue;
      setActive(turn, other(side), { ...hurt, hp: hurt.hp + Math.min(room, back) });
      turn.events.push({ t: "heal", side: other(side), amount: Math.min(room, back) });
      usedItem(turn, other(side), "solace");
    }
  }

  // Kee and Maranga: a stage for having been hit that way.
  if (dealt > 0 && !isFainted(active(turn, other(side)))) {
    for (const effect of effects(active(turn, other(side)), "brace")) {
      if (effect.category !== move.category) continue;
      const boosts: Boosts = {};
      for (const stat of effect.stats) boosts[stat] = effect.delta;
      applyBoosts(turn, other(side), boosts);
      usedItem(turn, other(side), "brace");
    }
  }

  // What the counter family answers. Only move damage, and only this turn.
  if (move.category === "physical") turn.taken[other(side)].physical += dealt;
  else turn.taken[other(side)].special += dealt;

  // Moxie: the spoils of a knockout.
  if (isFainted(active(turn, other(side)))) {
    for (const effect of effects(attacker, "spoils")) {
      applyBoosts(turn, side, { [effect.stat]: effect.delta });
      const named = whichAbility(attacker, "spoils");
      if (named) turn.events.push({ t: "ability", side, abilityId: named });
    }
  }

  return dealt;
}

function applyDamage(turn: Turn, side: SideIndex, amount: number): number {
  const target = active(turn, side);
  const dealt = Math.max(0, Math.min(target.hp, amount));
  setActive(turn, side, { ...target, hp: target.hp - dealt });
  return dealt;
}

function applyHeal(turn: Turn, side: SideIndex, amount: number): number {
  const target = active(turn, side);
  const healed = Math.max(0, Math.min(maxHp(target) - target.hp, amount));
  if (healed > 0) setActive(turn, side, { ...target, hp: target.hp + healed });
  return healed;
}

function applyStatus(turn: Turn, side: SideIndex, status: StatusId, tag: string): boolean {
  // Safeguard, which is the one thing that answers every condition at once.
  // Here rather than at each call site for the same reason the type immunity
  // is: every road to a status goes down this predicate.
  if (screened(turn, side, "safeguard")) {
    turn.events.push({ t: "screen", side, which: "safeguard" });
    return false;
  }
  const target = active(turn, side);
  if (target.status || isFainted(target)) return false;

  // Misty Terrain refuses every condition on the ground, Electric Terrain
  // refuses sleep there, and Leaf Guard refuses everything in the sun. Here,
  // with the rest, so a Yawn coming due meets the same answer a Spore does.
  const terrain = terrainNow(turn);
  if (terrain === "misty" && grounded(turn, side)) return false;
  if (terrain === "electric" && status === "slp" && grounded(turn, side)) return false;
  const weather = weatherNow(turn);
  if (weather && effects(target, "weatherGuard").some((effect) => effect.weather.includes(weather))) {
    const named = whichAbility(target, "weatherGuard");
    if (named) turn.events.push({ t: "ability", side, abilityId: named });
    return false;
  }

  const immune = STATUS_IMMUNE[status] ?? [];
  if (typesOf(turn, side).some((type) => immune.includes(type))) return false;

  // Immunity, Limber, Water Veil, Insomnia, Magma Armor. Checked here so that
  // every road to a status goes through it — a move's own, a secondary, and
  // anything added later.
  if (!statusSticks(target, status)) {
    const named = abilitiesOf(target.abilities).find(
      (spec) => spec.effect.t === "ignore" && spec.effect.status === status,
    );
    if (named) turn.events.push({ t: "ability", side, abilityId: named.id });
    return false;
  }

  const sleepTurns = status === "slp" ? 1 + intBelow(rngFor(turn.battle.seed, turn.battle.tag, turn.battle.turn, tag, "slp"), 3) : 0;
  setActive(turn, side, { ...target, status, sleepTurns });
  turn.events.push({ t: "status", side, status });
  return true;
}

/**
 * A stage change, from anybody.
 *
 * `byOther` says whether somebody else did this, because that is the whole of
 * what Clear Body and Hyper Cutter protect against: a creature lowering its
 * own Defence to raise its Attack is its own business.
 */
function applyBoosts(turn: Turn, side: SideIndex, boosts: Boosts, byOther = false): void {
  const target = active(turn, side);
  const held = new Set(effects(target, "hold").flatMap((effect) => effect.stats));

  // Mist: nothing the other side does lowers a stage. Its own boosts still
  // work, which is what separates a mist from a Clear Body.
  if (byOther && Object.values(boosts).some((delta) => (delta ?? 0) < 0) && screened(turn, side, "mist")) {
    turn.events.push({ t: "screen", side, which: "mist" });
    return;
  }

  const stages = { ...turn.battle.sides[side].stages };
  for (const stat of Object.keys(boosts) as StageStat[]) {
    const delta = boosts[stat] ?? 0;
    if (byOther && delta < 0 && held.has(stat)) {
      const named = whichAbility(target, "hold");
      if (named) turn.events.push({ t: "ability", side, abilityId: named });
      continue;
    }
    const next = Math.max(-6, Math.min(6, stages[stat] + delta));
    if (next === stages[stat]) continue;
    stages[stat] = next;
    turn.events.push({ t: "boost", side, stat, delta });
  }
  turn.battle.sides[side].stages = stages;
}

/**
 * Everything a variable-damage move might read, gathered up.
 *
 * moves.ts is handed this rather than reaching for it: that module must not
 * import battle.ts — battle.ts imports it — and a cycle between the two would
 * be a build problem for no gain. So the one place that knows about stages and
 * maximum health fills in the form.
 */

/* ------------------------------------------------------------------ volatiles
 *
 * Accessors and one interpreter, so nothing else in this file has to think
 * about the fields being optional. Absent-rather-than-zero is what keeps a
 * battle with none of this in it hashing the way it did before any of it
 * existed, and that property is worth a little plumbing.
 */

function volatiles(turn: Turn, side: SideIndex): Volatiles {
  return turn.battle.sides[side].volatiles ?? {};
}

function setVolatiles(turn: Turn, side: SideIndex, next: Volatiles): void {
  // Dropped entirely when there is nothing in it, so an empty record and a
  // missing one are never both reachable for the same state.
  const live = Object.fromEntries(
    Object.entries(next).filter(
      ([, value]) => value !== undefined && value !== 0 && value !== false,
    ),
  ) as Volatiles;
  turn.battle.sides[side].volatiles = Object.keys(live).length ? live : undefined;
}

function mergeVolatiles(turn: Turn, side: SideIndex, patch: Volatiles): void {
  setVolatiles(turn, side, { ...volatiles(turn, side), ...patch });
}

function aimOf(turn: Turn, side: SideIndex): AimStages {
  return turn.battle.sides[side].aim ?? NO_AIM;
}

/** Whether a side is under a given screen. */
function screened(turn: Turn, side: SideIndex, id: SideConditionId): boolean {
  return (turn.battle.sides[side].screens?.[id] ?? 0) > 0;
}

function raiseScreen(turn: Turn, side: SideIndex, id: SideConditionId, turns: number): boolean {
  const screens = { ...(turn.battle.sides[side].screens ?? {}) };
  if ((screens[id] ?? 0) > 0) return false;
  screens[id] = turns;
  turn.battle.sides[side].screens = screens;
  return true;
}

/**
 * A turn off every screen, and the expired ones gone.
 *
 * Deleted rather than left at nought for the same reason volatiles are: one
 * representation per state, so the hash cannot see a difference the rules
 * cannot.
 */
function ageScreens(turn: Turn, side: SideIndex): void {
  const held = turn.battle.sides[side].screens;
  if (!held) return;

  const next: Partial<Record<SideConditionId, number>> = {};
  for (const [id, left] of Object.entries(held) as [SideConditionId, number][]) {
    if (left > 1) next[id] = left - 1;
  }
  turn.battle.sides[side].screens = Object.keys(next).length ? next : undefined;
}

/**
 * Whether the move about to land is stopped by something the target did.
 *
 * Protect and its family. Endure is *not* handled here — it does not stop the
 * move, it survives it, which happens down in `landDamage`.
 */
function behindShield(turn: Turn, side: SideIndex): boolean {
  return volatiles(turn, side).shield === "protect";
}

/**
 * Confusion, which is the one condition that costs a turn without being a
 * status.
 *
 * Asked by `canAct` after sleep and paralysis rather than before: a creature
 * that is asleep is not awake enough to be confused, and the games agree.
 */
function confusionStops(turn: Turn, side: SideIndex): boolean {
  const state = volatiles(turn, side);
  const left = state.confusion ?? 0;
  if (left <= 0) return false;

  if (left <= 1) {
    mergeVolatiles(turn, side, { confusion: undefined });
    turn.events.push({ t: "volatile", side, which: "snapped" });
    return false;
  }
  mergeVolatiles(turn, side, { confusion: left - 1 });

  if (!chance(turn, `${side}-confuse`, CONFUSED_CHANCE)) return false;

  // Into itself, with its own Attack against its own Defence and no type at
  // all. Through `applyDamage` so a Focus Sash still answers.
  const creature = active(turn, side);
  const attack = effectiveStat(creature, "atk", turn.battle.sides[side].stages.atk, state.stats);
  const defence = effectiveStat(creature, "def", turn.battle.sides[side].stages.def, state.stats);
  let value = Math.floor((2 * creature.level) / 5) + 2;
  value = Math.floor((value * CONFUSED_POWER * attack) / Math.max(1, defence));
  value = Math.floor(value / 50) + 2;

  const taken = applyDamage(turn, side, Math.max(1, value));
  turn.events.push({ t: "volatile", side, which: "selfhit" });
  if (taken > 0) turn.events.push({ t: "recoil", side, amount: taken });
  return true;
}

/**
 * One effect, applied.
 *
 * The whole interpreter for `statusmoves.ts`. `side` is whoever used the move;
 * every effect decides for itself which side it lands on, because half of them
 * are about the user and half about the target and a single "target" argument
 * would be wrong for one of the two.
 *
 * Returns whether anything actually happened, so a move that finds nothing to
 * do can say `fizzled` rather than claim a hit.
 */
function applyMoveEffect(turn: Turn, side: SideIndex, effect: MoveEffect): boolean {
  const foe = other(side);

  switch (effect.t) {
    case "seed": {
      // A Grass type cannot be seeded, which is the one immunity this move has
      // and the reason it is not simply another status.
      if (typesOf(turn, foe).includes("grass")) return false;
      if (volatiles(turn, foe).seeded) return false;
      mergeVolatiles(turn, foe, { seeded: true });
      turn.events.push({ t: "volatile", side: foe, which: "seeded" });
      return true;
    }

    case "confuse":
      return confuseSide(turn, foe);

    case "nightmare": {
      const target = active(turn, foe);
      // Only bites while it sleeps, so it fails outright on anything awake
      // rather than sitting there waiting to become relevant.
      if (target.status !== "slp") return false;
      if (volatiles(turn, foe).nightmare) return false;
      mergeVolatiles(turn, foe, { nightmare: true });
      turn.events.push({ t: "volatile", side: foe, which: "nightmare" });
      return true;
    }

    case "yawn": {
      const target = active(turn, foe);
      if (target.status || (volatiles(turn, foe).yawn ?? 0) > 0) return false;
      if (screened(turn, foe, "safeguard")) {
        turn.events.push({ t: "screen", side: foe, which: "safeguard" });
        return false;
      }
      mergeVolatiles(turn, foe, { yawn: YAWN_TURNS });
      turn.events.push({ t: "volatile", side: foe, which: "drowsy" });
      return true;
    }

    case "perish": {
      // Both sides, which is what makes it a song rather than an attack. It
      // fails only if both are already counting.
      let sang = false;
      for (const at of [side, foe] as SideIndex[]) {
        if ((volatiles(turn, at).perish ?? 0) > 0) continue;
        mergeVolatiles(turn, at, { perish: PERISH_TURNS });
        turn.events.push({ t: "perish", side: at, turns: PERISH_TURNS });
        sang = true;
      }
      return sang;
    }

    case "trap": {
      if (volatiles(turn, foe).trapped) return false;
      mergeVolatiles(turn, foe, { trapped: true });
      turn.events.push({ t: "volatile", side: foe, which: "trapped" });
      return true;
    }

    case "shield": {
      // The streak is the cost. A shield put up on consecutive turns works one
      // time in three, then one in nine, which is what stops it being the
      // answer to everything without making it useless once.
      const streak = volatiles(turn, side).shieldStreak ?? 0;
      const odds = Math.min(100, Math.max(1, Math.floor(100 / 3 ** streak)));
      if (streak > 0 && !chance(turn, `${side}-shield`, odds)) {
        mergeVolatiles(turn, side, { shieldStreak: 0 });
        return false;
      }
      mergeVolatiles(turn, side, {
        shield: effect.endure ? "endure" : "protect",
        shieldStreak: streak + 1,
      });
      turn.events.push({ t: "volatile", side, which: effect.endure ? "endure" : "shield" });
      return true;
    }

    case "crit": {
      const held = volatiles(turn, side).crit ?? 0;
      if (held >= effect.stages) return false;
      mergeVolatiles(turn, side, { crit: effect.stages });
      turn.events.push({ t: "volatile", side, which: "crit" });
      return true;
    }

    case "aim": {
      const at = effect.onSelf ? side : foe;
      if (!effect.onSelf && effect.delta < 0 && screened(turn, at, "mist")) {
        turn.events.push({ t: "screen", side: at, which: "mist" });
        return false;
      }
      const current = aimOf(turn, at);
      const next = Math.max(-6, Math.min(6, current[effect.which] + effect.delta));
      if (next === current[effect.which]) return false;

      const updated: AimStages = { ...current, [effect.which]: next };
      turn.battle.sides[at].aim =
        updated.accuracy === 0 && updated.evasion === 0 ? undefined : updated;
      turn.events.push({ t: "aim", side: at, which: effect.which, delta: effect.delta });
      return true;
    }

    case "heal": {
      const user = active(turn, side);
      if (user.hp >= maxHp(user)) return false;
      let amount = Math.floor(maxHp(user) / effect.share);
      // Two thirds in the sun, a quarter in any other weather, for the three
      // that read the sky; everything in a sandstorm for Shore Up.
      const weather = weatherNow(turn);
      if (effect.weather === "sun" && weather === "sun") amount = Math.floor((maxHp(user) * 2) / 3);
      else if (effect.weather === "sun" && weather) amount = Math.floor(maxHp(user) / 4);
      else if (effect.weather === "sand" && weather === "sand") amount = maxHp(user);
      const mended = applyHeal(turn, side, Math.max(1, amount));
      if (mended > 0) turn.events.push({ t: "heal", side, amount: mended });
      return mended > 0;
    }

    case "weather":
      return raiseField(turn, "weather", effect.id);

    case "terrain":
      return raiseField(turn, "terrain", effect.id);

    case "sport":
      return raiseField(turn, "sport", effect.id);

    case "veil": {
      // Both screens at once, and only while it is hailing or snowing —
      // which is what separates it from using Reflect and Light Screen.
      const weather = weatherNow(turn);
      if (weather !== "hail" && weather !== "snow") return false;
      let raised = false;
      for (const id of ["reflect", "lightscreen"] as SideConditionId[]) {
        if (raiseScreen(turn, side, id, FIELD_TURNS)) {
          turn.events.push({ t: "screen", side, which: id });
          raised = true;
        }
      }
      return raised;
    }

    case "rest": {
      const user = active(turn, side);
      // Refuses at full health with nothing to cure, because sleeping for two
      // turns to gain nothing is a trap rather than a decision.
      if (user.hp >= maxHp(user) && !user.status) return false;
      const mended = maxHp(user) - user.hp;
      setActive(turn, side, { ...user, hp: maxHp(user), status: "slp", sleepTurns: REST_TURNS });
      if (mended > 0) turn.events.push({ t: "heal", side, amount: mended });
      turn.events.push({ t: "status", side, status: "slp" });
      return true;
    }

    case "painSplit": {
      const user = active(turn, side);
      const target = active(turn, foe);
      const between = Math.floor((user.hp + target.hp) / 2);
      if (between === user.hp && between === target.hp) return false;

      // Capped at each side's own maximum, so splitting with something huge
      // cannot overfill the smaller of the two.
      setActive(turn, side, { ...user, hp: Math.min(maxHp(user), between) });
      setActive(turn, foe, { ...target, hp: Math.min(maxHp(target), between) });
      for (const at of [side, foe] as SideIndex[]) {
        const before = at === side ? user : target;
        const now = active(turn, at);
        if (now.hp > before.hp) {
          turn.events.push({ t: "heal", side: at, amount: now.hp - before.hp });
        } else if (now.hp < before.hp) {
          turn.events.push({
            t: "damage",
            side: at,
            amount: before.hp - now.hp,
            quarters: 4,
            crit: false,
          });
        }
      }
      return true;
    }

    case "bellyDrum": {
      const user = active(turn, side);
      const cost = Math.floor(maxHp(user) / 2);
      // Half your health is not a price worth paying for nothing, so it fails
      // rather than kill you for an Attack stage you already have.
      if (user.hp <= cost || turn.battle.sides[side].stages.atk >= 6) return false;
      applyDamage(turn, side, cost);
      turn.events.push({ t: "recoil", side, amount: cost });
      turn.battle.sides[side].stages = { ...turn.battle.sides[side].stages, atk: 6 };
      turn.events.push({ t: "boost", side, stat: "atk", delta: 6 });
      return true;
    }

    case "haze": {
      // Both sides, both ladders. Nothing else in the game undoes a stage.
      let cleared = false;
      for (const at of [0, 1] as SideIndex[]) {
        const combatant = turn.battle.sides[at];
        const stats = ["atk", "def", "spa", "spd", "spe"] as StageStat[];
        if (stats.some((stat) => combatant.stages[stat] !== 0)) {
          combatant.stages = { ...NO_STAGES };
          cleared = true;
        }
        if (combatant.aim) {
          combatant.aim = undefined;
          cleared = true;
        }
      }
      return cleared;
    }

    case "cure": {
      if (effect.who === "self") {
        const user = active(turn, side);
        if (!user.status) return false;
        setActive(turn, side, { ...user, status: null, sleepTurns: 0 });
        turn.events.push({ t: "volatile", side, which: "snapped" });
        return true;
      }
      // The whole team, including the ones in reserve, which is the only
      // reason anybody carries a bell.
      const combatant = turn.battle.sides[side];
      if (!combatant.team.some((one) => one.status)) return false;
      combatant.team = combatant.team.map((one) =>
        one.status ? { ...one, status: null, sleepTurns: 0 } : one,
      );
      turn.events.push({ t: "volatile", side, which: "snapped" });
      return true;
    }

    case "purify": {
      const target = active(turn, foe);
      // Cures *them* and mends you, and only if there was something to cure.
      if (!target.status) return false;
      setActive(turn, foe, { ...target, status: null, sleepTurns: 0 });
      turn.events.push({ t: "volatile", side: foe, which: "snapped" });
      const user = active(turn, side);
      const mended = applyHeal(turn, side, Math.max(1, Math.floor(maxHp(user) / 2)));
      if (mended > 0) turn.events.push({ t: "heal", side, amount: mended });
      return true;
    }

    case "side": {
      if (!raiseScreen(turn, side, effect.id, effect.turns)) return false;
      turn.events.push({ t: "screen", side, which: effect.id });
      return true;
    }

    case "forceOut": {
      // Ingrain: it is planted, and no wind moves it.
      if (volatiles(turn, foe).rooted && volatiles(turn, foe).trapped) return false;
      // A wild creature driven off ends the encounter; a trainer's is replaced.
      if (turn.rules.catchable) {
        turn.battle.outcome = { t: "fled" };
        turn.events.push({ t: "fled" });
        return true;
      }
      const combatant = turn.battle.sides[foe];
      const next = combatant.team.findIndex((one, at) => at !== combatant.active && !isFainted(one));
      if (next < 0) return false;
      switchTo(turn, foe, next);
      return true;
    }

    case "retreat": {
      // Out of a wild battle entirely, which is what Teleport is for. Against
      // a trainer it is a free switch, and it fails with nobody to switch to.
      if (turn.rules.catchable) {
        turn.battle.outcome = { t: "fled" };
        turn.events.push({ t: "fled" });
        return true;
      }
      const combatant = turn.battle.sides[side];
      const next = combatant.team.findIndex((one, at) => at !== combatant.active && !isFainted(one));
      if (next < 0) return false;
      switchTo(turn, side, next);
      return true;
    }

    case "transform": {
      const user = active(turn, side);
      const target = active(turn, foe);
      if (user.speciesId === target.speciesId) return false;

      // Its shape, its numbers and its moves; its own level and its own
      // health. Power points come out at five apiece, as they do in the games:
      // a copied moveset is not a fresh one.
      const copied = target.moves.slice(0, 4);
      setActive(turn, side, {
        ...user,
        speciesId: target.speciesId,
        ivs: { ...target.ivs },
        evs: { ...target.evs },
        natureId: target.natureId,
        abilities: [...target.abilities],
        moves: copied,
        pp: copied.map((id) => Math.min(TRANSFORM_PP, moveById(id).pp)),
      });
      turn.events.push({ t: "transformed", side, into: target.speciesId });
      return true;
    }

    case "sketch": {
      const user = active(turn, side);
      const target = active(turn, foe);
      // What they last did, or the first thing they know if they have not
      // moved yet, so Smeargle moving first is not Smeargle wasting a turn.
      const learn = turn.battle.sides[foe].lastMove ?? target.moves[0];
      if (!learn || user.moves.includes(learn)) return false;

      const slot = user.moves.indexOf(SKETCH);
      if (slot < 0) return false;
      const moves = [...user.moves];
      const pp = [...user.pp];
      moves[slot] = learn;
      pp[slot] = moveById(learn).pp;
      setActive(turn, side, { ...user, moves, pp });
      turn.events.push({ t: "sketched", side, moveId: learn });
      return true;
    }

    case "roots": {
      if (volatiles(turn, side).rooted) return false;
      mergeVolatiles(turn, side, {
        rooted: true,
        trapped: effect.plant ? true : volatiles(turn, side).trapped,
      });
      turn.events.push({ t: "volatile", side, which: "rooted" });
      if (effect.plant) turn.events.push({ t: "volatile", side, which: "trapped" });
      return true;
    }

    case "infatuate": {
      // The same question breeding asks, because it is the same question:
      // two creatures that would not pair do not fall for each other either.
      if (!gendersPair(active(turn, side).gender, active(turn, foe).gender)) return false;
      if (volatiles(turn, foe).infatuated) return false;
      mergeVolatiles(turn, foe, { infatuated: true });
      turn.events.push({ t: "volatile", side: foe, which: "infatuated" });
      return true;
    }

    case "mend": {
      const target = active(turn, foe);
      if (isFainted(target) || target.hp >= maxHp(target)) return false;
      const mended = applyHeal(turn, foe, Math.max(1, Math.floor(maxHp(target) / effect.share)));
      if (mended > 0) turn.events.push({ t: "heal", side: foe, amount: mended });
      return mended > 0;
    }

    case "sap": {
      // What their Attack is *now*, stages and all, which is what makes the
      // move worth using against something that has been setting up.
      const target = active(turn, foe);
      const stages = turn.battle.sides[foe].stages;
      if (stages.atk <= -6) return false;
      const drawn = effectiveStat(target, "atk", stages.atk, volatiles(turn, foe).stats);
      const mended = applyHeal(turn, side, drawn);
      if (mended > 0) turn.events.push({ t: "heal", side, amount: mended });
      applyBoosts(turn, foe, { atk: -1 }, true);
      return true;
    }

    case "copyStages": {
      const mine = turn.battle.sides[side];
      const theirs = turn.battle.sides[foe];
      const same =
        (["atk", "def", "spa", "spd", "spe"] as StageStat[]).every(
          (stat) => mine.stages[stat] === theirs.stages[stat],
        ) &&
        aimOf(turn, side).accuracy === aimOf(turn, foe).accuracy &&
        aimOf(turn, side).evasion === aimOf(turn, foe).evasion;
      if (same) return false;
      mine.stages = { ...theirs.stages };
      mine.aim = theirs.aim ? { ...theirs.aim } : undefined;
      turn.events.push({ t: "volatile", side, which: "copied" });
      return true;
    }

    case "swapStages": {
      const mine = turn.battle.sides[side];
      const theirs = turn.battle.sides[foe];
      let changed = false;
      const ours = { ...mine.stages };
      const others = { ...theirs.stages };
      for (const stat of effect.stats) {
        if (ours[stat] === others[stat]) continue;
        [ours[stat], others[stat]] = [others[stat], ours[stat]];
        changed = true;
      }
      mine.stages = ours;
      theirs.stages = others;
      if (effect.aim) {
        const a = aimOf(turn, side);
        const b = aimOf(turn, foe);
        if (a.accuracy !== b.accuracy || a.evasion !== b.evasion) {
          mine.aim = b.accuracy === 0 && b.evasion === 0 ? undefined : { ...b };
          theirs.aim = a.accuracy === 0 && a.evasion === 0 ? undefined : { ...a };
          changed = true;
        }
      }
      if (!changed) return false;
      turn.events.push({ t: "volatile", side, which: "swapped" });
      return true;
    }

    case "splitStats": {
      // The number itself, before any stage — a split Attack is still raised
      // by the Swords Dance that came after it. Read through the override so
      // splitting twice averages what is already averaged rather than the
      // creature's own.
      const user = active(turn, side);
      const target = active(turn, foe);
      const mine = { ...(volatiles(turn, side).stats ?? {}) };
      const theirs = { ...(volatiles(turn, foe).stats ?? {}) };
      let changed = false;
      for (const stat of effect.stats) {
        const ours = mine[stat] ?? computeStats(speciesById(user.speciesId), user)[stat];
        const others = theirs[stat] ?? computeStats(speciesById(target.speciesId), target)[stat];
        if (ours === others) continue;
        if (effect.swap) {
          mine[stat] = others;
          theirs[stat] = ours;
        } else {
          const between = Math.max(1, Math.floor((ours + others) / 2));
          mine[stat] = between;
          theirs[stat] = between;
        }
        changed = true;
      }
      if (!changed) return false;
      mergeVolatiles(turn, side, { stats: mine });
      mergeVolatiles(turn, foe, { stats: theirs });
      turn.events.push({ t: "volatile", side, which: "split" });
      turn.events.push({ t: "volatile", side: foe, which: "split" });
      return true;
    }

    case "stockpile": {
      const held = volatiles(turn, side).stockpile ?? 0;
      if (held >= STOCKPILE_MAX) return false;
      mergeVolatiles(turn, side, { stockpile: held + 1 });
      turn.events.push({ t: "volatile", side, which: "stockpiled" });
      // A stage of each guard per count, given back when the counter is spent.
      applyBoosts(turn, side, { def: 1, spd: 1 });
      return true;
    }

    case "swallow": {
      const held = volatiles(turn, side).stockpile ?? 0;
      if (held <= 0) return false;
      const user = active(turn, side);
      const share = SWALLOW_SHARES[Math.min(held, SWALLOW_SHARES.length) - 1];
      const mended = applyHeal(turn, side, Math.max(1, Math.floor(maxHp(user) / share)));
      if (mended > 0) turn.events.push({ t: "heal", side, amount: mended });
      unstock(turn, side);
      return true;
    }

    case "unstock":
      // Spit Up, after the damage the counter powered. moves.ts refuses the
      // move at nought, so by here there is always something to spend.
      return unstock(turn, side);

    case "sure": {
      if (volatiles(turn, side).sure) return false;
      mergeVolatiles(turn, side, { sure: true });
      turn.events.push({ t: "volatile", side, which: "sure" });
      return true;
    }

    case "bond": {
      // Never already set: executeMove took it off before this ran, which is
      // what makes two in a row the second one rather than a wasted turn.
      mergeVolatiles(turn, side, { bonded: true });
      turn.events.push({ t: "volatile", side, which: "bonded" });
      return true;
    }

    case "wish": {
      if ((volatiles(turn, side).wish ?? 0) > 0) return false;
      mergeVolatiles(turn, side, { wish: WISH_TURNS });
      turn.events.push({ t: "volatile", side, which: "wished" });
      return true;
    }

    case "sacrifice": {
      // Fainting for nobody is not a trade. It fails with nothing in reserve.
      const combatant = turn.battle.sides[side];
      if (!combatant.team.some((one, at) => at !== combatant.active && !isFainted(one))) return false;
      const user = active(turn, side);
      applyDamage(turn, side, user.hp);
      mergeVolatiles(turn, side, { blessing: true });
      turn.events.push({ t: "volatile", side, which: "blessed" });
      return true;
    }

    case "revive": {
      const combatant = turn.battle.sides[side];
      const at = combatant.team.findIndex((one) => isFainted(one));
      if (at < 0) return false;
      const fallen = combatant.team[at];
      const back = Math.max(1, Math.floor(maxHp(fallen) / 2));
      combatant.team = combatant.team.map((one, index) =>
        index === at ? { ...one, hp: back, status: null, sleepTurns: 0 } : one,
      );
      turn.events.push({ t: "revived", side, speciesId: fallen.speciesId });
      return true;
    }

    case "float": {
      const at = effect.onSelf ? side : foe;
      if ((volatiles(turn, at).afloat ?? 0) > 0) return false;
      mergeVolatiles(turn, at, { afloat: effect.turns });
      turn.events.push({ t: "volatile", side: at, which: "afloat" });
      return true;
    }

    case "retype": {
      const held = typesOf(turn, foe);
      const next = effect.add
        ? held.includes(effect.types[0])
          ? held
          : [...held, ...effect.types]
        : effect.types;
      if (next.length === held.length && next.every((type, at) => type === held[at])) return false;
      mergeVolatiles(turn, foe, { types: next });
      turn.events.push({ t: "volatile", side: foe, which: "retyped" });
      return true;
    }

    case "mirrorTypes": {
      const mine = typesOf(turn, side);
      const theirs = typesOf(turn, foe);
      if (mine.length === theirs.length && mine.every((type, at) => type === theirs[at])) return false;
      mergeVolatiles(turn, side, { types: [...theirs] });
      turn.events.push({ t: "volatile", side, which: "retyped" });
      return true;
    }

    case "conversion": {
      const first = active(turn, side).moves[0];
      if (!first) return false;
      const type = moveById(first).type;
      const mine = typesOf(turn, side);
      if (mine.length === 1 && mine[0] === type) return false;
      mergeVolatiles(turn, side, { types: [type] });
      turn.events.push({ t: "volatile", side, which: "retyped" });
      return true;
    }

    case "conversion2": {
      // The type that takes the least from what they last used. The games
      // pick at random among the candidates; the first in alphabetical order
      // is the same answer on both peers without a roll.
      const last = turn.battle.sides[foe].lastMove;
      if (!last) return false;
      const against = moveById(last).type;
      let best: string | null = null;
      let least = 4;
      for (const type of TYPE_NAMES) {
        const quarters = effectiveness(against, [type]);
        if (quarters < least) {
          least = quarters;
          best = type;
        }
      }
      if (!best) return false;
      const mine = typesOf(turn, side);
      if (mine.length === 1 && mine[0] === best) return false;
      mergeVolatiles(turn, side, { types: [best] });
      turn.events.push({ t: "volatile", side, which: "retyped" });
      return true;
    }

    case "see": {
      if (volatiles(turn, foe).seen === effect.through) return false;
      mergeVolatiles(turn, foe, { seen: effect.through });
      turn.events.push({ t: "volatile", side: foe, which: "seen" });
      return true;
    }

    case "drench": {
      if (active(turn, foe).status !== "psn") return false;
      const before = { ...turn.battle.sides[foe].stages };
      applyBoosts(turn, foe, { atk: -1, spa: -1, spe: -1 }, true);
      const after = turn.battle.sides[foe].stages;
      return (["atk", "spa", "spe"] as StageStat[]).some((stat) => after[stat] !== before[stat]);
    }

    case "acupressure": {
      // One of the seven ladders that is not already at the top. Rolled from
      // the battle's own stream, like everything else.
      const stages = turn.battle.sides[side].stages;
      const aim = aimOf(turn, side);
      const open: (StageStat | AimStat)[] = [
        ...(["atk", "def", "spa", "spd", "spe"] as StageStat[]).filter((stat) => stages[stat] < 6),
        ...(["accuracy", "evasion"] as AimStat[]).filter((which) => aim[which] < 6),
      ];
      if (!open.length) return false;
      const picked = open[intBelow(rngFor(turn.battle.seed, turn.battle.tag, turn.battle.turn, `${side}-acu`), open.length)];
      if (picked === "accuracy" || picked === "evasion") {
        return applyMoveEffect(turn, side, { t: "aim", which: picked, delta: 2, onSelf: true });
      }
      applyBoosts(turn, side, { [picked]: 2 });
      return true;
    }

    case "psychoShift": {
      const user = active(turn, side);
      if (!user.status) return false;
      // Through the one predicate, so a Safeguard or an immunity refuses it
      // and the user keeps what it had.
      if (!applyStatus(turn, foe, user.status, `${side}-shift`)) return false;
      setActive(turn, side, { ...active(turn, side), status: null, sleepTurns: 0 });
      turn.events.push({ t: "volatile", side, which: "snapped" });
      return true;
    }

    case "powerTrick": {
      // The Power Split override, pointed at one creature: the two numbers
      // exchanged, and exchanged back by using it again.
      const user = active(turn, side);
      const mine = { ...(volatiles(turn, side).stats ?? {}) };
      const own = computeStats(speciesById(user.speciesId), user);
      const attack = mine.atk ?? own.atk;
      const defence = mine.def ?? own.def;
      if (attack === defence) return false;
      mine.atk = defence;
      mine.def = attack;
      mergeVolatiles(turn, side, { stats: mine });
      turn.events.push({ t: "volatile", side, which: "split" });
      return true;
    }

    case "invert": {
      const combatant = turn.battle.sides[foe];
      const stats = ["atk", "def", "spa", "spd", "spe"] as StageStat[];
      const aim = combatant.aim;
      if (stats.every((stat) => combatant.stages[stat] === 0) && !aim) return false;
      const flipped = { ...combatant.stages };
      for (const stat of stats) flipped[stat] = -flipped[stat];
      combatant.stages = flipped;
      if (aim) combatant.aim = { accuracy: -aim.accuracy, evasion: -aim.evasion };
      turn.events.push({ t: "volatile", side: foe, which: "inverted" });
      return true;
    }

    case "heartened": {
      const user = active(turn, side);
      let did = false;
      if (user.status) {
        setActive(turn, side, { ...user, status: null, sleepTurns: 0 });
        turn.events.push({ t: "volatile", side, which: "snapped" });
        did = true;
      }
      if (effect.share) {
        const now = active(turn, side);
        const mended = applyHeal(turn, side, Math.max(1, Math.floor(maxHp(now) / effect.share)));
        if (mended > 0) {
          turn.events.push({ t: "heal", side, amount: mended });
          did = true;
        }
      }
      if (effect.boosts) {
        const before = { ...turn.battle.sides[side].stages };
        applyBoosts(turn, side, effect.boosts);
        const after = turn.battle.sides[side].stages;
        if ((Object.keys(effect.boosts) as StageStat[]).some((stat) => after[stat] !== before[stat])) did = true;
      }
      return did;
    }

    case "flowerShield": {
      let raised = false;
      for (const at of [side, foe] as SideIndex[]) {
        if (isFainted(active(turn, at)) || !typesOf(turn, at).includes("grass")) continue;
        const before = turn.battle.sides[at].stages.def;
        applyBoosts(turn, at, { def: 1 });
        if (turn.battle.sides[at].stages.def !== before) raised = true;
      }
      return raised;
    }

    case "call": {
      const called = calledMove(turn, side, effect.from);
      if (!called) return false;
      executeMove(turn, side, called, 1);
      return true;
    }

    case "instruct": {
      // The target does its last move again, now. Not while it is asleep or
      // frozen — `canAct` is not asked of a called move, so this is where
      // that question has to be answered.
      const target = active(turn, foe);
      const last = turn.battle.sides[foe].lastMove;
      if (!last || UNCALLABLE.has(last) || isFainted(target)) return false;
      if (target.status === "slp" || target.status === "frz") return false;
      executeMove(turn, foe, last, 1);
      return true;
    }

    case "spite": {
      const target = active(turn, foe);
      const last = turn.battle.sides[foe].lastMove;
      if (!last) return false;
      const slot = target.moves.indexOf(last);
      if (slot < 0 || target.pp[slot] <= 0) return false;
      const taken = Math.min(SPITE_USES, target.pp[slot]);
      const pp = [...target.pp];
      pp[slot] -= taken;
      setActive(turn, foe, { ...target, pp });
      turn.events.push({ t: "spite", side: foe, moveId: last, amount: taken });
      return true;
    }

    case "nothing":
      // Splash. It is supposed to do this.
      return false;
  }
}

/**
 * The move a caller lands on, or null when there is nothing to land on.
 *
 * Every draw is from the battle's own stream, named by the caller's kind, so
 * a Metronome comes out the same on both peers of a duel. Anything in
 * `UNCALLABLE` is refused from every source, which is what keeps the call
 * depth at one.
 */
function calledMove(turn: Turn, side: SideIndex, from: "any" | "foe" | "self" | "party"): string | null {
  const draw = (pool: readonly string[], tag: string): string | null => {
    if (!pool.length) return null;
    return pool[intBelow(rngFor(turn.battle.seed, turn.battle.tag, turn.battle.turn, `${side}-${tag}`), pool.length)];
  };

  switch (from) {
    case "any":
      return draw(CALLABLE, "metronome");
    case "foe": {
      const last = turn.battle.sides[other(side)].lastMove;
      return last && !UNCALLABLE.has(last) ? last : null;
    }
    case "self": {
      // Only while it sleeps: awake, Sleep Talk is a move that does nothing,
      // and it says so.
      if (active(turn, side).status !== "slp") return null;
      return draw(active(turn, side).moves.filter((id) => !UNCALLABLE.has(id)), "sleeptalk");
    }
    case "party": {
      const combatant = turn.battle.sides[side];
      const pool = combatant.team
        .filter((_, at) => at !== combatant.active)
        .flatMap((one) => one.moves)
        .filter((id) => !UNCALLABLE.has(id));
      return draw(pool, "assist");
    }
  }
}

/**
 * Stockpile's counter spent, and the guard stages it bought given back.
 *
 * One place for Swallow and Spit Up both, so the two doors out of a stockpile
 * cannot disagree about what leaving costs.
 */
function unstock(turn: Turn, side: SideIndex): boolean {
  const held = volatiles(turn, side).stockpile ?? 0;
  if (held <= 0) return false;
  mergeVolatiles(turn, side, { stockpile: undefined });
  applyBoosts(turn, side, { def: -held, spd: -held });
  return true;
}

/**
 * What the end of a turn does to whatever is standing there.
 *
 * Ordered on purpose: the seed drains before Nightmare bites, so a creature
 * that is both seeded and dreaming goes down to the seed and the healing still
 * happens. Perish counts last, because it is the one thing nothing prevents
 * and it should have the last word.
 */
/**
 * Confuse *this* side, whoever it is.
 *
 * Named by the side rather than by "the target", because two of the three
 * callers confuse somebody other than the one a move was aimed at. Confuse Ray
 * and a Dynamic Punch's secondary confuse the foe; **Outrage confuses its own
 * user**, and that is the whole cost of the move.
 *
 * It was a `foe`-only case in `applyMoveEffect` first, and a rampage calling
 * it put the confusion on the wrong creature — a bug worth the extra function,
 * because a drawback applied to the opponent is not a drawback.
 */
function confuseSide(turn: Turn, side: SideIndex): boolean {
  if (screened(turn, side, "safeguard")) {
    turn.events.push({ t: "screen", side, which: "safeguard" });
    return false;
  }
  if ((volatiles(turn, side).confusion ?? 0) > 0) return false;
  mergeVolatiles(turn, side, { confusion: CONFUSED_TURNS });
  turn.events.push({ t: "volatile", side, which: "confused" });
  return true;
}

function tickVolatiles(turn: Turn, side: SideIndex): void {
  // Roots first, so a creature both rooted and seeded is mended before it is
  // drained — which is the order the games use, and the one that gives the
  // roots any point against a seed.
  if (volatiles(turn, side).rooted) {
    const creature = active(turn, side);
    const mended = applyHeal(turn, side, Math.max(1, Math.floor(maxHp(creature) / ROOTS_SHARE)));
    if (mended > 0) turn.events.push({ t: "heal", side, amount: mended });
  }

  if (volatiles(turn, side).seeded) {
    const creature = active(turn, side);
    const drawn = applyDamage(turn, side, Math.max(1, Math.floor(maxHp(creature) / SEED_SHARE)));
    if (drawn > 0) {
      turn.events.push({ t: "volatile", side, which: "sapped" });
      turn.events.push({ t: "damage", side, amount: drawn, quarters: 4, crit: false });
      // Into whoever is opposite, which is the whole point of a seed rather
      // than a poison. Capped by their room, so a full creature gains nothing
      // and no health appears out of nowhere.
      if (!isFainted(active(turn, other(side)))) {
        const mended = applyHeal(turn, other(side), drawn);
        if (mended > 0) turn.events.push({ t: "heal", side: other(side), amount: mended });
      }
    }
  }

  /*
   * The bind squeezing, and then letting go.
   *
   * Beside the seed rather than with the statuses because it is the same kind
   * of thing — a share of maximum health, every turn, until it stops — and
   * because the order matters: a creature both seeded and bound loses to both,
   * and doing them in a fixed order is what makes two peers of a duel agree
   * about which one finished it.
   *
   * The freeing is announced. Without it the trap simply stops working one
   * turn and the player has no way to know they can leave.
   */
  const bind = volatiles(turn, side).bound ?? 0;
  if (bind > 0) {
    const creature = active(turn, side);
    const squeezed = applyDamage(turn, side, Math.max(1, Math.floor(maxHp(creature) / BIND_SHARE)));
    if (squeezed > 0) {
      turn.events.push({ t: "volatile", side, which: "squeezed" });
      turn.events.push({ t: "damage", side, amount: squeezed, quarters: 4, crit: false });
    }
    const left = bind - 1;
    mergeVolatiles(turn, side, { bound: left || undefined });
    if (left === 0) turn.events.push({ t: "volatile", side, which: "freed" });
  }

  if (isFainted(active(turn, side))) return;

  if (volatiles(turn, side).nightmare) {
    const creature = active(turn, side);
    // It ends when the sleep does, rather than lingering on something awake.
    if (creature.status !== "slp") {
      mergeVolatiles(turn, side, { nightmare: undefined });
    } else {
      const taken = applyDamage(
        turn,
        side,
        Math.max(1, Math.floor(maxHp(creature) / NIGHTMARE_SHARE)),
      );
      if (taken > 0) {
        turn.events.push({ t: "volatile", side, which: "dreaming" });
        turn.events.push({ t: "damage", side, amount: taken, quarters: 4, crit: false });
      }
    }
  }

  if (isFainted(active(turn, side))) return;

  const drowsy = volatiles(turn, side).yawn ?? 0;
  if (drowsy > 0) {
    if (drowsy <= 1) {
      mergeVolatiles(turn, side, { yawn: undefined });
      // Through the one predicate every road to a status goes down, so an
      // Insomnia or a Safeguard still says no at the last moment.
      applyStatus(turn, side, "slp", `${side}-yawn`);
    } else {
      mergeVolatiles(turn, side, { yawn: drowsy - 1 });
    }
  }

  // A wish coming true lands on whoever is standing here, which after a
  // switch is somebody else. Worth half of *their* maximum: the wish is a
  // fact about this slot, and the slot has no memory of who made it.
  const wish = volatiles(turn, side).wish ?? 0;
  if (wish > 0) {
    if (wish <= 1) {
      mergeVolatiles(turn, side, { wish: undefined });
      const creature = active(turn, side);
      const mended = applyHeal(turn, side, Math.max(1, Math.floor(maxHp(creature) / WISH_SHARE)));
      if (mended > 0) turn.events.push({ t: "heal", side, amount: mended });
    } else {
      mergeVolatiles(turn, side, { wish: wish - 1 });
    }
  }

  const afloat = volatiles(turn, side).afloat ?? 0;
  if (afloat > 0) mergeVolatiles(turn, side, { afloat: afloat - 1 || undefined });

  const perish = volatiles(turn, side).perish ?? 0;
  if (perish > 0) {
    const left = perish - 1;
    mergeVolatiles(turn, side, { perish: left || undefined });
    turn.events.push({ t: "perish", side, turns: left });
    if (left === 0) applyDamage(turn, side, active(turn, side).hp);
  }
}

function damageContext(turn: Turn, side: SideIndex, moveId: string): DamageContext {
  const attacker = active(turn, side);
  const defender = active(turn, other(side));
  const theirStages = turn.battle.sides[other(side)].stages;

  return {
    attacker,
    defender,
    attackerMaxHp: maxHp(attacker),
    defenderMaxHp: maxHp(defender),
    attackerSpeed: speedOf(turn, side),
    defenderSpeed: speedOf(turn, other(side)),
    defenderBoosts: (["atk", "def", "spa", "spd", "spe"] as StageStat[]).reduce(
      (sum, stat) => sum + Math.max(0, theirStages[stat]),
      0,
    ),
    takenPhysical: turn.taken[side].physical,
    takenSpecial: turn.taken[side].special,
    // Named from the battle's own stream, like every other draw, so Magnitude
    // and Present come out the same on both peers in a duel.
    rng: rngFor(turn.battle.seed, turn.battle.tag, turn.battle.turn, `${side}-var`),
    // The slot has already been charged for this swing by the time damage is
    // worked out, so the last use reads as zero left — which is exactly when
    // Trump Card is meant to be at its worst-case best.
    ppLeft: ppLeft(attacker, attacker.moves.indexOf(moveId)),
    stockpiles: volatiles(turn, side).stockpile ?? 0,
  };
}

/**
 * `power` is passed in rather than read off the move, because thirty-nine of
 * them do not have one: the manifest ships `power: 0` for every move whose
 * damage Showdown computes in a script, and moves.ts is the missing script.
 */
function damageFor(
  turn: Turn,
  side: SideIndex,
  move: MoveEntry,
  power: number,
  /**
   * Which blow of a multi-strike this is, folded into the two rolls that make
   * one blow differ from another.
   *
   * Without it every hit of a Fury Swipes is the same number with the same
   * crit, which reads as the screen repeating itself rather than as five
   * separate blows. The first blow keeps the bare tag — deliberately, because
   * that is what every single-hit move in the game already rolls against, and
   * a suffix on all of them would have re-rolled every battle in every save.
   */
  blow = 0,
): { amount: number; quarters: number; crit: boolean } {
  const at = blow === 0 ? "" : `-${blow}`;
  const attacker = active(turn, side);
  const defender = active(turn, other(side));

  // Struggle is outside the type chart entirely — neither resisted, nor
  // doubled, nor blocked. Exempting it only from the early "immune" return was
  // not enough: the multiplier is applied again at the end, so a ghost still
  // took nothing and a creature with no moves left had no way to end the
  // fight. Four quarters is neutral, which is what "types do not apply" means
  // in this arithmetic.
  const struggling = move.id === STRUGGLE;

  const quarters = struggling
    ? 4
    : effectiveness(move.type, typesAgainst(attacker, defender, move, volatiles(turn, other(side))));
  if (move.category === "status" || power <= 0 || quarters === 0) {
    return { amount: 0, quarters, crit: false };
  }

  const physical = move.category === "physical";
  const attack = scaled(
    effectiveStat(
      attacker,
      physical ? "atk" : "spa",
      turn.battle.sides[side].stages[physical ? "atk" : "spa"],
      volatiles(turn, side).stats,
    ),
    fieldStatMille(turn, side, physical ? "atk" : "spa"),
  );
  const defence = Math.max(
    1,
    scaled(
      effectiveStat(
        defender,
        physical ? "def" : "spd",
        turn.battle.sides[other(side)].stages[physical ? "def" : "spd"],
        volatiles(turn, other(side)).stats,
      ),
      fieldStatMille(turn, other(side), physical ? "def" : "spd"),
    ),
  );

  let value = Math.floor((2 * attacker.level) / 5) + 2;
  value = Math.floor((value * power * attack) / defence);
  value = Math.floor(value / 50) + 2;

  // Reflect and Light Screen, each against its own half of the split. Applied
  // to the running value rather than to the defence, so the halving is exact
  // and integer either way — doubling a defence would round differently for
  // an odd one.
  const screen: SideConditionId = physical ? "reflect" : "lightscreen";
  if (screened(turn, other(side), screen)) value = Math.floor(value / 2);

  // Super Luck, a Scope Lens, a Razor Claw: one stage up the same ladder the
  // move's own ratio walks. Focus Energy walks the same ladder, which is why
  // it is added here rather than given odds of its own.
  const luck = effects(attacker, "luck").reduce((sum, effect) => sum + effect.stages, 0);
  const ratio = move.critRatio + luck + (volatiles(turn, side).crit ?? 0);
  const odds = CRIT_ODDS[Math.max(0, Math.min(CRIT_ODDS.length - 1, ratio - 1))];
  // Lucky Chant: no critical hits against this side at all — including the
  // five that always crit, because a chant that the five strongest crits in
  // the game walked through would be a chant that protects against nothing
  // anybody uses it for.
  const crit =
    !screened(turn, other(side), "luckychant") &&
    (move.alwaysCrit ||
      intBelow(rngFor(turn.battle.seed, turn.battle.tag, turn.battle.turn, `${side}-crit${at}`), odds) ===
        0);
  if (crit) value = Math.floor((value * 3) / 2);

  // 85..100, the damage roll every one of these games has.
  const spread = 85 + intBelow(rngFor(turn.battle.seed, turn.battle.tag, turn.battle.turn, `${side}-roll${at}`), 16);
  value = Math.floor((value * spread) / 100);

  const attackerTypes = typesOf(turn, side);
  // No same-type bonus on Struggle: it is the absence of an attack rather than
  // a Normal one, and a Normal type should not be rewarded for having nothing
  // left. Adaptability makes the bonus double instead of half again.
  if (!struggling && attackerTypes.includes(move.type)) {
    const stab = effects(attacker, "stab")[0]?.mille ?? 1500;
    value = scaled(value, stab);
  }

  // The field. Sun and rain on Fire and Water; a terrain on its own type for
  // a grounded attacker, and Misty on Dragon into a grounded target; the two
  // sports; Solar Beam without its sun. After the same-type bonus and before
  // the abilities, so Sand Force compounds on top of the sand.
  const weather = weatherNow(turn);
  if (weather === "sun" && move.type === "fire") value = scaled(value, 1500);
  if (weather === "sun" && move.type === "water") value = scaled(value, 500);
  if (weather === "rain" && move.type === "water") value = scaled(value, 1500);
  if (weather === "rain" && move.type === "fire") value = scaled(value, 500);
  if (weather && weather !== "sun" && (move.id === "solarbeam" || move.id === "solarblade")) value = scaled(value, 500);
  const terrain = terrainNow(turn);
  if (terrain === "electric" && move.type === "electric" && grounded(turn, side)) value = scaled(value, 1300);
  if (terrain === "grassy" && move.type === "grass" && grounded(turn, side)) value = scaled(value, 1300);
  if (terrain === "psychic" && move.type === "psychic" && grounded(turn, side)) value = scaled(value, 1300);
  if (terrain === "misty" && move.type === "dragon" && grounded(turn, other(side))) value = scaled(value, 500);
  const sport = sportNow(turn);
  if (sport === "water" && move.type === "fire") value = scaled(value, 333);
  if (sport === "mud" && move.type === "electric") value = scaled(value, 333);
  for (const effect of effects(attacker, "weatherPower")) {
    if (weather && effect.weather.includes(weather) && effect.types.includes(move.type)) value = scaled(value, effect.mille);
  }

  // Technician, Reckless, Analytic, and the eighteen cornered abilities. Each
  // is a multiplier on its own attack, and they compound — a cornered
  // Technician is both.
  for (const effect of effects(attacker, "power")) {
    const applies =
      effect.when === "always" ||
      // Technician reads the power the move is *actually* swinging with, so a
      // Low Kick standing in at 60 qualifies and a Flail at 200 does not.
      (effect.when === "weak" && power > 0 && power <= 60) ||
      (effect.when === "costly" && move.recoil !== null) ||
      (effect.when === "late" && turn.movingLast === side) ||
      // The eighteen type-enhancing items: the same shape as a cornered
      // ability with the health condition taken off.
      (effect.when === "typed" && effect.type === move.type) ||
      (effect.when === "physical" && move.category === "physical") ||
      (effect.when === "special" && move.category === "special") ||
      (effect.when === "cornered" &&
        effect.type === move.type &&
        attacker.hp * 3 <= maxHp(attacker));
    if (applies) value = scaled(value, effect.mille);
  }

  value = Math.floor((value * quarters) / 4);

  // Filter and Solid Rock on the way in; Tinted Lens on the way out. Both are
  // about the type chart's verdict rather than about a type, which is why they
  // sit after the multiplier rather than beside it.
  if (quarters > 4) {
    for (const effect of effects(defender, "cushion")) value = scaled(value, effect.mille);
    // Expert Belt, on the other side of the same verdict.
    for (const effect of effects(attacker, "sharp")) value = scaled(value, effect.mille);
    // A resist berry, which is the one thing here that only ever fires once.
    // Noted rather than spent: `damageFor` is arithmetic and must stay so, or
    // a berry would be eaten by a blow that then missed. `landDamage` spends
    // it, where the blow is known to have landed.
    for (const effect of effects(defender, "soften")) {
      if (effect.types.includes(move.type)) value = scaled(value, effect.mille);
    }
  }
  if (quarters < 4) {
    for (const effect of effects(attacker, "pierce")) value = scaled(value, effect.mille);
  }

  // Ward and Thick Fat: a share off, by the move's type.
  for (const effect of effects(defender, "ward")) {
    if (effect.types.includes(move.type)) value = scaled(value, effect.mille);
  }

  // Guts ignores the burn penalty it is carried for.
  const gutsy = effects(attacker, "stat").some(
    (effect) => effect.when === "statused" && effect.stat === "atk",
  );
  if (attacker.status === "brn" && physical && !gutsy) value = Math.floor(value / 2);

  return { amount: Math.max(1, value), quarters, crit };
}

/** Can this side act at all? Handles the conditions that skip a turn, and the
 * rolls that end them. */
/* ------------------------------------------------------------------------
 * What a flag on a move row means, in one place.
 *
 * Everything below reads `move.flags`, which until the manifest carried it
 * was the reason none of this existed. The tables are here rather than in the
 * data for the same reason `moves.ts` names move ids: the manifest can say
 * *that* Fly charges, and cannot say that a creature charging Fly is in the
 * sky and that a Thunder finds it there. That is behaviour, and behaviour
 * lives in the engine.
 * ---------------------------------------------------------------------- */

function hasFlag(move: MoveEntry, flag: string): boolean {
  return move.flags?.includes(flag) ?? false;
}

/** Where a charge move goes while it charges. Absent means it charges in
 * plain sight — Solar Beam gathers light standing still, and can be hit. */
const HIDES_IN: Record<string, "sky" | "ground" | "water" | "shadow"> = {
  fly: "sky",
  bounce: "sky",
  skydrop: "sky",
  dig: "ground",
  dive: "water",
  phantomforce: "shadow",
  shadowforce: "shadow",
};

/**
 * The moves that find it anyway.
 *
 * Short lists on purpose: a hidden creature that nothing at all could reach
 * would make every two-turn move a free turn of invulnerability, and these
 * are the exceptions the games use to price that. Nothing reaches a Phantom
 * Force, which is why it has no entry and why it costs more power than a Fly.
 */
const REACHES: Record<string, readonly string[]> = {
  sky: ["gust", "twister", "thunder", "hurricane", "skyuppercut", "smackdown", "thousandarrows"],
  ground: ["earthquake", "magnitude", "fissure"],
  water: ["surf", "whirlpool"],
};

/**
 * What a charge turn is worth, for the five moves whose charge does something.
 *
 * Not in the manifest and not derivable from it: Showdown keeps these in the
 * move's charge condition rather than in `self.boosts`, so `selfBoosts` is
 * null on all five. Named here, the way `moves.ts` names the damage formulas
 * the data cannot hold.
 */
const CHARGE_BOOSTS: Record<string, Boosts> = {
  skullbash: { def: 1 },
  meteorbeam: { spa: 1 },
  electroshot: { spa: 1 },
};

/**
 * When the weather does the charging for you.
 *
 * Solar Beam and Solar Blade go off the turn they are used in sun; Electro
 * Shot does the same in rain. This is the whole reason those moves are worth
 * building a weather team around, and without it sun was worth nothing to the
 * two moves most associated with it.
 */
function chargeSkipped(turn: Turn, moveId: string): boolean {
  const weather = weatherNow(turn);
  if ((moveId === "solarbeam" || moveId === "solarblade") && weather === "sun") return true;
  return moveId === "electroshot" && weather === "rain";
}

/** Wrap and its nine friends: an eighth a turn, for four turns or five. */
const BIND_SHARE = 8;
const BIND_TURNS: [number, number] = [4, 5];
/** Outrage and its three: two turns of it or three, and confusion after. */
const RAGE_TURNS: [number, number] = [2, 3];
/** Rollout keeps going for five, doubling as it goes. */
const ROLL_TURNS = 5;
/** Bide takes it for two turns and gives back twice what it took. */
const BIDE_TURNS = 2;
const BIDE_RETURN = 2;
/** Future Sight, thrown now and landing at the end of the turn after next. */
const FUTURE_TURNS = 3;

/**
 * The move this side is going to use whatever it picked, or null.
 *
 * Two callers, and they must not be able to disagree: `chosenMove` resolves
 * the action into a move id, and `actionRefusal` greys the buttons the engine
 * is about to ignore. One predicate, the way Struggle's is one predicate.
 */
function forcedMove(state: BattleState, side: SideIndex): string | null {
  return state.sides[side].volatiles?.committed ?? null;
}

/**
 * Whether a move can reach a creature that is not, at this moment, here.
 *
 * Only asked of a target that is charging *and* hidden — Solar Beam charges in
 * the open, and is as hittable as anything else while it does.
 */
function reachesHidden(move: MoveEntry, hidden: NonNullable<Volatiles["hidden"]>): boolean {
  return (REACHES[hidden] ?? []).includes(move.id);
}

function canAct(turn: Turn, side: SideIndex): boolean {
  const creature = active(turn, side);

  // Before every condition below it, because a beam move's recharge is not
  // something a creature is *under* — it is the second half of what it did
  // last turn, and it is spent whether or not it would also have been asleep.
  // Cleared as it is spent, so exactly one turn is lost.
  if (volatiles(turn, side).recharging) {
    mergeVolatiles(turn, side, { recharging: undefined });
    turn.events.push({ t: "volatile", side, which: "recharging" });
    return false;
  }

  // Set by whoever moved first this turn. Read here, and cleared at the end of
  // the turn by `resolveTurn` whether or not anything read it — which is what
  // makes a flinch from the slower side worth precisely nothing.
  if (volatiles(turn, side).flinched) {
    turn.events.push({ t: "volatile", side, which: "flinched" });
    return false;
  }

  if (creature.status === "slp") {
    if (creature.sleepTurns <= 1) {
      setActive(turn, side, { ...creature, status: null, sleepTurns: 0 });
      turn.events.push({ t: "woke", side });
      return true;
    }
    setActive(turn, side, { ...creature, sleepTurns: creature.sleepTurns - 1 });
    turn.events.push({ t: "blocked", side, reason: "slp" });
    return false;
  }

  if (creature.status === "frz") {
    if (chance(turn, `${side}-thaw`, 20)) {
      setActive(turn, side, { ...creature, status: null });
      turn.events.push({ t: "thawed", side });
      return true;
    }
    turn.events.push({ t: "blocked", side, reason: "frz" });
    return false;
  }

  if (creature.status === "par" && chance(turn, `${side}-par`, 25)) {
    turn.events.push({ t: "blocked", side, reason: "par" });
    return false;
  }

  // Last, because everything above it is a reason it never woke up to be
  // confused in the first place.
  if (confusionStops(turn, side)) return false;

  // And after confusion, so a creature that just hit itself is not also
  // asked whether it is too smitten to have done so.
  if (volatiles(turn, side).infatuated && chance(turn, `${side}-love`, INFATUATED_CHANCE)) {
    turn.events.push({ t: "volatile", side, which: "smitten" });
    return false;
  }

  return true;
}

function executeMove(
  turn: Turn,
  side: SideIndex,
  moveId: string,
  /**
   * How many callers this move is standing on. Nought for the move that
   * was chosen; one for the move a Metronome landed on. A called move spends
   * no power points, does not lock a Choice item, and does not ask `canAct`
   * again — the caller already paid all three.
   */
  depth = 0,
): void {
  if (depth > MAX_CALL_DEPTH) return;
  const attacker = active(turn, side);
  if (isFainted(attacker)) return;

  // Sleep Talk is the one move that goes off *because* the user is asleep.
  // `canAct` still runs — the sleep counter still counts down, and a creature
  // that wakes this turn simply moves — but a refusal for sleep is not a
  // refusal for this one move.
  if (depth === 0 && !canAct(turn, side)) {
    const dozing = moveId === "sleeptalk" && active(turn, side).status === "slp";
    if (!dozing) return;
  }

  /**
   * Whether this is a turn the creature already paid for.
   *
   * The second half of a Fly, the third turn of an Outrage, the fourth blow
   * of a Rollout: the power point and the Choice lock were spent when the
   * move was chosen, and charging a creature again for a turn it never got to
   * choose would mean a five-turn Rollout costs five uses of a move with ten.
   */
  const continuing = depth === 0 && volatiles(turn, side).committed === moveId;

  // Weather Ball is the one move whose type is the weather's: twice the
  // power and the weather's type while anything is up, a plain Normal
  // fifty otherwise.
  const weatherUp = weatherNow(turn);
  const base = moveById(moveId);
  const move =
    moveId === "weatherball" && weatherUp
      ? { ...base, type: WEATHER_TYPE[weatherUp], power: 100 }
      : // Pursuit catches what is running. Doubled here, beside Weather Ball,
        // because it is the same shape — a move whose numbers are a fact
        // about the turn rather than about the move — and `turn.pursuing` is
        // set by `resolveTurn`, which is the only thing that knows both
        // sides' chosen actions before either resolves.
        moveId === "pursuit" && turn.pursuing === side
        ? { ...base, power: base.power * 2 }
        : // Rollout and Ice Ball double for every blow already landed in the
          // run, and again for a Defence Curl before it — thirty base power
          // that reaches four hundred and eighty on the fifth, which is the
          // whole gamble of the move.
          moveId === "rollout" || moveId === "iceball"
          ? {
              ...base,
              power:
                base.power *
                2 ** (volatiles(turn, side).rolled ?? 0) *
                (volatiles(turn, side).curled ? 2 : 1),
            }
          : base;
  const struggling = moveId === STRUGGLE;

  // Spent here rather than when the move was chosen: a creature that is
  // asleep, frozen or fully paralysed never got the move off, and charging it
  // for a turn it did not have is how a battle quietly becomes unwinnable.
  // Struggle costs nothing, because it is what having nothing costs you.
  // Committed, if it is holding something that commits it. Written when the
  // move actually goes off rather than when it was chosen, so a turn spent
  // asleep does not lock anything in.
  if (depth === 0 && !continuing && has(attacker, "locked") && !struggling) {
    turn.battle.sides[side].locked = moveId;
  }

  if (depth === 0 && !continuing && !struggling) {
    const slot = attacker.moves.indexOf(moveId);
    if (slot >= 0) setActive(turn, side, spendPp(attacker, slot));
  }

  turn.events.push(struggling ? { t: "struggling", side } : { t: "use", side, moveId });

  // Remembered whatever else happens, because Sketch copies what was *used*
  // rather than what worked.
  turn.battle.sides[side].lastMove = moveId;
  // And what this turn came to, which is a different question — see `Turn.used`.
  turn.used[side] = moveId;

  // The two promises that last exactly until the next move. Taken off here,
  // before anything below can put them back, so Lock-On followed by Lock-On
  // is a fresh lock rather than one consumed by itself, and a Destiny Bond
  // held through a second Destiny Bond is the second one.
  const sure = depth === 0 && Boolean(volatiles(turn, side).sure);
  if (depth === 0 && (sure || volatiles(turn, side).bonded)) {
    mergeVolatiles(turn, side, { sure: undefined, bonded: undefined });
  }

  /*
   * The two moves whose whole identity is a condition on the turn itself.
   *
   * Focus Punch is a hundred and fifty power at minus three priority, which
   * means it goes very nearly last — and any move damage taken before it
   * breaks the concentration. Without this it was simply the strongest
   * Fighting move in the game with a drawback that never fired.
   *
   * Fake Out is forty power at plus three, and only on the turn its user
   * first has. Without that it was a Quick Attack with a worse type.
   */
  if (moveId === "focuspunch" && turn.taken[side].physical + turn.taken[side].special > 0) {
    turn.events.push({ t: "fizzled", side, moveId });
    return;
  }
  if (moveId === "fakeout" && !volatiles(turn, side).fresh) {
    turn.events.push({ t: "fizzled", side, moveId });
    return;
  }

  /*
   * The turn a two-turn move spends being a two-turn move.
   *
   * Before the shield, before the type chart and before accuracy, because
   * none of those are questions about this turn: nothing is being aimed at
   * anybody yet. The creature goes up, goes under, or stands there gathering
   * light, and `committed` is what brings it back here next turn.
   *
   * A charge move that is *continuing* falls straight through to the ordinary
   * path below, which is the whole trick — the second turn of a Fly is a
   * perfectly ordinary ninety-power Flying attack, and every rule that
   * applies to one applies to it.
   */
  if (!continuing && hasFlag(move, "charge") && !chargeSkipped(turn, moveId)) {
    const hidden = HIDES_IN[moveId];
    mergeVolatiles(turn, side, {
      committed: moveId,
      commitment: "charge",
      commitTurns: 1,
      hidden,
    });
    turn.events.push({ t: "volatile", side, which: "charging" });
    // Skull Bash's guard, Meteor Beam's and Electro Shot's Sp. Atk. Applied
    // now rather than with the blow, because a charge that is worth something
    // is worth something during the turn you are exposed for.
    const gained = CHARGE_BOOSTS[moveId];
    if (gained) applyBoosts(turn, side, gained);
    return;
  }

  // Arrived. Cleared before anything below reads it, so the blow itself is
  // thrown by a creature standing in the ordinary place.
  if (continuing && volatiles(turn, side).commitment === "charge") {
    mergeVolatiles(turn, side, {
      committed: undefined,
      commitment: undefined,
      commitTurns: undefined,
      hidden: undefined,
    });
  }

  /*
   * Bide, which is two moves in one and neither of them is an attack.
   *
   * Turns one and two are spent taking it — nothing is aimed, nothing lands,
   * and `turn.taken` does the accumulating because it is already counting
   * exactly the thing Bide wants counted. Turn three gives back twice the
   * total, as damage that no type chart and no critical hit touch.
   *
   * Handled here rather than in `moves.ts` with the other thirty-nine
   * computed damages because it is not a formula: it is a move that spends
   * two turns doing nothing and then a third doing something, and `moves.ts`
   * is asked once, at the moment of the blow.
   */
  if (move.volatile === "bide") {
    const stored = volatiles(turn, side);
    if (!continuing) {
      mergeVolatiles(turn, side, {
        committed: moveId,
        commitment: "rage",
        commitTurns: BIDE_TURNS,
        biding: BIDE_TURNS,
        bided: 0,
      });
      turn.events.push({ t: "volatile", side, which: "biding" });
      return;
    }
    const left = (stored.biding ?? 0) - 1;
    if (left > 0) {
      mergeVolatiles(turn, side, { biding: left, commitTurns: left });
      turn.events.push({ t: "volatile", side, which: "biding" });
      return;
    }

    const owed = (stored.bided ?? 0) * BIDE_RETURN;
    mergeVolatiles(turn, side, {
      committed: undefined,
      commitment: undefined,
      commitTurns: undefined,
      biding: undefined,
      bided: undefined,
    });
    if (owed <= 0) {
      // Nothing was ever thrown at it, so there is nothing to give back. Its
      // own sentence rather than a hit for zero, for the same reason every
      // other computed-damage move says `fizzled`.
      turn.events.push({ t: "fizzled", side, moveId });
      return;
    }
    turn.events.push({ t: "volatile", side, which: "unleashed" });
    landDamage(turn, side, move, owed, 4, false);
    return;
  }

  const defender = active(turn, other(side));

  /*
   * Future Sight and Doom Desire: thrown now, arriving in two turns.
   *
   * Before the shield, because the whole point of a move that lands later is
   * that nothing standing in the way now can stop it — a Protect put up this
   * turn is long over by the time it comes down.
   *
   * The number is settled here rather than on arrival. `Combatant.future`
   * says why at length: the alternative is keeping the attacker whole and
   * running the formula against a slot it may no longer be standing in, and a
   * snapshot of a creature that has since evolved or fainted is a worse lie
   * than a fixed number. What the move promises is "this much, in two turns,
   * to whoever is there", and that is exactly what it does.
   */
  if (hasFlag(move, "futuremove")) {
    if (turn.battle.sides[other(side)].future) {
      turn.events.push({ t: "fizzled", side, moveId });
      return;
    }
    const shot = damageFor(turn, side, move, move.power);
    // The immunity is the one thing the shield-bypass must not bypass. Asked
    // here rather than left to the ordinary check below, because this branch
    // sits in front of it — and a Psychic blow stored against a Dark type
    // would otherwise arrive in two turns as a hit for nothing, which is the
    // reading of the log the `fizzled` event exists to prevent.
    if (shot.quarters === 0) {
      turn.events.push({ t: "immune", side: other(side) });
      return;
    }
    turn.battle.sides[other(side)].future = {
      turns: FUTURE_TURNS,
      moveId,
      amount: shot.amount,
      quarters: shot.quarters,
    };
    return;
  }

  /*
   * It is not here.
   *
   * A creature part-way through a Fly is in the sky, a Dig is underground and
   * a Phantom Force is out of the world entirely, and a move aimed at where
   * it was standing finds nothing. Checked before the shield rather than
   * after because being absent is not being defended: there is no Protect to
   * break and no contact to punish.
   *
   * The handful of moves that reach anyway are the price of the mechanic —
   * without them two turns of invulnerability would cost nothing at all.
   */
  const away = volatiles(turn, other(side)).hidden;
  if (away && move.target !== "self" && !reachesHidden(move, away)) {
    turn.events.push({ t: "miss", side });
    return;
  }

  // Protect and its family. Before the type chart and before accuracy, because
  // a shield is not a dodge: it stops the move outright, and a move that was
  // going to miss anyway should still read as blocked.
  //
  // A move that targets the user goes through — you cannot Protect yourself
  // out of your own Swords Dance, and in a game that is 1v1 throughout every
  // other move is aimed at the one creature opposite.
  if (move.target !== "self" && behindShield(turn, other(side))) {
    turn.events.push({ t: "shielded", side: other(side) });
    return;
  }

  // Psychic Terrain: nothing with priority reaches something on the ground.
  // Prankster's plus counts, which is why it is asked of `priorityOf`.
  if (
    move.target !== "self" &&
    terrainNow(turn) === "psychic" &&
    priorityOf(turn, side, moveId) > 0 &&
    grounded(turn, other(side))
  ) {
    turn.events.push({ t: "fizzled", side, moveId });
    return;
  }

  // The healing has to happen even though nothing landed, which is why this
  // is not folded into `landsAs` — that answers a question, and this one has
  // a consequence.
  const drinking = drinker(defender, move);
  if (drinking) {
    turn.events.push({ t: "ability", side: other(side), abilityId: drinking.id });
    if (drinking.effect.t === "absorb") {
      const mended = applyHeal(
        turn,
        other(side),
        Math.max(1, Math.floor(maxHp(defender) / drinking.effect.share)),
      );
      if (mended > 0) turn.events.push({ t: "heal", side: other(side), amount: mended });
    } else {
      turn.events.push({ t: "immune", side: other(side) });
    }
    return;
  }

  const quarters = effectiveness(
    move.type,
    typesAgainst(attacker, defender, move, volatiles(turn, other(side))),
  );
  // Struggle is the exception to the type chart. It has to be: a creature out
  // of moves facing something its last resort cannot touch would be stuck in
  // a battle with no way to act and no way to lose.
  if (!struggling && move.category !== "status" && quarters === 0) {
    turn.events.push({ t: "immune", side: other(side) });
    return;
  }

  // Magnet Rise and Telekinesis: a Ground attack passes underneath. Only
  // attacks — a Sand Attack is Ground-typed and still lands, because it is
  // thrown rather than felt through the floor.
  if (move.type === "ground" && move.category !== "status" && (volatiles(turn, other(side)).afloat ?? 0) > 0) {
    turn.events.push({ t: "immune", side: other(side) });
    return;
  }

  // Compound Eyes, No Guard and Hustle. Accuracy of 0 in the manifest means
  // the move cannot miss to begin with.
  let accuracy = move.accuracy;
  // A Lock-On taken last turn is the one thing that makes a Fissure certain.
  let unmissable = accuracy === 0 || sure;
  // Thunder and Hurricane cannot miss in the rain and are a coin in the sun;
  // Blizzard cannot miss in hail or snow. Sand Veil and Snow Cloak are the
  // target's weather, and read like a Bright Powder.
  if (weatherUp === "rain" && (moveId === "thunder" || moveId === "hurricane")) unmissable = true;
  if (weatherUp === "sun" && (moveId === "thunder" || moveId === "hurricane")) accuracy = 50;
  if ((weatherUp === "hail" || weatherUp === "snow") && moveId === "blizzard") unmissable = true;
  for (const effect of effects(defender, "weatherGraze")) {
    if (weatherUp && effect.weather.includes(weatherUp)) accuracy = scaled(accuracy, effect.mille);
  }
  for (const effect of effects(attacker, "aim")) {
    // A Zoom Lens is worth having only when it moves second, which is the one
    // thing that separates it from a Wide Lens.
    if (effect.when === "late" && turn.movingLast !== side) continue;
    if (effect.mille === 0) unmissable = true;
    else accuracy = Math.min(100, scaled(accuracy, effect.mille));
  }
  // Hustle's cost: the same ability that raises Attack makes physical moves
  // less accurate, which is the trade it exists to offer.
  if (attacker.abilities.includes("hustle") && move.category === "physical") {
    accuracy = scaled(accuracy, 800);
  }
  // Bright Powder, which is the target's business rather than the attacker's.
  // Applied after `aim` so No Guard still cannot miss: an unmissable move is
  // unmissable, and a powder does not make it a coin flip.
  for (const effect of effects(active(turn, other(side)), "graze")) {
    accuracy = scaled(accuracy, effect.mille);
  }

  // The two stage ladders, which is what Sand Attack and Double Team move.
  // One combined fraction rather than two roundings, so lowering accuracy by a
  // stage and raising evasion by a stage cancel exactly.
  if (!unmissable && accuracy > 0) {
    const [an, ad] = aimFactor(aimOf(turn, side).accuracy);
    const [en, ed] = aimFactor(aimOf(turn, other(side)).evasion);
    accuracy = Math.max(1, Math.min(100, Math.floor((accuracy * an * ed) / (ad * en))));
  }

  if (!unmissable && accuracy > 0 && !chance(turn, `${side}-acc`, accuracy)) {
    turn.events.push({ t: "miss", side });
    return;
  }

  let dealt = 0;
  if (move.category !== "status") {
    // Thirty-nine moves in the manifest ship `power: 0` because Showdown
    // computes their damage in a script. moves.ts is that script; this is the
    // one place it is asked. Before it was wired in, every one of them burned
    // a turn and did exactly nothing — Seismic Toss, Night Shade, Fissure,
    // Return, Flail, Gyro Ball, the whole counter family.
    const variable = hasVariableDamage(move)
      ? variableDamage(move, damageContext(turn, side, moveId))
      : ({ t: "power", power: move.power } as const);

    if (variable.t === "fails") {
      // And nothing after it. A Spit Up with nothing stockpiled has no
      // counter to spend, and an Endeavor that found nothing to do has no
      // damage for anything below to read.
      turn.events.push({ t: "fizzled", side, moveId });
      return;
    } else if (variable.t === "exact") {
      // Exactly this many hit points. No crit, no roll, no same-type bonus and
      // no type multiplier — immunity already had its say above, and that is
      // the whole point of a move that states a number.
      dealt = landDamage(turn, side, move, variable.amount, 4, false);
    } else if (variable.power > 0) {
      // Once for nearly everything, and two to five times for the
      // thirty-one moves the manifest says otherwise about.
      //
      // The loop is here rather than around the whole move on purpose. Each
      // blow rolls its own damage, its own crit and its own type multiplier,
      // which is what makes five of them read as five; but the accuracy check
      // above happens once for the move, and everything below — drain,
      // recoil, a Life Orb's cut, the secondary effect — happens once for the
      // move as well, off the *total*. Draining a fifth of each blow
      // separately and rounding five times is not the same number.
      const swings = hitsOf(turn, side, move);
      let landed = 0;

      for (let blow = 0; blow < swings; blow++) {
        // Nothing swings at something already down. A five-hit move that
        // knocked the target out on its second blow would otherwise go on
        // hitting a fainted creature three more times, and the log would say
        // so.
        if (isFainted(active(turn, other(side)))) break;

        // Triple Kick, Triple Axel and Population Bomb roll again for every
        // blow and stop at the first one that misses. The check above was the
        // first blow's; this is the rest of them, against the same odds,
        // because everything that went into `accuracy` is a fact about the
        // turn rather than about the blow.
        if (blow > 0 && move.multiaccuracy && !unmissable && accuracy > 0) {
          if (!chance(turn, `${side}-acc-${blow}`, accuracy)) break;
        }

        const result = damageFor(
          turn,
          side,
          move,
          powerOfBlow(move, variable.power, blow),
          blow,
        );
        dealt += landDamage(turn, side, move, result.amount, result.quarters, result.crit);
        landed++;
      }

      // Said for every multi-strike move, even the one that landed once,
      // because for these thirty-one "how many" is the interesting half of
      // what happened and a silent single hit reads as an ordinary blow.
      if (move.multihit && landed > 0) turn.events.push({ t: "hits", side, count: landed });
    }
  }

  /*
   * The move connected.
   *
   * Here rather than in `landDamage`, which is where it started and which was
   * subtly the wrong question: `landDamage` answers "did this deal damage",
   * and what `afterMove` actually needs is "was this move stopped" — a
   * difference that does not exist for an Explosion and is the whole of
   * Memento, a status move that deals nothing and must still cost its user
   * everything.
   *
   * Everything that stops a move has already returned by this line: the
   * shield, the type chart's immunity, the accuracy roll, and a
   * variable-damage move that found nothing to do. So reaching it *is* the
   * answer, for a status move and an attack alike.
   */
  turn.connected[side] = true;

  if (move.heal) {
    const healed = applyHeal(turn, side, Math.floor((maxHp(attacker) * move.heal[0]) / move.heal[1]));
    if (healed > 0) turn.events.push({ t: "heal", side, amount: healed });
  }

  if (move.drain && dealt > 0) {
    // A Big Root: a share more of what was drained. Applied to the amount
    // rather than to the fraction, so the arithmetic stays integer.
    let drawn = Math.max(1, Math.floor((dealt * move.drain[0]) / move.drain[1]));
    for (const effect of effects(attacker, "roots")) drawn = scaled(drawn, effect.mille);
    const healed = applyHeal(turn, side, drawn);
    if (healed > 0) turn.events.push({ t: "heal", side, amount: healed });
  }

  // Rock Head. Struggle's own cost is below and is not recoil in this sense —
  // it is what having nothing left costs you, and nothing waives it.
  if (move.recoil && dealt > 0 && !has(attacker, "reckless")) {
    const taken = applyDamage(turn, side, Math.max(1, Math.floor((dealt * move.recoil[0]) / move.recoil[1])));
    if (taken > 0) turn.events.push({ t: "recoil", side, amount: taken });
  }

  // A Life Orb's share of its own health, paid for having attacked at all.
  //
  // A share of its *maximum* rather than of the damage, which is why it is not
  // recoil and why Rock Head does not waive it: recoil is the cost of a move,
  // and this is the cost of the orb. Paid only when the move actually did
  // something, so a miss is free — the orb takes a cut, and there is nothing
  // to take a cut of.
  if (dealt > 0) {
    for (const effect of effects(active(turn, side), "toll")) {
      const holder = active(turn, side);
      const cost = applyDamage(turn, side, Math.max(1, Math.floor(maxHp(holder) / effect.share)));
      if (cost > 0) turn.events.push({ t: "recoil", side, amount: cost });
      usedItem(turn, side, "toll");
    }
  }

  // Struggle's own cost, which is a share of the user's own health rather
  // than of the damage it dealt. The manifest cannot say so — Showdown
  // computes it in a script — so it is named here, the way moves.ts names the
  // other formulas the data cannot hold.
  if (struggling) {
    const share = Math.max(1, Math.floor((maxHp(attacker) * STRUGGLE_RECOIL[0]) / STRUGGLE_RECOIL[1]));
    const taken = applyDamage(turn, side, share);
    if (taken > 0) turn.events.push({ t: "recoil", side, amount: taken });
  }

  /*
   * What the move cost the creature that used it.
   *
   * Close Combat's guard, Overheat's Sp. Atk, Superpower spending the very
   * Attack it just hit with — and Diamond Storm's coin-flip reward, which is
   * the same shape read the other way. Seventeen moves, and every one of them
   * was strictly better in this game than it is meant to be.
   *
   * Three things about where and how this is applied:
   *
   * **Gated on having dealt damage**, and that gate is a floor rather than a
   * live case. A miss, an immunity and a shield all return long before here,
   * so the only thing it excludes is a move that landed for nothing at all —
   * which today means a variable-damage move that fizzled, and none of the
   * seventeen have variable damage. It was kept after being measured, not
   * before: a `selfBoosts` added to an Endeavor later should not charge a
   * stage for a blow that did nothing, and that is not a thing to leave
   * depending on nobody ever doing it.
   *
   * **Not gated on the target surviving.** A Close Combat that knocks
   * something out still drops the guard, which is exactly the trade the move
   * is: the cost is paid for having swung, and the swing landed.
   *
   * **`byOther` left false**, so a Mist and a Clear Body do not block it.
   * Those answer "can the other side lower my stages", and this is not the
   * other side.
   */
  if (
    move.selfBoosts &&
    dealt > 0 &&
    chance(turn, `${side}-selfboost`, move.selfBoosts.chance)
  ) {
    applyBoosts(turn, side, move.selfBoosts.boosts);
  }

  if (move.status) {
    // Through the normaliser, so a condition the manifest has and this engine
    // does not lands as the nearest one it does rather than as a crash.
    const condition = conditionOf(move.status);
    if (condition) applyStatus(turn, other(side), condition, `${side}-status`);
  }
  if (move.boosts) {
    const onSelf = move.target === "self";
    applyBoosts(turn, onSelf ? side : other(side), move.boosts, !onSelf);
  }

  // Everything the manifest could not say. Asked for every move rather than
  // only for status moves, because Swagger is a boost move missing its
  // confusion and Dynamic Punch is an attack missing the same thing.
  //
  // `did` starts at whether the row itself accomplished anything, so a move
  // whose only content is here can report `fizzled` when it finds nothing to
  // do, and one that hit for damage never claims to have failed.
  const extras = extraEffects(moveId);
  if (extras.length) {
    let did = dealt > 0 || Boolean(move.status) || Boolean(move.boosts) || Boolean(move.heal);
    for (const effect of extras) {
      if (applyMoveEffect(turn, side, effect)) did = true;
      // A move that ended the battle — Roar in the grass — has nothing more
      // to do, and the events after it would read as happening afterwards.
      if (turn.battle.outcome) return;
    }
    if (!did) turn.events.push({ t: "fizzled", side, moveId });
  }

  // Shield Dust: the side effects of a move used on it never land. Its own
  // self-targeting secondaries are not "used on it", so they still do.
  const shielded = has(active(turn, other(side)), "unfazed");
  const secondary = move.secondary;
  if (
    secondary &&
    !(shielded && !secondary.self) &&
    !isFainted(active(turn, other(side))) &&
    chance(turn, `${side}-sec`, secondary.chance)
  ) {
    if (secondary.status) {
      // The same normaliser, because a secondary is the other road to a status
      // and one road being safe is not the same as the status being safe.
      const condition = conditionOf(secondary.status);
      if (condition) applyStatus(turn, other(side), condition, `${side}-secstatus`);
    }
    if (secondary.boosts) {
      applyBoosts(turn, secondary.self ? side : other(side), secondary.boosts, !secondary.self);
    }
    /*
     * The third thing a secondary can be, and the one that was being dropped.
     *
     * Twenty-eight moves flinch and eleven confuse, and until the manifest
     * carried `secondary.volatile` every one of them was a plain attack: Iron
     * Head was eighty power and nothing else, Rock Slide was seventy-five,
     * and Dynamic Punch was a hundred that missed half the time in exchange
     * for nothing whatsoever.
     *
     * A flinch is only worth something from the side that moved first, and
     * nothing enforces that here — it does not need to. The flinch is written
     * onto the target and read by `canAct`, which the target has already been
     * through if it moved first. Slower flinches are cleared unread at the
     * end of the turn, which is the mechanic rather than a hole in it.
     */
    if (secondary.volatile === "flinch" && !secondary.self) {
      mergeVolatiles(turn, other(side), { flinched: true });
    }
    if (secondary.volatile === "confusion" && !secondary.self) {
      confuseSide(turn, other(side));
    }
  }

  /*
   * Wrap, Fire Spin, Whirlpool and the seven others.
   *
   * After everything else, and gated on the blow having landed, because a
   * bind is a consequence of the hit rather than of the move: a Wrap that
   * missed has nothing to hold on to.
   *
   * The turn count is rolled here rather than fixed, because four turns and
   * five are worth meaningfully different amounts and a bind that was always
   * the longer one would be a different move. Named like every other roll in
   * the file, so a battle stays a pure function of its seed.
   */
  if (move.volatile === "partiallytrapped" && dealt > 0 && !isFainted(active(turn, other(side)))) {
    if (!volatiles(turn, other(side)).bound) {
      const [least, most] = BIND_TURNS;
      const turns = least + intBelow(rngFor(turn.battle.seed, turn.battle.tag, turn.battle.turn, `${side}-bind`), most - least + 1);
      mergeVolatiles(turn, other(side), { bound: turns });
      turn.events.push({ t: "volatile", side: other(side), which: "bound" });
    }
  }

  // Defence Curl, whose only lasting effect is that a Rollout after it is
  // worth twice as much. The stage it also gives is in the manifest and
  // already applied above; this is the half the data could not say.
  if (moveId === "defensecurl") mergeVolatiles(turn, side, { curled: true });
}

/**
 * This side has now had a turn, so it is no longer new here.
 *
 * One line, and its own function only so that the three places `resolveTurn`
 * resolves a move slot cannot come to disagree about when it happens. Spent
 * whatever the turn came to — asleep, flinched, missed — because "has had a
 * turn" is what Fake Out asks, and a turn spent asleep is a turn had.
 */
function spendFreshness(turn: Turn, side: SideIndex): void {
  if (volatiles(turn, side).fresh) mergeVolatiles(turn, side, { fresh: undefined });
}

/**
 * The blow thrown two turns ago, arriving.
 *
 * On the side rather than on the creature, so it lands on whoever is standing
 * there — which is the entire reason to throw one. Past the shield, past the
 * type chart and past accuracy, all of which had their say when it was thrown.
 */
function ageFuture(turn: Turn, side: SideIndex): void {
  const pending = turn.battle.sides[side].future;
  if (!pending) return;

  const left = pending.turns - 1;
  if (left > 0) {
    turn.battle.sides[side].future = { ...pending, turns: left };
    return;
  }

  turn.battle.sides[side].future = undefined;
  if (isFainted(active(turn, side))) return;

  turn.events.push({ t: "use", side: other(side), moveId: pending.moveId });
  const dealt = applyDamage(turn, side, pending.amount);
  turn.events.push({ t: "damage", side, amount: dealt, quarters: pending.quarters, crit: false });
}

/**
 * What a move leaves behind, asked once per side per turn.
 *
 * All of this could have gone at the bottom of `executeMove`, and none of it
 * could have gone there *correctly*: that function returns early from a dozen
 * places — a miss, an immunity, a shield, a fizzle — and every one of those is
 * a case where some of the bookkeeping below still has to happen and the rest
 * must not. A Hyper Beam that misses still spends the next turn recovering; a
 * U-turn that misses does not leave. Putting it here, past every early
 * return, is what makes the difference expressible.
 *
 * It reads `lastMove` rather than the move that was chosen, so a Metronome
 * that landed on Hyper Beam recharges — the creature used the beam, whatever
 * it meant to use.
 *
 * Called only for the chosen move, from `resolveTurn`, which is what keeps a
 * called move from switching its user out twice.
 */
function afterMove(turn: Turn, side: SideIndex): void {
  const moveId = turn.used[side];
  if (!moveId || moveId === STRUGGLE) return;
  const move = moveById(moveId);
  const landed = turn.connected[side];
  const held = volatiles(turn, side);

  // Still up in the air, or still gathering light. Nothing below applies to a
  // turn in which the move has not gone off yet.
  if (held.commitment === "charge" && held.committed === moveId) return;
  // Bide keeps its own counter and clears its own commitment.
  if (held.biding) return;

  /*
   * The ten beam moves. Set whether or not the blow landed, which is the
   * whole risk of them: a hundred and fifty power that misses costs a turn to
   * throw and another to recover from.
   *
   * Not set when the user is already down — a fainted creature's next turn is
   * a switch, and a recharge waiting on the one after it would be a turn
   * stolen from whoever comes in.
   */
  if (hasFlag(move, "recharge") && !isFainted(active(turn, side))) {
    mergeVolatiles(turn, side, { recharging: true });
  }

  /*
   * Outrage, Thrash, Petal Dance, Raging Fury: two turns or three of the same
   * move, and confusion when the rampage runs out.
   *
   * The confusion is the price and it is not optional — a rampage that ended
   * quietly would be a hundred and twenty power with no drawback at all,
   * which is exactly the state these four were in.
   */
  if (move.selfVolatile === "lockedmove") {
    if (held.commitment === "rage" && held.committed === moveId) {
      const left = (held.commitTurns ?? 1) - 1;
      if (left > 0) {
        mergeVolatiles(turn, side, { commitTurns: left });
      } else {
        mergeVolatiles(turn, side, {
          committed: undefined,
          commitment: undefined,
          commitTurns: undefined,
        });
        turn.events.push({ t: "volatile", side, which: "raging" });
        // On the user. That is the price of the rampage, and applying it to
        // the other side — which is what the foe-only effect did — turns a
        // drawback into a bonus.
        confuseSide(turn, side);
      }
    } else if (landed) {
      // Only a rampage that connected becomes a rampage. One that hit nothing
      // — an immunity, a shield — has not started, which spares the user the
      // confusion for a move that never happened.
      const [least, most] = RAGE_TURNS;
      const turns =
        least +
        intBelow(rngFor(turn.battle.seed, turn.battle.tag, turn.battle.turn, `${side}-rage`), most - least + 1);
      mergeVolatiles(turn, side, {
        committed: moveId,
        commitment: "rage",
        commitTurns: turns - 1,
      });
    }
  }

  /*
   * Rollout and Ice Ball: five turns, doubling, and the run ends the moment
   * one of them misses.
   *
   * The streak is what the power reads, and the commitment is what forces the
   * next turn; they end together because a run that kept its streak across a
   * miss would let a player re-enter it at four hundred and eighty power.
   */
  if (moveId === "rollout" || moveId === "iceball") {
    const run = (held.rolled ?? 0) + 1;
    if (!landed || run >= ROLL_TURNS) {
      mergeVolatiles(turn, side, {
        committed: undefined,
        commitment: undefined,
        commitTurns: undefined,
        rolled: undefined,
      });
    } else {
      mergeVolatiles(turn, side, {
        committed: moveId,
        commitment: "roll",
        commitTurns: ROLL_TURNS - run,
        rolled: run,
      });
    }
  }

  /*
   * Explosion, Self-Destruct, Memento: the user does not survive its own move.
   *
   * Here rather than at the bottom of `executeMove` for the reason everything
   * else in this function is: `"always"` has to be paid past every early
   * return in that function — an Explosion that met a Ghost, or broke on a
   * Protect, still goes off — and only a hook past them all can say so.
   *
   * Healing Wish and Lunar Dance are `"ifHit"` upstream and already faint
   * their user through `sacrifice`, which does more than faint it: it leaves
   * the blessing that mends whoever comes next. Skipping anything with a
   * `statusmoves.ts` entry is the same rule `selfSwitch` follows below, and it
   * is what stops the two paths fainting the same creature twice.
   */
  if (move.selfdestruct && !extraEffects(moveId).length && !isFainted(active(turn, side))) {
    const paid = move.selfdestruct === "always" || landed;
    if (paid) {
      const user = active(turn, side);
      const spent = applyDamage(turn, side, user.hp);
      // A `recoil`, not a `faint`: `settle` is what announces a fainting, at
      // the bottom of the turn and for both sides at once, and a second one
      // pushed from here would read as the creature going down twice.
      if (spent > 0) turn.events.push({ t: "recoil", side, amount: spent });
    }
  }

  if (turn.battle.outcome) return;

  /*
   * U-turn, Volt Switch, Flip Turn: hit, and go.
   *
   * `"true"` only. Baton Pass is `"copyvolatile"` and Shed Tail is
   * `"shedtail"`, and both want stages carried across the switch — a mechanic
   * this engine does not have and `docs/moves-deferred.md` files as its own
   * heading. Honouring them here would turn Baton Pass into a strictly worse
   * U-turn, which is the half-working kind of wrong this codebase spends a
   * document arguing against.
   *
   * Moves with an entry in `statusmoves.ts` are skipped: Teleport, Chilly
   * Reception and Revival Blessing all carry `selfSwitch` upstream and all
   * three already do their own leaving through `retreat`. Two switches for
   * one move would put somebody else out and then somebody else again.
   */
  if (move.selfSwitch === "true" && landed && !extraEffects(moveId).length) {
    const combatant = turn.battle.sides[side];
    const next = combatant.team.findIndex((one, at) => at !== combatant.active && !isFainted(one));
    // Nothing to go to is not a failure — the move hit, and the user simply
    // stays. That is what it does in the games, and it keeps a lone creature
    // from being unable to use a move it legally knows.
    if (next >= 0 && !isFainted(active(turn, side))) switchTo(turn, side, next);
  }

  /*
   * Dragon Tail and Circle Throw: the blow lands, and whoever took it is out.
   *
   * The same shape as Roar's `forceOut`, reached the other way round —
   * through a move row rather than through a status effect — because these
   * two do damage first and the manifest is where "and then they leave" is
   * recorded for them.
   */
  if (
    move.forceSwitch &&
    landed &&
    // Roar and Whirlwind carry `forceSwitch` upstream *and* have a
    // `statusmoves.ts` entry that already drives the target out. The same
    // skip `selfSwitch` and `selfdestruct` use, and it earned its place here
    // the hard way: without it Roar pulled the replacement out and then put
    // the original straight back, which reads in the log as nothing having
    // happened at all.
    !extraEffects(moveId).length &&
    !isFainted(active(turn, other(side)))
  ) {
    applyMoveEffect(turn, side, { t: "forceOut" });
  }
}

/**
 * Flame Orb and Toxic Orb: the holder gives itself something.
 *
 * Through `applyStatus`, so a Water Veil ignores its own Flame Orb and a Fire
 * type cannot be burned by one — every road to a condition goes down the one
 * predicate, which is what stops an item quietly overruling an immunity.
 */
function afflictSelf(turn: Turn, side: SideIndex): void {
  const creature = active(turn, side);
  if (creature.status) return;

  for (const effect of effects(creature, "afflict")) {
    applyStatus(turn, side, effect.status, `${side}-orb`);
    if (active(turn, side).status === effect.status) usedItem(turn, side, "afflict");
  }
}

/**
 * Leftovers and Black Sludge, at the end of the turn.
 *
 * `only` is what makes one item two: a Black Sludge is Leftovers for a poison
 * type and a slow bleed for anything else, and expressing that as a list of
 * types who like it beats two nearly identical shapes.
 */
function tickHealth(turn: Turn, side: SideIndex): void {
  for (const effect of effects(active(turn, side), "tick")) {
    const creature = active(turn, side);
    const step = Math.max(1, Math.floor(maxHp(creature) / effect.share));
    const welcome =
      !effect.only || typesOf(turn, side).some((type) => effect.only!.includes(type));

    if (welcome) {
      const room = maxHp(creature) - creature.hp;
      if (room <= 0) continue;
      setActive(turn, side, { ...creature, hp: creature.hp + Math.min(room, step) });
      turn.events.push({ t: "heal", side, amount: Math.min(room, step) });
    } else {
      const bite = applyDamage(turn, side, step);
      turn.events.push({ t: "recoil", side, amount: bite });
    }
    usedItem(turn, side, "tick");
  }
}

/**
 * The berries that wait for a moment and then take it.
 *
 * Checked at the end of the turn rather than the instant health crosses the
 * line, which is a deliberate simplification and the honest one to make: the
 * alternative is a check inside every path that can reduce health, and a berry
 * that fires on four of five such paths is worse than one that always fires a
 * beat late. The log says when it happened either way.
 */
function eatBerry(turn: Turn, side: SideIndex): void {
  // A condition it is carrying the answer to.
  for (const effect of effects(active(turn, side), "cure")) {
    const creature = active(turn, side);
    if (!creature.status) continue;
    if (effect.status && effect.status !== creature.status) continue;
    setActive(turn, side, { ...creature, status: null, sleepTurns: 0 });
    usedItem(turn, side, "cure");
  }

  // Health, when it has fallen far enough.
  for (const effect of effects(active(turn, side), "snack")) {
    const creature = active(turn, side);
    if (creature.hp * effect.below >= maxHp(creature)) continue;

    const back = effect.amount ?? Math.max(1, Math.floor(maxHp(creature) / (effect.share ?? 4)));
    const room = maxHp(creature) - creature.hp;
    if (room <= 0) continue;
    setActive(turn, side, { ...creature, hp: creature.hp + Math.min(room, back) });
    turn.events.push({ t: "heal", side, amount: Math.min(room, back) });
    usedItem(turn, side, "snack");
  }

  // A stage, when things are going badly.
  for (const effect of effects(active(turn, side), "pinch")) {
    const creature = active(turn, side);
    if (creature.hp * effect.below >= maxHp(creature)) continue;
    applyBoosts(turn, side, { [effect.stat]: effect.delta });
    usedItem(turn, side, "pinch");
  }
}

/** Burn and poison, at the end of the turn. */
function residual(turn: Turn, side: SideIndex): void {
  const creature = active(turn, side);
  if (isFainted(creature) || !creature.status) return;
  if (creature.status !== "brn" && creature.status !== "psn") return;

  const fraction = creature.status === "brn" ? 16 : 8;
  const amount = applyDamage(turn, side, Math.max(1, Math.floor(maxHp(creature) / fraction)));
  turn.events.push({ t: "residual", side, status: creature.status, amount });
}

/**
 * What the side the player is not driving does.
 *
 * Uniform among its moves. A wild animal is not running a damage calculator,
 * and a trainer who did would need a difficulty curve of its own — worth
 * having, but it is a design problem rather than a plumbing one, and it can
 * arrive later without anything else moving.
 *
 * A side owing a replacement sends out its first healthy member, because the
 * engine will accept nothing else from it.
 */
export function aiAction(state: BattleState, side: SideIndex = 1): BattleAction {
  if (state.awaitingSwitch[side]) {
    const next = state.sides[side].team.findIndex((creature) => !isFainted(creature));
    return next >= 0 ? { t: "switch", partyIndex: next } : { t: "pass" };
  }

  const active = activeOf(state, side);
  if (!active.moves.length) return { t: "pass" };
  // Out of everything, or holding something that has taken everything else
  // off the menu. Either way there is one thing left to do.
  if (!anyPp(active) || !hasLegalMove(state, side)) return { t: "struggle" };

  // Only from what it can actually still use. Picking blind and then being
  // refused would leave the other side taking a free turn every time.
  // Only from what it can actually still use, and only what it is allowed to:
  // an Assault Vest or a Choice item narrows the menu, and picking outside it
  // and being refused would hand the other side a free turn every time.
  const usable = active.moves
    .map((_, at) => at)
    .filter((at) => hasPp(active, at) && actionRefusal(state, side, { t: "fight", moveIndex: at }) === null);
  if (!usable.length) return { t: "struggle" };

  const roll = intBelow(rngFor(state.seed, state.tag, state.turn + 1, `ai${side}`), usable.length);
  return { t: "fight", moveIndex: usable[roll] };
}

/**
 * A move's priority, and what Prankster does to it.
 *
 * Dark types are immune to it in the games because Prankster is mischief, and
 * that reading is worth keeping: it is the one line in the ability that stops
 * it being simply "status moves go first, always".
 */
function priorityOf(turn: Turn, side: SideIndex, moveId: string | null): number {
  if (!moveId) return 0;
  const move = moveById(moveId);
  if (move.category !== "status") return move.priority;

  if (typesOf(turn, other(side)).includes("dark")) return move.priority;

  const plus = effects(active(turn, side), "quick").reduce((sum, one) => sum + one.plus, 0);
  return move.priority + plus;
}

/** Who moves first: priority, then speed, then a seeded coin. */
function firstMover(turn: Turn, moveA: string | null, moveB: string | null): SideIndex {
  const priorityA = priorityOf(turn, 0, moveA);
  const priorityB = priorityOf(turn, 1, moveB);
  if (priorityA !== priorityB) return priorityA > priorityB ? 0 : 1;

  // Quick Claw, inside the priority bracket rather than above it: a claw does
  // not beat a Quick Attack, it beats being slow. Side 0 is asked first and
  // only one can win, so two claws cannot both fire.
  for (const side of [0, 1] as SideIndex[]) {
    for (const effect of effects(active(turn, side), "gamble")) {
      if (roll(turn, `${side}-claw`) * 1000 >= effect.mille) continue;
      turn.events.push({
        t: "item",
        side,
        itemId: active(turn, side).heldItem ?? "",
        spent: false,
      });
      return side;
    }
  }

  const speedA = speedOf(turn, 0);
  const speedB = speedOf(turn, 1);
  if (speedA !== speedB) return speedA > speedB ? 0 : 1;

  return roll(turn, "speedtie") < 0.5 ? 0 : 1;
}

// --------------------------------------------------------------- catching

/**
 * Vanilla's shape, in integers: a full-health target is worth about a third
 * of its catch rate, a nearly-fainted one close to all of it, and a status
 * condition is worth roughly a further half again.
 */
export function catchOdds(wild: Individual, ballMult: number): number {
  const max = maxHp(wild);
  const rate = speciesById(wild.speciesId).catchRate;
  const hpTerm = Math.floor(((3 * max - 2 * wild.hp) * rate * ballMult) / (3 * max * 1000));
  const statusBonus = wild.status === "slp" || wild.status === "frz" ? 2000 : wild.status ? 1500 : 1000;
  return Math.max(1, Math.min(255, Math.floor((hpTerm * statusBonus) / 1000)));
}

// --------------------------------------------------------------- the turn

export interface TurnResult {
  battle: BattleState;
  /** The creature caught this turn, if any. The caller owns where it goes. */
  caught: Individual | null;
  ballsUsed: number;
}

export class IllegalAction extends Error {}

/**
 * Resolves one battle turn from both sides' actions.
 *
 * Pure in (battle, actions, rules, balls): the same arguments always produce
 * the same turn, which is what lets a save file be replayed and a duel be
 * checked by both peers independently.
 */
export function resolveTurn(
  state: BattleState,
  actions: [BattleAction, BattleAction],
  rules: BattleRules = WILD_RULES,
  balls = 0,
): TurnResult {
  if (state.outcome) throw new IllegalAction("battle is already over");

  const turn: Turn = {
    rules,
    taken: [
      { physical: 0, special: 0 },
      { physical: 0, special: 0 },
    ],
    connected: [false, false],
    used: [null, null],
    battle: {
      ...state,
      turn: state.turn + 1,
      sides: [cloneSide(state.sides[0]), cloneSide(state.sides[1])],
      awaitingSwitch: [...state.awaitingSwitch],
      sharing: [...state.sharing],
      field: state.field ? { ...state.field } : undefined,
      events: [],
    },
    events: [],
  };

  // A side owing a replacement must send one out, and nothing else happens
  // that turn. Both sides can owe one at once after a double knockout.
  if (state.awaitingSwitch[0] || state.awaitingSwitch[1]) {
    for (const side of [0, 1] as SideIndex[]) {
      if (!state.awaitingSwitch[side]) continue;
      const action = actions[side];
      if (action.t !== "switch") throw new IllegalAction(`side ${side} must send out a replacement`);
      switchTo(turn, side, action.partyIndex);
      turn.battle.awaitingSwitch[side] = false;
    }
    return finish(turn, null, 0);
  }

  let caught: Individual | null = null;
  let ballsUsed = 0;

  // Balls and running are wild-only, resolve before anything else, and give
  // the opponent a free move if they fail.
  const ours = actions[0];
  if (ours.t === "ball" || ours.t === "flee") {
    if (!rules.catchable) throw new IllegalAction("there is no running from this one");

    // A Smoke Ball: running works. Checked before the speed comparison rather
    // than folded into it, because the item promises certainty and a very fast
    // wild creature is exactly when you want it.
    if (ours.t === "flee" && has(active(turn, 0), "bolt")) {
      turn.events.push({ t: "fled" });
      return finish({ ...turn, battle: { ...turn.battle, outcome: { t: "fled" } } }, null, 0);
    }

    if (ours.t === "ball") {
      if (balls <= 0) {
        turn.events.push({ t: "noBalls" });
        return finish(turn, null, 0);
      }
      ballsUsed = 1;
      const wild = active(turn, 1);
      const odds = catchOdds(wild, 1000);
      if (intBelow(rngFor(state.seed, state.tag, turn.battle.turn, "ball"), 256) < odds) {
        caught = { ...wild };
        turn.events.push({ t: "caught" });
        turn.battle.outcome = { t: "caught" };
        return finish(turn, caught, ballsUsed);
      }
      turn.events.push({ t: "catchFailed" });
    } else {
      const own = speedOf(turn, 0);
      const theirs = speedOf(turn, 1);
      const odds = own >= theirs ? 100 : Math.max(35, Math.floor((own * 100) / theirs));
      if (chance(turn, "flee", odds)) {
        turn.events.push({ t: "fled" });
        turn.battle.outcome = { t: "fled" };
        return finish(turn, null, 0);
      }
      turn.events.push({ t: "fleeFailed" });
    }

    // The opponent gets its move in regardless.
    const reply = actions[1];
    const replyMove = chosenMove(turn, 1, reply);
    if (replyMove) executeMove(turn, 1, replyMove);
    settle(turn, rules);
    return finish(turn, caught, ballsUsed);
  }

  // The opening lead counts as an arrival. Intimidate on the creature you
  // send out first has to work, or the ability is worth nothing on the one
  // creature most likely to be carrying it.
  if (turn.battle.turn === 1) {
    for (const side of [0, 1] as SideIndex[]) onArriving(turn, side);
  }

  /*
   * Pursuit, which is the one move that has to happen *before* a switch.
   *
   * Catching something on its way out is the whole move, and a switch that
   * resolved first would leave nothing to catch. Decided here, before the
   * switch loop, because this is the only place that can see both sides'
   * chosen actions at once — and recorded on the turn rather than acted on,
   * so that `executeMove` stays a function of the move and the battle rather
   * than of what the other side happened to pick.
   */
  for (const side of [0, 1] as SideIndex[]) {
    const ours = actions[side];
    const theirs = actions[other(side)];
    if (theirs.t !== "switch" || ours.t !== "fight") continue;
    // A creature part-way through a Fly or an Outrage is not choosing, so the
    // slot it happens to have pressed is not what it is about to do. Asked
    // through the same predicate `chosenMove` uses, so the two cannot come to
    // disagree — and asked *before* `moveIdFor`, which throws on a slot with
    // no uses left and would otherwise turn a forced move into an exception.
    if (forcedMove(turn.battle, side)) continue;
    if (moveIdFor(turn, side, ours.moveIndex) === "pursuit") turn.pursuing = side;
  }
  if (turn.pursuing !== undefined) {
    executeMove(turn, turn.pursuing, "pursuit");
    spendFreshness(turn, turn.pursuing);
    afterMove(turn, turn.pursuing);
    if (turn.battle.outcome) return finish(turn, caught, ballsUsed);
  }

  // Switches happen before any move, on both sides.
  for (const side of [0, 1] as SideIndex[]) {
    const action = actions[side];
    // Something the Pursuit just knocked out owes a replacement rather than a
    // switch, and `settle` at the bottom of the turn is what asks for one.
    if (action.t === "switch" && !isFainted(activeOf(turn.battle, side))) {
      switchTo(turn, side, action.partyIndex);
    }
  }

  const moveA = turn.pursuing === 0 ? null : chosenMove(turn, 0, actions[0]);
  const moveB = turn.pursuing === 1 ? null : chosenMove(turn, 1, actions[1]);

  const first = firstMover(turn, moveA, moveB);
  const second = other(first);
  const moves: [string | null, string | null] = [moveA, moveB];
  // Analytic asks, and it has to be answered before either move resolves.
  turn.movingLast = second;

  if (moves[first]) {
    executeMove(turn, first, moves[first]!);
    spendFreshness(turn, first);
    afterMove(turn, first);
  }
  // Nothing happens after the battle has ended.
  //
  // A new possibility: until Roar and Teleport, no *move* could finish a
  // battle — only a fainting could, and that is settled at the bottom. Left
  // unguarded, the residuals tick for a battle nobody is in, a berry is eaten
  // for it, and `settle` awards experience for a creature that walked away.
  //
  // Both checks, though only the second is reachable today: Roar, Whirlwind
  // and Teleport all have priority -6, so they are always the later of the
  // two. The first is here because "stop when the battle is over" is a fact
  // about the loop rather than about which moves happen to be slow, and the
  // next move that ends a battle will not necessarily be.
  if (turn.battle.outcome) return finish(turn, caught, ballsUsed);

  if (moves[second] && !isFainted(active(turn, second))) {
    executeMove(turn, second, moves[second]!);
    spendFreshness(turn, second);
    afterMove(turn, second);
  }
  if (turn.battle.outcome) return finish(turn, caught, ballsUsed);

  for (const side of [0, 1] as SideIndex[]) {
    if (!isFainted(active(turn, side))) residual(turn, side);
  }
  // The weather's bite and its mending, after the burn and before the seed.
  for (const side of [0, 1] as SideIndex[]) weatherResidual(turn, side);

  // What was put up this turn comes down at the end of it, before anything
  // reads it again: a shield lasts exactly the turn it was raised.
  for (const side of [0, 1] as SideIndex[]) {
    const held = volatiles(turn, side);
    /*
     * A flinch lasts exactly the turn it was caused, and is swept whether or
     * not it was ever read. That is not tidying-up: it is the mechanic. A
     * flinch written on somebody who has already moved this turn does
     * nothing, which is why an Iron Head is worth so much more from the
     * faster side than from the slower one.
     */
    if (held.flinched) mergeVolatiles(turn, side, { flinched: undefined });
    /*
     * Bide adding up what it took. Read off `turn.taken`, which is already
     * counting exactly this and counts only *move* damage — a Bide that spent
     * its two turns being poisoned has nobody to give it back to.
     */
    if (held.biding) {
      mergeVolatiles(turn, side, {
        bided: (held.bided ?? 0) + turn.taken[side].physical + turn.taken[side].special,
      });
    }
    if (held.shield) mergeVolatiles(turn, side, { shield: undefined });
    // The streak only survives an unbroken run of them, so a turn spent doing
    // anything else resets the price back to nothing.
    if (!held.shield && held.shieldStreak) mergeVolatiles(turn, side, { shieldStreak: undefined });
  }

  // Seeds, nightmares, drowsiness and the song. After the burn and the poison,
  // because that is the order these games resolve them in, and before the held
  // items so a berry can answer what the seed just took.
  for (const side of [0, 1] as SideIndex[]) {
    if (!isFainted(active(turn, side))) tickVolatiles(turn, side);
  }
  for (const side of [0, 1] as SideIndex[]) ageScreens(turn, side);
  for (const side of [0, 1] as SideIndex[]) ageFuture(turn, side);
  ageField(turn);

  // What a held item does at the end of a turn, in a fixed order so two of
  // them on opposite sides always resolve the same way: the thing that hurts
  // you, then the thing that mends you, then the berry that answers either.
  for (const side of [0, 1] as SideIndex[]) {
    if (isFainted(active(turn, side))) continue;
    afflictSelf(turn, side);
    tickHealth(turn, side);
  }
  for (const side of [0, 1] as SideIndex[]) {
    if (isFainted(active(turn, side))) continue;
    eatBerry(turn, side);
  }

  settle(turn, rules);
  return finish(turn, caught, ballsUsed);
}

/**
 * The move an action comes down to, or null if it is not a move at all.
 *
 * Struggle is resolved here rather than at the menu so that both peers in a
 * duel reach it from the same rule instead of trusting each other's word for
 * what was left in the tank.
 */
function chosenMove(turn: Turn, side: SideIndex, action: BattleAction): string | null {
  /*
   * A creature part-way through a Fly, a Rollout or an Outrage uses that,
   * whatever was picked.
   *
   * Deliberately *any* fight action rather than the matching one, and
   * `actionRefusal` agrees: refusing every index but one would mean a menu
   * with a single legal button, and a forced move whose power points had run
   * out — which a rampage's do, since only its first turn pays — would leave
   * a menu with none at all. A battle with no legal action is the one failure
   * the deadlock probe exists to catch, and the cheap way not to have it is
   * to accept whatever was picked and ignore it.
   */
  const forced = forcedMove(turn.battle, side);
  if (forced && action.t === "fight") return forced;

  if (action.t === "fight") return moveIdFor(turn, side, action.moveIndex);
  if (action.t !== "struggle") return null;
  // Asked the same way the refusal asks it, so the menu and the engine cannot
  // disagree about whether there was anything else to do.
  if (hasLegalMove(turn.battle, side)) throw new IllegalAction("it still has moves to use");
  return STRUGGLE;
}

/**
 * A side, copied so the turn can mutate it without touching the caller's.
 *
 * Spread first, then the mutable parts copied over it. It used to name all
 * four fields by hand, which meant every field added to `Combatant` was
 * silently dropped at the turn boundary — and that is exactly what happened
 * when the volatiles arrived: a creature was seeded, the turn ended, and the
 * seed was gone before anything could drain it. Leech Seed appeared to work
 * and did nothing, which is the same symptom from a completely different
 * cause, one turn further on.
 *
 * With the spread, a new field is carried whether or not anybody remembers
 * this function. It still has to be *copied* here if the turn mutates it,
 * which the three below are; being carried by reference is wrong but visible,
 * where being dropped was neither.
 */
function cloneSide(side: Combatant): Combatant {
  return {
    ...side,
    team: side.team.map((creature) => ({ ...creature })),
    stages: { ...side.stages },
    locked: side.locked ?? null,
    aim: side.aim ? { ...side.aim } : undefined,
    volatiles: side.volatiles ? { ...side.volatiles } : undefined,
    screens: side.screens ? { ...side.screens } : undefined,
    future: side.future ? { ...side.future } : undefined,
  };
}

function moveIdFor(turn: Turn, side: SideIndex, index: number): string {
  const creature = active(turn, side);
  if (index < 0 || index >= creature.moves.length) throw new IllegalAction("no such move");
  if (!hasPp(creature, index)) throw new IllegalAction("no uses left in that one");
  return creature.moves[index];
}

/** Why this action would be refused, or null. One predicate, two callers: the
 * battle menu greys a button for exactly what resolveTurn would throw on. */
/**
 * Whether this side has any move it is both able and allowed to use.
 *
 * "Able" used to be the whole question, and PP was the only thing that could
 * take a move away — so `anyPp` was a complete answer and Struggle was gated
 * on it. Held items broke that. An Assault Vest refuses every status move; a
 * Choice item refuses every move but one, and that one can run out of PP. Both
 * can leave a creature with a full tank and nothing it may legally do, which
 * is a battle that cannot be won, lost or left — exactly the hole Struggle
 * exists to fill, reached by a road Struggle was not watching.
 */
function hasLegalMove(state: BattleState, side: SideIndex): boolean {
  const creature = activeOf(state, side);
  return creature.moves.some(
    (_move, at) => actionRefusal(state, side, { t: "fight", moveIndex: at }) === null,
  );
}

export function actionRefusal(state: BattleState, side: SideIndex, action: BattleAction): string | null {
  // Mean Look and its two friends. Refused here so the menu greys the button
  // the engine is going to refuse anyway — one predicate, two callers. Owing
  // a replacement beats it: a fainted creature has already left, and being
  // held by a trap that is about to be cleared anyway would be a dead end.
  if (
    (action.t === "switch" || action.t === "flee") &&
    !state.awaitingSwitch[side] &&
    state.sides[side].volatiles?.trapped
  ) {
    return action.t === "flee" ? "there is no getting away" : "it cannot be called back";
  }
  // A bind holds it exactly as a Mean Look does, and for the same two actions.
  // Separate from `trapped` because the two end differently — a bind runs out
  // on its own, and Mean Look does not — and because one of them can be
  // escaped by a Shed Shell one day and the other cannot.
  if (
    (action.t === "switch" || action.t === "flee") &&
    !state.awaitingSwitch[side] &&
    state.sides[side].volatiles?.bound
  ) {
    return action.t === "flee" ? "it is held fast" : "it is held fast";
  }
  // And a move part-way through holds it too: there is no calling back
  // something that is halfway up in the air or three turns into a rampage.
  if (
    (action.t === "switch" || action.t === "flee") &&
    !state.awaitingSwitch[side] &&
    forcedMove(state, side)
  ) {
    return action.t === "flee" ? "there is no stopping now" : "it is not finished";
  }
  if (state.outcome) return "the battle is over";
  const creature = activeOf(state, side);

  // Whatever is picked, the forced move is what happens — so nothing is
  // refused. See `chosenMove` for why this is deliberately permissive rather
  // than pinned to the one matching index.
  if (action.t === "fight" && forcedMove(state, side)) return null;

  if (action.t === "fight") {
    if (action.moveIndex < 0 || action.moveIndex >= creature.moves.length) return "no such move";
    if (!hasPp(creature, action.moveIndex)) return "no uses left in that one";

    const moveId = creature.moves[action.moveIndex];

    // An Assault Vest buys a defence with every status move it has.
    if (moveById(moveId).category === "status" && has(creature, "silent")) {
      return "it will not use a status move while it wears that";
    }

    // A Choice item: one move, until it leaves.
    const locked = state.sides[side].locked;
    if (locked && locked !== moveId && has(creature, "locked")) {
      return `it is locked into ${moveById(locked).name}`;
    }
    return null;
  }
  if (action.t === "struggle") {
    return hasLegalMove(state, side) ? "it still has moves to use" : null;
  }
  return null;
}

/**
 * Regenerator and Natural Cure, on the way out; Intimidate, on the way in.
 *
 * Both halves live in one place because a switch is one event and reading it
 * in two would be how the two quietly stop agreeing about the order.
 */
function onLeaving(turn: Turn, side: SideIndex): void {
  const leaving = active(turn, side);
  if (isFainted(leaving)) return;

  let changed = leaving;
  for (const effect of effects(leaving, "mend")) {
    const room = maxHp(leaving) - leaving.hp;
    const mended = Math.min(room, Math.floor(maxHp(leaving) / effect.share));
    if (mended > 0) changed = { ...changed, hp: changed.hp + mended };
  }
  if (has(leaving, "shake") && changed.status) {
    changed = { ...changed, status: null, sleepTurns: 0 };
  }

  if (changed !== leaving) {
    setActive(turn, side, changed);
    const named = whichAbility(leaving, "mend") ?? whichAbility(leaving, "shake");
    if (named) turn.events.push({ t: "ability", side, abilityId: named });
  }
}

/** Intimidate, when somebody new is standing there. */
/** A fresh appearance is a fresh choice: the lock goes with the creature. */
function clearLock(turn: Turn, side: SideIndex): void {
  turn.battle.sides[side].locked = null;
}

function onArriving(turn: Turn, side: SideIndex): void {
  clearLock(turn, side);
  // Nothing has had a turn here yet, which is the one thing Fake Out asks and
  // the only thing that distinguishes this slot from any other. Spent by
  // `spendFreshness` the moment the slot resolves a move, so it is gone again
  // within the turn and a battle nobody used it in carries no trace of it.
  mergeVolatiles(turn, side, { fresh: true });
  const arriving = active(turn, side);
  // Drought, Drizzle, Sand Stream, Snow Warning and the four Surges.
  for (const effect of effects(arriving, "summon")) {
    const raised = effect.weather
      ? raiseField(turn, "weather", effect.weather)
      : effect.terrain
        ? raiseField(turn, "terrain", effect.terrain)
        : false;
    if (raised) turn.events.push({ t: "ability", side, abilityId: whichAbility(arriving, "summon")! });
  }
  for (const effect of effects(arriving, "arrival")) {
    // Scrappy is immune to it, as it is in the games.
    if (has(active(turn, other(side)), "reach")) continue;
    turn.events.push({ t: "ability", side, abilityId: whichAbility(arriving, "arrival")! });
    applyBoosts(turn, other(side), { [effect.stat]: effect.delta }, true);
  }
}

function switchTo(turn: Turn, side: SideIndex, partyIndex: number): void {
  const combatant = turn.battle.sides[side];
  if (partyIndex < 0 || partyIndex >= combatant.team.length) throw new IllegalAction("no such party member");
  if (partyIndex === combatant.active && !turn.battle.awaitingSwitch[side]) {
    throw new IllegalAction("that one is already out");
  }
  if (isFainted(combatant.team[partyIndex])) throw new IllegalAction("that one has fainted");

  // Whatever the one on its way out can do about leaving.
  onLeaving(turn, side);

  combatant.active = partyIndex;
  // Stat stages belong to the slot, not the creature, so they reset. So do the
  // two probability ladders and everything volatile: being seeded, confused or
  // counting down is a fact about standing there, and switching is how you
  // stop standing there. Screens are *not* cleared — they belong to the side,
  // which is the whole point of a screen.
  // Read before the volatiles go, because it is the one volatile that is
  // *about* the switch: Healing Wish fainted so that this arrival is whole.
  const blessed = Boolean(combatant.volatiles?.blessing);

  combatant.stages = { ...NO_STAGES };
  combatant.aim = undefined;
  combatant.volatiles = undefined;
  turn.events.push({ t: "switch", side, partyIndex });

  /*
   * Who has taken part against what is standing opposite.
   *
   * Ours joins the list; theirs clears it and starts again with whoever we
   * have out, because the list is about *one* opposing creature. Both halves
   * are here rather than at the call sites so that every road to a switch —
   * chosen, forced by a Roar, owed after a faint, or a U-turn — keeps the
   * same books.
   */
  if (side === 0) {
    if (!turn.battle.sharing.includes(partyIndex)) turn.battle.sharing.push(partyIndex);
  } else {
    turn.battle.sharing = [turn.battle.sides[0].active];
  }

  if (blessed) {
    const arriving = active(turn, side);
    const mended = maxHp(arriving) - arriving.hp;
    setActive(turn, side, { ...arriving, hp: maxHp(arriving), status: null, sleepTurns: 0 });
    if (mended > 0) turn.events.push({ t: "heal", side, amount: mended });
  }

  // And whatever the one arriving does on arrival. After the event, so a log
  // reads in the order it happened.
  onArriving(turn, side);
}

/** Faints, experience and who has run out of creatures. */
function settle(turn: Turn, rules: BattleRules): void {
  const down: SideIndex[] = [];
  for (const side of [0, 1] as SideIndex[]) {
    if (isFainted(active(turn, side))) {
      turn.events.push({ t: "faint", side });
      down.push(side);
    }
  }
  if (!down.length) return;

  // Experience is for beating creatures and trainers, never people.
  if (rules.awardsExp && down.includes(1) && !down.includes(0)) {
    const loser = active(turn, 1);

    /*
     * Everybody who was out against this one, not just whoever landed the
     * last hit.
     *
     * Switching out was a pure loss before this: send something in to take a
     * hit, bring it back, and it had done all the work and earned none of the
     * experience. That taught exactly one lesson — never switch — which is
     * the opposite of what the switch is for, and it is why the classic rule
     * exists in the first place.
     *
     * `turn.battle.sharing` is who has stood opposite *this* creature; it is
     * reset the moment the other side sends out somebody new, so beating a
     * team of six does not quietly pay the whole party six times over for
     * work it did against the first one.
     *
     * A participant that has fainted since is *not* paid, and is not counted
     * when the prize is divided: the ones still standing split it between
     * them. Experience goes to creatures that can use it, and a fainted one
     * levelling up in the middle of a battle it is out of would be a stranger
     * sight than a smaller party share. It is also what the games do.
     *
     * A double knockout never reaches here (see the condition above), so the
     * lead is standing; the check on it is a guard, not a live case.
     */
    const team = turn.battle.sides[0].team;
    const standing = (at: number) => at >= 0 && at < team.length && team[at].hp > 0;
    const sharers = [...new Set(turn.battle.sharing)].filter(standing).sort((a, b) => a - b);
    const lead = turn.battle.sides[0].active;
    const helped = sharers.length ? sharers : standing(lead) ? [lead] : [];

    // Split, and never to nothing: a party of six that all took a turn
    // against a Caterpie should each come away with something rather than
    // with a rounding error.
    const whole = expYield(loser);
    const each = Math.max(1, Math.floor(whole / Math.max(1, helped.length)));

    const base = effortYield(loser.speciesId);

    for (const at of helped) {
      const earner = turn.battle.sides[0].team[at];
      if (!earner) continue;

      // A Lucky Egg is the *holder's*, so it is read per recipient rather
      // than off whoever happened to be standing at the end.
      let amount = each;
      for (const effect of effects(earner, "study")) amount = scaled(amount, effect.mille);

      const growth = awardExp(earner, amount);

      /*
       * Effort is *not* split.
       *
       * Experience is a share of one prize and effort is a lesson: two
       * creatures that both fought a Machop have both been hit by a Machop,
       * and halving what they learned from it would be a strange thing to
       * say. This is also what the games do.
       *
       * A Macho Brace multiplies what is earned and can steer it: `stat`
       * names one, and without it the brace doubles whatever the loser was
       * going to teach. Read per recipient, for the same reason as the Egg.
       */
      let yielded = base;
      for (const effect of effects(earner, "regimen")) {
        yielded = {
          stats: effect.stat ? [effect.stat] : yielded.stats,
          amount: scaled(yielded.amount, effect.mille),
        };
      }

      const before = growth.individual.evs;
      const evs = gainEffort(before, yielded);
      turn.battle.sides[0].team[at] = { ...growth.individual, evs };

      turn.events.push({
        t: "exp",
        amount,
        levels: growth.levelsGained,
        uid: earner.uid,
        learned: growth.movesLearned,
        offered: growth.movesOffered,
        // What it is ready to become, which is no longer what it became. The
        // creature on the field is unchanged; whoever owns the party turns
        // this into a question and applies the answer. See
        // `GrowthResult.evolveTo`.
        evolvedFrom: growth.evolveTo ? earner.speciesId : null,
        evolved: growth.evolveTo,
      });

      // Only reported when something was actually earned — a creature at the
      // cap should not be told about effort it did not gain.
      const gained = STAT_IDS.filter((stat) => evs[stat] > before[stat]);
      if (gained.length) {
        turn.events.push({ t: "effort", stats: gained, amount: yielded.amount });
      }
    }
  }

  const wipedOut = ([0, 1] as SideIndex[]).map((side) =>
    turn.battle.sides[side].team.every(isFainted),
  );

  if (wipedOut[0] && wipedOut[1]) {
    turn.battle.outcome = { t: "draw" };
    return;
  }
  if (wipedOut[0]) {
    turn.battle.outcome = { t: "win", side: 1 };
    return;
  }
  if (wipedOut[1]) {
    turn.battle.outcome = { t: "win", side: 0 };
    return;
  }

  for (const side of down) turn.battle.awaitingSwitch[side] = true;
}

/**
 * Decides a battle that has gone on too long, on remaining health.
 *
 * Compared as a fraction of each side's total, cross-multiplied so the
 * comparison stays in integers: a side down to its last creature has not
 * "won" by having more raw HP than a full team of smaller ones.
 */
function decideOnHealth(turn: Turn): void {
  const totals = ([0, 1] as SideIndex[]).map((side) => {
    const team = turn.battle.sides[side].team;
    return {
      hp: team.reduce((sum, creature) => sum + Math.max(0, creature.hp), 0),
      max: team.reduce((sum, creature) => sum + maxHp(creature), 0),
    };
  });

  turn.events.push({ t: "timeout" });

  const ours = totals[0].hp * totals[1].max;
  const theirs = totals[1].hp * totals[0].max;
  if (ours === theirs) turn.battle.outcome = { t: "draw" };
  else turn.battle.outcome = { t: "win", side: ours > theirs ? 0 : 1 };
}

function finish(turn: Turn, caught: Individual | null, ballsUsed: number): TurnResult {
  // The turn limit belongs on the way out, not on one path through.
  //
  // It used to sit at the end of the ordinary move-resolution path, which six
  // `return finish(...)` statements never reach: a switch, a ball, a flee that
  // failed. So a battle that only ever saw those could pass three hundred
  // turns and keep going. The deadlock probe walked straight into it the
  // moment power points existed — out of moves, out of balls, and throwing a
  // ball it did not have a thousand times over. A guarantee that only holds
  // on the common path is not a guarantee.
  if (!turn.battle.outcome && turn.battle.turn >= MAX_TURNS) decideOnHealth(turn);
  return { battle: { ...turn.battle, events: turn.events }, caught, ballsUsed };
}

/**
 * A fingerprint of a battle, for two peers to compare after every turn.
 *
 * A duel where the two sides disagree is not a difference of opinion, it is
 * one client running different rules; the point of this is to notice
 * immediately rather than three turns later.
 */
export function battleHash(state: BattleState): string {
  const creature = (individual: Individual) =>
    [
      individual.uid,
      individual.speciesId,
      individual.level,
      individual.hp,
      individual.status ?? "-",
      individual.sleepTurns,
      // What it can do decides what the numbers come out as, so two peers that
      // disagree about an ability would disagree about every hit after it.
      individual.abilities.join("+"),
    ].join(":");

  const side = (index: SideIndex) => {
    const combatant = state.sides[index];
    return [
      combatant.active,
      combatant.team.map(creature).join("|"),
      (["atk", "def", "spa", "spd", "spe"] as const).map((stat) => combatant.stages[stat]).join(","),
      // The two ladders, what is volatile and what the side is under. Written
      // as sorted key/value pairs rather than as JSON of the object, because
      // two peers that inserted the same keys in a different order would
      // disagree about a battle they agree about.
      (["accuracy", "evasion"] as const).map((which) => combatant.aim?.[which] ?? 0).join(","),
      combatant.lastMove ?? "-",
      // `stats` is the one volatile that is an object, and String() of an
      // object is "[object Object]" whatever is in it — two different splits
      // would hash the same. Its entries are written out sorted, like the
      // rest.
      Object.entries(combatant.volatiles ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) =>
          typeof value === "object" && value !== null
            ? `${key}={${Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([stat, number]) => `${stat}:${String(number)}`)
                .join(",")}}`
            : `${key}=${String(value)}`,
        )
        .join("+"),
      Object.entries(combatant.screens ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${String(value)}`)
        .join("+"),
      // A blow already thrown that has not arrived. Two peers that disagreed
      // about a pending Future Sight would agree about the battle right up
      // until the turn it lands, which is the worst moment to find out.
      // Empty for the overwhelming majority of battles, which therefore hash
      // exactly as they did before it existed.
      combatant.future
        ? `${combatant.future.moveId}:${combatant.future.turns}:${combatant.future.amount}:${combatant.future.quarters}`
        : "",
    ].join("/");
  };

  let hash = 0x811c9dc5;
  const canonical = [
    state.turn,
    side(0),
    side(1),
    state.awaitingSwitch.join(","),
    // Who is owed a share of the next thing to go down. Two peers that
    // disagreed about this would agree about the whole battle right up until
    // something fainted, which is the worst moment to find out.
    state.sharing.join(","),
    JSON.stringify(state.outcome ?? null),
    // Empty for no field, so a battle without weather hashes as it did.
    fieldKey(state.field),
  ].join(";");
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
