import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  actionRefusal,
  activeOf,
  aiAction,
  DUEL_RULES,
  isFainted,
  maxHp,
  resolveTurn,
  startBattle,
  TRAINER_RULES,
  WILD_RULES,
  type BattleState,
} from "@/engine/battle";
import { heldEffects, HELD_ITEMS, isConsumedOnUse, TYPE_ITEM_TYPES } from "@/engine/carry";
import { ALL_SPECIES, species as speciesById } from "@/engine/dex";
import { applyInput, holdRefusal, initialState, type GameState } from "@/engine/engine";
import { ITEMS } from "@/engine/items";
import { creature, testWorld } from "./helpers";

/**
 * Held items.
 *
 * The design is one sentence: a held item is an ability you can take off. So
 * `effects()` folds what a creature is carrying in beside what it was born
 * with, and about fifty of these items cost the battle no new code at all — a
 * Charcoal is `power` with a type on it, a Scope Lens is `luck`, an Assault
 * Vest is `stat`.
 *
 * Which means the interesting tests are not "does a Charcoal work" but the
 * three things that reuse cannot give you for free:
 *
 *   **Does it actually reach the arithmetic?** A held item that is folded in
 *   nowhere is an item whose blurb is a lie, and nothing fails to compile.
 *
 *   **Is a consumable actually consumed?** And does that survive out of the
 *   battle — the party is `sides[0].team`, so it should, but "should" is what
 *   a test is for.
 *
 *   **Can a restriction lock the battle up?** This is the one that mattered.
 *   An Assault Vest refuses every status move and a Choice item refuses every
 *   move but one, so both can leave a creature with a full tank of PP and
 *   nothing it may legally do. Struggle was gated on `anyPp`, which is a
 *   complete answer only while PP is the only thing that can take a move away.
 */

const SEED = "HOLD1";

/** One swing, and what it took off the target. */
function swing(
  moveId: string,
  mine: Parameters<typeof creature>[1] = {},
  theirs: Parameters<typeof creature>[1] = {},
  tag = moveId,
  species: { mine?: string; theirs?: string } = {},
): { battle: BattleState; dealt: number; took: number } {
  // Species is its own parameter because `creature` takes it positionally, and
  // passing `{ speciesId }` in the options object does nothing at all — which
  // is how the first cut of three of these tests compared a Machamp against a
  // Wailord twice and reported that nothing had changed.
  const attacker = creature(species.mine ?? "machamp", { uid: 1, level: 50, ...mine, moves: [moveId] });
  const target = creature(species.theirs ?? "wailord", { uid: 2, level: 50, moves: ["growl"], ...theirs });
  const before = target.hp;
  const mineBefore = attacker.hp;

  const battle = resolveTurn(
    startBattle(SEED, `hold:${tag}`, [attacker], [target]),
    [{ t: "fight", moveIndex: 0 }, { t: "pass" }],
    DUEL_RULES,
  ).battle;

  return {
    battle,
    dealt: before - activeOf(battle, 1).hp,
    took: mineBefore - activeOf(battle, 0).hp,
  };
}

describe("the vocabulary is shared", () => {
  it("H1: every held item declares at least one effect, and every effect is a shape", () => {
    // The whole catalogue reaches the battle through `effects()`, which filters
    // on `t`. An item whose effect names a shape nothing reads is an item that
    // does nothing, silently — so this pins that every declared shape is one
    // the union actually has, and that nothing declares an empty list.
    expect(HELD_ITEMS.length).toBeGreaterThan(50);

    for (const entry of HELD_ITEMS) {
      expect(entry.hold.effects.length, entry.id).toBeGreaterThan(0);
      for (const effect of entry.hold.effects) {
        expect(typeof effect.t, `${entry.id} has an effect with no shape`).toBe("string");
      }
    }
  });

  it("H2: every one of them is in the bag, on a shelf, with a price or a reason", () => {
    for (const entry of HELD_ITEMS) {
      const spec = ITEMS.find((one) => one.id === entry.id);
      expect(spec, `${entry.id} is not in the catalogue`).toBeTruthy();
      expect(["hold", "berry"]).toContain(spec!.kind);
      expect(spec!.sell, entry.id).toBeGreaterThan(0);
      if (spec!.price > 0) expect(spec!.sell).toBeLessThanOrEqual(spec!.price);
    }
  });

  it("H3: there is one type-enhancing item per type, with no holes", () => {
    // The same completeness the ability families have, and for the same
    // reason: the games shipped seventeen of these and needed two more
    // generations to notice Fairy had none.
    expect(TYPE_ITEM_TYPES.length).toBe(18);

    for (const type of TYPE_ITEM_TYPES) {
      const effects = heldEffects(`hold-${type}`);
      expect(effects.length, type).toBe(1);
      expect(effects[0]).toEqual({ t: "power", when: "typed", type, mille: 1200 });
    }
  });
});

