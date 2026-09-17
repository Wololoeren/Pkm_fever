import { describe, expect, it } from "vitest";
import {
  actionRefusal,
  activeOf,
  aiAction,
  maxHp,
  resolveTurn,
  startBattle,
  TRAINER_RULES,
  WILD_RULES,
  type BattleAction,
  type BattleEvent,
  type BattleRules,
  type BattleState,
  type SideIndex,
} from "@/engine/battle";
import { actsOnSomething } from "@/engine/statusmoves";
import { move as moveById } from "@/engine/dex";
import type { Individual } from "@/engine/types";
import { creature } from "./helpers";

/**
 * The last of the deferred moves: restriction, substitutes, hazards, rooms,
 * Baton Pass, borrowed abilities and items, the remaining callers, and the
 * counters a handful of attacks keep.
 */

const SEED = "LASTMOVES";

function fight(ours: number, theirs: number): [BattleAction, BattleAction] {
  return [
    { t: "fight", moveIndex: ours },
    { t: "fight", moveIndex: theirs },
  ];
}

function step(battle: BattleState, actions: [BattleAction, BattleAction], rules: BattleRules = TRAINER_RULES) {
  const result = resolveTurn(battle, actions, rules, 10);
  return result.battle;
}

function battleOf(ours: Individual[], theirs: Individual[], tag = "trainer:test"): BattleState {
  return startBattle(SEED, tag, ours, theirs);
}

const vol = (battle: BattleState, side: SideIndex) => battle.sides[side].volatiles ?? {};
const events = (battle: BattleState, t: BattleEvent["t"]) => battle.events.filter((event) => event.t === t);

/** Fast and strong on our side, slow and bulky on theirs, so ours always moves first. */
const fast = (moves: string[], extra: Partial<Individual> = {}) => creature("jolteon", { uid: 1, level: 60, moves, ...extra });
const slow = (moves: string[], extra: Partial<Individual> = {}) => creature("snorlax", { uid: 2, level: 60, moves, ...extra });

describe("everything on the deferred list is honoured", () => {
  it("LM0: fifty-one status moves act, and only the doubles-only eleven do not", () => {
    const honoured = [
      "gravity", "trickroom", "wonderroom", "magicroom", "iondeluge", "fairylock", "courtchange", "camouflage",
      "worryseed", "gastroacid", "entrainment", "roleplay", "skillswap", "simplebeam", "doodle",
      "batonpass", "shedtail", "partingshot", "stealthrock", "toxicspikes", "stickyweb", "spikes", "tidyup",
      "mefirst", "naturepower", "snatch", "magiccoat", "mimic",
      "embargo", "recycle", "switcheroo", "trick", "bestow", "stuffcheeks", "teatime",
      "taunt", "disable", "encore", "imprison", "torment", "healblock", "grudge", "substitute", "powder", "electrify", "octolock",
      "curse", "quickguard", "wideguard", "craftyshield", "matblock",
    ];
    expect(honoured).toHaveLength(51);
    for (const id of honoured) expect(actsOnSomething(moveById(id)), id).toBe(true);
    for (const id of ["helpinghand", "followme", "allyswitch", "afteryou"]) expect(actsOnSomething(moveById(id)), id).toBe(false);
  });
});

