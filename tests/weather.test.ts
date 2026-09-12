import { describe, expect, it } from "vitest";
import {
  activeOf,
  battleHash,
  maxHp,
  resolveTurn,
  startBattle,
  WILD_RULES,
  type BattleEvent,
  type BattleState,
  type SideIndex,
} from "@/engine/battle";
import { ABILITIES } from "@/engine/abilities";
import { FIELD_TURNS } from "@/engine/field";
import { creature } from "./helpers";

/**
 * The field: weather, terrain, the sports, and the abilities that set or
 * read them. One feature, so one file — and the property under test is the
 * one the deferred lists asked for: everything that should read the weather
 * reads the same weather.
 */

const SEED = "FIELD1";
const TAG = "wild:test:0";

function turn(battle: BattleState, ours: number, theirs: number) {
  const result = resolveTurn(battle, [{ t: "fight", moveIndex: ours }, { t: "fight", moveIndex: theirs }], WILD_RULES, 10);
  return { battle: result.battle, events: result.battle.events };
}

function fought(ours: ReturnType<typeof creature>, theirs: ReturnType<typeof creature>): BattleState {
  return startBattle(SEED, TAG, [ours], [theirs]);
}

function damagedOn(events: readonly BattleEvent[], side: SideIndex): number {
  return events
    .filter((event): event is Extract<BattleEvent, { t: "damage" }> => event.t === "damage" && event.side === side)
    .reduce((total, event) => total + event.amount, 0);
}

/** The same swing under two skies, measured rather than asserted. */
function swing(moveId: string, weather: string | null, attackerId = "rattata", defenderId = "machop"): number {
  const ours = creature(attackerId, { level: 50, moves: [moveId] });
  const theirs = creature(defenderId, { level: 50, moves: ["splash"], uid: 2 });
  const battle = fought(ours, theirs);
  if (weather) battle.field = { weather: { id: weather as never, turns: 5 } };
  return damagedOn(turn(battle, 0, 0).events, 1);
}

describe("weather", () => {
  it("W1: a weather move puts it up for five turns, says so, and it ends out loud", () => {
    const ours = creature("rattata", { level: 50, moves: ["raindance", "splash"] });
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    let live = turn(fought(ours, theirs), 0, 0);
    expect(live.battle.field?.weather).toEqual({ id: "rain", turns: FIELD_TURNS - 1 });
    expect(live.events.some((event) => event.t === "field" && event.id === "rain" && !event.over)).toBe(true);

    // Again is nothing, while it is still raining.
    const again = turn(live.battle, 0, 0);
    expect(again.events.some((event) => event.t === "fizzled" && event.side === 0)).toBe(true);

    for (let n = 0; n < FIELD_TURNS - 2; n++) live = turn(live.battle, 1, 0);
    expect(live.battle.field?.weather?.turns).toBe(1);
    const last = turn(live.battle, 1, 0);
    expect(last.battle.field).toBeUndefined();
    expect(last.events.some((event) => event.t === "field" && event.id === "rain" && event.over)).toBe(true);
  });

  it("W2: sun and rain move Fire and Water by half, each way", () => {
    expect(swing("ember", "sun")).toBeGreaterThan(swing("ember", null));
    expect(swing("ember", "rain")).toBeLessThan(swing("ember", null));
    expect(swing("watergun", "rain")).toBeGreaterThan(swing("watergun", null));
    expect(swing("watergun", "sun")).toBeLessThan(swing("watergun", null));
    // And the sand does nothing to either.
    expect(swing("ember", "sand")).toBe(swing("ember", null));
  });

  it("W3: sand and hail take a sixteenth a turn off what is not built for them", () => {
    const ours = creature("rattata", { level: 50, moves: ["sandstorm", "splash"] });
    const rock = creature("geodude", { level: 50, moves: ["splash"], uid: 2 });
    const stormed = turn(fought(ours, rock), 0, 0);
    expect(activeOf(stormed.battle, 0).hp).toBe(maxHp(ours) - Math.floor(maxHp(ours) / 16));
    expect(activeOf(stormed.battle, 1).hp).toBe(maxHp(rock));
    expect(stormed.events.some((event) => event.t === "weathered" && event.side === 0 && event.weather === "sand")).toBe(true);

    const hailer = creature("rattata", { level: 50, moves: ["hail"] });
    const ice = creature("snorunt", { level: 50, moves: ["splash"], uid: 2 });
    const hailed = turn(fought(hailer, ice), 0, 0);
    expect(activeOf(hailed.battle, 0).hp).toBeLessThan(maxHp(hailer));
    expect(activeOf(hailed.battle, 1).hp).toBe(maxHp(ice));
  });

  it("W4: Thunder cannot miss in the rain and Blizzard cannot miss in the snow", () => {
    let rainHits = 0;
    let snowHits = 0;
    for (let at = 0; at < 20; at++) {
      const ours = creature("rattata", { level: 50, moves: ["thunder", "blizzard"] });
      const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });
      const rain = startBattle(`${SEED}-${at}`, TAG, [ours], [theirs]);
      rain.field = { weather: { id: "rain", turns: 5 } };
      if (damagedOn(turn(rain, 0, 0).events, 1) > 0) rainHits++;
      const snow = startBattle(`${SEED}-${at}`, TAG, [ours], [theirs]);
      snow.field = { weather: { id: "snow", turns: 5 } };
      if (damagedOn(turn(snow, 1, 0).events, 1) > 0) snowHits++;
    }
    expect(rainHits).toBe(20);
    expect(snowHits).toBe(20);
  });

  it("W5: Weather Ball takes the weather's type, and Synthesis reads the sky", () => {
    // Against a Grass type: Normal is plain, Fire in the sun is doubled and
    // super effective.
    const plain = swing("weatherball", null, "rattata", "oddish");
    const sunny = swing("weatherball", "sun", "rattata", "oddish");
    expect(sunny).toBeGreaterThan(plain * 2);

    const mend = (weather: string | null) => {
      const ours = creature("bulbasaur", { level: 50, moves: ["synthesis"], hp: 1 });
      const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });
      const battle = fought(ours, theirs);
      if (weather) battle.field = { weather: { id: weather as never, turns: 5 } };
      return activeOf(turn(battle, 0, 0).battle, 0).hp - 1;
    };
    const max = maxHp(creature("bulbasaur", { level: 50 }));
    expect(mend(null)).toBe(Math.floor(max / 2));
    expect(mend("sun")).toBe(Math.floor((max * 2) / 3));
    expect(mend("rain")).toBe(Math.floor(max / 4));
  });
});

