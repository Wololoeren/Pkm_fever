"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BattleAction } from "@/engine/battle";
import { species as speciesById } from "@/engine/dex";
import { DuelSession, TEAM_SIZES, type DuelMessage, type DuelView, type TeamSize } from "@/engine/duel";
import { computeStats, ivTotal, IV_MAX } from "@/engine/stats";
import { TradeSession, type TradeMessage, type TradeView } from "@/engine/trade";
import { STAT_IDS, type Individual } from "@/engine/types";
import { displayName } from "@/lib/narrate";
import { anyFlags, flagsText, teamFlags } from "@/engine/integrity";
import { joinRoom, normaliseRoomCode, randomRoomCode, type Room, type RoomStatus } from "@/lib/room";
import { BattleView } from "./BattleView";
import { GenderMark, VariantTag } from "./PartyStrip";
import { Sprite } from "./Sprite";
import { TourneyScreen } from "./TourneyScreen";

/**
 * Playing against another person: a battle, or a trade.
 *
 * Both ride the same pairing — two browsers, a shared code, no server — and
 * everything that makes either of them safe lives in engine/duel.ts and
 * engine/trade.ts. This wires a session to a transport and to some buttons.
 * The protocols have no opinion about React, which is why they are testable
 * without a browser.
 */

type Mode = "battle" | "trade" | "tourney";

