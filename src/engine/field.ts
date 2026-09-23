/**
 * The field: what is true of the *battle* rather than of either side.
 *
 * Weather, terrain and the two sports are one shape — an id and a count of
 * turns — kept on the battle state under `field`, and absent when nothing is
 * up, so a battle with no weather in it hashes exactly as it did before any
 * of this existed. Every saved duel and every replayed battle log still
 * checks.
 *
 * ## Why it is one feature
 *
 * The deferred lists all said the same thing: weather is not a move, it is a
 * condition every damage calculation, every residual, every accuracy roll and
 * a dozen abilities have to ask about. Building half of it — sun without the
 * abilities that read sun — is worse than none of it, because a player who
 * brings Chlorophyll into the sun and gets nothing has learned that abilities
 * are unreliable. So it arrives whole: five weathers, four terrains, the two
 * sports, Aurora Veil, and twenty-four abilities that set or read them.
 *
 * ## The arithmetic
 *
 * All of it is per-mille and integer, like everything else in the damage
 * formula. Sun and rain are ×1.5 and ×0.5 on Fire and Water; the terrains are
 * ×1.3 on their type for a grounded attacker; Misty is ×0.5 on Dragon into a
 * grounded target; the sports are ×0.333. Sand gives a Rock type half again
 * on Sp. Def, snow gives an Ice type half again on Defence. Sand and hail
 * take a sixteenth a turn off everything that is not built for them; Grassy
 * Terrain gives a sixteenth back to everything grounded.
 */

export type WeatherId = "sun" | "rain" | "sand" | "hail" | "snow";
export type TerrainId = "electric" | "grassy" | "misty" | "psychic";
export type SportId = "water" | "mud";
/**
 * The conditions on the battle that are not a weather or a terrain. Several
 * can be up at once, so they are a map of turns rather than one slot.
 * Fairy Lock is here because it is the same shape — a count on the battle —
 * with a count of two, so it holds through the turn after it is used.
 */
export type RoomId = "gravity" | "trickroom" | "wonderroom" | "magicroom" | "fairylock";

export interface Field {
  weather?: { id: WeatherId; turns: number };
  terrain?: { id: TerrainId; turns: number };
  sport?: { id: SportId; turns: number };
  rooms?: Partial<Record<RoomId, number>>;
}

/** How long any of the three lasts. Five turns, as a screen does. */
export const FIELD_TURNS = 5;

/** What a sixteenth is: sand's bite, hail's bite, Grassy Terrain's mending. */
export const FIELD_SHARE = 16;

/** Types that stand in a sandstorm untouched. */
export const SAND_PROOF: readonly string[] = ["rock", "ground", "steel"];

/** Types that stand in hail untouched. */
export const HAIL_PROOF: readonly string[] = ["ice"];

/** What Weather Ball becomes. */
export const WEATHER_TYPE: Record<WeatherId, string> = {
  sun: "fire",
  rain: "water",
  sand: "rock",
  hail: "ice",
  snow: "ice",
};

/**
 * The field as a string, for the two hashes.
 *
 * Empty for an absent field, and written in a fixed order rather than as
 * JSON of the object, so two peers that set the same weather from different
 * code paths agree about the battle they agree about.
 */
export function fieldKey(field: Field | undefined): string {
  if (!field) return "";
  return [
    field.weather ? `w:${field.weather.id}=${field.weather.turns}` : "",
    field.terrain ? `t:${field.terrain.id}=${field.terrain.turns}` : "",
    field.sport ? `s:${field.sport.id}=${field.sport.turns}` : "",
    ...Object.entries(field.rooms ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, turns]) => `r:${id}=${turns}`),
  ]
    .filter(Boolean)
    .join("+");
}

/* ------------------------------------------------------------ the handbook
 *
 * What each of these is called and what it does, as data rather than as
 * prose in a component. The handbook draws this; `tests/weather.test.ts`
 * measures a real swing for every `power` row below and checks the number
 * against the battle itself, so the page cannot promise a multiplier the
 * damage formula does not apply.
 */

/** A type as it is written down rather than as it is keyed. */
const capital = (type: string): string => `${type[0].toUpperCase()}${type.slice(1)}`;

