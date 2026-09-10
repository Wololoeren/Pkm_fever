import { learnableAt, move as moveById, type MoveEntry } from "./dex";
import { displayPower } from "./moves";
import { MOVE_SLOTS } from "./progression";
import { EV_MAX_PER_STAT, EV_MAX_TOTAL } from "./stats";
import { NATURES } from "./natures";
import { BATTLE_STAT_IDS, STAT_IDS, type StatId, type StatTable } from "./types";

/**
 * The Cup.
 *
 * Five people in a house at the far end of the ash flats, and the only thing
 * in this world that is not scaled to you. A gym reads how far you have come
 * and meets you there, which is what stops the eighth being a wall at hour two
 * — the Cup is the opposite decision on purpose. It is a fixed ceiling. It is
 * the same five on your first badge as on your eighth, and the answer to "am I
 * ready" is a number you can look up rather than a thing you find out.
 *
 * What makes it hard is not the levels. It is four rules already in the game,
 * pointed at one door:
 *
 *   **Nothing gives your uses back.** Power points come back at a Center or by
 *   losing, and there is neither in this house. Five six-on-six battles is
 *   thirty creatures on one tank, so the run is a budget rather than five
 *   fights. Health is the other half of that trade and it works the opposite
 *   way: you are standing in the field again between one contender and the
 *   next, so a Full Restore is worth exactly as much as you thought to bring.
 *   Health can be bought. Uses cannot.
 *
 *   **They are bred, not caught.** Perfect IVs, the full 510 of effort spent
 *   on the two stats their species is actually for, and a nature chosen rather
 *   than rolled. This is what ten generations of your own breeding produces;
 *   they simply already did it.
 *
 *   **They all have abilities.** Two each. In the wild that is a one-in-a-
 *   hundred creature, and out here it is everybody — which is the clearest
 *   possible statement of what the far end of the world is like.
 *
 *   **Losing sends you home.** A whiteout from the Cup is the walk back from
 *   ring six — though it does patch you up on the way, which is the one place
 *   losing gives you something. The five you already beat stay beaten.
 *
 * Nobody is invited. The invitation is a key item won for eight badges, and
 * the Steward at the door wants to see it before he will write your name down.
 */

/** Which route the house stands on. The far end of the ash flats. */
export const CUP_BIOME = "ashflats";
export const CUP_RING = 6;

/** How many each of them brings. Six, all at the same level: nobody in this
 * house is padding a team out with something two levels down. */
export const CUP_SIZE = 6;

/**
 * How wide a net is cast before six are drawn out of it.
 *
 * Twelve rather than six, so the roster is not identical on every seed — the
 * Cup is a fixed wall, but which six of the strongest twelve are standing on
 * it is still something a seed decides.
 */
export const CUP_POOL = 12;

export interface CupSpec {
  id: string;
  name: string;
  /**
   * The type they lean on, or null for somebody who does not lean.
   *
   * Half a team of it rather than all of it. A mono-type team is a puzzle with
   * one answer, which is what a gym is *for*; the Cup is not eight more gyms,
   * so the slant is an identity rather than a weakness.
   */
  slant: string | null;
  /** Every one of their six. Fixed — the Cup does not scale. */
  level: number;
  lines: string[];
}

/**
 * The five, in the order they are meant to be taken.
 *
 * Order is not enforced. There is nothing stopping you walking past four of
 * them to the Sovereign, and there is nothing much stopping her either.
 */
export const CUP_ROSTER: readonly CupSpec[] = [
  {
    id: "cup-bastion",
    name: "Bastion",
    slant: "steel",
    level: 84,
    lines: [
      "First. Everybody gets me first, and everybody thinks that means easiest.",
      "I have six and none of them are in a hurry. You will run out of something before I run out of health — the question is only what.",
    ],
  },
  {
    id: "cup-oracle",
    name: "Oracle",
    slant: "psychic",
    level: 88,
    lines: [
      "I already know how this goes. So do you, if you counted your uses on the way in.",
      "Bastion took something off you. He always does. That is the whole of his job and he is very good at it.",
    ],
  },
  {
    id: "cup-umbra",
    name: "Umbra",
    slant: "dark",
    level: 92,
    lines: [
      "Third of five. This is where people find out they were playing four battles' worth of Pokémon.",
      "Nothing in here is fair and nothing in here pretends to be. Go on.",
    ],
  },
  {
    id: "cup-halo",
    name: "Halo",
    slant: "fairy",
    level: 96,
    lines: [
      "You are very nearly through. I would like you to notice how that feels, because it is the most dangerous part.",
      "Six of mine against whatever you have left. I am not the last one and I do not need to be.",
    ],
  },
  {
    id: "cup-sovereign",
    name: "Sovereign",
    slant: null,
    level: 100,
    lines: [
      "Four down. Sit if you like — nobody has ever taken the chair, but it is there.",
      "I have no type. I was never handed one and I never wanted one. Six of the best there are, at a hundred, and every one of them bred the way you have been breeding yours.",
      "That is the whole trick, and I am telling you because it is not a trick.",
    ],
  },
];

const BY_ID = new Map(CUP_ROSTER.map((one) => [one.id, one]));

export function contender(id: string): CupSpec {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`unknown contender: ${id}`);
  return found;
}

export function isContender(id: string): boolean {
  return BY_ID.has(id);
}

/** Every one of them beaten, in roster order — what the quest counts. */
export const CUP_IDS: readonly string[] = CUP_ROSTER.map((one) => one.id);