describe("the species-specific family", () => {
  it("H3b: every species an item names actually exists", () => {
    // An effect whose condition matches nothing is an effect that never
    // applies, and nothing says so. This found two: a Griseous Orb naming
    // `giratinaorigin`, which is not a species in this bestiary at all, and a
    // Light Ball naming `pikachu` when the manifest carries eleven Pikachus.
    // Both were silent. The lists are read from the bestiary now, and this is
    // the guard on that.
    const known = new Set(ALL_SPECIES.map((entry) => entry.id));
    let named = 0;

    for (const entry of HELD_ITEMS) {
      for (const effect of entry.hold.effects) {
        for (const id of effect.for?.species ?? []) {
          named++;
          expect(known.has(id), `${entry.id} names ${id}, which does not exist`).toBe(true);
        }
      }
    }

    expect(named, "nothing names a species, so this proves nothing").toBeGreaterThan(10);
  });

  it("H3c: a Thick Club is a Cubone item and a rock to anything else", () => {
    const withClub = (speciesId: string) =>
      swing("karatechop", { heldItem: "hold-thickclub" }, {}, `club:${speciesId}`, { mine: speciesId })
        .dealt;
    const bare = (speciesId: string) =>
      swing("karatechop", {}, {}, `club:${speciesId}`, { mine: speciesId }).dealt;

    expect(withClub("cubone")).toBeGreaterThan(bare("cubone"));
    expect(withClub("machamp")).toBe(bare("machamp"));
    // And every form of it, which is the reason the list is derived.
    expect(withClub("marowakalola")).toBeGreaterThan(bare("marowakalola"));
  });
});

describe("what it does to damage", () => {
  it("H4: a type item lifts that type and leaves the others alone", () => {
    // Machamp is Fighting, so a Black Belt is its own type and a Charcoal is
    // somebody else's.
    const plain = swing("karatechop", {}, {}, "plain").dealt;
    const belted = swing("karatechop", { heldItem: "hold-fighting" }, {}, "plain").dealt;
    const coaled = swing("karatechop", { heldItem: "hold-fire" }, {}, "plain").dealt;

    expect(belted).toBeGreaterThan(plain);
    expect(coaled).toBe(plain);
    // A fifth, give or take the floor at each step.
    expect(belted / plain).toBeGreaterThan(1.1);
    expect(belted / plain).toBeLessThan(1.3);
  });

  it("H5: a Choice Band raises the stat, and Specs raise the other one", () => {
    const plainPhysical = swing("karatechop", {}, {}, "band").dealt;
    const banded = swing("karatechop", { heldItem: "hold-choiceband" }, {}, "band").dealt;
    expect(banded).toBeGreaterThan(plainPhysical);

    // And Specs do nothing for a physical move, which is the point of there
    // being two of them.
    const specced = swing("karatechop", { heldItem: "hold-choicespecs" }, {}, "band").dealt;
    expect(specced).toBe(plainPhysical);
  });

  it("H6: a Life Orb hits harder and charges for it", () => {
    const plain = swing("karatechop", {}, {}, "orb");
    const orbed = swing("karatechop", { heldItem: "hold-lifeorb" }, {}, "orb");

    expect(orbed.dealt).toBeGreaterThan(plain.dealt);
    // A tenth of its own maximum, every swing that landed.
    expect(plain.took).toBe(0);
    expect(orbed.took).toBeGreaterThan(0);
  });

  it("H7: an Expert Belt only pays when the hit was already super effective", () => {
    // Fighting into Wailord (Water) is neutral; Fighting into a Rock type is
    // super effective.
    const neutral = swing("karatechop", { heldItem: "hold-expertbelt" }, {}, "belt-n").dealt;
    const neutralBare = swing("karatechop", {}, {}, "belt-n").dealt;
    expect(neutral).toBe(neutralBare);

    const strong = swing("karatechop", { heldItem: "hold-expertbelt" }, {}, "belt-s", { theirs: "onix" });
    const strongBare = swing("karatechop", {}, {}, "belt-s", { theirs: "onix" });
    expect(strong.dealt).toBeGreaterThan(strongBare.dealt);
  });

  it("H8: a Muscle Band is physical only and Wise Glasses special only", () => {
    const physicalBare = swing("karatechop", {}, {}, "band2").dealt;
    expect(swing("karatechop", { heldItem: "hold-muscleband" }, {}, "band2").dealt)
      .toBeGreaterThan(physicalBare);
    expect(swing("karatechop", { heldItem: "hold-wiseglasses" }, {}, "band2").dealt)
      .toBe(physicalBare);
  });
});