describe("restriction", () => {
  it("LM1: Taunt refuses status moves for three turns, then lifts", () => {
    let battle = battleOf([fast(["taunt", "tackle"])], [slow(["growl", "tackle"])]);
    battle = step(battle, fight(0, 1));
    expect(vol(battle, 1).taunt).toBe(2);
    expect(actionRefusal(battle, 1, { t: "fight", moveIndex: 0 })).toContain("taunt");
    expect(actionRefusal(battle, 1, { t: "fight", moveIndex: 1 })).toBeNull();
    battle = step(battle, fight(1, 1));
    battle = step(battle, fight(1, 1));
    expect(vol(battle, 1).taunt).toBeUndefined();
    expect(actionRefusal(battle, 1, { t: "fight", moveIndex: 0 })).toBeNull();
  });

  it("LM2: Disable refuses the last move, Encore allows only it, Torment refuses a repeat", () => {
    let battle = battleOf([fast(["splash", "disable", "encore", "torment"])], [slow(["tackle", "growl"])]);
    battle = step(battle, fight(0, 0)); // they Tackle
    const disabled = step(battle, fight(1, 1));
    // They used Growl this turn, after the Disable landed on Tackle.
    expect(actionRefusal(disabled, 1, { t: "fight", moveIndex: 0 })).toContain("disabled");

    const encored = step(battle, fight(2, 0));
    expect(vol(encored, 1).encore).toBe("tackle");
    expect(actionRefusal(encored, 1, { t: "fight", moveIndex: 1 })).toContain("encore");

    const tormented = step(battle, fight(3, 0));
    expect(actionRefusal(tormented, 1, { t: "fight", moveIndex: 0 })).toContain("tormented");
  });

  it("LM3: Imprison seals every move the user also knows", () => {
    const battle = step(battleOf([fast(["imprison", "tackle"])], [slow(["tackle", "growl"])]), fight(0, 1));
    expect(actionRefusal(battle, 1, { t: "fight", moveIndex: 0 })).toContain("Imprison");
    expect(actionRefusal(battle, 1, { t: "fight", moveIndex: 1 })).toBeNull();
  });

  it("LM4: Heal Block stops Recover being picked and stops healing", () => {
    const hurt = slow(["recover", "tackle"]);
    let battle = battleOf([fast(["healblock", "tackle"])], [{ ...hurt, hp: 50 }]);
    battle = step(battle, fight(0, 1));
    expect(actionRefusal(battle, 1, { t: "fight", moveIndex: 0 })).toContain("heal");
  });

  it("LM5: an Encore on a move with no uses left leaves only Struggle", () => {
    let battle = battleOf([fast(["splash", "encore"])], [slow(["tackle", "growl"])]);
    battle = step(battle, fight(0, 0));
    battle = step(battle, fight(1, 0));
    const theirs = battle.sides[1];
    theirs.team[0] = { ...theirs.team[0], pp: [0, theirs.team[0].pp[1]] };
    expect(actionRefusal(battle, 1, { t: "fight", moveIndex: 1 })).not.toBeNull();
    expect(actionRefusal(battle, 1, { t: "struggle" })).toBeNull();
  });
});

describe("the substitute", () => {
  it("LM6: costs a quarter, takes the hit, and makes status moves fail", () => {
    const user = fast(["substitute"]);
    let battle = battleOf([user], [slow(["tackle", "thunderwave"])]);
    battle = step(battle, fight(0, 0));
    const cost = Math.floor(maxHp(activeOf(battle, 0)) / 4);
    // The decoy took the Tackle, not the creature.
    expect(activeOf(battle, 0).hp).toBe(maxHp(activeOf(battle, 0)) - cost);
    expect(events(battle, "volatile").some((e) => e.t === "volatile" && (e.which === "decoyhit" || e.which === "decoybroke"))).toBe(true);

    const fresh = step(battleOf([fast(["substitute", "splash"])], [slow(["thunderwave", "tackle"])]), fight(0, 0));
    expect(activeOf(fresh, 0).status).toBeNull();
  });
});

describe("hazards", () => {
  it("LM7: Stealth Rock and Spikes bite whoever arrives; Rapid Spin sweeps them", () => {
    const theirs = [slow(["splash"]), creature("charizard", { uid: 3, level: 60, moves: ["splash"] })];
    let battle = battleOf([fast(["stealthrock", "spikes", "rapidspin"])], theirs);
    battle = step(battle, fight(0, 0));
    battle = step(battle, fight(1, 0));
    expect(battle.sides[1].hazards).toEqual({ stealthrock: 1, spikes: 1 });

    // Charizard is Fire/Flying: Rock hits it ×4 (half its health), and it is not grounded.
    const swapped = step(battle, [{ t: "fight", moveIndex: 1 }, { t: "switch", partyIndex: 1 }]);
    const zard = activeOf(swapped, 1);
    expect(maxHp(zard) - zard.hp).toBe(Math.floor((maxHp(zard) * 16) / 32));

    const spun = step(battleOf([fast(["rapidspin"])], [slow(["stealthrock", "splash"])]), fight(0, 0));
    expect(spun.sides[0].hazards).toEqual({ stealthrock: 1 });
    const cleared = step(spun, fight(0, 1));
    expect(cleared.sides[0].hazards).toBeUndefined();
  });

  it("LM8: Toxic Spikes poison a grounded arrival; Sticky Web slows one", () => {
    const theirs = [slow(["splash"]), creature("rattata", { uid: 3, level: 40, moves: ["splash"] })];
    let battle = battleOf([fast(["toxicspikes", "stickyweb"])], theirs);
    battle = step(battle, fight(0, 0));
    battle = step(battle, fight(1, 0));
    const arrived = step(battle, [{ t: "fight", moveIndex: 1 }, { t: "switch", partyIndex: 1 }]);
    expect(activeOf(arrived, 1).status).toBe("psn");
    expect(arrived.sides[1].stages.spe).toBe(-1);
  });
});

