import type { Boosts, MoveEntry, StageStat } from "./dex";
import { hasFieldUse } from "./fieldmoves";

/*
 * Type-only, deliberately. `dex.ts` asks this module whether a move acts on
 * anything, at module-init time, to build the learnset filter and the machine
 * list — so a *value* import back the other way would be a cycle evaluated
 * during initialisation, where whichever half loaded second would see the
 * other's exports as undefined. A type import is erased and cannot.
 */

/**
 * What a status move does when its manifest row cannot say.
 *
 * `moves.ts` is this module's twin: there, 39 attacks ship `power: 0` because
 * Showdown computes their damage in a script, and the fix was to write the
 * script the data could not hold. This is the same hole on the other side of
 * the ledger, and it was much bigger.
 *
 * ## The measurement
 *
 * 264 of the manifest's 820 moves are status moves. **179 of them carried no
 * effect this engine could act on** — no `status`, no `boosts`, no `heal`, no
 * `drain`, no `secondary`. The build script copies those five fields and
 * Showdown keeps everything else (`volatileStatus`, `sideCondition`,
 * `weather`, `terrain`, `self`, `onHit`) in code, so all of it was dropped on
 * the floor. Every one of those moves spent a turn, printed "X used Y!" and
 * did absolutely nothing.
 *
 * That is not a rare corner. Taking each species' last four learnable moves —
 * which is exactly what `movesAtLevel` deals to a wild encounter, a trainer's
 * team and a freshly given starter — **635 of 1134 species walked around with
 * at least one dead slot**, and Togekiss's four were *all* dead: Wish, Yawn,
 * Encore, Bestow. A creature that cannot do anything but Struggle.
 *
 * Leech Seed was simply the one somebody noticed.
 *
 * ## Why a table of ids rather than more data
 *
 * Same reason as `moves.ts`, and it is worth stating again because naming move
 * ids in the engine is the kind of thing that should need a defence. The
 * manifest has no field that could hold "the target is seeded and loses an
 * eighth of its health to whoever seeded it every turn". Adding one would mean
 * a field per mechanic — a volatile field, a side-condition field, a weather
 * field — and regenerating four data files each time. The effects here are
 * *shapes*, interpreted by one loop in battle.ts, for the same reason
 * `abilities.ts` uses shapes rather than callbacks: a closed set of questions
 * is a battle whose behaviour can be read off one file.
 *
 * ## Why not all 179
 *
 * Because most of the rest need systems this engine does not have, and half a
 * weather system is worse than none. What is missing, and why:
 *
 * - **Weather and terrain** (Rain Dance, Sunny Day, Sandstorm, Hail,
 *   Snowscape, the four terrains) — a field condition that changes damage,
 *   residuals and a dozen abilities. Its own feature, not a move.
 * - **Entry hazards** (Spikes, Toxic Spikes, Stealth Rock, Sticky Web) — need
 *   an on-arrival hook that survives the battle's switch path.
 * - **Move restriction** (Taunt, Disable, Encore, Torment, Imprison) — these
 *   change *which moves are legal*, and that is the one class of effect that
 *   can make a battle unwinnable. It wants its own pass with the deadlock
 *   probe watching, not a corner of this one.
 * - **Move calling** (Metronome, Sleep Talk, Copycat, Mirror Move, Assist, Me
 *   First, Nature Power) — re-entrant `executeMove`, which needs a depth guard
 *   before it is safe.
 * - **Item tricks** (Trick, Switcheroo, Bestow, Recycle, Stuff Cheeks) — the
 *   bag is engine state, not battle state, and moving an item mid-battle
 *   crosses that line.
 * - **Doubles** (Helping Hand, Ally Switch, Wide Guard, Follow Me, the ally
 *   heals) — meaningless in a game that is 1v1 throughout.
 *
 * Everything in that list is *filtered out of the pools instead* — see
 * `actsOnSomething` and its use in `dex.ts`. A move the engine cannot honour
 * is no longer dealt to anybody, so the hole is closed either way: what is
 * here works, and what is not here is not handed out.
 */

/** A condition that belongs to a side and outlives whoever is standing. */
export type SideConditionId =
  | "reflect"
  | "lightscreen"
  | "mist"
  | "safeguard"
  | "luckychant"
  | "tailwind";

/** Which of the two probability ladders a move moves. */
export type AimStat = "accuracy" | "evasion";