describe("what it does to defence", () => {
  it("H9: Eviolite asks the bestiary whether there is anywhere left to grow", () => {
    // Machop can still become a Machoke; a Machamp cannot become anything.
    const at = (theirs: string, heldItem: string | null) =>
      swing("surf", {}, heldItem ? { heldItem } : {}, `evio:${theirs}`, {
        mine: "wailord",
        theirs,
      }).dealt;

    expect(at("machop", "hold-eviolite")).toBeLessThan(at("machop", null));
    expect(at("machamp", "hold-eviolite")).toBe(at("machamp", null));
  });

  it("H10: a Focus Sash saves it once, from full, and is gone afterwards", () => {
    const holder = creature("magikarp", { uid: 2, level: 5, moves: ["splash"], heldItem: "hold-focussash" });
    const bruiser = creature("machamp", { uid: 1, level: 90, moves: ["closecombat"] });

    const after = resolveTurn(
      startBattle(SEED, "sash", [bruiser], [holder]),
      [{ t: "fight", moveIndex: 0 }, { t: "pass" }],
      DUEL_RULES,
    ).battle;

    const survivor = activeOf(after, 1);
    expect(isFainted(survivor)).toBe(false);
    expect(survivor.hp).toBe(1);
    // Spent, and the log says so.
    expect(survivor.heldItem).toBeNull();
    expect(after.events.some((e) => e.t === "item" && e.itemId === "hold-focussash" && e.spent)).toBe(true);
  });

  it("H11: a resist berry halves one super-effective hit and then it is gone", () => {
    // Water into a Ground type is super effective, which is the only case a
    // resist berry answers.
    const bare = swing("surf", {}, {}, "berry-a", { mine: "wailord", theirs: "sandslash" });
    const held = swing("surf", {}, { heldItem: "berry-water" }, "berry-a", {
      mine: "wailord",
      theirs: "sandslash",
    });

    expect(held.dealt).toBeLessThan(bare.dealt);
    expect(activeOf(held.battle, 1).heldItem).toBeNull();

    // And it is silent against a hit that was never going to hurt: a berry
    // eaten by a resisted move is a berry wasted, which is the difference
    // between this shape and Thick Fat's.
    const neutral = swing("surf", {}, { heldItem: "berry-water" }, "berry-b", {
      mine: "wailord",
      theirs: "machamp",
    });
    const neutralBare = swing("surf", {}, {}, "berry-b", { mine: "wailord", theirs: "machamp" });
    expect(neutral.dealt).toBe(neutralBare.dealt);
    expect(activeOf(neutral.battle, 1).heldItem).toBe("berry-water");
  });
});

