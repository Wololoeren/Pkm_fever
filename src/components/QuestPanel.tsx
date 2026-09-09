"use client";

import { claimRefusal, questViewOf, type GameState, type Input } from "@/engine/engine";
import { goalText, progressOf, quest as questSpec, rewardText } from "@/engine/quests";
import type { World } from "@/engine/world";

/**
 * The jobs you have taken on, and how far along each is.
 *
 * Progress is not stored anywhere — it is worked out from the save every time
 * this renders. That is why a quest can be retuned without invalidating a
 * single log, and why this panel can never disagree with the world it is
 * describing: there is no second copy of the count to drift.
 */
export function QuestPanel({
  world,
  state,
  onInput,
}: {
  world: World;
  state: GameState;
  onInput: (input: Input) => void;
}) {
  const view = questViewOf(world, state);
  const taken = state.questsTaken.map((id) => ({ id, spec: questSpec(id) }));

  if (!taken.length) {
    return (
      <p className="muted">
        Nothing on. People with work going spare have a <strong>!</strong> over them — there are a
        couple in town, and more further out.
      </p>
    );
  }

  const open = taken.filter((entry) => !state.questsDone.includes(entry.id));
  const done = taken.filter((entry) => state.questsDone.includes(entry.id));

  return (
    <div className="quests">
      {open.map(({ id, spec }) => {
        const progress = progressOf(view, spec.goal);
        const why = claimRefusal(world, state, id);

        return (
          <div key={id} className={`questCard${progress.done ? " ready" : ""}`}>
            <div className="questTop">
              <strong>{spec.name}</strong>
              <span className="muted">
                {progress.have}/{progress.need}
              </span>
            </div>
            <div className="questTrack">
              <div
                className="questFill"
                style={{ width: `${Math.round((progress.have / progress.need) * 100)}%` }}
              />
            </div>
            <p className="muted questGoal">
              {goalText(spec.goal)} · pays {rewardText(spec.reward)}
            </p>
            <button
              type="button"
              className={progress.done ? "primary" : "ghost"}
              disabled={Boolean(why)}
              title={why ?? "Collect"}
              onClick={() => onInput({ t: "claimQuest", id })}
            >
              {progress.done ? "Collect" : "Not yet"}
            </button>
          </div>
        );
      })}

      {done.length ? (
        <p className="muted">
          Finished: {done.map((entry) => entry.spec.name).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
