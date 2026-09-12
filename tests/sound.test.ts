import { describe, expect, it } from "vitest";
import { resolveTurn, startBattle, type BattleEvent } from "@/engine/battle";
import { beatsFor, catchFor } from "@/lib/beats";
import { cuesFor } from "@/lib/sound";
import { creature } from "./helpers";

/**
 * Sound cues are derived from the turn's events and timed off its beats, so
 * what these check is that the right moments make a sound and that they are
 * in the order the turn happened.
 */

const SEED = "SOUND1";
const TAG = "wild:test:0";

describe("sound cues", () => {
  it("S1: a hit sounds when the sprite flinches, and a turn of nothing is silent", () => {
    const ours = creature("rattata", { level: 50, moves: ["tackle"] });
    const theirs = creature("machop", { level: 50, moves: ["splash"], uid: 2 });
    const played = resolveTurn(startBattle(SEED, TAG, [ours], [theirs]), [{ t: "fight", moveIndex: 0 }, { t: "fight", moveIndex: 0 }]).battle;
    const beats = beatsFor(played.events);
    const cues = cuesFor(played.events, beats);

    const hit = cues.find((cue) => cue.cue === "hit" || cue.cue === "crit");
    expect(hit).toBeDefined();
    expect(hit!.at).toBe(beats[1].hitAt);

    expect(cuesFor([], beatsFor([]))).toEqual([]);
  });

  it("S2: a faint, a catch and a level each make their own cue, once, in order", () => {
    const events: BattleEvent[] = [
      { t: "use", side: 0, moveId: "tackle" },
      { t: "damage", side: 1, amount: 12, quarters: 4, crit: true },
      { t: "faint", side: 1 },
      { t: "exp", amount: 50, levels: 2, uid: 1, learned: [], offered: [], evolved: null, evolvedFrom: null },
    ];
    const cues = cuesFor(events, beatsFor(events));
    expect(cues.map((cue) => cue.cue)).toEqual(["crit", "faint", "levelup"]);
    for (let at = 1; at < cues.length; at++) expect(cues[at].at).toBeGreaterThanOrEqual(cues[at - 1].at);

    const caught: BattleEvent[] = [{ t: "caught" }];
    expect(cuesFor(caught, beatsFor(caught)).map((cue) => cue.cue)).toEqual(["catch"]);
  });

  it("S3: a miss is the other one's dodge, and a hit for nothing is not a hit", () => {
    const events: BattleEvent[] = [
      { t: "use", side: 0, moveId: "tackle" },
      { t: "miss", side: 0 },
      { t: "use", side: 1, moveId: "tackle" },
      { t: "damage", side: 0, amount: 0, quarters: 4, crit: false },
    ];
    const beats = beatsFor(events);
    const cues = cuesFor(events, beats);
    expect(cues.map((cue) => cue.cue)).toEqual(["miss"]);
    expect(cues[0].at).toBe(beats[1].dodgeAt);
  });

  it("S4: a ball is a toss, a tick per wobble, and then the chime or the puff", () => {
    const caught: BattleEvent[] = [{ t: "caught" }];
    const attempt = catchFor(caught, 3)!;
    const cues = cuesFor(caught, beatsFor(caught), attempt);
    expect(cues.map((cue) => cue.cue)).toEqual(["throw", "wobble", "wobble", "wobble", "catch"]);
    expect(cues[cues.length - 1].at).toBe(attempt.endAt);

    const escaped: BattleEvent[] = [{ t: "catchFailed" }, { t: "use", side: 1, moveId: "tackle" }, { t: "damage", side: 0, amount: 4, quarters: 4, crit: false }];
    const away = catchFor(escaped, 1)!;
    const later = cuesFor(escaped, beatsFor(escaped, away.length), away);
    expect(later.filter((cue) => cue.cue === "wobble")).toHaveLength(away.wobbles);
    expect(later.find((cue) => cue.cue === "poof")?.at).toBe(away.endAt);
    // And the tackle that answers it sounds after the smoke.
    expect(later.find((cue) => cue.cue === "hit")!.at).toBeGreaterThan(away.endAt);
  });
});
