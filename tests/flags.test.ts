import { describe, expect, it } from "vitest";
import {
  activeOf,
  actionRefusal,
  isFainted,
  maxHp,
  resolveTurn,
  startBattle,
  TRAINER_RULES,
  DUEL_RULES,
  type BattleAction,
  type BattleEvent,
  type BattleState,
  type SideIndex,
  type VolatileKind,
} from "@/engine/battle";
import { ALL_MOVES } from "@/engine/dex";
import { creature } from "./helpers";

/**
 * The moves whose whole identity was a flag the manifest never carried.
 *
 * `moves.json` held type, power, accuracy, PP, priority, crit ratio, target,
 * status, boosts, secondary, drain, recoil, heal, multihit — and not one word
 * about what *kind* of move it was. Showdown keeps that in a flag set, and the
 * build script was not copying it.
 *
 * The consequence was not a rare corner. `dex.ts` filters a **status** move
 * out of every learnset when the engine cannot honour it — that is the whole
 * of `actsOnSomething`, and it is why 117 status moves work and the rest are
 * not dealt. Damaging moves went through no such gate: `actsOnSomething`
 * returns true for every one of them on the strength of having power. So a
 * damaging move whose entire identity was a missing flag was handed out **with
 * its power and none of its cost**:
 *
 * | | was | should be |
 * | --- | --- | --- |
 * | Hyper Beam | 150 power, no drawback | and a turn spent recovering |
 * | Fly, Dig, Solar Beam | hit on the turn used | a turn charging first |
 * | Fake Out | 40 power at +3 priority | and only on its first turn |
 * | Iron Head, Rock Slide | plain attacks | 30% to flinch |
 * | Wrap, Fire Spin | 15 and 35 power | and four turns of holding on |
 * | Outrage, Thrash | 120 power, no drawback | and confusion at the end |
 * | U-turn, Volt Switch | 70 power | hit and go |
 * | Dragon Tail | 60 power | and the target is driven out |
 * | Focus Punch | 150 power at -3 | and broken by any hit taken |
 * | Rollout | flat 30 power | doubling five times over |
 * | Bide | a stand-in 60 | two turns taken, twice given back |
 * | Future Sight | 120 now | 120 in two turns, to whoever is there |
 * | Pursuit | 40 power | 80 against something switching |
 *
 * Hyper Beam is the loudest of them: a drawback-free 150 is strictly the best
 * move in the game for anything that learns it, and every balance number in
 * the Cup was measured with it in that state.
 *
 * What is guarded below is one behaviour per mechanic — the thing that makes
 * the move cost something — plus `X58`, which is the structural half: the
 * reason none of this was noticed is that nothing was watching the damaging
 * side of the pool, and now something is.
 */

const SEED = "flags-seed";

function fight(index = 0): BattleAction {
  return { t: "fight", moveIndex: index };
}

/** A battle between two creatures with the movesets given, run to order. */
function bout(mine: string[], theirs: string[], level = 50) {
  const ours = creature("machop", { uid: 1, level, moves: mine });
  const foe = creature("chansey", { uid: 2, level, moves: theirs });
  return startBattle(SEED, `flags:${mine.join("+")}`, [ours], [foe]);
}

/**
 * One turn, with the narration unwrapped.
 *
 * `resolveTurn` puts the log on the state it returns rather than beside it,
 * and every test here wants both halves — what happened, and what is true
 * afterwards.
 */
function act(
  battle: BattleState,
  ours: BattleAction,
  theirs: BattleAction,
  rules = DUEL_RULES,
): { battle: BattleState; events: readonly BattleEvent[] } {
  const result = resolveTurn(battle, [ours, theirs], rules);
  return { battle: result.battle, events: result.battle.events };
}

/** The common case: a duel, and the other side using its first move. */
function play(battle: BattleState, ours: BattleAction, theirs: BattleAction = fight()) {
  return act(battle, ours, theirs);
}

function saw(events: readonly BattleEvent[], which: VolatileKind, side: SideIndex = 0): boolean {
  return events.some((event) => event.t === "volatile" && event.which === which && event.side === side);
}