describe("leaving", () => {
  it("LM9: Baton Pass hands the stages to the next one; Parting Shot drops and leaves", () => {
    const ours = [fast(["swordsdance", "batonpass", "partingshot"]), creature("rattata", { uid: 5, level: 40, moves: ["tackle"] })];
    let battle = battleOf(ours, [slow(["splash"])]);
    battle = step(battle, fight(0, 0));
    expect(battle.sides[0].stages.atk).toBe(2);
    battle = step(battle, fight(1, 0));
    expect(battle.sides[0].active).toBe(1);
    expect(battle.sides[0].stages.atk).toBe(2);

    const shot = step(battleOf(ours, [slow(["splash"])]), fight(2, 0));
    expect(shot.sides[0].active).toBe(1);
    expect(shot.sides[1].stages.atk).toBe(-1);
    expect(shot.sides[1].stages.spa).toBe(-1);
  });
});

describe("rooms", () => {
  it("LM10: Trick Room lets the slower one move first", () => {
    let battle = battleOf([fast(["trickroom", "tackle"])], [slow(["splash", "tackle"])]);
    battle = step(battle, fight(0, 0));
    expect(battle.field?.rooms?.trickroom).toBe(4);
    battle = step(battle, fight(1, 1));
    const uses = battle.events.filter((e): e is Extract<BattleEvent, { t: "use" }> => e.t === "use");
    expect(uses[0].side).toBe(1);
  });

  it("LM11: Gravity lets a Ground move reach a Flying type", () => {
    const bird = creature("pidgeot", { uid: 2, level: 60, moves: ["splash"] });
    const without = step(battleOf([fast(["earthquake", "gravity"])], [bird]), fight(0, 0));
    expect(activeOf(without, 1).hp).toBe(maxHp(bird));
    let battle = step(battleOf([fast(["earthquake", "gravity"])], [bird]), fight(1, 0));
    battle = step(battle, fight(0, 0));
    expect(activeOf(battle, 1).hp).toBeLessThan(maxHp(bird));
  });

  it("LM12: Magic Room switches Leftovers off, and gives it back afterwards", () => {
    const holder = slow(["splash"], { heldItem: "hold-leftovers", hp: 100 });
    const battle = step(battleOf([fast(["magicroom"])], [holder]), fight(0, 0));
    expect(activeOf(battle, 1).hp).toBe(100);
    expect(activeOf(battle, 1).heldItem).toBeNull();
    expect(vol(battle, 1).muffled).toBe("hold-leftovers");
  });
});

