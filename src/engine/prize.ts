import { pickAbilities } from "./abilities";
import { ALL_SPECIES, species as speciesById } from "./dex";
import { rollGender } from "./gender";
import { NATURE_IDS } from "./natures";
import { intBelow, intBetween, rngFor, type Rng } from "./rng";
import { clampIvs, IV_MAX } from "./stats";
import type { Individual, StatTable } from "./types";
import { STAT_IDS } from "./types";
import { appearanceId, CHROMA_IDS, TOP_TIER } from "./variants";
import type { BracketSize } from "./bracket";

/**
 * What winning a bracket is worth.
 *
 * Three creatures at level one, and you take one — the starter screen again,
 * at the other end of the game. That shape is deliberate: it is the one
 * decision in this game everybody remembers making, and the reward for winning
 * a tournament is being asked it a second time with better odds.
 *
 * ## Why a level one
 *
 * A level 50 handed to the winner is a creature that walks into the next
 * bracket and wins it, and then the tournament is a ladder rather than an
 * event. A level 1 is worth nothing today and everything in forty hours, which
 * is the same trade the whole game runs on: what you get is a *head start on
 * raising something*, not something already raised.
 *
 * It is also the only honest way to hand out shine. A shiny is the rarest
 * thing in a world — the census plans exactly one — and one arriving fully
 * grown would cheapen every hour anybody has spent hunting. One arriving at
 * level 1 has to be brought up like anything else.
 *
 * ## Why the field size matters
 *
 * Sixteen people is fifteen matches and an afternoon; four is three matches
 * and twenty minutes. Paying both the same is the sort of thing that quietly
 * teaches everybody to run the small one. So every roll below reads the field:
 * more people, better odds, on all four axes at once.
 *
 * The scaling is deliberately not linear in the count — it is in the number of
 * *rounds survived*, which is what actually changed. Winning a sixteen is four
 * wins; winning a four is two. Twice the work, and the odds say so.
 */

/** How many are offered. Three, like the starters, and for the same reason:
 * two is a coin and four is a menu. */
export const PRIZE_CHOICES = 3;

/**
 * The room code the testing menu's prize draw uses.
 *
 * A real bracket keys its offer on the room and the champion, so the same win
 * always offers the same three. There is no room and no champion here, so the
 * menu supplies a fixed code and uses its own reroll counter as the champion
 * — which keeps the offer a pure function of the input, and therefore
 * replayable, without pretending a tournament happened.
 *
 * Deliberately a name a real room code cannot be: `normaliseRoomCode` strips
 * everything but Crockford base32, so no room will ever collide with it.
 */
export const PRIZE_CHEAT_CODE = "cheat-bench";

/**
 * What a bracket of this size is worth, as a multiplier in per mille.
 *
 * Read off the rounds rather than the head count: 4 is two rounds, 8 is three,
 * 16 is four. The step is generous because the difference in what it took to
 * get here is generous.
 */
export function prizeWeight(size: BracketSize): number {
  const rounds = Math.log2(size);
  // 1000, 1500, 2000 for two, three and four rounds. A four-player bracket is
  // worth exactly what it says and nothing is scaled *down* — the smallest
  // event still has to be worth entering.
  return 1000 + (rounds - 2) * 500;
}

/** The chance of any shine at all, per mille, before the field is read. */
const SHINE_BASE = 120;
/** And of a colour on top of it. */
const CHROMA_BASE = 150;
/** Of a second ability, which is a one-in-a-hundred creature in the wild. */
const TWO_ABILITY_BASE = 80;
/** Of at least one. */
const ONE_ABILITY_BASE = 300;

/**
 * The floor a prize's IVs roll from, out of `IV_MAX`.
 *
 * A starter rolls 0..12 and a wild creature 0..6. A prize rolls from a floor
 * that climbs with the field, so a sixteen-player winner is guaranteed a
 * creature better bred than anything they could have caught — without ever
 * being handed a perfect one, which is what breeding is for.
 */
export function prizeIvFloor(size: BracketSize): number {
  return Math.round((IV_MAX * (prizeWeight(size) - 1000)) / 4000) + 8;
}

/**
 * The species a prize can be.
 *
 * Anything that does not evolve *from* something else — the bottom of a line,
 * which is the only thing a level 1 can sensibly be. Filtered once at module
 * load, from the manifest, so a rebuilt roster changes the pool without this
 * file knowing any species by name.
 */
const BASE_FORMS: readonly string[] = (() => {
  const evolved = new Set<string>();
  for (const entry of ALL_SPECIES) {
    for (const step of entry.evolvesTo) evolved.add(step.id);
  }
  return ALL_SPECIES.filter((entry) => !evolved.has(entry.id)).map((entry) => entry.id);
})();

/**
 * How good a species is, as the total of its line's best base stats.
 *
 * "Rare" in the request, and rarity in this game is not a tag on a row — the
 * manifest has no legendary flag and adding one would be a table to keep in
 * step with a roster that is meant to be swappable. What it does have is
 * numbers, and the creatures everybody thinks of as rare are the ones whose
 * fully grown form is enormous. So the pool is the top slice by what the line
 * *becomes*, which picks out the pseudo-legendaries and the one-stage giants
 * without naming a single one.
 */
function lineCeiling(speciesId: string, seen = new Set<string>()): number {
  if (seen.has(speciesId)) return 0;
  seen.add(speciesId);

  const entry = speciesById(speciesId);
  const own = STAT_IDS.reduce((total, stat) => total + entry.base[stat], 0);
  let best = own;
  for (const step of entry.evolvesTo) {
    best = Math.max(best, lineCeiling(step.id, seen));
  }
  return best;
}

