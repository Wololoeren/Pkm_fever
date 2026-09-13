import { maxHp } from "@/engine/battle";
import { ALL_SPECIES, learnset, movesAtLevel } from "@/engine/dex";
import { NATURE_IDS } from "@/engine/natures";
import { fullPp } from "@/engine/pp";
import { expForLevel } from "@/engine/progression";
import { intBetween, rngFor, type Rng } from "@/engine/rng";
import { IV_MAX } from "@/engine/stats";
import type { Individual } from "@/engine/types";

export interface Matchup {
  /** Names this matchup's rolls; the arena hands it to `startBattle` as the tag. */
  tag: string;
  a: Individual[];
  b: Individual[];
}

export interface TeamOptions {
  /** Members per side. */
  size?: number;
  /** Inclusive range a matchup's level is drawn from. */
  levels?: [number, number];
  /**
   * How far either side of the matchup's level a member may sit.
   *
   * A matchup has one level and its members are near it, rather than each
   * member rolling anywhere in the range: a level-twelve creature against a
   * level-fifty one is a battle whose decisions do not matter, and a policy
   * learns nothing from a turn it could not have lost.
   */
  spread?: number;
}

/** Species with somewhere to swing from: anything that learns a move by the
 * levels we deal. Filtered once, because a creature with no moves is a pass. */
const POOL = ALL_SPECIES.filter((entry) => learnset(entry.id).length > 0);

/**
 * One creature drawn from the whole bestiary at a level, with the moves it
 * would know by then, a nature, and IVs spread the way the world spreads them.
 *
 * Wider than anything the world places — the world deals a route's biome and
 * a level band — and that is the point: a policy trained on the whole chart
 * has seen the corner cases a route never shows it.
 */
export function randomCreature(rng: Rng, uid: number, levels: [number, number]): Individual {
  const entry = POOL[Math.floor(rng() * POOL.length)];
  const level = intBetween(rng, levels[0], levels[1]);
  const ivs = {
    hp: intBetween(rng, 0, IV_MAX),
    atk: intBetween(rng, 0, IV_MAX),
    def: intBetween(rng, 0, IV_MAX),
    spa: intBetween(rng, 0, IV_MAX),
    spd: intBetween(rng, 0, IV_MAX),
    spe: intBetween(rng, 0, IV_MAX),
  };
  const moves = movesAtLevel(entry.id, level);
  const built: Individual = {
    uid,
    speciesId: entry.id,
    level,
    exp: expForLevel(level),
    ivs,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    natureId: NATURE_IDS[Math.floor(rng() * NATURE_IDS.length)],
    variantId: "normal",
    hp: 0,
    status: null,
    sleepTurns: 0,
    moves,
    pp: fullPp(moves),
    abilities: [],
    heldItem: null,
    nickname: null,
    traded: false,
    prize: false,
    cheat: false,
    parents: null,
    gender: rng() < 0.5 ? "female" : "male",
  };
  return { ...built, hp: maxHp(built) };
}

/** `count` matchups, each a pure function of the seed and its index. */
export function randomMatchups(seed: string, count: number, options: TeamOptions = {}): Matchup[] {
  const size = options.size ?? 3;
  const range = options.levels ?? [10, 60];
  const spread = options.spread ?? 4;
  const matchups: Matchup[] = [];
  for (let index = 0; index < count; index++) {
    const rng = rngFor(seed, "matchup", index);
    const centre = intBetween(rng, range[0], range[1]);
    const levels: [number, number] = [Math.max(1, centre - spread), Math.min(100, centre + spread)];
    const a: Individual[] = [];
    const b: Individual[] = [];
    for (let slot = 0; slot < size; slot++) a.push(randomCreature(rng, 1 + slot, levels));
    for (let slot = 0; slot < size; slot++) b.push(randomCreature(rng, 101 + slot, levels));
    matchups.push({ tag: `ai:${seed}:${index}`, a, b });
  }
  return matchups;
}