/**
 * The full 510, spent the way somebody who meant it would spend it.
 *
 * Two hundred and fifty-two into each of the two stats the species is best at
 * and the last six into the third, which is the standard competitive spread
 * and — more to the point — is derived from base stats rather than authored.
 * Thirty hand-written effort tables would be thirty things to keep in step
 * with a manifest that can be rebuilt.
 *
 * Ties break on the canonical stat order, so the same species is always built
 * the same way on every machine.
 */
export function cupEffort(base: StatTable): StatTable {
  const ranked = [...STAT_IDS].sort(
    (a, b) => base[b] - base[a] || STAT_IDS.indexOf(a) - STAT_IDS.indexOf(b),
  );

  const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } as StatTable;
  let spent = 0;
  for (const stat of ranked) {
    if (spent >= EV_MAX_TOTAL) break;
    const give = Math.min(EV_MAX_PER_STAT, EV_MAX_TOTAL - spent);
    evs[stat] = give;
    spent += give;
  }
  return evs;
}

/**
 * A nature chosen rather than rolled: up in what it is best at, down in what
 * it is worst at.
 *
 * Every one of the twenty trades exists in the vanilla twenty-five — five
 * stats up times four remaining down — so the pair always resolves to a real
 * nature and there is no fallback to reason about. The neutral five are never
 * reached, which is correct: nobody at this end of the world is carrying a
 * Hardy.
 */
export function cupNature(base: StatTable): string {
  const ranked = [...BATTLE_STAT_IDS].sort(
    (a, b) => base[b] - base[a] || BATTLE_STAT_IDS.indexOf(a) - BATTLE_STAT_IDS.indexOf(b),
  );
  const plus = ranked[0] as Exclude<StatId, "hp">;
  const minus = ranked[ranked.length - 1] as Exclude<StatId, "hp">;

  const found = NATURES.find((one) => one.plus === plus && one.minus === minus);
  if (!found) throw new Error(`no nature raises ${plus} and lowers ${minus}`);
  return found.id;
}

/** How many moves of one type a Cup team member will carry. */
const SAME_TYPE_LIMIT = 2;

/**
 * A move that is not the preferred category is still worth carrying, at this
 * much of its face value. Six tenths rather than nothing: a mixed attacker is
 * a real thing, and a Kyurem-White that refused every physical move would end
 * up holding status because its best four happened to be the wrong colour.
 */
const OFF_CATEGORY = 6;

/**
 * The four a Cup team member actually brings.
 *
 * Everything else in this game builds a moveset with `movesAtLevel`, which
 * takes the last four a species learned. That is the right answer nearly
 * everywhere EM it is what a creature you caught knows, and it is what makes
 * the move-learning prompt a decision worth making EM but at level a hundred
 * it is close to random. Calyrex-Ice learns Leech Seed, Heal Pulse, Solar Beam
 * and Future Sight last, so a 453-Attack physical monster turns up holding two
 * heals and a special attack and cannot beat anybody.
 *
 * So the Cup chooses. That is not a special case sneaked in for difficulty; it
 * is the difference the fiction already claims: these six were *drilled*, and a
 * drilled creature carries the four moves it is for. A gym leader is somebody
 * with a type and a room, and still gets the last four EM which is why they
 * are eight rungs on a ladder and this is the top of it.
 *
 * Deterministic in (species, level): no rng, so the same contender brings the
 * same six with the same forty moves on every machine.
 */
export function cupMoveset(speciesId: string, level: number, base: StatTable): string[] {
  const pool = learnableAt(speciesId, level)
    .map(moveById)
    .sort((a, b) => score(b, base) - score(a, base) || a.id.localeCompare(b.id));

  const taken: MoveEntry[] = [];
  const byType = new Map<string, number>();

  // Two passes over one ranked list. The first respects the type cap, the
  // second ignores it EM a species whose only four decent moves are all Dragon
  // should carry four Dragon moves rather than pad with a Growl.
  for (const capped of [true, false]) {
    for (const entry of pool) {
      if (taken.length >= MOVE_SLOTS) break;
      if (taken.includes(entry)) continue;
      if (capped && (byType.get(entry.type) ?? 0) >= SAME_TYPE_LIMIT) continue;

      taken.push(entry);
      byType.set(entry.type, (byType.get(entry.type) ?? 0) + 1);
    }
  }

  // Whatever it knows, if it knows fewer than four. Nothing in the manifest
  // learns nothing at all, and `withMoves` has the same floor.
  return taken.map((entry) => entry.id);
}

/**
 * What one move is worth to one species, as an integer.
 *
 * Expected damage per use: power times accuracy, discounted if it is the wrong
 * category for this creature. A status move scores zero and is therefore only
 * ever a filler, which is the intended bias EM the five in that house are not
 * there to set up.
 *
 * `displayPower` rather than `power`, so the thirty-nine moves the manifest
 * cannot price are read at what they actually swing for instead of at zero.
 */
function score(entry: MoveEntry, base: StatTable): number {
  if (entry.category === "status") return 0;

  const power = displayPower(entry) ?? 0;
  const accuracy = entry.accuracy === 0 ? 100 : entry.accuracy;
  const wanted = base.atk >= base.spa ? "physical" : "special";
  const weight = entry.category === wanted ? 10 : OFF_CATEGORY;

  return power * accuracy * weight;
}

/** How many abilities everybody in this house has. */
export const CUP_ABILITIES = 2;