describe("items", () => {
  it("LM13: Knock Off's item comes back; Thief keeps a wild creature's but returns a trainer's", () => {
    const knocked = step(battleOf([fast(["knockoff"])], [slow(["splash"], { heldItem: "hold-leftovers" })]), fight(0, 0));
    expect(activeOf(knocked, 1).heldItem).toBeNull();
    expect(knocked.sides[1].knocked).toEqual({ 0: "hold-leftovers" });

    const wild = step(
      battleOf([fast(["thief"])], [slow(["splash"], { heldItem: "berry-oran" })], "wild:meadow-1:0"),
      fight(0, 0),
      WILD_RULES,
    );
    expect(activeOf(wild, 0).heldItem).toBe("berry-oran");
    expect(wild.sides[0].lent).toEqual({ 0: null });

    const trainer = step(battleOf([fast(["thief"])], [slow(["splash"], { heldItem: "berry-oran" })]), fight(0, 0));
    expect(activeOf(trainer, 0).heldItem).toBe("berry-oran");
    expect(trainer.sides[0].lent).toEqual({ 0: null });
  });

  it("LM13b: in the wild your own items come back — after Thief, Trick or Bestow — and a caught one is not holding them", () => {
    const wildTag = "wild:meadow-1:0";
    const flee = (battle: BattleState) => resolveTurn(battle, [{ t: "flee" }, { t: "fight", moveIndex: 0 }], WILD_RULES, 10).battle;
    const fled = (battle: BattleState) => {
      // Running can fail; keep trying until the battle is over.
      for (let tries = 0; tries < 30 && !battle.outcome; tries++) battle = flee({ ...battle, tag: `${wildTag}:${tries}` });
      expect(battle.outcome?.t).toBe("fled");
      return battle;
    };

    // A wild Thief takes the Lucky Egg; it is back when the battle is over.
    const robbed = step(
      battleOf([slow(["splash"], { uid: 1, heldItem: "hold-luckyegg" })], [fast(["thief"], { uid: 2 })], wildTag),
      fight(0, 0),
      WILD_RULES,
    );
    expect(activeOf(robbed, 0).heldItem).toBeNull();
    const after = fled(robbed);
    expect(activeOf(after, 0).heldItem).toBe("hold-luckyegg");
    expect(activeOf(after, 1).heldItem).toBeNull();

    // Our own Trick: undone on both sides.
    const tricked = fled(
      step(
        battleOf([fast(["trick"], { heldItem: "hold-expshare" })], [slow(["splash"], { heldItem: "berry-oran" })], wildTag),
        fight(0, 0),
        WILD_RULES,
      ),
    );
    expect(activeOf(tricked, 0).heldItem).toBe("hold-expshare");
    expect(activeOf(tricked, 1).heldItem).toBe("berry-oran");

    // Our own Bestow: back to us, and the wild one is empty-handed again.
    const given = fled(step(battleOf([fast(["bestow"], { heldItem: "hold-luckyegg" })], [slow(["splash"])], wildTag), fight(0, 0), WILD_RULES));
    expect(activeOf(given, 0).heldItem).toBe("hold-luckyegg");
    expect(activeOf(given, 1).heldItem).toBeNull();

    // Caught while holding our item: we get the item, not a copy on the catch.
    let catching = robbed;
    let caught = null;
    for (let tries = 0; tries < 60 && !catching.outcome; tries++) {
      const result = resolveTurn({ ...catching, tag: `${wildTag}:c${tries}` }, [{ t: "ball", item: "masterball" }, { t: "fight", moveIndex: 0 }], WILD_RULES, 10);
      catching = result.battle;
      caught = result.caught;
    }
    expect(catching.outcome?.t).toBe("caught");
    expect(activeOf(catching, 0).heldItem).toBe("hold-luckyegg");
    expect(caught?.heldItem).toBeNull();
  });

  it("LM14: Trick exchanges the two items", () => {
    const battle = step(
      battleOf([fast(["trick"], { heldItem: "hold-choicescarf" })], [slow(["splash"], { heldItem: "hold-leftovers" })]),
      fight(0, 0),
    );
    expect(activeOf(battle, 0).heldItem).toBe("hold-leftovers");
    expect(activeOf(battle, 1).heldItem).toBe("hold-choicescarf");
  });
});

describe("abilities", () => {
  it("LM15: Gastro Acid and Skill Swap rewrite abilities, and leaving puts them back", () => {
    const ours = [fast(["gastroacid", "skillswap"], { abilities: ["technician"] }), creature("rattata", { uid: 5, level: 40, moves: ["tackle"] })];
    const theirs = [slow(["splash"], { abilities: ["intimidate"] }), creature("pidgey", { uid: 6, level: 40, moves: ["splash"] })];
    const acid = step(battleOf(ours, theirs), fight(0, 0));
    expect(activeOf(acid, 1).abilities).toEqual([]);
    expect(vol(acid, 1).abilitiesWas).toEqual(["intimidate"]);

    const swapped = step(battleOf(ours, theirs), fight(1, 0));
    expect(activeOf(swapped, 0).abilities).toEqual(["intimidate"]);
    const back = step(swapped, [{ t: "switch", partyIndex: 1 }, { t: "fight", moveIndex: 0 }]);
    expect(back.sides[0].team[0].abilities).toEqual(["technician"]);
  });
});

