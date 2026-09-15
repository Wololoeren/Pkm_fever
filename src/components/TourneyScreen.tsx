"use client";

import { rememberedTrainerName } from "./MainMenu";
import { anyFlags, flagsText, type TeamFlags } from "@/engine/integrity";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BattleAction } from "@/engine/battle";
import { BRACKET_SIZES, roundName, type BracketSize } from "@/engine/bracket";
import { species as speciesById } from "@/engine/dex";
import { cupPrizeKey, prizeOffer, PRIZE_CHOICES } from "@/engine/prize";
import { TourneySession, type Entrant, type TourneyMessage, type TourneyView } from "@/engine/tourney";
import { STAT_IDS, type Individual } from "@/engine/types";
import { withMoves, atFullHealth } from "@/engine/engine";
import { joinParty, type PartyRoom, type PartyStatus } from "@/lib/party";
import { normaliseRoomCode, randomRoomCode } from "@/lib/room";
import { typeColor } from "@/render/palette";
import { BattleView } from "./BattleView";
import { GenderMark, VariantTag } from "./PartyStrip";
import { Sprite } from "./Sprite";

/**
 * A bracket, as a screen.
 *
 * The protocol is in `engine/tourney.ts` and the draw is in
 * `engine/bracket.ts`; this wires a session to a transport and to some
 * buttons, exactly as `PvpScreen` does for a duel. Nothing here decides
 * anything — the host's button calls `lock`, a move calls `choose`, and every
 * screen below is a rendering of `session.view()`.
 *
 * The one thing this file *does* own is the shape of the evening: a lobby you
 * wait in, a bracket you can see the whole of, a match you either play or
 * watch, and a prize at the end. Which is to say the parts that are a game
 * rather than a protocol.
 */

const SIZE_LABEL: Record<BracketSize, string> = { 4: "4 players", 8: "8 players", 16: "16 players" };

/** How many creatures a side. The same ladder a duel offers. */
const TEAM_SIZES = [1, 2, 3, 4, 5, 6] as const;

/**
 * A player, with their world seed and how far into it they are underneath.
 *
 * The seed says which world their team came from and the moves say how long
 * they have been at it, which between them are the two things anybody asks
 * about an opponent they have never met.
 */
function PlayerChip({
  name,
  gone,
  you,
  seed,
  moves,
  flags,
}: {
  name: string;
  gone: boolean;
  you: boolean;
  seed?: string;
  moves?: number;
  flags?: TeamFlags;
}) {
  const warned = flagsText(flags);
  const detail = [seed ? `seed ${seed}` : null, moves !== undefined ? `${moves.toLocaleString()} moves` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className={`tag playerChip${gone ? " fall" : ""}`}>
      <span>
        {name}
        {you ? " (you)" : ""}
        {gone ? " · AI" : ""}
      </span>
      {detail ? <span className="playerDetail">{detail}</span> : null}
      {warned ? <span className="playerDetail warn">⚠ {warned}</span> : null}
    </span>
  );
}

/**
 * The whole draw, at a glance.
 *
 * Every round on screen at once rather than only the live one, because half
 * the point of a bracket is seeing who you would meet if you keep winning.
 */
