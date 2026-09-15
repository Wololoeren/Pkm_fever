import { expect, it } from "vitest";
import { actionRefusal, aiAction, isFainted, resolveTurn, startBattle, TRAINER_RULES, WILD_RULES, type BattleAction, type BattleState } from "@/engine/battle";
import { ALL_SPECIES } from "@/engine/dex";
import { rngFor, intBelow } from "@/engine/rng";
import { creature } from "./helpers";

const NEW = ["gravity","trickroom","wonderroom","magicroom","iondeluge","fairylock","courtchange","camouflage","worryseed","gastroacid","entrainment","roleplay","skillswap","simplebeam","doodle","batonpass","shedtail","partingshot","stealthrock","toxicspikes","stickyweb","spikes","tidyup","mefirst","naturepower","snatch","magiccoat","mimic","embargo","recycle","switcheroo","trick","bestow","stuffcheeks","teatime","taunt","disable","encore","imprison","torment","healblock","grudge","substitute","powder","electrify","octolock","curse","quickguard","wideguard","craftyshield","matblock","furycutter","echoedvoice","stompingtantrum","temperflare","lashout","ragefist","knockoff","thief","covet","incinerate","glaiverush","rage","uproar","smackdown","thousandarrows","psychicnoise","saltcure","sparklingaria","syrupbomb","defog","rapidspin","uturn","recover","protect","fly","outrage","rollout","transform","metronome","sleeptalk","roar","earthquake","tackle","ember","spore","toxic","swordsdance","leechseed","rest","hyperbeam","fakeout","bide","futuresight"];
const ITEMS = [null, "hold-leftovers", "berry-sitrus", "berry-lum", "hold-choicescarf", "hold-lifeorb", "hold-focussash", null];

/**
 * Four hundred battles between random teams built from the moves the last
 * pass honoured, with the AI picking and a random switch now and then. The
 * guard is structural: no turn throws, the AI never picks something the
 * engine refuses, nothing is left standing at nought without a replacement
 * owed, and every battle ends.
 *
 * It found two bugs on its first run: a Struggle refused because an Imprison
 * user had switched out earlier in the same turn, and an AI mid-Outrage with
 * every use spent choosing a Struggle the engine would not accept.
 */
it("FZ1: random battles with every new move never break a rule and always end", () => {
  let turns = 0; let decided = 0;
  for (let n = 0; n < 400; n++) {
    const rng = rngFor("fuzz", n);
    const team = (side: number) => Array.from({ length: 1 + intBelow(rng, 3) }, (_, i) => {
      const spec = ALL_SPECIES[intBelow(rng, ALL_SPECIES.length)];
      const moves = Array.from({ length: 4 }, () => NEW[intBelow(rng, NEW.length)]).filter((m, at, all) => all.indexOf(m) === at);
      return creature(spec.id, { uid: side * 10 + i + 1, level: 20 + intBelow(rng, 60), moves, heldItem: ITEMS[intBelow(rng, ITEMS.length)], abilities: intBelow(rng, 3) ? [] : ["intimidate"] });
    });
    const wild = n % 4 === 0;
    const rules = wild ? WILD_RULES : TRAINER_RULES;
    let state: BattleState = startBattle(`F${n}`, wild ? "wild:x:1" : "trainer:f", team(0), wild ? team(1).slice(0, 1) : team(1));
    if (n % 3 === 0) state = { ...state, ground: "grass" };
    for (let t = 0; t < 400 && !state.outcome; t++) {
      const pick = (side: 0 | 1): BattleAction => {
        if (!state.awaitingSwitch[side]) {
          const roll = intBelow(rngFor("pick", n, t, side), 6);
          if (roll === 0) {
            const combatant = state.sides[side];
            const to = combatant.team.findIndex((c, at) => at !== combatant.active && !isFainted(c));
            const action: BattleAction = { t: "switch", partyIndex: to };
            if (to >= 0 && actionRefusal(state, side, action) === null) return action;
          }
        }
        return aiAction(state, side);
      };
      const actions: [BattleAction, BattleAction] = [pick(0), pick(1)];
      for (const side of [0, 1] as const) {
        const a = actions[side];
        if (a.t !== "pass" && !state.awaitingSwitch[side]) {
          const refusal = actionRefusal(state, side, a);
          if (refusal) throw new Error(`battle ${n} turn ${t}: ai picked refused ${JSON.stringify(a)}: ${refusal} ${JSON.stringify({ v: state.sides[side].volatiles, locked: state.sides[side].locked, c: state.sides[side].team[state.sides[side].active] })}`);
        }
      }
      try {
        state = resolveTurn(state, actions, rules, 0).battle;
      } catch (error) {
        throw new Error(`battle ${n} turn ${t}: ${(error as Error).message} ${JSON.stringify(actions)} ${JSON.stringify(state.sides.map((s) => ({ a: s.active, v: s.volatiles, t: s.team.map((c) => [c.speciesId, c.hp, c.moves, c.pp]) })))}`);
      }
      turns++;
      for (const side of [0, 1] as const) {
        const active = state.sides[side].team[state.sides[side].active];
        if (!state.outcome && isFainted(active) && !state.awaitingSwitch[side]) throw new Error(`battle ${n} turn ${t}: side ${side} fainted with no switch owed`);
        for (const c of state.sides[side].team) if (c.hp < 0 || Number.isNaN(c.hp)) throw new Error(`bad hp ${n}`);
      }
    }
    if (state.outcome) decided++;
  }
  expect(turns).toBeGreaterThan(1000);
  expect(decided).toBe(400);
}, 600000);
