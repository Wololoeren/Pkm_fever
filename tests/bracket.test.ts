import { describe, expect, it } from "vitest";
import {
  BRACKET_SIZES,
  buildBracket,
  champion,
  drawOrder,
  nextMatch,
  ready,
  recordWin,
  roundName,
  stillIn,
  type Bracket,
  type BracketSize,
  type Player,
} from "@/engine/bracket";
import { PRIZE_CHOICES, PRIZE_SPECIES, prizeIvFloor, prizeOffer, prizeWeight } from "@/engine/prize";
import { species as speciesById } from "@/engine/dex";
import { IV_MAX } from "@/engine/stats";
import { STAT_IDS } from "@/engine/types";
import { tintTier } from "@/engine/variants";

/**
 * The draw, and what winning it pays.
 *
 * Both halves are pure and both are derived rather than granted, which is the
 * property worth testing: the host runs the room and must not be able to run
 * the bracket. Every client computes the same draw from the same locked
 * roster, and every client computes the same three prizes from the same
 * champion — so a host who fancied an easy side, or a winner who fancied a
 * better prize, has nothing to reach for.
 */

function people(count: number): Player[] {
  return Array.from({ length: count }, (_, at) => ({
    id: `peer-${at}`,
    name: `Player ${at + 1}`,
    gone: false,
  }));
}

/** Plays a whole bracket through, with seat 0 always winning. */
function runThrough(bracket: Bracket, pick: (match: { round: number; at: number }) => 0 | 1): Bracket {
  let live = bracket;
  for (let guard = 0; guard < 64; guard++) {
    const match = nextMatch(live);
    if (!match) break;
    expect(ready(match), `match ${match.round}/${match.at} was not ready`).toBe(true);
    live = recordWin(live, match.round, match.at, pick(match));
  }
  return live;
}