/**
 * The draw pool: base forms whose line grows into something worth winning.
 *
 * Sorted and sliced rather than filtered on a threshold, so the pool is the
 * same size whatever the roster is — a manifest with different numbers in it
 * still yields a top hundred rather than everything or nothing.
 */
const PRIZE_POOL: readonly string[] = [...BASE_FORMS]
  .map((id) => ({ id, ceiling: lineCeiling(id) }))
  // Sorted by id as the tie-break, so a rebuild that leaves two lines level
  // does not silently reorder the pool.
  .sort((a, b) => b.ceiling - a.ceiling || a.id.localeCompare(b.id))
  .slice(0, 100)
  .map((one) => one.id);

/** Exported for the test that keeps this honest — a pool of one is not a draw. */
export const PRIZE_SPECIES = PRIZE_POOL;

/**
 * One prize, rolled.
 *
 * Every roll is named off one stream so the three offered are reproducible
 * from the tournament rather than from whoever is looking at them: two
 * spectators and the champion all compute the same three, which is what stops
 * the winner's client offering itself something better than the room agreed.
 */
export function rollPrize(rng: Rng, size: BracketSize, uid: number): Individual {
  const weight = prizeWeight(size);
  const scaled = (base: number) => Math.min(1000, Math.round((base * weight) / 1000));

  const speciesId = PRIZE_POOL[intBelow(rng, PRIZE_POOL.length)];

  // Shine first, and a colour on top of it, so a bigger field moves both.
  const tier = intBelow(rng, 1000) < scaled(SHINE_BASE) ? TOP_TIER - intBelow(rng, 2) : 0;
  const chroma =
    intBelow(rng, 1000) < scaled(CHROMA_BASE) ? CHROMA_IDS[intBelow(rng, CHROMA_IDS.length)] : null;

  // Abilities on the same ladder the wild uses, with the field on the scale.
  const abilityRoll = intBelow(rng, 1000);
  const abilities = pickAbilities(
    rng,
    abilityRoll < scaled(TWO_ABILITY_BASE) ? 2 : abilityRoll < scaled(ONE_ABILITY_BASE) ? 1 : 0,
  );

  const floor = prizeIvFloor(size);
  const ivs = {} as StatTable;
  for (const stat of STAT_IDS) ivs[stat] = intBetween(rng, floor, IV_MAX);

  return {
    uid,
    speciesId,
    level: 1,
    exp: 1,
    ivs: clampIvs(ivs),
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    natureId: NATURE_IDS[intBelow(rng, NATURE_IDS.length)],
    variantId: appearanceId(tier, chroma),
    // Left bare exactly as `wildAt` leaves one: the caller runs it through
    // `withMoves` and `atFullHealth`, which is where the stat table is known.
    hp: 0,
    status: null,
    sleepTurns: 0,
    moves: [],
    pp: [],
    abilities,
    heldItem: null,
    nickname: null,
    traded: false,
    prize: true,
    cheat: false,
    parents: null,
    gender: rollGender(rng),
  };
}

/**
 * The stream a live bracket's prize is drawn from: the host's world and the room.
 *
 * The host's seed is in it so a prize belongs to somewhere. The same room
 * code, hosted from two different worlds, is two different draws. The room
 * code stays in too, so one host running two brackets does not offer the same
 * three twice.
 *
 * It does not give the host an offer they can shop for. The champion's id is
 * also in the key, and that is a fresh peer id nobody knows until the final
 * ends, so there is nothing to try seeds against.
 *
 * Prefixed so it cannot collide with the arena's `seed|arenaId` stream, which
 * is also the world seed and something after a bar.
 */
export function cupPrizeKey(hostSeed: string, code: string): string {
  return `cup|${hostSeed}|${code}`;
}

/**
 * The three on offer, from the tournament that produced them.
 *
 * Keyed on the room code and the champion, so the same win always offers the
 * same three — a client that reloaded mid-celebration sees what it saw, and a
 * client that did not like its three cannot reroll by rejoining.
 *
 * Distinct species, because three of the same thing is one choice wearing
 * three hats. The appearances are allowed to repeat: two shinies on one screen
 * is a good problem and forcing them apart would quietly cap the generosity
 * the field size just bought.
 */
export function prizeOffer(
  code: string,
  championId: string,
  size: BracketSize,
  firstUid: number,
): Individual[] {
  const offered: Individual[] = [];
  // Bounded: a pool of a hundred cannot fail to yield three distinct species
  // in anything like this many draws, and a `while` here would be a hang on a
  // roster somebody trimmed to two.
  for (let attempt = 0; offered.length < PRIZE_CHOICES && attempt < 64; attempt++) {
    const rng = rngFor(code, "prize", championId, attempt);
    const rolled = rollPrize(rng, size, firstUid + offered.length);
    if (offered.some((one) => one.speciesId === rolled.speciesId)) continue;
    offered.push(rolled);
  }
  return offered;
}

/**
 * What the testing menu's bench offers, for this world, field and roll.
 *
 * One function for the menu's preview and for the engine taking one, so the
 * three on screen are the three that can arrive. The world seed goes in the
 * same way a hosted bracket's does, through `cupPrizeKey`, so the bench is a
 * preview of this world's draws and not of a draw from no world at all.
 */
export function cheatPrizeOffer(worldSeed: string, roll: number, size: BracketSize, firstUid: number): Individual[] {
  return prizeOffer(cupPrizeKey(worldSeed, PRIZE_CHEAT_CODE), String(roll), size, firstUid);
}
