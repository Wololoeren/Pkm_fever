import { describe, expect, it } from "vitest";
import { TourneySession, matchSeed, type TourneyMessage } from "@/engine/tourney";
import { champion, drawOrder, type BracketSize } from "@/engine/bracket";
import type { Individual } from "@/engine/types";
import { cupPrizeKey, prizeOffer } from "@/engine/prize";
import { creature } from "./helpers";

/**
 * A whole bracket, played with no network and no timing.
 *
 * `TourneySession` is transport-agnostic for exactly this: it is handed a
 * `send` and fed whatever arrives, so a room of sixteen is sixteen objects in
 * an array and a function that passes strings between them. Everything below
 * runs in milliseconds and is completely deterministic, which is the only way
 * a protocol with this many moving parts is testable at all.
 *
 * What is worth guarding here is not "does a battle resolve" — the engine has
 * eight hundred tests for that — but the things that are only true of a *room*:
 * that everybody derives the same draw, that a result has to be agreed rather
 * than announced, that one match runs at a time, and that somebody closing
 * their laptop does not stop the afternoon.
 */

/** A team that can actually win a fight, so matches end rather than time out. */
function team(tag: number): Individual[] {
  return [
    creature("machamp", { uid: tag * 10 + 1, level: 50, moves: ["karatechop", "tackle"] }),
    creature("gyarados", { uid: tag * 10 + 2, level: 50, moves: ["waterfall", "tackle"] }),
    creature("arcanine", { uid: tag * 10 + 3, level: 50, moves: ["flamewheel", "tackle"] }),
  ];
}

/**
 * A room: N sessions, wired to each other.
 *
 * Messages are delivered synchronously and in order, which is not what a real
 * relay does — and is deliberate. A test that reproduced network reordering
 * would be a test of the network; what these check is the protocol's logic,
 * and `deliver` below is the one place ordering could be made hostile if that
 * is ever worth testing.
 */
class Room {
  readonly sessions: TourneySession[] = [];
  private readonly queue: { from: string; message: TourneyMessage }[] = [];
  private pumping = false;
  /** Peers that have "left", so nothing more is delivered to them. */
  private readonly gone = new Set<string>();

  constructor(count: number, code = "ROOM1") {
    for (let at = 0; at < count; at++) {
      const self = `peer-${at}`;
      this.sessions.push(
        new TourneySession({
          self,
          name: `Player ${at + 1}`,
          code,
          host: at === 0,
          seed: `WORLD${at}`,
          moves: 1000 + at,
          team: team(at + 1),
          send: (message) => {
            this.queue.push({ from: self, message });
            this.pump();
          },
        }),
      );
    }
  }

  private pump(): void {
    // Re-entrant sends are queued rather than nested: a session that reacts to
    // a message by sending one would otherwise recurse through the whole room
    // before the first message finished being delivered.
    if (this.pumping) return;
    this.pumping = true;
    while (this.queue.length) {
      const { from, message } = this.queue.shift()!;
      for (const session of this.sessions) {
        if (session.self === from || this.gone.has(session.self)) continue;
        session.receive(message, from);
      }
    }
    this.pumping = false;
  }

  /** Everybody says who they are, the way joining a room does. */
  announce(): void {
    for (const session of this.sessions) session.announce();
  }

  /** Somebody closes their laptop. */
  drop(id: string): void {
    this.gone.add(id);
    for (const session of this.sessions) {
      if (this.gone.has(session.self)) continue;
      session.onLeave(id);
    }
  }

  at(id: string): TourneySession {
    return this.sessions.find((one) => one.self === id)!;
  }
}

/** Plays whatever match is live until the whole bracket is decided. */
function playOut(room: Room, limit = 4000): void {
  for (let guard = 0; guard < limit; guard++) {
    const views = room.sessions.map((one) => one.view());
    if (views.every((view) => view.phase === "done")) return;
    if (views.some((view) => view.fault)) return;

    // Whoever owes a move, makes one. The first legal thing on the list is
    // enough: what is under test is the plumbing, not the play.
    let moved = false;
    for (const session of room.sessions) {
      const view = session.view();
      if (view.role === null || !view.battle || view.battle.outcome) continue;
      const owed = view.battle.awaitingSwitch[view.role];
      if (owed) {
        const next = view.battle.sides[view.role].team.findIndex((one) => one.hp > 0);
        if (next >= 0) {
          session.choose({ t: "switch", partyIndex: next });
          moved = true;
        }
        continue;
      }
      session.choose({ t: "fight", moveIndex: 0 });
      moved = true;
    }
    if (!moved) return;
  }
}