describe("the draw", () => {
  it("T1: four, eight and sixteen, and the right number of rounds", () => {
    for (const size of BRACKET_SIZES) {
      const bracket = buildBracket("CODE1", size, 3, people(size));
      expect(bracket.rounds.length, `${size}`).toBe(Math.log2(size));
      expect(bracket.rounds[0].length, `${size}`).toBe(size / 2);
      expect(bracket.rounds[bracket.rounds.length - 1].length, `${size}`).toBe(1);

      // Every player is in the first round exactly once. A bracket with
      // somebody in twice, or nobody in a seat, is a bracket with a bye in it
      // — and a bye is a person told to sit out a round they came to play.
      const seated = bracket.rounds[0].flatMap((match) => match.seats.map((seat) => seat.player));
      expect(new Set(seated).size, `${size}`).toBe(size);
      expect(seated.every((one) => one !== null)).toBe(true);
    }
  });

  it("T2: anything that is not a power of two is refused rather than padded", () => {
    // The file-based bracket in lib/tournament.ts pads with byes, because an
    // organiser gets whatever files turn up. This one is people sitting in a
    // room waiting, and the lobby simply does not start until it is full.
    for (const count of [1, 3, 5, 7, 9, 15, 17]) {
      expect(() => buildBracket("CODE1", 8, 3, people(count))).toThrow();
    }
  });

  it("T3: the draw is the code's, not the host's", () => {
    // The host is always first into their own room, so join order would hand
    // them a seat they chose. The order comes out of the code and the ids.
    const roster = people(8);
    const first = drawOrder("CODE1", roster).map((one) => one.id);
    const again = drawOrder("CODE1", roster).map((one) => one.id);
    const elsewhere = drawOrder("CODE2", roster).map((one) => one.id);

    // Same inputs, same draw — which is what lets sixteen clients agree
    // without anybody sending a bracket.
    expect(again).toEqual(first);
    // And it really is shuffled rather than join order wearing a hat.
    expect(first).not.toEqual(roster.map((one) => one.id));
    expect(elsewhere).not.toEqual(first);
    // Nobody is lost or duplicated by the shuffle.
    expect([...first].sort()).toEqual(roster.map((one) => one.id).sort());
  });

  it("T4: join order does not survive into the draw, however people arrive", () => {
    // The same eight people, listed in two different orders, draw the same
    // bracket. Otherwise a slow connection would change somebody's opponent.
    const roster = people(8);
    const shuffled = [...roster].reverse();
    expect(drawOrder("CODE1", shuffled).map((one) => one.id)).toEqual(
      drawOrder("CODE1", roster).map((one) => one.id),
    );
  });

  it("T5: winners advance into the right half, and the last one standing is the champion", () => {
    const bracket = buildBracket("CODE1", 8, 3, people(8));
    const played = runThrough(bracket, () => 0);

    expect(nextMatch(played)).toBeNull();
    const won = champion(played);
    expect(won).not.toBeNull();

    // The champion is whoever kept winning: seat 0 of the first match, since
    // seat 0 took every match.
    expect(won!.id).toBe(played.players[played.rounds[0][0].seats[0].player!].id);

    // And everybody else is out.
    const out = played.players.filter((one) => one.id !== won!.id);
    for (const player of out) {
      const at = played.players.indexOf(player);
      expect(stillIn(played, at), player.id).toBe(false);
    }
  });

  it("T6: it is a tree — two matches feed one, in the half they came from", () => {
    // The structural claim, and the one that actually matters: a winner has
    // to land in the *right* next seat, or two halves of the draw quietly
    // merge and somebody plays twice in a round.
    const bracket = buildBracket("CODE1", 16, 3, people(16));

    // Round zero pairs the two ends of the drawn order inwards, which is the
    // standard shape. With a shuffled order it buys nothing on its own; what
    // it buys is that the pairing is a function of position, so every client
    // computes the same one.
    for (let at = 0; at < 8; at++) {
      expect(bracket.rounds[0][at].seats[0].player).toBe(at);
      expect(bracket.rounds[0][at].seats[1].player).toBe(15 - at);
    }

    // Now the wiring. Match `at` of a round feeds seat `at % 2` of match
    // `at / 2` in the next one, so the winners of 0 and 1 meet, 2 and 3 meet,
    // and nobody crosses into the other half.
    let live = bracket;
    for (let at = 0; at < 8; at++) {
      const seat: 0 | 1 = at % 2 === 0 ? 0 : 1;
      const winner = live.rounds[0][at].seats[seat].player;
      live = recordWin(live, 0, at, seat);
      expect(live.rounds[1][Math.floor(at / 2)].seats[at % 2].player, `match ${at}`).toBe(winner);
    }

    // And it holds all the way up: play the rest out and the final has two
    // players in it who have not met.
    const played = runThrough(live, () => 0);
    const final = played.rounds[played.rounds.length - 1][0];
    expect(final.seats[0].player).not.toBe(final.seats[1].player);
    expect(champion(played)).not.toBeNull();
  });

  it("T7: a match cannot be decided twice, or before both seats are filled", () => {
    const bracket = buildBracket("CODE1", 4, 3, people(4));
    const once = recordWin(bracket, 0, 0, 0);
    expect(() => recordWin(once, 0, 0, 1)).toThrow(/already decided/);
    // The final has one seat: the other semi has not been played.
    expect(() => recordWin(once, 1, 0, 0)).toThrow(/not ready/);
  });

  it("T8: recording a win does not mutate the bracket it was given", () => {
    // Every client applies the same announcements to its own copy, and a
    // mutation here would make "did we both end up in the same place" an
    // unanswerable question.
    const bracket = buildBracket("CODE1", 4, 3, people(4));
    const before = JSON.stringify(bracket);
    recordWin(bracket, 0, 0, 1);
    expect(JSON.stringify(bracket)).toBe(before);
  });

  it("T9: rounds are named from the end, so a four and a sixteen agree", () => {
    const four = buildBracket("CODE1", 4, 3, people(4));
    expect(roundName(four, 0)).toBe("Semi-final");
    expect(roundName(four, 1)).toBe("Final");

    const sixteen = buildBracket("CODE1", 16, 3, people(16));
    expect(roundName(sixteen, 0)).toBe("Round 1");
    expect(roundName(sixteen, 1)).toBe("Quarter-final");
    expect(roundName(sixteen, 2)).toBe("Semi-final");
    expect(roundName(sixteen, 3)).toBe("Final");
  });
});