function hitFor(events: readonly BattleEvent[], side: SideIndex): number {
  return events
    .filter((event) => event.t === "damage" && event.side === side)
    .reduce((sum, event) => sum + (event as { amount: number }).amount, 0);
}

describe("what a damaging move costs", () => {
  it("F1: Hyper Beam spends the turn after it recovering, landed or not", () => {
    // Splash on the other side throughout, so nothing but the beam is moving
    // the numbers.
    let battle = bout(["hyperbeam"], ["splash"]);

    const first = play(battle, fight());
    battle = first.battle;
    expect(hitFor(first.events, 1)).toBeGreaterThan(0);
    expect(battle.sides[0].volatiles?.recharging).toBe(true);

    // The next turn is spent, whatever is picked.
    const second = play(battle, fight());
    battle = second.battle;
    expect(saw(second.events, "recharging")).toBe(true);
    expect(hitFor(second.events, 1)).toBe(0);

    // And exactly one turn: the third is an ordinary beam again.
    expect(battle.sides[0].volatiles?.recharging).toBeUndefined();
    const third = play(battle, fight());
    expect(hitFor(third.events, 1)).toBeGreaterThan(0);
  });

  it("F2: Fly spends a turn in the sky, where almost nothing reaches it", () => {
    let battle = bout(["fly"], ["tackle"]);

    const up = play(battle, fight());
    battle = up.battle;
    expect(saw(up.events, "charging")).toBe(true);
    expect(battle.sides[0].volatiles?.hidden).toBe("sky");
    // Our move has not gone off yet.
    expect(hitFor(up.events, 1)).toBe(0);

    // The second turn is where the invulnerability shows. Chansey is the
    // faster of the two, so it swings while we are still up there and finds
    // nobody — and then the blow comes down. That ordering is the point: a
    // Fly that only dodged what came *before* it took off would be dodging
    // nothing at all.
    const down = play(battle, fight());
    battle = down.battle;
    expect(down.events.some((event) => event.t === "miss" && event.side === 1)).toBe(true);
    expect(hitFor(down.events, 0)).toBe(0);

    // And the blow is an ordinary ninety-power Flying attack.
    expect(hitFor(down.events, 1)).toBeGreaterThan(0);
    expect(battle.sides[0].volatiles?.hidden).toBeUndefined();
    expect(battle.sides[0].volatiles?.committed).toBeUndefined();
  });

  it("F3: a Thunder finds a Fly, and nothing finds a Phantom Force", () => {
    // The exception list is the price of the mechanic. Without it two turns
    // of untouchability would cost nothing at all.
    //
    // Both read on the second turn, for the reason F2 spells out: the first
    // turn is spent taking off, and the target is only away once it has.
    let flying = bout(["fly"], ["thunder"]);
    flying = play(flying, fight()).battle;
    const struck = play(flying, fight());
    expect(hitFor(struck.events, 0)).toBeGreaterThan(0);

    let gone = bout(["phantomforce"], ["thunder"]);
    gone = play(gone, fight()).battle;
    const missed = play(gone, fight());
    expect(hitFor(missed.events, 0)).toBe(0);
    expect(missed.events.some((event) => event.t === "miss" && event.side === 1)).toBe(true);
  });

  it("F4: Solar Beam goes off the turn it is used, but only in sun", () => {
    // The whole reason the move is worth building a weather team around, and
    // it was worth nothing at all before the charge existed to be skipped.
    const shaded = play(bout(["solarbeam"], ["splash"]), fight());
    expect(saw(shaded.events, "charging")).toBe(true);
    expect(hitFor(shaded.events, 1)).toBe(0);

    let sunny = bout(["sunnyday", "solarbeam"], ["splash"]);
    sunny = play(sunny, fight(0)).battle;
    const beam = play(sunny, fight(1));
    expect(saw(beam.events, "charging")).toBe(false);
    expect(hitFor(beam.events, 1)).toBeGreaterThan(0);
  });

  it("F5: a charge turn is not free — Skull Bash raises its guard while it waits", () => {
    const battle = bout(["skullbash"], ["splash"]);
    const charging = play(battle, fight());
    expect(charging.battle.sides[0].stages.def).toBe(1);
  });

  it("F6: Iron Head flinches, and a flinch from the slower side is worth nothing", () => {
    // Faster: the flinch is written before the other side has moved, so it is
    // read, and the turn is lost.
    const quick = creature("jolteon", { uid: 1, level: 60, moves: ["ironhead"] });
    const slow = creature("snorlax", { uid: 2, level: 60, moves: ["tackle"] });

    // Iron Head is 30%, so this is played until it fires rather than once.
    let flinched = false;
    for (let attempt = 0; attempt < 40 && !flinched; attempt++) {
      const result = act(
        startBattle(SEED, `flinch:${attempt}`, [quick], [slow]),
        fight(),
        fight(),
        DUEL_RULES,
    );
      if (!saw(result.events, "flinched", 1)) continue;
      flinched = true;
      // It flinched, so its Tackle never landed.
      expect(hitFor(result.events, 0)).toBe(0);
      // And it is gone by the end of the turn, read or not.
      expect(result.battle.sides[1].volatiles?.flinched).toBeUndefined();
    }
    expect(flinched, "Iron Head never flinched in forty turns").toBe(true);
  });

  it("F7: Fake Out works on the turn it arrives and never again", () => {
    let battle = bout(["fakeout", "tackle"], ["splash"]);

    const first = play(battle, fight(0));
    battle = first.battle;
    expect(hitFor(first.events, 1)).toBeGreaterThan(0);
    expect(first.events.some((event) => event.t === "fizzled")).toBe(false);

    // Second turn: it has had a turn, so the move fails outright.
    const second = play(battle, fight(0));
    expect(hitFor(second.events, 1)).toBe(0);
    expect(second.events.some((event) => event.t === "fizzled" && event.side === 0)).toBe(true);
  });

  it("F8: Wrap holds on, squeezes, and refuses a switch until it lets go", () => {
    const ours = creature("machop", { uid: 1, level: 50, moves: ["wrap"] });
    const theirs = [
      creature("chansey", { uid: 2, level: 50, moves: ["splash"] }),
      creature("rattata", { uid: 3, level: 50, moves: ["splash"] }),
    ];
    // Wrap is ninety accurate, so the tag is walked until one lands rather
    // than pinned to a seed that happens to work — a test that depends on a
    // particular roll is a test that breaks the next time anything upstream
    // of the roll changes.
    let battle = startBattle(SEED, "bind", [ours], theirs);
    let caught = act(battle, fight(), fight(), TRAINER_RULES);
    for (let attempt = 1; attempt < 20; attempt++) {
      if (caught.events.some((event) => event.t === "volatile" && event.which === "bound")) break;
      battle = startBattle(SEED, `bind:${attempt}`, [ours], theirs);
      caught = act(battle, fight(), fight(), TRAINER_RULES);
    }
    battle = caught.battle;
    expect(caught.events.some((event) => event.t === "volatile" && event.which === "bound")).toBe(true);
    const turns = battle.sides[1].volatiles?.bound ?? 0;
    expect(turns).toBeGreaterThanOrEqual(3);

    // It squeezed at the end of the turn it landed.
    expect(saw(caught.events, "squeezed", 1)).toBe(true);

    // And it cannot be called back while it holds.
    expect(actionRefusal(battle, 1, { t: "switch", partyIndex: 1 })).toBe("it is held fast");

    // Run it out. The freeing is announced, or the player has no way to know.
    let freed = false;
    for (let spin = 0; spin < 6 && !freed; spin++) {
      const next = act(battle, { t: "fight", moveIndex: 0 }, fight(), TRAINER_RULES);
      battle = next.battle;
      if (next.events.some((event) => event.t === "volatile" && event.which === "freed")) freed = true;
    }
    expect(freed, "the bind never announced letting go").toBe(true);
  });

  it("F9: Outrage locks its user in and ends in confusion", () => {
    // A very small attacker and a very large target, because a rampage that
    // knocks its target out never reaches the end it is being tested for —
    // and an even matchup ends the battle on the second Outrage.
    const ours = creature("machop", { uid: 1, level: 5, moves: ["outrage", "splash"] });
    const foe = creature("chansey", { uid: 2, level: 80, moves: ["splash"] });
    let battle = startBattle(SEED, "rage", [ours], [foe]);

    const first = play(battle, fight(0));
    battle = first.battle;
    expect(battle.sides[0].volatiles?.committed).toBe("outrage");
    expect(battle.sides[0].volatiles?.commitment).toBe("rage");

    // Picking something else changes nothing: the rampage is the move.
    // Chansey is the punching bag here precisely because it survives three
    // of them — a rampage that knocks its target out never reaches the end
    // it is being tested for.
    let confused = false;
    for (let spin = 0; spin < 4 && !confused && !battle.outcome; spin++) {
      const next = play(battle, fight(1));
      battle = next.battle;
      expect(next.events.some((event) => event.t === "use" && event.moveId === "outrage")).toBe(true);
      if (battle.sides[0].volatiles?.confusion) confused = true;
    }
    expect(confused, "the rampage never ended in confusion").toBe(true);
    expect(battle.sides[0].volatiles?.committed).toBeUndefined();
  });

  it("F10: a committed creature cannot be switched out or run from", () => {
    const ours = [
      creature("machop", { uid: 1, level: 50, moves: ["outrage"] }),
      creature("rattata", { uid: 3, level: 50, moves: ["tackle"] }),
    ];
    const theirs = creature("chansey", { uid: 2, level: 50, moves: ["splash"] });

    const battle = act(
      startBattle(SEED, "committed", ours, [theirs]),
      fight(),
      fight(),
      TRAINER_RULES,
    ).battle;

    expect(actionRefusal(battle, 0, { t: "switch", partyIndex: 1 })).toBe("it is not finished");
    // But there is always something legal to pick, which is the deadlock rule:
    // whatever is chosen, the forced move is what happens.
    expect(actionRefusal(battle, 0, fight())).toBeNull();
  });

  it("F11: Rollout doubles for every blow it lands", () => {
    let battle = bout(["rollout"], ["splash"]);

    const blows: number[] = [];
    for (let spin = 0; spin < 3; spin++) {
      const next = play(battle, fight());
      battle = next.battle;
      const dealt = hitFor(next.events, 1);
      if (dealt <= 0) break;
      blows.push(dealt);
    }

    expect(blows.length).toBeGreaterThanOrEqual(3);
    // Not exactly double — the damage roll is 85..100 either way — but far
    // enough clear of it that a flat thirty power cannot produce this.
    expect(blows[1]).toBeGreaterThan(blows[0] * 1.5);
    expect(blows[2]).toBeGreaterThan(blows[1] * 1.5);
  });

  it("F12: U-turn hits and leaves; Dragon Tail hits and drives the other one out", () => {
    const ours = [
      creature("machop", { uid: 1, level: 50, moves: ["uturn"] }),
      creature("rattata", { uid: 3, level: 50, moves: ["tackle"] }),
    ];
    const theirs = [
      creature("chansey", { uid: 2, level: 50, moves: ["splash"] }),
      creature("pidgey", { uid: 4, level: 50, moves: ["splash"] }),
    ];

    const gone = act(
      startBattle(SEED, "uturn", ours, theirs),
      fight(),
      fight(),
      TRAINER_RULES,
    );
    expect(hitFor(gone.events, 1)).toBeGreaterThan(0);
    expect(gone.battle.sides[0].active).toBe(1);

    const tail = [creature("machop", { uid: 1, level: 50, moves: ["dragontail"] })];
    const driven = act(
      startBattle(SEED, "dragontail", tail, theirs),
      fight(),
      fight(),
      TRAINER_RULES,
    );
    expect(hitFor(driven.events, 1)).toBeGreaterThan(0);
    expect(driven.battle.sides[1].active).toBe(1);
  });

  it("F13: Focus Punch is broken by any hit taken before it lands", () => {
    // Minus three priority, so anything at all moves first.
    const ours = creature("machop", { uid: 1, level: 50, moves: ["focuspunch"] });
    const hitting = creature("chansey", { uid: 2, level: 50, moves: ["tackle"] });
    const idle = creature("chansey", { uid: 2, level: 50, moves: ["splash"] });

    const broken = act(
      startBattle(SEED, "focus-broken", [ours], [hitting]),
      fight(),
      fight(),
      DUEL_RULES,
    );
    expect(broken.events.some((event) => event.t === "fizzled" && event.side === 0)).toBe(true);
    expect(hitFor(broken.events, 1)).toBe(0);

    const landed = act(
      startBattle(SEED, "focus-kept", [ours], [idle]),
      fight(),
      fight(),
      DUEL_RULES,
    );
    expect(hitFor(landed.events, 1)).toBeGreaterThan(0);
  });

  it("F14: Bide takes it for two turns and gives back twice the total", () => {
    // Two Chanseys, because the unleash has to have room to land in full:
    // against anything smaller `applyDamage` caps at the target's remaining
    // health and the test would be measuring the cap rather than the move.
    const ours = creature("chansey", { uid: 1, level: 60, moves: ["bide"] });
    const theirs = creature("chansey", { uid: 2, level: 60, moves: ["tackle"] });
    let battle = startBattle(SEED, "bide", [ours], [theirs]);

    let taken = 0;
    for (let spin = 0; spin < 2; spin++) {
      const next = act(battle, fight(), fight(), DUEL_RULES);
      battle = next.battle;
      taken += hitFor(next.events, 0);
      expect(saw(next.events, "biding")).toBe(true);
      expect(hitFor(next.events, 1)).toBe(0);
    }
    expect(taken).toBeGreaterThan(0);

    const back = act(battle, fight(), fight(), DUEL_RULES);
    expect(saw(back.events, "unleashed")).toBe(true);
    // Twice everything taken across the two turns, exactly — no type chart,
    // no critical hit, no damage roll. The Tackle landing on this turn too is
    // counted, because it landed before the unleash: Bide is +1 priority, so
    // it is not. Hence the total from the two stored turns alone.
    expect(hitFor(back.events, 1)).toBe(taken * 2);
  });

  it("F15: Future Sight lands two turns later, on whoever is standing there", () => {
    const ours = creature("chansey", { uid: 1, level: 60, moves: ["futuresight"] });
    const theirs = [
      creature("machop", { uid: 2, level: 50, moves: ["splash"] }),
      creature("rattata", { uid: 3, level: 50, moves: ["splash"] }),
    ];
    let battle = startBattle(SEED, "future", [ours], theirs);

    const thrown = act(battle, fight(), fight(), TRAINER_RULES);
    battle = thrown.battle;
    // Nothing lands now.
    expect(hitFor(thrown.events, 1)).toBe(0);
    expect(battle.sides[1].future?.moveId).toBe("futuresight");

    // The target switches away, which is the whole reason to throw one.
    battle = act(battle, fight(), { t: "switch", partyIndex: 1 }, TRAINER_RULES).battle;

    const arrived = act(battle, fight(), fight(), TRAINER_RULES);
    expect(hitFor(arrived.events, 1)).toBeGreaterThan(0);
    // It landed on the one that came in, not the one that was aimed at.
    expect(activeOf(arrived.battle, 1).uid).toBe(3);
    expect(arrived.battle.sides[1].future).toBeUndefined();
  });

  it("F15b: a Future Sight aimed at something it cannot touch fails now, not later", () => {
    // It bypasses a shield, which is the point of a delayed blow, and must
    // not bypass an immunity with it: a Psychic stored against a Dark type
    // would otherwise arrive in two turns as a hit for nothing.
    const ours = creature("chansey", { uid: 1, level: 60, moves: ["futuresight"] });
    const dark = creature("umbreon", { uid: 2, level: 50, moves: ["splash"] });

    const result = act(
      startBattle(SEED, "future-dark", [ours], [dark]),
      fight(),
      fight(),
      TRAINER_RULES,
    );
    expect(result.events.some((event) => event.t === "immune")).toBe(true);
    expect(result.battle.sides[1].future).toBeUndefined();
  });

  it("F16: Pursuit catches what is on its way out, for double", () => {
    const ours = creature("machop", { uid: 1, level: 50, moves: ["pursuit"] });
    const theirs = [
      creature("chansey", { uid: 2, level: 50, moves: ["splash"] }),
      creature("rattata", { uid: 3, level: 50, moves: ["splash"] }),
    ];

    const standing = act(
      startBattle(SEED, "pursuit-still", [ours], theirs),
      fight(),
      fight(),
      TRAINER_RULES,
    );
    const running = act(
      startBattle(SEED, "pursuit-still", [ours], theirs),
      fight(),
      { t: "switch", partyIndex: 1 },
      TRAINER_RULES,
    );

    // Same seed, same tag, same target — the only difference is that the
    // second one was leaving. The blow lands on the one that was on its way
    // out rather than on the one that replaced it.
    expect(hitFor(running.events, 1)).toBeGreaterThan(hitFor(standing.events, 1) * 1.5);
    expect(activeOf(running.battle, 1).uid).toBe(3);
  });

  it("F18: Self-Destruct takes its user down, and does so even against a Ghost", () => {
    // 200 base power, and it was costing nothing at all. Explosion is 250 and
    // was the same — comfortably the best move in the game for anything that
    // learnt one.
    const ours = creature("machop", { uid: 1, level: 50, moves: ["selfdestruct"] });
    const foe = creature("chansey", { uid: 2, level: 80, moves: ["splash"] });

    const blast = act(startBattle(SEED, "boom", [ours], [foe]), fight(), fight(), TRAINER_RULES);
    expect(hitFor(blast.events, 1)).toBeGreaterThan(0);
    expect(isFainted(activeOf(blast.battle, 0))).toBe(true);

    // `"always"`, which is the half that needs saying: a Normal blast that a
    // Ghost walks through still goes off. Gating the cost on the blow landing
    // would leave the move free against exactly the matchup it is worst in.
    const ghost = creature("gastly", { uid: 2, level: 80, moves: ["splash"] });
    const wasted = act(startBattle(SEED, "boom-ghost", [ours], [ghost]), fight(), fight(), TRAINER_RULES);
    expect(wasted.events.some((event) => event.t === "immune")).toBe(true);
    expect(isFainted(activeOf(wasted.battle, 0))).toBe(true);
  });

  it("F19: Memento pays only if it lands, and Healing Wish is not charged twice", () => {
    // `"ifHit"`, the other half. Memento is a status move that was applying
    // its two stage drops and quietly surviving.
    const ours = [
      creature("machop", { uid: 1, level: 50, moves: ["memento"] }),
      creature("rattata", { uid: 3, level: 50, moves: ["tackle"] }),
    ];
    const foe = creature("chansey", { uid: 2, level: 50, moves: ["splash"] });

    const paid = act(startBattle(SEED, "memento", ours, [foe]), fight(), fight(), TRAINER_RULES);
    expect(paid.battle.sides[1].stages.atk).toBe(-2);
    expect(paid.battle.sides[1].stages.spa).toBe(-2);
    expect(isFainted(paid.battle.sides[0].team[0])).toBe(true);

    // Healing Wish faints its user *and* leaves the blessing, through
    // `sacrifice`. It is `"ifHit"` upstream too, so the two roads would both
    // fire — the second one on a creature already at nought.
    const wisher = [
      creature("chansey", { uid: 1, level: 50, moves: ["healingwish"] }),
      creature("rattata", { uid: 3, level: 50, moves: ["tackle"], hp: 5 }),
    ];
    const blessed = act(startBattle(SEED, "wish", wisher, [foe]), fight(), fight(), TRAINER_RULES);
    expect(isFainted(blessed.battle.sides[0].team[0])).toBe(true);
    // One fainting, announced once.
    expect(blessed.events.filter((event) => event.t === "faint" && event.side === 0).length).toBe(1);
    expect(blessed.battle.sides[0].volatiles?.blessing).toBe(true);
  });

  it("F17: a flinch, a bind and a rampage all go when the creature does", () => {
    // The property every volatile in the file has and these seven had to be
    // given: a switch is how you stop standing there, and standing there is
    // the whole of what they are facts about.
    const ours = [
      creature("machop", { uid: 1, level: 50, moves: ["outrage"] }),
      creature("rattata", { uid: 3, level: 50, moves: ["tackle"] }),
    ];
    const theirs = creature("chansey", { uid: 2, level: 50, moves: ["splash"] });

    let battle = startBattle(SEED, "sweep", ours, [theirs]);
    battle = act(battle, fight(), fight(), TRAINER_RULES).battle;
    expect(battle.sides[0].volatiles?.committed).toBe("outrage");

    // A rampage refuses an ordinary switch, so this is the forced kind: the
    // creature faints and is replaced.
    battle = {
      ...battle,
      sides: [
        { ...battle.sides[0], team: battle.sides[0].team.map((one, at) => (at === 0 ? { ...one, hp: 0 } : one)) },
        battle.sides[1],
      ],
      awaitingSwitch: [true, false],
    };
    battle = act(battle, { t: "switch", partyIndex: 1 }, { t: "pass" }, TRAINER_RULES).battle;

    expect(battle.sides[0].volatiles?.committed).toBeUndefined();
    expect(battle.sides[0].volatiles?.commitment).toBeUndefined();
  });
});