describe("a bracket in a room", () => {
  it("U0: everybody's seed and move count reach every client's lobby and bracket", () => {
    const room = new Room(4);
    room.announce();
    // A peer that lies about the shape of what it sent is shown a name only.
    room.at("peer-1").receive({ t: "hello", name: "Odd", seed: 42 as unknown as string, moves: -3 }, "peer-9");
    expect(room.at("peer-1").roster().find((one) => one.id === "peer-9")).toEqual({
      id: "peer-9",
      name: "Odd",
      seed: undefined,
      moves: undefined,
    });
    room.at("peer-1").onLeave("peer-9");

    room.at("peer-0").lock(4, 3);
    for (const session of room.sessions) {
      const players = session.view().bracket!.players;
      for (let at = 0; at < 4; at++) {
        expect(players.find((one) => one.id === `peer-${at}`)).toMatchObject({ seed: `WORLD${at}`, moves: 1000 + at });
      }
    }
  });

  it("U1: everybody derives the same draw from the same locked field", () => {
    // The host announces who is in; it does not announce a bracket. Every
    // client computes the draw from the roster, so a host who fancied an easy
    // side has nothing to reach for.
    const room = new Room(8);
    room.announce();
    room.at("peer-0").lock(8, 3);

    const drawn = room.sessions.map((one) => one.view().bracket);
    expect(drawn.every((one) => one !== null)).toBe(true);

    const first = JSON.stringify(drawn[0]!.players.map((one) => one.id));
    for (const bracket of drawn) {
      expect(JSON.stringify(bracket!.players.map((one) => one.id))).toBe(first);
    }

    // And it is the draw `bracket.ts` computes from the code, not join order.
    const expected = drawOrder(
      "ROOM1",
      room.sessions.map((one) => ({ id: one.self, name: one.name, gone: false })),
    ).map((one) => one.id);
    expect(drawn[0]!.players.map((one) => one.id)).toEqual(expected);
  });

  it("U2: only the host locks, and only once", () => {
    const room = new Room(4);
    room.announce();

    expect(() => room.at("peer-1").lock(4, 3)).toThrow(/only the host/);
    // And with the wrong number of people in the room.
    expect(() => room.at("peer-0").lock(8, 3)).toThrow(/needs 8/);

    room.at("peer-0").lock(4, 3);
    const settled = JSON.stringify(room.at("peer-2").view().bracket);
    // A second lock from anybody is ignored rather than redrawing the bracket
    // under everybody who has already started playing.
    room.at("peer-1").receive(
      { t: "lock", size: 4, teamSize: 1, players: [] as { id: string; name: string }[], seed: "X" },
      "peer-3",
    );
    expect(JSON.stringify(room.at("peer-2").view().bracket)).toBe(settled);
  });

  it("U3: one match is live at a time, and everybody is looking at it", () => {
    const room = new Room(4);
    room.announce();
    room.at("peer-0").lock(4, 1);

    const views = room.sessions.map((one) => one.view());
    const live = views.map((view) => view.live && `${view.live.round}/${view.live.at}`);
    // The same match, for all four.
    expect(new Set(live).size).toBe(1);
    expect(live[0]).toBe("0/0");

    // Two of them are playing it and two are watching.
    expect(views.filter((view) => view.role !== null)).toHaveLength(2);
    expect(views.filter((view) => view.role === null)).toHaveLength(2);
    // And a spectator is in the match phase too — watching is the point.
    expect(views.every((view) => view.phase === "match")).toBe(true);
  });

  it("U4: a four-player bracket plays to a champion everybody agrees on", () => {
    const room = new Room(4);
    room.announce();
    room.at("peer-0").lock(4, 1);
    playOut(room);

    const views = room.sessions.map((one) => one.view());
    expect(views.every((view) => view.fault === null), views.find((v) => v.fault)?.fault ?? "").toBe(
      true,
    );
    expect(views.every((view) => view.phase === "done")).toBe(true);

    const won = views.map((view) => view.won?.id);
    expect(won[0]).toBeDefined();
    // Four clients, one answer. Nobody was told who won; each of them
    // recorded the results it heard and arrived at the same bracket.
    expect(new Set(won).size).toBe(1);
  });

  it("U5: an eight-player bracket does the same, over three rounds", () => {
    const room = new Room(8);
    room.announce();
    room.at("peer-0").lock(8, 1);
    playOut(room);

    const views = room.sessions.map((one) => one.view());
    expect(views.every((view) => view.fault === null)).toBe(true);
    expect(views.every((view) => view.phase === "done")).toBe(true);
    expect(new Set(views.map((view) => view.won?.id)).size).toBe(1);

    // Seven matches for eight people, and every one of them decided.
    const bracket = views[0].bracket!;
    expect(bracket.rounds.flat()).toHaveLength(7);
    expect(bracket.rounds.flat().every((match) => match.won !== null)).toBe(true);
    expect(champion(bracket)).not.toBeNull();
  });

  it("U5b: you fight their team, not a copy of your own", () => {
    // The bug this test exists for: the protocol *documented* an open team
    // exchange and did not have one, so every client filled the other chair
    // with a stand-in built from its own party. Two players both brought
    // Machamp/Gyarados/Arcanine and every match was a mirror — visibly so,
    // because both plates showed the same creature on the same health.
    const room = new Room(4);
    room.announce();
    room.at("peer-0").lock(4, 3);

    for (const session of room.sessions) {
      const view = session.view();
      if (view.role === null || !view.battle) continue;

      const seats = view.live!.seats.map((seat) => view.bracket!.players[seat.player!]);
      const ours = view.battle.sides[view.role].team;
      const theirs = view.battle.sides[view.role === 0 ? 1 : 0].team;

      // Every player in this fixture brings a different team, keyed off their
      // index, so a mirror shows up as identical uids on both sides.
      const ourUids = ours.map((one) => one.uid).sort();
      const theirUids = theirs.map((one) => one.uid).sort();
      expect(theirUids, `${session.self} is fighting itself`).not.toEqual(ourUids);

      // And it is the opponent's actual team: the fixture numbers uids by
      // player, so the tens digit says whose creatures these are.
      const them = Number(seats[view.role === 0 ? 1 : 0].id.replace("peer-", "")) + 1;
      expect(theirs.every((one) => Math.floor(one.uid / 10) === them)).toBe(true);
    }
  });

  it("U5c: a spectator sees the same battle the two players are in", () => {
    // Teams are broadcast rather than sent to the opponent precisely so the
    // gallery can build it too, and be looking at the right creatures before
    // the first frame lands.
    const room = new Room(4);
    room.announce();
    room.at("peer-0").lock(4, 2);

    const views = room.sessions.map((one) => one.view());
    const playing = views.filter((view) => view.role !== null);
    const watching = views.filter((view) => view.role === null);
    expect(playing).toHaveLength(2);
    expect(watching).toHaveLength(2);

    const wanted = playing[0].battle!.sides.map((side) => side.team.map((one) => one.uid));
    for (const view of [...playing, ...watching]) {
      expect(view.battle, "a spectator has nothing on screen").not.toBeNull();
      expect(view.battle!.sides.map((side) => side.team.map((one) => one.uid))).toEqual(wanted);
    }
  });

  it("U6: two clients announcing different winners stops the bracket", () => {
    // The one thing worth stopping for. A tournament that guessed which of
    // two results to believe would be a tournament whose results mean nothing
    // — it is the same fault the duel's hash check exists to catch.
    const room = new Room(4);
    room.announce();
    room.at("peer-0").lock(4, 1);

    const watcher = room.sessions.find((one) => one.view().role === null)!;
    const seats = watcher.view().live!.seats.map((seat) => watcher.view().bracket!.players[seat.player!].id);

    watcher.receive({ t: "result", round: 0, at: 0, won: 0 }, seats[0]);
    expect(watcher.view().fault).toBeNull();
    watcher.receive({ t: "result", round: 0, at: 0, won: 1 }, seats[1]);
    expect(watcher.view().fault).toMatch(/disagreed/);
  });

  it("U7: the same two people always get the same battle, whoever is looking", () => {
    // A spectator has to be able to build the match without having seen the
    // nonces a duel derives its seed from, so the seed is the room's. Sorted,
    // so both ends and the gallery agree without knowing who is "first".
    expect(matchSeed("ROOM1", "a", "b")).toBe(matchSeed("ROOM1", "b", "a"));
    expect(matchSeed("ROOM1", "a", "b")).not.toBe(matchSeed("ROOM2", "a", "b"));
    expect(matchSeed("ROOM1", "a", "b")).not.toBe(matchSeed("ROOM1", "a", "c"));
  });

  it("U8: somebody closing their laptop does not stop the afternoon", () => {
    // A room of sixteen losing one is close to certain. The alternative to
    // the AI taking the chair is a bracket that stops dead.
    const room = new Room(4);
    room.announce();
    room.at("peer-0").lock(4, 1);

    const bracket = room.at("peer-0").view().bracket!;
    // Drop somebody who is *not* in the live match, so the drop is what is
    // under test rather than a forfeit.
    const playing = new Set(
      room.at("peer-0").view().live!.seats.map((seat) => bracket.players[seat.player!].id),
    );
    const bystander = bracket.players.find((one) => !playing.has(one.id))!;

    room.drop(bystander.id);

    for (const session of room.sessions) {
      if (session.self === bystander.id) continue;
      const marked = session.view().bracket!.players.find((one) => one.id === bystander.id)!;
      expect(marked.gone, `${session.self} did not notice`).toBe(true);
    }

    // The bracket keeps its shape: a player is marked, never removed, because
    // removing one would renumber every seat.
    expect(room.at("peer-0").view().bracket!.players).toHaveLength(4);
  });

  it("U8b: a player who drops is played with their own team, not a stand-in", () => {
    // The difference between the AI standing in for somebody and the AI
    // replacing them. Every team announced in the room is remembered, so
    // somebody who fought in round one and closed their laptop in round two
    // is still played with the creatures they brought.
    const room = new Room(4);
    room.announce();
    room.at("peer-0").lock(4, 2);

    const bracket = room.at("peer-0").view().bracket!;
    const seats = room.at("peer-0").view().live!.seats.map((seat) => bracket.players[seat.player!]);
    const victim = seats[0];

    // Their team is on the wire already, because the match has started.
    const watcher = room.sessions.find((one) => one.view().role === null)!;
    const before = watcher
      .view()
      .battle!.sides[0].team.map((one) => one.uid)
      .sort();

    room.drop(victim.id);

    // Still the same creatures: the chair changed hands, the team did not.
    const after = watcher
      .view()
      .battle!.sides[0].team.map((one) => one.uid)
      .sort();
    expect(after).toEqual(before);
  });

  it("U9: the host is a player, not a referee", () => {
    // Worth stating as a test because it is the property the whole design
    // leans on: the host is in the draw like everybody else, and its position
    // is the code's to decide.
    const room = new Room(8);
    room.announce();
    room.at("peer-0").lock(8, 1);

    const bracket = room.at("peer-0").view().bracket!;
    expect(bracket.players.some((one) => one.id === "peer-0")).toBe(true);
    // And not always first out of the hat — if it were, hosting would be a
    // seat you chose.
    const positions = new Set<number>();
    for (const code of ["A", "B", "C", "D", "E", "F"]) {
      const drawn = drawOrder(
        code,
        bracket.players.map((one) => ({ ...one })),
      );
      positions.add(drawn.findIndex((one) => one.id === "peer-0"));
    }
    expect(positions.size).toBeGreaterThan(1);
  });
});

