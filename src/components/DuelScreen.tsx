"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BattleAction } from "@/engine/battle";
import { DuelSession, type DuelMessage, type DuelView } from "@/engine/duel";
import { computeStats } from "@/engine/stats";
import { species as speciesById } from "@/engine/dex";
import { ivTotal, IV_MAX } from "@/engine/stats";
import { STAT_IDS, type Individual } from "@/engine/types";
import { displayName } from "@/lib/narrate";
import { joinDuelRoom, normaliseRoomCode, randomRoomCode, type DuelRoom, type RoomStatus } from "@/lib/duelRoom";
import { BattleView } from "./BattleView";
import { Sprite } from "./Sprite";
import { VariantTag } from "./PartyStrip";

/**
 * A duel, end to end: pick a team, share a code, fight.
 *
 * Everything that makes it fair lives in engine/duel.ts — this only wires the
 * session to a transport and to some buttons. Notice how little there is here:
 * the protocol has no opinion about React, and React has no opinion about the
 * protocol, which is why the whole thing is testable without a browser.
 */

const TEAM_SIZE = 3;

function TeamPicker({
  roster,
  chosen,
  onToggle,
}: {
  roster: Individual[];
  chosen: number[];
  onToggle: (uid: number) => void;
}) {
  return (
    <div className="boxList scrolls">
      {roster.map((creature) => {
        const picked = chosen.includes(creature.uid);
        const stats = computeStats(speciesById(creature.speciesId), creature);
        return (
          <button
            key={creature.uid}
            type="button"
            className={`boxRow pick${picked ? " on" : ""}`}
            onClick={() => onToggle(creature.uid)}
            disabled={!picked && chosen.length >= TEAM_SIZE}
          >
            <Sprite speciesId={creature.speciesId} variantId={creature.variantId} size={40} />
            <div className="cardBody">
              <div className="cardTop">
                <strong>{displayName(creature)}</strong>
                <span className="muted">Lv{creature.level}</span>
              </div>
              <span className="muted ivNum">
                {STAT_IDS.map((stat) => stats[stat]).join(" / ")} · IV {ivTotal(creature.ivs)}/
                {IV_MAX * STAT_IDS.length}
              </span>
            </div>
            <VariantTag variantId={creature.variantId} />
            <span className="muted">{picked ? "✓" : ""}</span>
          </button>
        );
      })}
    </div>
  );
}

