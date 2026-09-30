import { isForm } from "./dex";
import type { WeatherId } from "./field";

/**
 * Creatures that change shape in the middle of a fight.
 *
 * Ten of them, and every one is the same idea: **the form is a function of
 * the battle, not a decision anybody makes.** Castform is whatever the sky is
 * doing, Aegislash is whichever way it last swung, Mimikyu is whether the rag
 * has been torn yet. Nobody presses a button; the shape follows the state,
 * and when the creature leaves the field it is itself again.
 *
 * ## Why it is a table and not eleven special cases
 *
 * Because it is five questions asked at five moments, and each of the eleven
 * answers one of them. Written as a table, adding Zygarde later is a row;
 * written as `if (speciesId === "castform")` in four places in battle.ts, it
 * is four more places to forget.
 *
 * The triggers, and where battle.ts asks them:
 *
 *   - **weather** — after the sky changes and when something is sent out.
 *   - **health** — after damage and after healing, either way across the line.
 *   - **struck** — after a hit lands, for the two that break when hit.
 *   - **turn** — at the end of every turn, for the one that alternates.
 *   - **swung** — after a move is used, for the two that answer what was used.
 *
 * ## What a form is not
 *
 * It is not an evolution and it is not in the roster: see `FORM_SPECIES` in
 * dex.ts. Nothing here can be caught, bred, sold or hatched, and none of the
 * pools the world draws from has moved by a single entry.
 *
 * It is also not the *ability* the games hang these on. This game has its own
 * two hundred abilities and rolls them at random, so "a Castform with
 * Forecast" is not a thing that exists here — being a Castform is the whole
 * qualification, which is both simpler and, for a game where abilities are a
 * lottery, the only rule that could be relied on.
 */

export type FormTrigger =
  /** The sky. Anything not named leaves it in its own shape. */
  | { t: "weather"; when: Partial<Record<WeatherId, string>> }
  /**
   * How much health is left, as a share of the whole.
   *
   * Both ends are named, because the two directions are not the same story:
   * a Darmanitan turns *into* something when it is hurt, and a Minior turns
   * *out of* something. One field for "the shape it wears above the line"
   * would have made the second unsayable, and the first a silent no-op.
   */
  | { t: "health"; share: number; over: string; under: string; minLevel?: number }
  /** Hit by something. `physical` when only a physical hit does it. */
  | { t: "struck"; into: string; physical?: boolean }
  /** Every turn, back and forth. */
  | { t: "turn"; other: string }
  /**
   * What it just swung. `attacking` is the shape an attack puts it in,
   * `guarding` the shape a named move puts it back into.
   */
  | { t: "swung"; attacking?: string; guarding?: { move: string; into: string } }
  /** One move, one shape, and it stays until it leaves the field. */
  | { t: "song"; move: string; into: string };

export interface FormRule {
  /** The species in the roster this belongs to. */
  species: string;
  trigger: FormTrigger;
  /** What the battle log says when it happens. */
  says: string;
}

