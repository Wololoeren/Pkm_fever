import type { BattleEvent, SideIndex } from "@/engine/battle";
import { beatLength, type Beat, type Catch } from "./beats";

/**
 * Sound, synthesised.
 *
 * There are no audio files. Every cue is a couple of oscillators and a gain
 * envelope, which is enough for a hit, a critical, a miss, a faint, a heal, a
 * catch and a level-up — the seven moments a battle has that a player feels
 * before they read. Synthesised rather than sampled for the same reason the
 * sprites are drawn: nothing to download, nothing to license, and a cue that
 * needs changing is a number.
 *
 * Timed off `beats.ts`, so a hit sounds when the sprite flinches rather than
 * when the turn arrives. That is the whole reason `cuesFor` takes the beats:
 * the animation already worked out when everything happens, and a second
 * clock would drift from the first.
 *
 * Display, like the narration and the animation, and kept out of the engine
 * for the same reason: a sound the state depended on would be a save that
 * broke when somebody retuned a chime.
 */

export type Cue = "hit" | "crit" | "miss" | "faint" | "heal" | "catch" | "levelup" | "throw" | "wobble" | "poof";

export interface TimedCue {
  /** Milliseconds from the top of the turn. */
  at: number;
  cue: Cue;
}

/** What a turn sounds like, in order. */
export function cuesFor(
  events: readonly BattleEvent[],
  beats: readonly [Beat, Beat],
  /** The ball, when one was thrown: a toss, a tick per wobble, then stars or smoke. */
  attempt: Catch | null = null,
): TimedCue[] {
  const out: TimedCue[] = [];
  const end = Math.max(beatLength(beats), attempt ? attempt.length : 0);
  const other = (side: SideIndex): SideIndex => (side === 0 ? 1 : 0);

  if (attempt) {
    out.push({ at: 0, cue: "throw" });
    for (const at of attempt.wobblesAt) out.push({ at, cue: "wobble" });
    out.push({ at: attempt.endAt, cue: attempt.outcome === "caught" ? "catch" : "poof" });
  }

  let levelled = false;
  for (const event of events) {
    switch (event.t) {
      case "damage":
        if (event.amount > 0) out.push({ at: beats[event.side].hitAt ?? 0, cue: event.crit ? "crit" : "hit" });
        break;
      case "miss":
        out.push({ at: beats[other(event.side)].dodgeAt ?? 0, cue: "miss" });
        break;
      case "faint":
        out.push({ at: beats[event.side].faintAt ?? end, cue: "faint" });
        break;
      case "heal":
        out.push({ at: beats[event.side].glowAt ?? 0, cue: "heal" });
        break;
      case "caught":
        // Timed off the ball when there is one, which there always is.
        if (!attempt) out.push({ at: end, cue: "catch" });
        break;
      case "exp":
        // Once, however many levels came at once: three chimes for three
        // levels is a jingle, and one is a fact.
        if (event.levels > 0 && !levelled) {
          out.push({ at: end + 120, cue: "levelup" });
          levelled = true;
        }
        break;
      default:
        break;
    }
  }

  return out.sort((a, b) => a.at - b.at);
}

// ------------------------------------------------------------------ playing

const MUTE_KEY = "pkm-fever.mute";

/** Whether the player has turned sound off. Off is remembered; on is the default. */
export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    if (muted) localStorage.setItem(MUTE_KEY, "1");
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    // A blocked store costs the preference, not the game.
  }
}

let context: AudioContext | null = null;

/**
 * The one AudioContext, made on first use.
 *
 * Browsers refuse to start audio before the page has been touched, so it is
 * created lazily and resumed every time — the first cue of a session lands on
 * the first turn the player *chose*, which is after a click by definition.
 */
function audio(): AudioContext | null {
  try {
    if (!context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      context = new Ctor();
    }
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    return null;
  }
}

/** One note: a waveform, a start pitch, an optional glide, a length and a loudness. */
function note(
  ctx: AudioContext,
  when: number,
  type: OscillatorType,
  from: number,
  to: number,
  length: number,
  gain: number,
): void {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, when);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, when + length);
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.exponentialRampToValueAtTime(gain, when + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, when + length);
  osc.connect(amp);
  amp.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + length + 0.02);
}

/** The seven cues, as notes. Loudness is kept low: these are punctuation. */
function sound(ctx: AudioContext, when: number, cue: Cue): void {
  switch (cue) {
    case "hit":
      note(ctx, when, "square", 180, 90, 0.09, 0.12);
      break;
    case "crit":
      note(ctx, when, "square", 260, 80, 0.14, 0.18);
      note(ctx, when + 0.03, "sawtooth", 120, 60, 0.12, 0.1);
      break;
    case "miss":
      note(ctx, when, "sine", 600, 900, 0.07, 0.06);
      break;
    case "faint":
      note(ctx, when, "sawtooth", 300, 55, 0.45, 0.12);
      break;
    case "heal":
      note(ctx, when, "sine", 523, 523, 0.08, 0.08);
      note(ctx, when + 0.09, "sine", 659, 659, 0.12, 0.08);
      break;
    case "catch":
      note(ctx, when, "triangle", 523, 523, 0.1, 0.1);
      note(ctx, when + 0.11, "triangle", 659, 659, 0.1, 0.1);
      note(ctx, when + 0.22, "triangle", 784, 784, 0.22, 0.1);
      break;
    case "levelup":
      note(ctx, when, "triangle", 392, 392, 0.09, 0.09);
      note(ctx, when + 0.1, "triangle", 523, 523, 0.09, 0.09);
      note(ctx, when + 0.2, "triangle", 659, 659, 0.09, 0.09);
      note(ctx, when + 0.3, "triangle", 784, 784, 0.25, 0.1);
      break;
    case "throw":
      note(ctx, when, "sine", 300, 700, 0.18, 0.05);
      break;
    case "wobble":
      note(ctx, when, "square", 140, 110, 0.05, 0.07);
      break;
    case "poof":
      note(ctx, when, "sawtooth", 220, 90, 0.2, 0.06);
      note(ctx, when + 0.02, "sine", 900, 300, 0.25, 0.04);
      break;
  }
}

/** Plays a turn's cues, unless the player has turned sound off. */
export function playCues(cues: readonly TimedCue[]): void {
  if (!cues.length || isMuted()) return;
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const { at, cue } of cues) sound(ctx, now + at / 1000, cue);
}
