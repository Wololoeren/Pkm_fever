"use client";

import { useEffect, useMemo, useState } from "react";
import {
  appraisal,
  appraiseRefusal,
  arenaRefusal,
  offerRefusal,
  cutRefusal,
  printRefusal,
  reforgeRefusal,
  shredReady,
  shredRefusal,
  shredValue,
  shredWait,
  speakingTo,
  stations,
  tradeRefusal,
  travelRefusal,
  type GameState,
  type Input,
} from "@/engine/engine";
import { contender as cupSpec, CUP_SIZE } from "@/engine/cup";
import { gym as gymSpec, gymBreakdown } from "@/engine/gyms";
import { arena, arenaBreakdown, ARENA_ROUNDS, ARENA_SIZE } from "@/engine/arenas";
import { missingInks, printable, PRINT_COOLDOWN } from "@/engine/printer";
import { SHRED_COOLDOWN, SHRED_PER_CANDY } from "@/engine/engine";
import { CUT_COOLDOWN, cutReady, cutWait } from "@/engine/lapidary";
import { natureName } from "@/engine/smith";
import { chroma } from "@/engine/variants";
import { species as speciesById } from "@/engine/dex";
import { item } from "@/engine/items";
import { dialogueOf, givesText } from "@/engine/npc";
import { goalText, quest as questSpec, rewardText } from "@/engine/quests";
import type { World } from "@/engine/world";
import { displayName } from "@/lib/narrate";

/**
 * A conversation.
 *
 * Whatever the person offers, the button for it is greyed out for exactly the
 * reason the engine would have refused, in the same words — so "you have
 * nothing they want" arrives as an explanation rather than as a dead control.
 *
 * The options are built as a list before anything is drawn, because the same
 * list has to serve two readers: the buttons, and the keyboard. Numbering them
 * in the markup and again in a key handler is how the two quietly stop
 * agreeing the first time somebody adds a kind of person.
 *
 * One kind of option is destructive: the buyer in the north takes the creature
 * away and does not give it back. Those arm on the first press and act on the
 * second, and disarm themselves after a few seconds — a live destructive
 * button left sitting there is a trap waiting for the next stray keystroke.
 */

/** How long a sale stays armed before it forgets it was asked. */
const ARMED_MS = 4000;

/** How far out a stop is, in the unit the world measures distance in. */
function hopText(depth: number): string {
  if (depth === 0) return "home";
  return depth === 1 ? "1 hop out" : `${depth} hops out`;
}

const ACCEPT: Record<string, string> = {
  gift: "Take it",
  heal: "Yes, please",
  quest: "Take the job",
  gym: "Challenge",
  cup: "Play them",
};

interface Option {
  label: string;
  why: string | null;
  run: () => void;
  /** Needs a second press. Carries what identifies this exact one. */
  arms?: number;
}

