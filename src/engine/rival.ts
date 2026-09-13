import { ALL_SPECIES, effectiveness, species as speciesById, TYPE_NAMES } from "./dex";
import { rollAbilities } from "./abilities";
import { rollGender } from "./gender";
import { NATURE_IDS } from "./natures";
import { intBelow, rngFor, type Rng } from "./rng";
import type { Individual, SpeciesEntry, StatTable } from "./types";
import { appearanceId, CHROMA_IDS, TOP_TIER } from "./variants";

/**
 * Somebody who is following you.
 *
 * Every trainer in this world stands still and waits. That is what makes them
 * scenery you choose to walk into, which is the right call a hundred and fifty
 * times over — and it means nothing in the world has ever come *after* you.
 *
 * The rival does. He turns up three steps behind, walks where you have just
 * walked for twenty moves, and then catches up. You can see him the whole time
 * and there is nothing to do about it but be ready, which is the only kind of
 * pressure a game with no clock can apply.
 *
 * ## What makes him worth being ready for
 *
 * His team is *built out of yours*. As many as you have, and every one of them
 * chosen to beat one of yours — so a party that has grown lopsided is a party
 * he has noticed. There is no way to prepare for him in general; you prepare by
 * not having an obvious weakness, which is the thing the rest of the game never
 * asks you to do.
 *
 * And he *gains on you*. The first time he catches you he is at your party's
 * average exactly; every meeting after that he is two levels further ahead
 * than the last. A flat edge made him the same fight forever — your party grew
 * and his grew with it and the gap never moved — which is fine for somebody
 * standing on a route and wrong for the one thing that keeps coming back. The
 * people on the routes already work this way; see `REMATCH_LEVELS`.
 *
 * And he is *decorated*. Chromas and high shine at rates nothing else in this
 * world comes close to, because he is the one trainer you are meant to
 * remember, and because it is a quiet insult: the colours you have spent forty
 * hours hunting are what he turns up wearing.
 *
 * ## Why it is all derived
 *
 * Nothing about him is stored except the tick he appeared on. Where he is
 * standing is the player's own position three moves ago, read off a trail the
 * state keeps anyway; what he is carrying is computed from the party at the
 * moment the fight starts. A save that replays puts him in the same places
 * saying the same thing, and there is no second copy of him to disagree with
 * the first.
 */

/** How often he turns up, in ticks. Roughly every couple of hours of walking. */
export const RIVAL_EVERY = 2500;

/**
 * How long he follows before he catches you.
 *
 * Twenty moves is long enough to see him, work out what it means and decide
 * whether to run for a Center, and short enough that it is a chase rather than
 * an escort.
 */
export const RIVAL_STALK = 20;

/**
 * How far back he walks.
 *
 * Three, so he is *visibly* behind you rather than on top of you, and so
 * turning a corner means losing sight of him for a moment. It also means he
 * cannot be walked into: he is always on ground you have just left.
 */
export const RIVAL_BEHIND = 3;

/** How many of your recent positions the state keeps, for him to walk. */
export const TRAIL = RIVAL_BEHIND + 1;

/**
 * What beating him pays.
 *
 * Generous, and deliberately more than anybody standing on a route: he is the
 * hardest thing that happens between gyms, he brings as many as you have, and
 * he turned up uninvited.
 */
export const RIVAL_PURSE = 6000;

export const RIVAL_TAG = "rival:";
export const RIVAL_NAME = "Rival";

/**
 * The chance, per creature, that he turns up wearing a colour, in per mille.
 *
 * Seven in ten. Absurd on purpose: the whole census of a world holds fifty-odd
 * decorated creatures and he brings a party of them, which is either a joke at
 * your expense or evidence that something is very wrong with him. Both readings
 * are fine.
 */
const CHROMA_CHANCE = 700;

/** And the chance of real shine on top of that. */
const SHINE_CHANCE = 550;

/**
 * Levels above the average of your party, per time he has already caught you.
 *
 * It was a flat three, which made him the same fight forever: your party grew,
 * his grew with it, and the gap never moved. That is the right shape for a
 * *trainer* on a route and the wrong one for the thing the game keeps sending
 * after you — the tenth meeting should not be the first meeting again.
 *
 * So he escalates, the way the people on the routes already do: they come back
 * `REMATCH_LEVELS` stronger for every beating they have taken, and this is the
 * same rule with a smaller step. Two rather than three because he brings *as
 * many as you have* and picks every one of them to counter one of yours, so
 * the same step compounds harder on him than on somebody standing still with a
 * written-down team.
 *
 * The first meeting is therefore at your average exactly, and the edge is
 * something he earns by turning up.
 */
const LEVEL_STEP = 2;

