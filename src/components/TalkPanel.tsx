"use client";

import { offerRefusal, speakingTo, tradeRefusal, type GameState, type Input } from "@/engine/engine";
import { dialogueOf, givesText } from "@/engine/npc";
import { goalText, quest as questSpec, rewardText } from "@/engine/quests";
import { gym as gymSpec, gymBreakdown } from "@/engine/gyms";
import { item } from "@/engine/items";
import type { World } from "@/engine/world";
import { displayName } from "@/lib/narrate";

/**
 * A conversation.
 *
 * Whatever the person offers, the button for it is greyed out for exactly the
 * reason the engine would have refused, in the same words — so "you have
 * nothing they want" arrives as an explanation rather than as a dead control.
 */
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
  if (!person) return null;

  const refusal = offerRefusal(world, state);
  const label: Record<string, string> = {
    gift: "Take it",
    heal: "Yes, please",
    quest: "Take the job",
    trade: "Trade",
    gym: "Challenge",
    hint: "",
  };

  return (
    <section className="panel talk">
      <div className="talkHead">
        <h3>{person.name}</h3>
        <button type="button" className="ghost" onClick={() => onInput({ t: "endTalk" })}>
          Leave
        </button>
      </div>

      {dialogueOf(person).map((line, index) => (
        <p key={index} className={line.startsWith("(") ? "muted" : undefined}>
          {line}
        </p>
      ))}

      {person.kind === "quest" && person.questId ? (
        <p className="muted">
          <strong>{questSpec(person.questId).name}</strong> — {goalText(questSpec(person.questId).goal)}. Pays{" "}
          {rewardText(questSpec(person.questId).reward)}.
        </p>
      ) : null}

      {person.kind === "gym" && person.gymId ? (
        (() => {
          const spec = gymSpec(person.gymId);
          const sums = gymBreakdown(spec, state.tick, state.badges.length);
          return (
            <p className="muted">
              <strong>{spec.name}</strong> — {spec.team} {spec.type} types at level{" "}
              <strong>{sums.total}</strong>. That is {sums.base} to start with, {sums.fromMoves} for
              the {state.tick.toLocaleString()} moves you have taken, and {sums.fromBadges} for the{" "}
              {state.badges.length} badges you already hold. Winning hands over{" "}
              {item(spec.tool).name}.
            </p>
          );
        })()
      ) : null}

      {person.kind === "trade" && person.gives ? (
        <>
          <p className="muted">They will hand over {givesText(person.gives)}.</p>
          <div className="items">
            {state.party.map((creature, index) => {
              const why = tradeRefusal(world, state, index);
              return (
                <button
                  key={creature.uid}
                  type="button"
                  className="itemCard"
                  disabled={Boolean(why)}
                  title={why ?? "Hand this one over"}
                  onClick={() => onInput({ t: "npcTrade", index })}
                >
                  <span className="itemName">
                    {displayName(creature)} · Lv{creature.level}
                  </span>
                  <span className="muted itemBlurb">{why ?? "Hand this one over"}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : person.kind === "hint" ? null : (
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={Boolean(refusal)}
            title={refusal ?? undefined}
            onClick={() => onInput({ t: "npcAccept" })}
          >
            {label[person.kind]}
          </button>
          {refusal ? <span className="muted">{refusal}</span> : null}
        </div>
      )}
    </section>
  );
}