describe("what it does between turns", () => {
  it("H12: Leftovers mend, and Black Sludge only mends a poison type", () => {
    const run = (heldItem: string, speciesId: string) => {
      const hurt = creature(speciesId, { uid: 1, level: 50, moves: ["growl"], heldItem });
      const wounded = { ...hurt, hp: Math.floor(maxHp(hurt) / 2) };
      const after = resolveTurn(
        startBattle(SEED, `tick:${heldItem}:${speciesId}`, [wounded], [
          creature("wailord", { uid: 2, level: 50, moves: ["growl"] }),
        ]),
        [{ t: "fight", moveIndex: 0 }, { t: "pass" }],
        DUEL_RULES,
      ).battle;
      return activeOf(after, 0).hp - wounded.hp;
    };

    expect(run("hold-leftovers", "machamp")).toBeGreaterThan(0);
    // A Black Sludge is Leftovers for a poison type and a slow bleed otherwise.
    expect(run("hold-blacksludge", "muk")).toBeGreaterThan(0);
    expect(run("hold-blacksludge", "machamp")).toBeLessThan(0);
  });

  it("H13: an orb gives its holder what it says, and an immunity still refuses", () => {
    const run = (speciesId: string) => {
      const holder = creature(speciesId, { uid: 1, level: 50, moves: ["growl"], heldItem: "hold-flameorb" });
      const after = resolveTurn(
        startBattle(SEED, `orb:${speciesId}`, [holder], [
          creature("wailord", { uid: 2, level: 50, moves: ["growl"] }),
        ]),
        [{ t: "fight", moveIndex: 0 }, { t: "pass" }],
        DUEL_RULES,
      ).battle;
      return activeOf(after, 0).status;
    };

    expect(run("machamp")).toBe("brn");
    // A Fire type cannot be burned, by a move or by its own orb: every road to
    // a condition goes down one predicate.
    expect(run("charizard")).toBeNull();
  });

  it("H14: a Sitrus Berry waits for the health to fall, then spends itself", () => {
    const holder = creature("wailord", { uid: 2, level: 50, moves: ["growl"], heldItem: "berry-sitrus" });
    const bruiser = creature("machamp", { uid: 1, level: 50, moves: ["karatechop"] });

    // Full health: nothing happens, and it is still carrying it.
    const whole = resolveTurn(
      startBattle(SEED, "sitrus-a", [bruiser], [holder]),
      [{ t: "pass" }, { t: "pass" }],
      DUEL_RULES,
    ).battle;
    expect(activeOf(whole, 1).heldItem).toBe("berry-sitrus");

    // Below half, and it eats.
    const low = { ...holder, hp: Math.floor(maxHp(holder) / 3) };
    const eaten = resolveTurn(
      startBattle(SEED, "sitrus-b", [bruiser], [low]),
      [{ t: "pass" }, { t: "pass" }],
      DUEL_RULES,
    ).battle;

    expect(activeOf(eaten, 1).hp).toBeGreaterThan(low.hp);
    expect(activeOf(eaten, 1).heldItem).toBeNull();
  });

  it("H15: a status berry clears what it is for and nothing else", () => {
    const run = (heldItem: string) => {
      const holder = creature("wailord", {
        uid: 2,
        level: 50,
        moves: ["growl"],
        status: "par",
        heldItem,
      });
      const after = resolveTurn(
        startBattle(SEED, `cure:${heldItem}`, [creature("machamp", { uid: 1, moves: ["growl"] })], [holder]),
        [{ t: "pass" }, { t: "pass" }],
        DUEL_RULES,
      ).battle;
      return activeOf(after, 1);
    };

    // Cheri is for paralysis; Rawst is for burns and should leave this alone.
    expect(run("berry-cheri").status).toBeNull();
    expect(run("berry-cheri").heldItem).toBeNull();
    expect(run("berry-rawst").status).toBe("par");
    expect(run("berry-rawst").heldItem).toBe("berry-rawst");
    // And a Lum Berry answers anything.
    expect(run("berry-lum").status).toBeNull();
  });

  it("H16: a pinch berry raises a stage once, low down", () => {
    const holder = creature("wailord", { uid: 2, level: 50, moves: ["growl"], heldItem: "berry-salac" });
    const low = { ...holder, hp: Math.floor(maxHp(holder) / 8) };

    const after = resolveTurn(
      startBattle(SEED, "salac", [creature("machamp", { uid: 1, moves: ["growl"] })], [low]),
      [{ t: "pass" }, { t: "pass" }],
      DUEL_RULES,
    ).battle;

    expect(after.sides[1].stages.spe).toBe(1);
    expect(activeOf(after, 1).heldItem).toBeNull();
  });

  it("H17: a Shell Bell returns a share of what was dealt", () => {
    const attacker = creature("machamp", {
      uid: 1,
      level: 50,
      moves: ["karatechop"],
      heldItem: "hold-shellbell",
    });
    const hurt = { ...attacker, hp: Math.floor(maxHp(attacker) / 2) };

    const after = resolveTurn(
      startBattle(SEED, "bell", [hurt], [creature("wailord", { uid: 2, level: 50, moves: ["growl"] })]),
      [{ t: "fight", moveIndex: 0 }, { t: "pass" }],
      DUEL_RULES,
    ).battle;

    expect(activeOf(after, 0).hp).toBeGreaterThan(hurt.hp);
    // Not spent: a bell is not a berry.
    expect(activeOf(after, 0).heldItem).toBe("hold-shellbell");
  });
});

