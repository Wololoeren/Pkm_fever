/**
 * The clock the world runs on: ten thousand steps from one morning to the next.
 *
 * Four phases, and the two that matter are the two nobody designs for. Day and
 * night are four thousand steps each and they are what they sound like; dusk
 * and dawn are a thousand each and they are a *slope* rather than a state —
 * the light moves a thousandth of the way across with every step you take, so
 * there is no frame where the world changes colour and nothing in the game
 * reads "it is now night".
 *
 * Measured in steps rather than in anything real, like every other clock here.
 * A player who walks for an hour and a player who walks for a week see the
 * same sky at the same step count, and a replay sees it again.
 */

export type TimeOfDay = "day" | "dusk" | "night" | "dawn";

/** The whole cycle. */
export const DAY_LENGTH = 10_000;

/** How long the light takes to cross, at each end of the night. */
export const TWILIGHT = 1_000;

/** Day, then dusk, then night, then dawn — the four, in the order they come. */
export const DAY_PHASES: readonly TimeOfDay[] = ["day", "dusk", "night", "dawn"];

/** How long each phase lasts. The two long ones are what is left over. */
export const PHASE_STEPS: Record<TimeOfDay, number> = {
  day: (DAY_LENGTH - TWILIGHT * 2) / 2,
  dusk: TWILIGHT,
  night: (DAY_LENGTH - TWILIGHT * 2) / 2,
  dawn: TWILIGHT,
};

/** Where in the cycle this step count falls, 0 to `DAY_LENGTH`. */
export function dayStep(stepsTaken: number): number {
  return ((stepsTaken % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH;
}

/** Which of the four it is. */
export function timeOf(stepsTaken: number): TimeOfDay {
  const at = dayStep(stepsTaken);
  let edge = 0;
  for (const phase of DAY_PHASES) {
    edge += PHASE_STEPS[phase];
    if (at < edge) return phase;
  }
  return "day";
}

/**
 * How dark it is, 0 for full day and 1000 for the middle of the night.
 *
 * Per mille and integer, like every other rate in this engine, and the only
 * thing that should decide how anything *looks*: the phase name is for words,
 * this is for light. It slides across the twilights rather than stepping, so
 * the fade is the thousand steps rather than the moment they end.
 */
export function darkness(stepsTaken: number): number {
  const at = dayStep(stepsTaken);
  const day = PHASE_STEPS.day;
  const dusk = day + PHASE_STEPS.dusk;
  const night = dusk + PHASE_STEPS.night;

  if (at < day) return 0;
  if (at < dusk) return Math.round(((at - day) * 1000) / PHASE_STEPS.dusk);
  if (at < night) return 1000;
  return Math.round(((DAY_LENGTH - at) * 1000) / PHASE_STEPS.dawn);
}

/** What the HUD calls it. */
export const TIME_NAMES: Record<TimeOfDay, string> = {
  day: "Day",
  dusk: "Dusk",
  night: "Night",
  dawn: "Dawn",
};

/** How many steps until the next phase begins. */
export function untilNext(stepsTaken: number): number {
  const at = dayStep(stepsTaken);
  let edge = 0;
  for (const phase of DAY_PHASES) {
    edge += PHASE_STEPS[phase];
    if (at < edge) return edge - at;
  }
  return DAY_LENGTH - at;
}

/**
 * What the night is worth, out at the edges of the encounter table.
 *
 * The trade is the whole design: what comes out of the grass at night is
 * *commoner* — the band drops by `NIGHT_BAND` of a ring, so the strong rare
 * things are day work — but whatever does come out has been out there a while.
 * Its chance of an ability is multiplied by `NIGHT_ABILITY_BOOST`, and one in
 * `NIGHT_CHROMA_PER_MILLE` per mille is wearing a colour it did not have this
 * morning. A night hunt is for what a creature *is*, not for what it is worth.
 */
export const NIGHT_BAND = 1;
export const NIGHT_ABILITY_BOOST = 3;
export const NIGHT_CHROMA_PER_MILLE = 60;

/** Whether the grass is running its night table: the whole night, and the darker half of each twilight. */
export function isNightish(stepsTaken: number): boolean {
  return darkness(stepsTaken) >= 500;
}
