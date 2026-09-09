"use client";

import { useEffect, useMemo } from "react";
import { offerRefusal, speakingTo, tradeRefusal, type GameState, type Input } from "@/engine/engine";
import { gym as gymSpec, gymBreakdown } from "@/engine/gyms";
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
 */

const ACCEPT: Record<string, string> = {
  gift: "Take it",
  heal: "Yes, please",
  quest: "Take the job",
  gym: "Challenge",
};

interface Option {
  label: string;
  why: string | null;
  run: () => void;
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

  // Memoised because the key handler depends on it: rebuilt every render, the
  // listener would be torn down and re-added on every keystroke.
  const options: Option[] = useMemo(() => {
    if (!person || person.kind === "hint") return [];

    if (person.kind === "trade") {
      return state.party.map((creature, index) => ({
        label: `Hand over ${displayName(creature)} · Lv${creature.level}`,
        why: tradeRefusal(world, state, index),
        run: () => onInput({ t: "npcTrade", index }),
      }));
    }

    return [
      {
        label: ACCEPT[person.kind] ?? "Yes",
        why: offerRefusal(world, state),
        run: () => onInput({ t: "npcAccept" }),
      },
    ];
  }, [world, state, person, onInput]);

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
      option.run();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options, onInput]);

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

      {person.kind === "trade" && person.gives ? (
        <p className="muted">They will hand over {givesText(person.gives)}.</p>
      ) : null}

      {options.length ? (
        <div className="talkOptions">
          {options.map((option, index) => (
            <button
              key={option.label}
              type="button"
              className="talkOption"
              disabled={Boolean(option.why)}
              title={option.why ?? option.label}
              onClick={option.run}
            >
              <kbd>{index + 1}</kbd>
              <span>{option.label}</span>
              {option.why ? <span className="muted">— {option.why}</span> : null}
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">
          Nothing on offer. <kbd>E</kbd> to leave.
        </p>
      )}
    </section>
  );
}

/** What a gym is fielding, and how it got there, before you commit to it. */
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