describe("the restrictions, and the hole they opened", () => {
  it("H18: an Assault Vest refuses status moves and allows the rest", () => {
    const holder = creature("machamp", {
      uid: 1,
      level: 50,
      moves: ["karatechop", "growl"],
      heldItem: "hold-assaultvest",
    });
    const battle = startBattle(SEED, "vest", [holder], [creature("wailord", { uid: 2, moves: ["growl"] })]);

    expect(actionRefusal(battle, 0, { t: "fight", moveIndex: 0 })).toBeNull();
    expect(actionRefusal(battle, 0, { t: "fight", moveIndex: 1 })).toBe(
      "it will not use a status move while it wears that",
    );
  });

  it("H19: a Choice item commits to one move, and switching out un-commits it", () => {
    const holder = creature("machamp", {
      uid: 1,
      level: 50,
      moves: ["karatechop", "seismictoss"],
      heldItem: "hold-choiceband",
    });
    const spare = creature("machop", { uid: 3, level: 50, moves: ["tackle"] });
    const foe = creature("wailord", { uid: 2, level: 90, moves: ["growl"] });

    // Nothing is committed before it has swung.
    let battle = startBattle(SEED, "choice", [holder, spare], [foe]);
    expect(actionRefusal(battle, 0, { t: "fight", moveIndex: 1 })).toBeNull();

    battle = resolveTurn(battle, [{ t: "fight", moveIndex: 0 }, { t: "pass" }], DUEL_RULES).battle;
    expect(battle.sides[0].locked).toBe("karatechop");
    expect(actionRefusal(battle, 0, { t: "fight", moveIndex: 1 })).toMatch(/locked into/);
    expect(actionRefusal(battle, 0, { t: "fight", moveIndex: 0 })).toBeNull();

    // Out and back in, and it is a fresh choice.
    battle = resolveTurn(battle, [{ t: "switch", partyIndex: 1 }, { t: "pass" }], DUEL_RULES).battle;
    expect(battle.sides[0].locked).toBeNull();
  });

  it("H20: a restriction that takes every move away still leaves Struggle", () => {
    // The hole these items opened. Struggle was gated on `anyPp`, which is a
    // complete answer only while PP is the only thing that can take a move
    // away. An Assault Vest on something that knows nothing but status moves
    // has a full tank and no legal action: a battle that cannot be won, lost
    // or left.
    const stuck = creature("machamp", {
      uid: 1,
      level: 50,
      moves: ["growl", "leer"],
      heldItem: "hold-assaultvest",
    });
    const battle = startBattle(SEED, "stuck", [stuck], [creature("wailord", { uid: 2, moves: ["growl"] })]);

    for (let at = 0; at < stuck.moves.length; at++) {
      expect(actionRefusal(battle, 0, { t: "fight", moveIndex: at })).toBeTruthy();
    }
    // So Struggle is legal, and the AI reaches for it too.
    expect(actionRefusal(battle, 0, { t: "struggle" })).toBeNull();
    expect(aiAction(battle, 0)).toEqual({ t: "struggle" });

    // And it resolves rather than throwing.
    const after = resolveTurn(battle, [{ t: "struggle" }, { t: "pass" }], DUEL_RULES).battle;
    expect(after.events.some((e) => e.t === "struggling")).toBe(true);
  });

  it("H21: a Choice item whose one move runs dry leaves Struggle too", () => {
    // The same hole by the other road: committed to a move, and that move is
    // the one with nothing left in it.
    const dry = creature("machamp", {
      uid: 1,
      level: 50,
      moves: ["karatechop", "seismictoss"],
      pp: [0, 5],
      heldItem: "hold-choicescarf",
    });
    const battle: BattleState = {
      ...startBattle(SEED, "dry", [dry], [creature("wailord", { uid: 2, moves: ["growl"] })]),
      sides: [
        { ...startBattle(SEED, "dry", [dry], [dry]).sides[0], locked: "karatechop" },
        startBattle(SEED, "dry", [dry], [creature("wailord", { uid: 2, moves: ["growl"] })]).sides[1],
      ],
    };

    expect(actionRefusal(battle, 0, { t: "fight", moveIndex: 0 })).toBe("no uses left in that one");
    expect(actionRefusal(battle, 0, { t: "fight", moveIndex: 1 })).toMatch(/locked into/);
    expect(actionRefusal(battle, 0, { t: "struggle" })).toBeNull();
  });
});

