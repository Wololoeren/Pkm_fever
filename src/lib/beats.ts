import { move as moveById, type MoveEntry } from "@/engine/dex";
import type { BattleEvent, SideIndex } from "@/engine/battle";

/**
 * What a turn looked like, for something to animate.
 *
 * The battle emits structured events and nothing else — no positions, no
 * timings, no words. `narrate.ts` turns them into sentences; this turns the
 * same list into motion, and it is deliberately the same shape of job. Both
 * are derived, both are display, and neither is allowed anywhere near the
 * state hash: an animation that a save depended on would be a save that broke
 * when somebody retimed a shake.
 *
 * ## Why it is sequenced rather than simultaneous
 *
 * Both sides move in one turn. Animating both at once reads as two things
 * happening to one creature, which is exactly what it is not: one of them
 * swung first and the other answered. The events are already in resolution
 * order, so the *order* is free — count the `use` events and each side's
 * position in that count is when it acted.
 *
 * Everything here is in milliseconds from the top of the turn, which is the
 * only unit the Web Animations API wants.
 */

/** How long one side's swing-and-answer takes, start to finish. */
export const BEAT_MS = 340;

/** How long the creature going back takes to walk off. */
export const SWITCH_OUT_MS = 320;
/** How long the ball takes to arc in and land. */
export const SWITCH_BALL_MS = 420;
/** How long the new creature takes to pop out of it. */
export const SWITCH_POP_MS = 280;
/** The whole switch, end to end. */
export const SWITCH_TOTAL_MS = SWITCH_OUT_MS + SWITCH_BALL_MS + SWITCH_POP_MS;

/** How long after a swing the blow lands on the other one. */
const IMPACT_DELAY = 110;

/*
 * A ball thrown.
 *
 * The engine decides a catch with one roll and says `caught` or
 * `catchFailed`; there is no shake count in the state and there must not be,
 * because a save that depended on how many times a ball wobbled would be a
 * save that broke when somebody retimed a wobble. So the wobbles are display:
 * three for a catch, as the games have always had it, and for an escape a
 * number read off the turn — the same turn always wobbles the same number of
 * times, which is all a replay needs.
 */

/** The ball's flight, and the settle after it lands. */
export const BALL_FLIGHT_MS = 520;
export const BALL_SETTLE_MS = 220;
/** One wobble, and the pause before the next. */
export const WOBBLE_MS = 420;
/** The stars, or the smoke. */
export const CATCH_TAIL_MS = 480;

export interface Catch {
  outcome: "caught" | "escaped";
  wobbles: number;
  /** When each wobble starts, from the top of the turn. */
  wobblesAt: number[];
  /** When the stars or the smoke start. */
  endAt: number;
  /** How long the whole thing runs. */
  length: number;
}

/** What the ball did this turn, or null if none was thrown. */
export function catchFor(events: readonly BattleEvent[], turn: number): Catch | null {
  const caught = events.some((event) => event.t === "caught");
  const failed = events.some((event) => event.t === "catchFailed");
  if (!caught && !failed) return null;

  // Three for a catch. One to three for an escape, by the turn, so a ball
  // that got away on turn four gets away the same way every time it is
  // watched — and a run of escapes does not all look the same.
  const wobbles = caught ? 3 : 1 + (turn % 3);
  const wobblesAt = Array.from({ length: wobbles }, (_, at) => BALL_FLIGHT_MS + BALL_SETTLE_MS + at * WOBBLE_MS);
  const endAt = BALL_FLIGHT_MS + BALL_SETTLE_MS + wobbles * WOBBLE_MS;
  return { outcome: caught ? "caught" : "escaped", wobbles, wobblesAt, endAt, length: endAt + CATCH_TAIL_MS };
}

/**
 * What happens to one creature this turn.
 *
 * Times are null for "not this turn" rather than 0, because 0 is a real time
 * — the first mover swings at 0 — and a falsy check would swallow it. That is
 * a bug worth naming once rather than finding twice.
 */
export interface Beat {
  /** It swung. */
  lungeAt: number | null;
  /** It was hit, and with what. `type` colours the flash. */
  hitAt: number | null;
  crit: boolean;
  type: string | null;
  /** It was missed, so it should slip aside rather than flinch. */
  dodgeAt: number | null;
  /** Something was put on it, or taken off: a status, a seed, a screen. */
  glowAt: number | null;
  /** It went down. */
  faintAt: number | null;
  /**
   * Every swing and every blow, in order. `lungeAt` and `hitAt` are the first
   * of each; these are all of them, so a move that lands three times swings
   * three times and shakes three times.
   */
  lunges: number[];
  hits: { at: number; crit: boolean; type: string | null; moveId: string | null }[];
}

/** A beat with nothing in it. A function, so no two beats share the lists. */
function nothing(): Beat {
  return {
    lungeAt: null,
    hitAt: null,
    crit: false,
    type: null,
    dodgeAt: null,
    glowAt: null,
    faintAt: null,
    lunges: [],
    hits: [],
  };
}