/**
 * One thing a status move does.
 *
 * Interpreted by `applyMoveEffect` in battle.ts. Deliberately small and
 * closed: a shape battle.ts cannot already act on is a shape that does not
 * belong here yet.
 */
export type MoveEffect =
  /** Leech Seed. The target is seeded; the drain heals whoever is opposite. */
  | { t: "seed" }
  /** Confuse Ray and friends. Also the missing half of Swagger and Flatter. */
  | { t: "confuse" }
  /** Nightmare: a sleeping target loses a quarter a turn. */
  | { t: "nightmare" }
  /** Yawn: asleep at the end of next turn, unless something intervenes. */
  | { t: "yawn" }
  /** Perish Song: both sides are counting down. */
  | { t: "perish" }
  /** Mean Look, Block, Spider Web: it cannot leave. */
  | { t: "trap" }
  /**
   * Protect and its family, and Endure.
   *
   * `endure` survives the hit at one health instead of preventing it, which
   * is the whole difference between the two.
   */
  | { t: "shield"; endure?: boolean }
  /** Focus Energy, Laser Focus: up the critical ladder. */
  | { t: "crit"; stages: number }
  /** Sand Attack, Double Team: down or up a probability ladder. */
  | { t: "aim"; which: AimStat; delta: number; onSelf: boolean }
  /** A fraction of the user's own maximum, mended. Synthesis is 1/2. */
  | { t: "heal"; share: number }
  /** Rest: everything back, and two turns asleep to pay for it. */
  | { t: "rest" }
  /** Pain Split: both healths averaged. */
  | { t: "painSplit" }
  /** Belly Drum: half the user's maximum for a maxed attack. */
  | { t: "bellyDrum" }
  /** Haze: every stage on both sides back to nought. */
  | { t: "haze" }
  /** Refresh, Heal Bell, Aromatherapy. */
  | { t: "cure"; who: "self" | "party" }
  /** Purify: cures the target, and only then mends the user. */
  | { t: "purify" }
  /** Reflect, Light Screen, Mist, Safeguard, Lucky Chant, Tailwind. */
  | { t: "side"; id: SideConditionId; turns: number }
  /** Roar, Whirlwind: the target leaves, one way or another. */
  | { t: "forceOut" }
  /** Teleport: the user leaves. */
  | { t: "retreat" }
  /** Transform: become the thing opposite. The whole of what Ditto is. */
  | { t: "transform" }
  /** Sketch: take a copy of what the target last did, for good. */
  | { t: "sketch" }
  /**
   * Aqua Ring and Ingrain: a sixteenth back every turn, which is Leech Seed
   * backwards. `plant` is Ingrain's other half — rooted to the spot, it cannot
   * switch out, cannot run and cannot be blown away.
   */
  | { t: "roots"; plant?: boolean }
  /** Attract: half its turns lost, if the two of them would pair. */
  | { t: "infatuate" }
  /** Heal Pulse, Floral Healing: a share of the *target's* maximum, mended. */
  | { t: "mend"; share: number }
  /** Strength Sap: the user gains the target's Attack, and the target loses a stage of it. */
  | { t: "sap" }
  /** Psych Up: the user's stages become the target's. */
  | { t: "copyStages" }
  /**
   * Power Swap, Guard Swap, Heart Swap: the named stages, exchanged. Heart
   * Swap takes the two probability ladders with it.
   */
  | { t: "swapStages"; stats: readonly StageStat[]; aim?: boolean }
  /**
   * Power Split and Guard Split: the named stats averaged between the two;
   * Speed Swap: exchanged. Neither is a stage — they rewrite the number the
   * stages multiply, which is why they live in their own volatile.
   */
  | { t: "splitStats"; stats: readonly StageStat[]; swap?: boolean }
  /** Stockpile: one more on the counter, up to three, and a stage of each guard. */
  | { t: "stockpile" }
  /** Swallow: the counter spent on mending — a quarter, a half, everything. */
  | { t: "swallow" }
  /** Spit Up's other half: the counter spent, after the damage it powered. */
  | { t: "unstock" }
  /** Lock-On, Mind Reader: the next move cannot miss. */
  | { t: "sure" }
  /** Destiny Bond: whatever knocks it out goes down with it. */
  | { t: "bond" }
  /** Wish: half the user's maximum, at the end of next turn, to whoever is standing there. */
  | { t: "wish" }
  /** Healing Wish, Lunar Dance: the user faints, and its replacement arrives whole. */
  | { t: "sacrifice" }
  /** Revival Blessing: one fainted creature in the party, back at half. */
  | { t: "revive" }
  /** Magnet Rise (self) and Telekinesis (target): Ground moves pass underneath for this long. */
  | { t: "float"; turns: number; onSelf: boolean }
  /**
   * Soak, Magic Powder: the target becomes exactly these types. Forest's
   * Curse and Trick-or-Treat: `add` puts one more on top of what it has.
   */
  | { t: "retype"; types: readonly string[]; add?: boolean }
  /** Reflect Type: the user takes the target's types. */
  | { t: "mirrorTypes" }
  /** Conversion: the user becomes the type of its first move. */
  | { t: "conversion" }
  /** Conversion 2: the user becomes something the target's last move cannot hurt much. */
  | { t: "conversion2" }
  /**
   * Odor Sleuth and Foresight see through a Ghost; Miracle Eye through a
   * Dark. What the immunity was, and it is suspended.
   */
  | { t: "see"; through: "ghost" | "dark" }
  /** Venom Drench: three stages off, if it is poisoned. */
  | { t: "drench" }
  /** Acupressure: one of the seven ladders, two rungs up, at random. */
  | { t: "acupressure" }
  /** Psycho Shift: the user's condition handed to the target. */
  | { t: "psychoShift" }
  /** Power Trick: the user's own Attack and Defence exchanged. */
  | { t: "powerTrick" }
  /** Topsy-Turvy: the target's stages inverted. */
  | { t: "invert" }
  /** Take Heart: cured, and the named stages up. Jungle Healing: cured, and a share back. */
  | { t: "heartened"; boosts?: Boosts; share?: number }
  /** Flower Shield: a stage of Defence for every Grass type standing. */
  | { t: "flowerShield" }
  /**
   * Nothing, and that is the joke.
   *
   * Splash is the one move in the manifest that is *meant* to do nothing, so
   * it is named here rather than filtered out: without this entry the guard
   * that says "no dealt move is inert" would have to carry an exception, and
   * an exception list is where the next Leech Seed hides. Magikarp and Feebas
   * both learn it, and both keep it.
   */
  | { t: "nothing" };