describe("terrain", () => {
  it("W6: a terrain lifts its type for the grounded, and not for the flying", () => {
    const grounded = creature("rattata", { level: 50, moves: ["thundershock"] });
    const flying = creature("pidgey", { level: 50, moves: ["thundershock"] });
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    const plainGround = damagedOn(turn(fought(grounded, theirs), 0, 0).events, 1);
    const charged = fought(grounded, theirs);
    charged.field = { terrain: { id: "electric", turns: 5 } };
    expect(damagedOn(turn(charged, 0, 0).events, 1)).toBeGreaterThan(plainGround);

    const plainAir = damagedOn(turn(fought(flying, theirs), 0, 0).events, 1);
    const airborne = fought(flying, theirs);
    airborne.field = { terrain: { id: "electric", turns: 5 } };
    expect(damagedOn(turn(airborne, 0, 0).events, 1)).toBe(plainAir);
  });

  it("W7: Misty Terrain refuses a condition on the ground, Electric refuses sleep, Psychic refuses priority", () => {
    const ours = creature("rattata", { level: 50, moves: ["thunderwave", "spore", "quickattack"] });
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    const misty = fought(ours, theirs);
    misty.field = { terrain: { id: "misty", turns: 5 } };
    expect(activeOf(turn(misty, 0, 0).battle, 1).status).toBeNull();

    const electric = fought(ours, theirs);
    electric.field = { terrain: { id: "electric", turns: 5 } };
    expect(activeOf(turn(electric, 1, 0).battle, 1).status).toBeNull();
    expect(activeOf(turn(fought(ours, theirs), 1, 0).battle, 1).status).toBe("slp");

    const psychic = fought(ours, theirs);
    psychic.field = { terrain: { id: "psychic", turns: 5 } };
    const quick = turn(psychic, 2, 0);
    expect(damagedOn(quick.events, 1)).toBe(0);
    expect(quick.events.some((event) => event.t === "fizzled" && event.side === 0)).toBe(true);
  });

  it("W8: Grassy Terrain mends the grounded a sixteenth a turn", () => {
    const ours = creature("rattata", { level: 50, moves: ["grassyterrain"], hp: 10 });
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });
    const grown = turn(fought(ours, theirs), 0, 0);
    expect(activeOf(grown.battle, 0).hp).toBe(10 + Math.max(1, Math.floor(maxHp(ours) / 16)));
  });

  it("W9: Aurora Veil wants hail or snow, and then puts both screens up", () => {
    const ours = creature("rattata", { level: 50, moves: ["auroraveil", "snowscape"] });
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });
    const clear = turn(fought(ours, theirs), 0, 0);
    expect(clear.events.some((event) => event.t === "fizzled")).toBe(true);
    expect(clear.battle.sides[0].screens).toBeUndefined();

    const snowed = turn(fought(ours, theirs), 1, 0);
    const veiled = turn(snowed.battle, 0, 0);
    expect(veiled.battle.sides[0].screens).toMatchObject({ reflect: 4, lightscreen: 4 });
  });
});

