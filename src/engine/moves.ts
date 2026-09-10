import type { MoveEntry } from "./dex";
import { intBelow, weighted, type Rng } from "./rng";
import type { Individual } from "./types";

/**
 * What a move does when its manifest row cannot say.
 *
 * 39 of the 791 moves in the manifest are non-status attacks with `power: 0`.
 * They are not weak — they are the moves whose damage Showdown computes in a
 * callback, and `@pkmn/dex` ships data, not scripts, so there is nothing for
 * scripts/build-dex.mjs to copy. Under the old damage gate
 * (`category !== "status" && power > 0`) every one of them burned a turn and
 * did nothing: Night Shade, Seismic Toss, Super Fang, Counter, Fissure,
 * Endeavor, Flail, Electro Ball, Gyro Ball, Low Kick, Return, Psywave and the
 * rest. That is where the hard-locks came from.
 *
 * This module is the missing callback, written once and asked by battle.ts.
 * It lives in the engine rather than in the manifest because the manifest has
 * no field that could hold it — "damage is computed" is not a number — and
 * regenerating four data files to add `damage` and `ohko` would still only
 * cover 8 of the 39. It names move ids, which nothing else in src/engine does;
 * that is the price of the manifest not being able to express a formula, and
 * the alternative — a `power: 50` fudge on every one of them — throws away
 * Seismic Toss and Fissure to avoid one table.
 *
 * Everything here is integer arithmetic. The three moves that roll draw from
 * an Rng the caller names, so this module never touches rngFor's part list.
 */

export type Damage =
  /**
   * Substitute this base power and run the ordinary formula — crit, spread,
   * STAB, effectiveness and burn all apply, exactly as for a move whose power
   * came out of the manifest.
   */
  | { t: "power"; power: number }
  /**
   * This many hit points, exactly. Immunity still applies (Seismic Toss does
   * nothing to a ghost) but nothing else does: no crit, no spread roll, no
   * STAB, no effectiveness multiplier. That is how these read in the games,
   * and it is the whole point of them.
   */
  | { t: "exact"; amount: number; selfKo?: boolean }
  /** Nothing happens, and the log says so rather than reporting a hit of 0. */
  | { t: "fails" };

/**
 * Everything a variable-damage move might read, gathered by the caller.
 *
 * Passed in rather than reached for, because battle.ts owns stage-adjusted
 * stats and max HP and this module must not import it — battle.ts imports
 * this, and a cycle between the two would be a build problem for no gain.
 */
export interface DamageContext {
  attacker: Individual;
  defender: Individual;
  attackerMaxHp: number;
  defenderMaxHp: number;
  /** Stage-adjusted, for the two moves that divide one by the other. */
  attackerSpeed: number;
  defenderSpeed: number;
  /** The defender's positive stat stages, summed. Punishment reads it. */
  defenderBoosts: number;
  /** Damage the attacker has already taken this turn, by category. The
   * counter family reads it, and only move damage counts — recoil and poison
   * are not something to retaliate against. */
  takenPhysical: number;
  takenSpecial: number;
  /** For the three moves with a roll of their own. */
  rng: Rng;
  /** Uses left in the slot this move is being swung from. Trump Card reads
   * it, and could not until power points existed. */
  ppLeft: number;
}

/**
 * Flail and Reversal: the weaker you are, the harder you swing.
 *
 * The bucket boundaries are the game's, on `floor(48 * hp / maxHp)` rather
 * than a percentage, because that is the quantity the real table is written
 * against and rounding a percentage lands on a different bucket for small HP
 * pools — which is most of this game, where a ring-1 wild has about 20 HP.
 */
function pinchPower(hp: number, max: number): number {
  const scaled = max > 0 ? Math.floor((48 * Math.max(0, hp)) / max) : 0;
  if (scaled < 1) return 200;
  if (scaled < 5) return 150;
  if (scaled < 13) return 100;
  if (scaled < 22) return 80;
  if (scaled < 43) return 40;
  return 20;
}

/** Electro Ball: how many times faster the attacker is. */
function speedRatioPower(ours: number, theirs: number): number {
  const ratio = theirs > 0 ? Math.floor(ours / theirs) : 4;
  if (ratio >= 4) return 150;
  if (ratio === 3) return 120;
  if (ratio === 2) return 80;
  if (ratio === 1) return 60;
  return 40;
}

/** Half of what the target has left, and never less than one. Super Fang,
 * Nature's Madness and Ruination all read the same way. */