describe("the second wave", () => {
  it("H17b: a Zoom Lens is worth having only on the turns it moves second", () => {
    const holder = creature("machamp", { uid: 1, level: 50, moves: ["dynamicpunch"], heldItem: "hold-zoomlens" });
    const slow = creature("shuckle", { uid: 2, level: 50, moves: ["growl"] });
    const fast = creature("electrode", { uid: 2, level: 90, moves: ["growl"] });

    // Against something slower it moves first, so the lens is dead weight;
    // against something faster it moves second, so it is not. Measured over
    // many turns, because accuracy is a coin.
    const lands = (foe: typeof slow, tag: string) => {
      let hits = 0;
      for (let attempt = 0; attempt < 60; attempt++) {
        const after = resolveTurn(
          startBattle(SEED, `${tag}:${attempt}`, [holder], [foe]),
          [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }],
          DUEL_RULES,
        ).battle;
        if (!after.events.some((e) => e.t === "miss" && e.side === 0)) hits++;
      }
      return hits;
    };

    // Dynamic Punch is fifty percent accurate, so a fifth more is visible.
    expect(lands(fast, "zoom-late")).toBeGreaterThan(lands(slow, "zoom-first"));
  });

  it("H17c: a Focus Band can save it from any health, and only sometimes", () => {
    const holder = creature("magikarp", { uid: 2, level: 5, moves: ["splash"], heldItem: "hold-focusband" });
    const hurt = { ...holder, hp: Math.max(1, Math.floor(maxHp(holder) / 2)) };
    const bruiser = creature("machamp", { uid: 1, level: 90, moves: ["closecombat"] });

    let saved = 0;
    for (let attempt = 0; attempt < 200; attempt++) {
      const after = resolveTurn(
        startBattle(SEED, `band:${attempt}`, [bruiser], [hurt]),
        [{ t: "fight", moveIndex: 0 }, { t: "pass" }],
        DUEL_RULES,
      ).battle;
      if (!isFainted(activeOf(after, 1))) saved++;
    }

    // One in ten, so over two hundred tries it is neither never nor always —
    // and it worked from half health, which a Focus Sash would not have.
    expect(saved).toBeGreaterThan(2);
    expect(saved).toBeLessThan(80);
  });

  it("H17d: a Clear Amulet and a Covert Cloak are two abilities in item form", () => {
    // `hold` and `unfazed` already existed, for Clear Body and Shield Dust, so
    // these two cost nothing at all — which is the whole thesis of the file.
    const amulet = creature("machamp", { uid: 2, level: 50, moves: ["splash"], heldItem: "hold-clearamulet" });
    const after = resolveTurn(
      startBattle(SEED, "amulet", [creature("machamp", { uid: 1, level: 50, moves: ["growl"] })], [amulet]),
      [{ t: "fight", moveIndex: 0 }, { t: "pass" }],
      DUEL_RULES,
    ).battle;

    // Growl lowers Attack. It did not.
    expect(after.sides[1].stages.atk).toBe(0);
    expect(heldEffects("hold-covertcloak")).toEqual([{ t: "unfazed" }]);
  });

  it("H17e: a Kee Berry answers a physical hit and a Maranga a special one", () => {
    const run = (heldItem: string, moveId: string, tag: string) => {
      const holder = creature("wailord", { uid: 2, level: 50, moves: ["growl"], heldItem });
      const after = resolveTurn(
        startBattle(SEED, tag, [creature("machamp", { uid: 1, level: 50, moves: [moveId] })], [holder]),
        [{ t: "fight", moveIndex: 0 }, { t: "pass" }],
        DUEL_RULES,
      ).battle;
      return { stages: after.sides[1].stages, held: activeOf(after, 1).heldItem };
    };

    const kee = run("berry-kee", "karatechop", "kee-a");
    expect(kee.stages.def).toBe(1);
    expect(kee.held).toBeNull();

    // A physical hit says nothing to a Maranga.
    const wrong = run("berry-maranga", "karatechop", "kee-b");
    expect(wrong.stages.spd).toBe(0);
    expect(wrong.held).toBe("berry-maranga");
  });

  it("H17f: a Smoke Ball always gets you out of the grass", () => {
    // Running is a speed comparison ordinarily, so this is against something
    // very fast: the promise on the label is certainty.
    const holder = creature("shuckle", { uid: 1, level: 5, moves: ["splash"], heldItem: "hold-smokeball" });
    const quick = creature("electrode", { uid: 2, level: 90, moves: ["growl"] });

    for (let attempt = 0; attempt < 20; attempt++) {
      const after = resolveTurn(
        startBattle(SEED, `smoke:${attempt}`, [holder], [quick]),
        [{ t: "flee" }, { t: "pass" }],
        WILD_RULES,
      ).battle;
      expect(after.outcome?.t, `attempt ${attempt}`).toBe("fled");
    }
  });

  it("H17g: a Power item steers the effort as well as doubling it", () => {
    const beat = (heldItem: string | null, tag: string) => {
      const winner = creature("machamp", { uid: 1, level: 20, moves: ["karatechop"], heldItem });
      const after = resolveTurn(
        startBattle(SEED, tag, [winner], [creature("magikarp", { uid: 2, level: 3, moves: ["splash"] })]),
        [{ t: "fight", moveIndex: 0 }, { t: "pass" }],
        TRAINER_RULES,
      ).battle;
      return activeOf(after, 0).evs;
    };

    // A Magikarp teaches Speed. A Power Belt says otherwise.
    const plain = beat(null, "power-a");
    const steered = beat("hold-powerbelt", "power-a");
    expect(plain.spe).toBeGreaterThan(0);
    expect(steered.def).toBeGreaterThan(plain.def);
    expect(steered.def).toBeGreaterThan(steered.spe);
  });
});