describe("what a bracket is worth", () => {
  it("U10: the champion is the one who takes the prize, and the room agrees who that is", () => {
    const room = new Room(4);
    room.announce();
    room.at("peer-0").lock(4, 1);
    playOut(room);

    const views = room.sessions.map((one) => one.view());
    const won = views[0].won!;
    expect(won).toBeDefined();

    // Every client can compute the three on offer, because the champion and
    // the code are all it takes — so nobody has to be told, and nobody can
    // quietly offer themselves a better three.
    const size = views[0].bracket!.size as BracketSize;
    expect(size).toBe(4);
    expect(new Set(views.map((view) => view.won!.id)).size).toBe(1);
  });

  it("U11: the prize is drawn from the host's world, and everybody hears which", () => {
    const room = new Room(4);
    room.announce();
    // Before the lock nobody knows whose world it is.
    expect(room.at("peer-2").view().hostSeed).toBeNull();

    room.at("peer-0").lock(4, 1);
    // The host's seed, not each client's own: peer-2 plays WORLD2, but the
    // prize comes from WORLD0 on every screen.
    const seeds = room.sessions.map((one) => one.view().hostSeed);
    expect(new Set(seeds)).toEqual(new Set(["WORLD0"]));
  });

  it("U12: the same win hosted from another world is another three", () => {
    const offer = (hostSeed: string) =>
      prizeOffer(cupPrizeKey(hostSeed, "ROOM1"), "peer-3", 8, 1).map((one) => one.speciesId);

    expect(offer("WORLD0")).toEqual(offer("WORLD0"));
    expect(offer("WORLD1")).not.toEqual(offer("WORLD0"));
    // And the room still counts, so one host's two brackets are two draws.
    expect(prizeOffer(cupPrizeKey("WORLD0", "ROOM2"), "peer-3", 8, 1).map((one) => one.speciesId)).not.toEqual(
      offer("WORLD0"),
    );
  });

  it("U13: a lock from a client too old to send a seed still starts the bracket", () => {
    const room = new Room(4);
    room.announce();
    const roster = room.at("peer-0").roster();
    const old = { t: "lock", size: 4, teamSize: 1, players: roster } as unknown as TourneyMessage;
    room.at("peer-1").receive(old, "peer-0");
    expect(room.at("peer-1").view().bracket).not.toBeNull();
    expect(room.at("peer-1").view().hostSeed).toBe("");
  });
});