/**
 * The gap between blows of a move that lands more than once.
 *
 * Shorter than a whole beat, because five blows at a full beat apiece is
 * nearly two seconds of one creature punching; long enough that each shake
 * finishes before the next swing starts, so five read as five.
 */
export const BLOW_GAP_MS = 180;

/** A move that is a swing rather than a gesture. */
function swings(entry: MoveEntry): boolean {
  return entry.category !== "status";
}

/**
 * Reads one turn's events into one Beat per side.
 *
 * Indexed by `SideIndex`, so a caller asks for the side it is drawing rather
 * than translating "mine" and "theirs" — the battle is symmetric and this
 * should be too.
 *
 * Time is a running clock rather than a count of moves, because a move that
 * lands three times takes longer than one that lands once, and the answer to
 * it has to wait for the third blow.
 */
export function beatsFor(
  events: readonly BattleEvent[],
  /**
   * How long a ball that got away takes before the turn goes on. The wild
   * creature's answer to a failed throw comes after the smoke, not under the
   * ball, so everything after `catchFailed` is pushed back by this much.
   */
  catchShift = 0,
): [Beat, Beat] {
  const beats: [Beat, Beat] = [nothing(), nothing()];

  // Who is mid-swing, so the damage and misses that follow can be attributed
  // to it. A turn is a flat list; this is the only state needed to read it.
  let actor: SideIndex | null = null;
  let actorType: string | null = null;
  let actorMove: string | null = null;
  /** When the current move started, and how many of its blows have landed. */
  let started = 0;
  let blow = 0;
  let clock = 0;
  let shift = 0;

  const swing = (side: SideIndex, type: string, lunges: boolean, moveId: string | null) => {
    actor = side;
    actorType = type;
    actorMove = moveId;
    started = shift + clock;
    blow = 0;
    if (lunges) {
      beats[side].lunges.push(started);
      if (beats[side].lungeAt === null) beats[side].lungeAt = started;
    }
    clock += BEAT_MS;
  };

  for (const event of events) {
    switch (event.t) {
      case "catchFailed":
        shift = catchShift;
        break;

      case "use": {
        // A gesture still takes its place in the order, so a turn spent
        // raising a screen does not make the answer to it land early.
        const entry = moveById(event.moveId);
        swing(event.side, entry.type, swings(entry), entry.id);
        break;
      }
      case "struggling":
        swing(event.side, "normal", true, null);
        break;

      case "damage": {
        // `side` is whoever took it. Residuals — a burn, a seed — arrive with
        // no swing in front of them, and land at the end of the turn.
        const at = actor !== null && actor !== event.side ? actor : null;
        const beat = beats[event.side];
        let when: number;
        if (at === null) {
          when = shift + clock;
        } else {
          // The second blow onwards is its own swing, a gap after the last,
          // and it pushes everything after it back by that gap.
          when = started + blow * BLOW_GAP_MS;
          if (blow > 0) {
            beats[at].lunges.push(when);
            clock += BLOW_GAP_MS;
          }
          blow++;
        }
        const type = at === null ? beat.type : actorType;
        beat.hits.push({ at: when + IMPACT_DELAY, crit: event.crit, type, moveId: at === null ? null : actorMove });
        if (beat.hitAt === null) beat.hitAt = when + IMPACT_DELAY;
        beat.crit = beat.crit || event.crit;
        beat.type = type;
        break;
      }

      case "miss": {
        // `side` is whoever swung and missed, so it is the *other* one that
        // gets to slip aside — at the blow that missed, for a move whose later
        // blows can.
        const dodger: SideIndex = event.side === 0 ? 1 : 0;
        const when = actor === event.side ? started + blow * BLOW_GAP_MS : (beats[event.side].lungeAt ?? 0);
        beats[dodger].dodgeAt = when + IMPACT_DELAY;
        break;
      }

      case "status":
      case "volatile":
      case "screen":
      case "shielded":
      case "boost":
      case "aim":
      case "heal":
      case "transformed":
      case "hazardHit":
      case "itemMoved":
        beats[event.side].glowAt = (actor === null ? shift : started) + IMPACT_DELAY;
        break;

      case "switch":
        // A switch mid-turn plays out in full before anything that follows
        // it: otherwise a creature sent in and knocked out on the same turn
        // was hit, and went down, while it was still inside the ball — and
        // the pop-out drew over the faint, so it never appeared at all.
        clock += SWITCH_TOTAL_MS;
        break;

      case "faint":
        // Last, whatever else happened, because it is the end of that
        // creature's turn by definition.
        beats[event.side].faintAt = shift + Math.max(BEAT_MS, clock);
        break;

      default:
        break;
    }
  }

  return beats;
}

/** How long the whole turn's motion runs, so a caller can wait for it. */
export function beatLength(beats: readonly [Beat, Beat]): number {
  let last = 0;
  for (const beat of beats) {
    for (const at of [beat.lungeAt, beat.hitAt, beat.dodgeAt, beat.glowAt, beat.faintAt, ...beat.lunges, ...beat.hits.map((hit) => hit.at)]) {
      if (at !== null) last = Math.max(last, at);
    }
  }
  return last + BEAT_MS;
}