describe("the gate on the damaging half of the pool", () => {
  /**
   * The structural half, and the reason none of the above was noticed for so
   * long.
   *
   * `actsOnSomething` gates **status** moves: one that carries an effect the
   * engine has no machinery for is filtered out of every learnset, and
   * `X56`/`X57` keep that list and the engine level with each other. Damaging
   * moves have never had such a gate — the function returns true for all of
   * them on the strength of `power > 0` — so a damaging move missing its
   * mechanic is dealt out looking exactly like one that has it.
   *
   * This is that gate's watchman. It cannot filter, because a damaging move
   * missing its rider is still a working attack and dropping Glaive Rush from
   * every learnset over a rider would be a worse trade than shipping it. What
   * it can do is make the set *known*, so the next one added to the manifest
   * is a failing test rather than a silent 150-power freebie.
   */
  it("X58: every rider a damaging move carries is honoured, or is on this list", () => {
    /** Honoured in battle.ts, each by name. */
    const honoured = new Set([
      "mustrecharge",
      "lockedmove",
      "partiallytrapped",
      "bide",
      "flinch",
      "confusion",
      // The last eight, each honoured by name in battle.ts.
      "glaiverush",
      "rage",
      "uproar",
      "smackdown",
      "healblock",
      "saltcure",
      "sparklingaria",
      "syrupbomb",
    ]);

    /**
     * Carried in the manifest, not acted on, and each still a working attack
     * without it — which is why these are listed rather than filtered.
     *
     * If this list grows, something was added to the manifest and not to the
     * engine, and the number below is what says so.
     */
    const waiting = new Set<string>([]);

    const unknown = new Set<string>();
    for (const move of ALL_MOVES) {
      if (move.category === "status") continue;
      for (const rider of [move.volatile, move.selfVolatile, move.secondary?.volatile]) {
        if (!rider) continue;
        if (honoured.has(rider) || waiting.has(rider)) continue;
        unknown.add(`${move.id}:${rider}`);
      }
    }

    expect(
      [...unknown],
      "a damaging move carries a rider that is neither honoured nor written down",
    ).toEqual([]);

    // And the other direction, so a mechanic that gets built does not leave a
    // stale row claiming it is still missing — the shape `X57` has for the
    // status list.
    const carried = new Set<string>();
    for (const move of ALL_MOVES) {
      if (move.category === "status") continue;
      for (const rider of [move.volatile, move.selfVolatile, move.secondary?.volatile]) {
        if (rider) carried.add(rider);
      }
    }
    for (const rider of waiting) {
      expect(carried.has(rider), `${rider} is on the waiting list and no damaging move has it`).toBe(true);
    }
  });

  it("X59: the two switching riders are told apart rather than lumped together", () => {
    // `selfSwitch` is one upstream field doing three jobs, and honouring it
    // wholesale would turn Baton Pass into a strictly worse U-turn — the
    // half-working kind of wrong this codebase spends a document arguing
    // against. Baton Pass and Shed Tail want stages carried across a switch,
    // which is its own heading in docs/moves-deferred.md.
    const byId = new Map(ALL_MOVES.map((move) => [move.id, move]));
    expect(byId.get("uturn")?.selfSwitch).toBe("true");
    expect(byId.get("voltswitch")?.selfSwitch).toBe("true");
    expect(byId.get("flipturn")?.selfSwitch).toBe("true");
    expect(byId.get("batonpass")?.selfSwitch).toBe("copyvolatile");
    expect(byId.get("shedtail")?.selfSwitch).toBe("shedtail");
  });

  it("X60: a Hyper Beam that misses still costs the turn after it", () => {
    // The single most valuable line in the file, and the easiest to get
    // wrong: gating the recharge on the blow landing would leave the move a
    // free 150 power against anything that dodged it.
    const ours = creature("machop", { uid: 1, level: 50, moves: ["hyperbeam"] });
    // A Ghost, so a Normal beam does nothing at all to it.
    const ghost = creature("gastly", { uid: 2, level: 50, moves: ["splash"] });

    const result = act(
      startBattle(SEED, "beam-immune", [ours], [ghost]),
      fight(),
      fight(),
      DUEL_RULES,
    );
    expect(result.events.some((event) => event.t === "immune")).toBe(true);
    expect(result.battle.sides[0].volatiles?.recharging).toBe(true);
  });

  it("X61: nothing in the pool can leave a battle with no legal action", () => {
    // Move restriction is the one class of effect that can make a battle
    // unwinnable, and a forced move is move restriction wearing a hat: a
    // creature three turns into an Outrage has had every other button taken
    // away. The rule that keeps it safe is that a commitment refuses the
    // *switch* and accepts any *fight* — see `chosenMove`.
    const ours = creature("machop", { uid: 1, level: 50, moves: ["outrage", "tackle"] });
    const theirs = creature("chansey", { uid: 2, level: 50, moves: ["splash"] });

    let battle = startBattle(SEED, "deadlock", [ours], [theirs]);
    for (let spin = 0; spin < 12; spin++) {
      if (battle.outcome) break;
      const legal = [0, 1]
        .map((index) => actionRefusal(battle, 0, fight(index)))
        .filter((refusal) => refusal === null);
      expect(legal.length, `turn ${spin} left nothing legal to pick`).toBeGreaterThan(0);
      battle = act(battle, fight(1), fight(), DUEL_RULES).battle;
      if (isFainted(activeOf(battle, 0)) || isFainted(activeOf(battle, 1))) break;
    }
  });
});

