import { describe, expect, it } from "vitest";
import { battleHash, type BattleAction } from "@/engine/battle";
import {
  canonicalAction,
  commitTo,
  deriveBattleSeed,
  DuelSession,
  verifyCommit,
  type DuelMessage,
} from "@/engine/duel";
import type { Individual } from "@/engine/types";
import { creature } from "./helpers";

/**
 * The duel protocol.
 *
 * Everything here exists because there is no server and no referee: the two
 * players are the only participants, either of them could be running modified
 * code, and the rules still have to hold. These tests are the argument that
 * they do.
 */

/** Deterministic nonces, so a failure is reproducible. */
function nonces(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

function team(uidBase: number): Individual[] {
  return [
    creature("machop", { uid: uidBase + 1, level: 30, moves: ["tackle", "lowkick"] }),
    creature("squirtle", { uid: uidBase + 2, level: 30, moves: ["tackle", "bubble"] }),
  ];
}

/** Two sessions wired to each other, with no network in between. */
function connect(a0 = team(100), b0 = team(200)) {
  const bus: Array<["a" | "b", DuelMessage]> = [];
  const a = new DuelSession(a0, (message) => bus.push(["b", message]), nonces("a"));
  const b = new DuelSession(b0, (message) => bus.push(["a", message]), nonces("b"));

  async function pump() {
    let guard = 0;
    while (bus.length && guard++ < 200) {
      const [to, message] = bus.shift()!;
      await (to === "a" ? a : b).receive(message);
    }
  }

  return { a, b, pump, bus };
}

describe("commitments", () => {
  it("D1: a commitment gives nothing away", async () => {
    // The whole point: what travels first must not distinguish one move from
    // another, or the second player simply reads it and counters.
    const nonce = "fixed-nonce";
    const one = await commitTo({ t: "fight", moveIndex: 0 }, nonce);
    const two = await commitTo({ t: "fight", moveIndex: 1 }, nonce);

    expect(one).not.toBe(two);
    expect(one).toHaveLength(64);
    expect(one).not.toContain("fight");
  });

  it("D2: a reveal that does not match its commitment is rejected", async () => {
    const nonce = "n";
    const commit = await commitTo({ t: "fight", moveIndex: 0 }, nonce);

    expect(await verifyCommit(commit, { t: "fight", moveIndex: 0 }, nonce)).toBe(true);
    // Swapping the move after committing to it.
    expect(await verifyCommit(commit, { t: "fight", moveIndex: 1 }, nonce)).toBe(false);
    // Or keeping the move and inventing a nonce that fits.
    expect(await verifyCommit(commit, { t: "fight", moveIndex: 0 }, "other")).toBe(false);
  });

  it("D3: an action serialises the same however it was built", async () => {
    // Two clients that constructed the object differently must hash the same
    // bytes, or they will accuse each other of cheating on turn one.
    const built: BattleAction = { t: "fight", moveIndex: 2 };
    const reversed = { moveIndex: 2, t: "fight" } as BattleAction;
    expect(canonicalAction(reversed)).toBe(canonicalAction(built));
    expect(await commitTo(reversed, "n")).toBe(await commitTo(built, "n"));
  });
});

describe("the battle seed", () => {
  it("D4: both nonces move it, so neither player owns the dice", async () => {
    const base = await deriveBattleSeed("a", "b");
    expect(await deriveBattleSeed("a2", "b")).not.toBe(base);
    expect(await deriveBattleSeed("a", "b2")).not.toBe(base);
  });

  it("D5: it does not depend on who is called first", async () => {
    expect(await deriveBattleSeed("alpha", "beta")).toBe(await deriveBattleSeed("beta", "alpha"));
  });

  it("D6: choosing a nonce is choosing blind", async () => {
    // Each side commits before either reveals, so a player picking a nonce
    // cannot know what it will be combined with. Sampling many of their
    // choices against a fixed one of ours gives no repeats to steer towards.
    const seeds = new Set<string>();
    for (let i = 0; i < 40; i++) seeds.add(await deriveBattleSeed("ours", `theirs-${i}`));
    expect(seeds.size).toBe(40);
  });
});

describe("a whole duel", () => {
  it("D7: two peers play it out and agree on every turn", async () => {
    const { a, b, pump } = connect();

    await a.open();
    await b.open();
    await pump();

    expect(a.view().phase).toBe("choosing");
    expect(b.view().phase).toBe("choosing");
    // Both derived the same seed from the two openings.
    expect(a.view().battle!.seed).toBe(b.view().battle!.seed);

    for (let turn = 0; turn < 30; turn++) {
      if (a.view().phase === "over" || b.view().phase === "over") break;

      // Each session drives its *own* side, which is not necessarily side 0 —
      // the roles come from the nonces, and reading sides[0] here regardless
      // sends a fight when a replacement was owed.
      const act = (session: DuelSession): BattleAction => {
        const { battle, role } = session.view();
        return battle!.awaitingSwitch[role!]
          ? { t: "switch", partyIndex: battle!.sides[role!].team.findIndex((c) => c.hp > 0) }
          : { t: "fight", moveIndex: turn % 2 };
      };

      await a.choose(act(a));
      await b.choose(act(b));
      await pump();
    }

    // Neither side found a fault, and both agree about what happened.
    expect(a.view().fault).toBeNull();
    expect(b.view().fault).toBeNull();
    expect(battleHash(a.view().battle!)).toBe(battleHash(b.view().battle!));
    expect(a.view().battle!.outcome).not.toBeNull();
  });

  it("D8: both peers hold the identical battle, and know which side they are", async () => {
    const { a, b, pump } = connect();
    await a.open();
    await b.open();
    await pump();

    // Each player is side 0 in its own view, so a wins iff b loses.
    await a.choose({ t: "fight", moveIndex: 0 });
    await b.choose({ t: "fight", moveIndex: 0 });
    await pump();

    const fromA = a.view().battle!;
    const fromB = b.view().battle!;
    // One orientation, agreed by both, with the roles decided by the nonces.
    expect(battleHash(fromA)).toBe(battleHash(fromB));
    expect(a.view().role).not.toBe(b.view().role);
    expect(fromA.sides[a.view().role!].team[0].uid).toBe(101);
    expect(fromB.sides[b.view().role!].team[0].uid).toBe(201);
  });

  it("D9: a client running different rules desyncs instead of winning", async () => {
    const { a, b, pump } = connect();
    await a.open();
    await b.open();
    await pump();

    await a.choose({ t: "fight", moveIndex: 0 });
    await b.choose({ t: "fight", moveIndex: 0 });
    await pump();

    // Whatever a cheat did locally, the hash it reports will not match what an
    // honest peer computed for the same turn.
    await a.receive({ t: "check", turn: 1, hash: "deadbeef" });
    expect(a.view().fault).toEqual({
      t: "desync",
      turn: 1,
      ours: expect.any(String),
      theirs: "deadbeef",
    });
    expect(a.view().phase).toBe("over");
  });

  it("D10: a forged reveal ends the duel rather than being played", async () => {
    const { a, b, pump } = connect();
    await a.open();
    await b.open();
    await pump();

    await a.choose({ t: "fight", moveIndex: 0 });
    await pump();

    // A reveal that does not hash to the commitment already sent.
    await a.receive({ t: "reveal", turn: 1, action: { t: "fight", moveIndex: 1 }, nonce: "made-up" });
    expect(a.view().fault).toEqual({ t: "badReveal", side: 1 });
    expect(a.view().phase).toBe("over");
  });

  it("D11: a forged opening is caught before the battle starts", async () => {
    const { a } = connect();
    await a.open();

    await a.receive({ t: "hello", team: team(300), commit: "not-a-real-commitment" });
    await a.receive({ t: "openReveal", nonce: "anything" });

    expect(a.view().fault).toEqual({ t: "badReveal", side: 1 });
    expect(a.view().battle).toBeNull();
  });

  it("D12: you cannot choose twice in a turn", async () => {
    const { a, b, pump } = connect();
    await a.open();
    await b.open();
    await pump();

    await a.choose({ t: "fight", moveIndex: 0 });
    await expect(a.choose({ t: "fight", moveIndex: 1 })).rejects.toThrow();
  });

  it("D13: resigning ends it for both", async () => {
    const { a, b, pump } = connect();
    await a.open();
    await b.open();
    await pump();

    a.resign();
    await pump();

    expect(a.view().phase).toBe("over");
    expect(b.view().phase).toBe("over");
    expect(b.view().fault).toEqual({ t: "resigned", side: 1 });
  });
});