export const FORM_RULES: readonly FormRule[] = [
  // --------------------------------------------------------- the weather
  {
    species: "castform",
    trigger: {
      t: "weather",
      when: { sun: "castformsunny", rain: "castformrainy", hail: "castformsnowy", snow: "castformsnowy" },
    },
    says: "took the weather's shape",
  },

  // ---------------------------------------------------------- the health
  {
    // Zen at half health and below, which is the way round the games have it.
    species: "darmanitan",
    trigger: { t: "health", share: 2, over: "darmanitan", under: "darmanitanzen" },
    says: "went into Zen mode",
  },
  {
    // Galar's is a different creature with the same habit, and the manifest
    // has it as its own species — so it gets its own row rather than a
    // special case inside Darmanitan's.
    species: "darmanitangalar",
    trigger: { t: "health", share: 2, over: "darmanitangalar", under: "darmanitangalarzen" },
    says: "went into Zen mode",
  },
  {
    // The shell while it is whole; the core underneath once it is broken.
    species: "minior",
    trigger: { t: "health", share: 2, over: "miniormeteor", under: "minior" },
    says: "lost its shell",
  },
  {
    // A school while there is enough of it left, and one small fish below a
    // quarter. Level twenty, as the games have it: a young one cannot gather
    // anybody.
    species: "wishiwashi",
    trigger: { t: "health", share: 4, over: "wishiwashischool", under: "wishiwashi", minLevel: 20 },
    says: "the school scattered",
  },

  // ------------------------------------------------------------ the hits
  {
    species: "mimikyu",
    trigger: { t: "struck", into: "mimikyubusted" },
    says: "its disguise broke",
  },
  {
    species: "eiscue",
    trigger: { t: "struck", into: "eiscuenoice", physical: true },
    says: "its ice face broke",
  },

  // ----------------------------------------------------------- the clock
  {
    species: "morpeko",
    trigger: { t: "turn", other: "morpekohangry" },
    says: "got hungry",
  },

  // ----------------------------------------------------------- the sword
  {
    species: "aegislash",
    trigger: {
      t: "swung",
      attacking: "aegislashblade",
      guarding: { move: "kingsshield", into: "aegislash" },
    },
    says: "changed stance",
  },

  // ------------------------------------------------------------ the song
  {
    species: "meloetta",
    trigger: { t: "song", move: "relicsong", into: "meloettapirouette" },
    says: "danced into its other step",
  },
];

/** Every rule, by the species it belongs to — a form's own id included. */
const BY_SPECIES = new Map<string, FormRule>();
for (const rule of FORM_RULES) BY_SPECIES.set(rule.species, rule);

/**
 * The rule this creature is under, whichever shape it is wearing.
 *
 * Asked with the *current* species id, which may already be a form — a
 * Castform in the rain is a `castformrainy`, and the sun has to be able to
 * find its rule anyway.
 */
export function formRule(speciesId: string): FormRule | null {
  const direct = BY_SPECIES.get(speciesId);
  if (direct) return direct;
  for (const rule of FORM_RULES) {
    if (formsOf(rule).includes(speciesId)) return rule;
  }
  return null;
}

/** Every shape a rule can put something in, including the ordinary one. */
export function formsOf(rule: FormRule): string[] {
  const { trigger } = rule;
  switch (trigger.t) {
    case "weather":
      return [rule.species, ...Object.values(trigger.when)];
    case "health":
      return [rule.species, trigger.over, trigger.under];
    case "struck":
      return [rule.species, trigger.into];
    case "turn":
      return [rule.species, trigger.other];
    case "swung":
      return [rule.species, ...(trigger.attacking ? [trigger.attacking] : []), ...(trigger.guarding ? [trigger.guarding.into] : [])];
    case "song":
      return [rule.species, trigger.into];
  }
}

/** What this creature should be, given the battle — or null to leave it. */
export function formNow(
  speciesId: string,
  level: number,
  { weather, hp, maxHp }: { weather: WeatherId | null; hp: number; maxHp: number },
): string | null {
  const rule = formRule(speciesId);
  if (!rule) return null;

  switch (rule.trigger.t) {
    case "weather":
      // No weather, or a weather this one has no shape for, is its own shape.
      return (weather && rule.trigger.when[weather]) ?? rule.species;
    case "health": {
      if (rule.trigger.minLevel !== undefined && level < rule.trigger.minLevel) return rule.species;
      // Strictly above the share: exactly half is already hurt enough, which
      // is how the games read it.
      const whole = Math.max(1, maxHp);
      return hp * rule.trigger.share > whole ? rule.trigger.over : rule.trigger.under;
    }
    default:
      // The rest are answers to something that happened rather than to a
      // state, so they are set where they happen and left alone here.
      return null;
  }
}

/** Whether this species can change shape at all, in any direction. */
export function changesShape(speciesId: string): boolean {
  return formRule(speciesId) !== null;
}

/** A guard for the tests: every shape a rule names is one the dex can find. */
export function formSpeciesExist(rule: FormRule): boolean {
  return formsOf(rule).every((id) => id === rule.species || isForm(id));
}