function CreatureRow({
  creature,
  picked,
  disabled,
  onClick,
}: {
  creature: Individual;
  picked?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const stats = computeStats(speciesById(creature.speciesId), creature);
  const body = (
    <>
      <Sprite speciesId={creature.speciesId} variantId={creature.variantId} abilities={creature.abilities} heldItem={creature.heldItem} size={48} />
      <div className="cardBody">
        <div className="cardTop">
          <strong>
            {displayName(creature)} <GenderMark gender={creature.gender} />
          </strong>
          <span className="muted">Lv{creature.level}</span>
        </div>
        <span className="muted ivNum">
          {STAT_IDS.map((stat) => stats[stat]).join(" / ")} · IV {ivTotal(creature.ivs)}/
          {IV_MAX * STAT_IDS.length}
        </span>
      </div>
      <VariantTag variantId={creature.variantId} />
      {creature.traded ? <span className="tag">TRADED</span> : null}
      {creature.prize ? <span className="tag">PRIZE</span> : null}
      {creature.cheat ? <span className="tag fall">CHEAT</span> : null}
    </>
  );

  if (!onClick) return <div className="boxRow">{body}</div>;
  return (
    <button
      type="button"
      className={`boxRow pick${picked ? " on" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {body}
      <span className="muted">{picked ? "✓" : ""}</span>
    </button>
  );
}

export function PvpScreen({
  roster,
  seed,
  moves,
  onExit,
  onTrade,
  onPrize,
}: {
  roster: Individual[];
  /** This save's world seed, which seeds a bracket's prize when we host it. */
  seed: string;
  /** How many moves into this save, which a bracket shows under our name. */
  moves: number;
  onExit: () => void;
  /** Applies a completed trade to the save. */
  onTrade: (giveUid: number, received: Individual) => void;
  /** Applies a won creature to the save. */
  onPrize: (creature: Individual) => void;
}) {
  const [mode, setMode] = useState<Mode>("battle");
  const [size, setSize] = useState<TeamSize>(3);
  const [chosen, setChosen] = useState<number[]>([]);
  const [code, setCode] = useState(() => randomRoomCode());
  const [status, setStatus] = useState<RoomStatus | null>(null);
  const [duel, setDuel] = useState<DuelView | null>(null);
  const [trade, setTrade] = useState<TradeView | null>(null);
  const [waitingOnThem, setWaitingOnThem] = useState(false);
  /** Whether the player has seen the warning about flagged teams and chosen to fight anyway. */
  const [acknowledged, setAcknowledged] = useState(false);

  const duelRef = useRef<DuelSession | null>(null);
  const tradeRef = useRef<TradeSession | null>(null);
  const roomRef = useRef<Room<DuelMessage | TradeMessage> | null>(null);
  const appliedRef = useRef(false);

  useEffect(
    () => () => {
      roomRef.current?.leave();
      roomRef.current = null;
    },
    [],
  );

  // A finished trade is applied to the save exactly once, however many times
  // React re-renders the view that reports it.
  useEffect(() => {
    if (!trade?.completed || appliedRef.current) return;
    appliedRef.current = true;
    onTrade(trade.completed.given.uid, trade.completed.received);
  }, [trade, onTrade]);

  const teamFrom = useCallback(
    (uids: number[]) =>
      uids
        .map((uid) => roster.find((creature) => creature.uid === uid))
        .filter((creature): creature is Individual => Boolean(creature)),
    [roster],
  );

  const connect = useCallback(async () => {
    const picked = teamFrom(chosen);
    if (!picked.length) return;

    const queue: (DuelMessage | TradeMessage)[] = [];
    const send = (message: DuelMessage | TradeMessage) => {
      const room = roomRef.current;
      // Messages produced before the room exists are held rather than lost:
      // the opening fires the moment the pairing lands.
      if (room) room.send(message);
      else queue.push(message);
    };

    if (mode === "battle") {
      const session = new DuelSession(picked, send as (m: DuelMessage) => void);
      duelRef.current = session;
    } else {
      const session = new TradeSession(send as (m: TradeMessage) => void);
      tradeRef.current = session;
    }

    const room = await joinRoom<DuelMessage | TradeMessage>(normaliseRoomCode(code), mode, {
      onStatus: setStatus,
      onMessage: async (message) => {
        if (mode === "battle") {
          const session = duelRef.current!;
          await session.receive(message as DuelMessage);
          const view = session.view();
          setWaitingOnThem(view.phase === "committed" || view.phase === "revealing");
          setDuel(view);
        } else {
          const session = tradeRef.current!;
          session.receive(message as TradeMessage);
          setTrade(session.view());
        }
      },
      onPeer: () => {
        if (mode === "battle") {
          void duelRef.current!.open().then(() => setDuel(duelRef.current!.view()));
        } else {
          // Put our offer up the moment somebody is there to see it.
          tradeRef.current!.offer(picked[0]);
          setTrade(tradeRef.current!.view());
        }
      },
    });

    roomRef.current = room;
    for (const message of queue) room.send(message);
  }, [chosen, code, mode, teamFrom]);

  const act = useCallback(async (action: BattleAction) => {
    const session = duelRef.current;
    if (!session) return;
    setWaitingOnThem(true);
    await session.choose(action);
    setDuel(session.view());
  }, []);

  const disconnect = useCallback(() => {
    roomRef.current?.leave();
    roomRef.current = null;
    duelRef.current = null;
    tradeRef.current = null;
    appliedRef.current = false;
    setStatus(null);
    setDuel(null);
    setTrade(null);
    setAcknowledged(false);
  }, []);

  // A bracket is its own screen. It shares the roster and the way out and
  // nothing else: a different transport (many peers rather than two), a
  // different protocol, and a shape — lobby, draw, watch, play — that has no
  // counterpart in a duel.
  if (mode === "tourney") {
    return <TourneyScreen roster={roster} seed={seed} moves={moves} onExit={onExit} onPrize={onPrize} />;
  }

  // ------------------------------------------------------------------ setup

  if (!status) {
    const need = mode === "battle" ? size : 1;
    return (
      <section className="hubCol duelSetup">
        <h2>PvP</h2>

        <div className="row">
          <button
            type="button"
            className={mode === "battle" ? "primary" : "ghost"}
            onClick={() => {
              setMode("battle");
              setChosen([]);
            }}
          >
            Battle
          </button>
          <button
            type="button"
            className={mode === "trade" ? "primary" : "ghost"}
            onClick={() => {
              setMode("trade");
              setChosen([]);
            }}
          >
            Trade
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setMode("tourney");
              setChosen([]);
            }}
          >
            Tournament
          </button>
        </div>

        {mode === "battle" ? (
          <>
            <h3>Format</h3>
            <div className="row">
              {TEAM_SIZES.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={n === size ? "primary" : "ghost"}
                  onClick={() => {
                    setSize(n);
                    setChosen((current) => current.slice(0, n));
                  }}
                >
                  {n}v{n}
                </button>
              ))}
            </div>
            <p className="muted">
              Both players must bring the same number, and the game says so rather than quietly
              trimming somebody&apos;s team. Teams are shown to your opponent in full — the open
              sheets competitive play uses — so there is no hidden state to leak. Moves are
              committed as hashes before either side reveals, and the dice come from both your
              nonces, so neither of you can read the other&apos;s choice or bias a critical hit.
            </p>
          </>
        ) : (
          <p className="muted">
            Pick one to offer. You will both see what is on the table before either of you agrees,
            and changing your offer withdraws both agreements. A creature that arrives this way is
            marked as traded: a save is a seed and your inputs, and a creature from somebody
            else&apos;s world is the one thing replaying yours cannot prove you earned.
          </p>
        )}

        <h3>
          {mode === "battle" ? `Your ${size}` : "What you are offering"} · {chosen.length}/{need}
        </h3>
        {roster.length ? (
          <div className="boxList scrolls">
            {roster.map((creature) => {
              const picked = chosen.includes(creature.uid);
              return (
                <CreatureRow
                  key={creature.uid}
                  creature={creature}
                  picked={picked}
                  disabled={!picked && chosen.length >= need}
                  onClick={() =>
                    setChosen((current) =>
                      current.includes(creature.uid)
                        ? current.filter((id) => id !== creature.uid)
                        : [...current, creature.uid],
                    )
                  }
                />
              );
            })}
          </div>
        ) : (
          <p className="error">Nothing to bring. Catch something first.</p>
        )}

        <h3>Room code</h3>
        <p className="muted">Both players type the same code. Anything you agree on works.</p>
        <div className="row">
          <input value={code} onChange={(event) => setCode(event.target.value)} aria-label="Room code" spellCheck={false} />
          <button type="button" className="ghost" onClick={() => setCode(randomRoomCode())}>
            Reroll
          </button>
          <button
            type="button"
            className="primary"
            disabled={chosen.length !== need}
            onClick={() => void connect()}
          >
            {mode === "battle" ? "Find opponent" : "Find partner"}
          </button>
          <button type="button" className="ghost" onClick={onExit}>
            Back
          </button>
        </div>
      </section>
    );
  }

  // ------------------------------------------------------------------ trade

  if (mode === "trade") {
    const view = trade;
    const done = view?.phase === "done";

    return (
      <section className="hubCol duelSetup">
        <h2>Trade · room {normaliseRoomCode(code)}</h2>
        <p className="muted">{connectionText(status)}</p>

        {view?.ours ? (
          <>
            <h3>You are offering</h3>
            <CreatureRow creature={view.ours} />
          </>
        ) : null}

        <h3>They are offering</h3>
        {view?.theirs ? (
          <CreatureRow creature={view.theirs} />
        ) : (
          <p className="muted">Nothing yet.</p>
        )}

        {done ? (
          <>
            <p className="good">Traded. {displayName(view!.completed!.received)} is yours.</p>
            <div className="row">
              <button type="button" className="primary" onClick={onExit}>
                Done
              </button>
            </div>
          </>
        ) : view?.phase === "cancelled" ? (
          <>
            <p className="error">The trade was called off.</p>
            <div className="row">
              <button type="button" className="ghost" onClick={disconnect}>
                Back
              </button>
            </div>
          </>
        ) : (
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={view?.phase !== "reviewing"}
              onClick={() => {
                tradeRef.current?.accept();
                setTrade(tradeRef.current!.view());
              }}
            >
              {view?.weAccepted ? "Waiting for them…" : "Accept"}
            </button>
            {view?.theyAccepted && !view.weAccepted ? (
              <span className="muted">They have accepted.</span>
            ) : null}
            <button
              type="button"
              className="ghost"
              onClick={() => {
                tradeRef.current?.cancel();
                setTrade(tradeRef.current!.view());
              }}
            >
              Call it off
            </button>
          </div>
        )}
      </section>
    );
  }

  // ----------------------------------------------------------------- battle

  const battle = duel?.battle;
  if (!battle) {
    return (
      <section className="hubCol duelSetup">
        <h2>Room {normaliseRoomCode(code)}</h2>
        <p className="muted">{connectionText(status)}</p>
        {duel?.fault ? <p className="error">{faultText(duel.fault)}</p> : null}
        <div className="row">
          <button type="button" className="ghost" onClick={disconnect}>
            Back
          </button>
        </div>
      </section>
    );
  }

  const over = duel?.phase === "over";
  const role = duel?.role ?? 0;

  /*
   * Before the first turn: who is bringing creatures a save cannot vouch for.
   *
   * Both teams arrive whole in the opening handshake, flags and all, so this
   * is known before either side has committed a move — and the opponent's
   * battle waits for our first commit, so holding here costs them nothing.
   */
  const ourFlags = teamFlags(battle.sides[role].team);
  const theirFlags = teamFlags(battle.sides[role === 0 ? 1 : 0].team);
  if (!acknowledged && !over && battle.turn === 0 && (anyFlags(ourFlags) || anyFlags(theirFlags))) {
    return (
      <section className="hubCol duelSetup">
        <h2>Before you battle</h2>
        {anyFlags(theirFlags) ? (
          <p className="warn">Your opponent is bringing {flagsText(theirFlags)}.</p>
        ) : (
          <p className="good">Your opponent&apos;s team is all their own.</p>
        )}
        {anyFlags(ourFlags) ? (
          <p className="warn">You are bringing {flagsText(ourFlags)} — they are seeing the same warning.</p>
        ) : null}
        <p className="muted">
          Cheated creatures were made or changed with the testing shortcuts. Vault creatures started a run as a copy
          from somebody&apos;s vault. Traded and prize creatures came from another world. The flags are what each
          client reports; the verify page is where a save proves them.
        </p>
        <div className="row">
          <button type="button" className="primary" onClick={() => setAcknowledged(true)}>
            Battle anyway
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              duelRef.current?.resign();
              disconnect();
            }}
          >
            Leave
          </button>
        </div>
      </section>
    );
  }

  return (
    <>
      <BattleView
        battle={battle}
        role={role}
        onAction={(action) => void act(action)}
        opponentLabel=""
        busy={!over && waitingOnThem}
        busyLabel="Waiting for their move…"
        footer={
          over ? (
            <>
              <p className="prompt">{outcomeText(duel!, role)}</p>
              <div className="row">
                <button type="button" className="primary" onClick={onExit}>
                  Done
                </button>
              </div>
            </>
          ) : undefined
        }
      />
      {duel?.fault ? <p className="error">{faultText(duel.fault)}</p> : null}
      {!over ? (
        <div className="row">
          <button
            type="button"
            className="ghost"
            onClick={() => {
              duelRef.current?.resign();
              setDuel(duelRef.current!.view());
            }}
          >
            Resign
          </button>
        </div>
      ) : null}
    </>
  );
}

function connectionText(status: RoomStatus): string {
  switch (status) {
    case "connecting":
      return "Finding a relay…";
    case "waiting":
      return "Waiting for the other player to join this code. Pairing takes a few seconds once they have.";
    case "paired":
      return "Paired.";
    case "failed":
      return "Lost the connection: the other player left, or no relay can be reached right now.";
    default:
      return "Closed.";
  }
}

function outcomeText(view: DuelView, role: number): string {
  if (view.fault) return faultText(view.fault);
  const outcome = view.battle?.outcome;
  if (!outcome) return "The match ended.";
  if (outcome.t === "draw") return "A draw — everything fainted at once.";
  if (outcome.t === "win") return outcome.side === role ? "You won." : "You lost.";
  return "The match ended.";
}

function faultText(fault: NonNullable<DuelView["fault"]>): string {
  switch (fault.t) {
    case "resigned":
      return fault.side === 0 ? "You resigned." : "Your opponent resigned.";
    case "badReveal":
      return "Your opponent sent a move that did not match what they committed to. The match is void.";
    case "sizeMismatch":
      return `You brought ${fault.ours} and they brought ${fault.theirs}. Agree on a format and try again.`;
    case "desync":
      return `The two of you resolved turn ${fault.turn} differently (${fault.ours} vs ${fault.theirs}). One of these clients is running different rules, so the match is void.`;
  }
}