export function DuelScreen({ roster, onExit }: { roster: Individual[]; onExit: () => void }) {
  const [chosen, setChosen] = useState<number[]>([]);
  const [code, setCode] = useState(() => randomRoomCode());
  const [status, setStatus] = useState<RoomStatus | null>(null);
  const [view, setView] = useState<DuelView | null>(null);
  const [waitingOnThem, setWaitingOnThem] = useState(false);

  const sessionRef = useRef<DuelSession | null>(null);
  const roomRef = useRef<DuelRoom | null>(null);

  const refresh = useCallback(() => {
    const session = sessionRef.current;
    if (session) setView(session.view());
  }, []);

  useEffect(
    () => () => {
      roomRef.current?.leave();
      roomRef.current = null;
    },
    [],
  );

  const connect = useCallback(async () => {
    const team = chosen
      .map((uid) => roster.find((creature) => creature.uid === uid))
      .filter((creature): creature is Individual => Boolean(creature));
    if (!team.length) return;

    const queue: DuelMessage[] = [];
    const session = new DuelSession(team, (message) => {
      const room = roomRef.current;
      // Messages produced before the room exists are held rather than lost:
      // `open()` fires the moment the pairing lands, and the first hello must
      // not be dropped on the floor.
      if (room) room.send(message);
      else queue.push(message);
    });
    sessionRef.current = session;

    const room = await joinDuelRoom(normaliseRoomCode(code), {
      onStatus: setStatus,
      onMessage: async (message) => {
        await session.receive(message);
        setWaitingOnThem(session.view().phase === "committed" || session.view().phase === "revealing");
        refresh();
      },
      onPeer: () => {
        void session.open().then(refresh);
      },
    });

    roomRef.current = room;
    for (const message of queue) room.send(message);
    refresh();
  }, [chosen, code, roster, refresh]);

  const act = useCallback(
    async (action: BattleAction) => {
      const session = sessionRef.current;
      if (!session) return;
      setWaitingOnThem(true);
      await session.choose(action);
      refresh();
    },
    [refresh],
  );

  // ------------------------------------------------------------- rendering

  if (!status) {
    return (
      <section className="hubCol duelSetup">
        <h2>1v1</h2>
        <p className="muted">
          Pick {TEAM_SIZE}. Teams are shown to your opponent in full — the same open sheets
          competitive play uses, which means there is no hidden state to leak and no advantage in
          reading anybody&apos;s memory. Moves are committed as hashes before either side reveals, so
          neither of you can see the other&apos;s choice, and the battle&apos;s dice come from both
          your nonces so neither can bias a critical hit.
        </p>

        {roster.length ? (
          <TeamPicker
            roster={roster}
            chosen={chosen}
            onToggle={(uid) =>
              setChosen((current) =>
                current.includes(uid) ? current.filter((id) => id !== uid) : [...current, uid],
              )
            }
          />
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
          <button type="button" className="primary" disabled={!chosen.length} onClick={() => void connect()}>
            Find opponent
          </button>
          <button type="button" className="ghost" onClick={onExit}>
            Back
          </button>
        </div>
      </section>
    );
  }

  const battle = view?.battle;

  if (!battle) {
    return (
      <section className="hubCol duelSetup">
        <h2>Room {normaliseRoomCode(code)}</h2>
        <p className="muted">
          {status === "connecting"
            ? "Finding a relay…"
            : status === "waiting"
              ? "Waiting for the other player to join this code…"
              : status === "paired"
                ? "Paired. Exchanging teams…"
                : status === "failed"
                  ? "Lost the connection, or this network blocks peer-to-peer traffic."
                  : "Closed."}
        </p>
        {view?.fault ? <p className="error">{faultText(view.fault)}</p> : null}
        <div className="row">
          <button
            type="button"
            className="ghost"
            onClick={() => {
              roomRef.current?.leave();
              roomRef.current = null;
              sessionRef.current = null;
              setStatus(null);
              setView(null);
            }}
          >
            Back
          </button>
        </div>
      </section>
    );
  }

  const over = view?.phase === "over";
  const role = view?.role ?? 0;

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
              <p className="prompt">{outcomeText(view!, role)}</p>
              <div className="row">
                <button type="button" className="primary" onClick={onExit}>
                  Done
                </button>
              </div>
            </>
          ) : undefined
        }
      />
      {view?.fault ? <p className="error">{faultText(view.fault)}</p> : null}
      {!over ? (
        <div className="row">
          <button
            type="button"
            className="ghost"
            onClick={() => {
              sessionRef.current?.resign();
              refresh();
            }}
          >
            Resign
          </button>
        </div>
      ) : null}
    </>
  );
}

function outcomeText(view: DuelView, role: number): string {
  if (view.fault) return faultText(view.fault);
  const outcome = view.battle?.outcome;
  if (!outcome) return "The duel ended.";
  if (outcome.t === "draw") return "A draw — everything fainted at once.";
  if (outcome.t === "win") return outcome.side === role ? "You won." : "You lost.";
  return "The duel ended.";
}

function faultText(fault: NonNullable<DuelView["fault"]>): string {
  switch (fault.t) {
    case "resigned":
      return fault.side === 0 ? "You resigned." : "Your opponent resigned.";
    case "badReveal":
      return "Your opponent sent a move that did not match what they committed to. The duel is void.";
    case "desync":
      return `The two of you resolved turn ${fault.turn} differently (${fault.ours} vs ${fault.theirs}). One of these clients is running different rules, so the duel is void.`;
  }
}
