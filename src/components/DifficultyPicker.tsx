"use client";

import { DIFFICULTIES, difficulty, type Difficulty } from "@/engine/difficulty";

/**
 * How often a gym's creatures are born with at least one ability, as a
 * percentage — which is the number worth showing, because the difference
 * between one and two of them is small beside the difference between none
 * and one.
 */
function abilityChance(one: Difficulty): string {
  const odds = one.gymAbilities;
  return `${Math.round((odds.one + odds.two + odds.three) / 10)}%`;
}

/**
 * Choosing how hard the run is, before it starts.
 *
 * Five cards rather than a dropdown, because what separates them is a list of
 * numbers and the only fair way to ask is to show it. Every card says what it
 * does in the same words in the same order, so the tiers read as one dial
 * being turned rather than five unrelated rulesets.
 *
 * It appears on the start screen and nowhere else: the choice is the first
 * input of the run, so it cannot be changed once anything has happened.
 */
export function DifficultyPicker({
  value,
  onPick,
}: {
  value: string;
  onPick: (id: string) => void;
}) {
  const chosen = difficulty(value);

  return (
    <div className="difficulty">
      <div className="difficultyRow" role="radiogroup" aria-label="Difficulty">
        {DIFFICULTIES.map((one) => (
          <button
            key={one.id}
            type="button"
            role="radio"
            aria-checked={one.id === chosen.id}
            className={`difficultyCard${one.id === chosen.id ? " on" : ""}`}
            onClick={() => onPick(one.id)}
            title={one.blurb}
          >
            <strong>{one.name}</strong>
            <span className="muted small">
              {one.gymEv ? `${one.gymEv} EV` : "untrained"}
              {one.wildLevels ? ` · wild +${one.wildLevels}` : ""}
            </span>
          </button>
        ))}
      </div>
      <p className="muted small">{chosen.blurb}</p>
      <dl className="difficultyFacts">
        <div>
          <dt>Gym leaders</dt>
          <dd>
            +{chosen.gymBase} base, +{chosen.gymPerBadge} a badge
            {chosen.gymTeam ? `, ${chosen.gymTeam} extra` : ""} · IV {chosen.gymIv} · {chosen.gymEv} EV
            {chosen.gymHeld ? " · holding items" : ""}
            {" · "}
            {abilityChance(chosen)} carry an ability
          </dd>
        </div>
        <div>
          <dt>Trainers</dt>
          <dd>
            +{chosen.trainerLevels} levels
            {chosen.trainerTeam ? `, ${chosen.trainerTeam} extra` : ""} · IV {chosen.trainerIv} ·{" "}
            {chosen.trainerEv} EV{chosen.trainerHeld ? " · holding items" : ""}
          </dd>
        </div>
        <div>
          <dt>Wild</dt>
          <dd>
            {chosen.wildLevels ? `+${chosen.wildLevels} levels` : "as dealt"} · balls{" "}
            {Math.round(chosen.catchMille / 10)}%
          </dd>
        </div>
        <div>
          <dt>Purses</dt>
          <dd>{Math.round(chosen.moneyMille / 10)}% of a win</dd>
        </div>
        <div>
          <dt>Poké Center</dt>
          <dd>free, always</dd>
        </div>
        <div>
          <dt>Fainting</dt>
          <dd>
            {chosen.whiteoutMille
              ? `costs ${Math.round(chosen.whiteoutMille / 10)}% of your money`
              : "costs the walk back"}
          </dd>
        </div>
      </dl>
    </div>
  );
}