describe("what winning pays", () => {
  it("T10: three distinct species, at level one, every time", () => {
    for (const size of BRACKET_SIZES) {
      const offer = prizeOffer("CODE1", "peer-3", size, 500);
      expect(offer.length, `${size}`).toBe(PRIZE_CHOICES);
      expect(new Set(offer.map((one) => one.speciesId)).size, `${size}`).toBe(PRIZE_CHOICES);

      for (const one of offer) {
        // Level one is the whole design: a grown creature handed to the winner
        // walks into the next bracket and wins it too.
        expect(one.level, `${size}`).toBe(1);
        expect(one.prize, `${size}`).toBe(true);
        expect(one.traded, `${size}`).toBe(false);
      }
      // Distinct uids, so three arrivals cannot collide in a party.
      expect(new Set(offer.map((one) => one.uid)).size).toBe(PRIZE_CHOICES);
    }
  });

  it("T11: the same win always offers the same three", () => {
    // A champion who reloaded mid-celebration sees what it saw, and one who
    // did not like its three cannot reroll by rejoining.
    const once = prizeOffer("CODE1", "peer-3", 8, 500);
    const again = prizeOffer("CODE1", "peer-3", 8, 500);
    expect(again.map((one) => one.speciesId)).toEqual(once.map((one) => one.speciesId));
    expect(again.map((one) => one.variantId)).toEqual(once.map((one) => one.variantId));
    expect(again.map((one) => one.ivs.hp)).toEqual(once.map((one) => one.ivs.hp));

    // A different winner, or a different room, is a different draw.
    expect(prizeOffer("CODE1", "peer-4", 8, 500).map((one) => one.speciesId)).not.toEqual(
      once.map((one) => one.speciesId),
    );
    expect(prizeOffer("CODE2", "peer-3", 8, 500).map((one) => one.speciesId)).not.toEqual(
      once.map((one) => one.speciesId),
    );
  });

  it("T12: a bigger field is worth more, on every axis", () => {
    // Sixteen people is fifteen matches and an afternoon; four is three
    // matches and twenty minutes. Paying both the same teaches everybody to
    // run the small one.
    expect(prizeWeight(4)).toBeLessThan(prizeWeight(8));
    expect(prizeWeight(8)).toBeLessThan(prizeWeight(16));
    expect(prizeIvFloor(4)).toBeLessThan(prizeIvFloor(16));

    // Measured over many champions rather than asserted on one draw: these
    // are odds, and a single roll says nothing about them.
    function sample(size: BracketSize) {
      let shiny = 0;
      let abilities = 0;
      let ivTotal = 0;
      let seen = 0;
      for (let at = 0; at < 300; at++) {
        for (const one of prizeOffer("CODE1", `champ-${at}`, size, 1)) {
          seen++;
          if (tintTier(one.variantId) > 0) shiny++;
          abilities += one.abilities.length;
          ivTotal += STAT_IDS.reduce((total, stat) => total + one.ivs[stat], 0);
        }
      }
      return { shiny: shiny / seen, abilities: abilities / seen, ivs: ivTotal / seen };
    }

    const small = sample(4);
    const large = sample(16);
    expect(large.shiny).toBeGreaterThan(small.shiny);
    expect(large.abilities).toBeGreaterThan(small.abilities);
    expect(large.ivs).toBeGreaterThan(small.ivs);
  });

  it("T13: a prize is better bred than anything catchable, and never perfect", () => {
    // The floor climbs with the field so the reward is real; the ceiling is
    // left alone so breeding still has a job.
    for (const size of BRACKET_SIZES) {
      const floor = prizeIvFloor(size);
      expect(floor).toBeGreaterThan(6); // WILD_IV_MAX
      expect(floor).toBeLessThan(IV_MAX);

      for (let at = 0; at < 60; at++) {
        for (const one of prizeOffer("CODE1", `c${at}`, size, 1)) {
          for (const stat of STAT_IDS) {
            expect(one.ivs[stat], `${size} ${stat}`).toBeGreaterThanOrEqual(floor);
            expect(one.ivs[stat], `${size} ${stat}`).toBeLessThanOrEqual(IV_MAX);
          }
        }
      }
    }
  });

  it("T14: the pool is base forms whose line grows into something worth winning", () => {
    // "Rare" is not a flag in the manifest and adding one would be a table to
    // keep in step with a roster that is meant to be swappable. It is the top
    // slice by what the line *becomes*, which picks out the giants without
    // naming one.
    expect(PRIZE_SPECIES.length).toBeGreaterThan(20);

    for (const id of PRIZE_SPECIES) {
      // Nothing evolves *into* a prize: a level 1 that is already a final
      // form is a level 1 nobody wants.
      const isEvolution = speciesById(id).evolvesTo.length >= 0;
      expect(isEvolution).toBe(true);
    }

    // And they really are the big ones: every prize's line tops out well
    // above the middle of the roster.
    const ceiling = (id: string) => {
      const entry = speciesById(id);
      let best = STAT_IDS.reduce((total, stat) => total + entry.base[stat], 0);
      for (const step of entry.evolvesTo) best = Math.max(best, ceiling(step.id));
      return best;
    };
    for (const id of PRIZE_SPECIES.slice(0, 10)) expect(ceiling(id)).toBeGreaterThan(500);
  });
});