function BracketBoard({ view }: { view: TourneyView }) {
  const bracket = view.bracket;
  if (!bracket) return null;

  return (
    <div className="scrollX">
      <div className="bracketBoard">
        {bracket.rounds.map((round, at) => (
          <div key={at} className="bracketRound">
            <h4>{roundName(bracket, at)}</h4>
            {round.map((match) => {
              const live =
                view.live && view.live.round === match.round && view.live.at === match.at;
              const seats = match.seats.map((seat) =>
                seat.player === null ? null : bracket.players[seat.player],
              );
              return (
                <div
                  key={match.at}
                  className={`bracketMatch${live ? " live" : ""}${match.won !== null ? " done" : ""}`}
                >
                  {seats.map((player, seat) => (
                    <div
                      key={seat}
                      className={`bracketSeat${match.won === seat ? " won" : ""}${
                        match.won !== null && match.won !== seat ? " out" : ""
                      }`}
                    >
                      {player ? (
                        <PlayerChip
                          name={player.name}
                          gone={player.gone}
                          you={player.id === view.self}
                          seed={player.seed}
                          moves={player.moves}
                        />
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The three at the end.
 *
 * Deliberately the starter screen again — same card, same numbers, same
 * decision — because that is the one moment in this game everybody remembers
 * making, and winning a bracket is being asked it a second time with better
 * odds. See `engine/prize.ts` for why they are level one.
 */
function PrizePick({
  offered,
  onPick,
}: {
  offered: Individual[];
  onPick: (creature: Individual) => void;
}) {
  return (
    <section className="starters">
      <header className="pageHead">
        <h2>You won it</h2>
        <p className="muted">
          Three at level one, rolled from the bracket you just took. The bigger the field, the
          better the odds on every one of them — shine, colour, abilities and breeding alike. Take
          one.
        </p>
      </header>

      <div className="starterGrid">
        {offered.map((creature) => {
          const entry = speciesById(creature.speciesId);
          const total = STAT_IDS.reduce((sum, stat) => sum + entry.base[stat], 0);
          return (
            <button
              key={creature.uid}
              type="button"
              className="starterCard"
              onClick={() => onPick(creature)}
            >
              <Sprite speciesId={creature.speciesId} variantId={creature.variantId} size={96} />
              <strong>
                {entry.name} <GenderMark gender={creature.gender} />
              </strong>
              <VariantTag variantId={creature.variantId} />
              <div className="row">
                {entry.types.map((type) => (
                  <span key={type} className="tag" style={{ borderLeftColor: typeColor(type) }}>
                    {type}
                  </span>
                ))}
              </div>
              <p className="muted">
                base {total} · IVs {STAT_IDS.reduce((sum, stat) => sum + creature.ivs[stat], 0)}/186
                {creature.abilities.length
                  ? ` · ${creature.abilities.length} ${creature.abilities.length === 1 ? "ability" : "abilities"}`
                  : ""}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function TourneyScreen({
  roster,
  seed,
  moves,
  onExit,
  onPrize,
}: {
  roster: Individual[];
  /** This save's world seed. If we host, the prize is drawn from it. */
  seed: string;
  /** How many moves into this save, shown under our name to the room. */
  moves: number;
  onExit: () => void;
  /** Puts a won creature into the save, as an input. */
  onPrize: (creature: Individual) => void;
}) {
  const [name, setName] = useState("");
  // Your trainer name, to start with: the one on everything you catch.
  useEffect(() => setName((current) => current || rememberedTrainerName()), []);
  const [hosting, setHosting] = useState(true);
  const [size, setSize] = useState<BracketSize>(4);
  const [teamSize, setTeamSize] = useState(3);
  const [code, setCode] = useState(() => randomRoomCode());
  const [chosen, setChosen] = useState<number[]>([]);
  const [status, setStatus] = useState<PartyStatus | null>(null);
  const [view, setView] = useState<TourneyView | null>(null);
  const [lobby, setLobby] = useState<Entrant[]>([]);
  const [taken, setTaken] = useState(false);

  const sessionRef = useRef<TourneySession | null>(null);
  const roomRef = useRef<PartyRoom<TourneyMessage> | null>(null);

  useEffect(
    () => () => {
      roomRef.current?.leave();
      roomRef.current = null;
    },
    [],
  );

  const refresh = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    setView(session.view());
    setLobby(session.roster());
  }, []);

  const connect = useCallback(async () => {
    const picked = chosen
      .map((uid) => roster.find((one) => one.uid === uid))
      .filter((one): one is Individual => Boolean(one));
    if (picked.length !== teamSize || !name.trim()) return;

    const clean = normaliseRoomCode(code);
    const queue: TourneyMessage[] = [];
    const send = (message: TourneyMessage) => {
      const room = roomRef.current;
      // Anything produced before the room exists is held rather than lost —
      // the same trick the duel screen uses for its opening.
      if (room) room.send(message);
      else queue.push(message);
    };

    const room = await joinParty<TourneyMessage>(clean, "cup", {
      onStatus: setStatus,
      onMessage: (message, from) => {
        sessionRef.current?.receive(message, from);
        refresh();
      },
      onJoin: () => {
        // Say who we are again: a newcomer has not heard the earlier hellos.
        sessionRef.current?.onJoin();
        refresh();
      },
      onLeave: (id) => {
        sessionRef.current?.onLeave(id);
        refresh();
      },
    });

    const session = new TourneySession({
      self: room.self,
      name: name.trim(),
      code: clean,
      host: hosting,
      seed,
      moves,
      team: picked,
      send,
    });
    sessionRef.current = session;
    roomRef.current = room;
    for (const message of queue) room.send(message);

    session.announce();
    refresh();
  }, [chosen, code, hosting, moves, name, refresh, roster, seed, teamSize]);

  const act = useCallback(
    (action: BattleAction) => {
      sessionRef.current?.choose(action);
      refresh();
    },
    [refresh],
  );

  const disconnect = useCallback(() => {
    roomRef.current?.leave();
    roomRef.current = null;
    sessionRef.current = null;
    setStatus(null);
    setView(null);
    setLobby([]);
    setTaken(false);
  }, []);

  // ------------------------------------------------------------------ setup

  if (!status) {
    const ready = name.trim().length > 0 && chosen.length === teamSize;
    return (
      <section className="hubCol duelSetup">
        <h2>Tournament</h2>
        <p className="muted">
          A knockout for four, eight or sixteen. One match at a time, so everybody watches every
          fight — and whoever takes the whole thing picks a level 1 out of three.
        </p>

        <h3>Your name</h3>
        {/* In a row like every other input on these screens: `hubCol` is a
            flex column that stretches a bare child to the full height it is
            given, which turns a one-line field into a box. */}
        <div className="row">
          <input
            type="text"
            value={name}
            maxLength={16}
            placeholder="What the bracket calls you"
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="row">
          <button
            type="button"
            className={hosting ? "primary" : "ghost"}
            onClick={() => setHosting(true)}
          >
            Host
          </button>
          <button
            type="button"
            className={hosting ? "ghost" : "primary"}
            onClick={() => setHosting(false)}
          >
            Join
          </button>
        </div>

        {hosting ? (
          <>
            <h3>Field</h3>
            <div className="row">
              {BRACKET_SIZES.map((one) => (
                <button
                  key={one}
                  type="button"
                  className={size === one ? "primary" : "ghost"}
                  onClick={() => setSize(one)}
                >
                  {SIZE_LABEL[one]}
                </button>
              ))}
            </div>

            <h3>Format</h3>
            <div className="row">
              {TEAM_SIZES.map((one) => (
                <button
                  key={one}
                  type="button"
                  className={teamSize === one ? "primary" : "ghost"}
                  onClick={() => {
                    setTeamSize(one);
                    setChosen((held) => held.slice(0, one));
                  }}
                >
                  {one}v{one}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <h3>Format</h3>
            <p className="muted">
              The host picks the field and the format. Bring {teamSize} — if the host picked a
              different number you will be told when the draw lands.
            </p>
            <div className="row">
              {TEAM_SIZES.map((one) => (
                <button
                  key={one}
                  type="button"
                  className={teamSize === one ? "primary" : "ghost"}
                  onClick={() => {
                    setTeamSize(one);
                    setChosen((held) => held.slice(0, one));
                  }}
                >
                  {one}v{one}
                </button>
              ))}
            </div>
          </>
        )}

        <h3>Room code</h3>
        <div className="row">
          <input
            type="text"
            value={code}
            onChange={(event) => setCode(normaliseRoomCode(event.target.value))}
          />
          {hosting ? (
            <button type="button" className="ghost" onClick={() => setCode(randomRoomCode())}>
              New code
            </button>
          ) : null}
        </div>

        <h3>
          Your {teamSize} · {chosen.length} picked
        </h3>
        <div className="boxList">
          {roster.map((creature) => {
            const picked = chosen.includes(creature.uid);
            return (
              <button
                key={creature.uid}
                type="button"
                className={`boxRow pick${picked ? " on" : ""}`}
                onClick={() =>
                  setChosen((held) =>
                    held.includes(creature.uid)
                      ? held.filter((uid) => uid !== creature.uid)
                      : held.length >= teamSize
                        ? held
                        : [...held, creature.uid],
                  )
                }
              >
                <Sprite speciesId={creature.speciesId} variantId={creature.variantId} size={24} />
                <strong>{creature.nickname ?? speciesById(creature.speciesId).name}</strong>
                <span className="muted">Lv{creature.level}</span>
                <span className="muted">{picked ? "✓" : ""}</span>
              </button>
            );
          })}
        </div>

        <div className="row">
          <button type="button" className="primary" onClick={() => void connect()} disabled={!ready}>
            {hosting ? "Open the room" : "Join the room"}
          </button>
          <button type="button" className="ghost" onClick={onExit}>
            Back
          </button>
        </div>
      </section>
    );
  }

  // ------------------------------------------------------------------ lobby

  if (!view?.bracket) {
    const full = lobby.length === size;
    return (
      <section className="hubCol duelSetup">
        <h2>Tournament · {normaliseRoomCode(code)}</h2>
        <p className="muted">
          {status === "connecting" || status === "waiting"
            ? "Finding the room…"
            : status === "failed"
              ? "Can't reach any relay — check the connection. This keeps retrying."
              : "Waiting for the field to fill."}
        </p>

        <h3>
          Here · {lobby.length}
          {hosting ? ` of ${size}` : ""}
        </h3>
        <div className="row">
          {lobby.map((one) => (
            <PlayerChip
              key={one.id}
              name={one.name}
              gone={false}
              you={one.id === view?.self}
              seed={one.seed}
              moves={one.moves}
              flags={one.flags}
            />
          ))}
        </div>
        {lobby.some((one) => anyFlags(one.flags)) ? (
          <p className="warn">
            Before you start: {lobby
              .filter((one) => anyFlags(one.flags))
              .map((one) => `${one.id === view?.self ? "you are" : `${one.name} is`} bringing ${flagsText(one.flags)}`)
              .join("; ")}
            .
          </p>
        ) : null}

        <div className="row">
          {hosting ? (
            <button
              type="button"
              className="primary"
              disabled={!full}
              onClick={() => {
                sessionRef.current?.lock(size, teamSize);
                refresh();
              }}
            >
              {full ? "Start the bracket" : `Waiting for ${size - lobby.length} more`}
            </button>
          ) : (
            <span className="muted">The host starts it once the field is full.</span>
          )}
          <button type="button" className="ghost" onClick={disconnect}>
            Leave
          </button>
        </div>
      </section>
    );
  }

  // ------------------------------------------------------------------ prize

  const won = view.won;
  if (view.phase === "done" && won && won.id === view.self && !taken) {
    const offered = prizeOffer(
      cupPrizeKey(view.hostSeed ?? "", normaliseRoomCode(code)),
      won.id,
      view.bracket.size,
      1,
    ).map((one) => atFullHealth(withMoves(one)));

    return (
      <PrizePick
        offered={offered}
        onPick={(creature) => {
          setTaken(true);
          onPrize(creature);
        }}
      />
    );
  }

  // ------------------------------------------------------------- the bracket

  const playing = view.role !== null && view.battle && !view.battle.outcome;

  /*
   * Whose creatures are on the other side, by name.
   *
   * "Bracket used Tackle!" tells nobody anything in a room where the whole
   * point is watching a named person lose. For a spectator this is the seat
   * opposite seat 0, because that is the side `BattleView` labels when the
   * role it is handed is the default.
   */
  const opponentName = (() => {
    if (!view.live || !view.bracket) return null;
    const seats = view.live.seats.map((seat) =>
      seat.player === null ? null : view.bracket!.players[seat.player],
    );
    const theirs = view.role === null ? seats[1] : seats[view.role === 0 ? 1 : 0];
    return theirs ? `${theirs.name}'s` : null;
  })();

  /*
   * The battle is a sibling of everything else, not a child of it.
   *
   * `BattleView` brings its own `.battle` layout — a stage with the two
   * plates positioned over it — and putting that inside `hubCol`, which is a
   * flex column that stretches and gaps its children, folded the plates on
   * top of the sprites and the log. `PvpScreen` renders it the same way, at
   * the top level of a fragment, and for the same reason.
   */
  return (
    <>
      <section className="hubCol">
        <header className="pageHead">
          <h2>
            {view.phase === "done" ? "Done" : roundName(view.bracket, view.live?.round ?? 0)} ·{" "}
            <code>{normaliseRoomCode(code)}</code>
          </h2>
          <p className="muted">
            {view.fault
              ? view.fault
              : view.phase === "done"
                ? `${won?.name ?? "Nobody"} took it.`
                : playing
                  ? "Your match. Everybody is watching."
                  : "Watching."}
          </p>
        </header>

        <BracketBoard view={view} />
      </section>

      {view.battle ? (
        <BattleView
          battle={view.battle}
          role={view.role ?? 0}
          onAction={act}
          opponentLabel={opponentName ?? "Bracket"}
          busy={view.role === null}
          busyLabel="Watching"
        />
      ) : null}

      <section className="hubCol">
        {view.phase === "done" && (!won || won.id !== view.self || taken) ? (
          <p className="muted">
            {taken ? "Prize taken." : `${won?.name ?? "Nobody"} won, and picks the prize.`}
          </p>
        ) : null}

        <div className="row">
          <button type="button" className="ghost" onClick={disconnect}>
            Leave
          </button>
          {view.phase === "done" ? (
            <button type="button" className="ghost" onClick={onExit}>
              Back to the game
            </button>
          ) : null}
        </div>
      </section>
    </>
  );
}

/** Exported for a test that keeps the screen and the roll in step. */
export const PRIZE_COUNT = PRIZE_CHOICES;