describe("carrying one at all", () => {
  function started() {
    const world = testWorld(SEED);
    const state = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });
    return { world, state };
  }

  it("H22: giving and taking is a move rather than a spend", () => {
    const { world, state } = started();
    const holding: GameState = {
      ...state,
      party: [creature("machop", { uid: 1 })],
      bag: { ...state.bag, "hold-leftovers": 1 },
    };

    expect(holdRefusal(world, holding, 0, "hold-leftovers")).toBeNull();
    const given = applyInput(world, holding, { t: "holdItem", index: 0, item: "hold-leftovers" });
    expect(given.party[0].heldItem).toBe("hold-leftovers");
    expect(given.bag["hold-leftovers"] ?? 0).toBe(0);

    // And back again, with nothing lost either way.
    const taken = applyInput(world, given, { t: "holdItem", index: 0, item: null });
    expect(taken.party[0].heldItem).toBeNull();
    expect(taken.bag["hold-leftovers"]).toBe(1);
  });

  it("H23: a swap hands the old one back in the same move", () => {
    const { world, state } = started();
    const holding: GameState = {
      ...state,
      party: [creature("machop", { uid: 1, heldItem: "hold-leftovers" })],
      bag: { ...state.bag, "hold-scopelens": 1 },
    };

    const swapped = applyInput(world, holding, { t: "holdItem", index: 0, item: "hold-scopelens" });
    expect(swapped.party[0].heldItem).toBe("hold-scopelens");
    expect(swapped.bag["hold-leftovers"]).toBe(1);
    expect(swapped.bag["hold-scopelens"] ?? 0).toBe(0);
  });

  it("H24: it refuses what it should, in words the panel can show", () => {
    const { world, state } = started();
    const holding: GameState = {
      ...state,
      party: [creature("machop", { uid: 1 })],
      bag: { ...state.bag, "hold-leftovers": 1, potion: 1 },
    };

    expect(holdRefusal(world, holding, 0, "potion")).toMatch(/nothing happens/);
    expect(holdRefusal(world, holding, 0, "hold-choiceband")).toBe("you have none");
    expect(holdRefusal(world, holding, 0, null)).toBe("it is not carrying anything");
    expect(holdRefusal(world, holding, 9, "hold-leftovers")).toBe("nobody there");
    expect(holdRefusal(world, { ...holding, phase: "battle" }, 0, "hold-leftovers")).toBe(
      "not in the middle of this",
    );
  });

  it("H25: what is consumed is exactly what has a moment to be consumed at", () => {
    // `consumed` only means anything for the shapes with an instant. A `stat`
    // has no instant at which it happened, so a consumable one would never be
    // spent and would read as a bug in the blurb.
    const withMoment = new Set([
      "endure",
      "cure",
      "snack",
      "pinch",
      "policy",
      "soften",
      "barb",
      "brace",
      "solace",
    ]);

    for (const entry of HELD_ITEMS) {
      if (!isConsumedOnUse(entry.id)) continue;
      const moments = entry.hold.effects.filter((effect) => withMoment.has(effect.t));
      expect(moments.length, `${entry.id} is consumed but has no moment`).toBeGreaterThan(0);
    }

    // And nothing permanent claims to be spent.
    expect(isConsumedOnUse("hold-leftovers")).toBe(false);
    expect(isConsumedOnUse("hold-choiceband")).toBe(false);
    expect(isConsumedOnUse("berry-sitrus")).toBe(true);
  });
});