/** How long a screen lasts. Five turns, as everywhere else. */
const SCREEN_TURNS = 5;

/** How long the two ways off the ground last. */
const MAGNET_RISE_TURNS = 5;
const TELEKINESIS_TURNS = 3;

/**
 * Every status move this engine honours, and what it does.
 *
 * Grouped by mechanic rather than alphabetically, because the groups are the
 * argument: each one is a single piece of machinery in battle.ts with several
 * front doors.
 */
export const STATUS_EFFECTS: Record<string, readonly MoveEffect[]> = {
  // ---------------------------------------------------------------- draining
  leechseed: [{ t: "seed" }],

  // -------------------------------------------------------------- confusion
  //
  // Swagger and Flatter are not in the inert list — they raise a stat, so the
  // manifest row looks complete. It is not: their entire point is that the
  // boost is a *bribe* paid for the confusion, and with the confusion dropped
  // they were moves that handed the opponent a free +2 Attack. Worse than
  // doing nothing.
  confuseray: [{ t: "confuse" }],
  supersonic: [{ t: "confuse" }],
  sweetkiss: [{ t: "confuse" }],
  teeterdance: [{ t: "confuse" }],
  swagger: [{ t: "confuse" }],
  flatter: [{ t: "confuse" }],

  // ------------------------------------------------------------ the shields
  //
  // All nine block the move outright. The real versions each punish the
  // attacker differently — King's Shield drops its Attack, Spiky Shield hurts
  // it, Baneful Bunker poisons it, Burning Bulwark burns it — and every one of
  // those needs to know whether the blocked move made contact, which the
  // manifest does not say either. Blocking is the nine-tenths of them that
  // matters; the rest can arrive when contact does.
  protect: [{ t: "shield" }],
  detect: [{ t: "shield" }],
  kingsshield: [{ t: "shield" }],
  spikyshield: [{ t: "shield" }],
  banefulbunker: [{ t: "shield" }],
  burningbulwark: [{ t: "shield" }],
  obstruct: [{ t: "shield" }],
  silktrap: [{ t: "shield" }],
  endure: [{ t: "shield", endure: true }],

  // ------------------------------------------------------------------- crits
  focusenergy: [{ t: "crit", stages: 2 }],
  laserfocus: [{ t: "crit", stages: 3 }],

  // ------------------------------------------------- accuracy and evasion
  sandattack: [{ t: "aim", which: "accuracy", delta: -1, onSelf: false }],
  smokescreen: [{ t: "aim", which: "accuracy", delta: -1, onSelf: false }],
  flash: [{ t: "aim", which: "accuracy", delta: -1, onSelf: false }],
  kinesis: [{ t: "aim", which: "accuracy", delta: -1, onSelf: false }],
  doubleteam: [{ t: "aim", which: "evasion", delta: 1, onSelf: true }],
  minimize: [{ t: "aim", which: "evasion", delta: 2, onSelf: true }],

  // ----------------------------------------------------------------- mending
  //
  // The four weather-dependent heals all mend a half, which is what they do in
  // clear weather — and clear is the only weather there is.
  synthesis: [{ t: "heal", share: 2 }],
  moonlight: [{ t: "heal", share: 2 }],
  morningsun: [{ t: "heal", share: 2 }],
  shoreup: [{ t: "heal", share: 2 }],
  rest: [{ t: "rest" }],
  painsplit: [{ t: "painSplit" }],
  bellydrum: [{ t: "bellyDrum" }],

  // ----------------------------------------------------------------- curing
  refresh: [{ t: "cure", who: "self" }],
  healbell: [{ t: "cure", who: "party" }],
  aromatherapy: [{ t: "cure", who: "party" }],
  purify: [{ t: "purify" }],

  // ---------------------------------------------------------------- clearing
  haze: [{ t: "haze" }],

  // ------------------------------------------------------------ the screens
  reflect: [{ t: "side", id: "reflect", turns: SCREEN_TURNS }],
  lightscreen: [{ t: "side", id: "lightscreen", turns: SCREEN_TURNS }],
  mist: [{ t: "side", id: "mist", turns: SCREEN_TURNS }],
  safeguard: [{ t: "side", id: "safeguard", turns: SCREEN_TURNS }],
  luckychant: [{ t: "side", id: "luckychant", turns: SCREEN_TURNS }],
  tailwind: [{ t: "side", id: "tailwind", turns: 4 }],

  // ------------------------------------------------------------------ timers
  nightmare: [{ t: "nightmare" }],
  yawn: [{ t: "yawn" }],
  perishsong: [{ t: "perish" }],

  // ---------------------------------------------------------------- trapping
  meanlook: [{ t: "trap" }],
  block: [{ t: "trap" }],
  spiderweb: [{ t: "trap" }],

  // ---------------------------------------------------------------- leaving
  roar: [{ t: "forceOut" }],
  whirlwind: [{ t: "forceOut" }],
  teleport: [{ t: "retreat" }],

  // ------------------------------------------------------------- borrowing
  //
  // These two are here because without them Ditto and Smeargle are the only
  // species in the dex with *nothing* to do: their whole learnset is one move,
  // and that move was inert. Sanchford's Council is five Dittos, which is five
  // creatures standing in a battle that could only ever time out.
  transform: [{ t: "transform" }],
  sketch: [{ t: "sketch" }],

  // ------------------------------------------------------------ rooting
  aquaring: [{ t: "roots" }],
  ingrain: [{ t: "roots", plant: true }],

  // ---------------------------------------------------------- infatuation
  attract: [{ t: "infatuate" }],

  // ------------------------------------------------- mending the other one
  //
  // Nothing in the engine could heal an opponent until these: `applyHeal`
  // had only ever been pointed at the user. In a game that is 1v1 throughout
  // they are a gift to the other side, which is what they are in the games
  // too — thirty species learn Heal Pulse, and every one of them was losing
  // a slot to it.
  healpulse: [{ t: "mend", share: 2 }],
  floralhealing: [{ t: "mend", share: 2 }],
  strengthsap: [{ t: "sap" }],

  // ------------------------------------------------- copying and exchanging
  psychup: [{ t: "copyStages" }],
  powerswap: [{ t: "swapStages", stats: ["atk", "spa"] }],
  guardswap: [{ t: "swapStages", stats: ["def", "spd"] }],
  heartswap: [{ t: "swapStages", stats: ["atk", "def", "spa", "spd", "spe"], aim: true }],
  powersplit: [{ t: "splitStats", stats: ["atk", "spa"] }],
  guardsplit: [{ t: "splitStats", stats: ["def", "spd"] }],
  speedswap: [{ t: "splitStats", stats: ["spe"], swap: true }],

  // ------------------------------------------------------------ stockpiling
  //
  // One counter, three doors. Spit Up is an attack and gets its power from
  // moves.ts; the entry here is only the counter being spent afterwards.
  stockpile: [{ t: "stockpile" }],
  swallow: [{ t: "swallow" }],
  spitup: [{ t: "unstock" }],

  // ------------------------------------------------------------- certainty
  lockon: [{ t: "sure" }],
  mindreader: [{ t: "sure" }],

  // ----------------------------------------------------------------- bonds
  destinybond: [{ t: "bond" }],

  // ---------------------------------------------------------------- wishes
  wish: [{ t: "wish" }],
  healingwish: [{ t: "sacrifice" }],
  lunardance: [{ t: "sacrifice" }],
  revivalblessing: [{ t: "revive" }],

  // -------------------------------------------------------------- floating
  magnetrise: [{ t: "float", turns: MAGNET_RISE_TURNS, onSelf: true }],
  telekinesis: [{ t: "float", turns: TELEKINESIS_TURNS, onSelf: false }],

  // ------------------------------------------------------------ retyping
  //
  // Types belong to the appearance now — a `types` volatile, read wherever
  // the species' were — and these are the moves that were waiting for it.
  // Camouflage is not here: it wants to know what ground the battle is on,
  // and the battle does not.
  soak: [{ t: "retype", types: ["water"] }],
  magicpowder: [{ t: "retype", types: ["psychic"] }],
  forestscurse: [{ t: "retype", types: ["grass"], add: true }],
  trickortreat: [{ t: "retype", types: ["ghost"], add: true }],
  reflecttype: [{ t: "mirrorTypes" }],
  conversion: [{ t: "conversion" }],
  conversion2: [{ t: "conversion2" }],

  // ------------------------------------------------------ seeing through
  odorsleuth: [{ t: "see", through: "ghost" }],
  foresight: [{ t: "see", through: "ghost" }],
  miracleeye: [{ t: "see", through: "dark" }],

  // ------------------------------------------------------ the second cheap group
  venomdrench: [{ t: "drench" }],
  acupressure: [{ t: "acupressure" }],
  psychoshift: [{ t: "psychoShift" }],
  powertrick: [{ t: "powerTrick" }],
  topsyturvy: [{ t: "invert" }],
  takeheart: [{ t: "heartened", boosts: { spa: 1, spd: 1 } }],
  junglehealing: [{ t: "heartened", share: 4 }],
  lunarblessing: [{ t: "heartened", share: 4 }],
  flowershield: [{ t: "flowerShield" }],

  // ------------------------------------------------------------ and nothing
  splash: [{ t: "nothing" }],
};

