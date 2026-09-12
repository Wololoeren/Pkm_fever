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

export interface Field {
  weather?: { id: WeatherId; turns: number };
  terrain?: { id: TerrainId; turns: number };
  sport?: { id: SportId; turns: number };
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
  ]
    .filter(Boolean)
    .join("+");
}