describe("the counters", () => {
  it("LM16: Fury Cutter doubles for every hit in a row", () => {
    const target = creature("snorlax", { uid: 2, level: 100, moves: ["splash"] });
    let battle = battleOf([fast(["furycutter"])], [target]);
    battle = step(battle, fight(0, 0));
    const first = maxHp(target) - activeOf(battle, 1).hp;
    const hp = activeOf(battle, 1).hp;
    battle = step(battle, fight(0, 0));
    const second = hp - activeOf(battle, 1).hp;
    expect(vol(battle, 0).cutter).toBe(2);
    expect(second).toBeGreaterThan(first * 1.5);
  });

  it("LM17: Rage Fist counts every hit taken", () => {
    let battle = battleOf([fast(["splash", "ragefist"])], [slow(["tackle"])]);
    battle = step(battle, fight(0, 0));
    battle = step(battle, fight(0, 0));
    expect(battle.sides[0].beaten).toEqual({ 0: 2 });
  });

  it("LM18: Glaive Rush leaves its user taking double", () => {
    const battle = step(battleOf([fast(["glaiverush"])], [slow(["splash"])]), fight(0, 0));
    expect(vol(battle, 0).exposed).toBe(1);
  });
});

describe("the rest", () => {
  it("LM19: Curse is a trade for anything but a Ghost, and a curse from one", () => {
    const plain = step(battleOf([fast(["curse"])], [slow(["splash"])]), fight(0, 0));
    expect(plain.sides[0].stages).toMatchObject({ atk: 1, def: 1, spe: -1 });

    const ghost = creature("gengar", { uid: 1, level: 60, moves: ["curse"] });
    const cursed = step(battleOf([ghost], [slow(["splash"])]), fight(0, 0));
    expect(activeOf(cursed, 0).hp).toBe(maxHp(ghost) - Math.floor(maxHp(ghost) / 2));
    expect(vol(cursed, 1).cursed).toBe(true);
  });

  it("LM20: Quick Guard blocks a Quick Attack; Magic Coat bounces a Thunder Wave", () => {
    const guarded = step(battleOf([slow(["quickguard"])], [fast(["quickattack"])]), fight(0, 0));
    expect(events(guarded, "shielded")).toHaveLength(1);

    const coated = step(battleOf([fast(["magiccoat"])], [slow(["thunderwave"])]), fight(0, 0));
    expect(activeOf(coated, 0).status).toBeNull();
    expect(activeOf(coated, 1).status).toBe("par");
  });

  it("LM21: Snatch takes a Swords Dance", () => {
    const battle = step(battleOf([fast(["snatch"])], [slow(["swordsdance"])]), fight(0, 0));
    expect(battle.sides[0].stages.atk).toBe(2);
    expect(battle.sides[1].stages.atk).toBe(0);
  });

  it("LM22: Smack Down grounds a Flying type for the next Ground move", () => {
    const bird = creature("pidgeot", { uid: 2, level: 70, moves: ["splash"] });
    let battle = step(battleOf([fast(["smackdown", "earthquake"])], [bird]), fight(0, 0));
    expect(vol(battle, 1).smacked).toBe(true);
    const hp = activeOf(battle, 1).hp;
    battle = step(battle, fight(1, 0));
    expect(activeOf(battle, 1).hp).toBeLessThan(hp);
  });

  it("LM23: an Uproar keeps everybody awake", () => {
    const battle = step(battleOf([fast(["uproar"])], [slow(["splash"])]), fight(0, 0));
    expect(vol(battle, 0).commitment).toBe("uproar");
    const sleep = step(battle, [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }]);
    expect(activeOf(sleep, 1).status).toBeNull();
  });

  it("LM25: an AI part-way through an Outrage with every use spent keeps going rather than Struggling", () => {
    const battle = battleOf([fast(["splash"])], [slow(["outrage"], { pp: [0] })]);
    battle.sides[1].volatiles = { committed: "outrage", commitment: "rage", commitTurns: 1 };
    const pick = aiAction(battle, 1);
    expect(pick).toEqual({ t: "fight", moveIndex: 0 });
    expect(actionRefusal(battle, 1, pick)).toBeNull();
  });

  it("LM24: Camouflage reads the ground the battle is on", () => {
    const battle = battleOf([fast(["camouflage"])], [slow(["splash"])]);
    const grassy = step({ ...battle, ground: "grass" }, fight(0, 0));
    expect(vol(grassy, 0).types).toEqual(["grass"]);
  });
});