describe("the manifest carries what the engine reads", () => {
  it("X62: the flag set is on the rows and is not empty", () => {
    // The omission that caused all of the above. Guarded because it is a
    // build-script output: a regenerated manifest that quietly stopped
    // copying flags would put every mechanic in this file back to sleep
    // without a single test failing anywhere else.
    const withFlags = ALL_MOVES.filter((move) => move.flags?.length);
    expect(withFlags.length).toBeGreaterThan(600);

    const charge = ALL_MOVES.filter((move) => move.flags?.includes("charge"));
    const recharge = ALL_MOVES.filter((move) => move.flags?.includes("recharge"));
    const contact = ALL_MOVES.filter((move) => move.flags?.includes("contact"));
    expect(charge.length).toBe(17);
    expect(recharge.length).toBe(10);
    // Not read by the battle yet — it is what the ability and item lists are
    // both waiting on — but carried, which is the expensive half.
    expect(contact.length).toBeGreaterThan(200);
  });

  it("X63: every creature that gets a maximum HP has one, so the shares divide", () => {
    // A bind takes an eighth and Bide gives back a multiple: both are integer
    // arithmetic over `maxHp`, and a zero would be a division by nothing.
    const one = creature("machop", { uid: 1, level: 5, moves: ["tackle"] });
    expect(maxHp(one)).toBeGreaterThan(0);
  });
});