/** One thing the field does to damage: a move type, and what a hit becomes. */
export interface FieldPower {
  /** The move type it moves. */
  type: string;
  /** What a hit becomes, per mille: 1500 is half again, 500 is half. */
  mille: number;
  /**
   * Whose feet decide it.
   *
   * The terrains only reach what is standing on them — "attacker" for the
   * three that help their own type, "target" for Misty holding Dragon off.
   * Absent for the weathers and the sports, which reach everybody.
   */
  grounded?: "attacker" | "target";
}

export interface FieldFact {
  id: string;
  name: string;
  /** What raises it, by name, so the list is also a list of moves to look for. */
  from: string;
  power: readonly FieldPower[];
  /** Everything else it does, in words. */
  notes: readonly string[];
}

export const WEATHERS: readonly FieldFact[] = [
  {
    id: "sun",
    name: "Harsh sunlight",
    from: "Sunny Day",
    power: [
      { type: "fire", mille: 1500 },
      { type: "water", mille: 500 },
    ],
    notes: ["Hydro Steam is the one Water move the sun helps rather than hinders."],
  },
  {
    id: "rain",
    name: "Rain",
    from: "Rain Dance",
    power: [
      { type: "water", mille: 1500 },
      { type: "fire", mille: 500 },
    ],
    notes: ["Solar Beam and Solar Blade lose half their power in any weather but sun."],
  },
  {
    id: "sand",
    name: "Sandstorm",
    from: "Sandstorm",
    power: [],
    notes: [
      `A sixteenth of full health off everything each turn, except ${SAND_PROOF.map(capital).join(", ")}.`,
      "A Rock type keeps half again its Sp. Def while it blows.",
    ],
  },
  {
    id: "hail",
    name: "Hail",
    from: "Hail",
    power: [],
    notes: [`A sixteenth of full health off everything each turn, except ${HAIL_PROOF.map(capital).join(", ")}.`],
  },
  {
    id: "snow",
    name: "Snow",
    from: "Snowscape",
    power: [],
    notes: ["An Ice type keeps half again its Defence while it falls.", "Nothing is hurt by it."],
  },
];

export const TERRAINS: readonly FieldFact[] = [
  {
    id: "electric",
    name: "Electric Terrain",
    from: "Electric Terrain",
    power: [{ type: "electric", mille: 1300, grounded: "attacker" }],
    notes: ["Nothing on the ground can be put to sleep."],
  },
  {
    id: "grassy",
    name: "Grassy Terrain",
    from: "Grassy Terrain",
    power: [{ type: "grass", mille: 1300, grounded: "attacker" }],
    notes: ["Everything on the ground takes back a sixteenth of full health each turn."],
  },
  {
    id: "misty",
    name: "Misty Terrain",
    from: "Misty Terrain",
    power: [{ type: "dragon", mille: 500, grounded: "target" }],
    notes: ["Nothing on the ground can be given a condition at all."],
  },
  {
    id: "psychic",
    name: "Psychic Terrain",
    from: "Psychic Terrain",
    power: [{ type: "psychic", mille: 1300, grounded: "attacker" }],
    notes: [],
  },
];

export const SPORTS: readonly FieldFact[] = [
  { id: "water", name: "Water Sport", from: "Water Sport", power: [{ type: "fire", mille: 333 }], notes: [] },
  { id: "mud", name: "Mud Sport", from: "Mud Sport", power: [{ type: "electric", mille: 333 }], notes: [] },
];

/** The rest of the field: several can be up at once. */
export const ROOMS: readonly { id: RoomId; name: string; note: string }[] = [
  { id: "gravity", name: "Gravity", note: "Everything is on the ground, and nothing can fly out of the way." },
  { id: "trickroom", name: "Trick Room", note: "Within a priority bracket, the slower one moves first." },
  { id: "wonderroom", name: "Wonder Room", note: "Defence and Sp. Def change places." },
  { id: "magicroom", name: "Magic Room", note: "Held items do nothing." },
  { id: "fairylock", name: "Fairy Lock", note: "Nobody can leave the field on the turn after it is used." },
];