describe("the abilities that read it", () => {
  it("W10: twenty-three of them joined the roll", () => {
    const ids = ["drought", "drizzle", "sandstream", "snowwarning", "electricsurge", "grassysurge", "mistysurge", "psychicsurge", "chlorophyll", "swiftswim", "sandrush", "slushrush", "surgesurfer", "grasspelt", "raindish", "icebody", "hydration", "sandveil", "snowcloak", "sandforce", "leafguard", "cloudnine", "airlock"];
    for (const id of ids) expect(ABILITIES.some((spec) => spec.id === id), id).toBe(true);
  });

  it("W11: Drought brings the sun on arrival, and Chlorophyll then moves first", () => {
    // Rattata is faster than Machop; a Machop with Chlorophyll in the sun is
    // twice as fast, and moves first.
    const ours = creature("rattata", { level: 50, moves: ["tackle"] });
    const theirs = creature("machop", { level: 50, moves: ["tackle"], uid: 2, abilities: ["chlorophyll", "drought"] });
    const first = turn(fought(ours, theirs), 0, 0);
    expect(first.battle.field?.weather?.id).toBe("sun");
    expect(first.events.some((event) => event.t === "ability" && event.abilityId === "drought")).toBe(true);
    const order = first.events.filter((event) => event.t === "use").map((event) => (event as { side: SideIndex }).side);
    expect(order[0]).toBe(1);

    // Without the sun, Rattata leads.
    const plain = turn(fought(ours, creature("machop", { level: 50, moves: ["tackle"], uid: 2, abilities: ["chlorophyll"] })), 0, 0);
    const plainOrder = plain.events.filter((event) => event.t === "use").map((event) => (event as { side: SideIndex }).side);
    expect(plainOrder[0]).toBe(0);
  });

  it("W12: Rain Dish mends, Hydration cures, Leaf Guard refuses, Cloud Nine calms", () => {
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });

    const dish = creature("rattata", { level: 50, moves: ["raindance"], hp: 10, abilities: ["raindish"] });
    const rained = turn(fought(dish, theirs), 0, 0);
    expect(activeOf(rained.battle, 0).hp).toBe(10 + Math.max(1, Math.floor(maxHp(dish) / 16)));

    const wet = creature("rattata", { level: 50, moves: ["raindance"], status: "brn", abilities: ["hydration"] });
    expect(activeOf(turn(fought(wet, theirs), 0, 0).battle, 0).status).toBeNull();

    const leaf = creature("rattata", { level: 50, moves: ["sunnyday"], abilities: ["leafguard"] });
    const waver = creature("machop", { level: 50, moves: ["thunderwave"], uid: 2 });
    const sunny = turn(fought(leaf, waver), 0, 0);
    expect(activeOf(sunny.battle, 0).status).toBeNull();

    // Cloud Nine: it rains, and nothing feels it. All three Embers are thrown
    // on turn two, so the spread roll is the same and only the sky differs.
    const second = (abilities: string[], first: string) => {
      const user = creature("rattata", { level: 50, moves: [first, "ember"], abilities });
      const opened = turn(fought(user, theirs), 0, 0);
      return { field: opened.battle.field, dealt: damagedOn(turn(opened.battle, 1, 0).events, 1) };
    };
    const dry = second([], "splash");
    const underRain = second([], "raindance");
    const calmed = second(["cloudnine"], "raindance");
    expect(underRain.field?.weather?.id).toBe("rain");
    expect(calmed.field?.weather?.id).toBe("rain");
    expect(underRain.dealt).toBeLessThan(dry.dealt);
    expect(calmed.dealt).toBe(dry.dealt);
  });

  it("W13: the field is in the hash, and absent when nothing is up", () => {
    const ours = creature("rattata", { level: 50, moves: ["tackle"] });
    const theirs = creature("machop", { level: 50, moves: ["tackle"], uid: 2 });
    const plain = startBattle(SEED, TAG, [ours], [theirs]);
    const rainy = startBattle(SEED, TAG, [ours], [theirs]);
    rainy.field = { weather: { id: "rain", turns: 3 } };
    expect(battleHash(rainy)).not.toBe(battleHash(plain));

    const played = turn(plain, 0, 0).battle;
    expect(played.field).toBeUndefined();
  });
});