/**
 * What he brings against one of yours.
 *
 * The rule is the simplest one that reads as *countering*: find the types that
 * hit this creature hardest, and pick something that has one of them. Not the
 * strongest creature in the dex with that type — the strongest is a different
 * kind of unfair, and one that has nothing to do with your party — but one
 * drawn from everything with the type, so the same weakness is punished by a
 * different face each time.
 */
function counterFor(rng: Rng, target: readonly string[]): SpeciesEntry {
  let best = 4;
  const hardest: string[] = [];

  for (const type of TYPE_NAMES) {
    const quarters = effectiveness(type, target);
    if (quarters > best) {
      best = quarters;
      hardest.length = 0;
    }
    if (quarters === best && quarters > 4) hardest.push(type);
  }

  // Nothing is super-effective against it — which happens, and is exactly the
  // party you would want to build. He settles for something that is at least
  // not resisted.
  const wanted = hardest.length ? hardest : TYPE_NAMES.filter((type) => effectiveness(type, target) >= 4);
  const type = wanted[intBelow(rng, wanted.length)] ?? "normal";

  const pool = ALL_SPECIES.filter((spec) => spec.types.some((one) => one === type));
  return pool.length ? pool[intBelow(rng, pool.length)] : ALL_SPECIES[0];
}

/** How he dresses one of them. */
function appearanceOf(rng: Rng): string {
  const chroma = intBelow(rng, 1000) < CHROMA_CHANCE ? CHROMA_IDS[intBelow(rng, CHROMA_IDS.length)] : null;
  // Weighted to the top of the ladder rather than spread over it: a Faded
  // rival is not a statement.
  const tier = intBelow(rng, 1000) < SHINE_CHANCE ? TOP_TIER - intBelow(rng, 2) : 0;
  return appearanceId(tier, chroma);
}

/**
 * The team he catches you with.
 *
 * Built at the moment the battle starts rather than when he appears, so the
 * twenty moves of warning are twenty moves in which swapping your party
 * actually changes what turns up. Whether that is preparation or cheating on
 * his part is left to the player.
 */
export function rivalTeam(
  seed: string,
  at: number,
  party: readonly Individual[],
  /**
   * How many times he has caught you *before* this one.
   *
   * Nought on the first meeting, which is what puts that fight at your party's
   * average exactly. The caller subtracts, because `rivalVisits` counts the
   * appearance that is happening right now and the arithmetic here should not
   * have to know that.
   *
   * Defaulted so the two dozen call sites in the tests that only care about
   * *who* he brings do not have to say anything about *how strong*.
   */
  metBefore = 0,
): Individual[] {
  const alive = party.length ? party : [];
  if (!alive.length) return [];

  const average = Math.round(
    alive.reduce((total, one) => total + one.level, 0) / alive.length,
  );
  const level = Math.max(2, Math.min(100, average + Math.max(0, metBefore) * LEVEL_STEP));

  return alive.map((mine, slot) => {
    const rng = rngFor(seed, "rival", at, slot);
    const spec = counterFor(rng, speciesById(mine.speciesId).types);

    const ivs = {} as StatTable;
    for (const stat of ["hp", "atk", "def", "spa", "spd", "spe"] as const) {
      // Well bred without being perfect. He is a rival, not the Cup.
      ivs[stat] = 20 + intBelow(rng, 12);
    }

    return {
      uid: 0,
      speciesId: spec.id,
      level,
      exp: level * level * level,
      ivs,
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      natureId: NATURE_IDS[intBelow(rng, NATURE_IDS.length)],
      variantId: appearanceOf(rng),
      hp: 0,
      status: null,
      sleepTurns: 0,
      moves: [],
      pp: [],
      abilities: rollAbilities(rng),
      heldItem: null,
      nickname: null,
      traded: false,
      prize: false,
      cheat: false,
      parents: null,
      gender: rollGender(rng),
    };
  });
}

/**
 * Whether he is due.
 *
 * Measured from the last time he turned up rather than as a modulo on the
 * clock, so the gap between appearances is genuinely `RIVAL_EVERY` however long
 * the last encounter took to resolve.
 *
 * And `null` means never, which is how "at the beginning" falls out without
 * being a special case: the first field tick of a new game is the first tick he
 * has not already come on. A modulo *looked* like it did this and did not —
 * tick nought is the state before any input, when you are still choosing a
 * starter, so the game began at tick one and he was never due until 2500.
 */
export function rivalDue(tick: number, last: number | null): boolean {
  return last === null || tick - last >= RIVAL_EVERY;
}

/** Whether he has finished following and is about to catch you. */
export function rivalCaughtUp(tick: number, since: number): boolean {
  return tick - since >= RIVAL_STALK;
}