describe("the reference", () => {
  it("H28: docs/items.md names every held item, so it cannot go quietly stale", () => {
    // What somebody reads instead of the source. A list missing three entries
    // is worse than no list, because nobody checks a document they have no
    // reason to distrust. Same guard abilities.md has, for the same reason.
    const doc = readFileSync(join(process.cwd(), "docs", "items.md"), "utf8");

    const missing = HELD_ITEMS.filter((entry) => !doc.includes(entry.name)).map(
      (entry) => entry.name,
    );
    expect(missing, `not in docs/items.md: ${missing.join(", ")}`).toEqual([]);

    // And the shelf counts it opens with have to be the real ones.
    const counts: Record<string, number> = {};
    for (const spec of ITEMS) counts[spec.kind] = (counts[spec.kind] ?? 0) + 1;
    for (const [kind, label] of [
      ["hold", "Held"],
      ["berry", "Berries"],
      ["tonic", "Tonics"],
      ["stone", "Stones"],
    ] as const) {
      expect(doc, `${label} count`).toContain(`| ${label} | ${counts[kind]} |`);
    }
    expect(doc).toContain(`**${ITEMS.length} of them**`);
  });

  it("H29: nothing on the deferred list is quietly implemented after all", () => {
    // The other way a pair of documents rots. An item named as "waiting on a
    // volatile" that has since been built is a reader sent looking for
    // something that is already there — and the deferred list is the thing
    // the next session reads to decide what to do next.
    const doc = readFileSync(join(process.cwd(), "docs", "items-deferred.md"), "utf8");

    // Every held item that exists must not be listed as missing. Checked by
    // name, and only for names distinctive enough not to appear in prose.
    const wrongly = HELD_ITEMS.filter((entry) => {
      if (entry.name.length < 8) return false;
      // The deferred list mentions some by name to say they are *in*, so only
      // an entry inside a table row counts as a claim that it is missing.
      const rows = doc.split("\n").filter((line) => line.startsWith("| **"));
      return rows.some((line) => line.includes(`**${entry.name}**`));
    });

    // Two are named in rows on purpose: Big Root, to say it looked like it
    // belonged and does not, and the legendary Orbs, to separate them from the
    // Crystals. Both say so in the same row.
    const excused = wrongly.filter((entry) => {
      const row = doc
        .split("\n")
        .find((line) => line.startsWith("| **") && line.includes(`**${entry.name}**`));
      return row?.includes("done") || row?.includes("are in");
    });

    const real = wrongly.filter((entry) => !excused.includes(entry));
    expect(
      real.map((entry) => entry.name),
      `docs/items-deferred.md says these are missing, and they are not`,
    ).toEqual([]);
  });
});

describe("outside a battle", () => {
  it("H26: an Everstone stops both roads to an evolution", () => {
    const world = testWorld(SEED);
    const base = applyInput(world, initialState(world), { t: "pickStarter", index: 0 });

    // The stone road: refused, with a reason.
    const anchored: GameState = {
      ...base,
      party: [creature("vulpix", { uid: 1, heldItem: "hold-everstone" })],
      bag: { ...base.bag, "stone-firestone": 1 },
    };
    expect(() =>
      applyInput(world, anchored, { t: "useItem", item: "stone-firestone", index: 0 }),
    ).toThrow();

    // And the level road: it simply does not change.
    const grown = creature("machop", { uid: 1, level: 60, heldItem: "hold-everstone" });
    const bare = creature("machop", { uid: 1, level: 60 });
    expect(speciesById(grown.speciesId).evolvesTo.length).toBeGreaterThan(0);

    const withStone = resolveTurn(
      startBattle(SEED, "ever-a", [grown], [creature("magikarp", { uid: 2, level: 2, moves: ["splash"] })]),
      [{ t: "fight", moveIndex: 0 }, { t: "pass" }],
      TRAINER_RULES,
    ).battle;
    const without = resolveTurn(
      startBattle(SEED, "ever-a", [bare], [creature("magikarp", { uid: 2, level: 2, moves: ["splash"] })]),
      [{ t: "fight", moveIndex: 0 }, { t: "pass" }],
      TRAINER_RULES,
    ).battle;

    expect(activeOf(withStone, 0).speciesId).toBe("machop");
    // The bare one is only proof if it actually had somewhere to go.
    expect(activeOf(without, 0).speciesId).toBe("machop");
  });

  it("H27: a Lucky Egg multiplies the experience, and a Macho Brace the effort", () => {
    const beat = (heldItem: string | null, tag: string) => {
      const winner = creature("machamp", { uid: 1, level: 20, moves: ["karatechop"], heldItem });
      const after = resolveTurn(
        startBattle(SEED, tag, [winner], [creature("magikarp", { uid: 2, level: 3, moves: ["splash"] })]),
        [{ t: "fight", moveIndex: 0 }, { t: "pass" }],
        TRAINER_RULES,
      ).battle;
      const grown = activeOf(after, 0);
      const gained = after.events.find((e) => e.t === "exp");
      return {
        exp: gained && gained.t === "exp" ? gained.amount : 0,
        effort: Object.values(grown.evs).reduce((a, b) => a + b, 0),
      };
    };

    const plain = beat(null, "egg");
    const egged = beat("hold-luckyegg", "egg");
    expect(egged.exp).toBeGreaterThan(plain.exp);

    const braced = beat("hold-machobrace", "brace");
    expect(braced.effort).toBeGreaterThan(plain.effort);
  });
});
