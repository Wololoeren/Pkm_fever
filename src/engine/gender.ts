import { intBelow, type Rng } from "./rng";

/**
 * Gender, and the one thing it decides: who can breed with whom.
 *
 * Three outcomes rather than two. A `trans` creature pairs with either
 * gender — and with another `trans`, since "works with both" has no reason to
 * stop short of itself.
 *
 * The split is flat across every species: 49 / 49 / 2. The games this
 * resembles give each species its own ratio, with some genderless and some
 * locked to one gender, which matters mostly because it gates breeding. That
 * is a manifest field and a build-script change rather than anything here, and
 * a flat split is a defensible rule that needs neither.
 */

export type Gender = "male" | "female" | "trans";

export const GENDERS: readonly Gender[] = ["male", "female", "trans"];

/** Out of a hundred. The remainder after male and female is the third. */
const MALE_PERCENT = 49;
const FEMALE_PERCENT = 49;

/**
 * Rolls a gender.
 *
 * Integer arithmetic against a hundred, so the split is exactly the split and
 * not whatever a float comparison rounds to.
 */
export function rollGender(rng: Rng): Gender {
  const roll = intBelow(rng, 100);
  if (roll < MALE_PERCENT) return "male";
  if (roll < MALE_PERCENT + FEMALE_PERCENT) return "female";
  return "trans";
}

/**
 * Whether these two could produce an egg, on gender alone.
 *
 * Egg groups and the species that cannot breed at all are breeding.ts's
 * business; this answers only the narrower question.
 */
export function gendersPair(a: Gender, b: Gender): boolean {
  if (a === "trans" || b === "trans") return true;
  return a !== b;
}

export const GENDER_SYMBOLS: Record<Gender, string> = {
  male: "♂",
  female: "♀",
  trans: "⚧",
};

export const GENDER_NAMES: Record<Gender, string> = {
  male: "Male",
  female: "Female",
  trans: "Trans",
};