export function TalkPanel({
  world,
  state,
  onInput,
}: {
  world: World;
  state: GameState;
  onInput: (input: Input) => void;
}) {
  const person = speakingTo(world, state);

  // What the buyer pays in. The player's choice, not the engine's — he pays
  // either way, so nothing about it belongs in the save.
  const [payIn, setPayIn] = useState<"money" | "glitter">("money");
  const [armed, setArmed] = useState<number | null>(null);

  // Armed is a promise to nobody: it lapses on its own.
  useEffect(() => {
    if (armed === null) return;
    const timer = setTimeout(() => setArmed(null), ARMED_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  /**
   * Where the Grey Line will actually take you from here, and how much of it
   * you have not found.
   *
   * Split out of the option list because two readers want it: the buttons, and
   * the line under them.
   *
   * Filtered rather than greyed, and that is the one place this panel departs
   * from the house rule. The rule exists so a dead control explains itself,
   * and with twenty-four posts obeying it literally would mean a wall of
   * twenty-three disabled rows on the first one you meet — a list that is
   * mostly dead is a list nobody reads to the end of, and it would hand over
   * the name of every place in the world before the player had walked to any
   * of them. The count underneath is what keeps it honest. The decision is
   * still the engine's either way: a stop is listed exactly when
   * `travelRefusal` has nothing to say about it.
   */
  const network = useMemo(() => {
    if (!person || person.kind !== "travel") return { reachable: [], closed: 0 };

    const stops = stations(world)
      // Not the one you are standing at. Greyed with "you are already there"
      // it would be the one row in the list that is dead for a reason the
      // player can see out of the window.
      .filter((id) => id !== state.route)
      .map((id) => ({ id, route: world.routes.get(id), why: travelRefusal(world, state, id) }))
      .sort(
        (a, b) =>
          (a.route?.depth ?? 0) - (b.route?.depth ?? 0) ||
          (a.route?.label ?? a.id).localeCompare(b.route?.label ?? b.id),
      );

    return {
      reachable: stops.filter((stop) => stop.why === null),
      closed: stops.filter((stop) => stop.why !== null).length,
    };
  }, [world, state, person]);

  // Memoised because the key handler depends on it: rebuilt every render, the
  // listener would be torn down and re-added on every keystroke.
  const options: Option[] = useMemo(() => {
    if (!person || person.kind === "hint") return [];

    if (person.kind === "buy") {
      return [
        {
          label:
            payIn === "money"
              ? "Take payment in Glitter instead"
              : "Take payment in money instead",
          why: null,
          run: () => {
            setPayIn(payIn === "money" ? "glitter" : "money");
            setArmed(null);
          },
        },
        ...state.party.map((creature, index) => {
          const paid = appraisal(creature);
          const price = payIn === "money" ? `¤${paid.money.toLocaleString()}` : `${paid.glitter} Glitter`;
          return {
            label: `Sell ${displayName(creature)} · Lv${creature.level} for ${price}`,
            why: appraiseRefusal(world, state, index, creature.uid),
            arms: creature.uid,
            run: () => onInput({ t: "npcSell", index, take: payIn, confirm: creature.uid }),
          };
        }),
      ];
    }

    if (person.kind === "trade") {
      return state.party.map((creature, index) => ({
        label: `Hand over ${displayName(creature)} · Lv${creature.level}`,
        why: tradeRefusal(world, state, index),
        run: () => onInput({ t: "npcTrade", index }),
      }));
    }

    if (person.kind === "print") {
      // One option per colour he can do: ivory always, and every other one
      // whose cartridge is in the bag. The ones he is missing are named in
      // the paragraph below rather than listed as dead buttons — a row you
      // can never press is a row that teaches you to stop reading them.
      return printable((id) => (state.bag[id] ?? 0) > 0).map((chromaId) => ({
        label: `Print in ${chroma(chromaId).name}`,
        why: printRefusal(world, state, chromaId),
        run: () => onInput({ t: "print", chromaId }),
      }));
    }

    if (person.kind === "shred") {
      // One row per party member, each armed the way the Appraiser's are:
      // this is irreversible and the list can slide, so the second press is
      // the confirmation and the uid is the safety catch.
      return state.party.map((creature, index) => ({
        label: `Hand over ${displayName(creature)} · Lv${creature.level} for ${shredValue(
          creature,
        )} candy`,
        why: shredRefusal(world, state, index, creature.uid),
        arms: creature.uid,
        run: () => onInput({ t: "shred", index, confirm: creature.uid }),
      }));
    }

    if (person.kind === "cut") {
      // Armed like the shredder's and the Appraiser's: irreversible, and the
      // list can slide under a click.
      return state.party.map((creature, index) => ({
        label: `Put ${displayName(creature)} on the wheel · ${speciesById(creature.speciesId)
          .types.join("/")}`,
        why: cutRefusal(world, state, index, creature.uid),
        arms: creature.uid,
        run: () => onInput({ t: "cut", index, confirm: creature.uid }),
      }));
    }

    if (person.kind === "forge") {
      // Armed like every other row where a creature changes for good: the
      // IV point does not come back, and the list can slide under a click.
      return state.party.map((creature, index) => ({
        label: `Put ${displayName(creature)} on the anvil · ${natureName(creature.natureId)} now`,
        why: reforgeRefusal(world, state, index, creature.uid),
        arms: creature.uid,
        run: () => onInput({ t: "reforge", index, confirm: creature.uid }),
      }));
    }

    if (person.kind === "arena" && person.arenaId) {
      const spec = arena(person.arenaId);
      return [
        {
          label: `Enter · ${spec.teamSize}v${spec.teamSize}, eight in the draw`,
          why: arenaRefusal(state, person.arenaId),
          run: () => onInput({ t: "arenaEnter", id: person.arenaId! }),
        },
      ];
    }

    if (person.kind === "travel") {
      return network.reachable.map(({ id, route }) => ({
        label: `${route?.label ?? id}${route ? ` · ${hopText(route.depth)}` : ""}`,
        why: null,
        run: () => onInput({ t: "npcTravel", route: id }),
      }));
    }

    return [
      {
        label: ACCEPT[person.kind] ?? "Yes",
        why: offerRefusal(world, state),
        run: () => onInput({ t: "npcAccept" }),
      },
    ];
  }, [world, state, person, onInput, payIn, network]);

  // Pressing an arming option once arms it; pressing it again does it.
  const choose = (option: Option) => {
    if (option.why) return;
    if (option.arms === undefined) {
      option.run();
      return;
    }
    if (armed !== option.arms) {
      setArmed(option.arms);
      return;
    }
    setArmed(null);
    option.run();
  };

  // The keys, from the same list the buttons come from.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      const target = event.target as HTMLElement | null;
      // Never steal a keystroke from something being typed into.
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      const key = event.key.toLowerCase();

      if (key === "e") {
        event.preventDefault();
        event.stopPropagation();
        onInput({ t: "endTalk" });
        return;
      }

      if (key < "1" || key > "9") return;
      const option = options[Number(key) - 1];
      if (!option || option.why) return;

      event.preventDefault();
      event.stopPropagation();
      choose(option);
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `choose` is rebuilt every render by design; the list and the armed
    // creature are what actually change what a key does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, onInput, armed]);

  if (!person) return null;

  return (
    <section className="panel talk">
      <div className="talkHead">
        <h3>{person.name}</h3>
        <button type="button" className="ghost" onClick={() => onInput({ t: "endTalk" })}>
          Leave <kbd>E</kbd>
        </button>
      </div>

      {dialogueOf(person).map((line, index) => (
        <p key={index} className={line.startsWith("(") ? "muted" : undefined}>
          {line}
        </p>
      ))}

      {person.kind === "quest" && person.questId ? (
        <p className="muted">
          <strong>{questSpec(person.questId).name}</strong> —{" "}
          {goalText(questSpec(person.questId).goal)}. Pays {rewardText(questSpec(person.questId).reward)}.
        </p>
      ) : null}

      {person.kind === "gym" && person.gymId ? (
        <GymTerms state={state} gymId={person.gymId} />
      ) : null}

      {person.kind === "cup" && person.cupId ? <CupTerms cupId={person.cupId} /> : null}

      {person.kind === "print" ? (
        <p className="muted">
          {state.lastWild
            ? `On file: ${speciesById(state.lastWild).name}. `
            : "Nothing on file — the scanner has not picked anything up yet. "}
          {missingInks((id) => (state.bag[id] ?? 0) > 0).length
            ? `Still out of ${missingInks((id) => (state.bag[id] ?? 0) > 0)
                .map((id) => chroma(id).name.toLowerCase())
                .join(", ")}.`
            : "Every colour loaded."}
          {" "}
          One in four comes out as sludge, and the machine needs {PRINT_COOLDOWN} moves between
          goes.
        </p>
      ) : null}

      {person.kind === "shred" ? (
        <p className="muted">
          One Rare Candy for every {SHRED_PER_CANDY} levels, rounded down — so a level 30 is ten,
          and anything under {SHRED_PER_CANDY} is nothing at all. It does not come back.
          {shredReady(state.tick, state.shreddedAt)
            ? ` One at a time: the machine wants ${SHRED_COOLDOWN} moves between them.`
            : ` The machine is still running — ${shredWait(state.tick, state.shreddedAt)} moves.`}
        </p>
      ) : null}

      {person.kind === "cut" ? (
        <p className="muted">
          A stone of whatever the creature is — two types is a coin toss between them, and which
          stone a type comes off as is read off the manifest&apos;s own evolutions rather than a
          list anybody wrote. It does not come back.
          {cutReady(state.tick, state.cutAt)
            ? ` One at a time: the wheel wants ${CUT_COOLDOWN} moves to cool.`
            : ` The wheel is still turning — ${cutWait(state.tick, state.cutAt)} moves.`}
        </p>
      ) : null}

      {person.kind === "forge" ? (
        <p className="muted">
          A different nature — never the one it had, and not one you choose — for one IV point
          taken from wherever the hammer lands. A Mint does the same thing exactly, for money; this
          costs breeding instead. No waiting between goes: the IVs are the limit.
        </p>
      ) : null}

      {person.kind === "arena" && person.arenaId ? (
        <ArenaTerms state={state} arenaId={person.arenaId} />
      ) : null}

      {person.kind === "buy" ? (
        <p className="muted">
          A thousand for every rung, or one Glitter for every rung — your choice, and it is the
          same ladder either way. Whatever you hand over does not come back.
        </p>
      ) : null}

      {person.kind === "trade" && person.gives ? (
        <p className="muted">They will hand over {givesText(person.gives)}.</p>
      ) : null}

      {person.kind === "travel" ? (
        <p className="muted">
          {network.reachable.length
            ? `${network.reachable.length} of their posts you have already walked to.`
            : "Nowhere to send you yet — they only go back the way you have come."}
          {network.closed
            ? ` ${network.closed} more they keep, somewhere you have not been.`
            : ""}
        </p>
      ) : null}

      {options.length ? (
        <div className="talkOptions">
          {options.map((option, index) => {
            const live = option.arms !== undefined && armed === option.arms;
            return (
              <button
                key={option.label}
                type="button"
                className={`talkOption${live ? " armed" : ""}`}
                disabled={Boolean(option.why)}
                title={option.why ?? option.label}
                onClick={() => choose(option)}
              >
                <kbd>{index + 1}</kbd>
                <span>{live ? `${option.label} — press again, it does not come back` : option.label}</span>
                {option.why ? <span className="muted">— {option.why}</span> : null}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted">
          Nothing on offer. <kbd>E</kbd> to leave.
        </p>
      )}
    </section>
  );
}

/**
 * What one of the five is fielding.
 *
 * Shorter than a gym's terms because there is less to say, and that *is* the
 * information: a gym quotes three numbers that add up to its level, and this
 * quotes one that came from nowhere but itself. Nothing here moved because of
 * anything you did.
 */
function CupTerms({ cupId }: { cupId: string }) {
  const spec = cupSpec(cupId);

  return (
    <p className="muted">
      <strong>{spec.name}</strong> — {CUP_SIZE}{" "}
      {spec.slant ? `${spec.slant} types` : "of the best there are"} at level{" "}
      <strong>{spec.level}</strong>. Perfect where it counts, every point of effort spent, and two
      abilities each. Not scaled to you and never was. Nothing out here gives a spent move back,
      so what is in your bag is the only thing between you and the next one.
    </p>
  );
}

/** What a gym is fielding, and how it got there, before you commit to it. */
/** What a bracket is fielding, and how it got there. The gym's paragraph,
 * applied to the thing that borrowed the gym's scaling. */
function ArenaTerms({ state, arenaId }: { state: GameState; arenaId: string }) {
  const spec = arena(arenaId);
  const sums = arenaBreakdown(spec, state.tick, state.badges.length);

  return (
    <p className="muted">
      <strong>{spec.title}</strong> — {ARENA_SIZE} in the draw, {ARENA_ROUNDS} rounds,{" "}
      {spec.teamSize}v{spec.teamSize} at level <strong>{sums.total}</strong>. That is {sums.base} to
      start with, {sums.fromMoves} for the {state.tick.toLocaleString()} moves you have taken, and{" "}
      {sums.fromBadges} for the {state.badges.length} badges you hold. Win all three and you pick
      one of three at level 1. Lose one and you are out.
    </p>
  );
}

function GymTerms({ state, gymId }: { state: GameState; gymId: string }) {
  const spec = gymSpec(gymId);
  const sums = gymBreakdown(spec, state.tick, state.badges.length);

  return (
    <p className="muted">
      <strong>{spec.name}</strong> — {spec.team} {spec.type} types at level{" "}
      <strong>{sums.total}</strong>. That is {sums.base} to start with, {sums.fromMoves} for the{" "}
      {state.tick.toLocaleString()} moves you have taken, and {sums.fromBadges} for the{" "}
      {state.badges.length} badges you already hold. Winning hands over {item(spec.tool).name}.
    </p>
  );
}