function halfRemaining(defender: Individual): Damage {
  return { t: "exact", amount: Math.max(1, Math.floor(defender.hp / 2)) };
}

/** A fraction of the target's remaining health, as base power. Wring Out and
 * Crush Grip. */
function squeezePower(defender: Individual, max: number): number {
  return max > 0 ? Math.max(1, Math.floor((120 * defender.hp) / max)) : 1;
}

/**
 * Damage taken this turn, thrown back.
 *
 * Counter and Mirror Coat answer only the category that hit them; Metal Burst
 * and Comeuppance answer either. All four are worthless if nothing landed,
 * which is a real failure rather than a hit of zero.
 */
function retaliate(taken: number, numerator: number, denominator: number): Damage {
  if (taken <= 0) return { t: "fails" };
  return { t: "exact", amount: Math.max(1, Math.floor((taken * numerator) / denominator)) };
}

/**
 * The nine moves whose real formula needs something the game does not have,
 * and the flat power each stands in with.
 *
 * Every one of these is a placeholder for a specific missing input, named in
 * the comment so that replacing it is a one-line diff rather than an
 * archaeology exercise. Nothing here is inert, which is the constraint that
 * matters: a move that burns a turn and does nothing is the bug being fixed,
 * and "we do not have the weight table yet" is not a reason to reintroduce
 * it for four moves.
 *
 * What each is waiting for:
 *  - return, frustration: friendship, which `Individual` does not carry. Real
 *    power is `friendship * 2 / 5`, so 0..102. Both take the ceiling, because
 *    Return is the strongest normal physical move most species ever learn and
 *    halving it silently would misprice a move the player is choosing on
 *    purpose. With no friendship the two moves are, honestly, one move.
 *  - lowkick, grassknot: the target's weight. species.json carries no
 *    weightkg — see scripts/build-dex.mjs, which copies neither `weightkg`
 *    nor `weighthg` — so the 20..120 bucket table has no input. 60 is the
 *    25..50 kg bucket, which is where most of the manifest sits.
 *  - heavyslam, heatcrash: the weight *ratio*, same missing field. 60 is the
 *    ratio-2 bucket.
 *  - beatup: one hit per healthy party member, at `base atk / 10 + 5` each.
 *    The engine has the party but no multi-hit moves at all, and adding them
 *    is a larger change than this fix. 30 is roughly one hit at mid base
 *    attack.
 *  - bide: two turns of charging, then double what was absorbed. There is no
 *    multi-turn move state, so it is a plain weak normal attack with the +1
 *    priority the manifest already gives it.
 *  - spitup: 100 per Stockpile stack, and Stockpile is one of the 178 status
 *    moves that currently do nothing either. One stack.
 *  - trumpcard: no longer a stand-in. Power points exist now, so it reads
 *    them: 40 with five or more left, and 200 on the last one. It was the
 *    only entry on this list waiting for something the game has since grown.
 *  - naturalgift, fling: a held item, and there are no held items. 80 and 30
 *    are the middle of each move's real range.
 */
const STAND_IN_POWER: Record<string, number> = {
  return: 102,
  frustration: 102,
  lowkick: 60,
  grassknot: 60,
  heavyslam: 60,
  heatcrash: 60,
  beatup: 30,
  bide: 60,
  spitup: 100,
  naturalgift: 80,
  fling: 30,
};

/**
 * Magnitude's seven-way roll, with the game's own weights out of 100.
 *
 * Integer weights through `weighted` rather than a float comparison, for the
 * same reason every other draw in the engine is: two machines have to land on
 * the same number.
 */
const MAGNITUDE: readonly [number, number][] = [
  [10, 5],
  [30, 10],
  [50, 20],
  [70, 30],
  [90, 20],
  [110, 10],
  [150, 5],
];

/**
 * Present, minus its fourth branch.
 *
 * In the games the last 20% heals the *target* for a quarter of its health.
 * Nothing in the engine can heal an opponent — `applyHeal` is only ever
 * pointed at the user — and building that path for one move in 791 is not
 * worth the surface it adds, so that branch fails instead. The weights are
 * left at the real ones rather than renormalised, so the three damaging
 * outcomes keep their true relative frequency.
 */
const PRESENT: readonly [number, number][] = [
  [40, 40],
  [80, 30],
  [120, 10],
  [0, 20],
];

/** Whether this move's damage comes from here rather than from `move.power`. */
export function hasVariableDamage(move: MoveEntry): boolean {
  return move.category !== "status" && move.power <= 0;
}