/**
 * What this move does beyond its manifest row, if anything.
 *
 * Asked by battle.ts for every move, attack or not — Swagger is a status move
 * with a boost, and Dynamic Punch is an attack, and both are missing their
 * confusion.
 */
export function extraEffects(moveId: string): readonly MoveEffect[] {
  return STATUS_EFFECTS[moveId] ?? [];
}

/**
 * Whether using this move can change the battle at all.
 *
 * The predicate behind the guard, and behind the pool filter in `dex.ts` —
 * one question, two callers, so what the engine honours and what the game
 * deals cannot drift apart. A move fails it only by being a status move whose
 * manifest row is empty *and* having no entry above.
 *
 * Attacks always pass: an attack with `power: 0` is a `moves.ts` formula, not
 * an empty row, and that module already covers them.
 */
export function actsOnSomething(move: MoveEntry): boolean {
  if (move.category !== "status") return true;
  if (move.status || move.boosts || move.secondary || move.heal || move.drain || move.recoil) {
    return true;
  }
  // A move that does nothing in a battle but shakes a tree or draws something
  // out of the grass is not inert, and must not be filtered out of the pools —
  // Sweet Scent and Defog are exactly that, and were being thrown away.
  if (hasFieldUse(move)) return true;
  return STATUS_EFFECTS[move.id] !== undefined;
}
