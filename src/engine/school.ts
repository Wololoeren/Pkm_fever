import { NATURE_MAGNITUDE } from "./natures";
import type { NpcPlacement } from "./npc";
import { EV_MAX_PER_STAT, EV_MAX_TOTAL, IV_MAX, WILD_IV_MAX } from "./stats";
import { STAT_IDS } from "./types";
import { TOP_TIER, variant } from "./variants";

/**
 * The trainer school: four people in Hearth's house, one idea each.
 *
 * The game explains almost nothing on purpose — the stat sheet puts base, IV,
 * nature and effort in four columns and trusts you to read them — and the
 * cost of that was real: the four ideas the whole design rests on were
 * written down in the README and nowhere a player would stand. The people on
 * the routes carry ninety-nine facts between them, but a fact dealt out of a
 * deck is a fact you meet by accident, and these four are the ones a new
 * player should be able to walk to.
 *
 * Every number in a lesson is read out of the constant it is about, at
 * module load, so a lesson cannot say thirty-one after somebody makes it
 * thirty-two. That is the same rule the route hints keep by guard; here it is
 * kept by construction.
 *
 * Four people rather than one with four paragraphs, because a lesson you
 * choose is a lesson you wanted, and a wall of everything is the README with
 * a sprite in front of it.
 */

/** What the sign over the door in Hearth says. */
export const SCHOOL_LABEL = "Trainer School";

const shiny = variant("shiny").mult.atk;
const shinyPercent = ((shiny - 1000) / 10).toFixed(1).replace(/\.0$/, "");
const statCount = STAT_IDS.length;

export const SCHOOL: readonly NpcPlacement[] = [
  {
    id: "teacher-iv",
    name: "Teacher",
    kind: "hint",
    where: { at: "interior", role: "house", town: "hub-0" },
    lines: [
      "Sit anywhere. Today it is the six hidden numbers.",
      `Every creature is born with one per stat, nought to ${IV_MAX}, and it never changes. That is the IV column on the sheet. Anything caught in the grass rolls nought to ${WILD_IV_MAX} — one fifth of the ceiling — so a wild catch is a starting point and never a finished thing.`,
      `The only way past ${WILD_IV_MAX} is an egg. Each stat comes down from one parent or the other, and now and then it climbs. Six stats at ${IV_MAX} is ${IV_MAX * statCount} in all, and nobody has walked out of the grass with that.`,
      "Read it as a fraction on the sheet: thirty-one over thirty-one is finished, six over thirty-one is a wild thing.",
    ],
  },
  {
    id: "teacher-nature",
    name: "Teacher",
    kind: "hint",
    where: { at: "interior", role: "house", town: "hub-0" },
    lines: [
      "Natures. Everybody thinks they know natures, and everybody is thinking of a different game.",
      `Here a nature is a number, not a percentage: it adds ${NATURE_MAGNITUDE} to one stat's term and takes ${NATURE_MAGNITUDE} off another's, before the level scales the whole sum. Same twenty-five names as you remember, five of them neutral.`,
      `Because it adds rather than multiplies, it is worth the same on every creature: ${NATURE_MAGNITUDE} in the term is about ${NATURE_MAGNITUDE / 2} points at level fifty and ${NATURE_MAGNITUDE} at the cap, whether the base is 40 or 140. The sheet shows it as its own column, plus or minus, so you can see exactly what it bought.`,
      "The trade is the point. A nature that lifts the stat you use and drops the one you do not is worth nearly a whole rung of shine.",
    ],
  },
  {
    id: "teacher-effort",
    name: "Teacher",
    kind: "hint",
    where: { at: "interior", role: "house", town: "hub-0" },
    lines: [
      "Effort is the half of a creature you choose. The rest was decided before you met it.",
      `Every creature you beat teaches yours a little of whatever it was good at. Four points of effort are one point of stat at the cap, and there are limits: ${EV_MAX_PER_STAT} in any one stat, ${EV_MAX_TOTAL} in all — so ${Math.floor(EV_MAX_TOTAL / EV_MAX_PER_STAT)} stats can be filled and the rest gets the change.`,
      `${EV_MAX_PER_STAT} in a stat is ${Math.floor(EV_MAX_PER_STAT / 4)} points at level a hundred. That is more than the whole IV range, and it is the one thing on the sheet earned by what you fought rather than what you inherited.`,
      "Fight what teaches what you want. A Speed you bred for and then fed on slow things is a Speed you wasted.",
    ],
  },
  {
    id: "teacher-shine",
    name: "Teacher",
    kind: "hint",
    where: { at: "interior", role: "house", town: "hub-0" },
    lines: [
      "Shine and colour. Two different things, and the sheet marks them apart.",
      `Shine is a ladder of ${TOP_TIER + 1} rungs: ordinary, four tints, and the true shiny at the top. Each rung multiplies every stat a little, and the top of the ladder is ${shinyPercent} percent — about ten points on a stat of a hundred and twenty, which is one good nature's worth. Worth hunting. Never the only thing that matters.`,
      "Colour is a chroma: one of eight or none, and a sidegrade rather than a step up. Two stats lifted hard, one dropped, the rest left alone. A colour suggests a team; it does not make a creature better than the one you had.",
      "Any rung can wear any colour. That is the whole census, and the header counts how many of it you have seen.",
    ],
  },
];