/**
 * Base power or exact damage for one of the 39.
 *
 * The default arm is a safety net, not a design: tests/battle.test.ts B26
 * asserts that every zero-power non-status move in the manifest is named
 * below, so a regenerated manifest that introduces a new one fails a test
 * rather than quietly shipping a 50-power stranger.
 */
export function variableDamage(move: MoveEntry, ctx: DamageContext): Damage {
  const stand = STAND_IN_POWER[move.id];
  if (stand !== undefined) return { t: "power", power: stand };

  switch (move.id) {
    // Level damage, flat.
    case "nightshade":
    case "seismictoss":
      return { t: "exact", amount: Math.max(1, ctx.attacker.level) };

    // Fixed damage, the two moves that simply state a number.
    case "dragonrage":
      return { t: "exact", amount: 40 };
    case "sonicboom":
      return { t: "exact", amount: 20 };

    // Half of what is left.
    case "superfang":
    case "naturesmadness":
    case "ruination":
      return halfRemaining(ctx.defender);

    // Bring the target down to the user's own health, or fail.
    case "endeavor":
      return ctx.defender.hp > ctx.attacker.hp
        ? { t: "exact", amount: ctx.defender.hp - ctx.attacker.hp }
        : { t: "fails" };

    // Trade the user's remaining health for the same damage.
    case "finalgambit":
      return { t: "exact", amount: Math.max(1, ctx.attacker.hp), selfKo: true };

    // One hit, all of it. The manifest's 30% accuracy is the whole balance.
    case "fissure":
    case "guillotine":
    case "horndrill":
    case "sheercold":
      return { t: "exact", amount: ctx.defender.hp };

    // Half to one and a half times the user's level.
    case "psywave":
      return {
        t: "exact",
        amount: Math.max(1, Math.floor((ctx.attacker.level * (50 + intBelow(ctx.rng, 101))) / 100)),
      };

    // The counter family. Priority -5 in the manifest is what puts the first
    // two after the hit they answer.
    case "counter":
      return retaliate(ctx.takenPhysical, 2, 1);
    case "mirrorcoat":
      return retaliate(ctx.takenSpecial, 2, 1);
    case "metalburst":
    case "comeuppance":
      return retaliate(ctx.takenPhysical + ctx.takenSpecial, 3, 2);

    // Cornered.
    case "flail":
    case "reversal":
      return { t: "power", power: pinchPower(ctx.attacker.hp, ctx.attackerMaxHp) };

    // Speed, one way and the other.
    case "electroball":
      return { t: "power", power: speedRatioPower(ctx.attackerSpeed, ctx.defenderSpeed) };
    case "gyroball":
      return {
        t: "power",
        power:
          ctx.attackerSpeed > 0
            ? Math.min(150, Math.max(1, Math.floor((25 * ctx.defenderSpeed) / ctx.attackerSpeed)))
            : 150,
      };

    // Punishes a target that has been setting up.
    case "punishment":
      return { t: "power", power: Math.min(120, 60 + 20 * Math.max(0, ctx.defenderBoosts)) };

    // Harder the healthier the target is.
    case "wringout":
    case "crushgrip":
      return { t: "power", power: squeezePower(ctx.defender, ctx.defenderMaxHp) };

    // The last one in the tank is the hardest. Forty with five or more left,
    // and two hundred when there is nothing behind it.
    case "trumpcard": {
      const byPp = [200, 80, 60, 50];
      return { t: "power", power: byPp[Math.max(0, ctx.ppLeft - 1)] ?? 40 };
    }

    case "magnitude":
      return { t: "power", power: weighted(ctx.rng, MAGNITUDE, ([, w]) => w)[0] };

    case "present": {
      const [power] = weighted(ctx.rng, PRESENT, ([, w]) => w);
      return power > 0 ? { t: "power", power } : { t: "fails" };
    }

    default:
      return { t: "power", power: 50 };
  }
}

/**
 * The power to show the player.
 *
 * BattleView renders `move.power`, which is 0 for all 39 and reads as a bug.
 * A move whose power depends on the battle has no honest single number, so
 * the ones that do get theirs from here and the ones that do not say nothing
 * at all — one place, so the button and the damage cannot disagree.
 */
export function displayPower(move: MoveEntry): number | null {
  if (move.category === "status") return null;
  if (move.power > 0) return move.power;
  return STAND_IN_POWER[move.id] ?? null;
}
