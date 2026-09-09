"use client";

import {
  BREEDING_ITEMS,
  compatible,
  generationsToMax,
  ITEM_BLURBS,
  ITEM_NAMES,
  STEPS_PER_EGG,
  type BreedingItem,
} from "@/engine/breeding";
import { species as speciesById } from "@/engine/dex";
import { depositRefusal, type GameState, type Input } from "@/engine/engine";
import { ivTotal, IV_MAX } from "@/engine/stats";
import { STAT_IDS, type Individual } from "@/engine/types";
import { displayName } from "@/lib/narrate";
import { Sprite } from "./Sprite";
import { VariantTag } from "./PartyStrip";

/**
 * The hub: the daycare and the box.
 *
 * Both live here rather than in a menu you carry, because walking back is
 * what makes walking out mean anything. The engine enforces it too — a
 * deposit anywhere else is refused.
 */

function ivBar({ ivs }: Individual) {
  const total = ivTotal(ivs);
  const share = total / (IV_MAX * STAT_IDS.length);
  return (
    <div className="ivRow" title={STAT_IDS.map((stat) => `${stat} ${ivs[stat]}`).join("  ")}>
      <div className="ivTrack">
        <div className="ivFill" style={{ width: `${share * 100}%` }} />
      </div>
      <span className="muted ivNum">
        {total}/{IV_MAX * STAT_IDS.length}
      </span>
    </div>
  );
}

function Slot({
  creature,
  index,
  onWithdraw,
}: {
  creature: Individual | null;
  index: 0 | 1;
  onWithdraw: (slot: 0 | 1) => void;
}) {
  if (!creature) {
    return (
      <div className="slotCard empty">
        <span className="muted">Empty slot</span>
      </div>
    );
  }

  return (
    <div className="slotCard">
      <Sprite speciesId={creature.speciesId} variantId={creature.variantId} size={56} />
      <div className="cardBody">
        <div className="cardTop">
          <strong>{displayName(creature)}</strong>
          <span className="muted">Lv{creature.level}</span>
        </div>
        {ivBar(creature)}
        <div className="cardFoot">
          <span className="muted">{creature.natureId}</span>
          <VariantTag variantId={creature.variantId} />
        </div>
      </div>
      <button type="button" className="ghost small" onClick={() => onWithdraw(index)}>
        Take back
      </button>
    </div>
  );
}

function Row({
  creature,
  action,
  label,
  disabled,
  onAct,
  extra,
}: {
  creature: Individual;
  action: string;
  label: string;
  disabled?: boolean;
  onAct: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="boxRow">
      <Sprite speciesId={creature.speciesId} variantId={creature.variantId} size={40} />
      <div className="cardBody">
        <div className="cardTop">
          <strong>{displayName(creature)}</strong>
          <span className="muted">Lv{creature.level}</span>
        </div>
        {ivBar(creature)}
      </div>
      <VariantTag variantId={creature.variantId} />
      <button type="button" className="ghost small" onClick={onAct} disabled={disabled} title={label}>
        {action}
      </button>
      {extra}
    </div>
  );
}

export function HubPanel({ state, onInput }: { state: GameState; onInput: (input: Input) => void }) {
  const [first, second] = state.daycare.slots;
  const pair = first && second ? compatible(first, second) : false;
  const progress = pair ? state.daycare.steps / STEPS_PER_EGG : 0;
  const slotsFull = Boolean(first && second);

  return (
    <section className="hub">
      <div className="hubCol">
        <h3>Daycare</h3>
        <p className="muted">
          Leave two here and walk. Every {STEPS_PER_EGG} steps produces an egg, and each egg
          inherits every stat from one parent or the other — with a few of them mutating
          upward. That mutation is the only way anything climbs past the 0–6 a wild catch
          rolls; expect about {generationsToMax(state.daycare.applied)} generations to perfect
          a stat at this rate.
        </p>

        <div className="slots">
          <Slot creature={first} index={0} onWithdraw={(slot) => onInput({ t: "withdraw", slot })} />
          <Slot creature={second} index={1} onWithdraw={(slot) => onInput({ t: "withdraw", slot })} />
        </div>

        {!slotsFull && state.party.length <= 1 && state.box.length > 0 ? (
          <p className="hint">
            Your party is down to one, so it cannot be deposited — but anything in the box can go
            straight in.
          </p>
        ) : null}

        {slotsFull && !pair ? (
          <p className="error">
            These two share no egg group, so nothing will come of it. A Ditto pairs with almost
            anything.
          </p>
        ) : null}

        <div className="eggRow">
          <div className="ivTrack wide">
            <div className="eggFill" style={{ width: `${Math.min(1, progress) * 100}%` }} />
          </div>
          <span className="muted">
            {state.daycare.eggReady
              ? "An egg is waiting"
              : pair
                ? `${state.daycare.steps} / ${STEPS_PER_EGG} steps`
                : "no pair"}
          </span>
          <button
            type="button"
            className="primary"
            disabled={!state.daycare.eggReady}
            onClick={() => onInput({ t: "collectEgg" })}
          >
            Take the egg
          </button>
        </div>

        <h3>Items</h3>
        <div className="items">
          {BREEDING_ITEMS.map((item: BreedingItem) => {
            const owned = state.items.includes(item);
            const on = state.daycare.applied.includes(item);
            return (
              <button
                key={item}
                type="button"
                className={`itemCard${on ? " on" : ""}`}
                disabled={!owned}
                onClick={() => onInput({ t: "toggleItem", item })}
              >
                <span className="itemName">
                  {ITEM_NAMES[item]}
                  {on ? " ·  on" : ""}
                </span>
                <span className="muted itemBlurb">
                  {owned ? ITEM_BLURBS[item] : "Not found yet — it is out there somewhere."}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="hubCol">
        <h3>Party</h3>
        <div className="boxList">
          {state.party.map((creature, index) => (
            <Row
              key={creature.uid}
              creature={creature}
              action="Deposit"
              label={depositRefusal(state, "party", index) ?? "Leave at the daycare"}
              disabled={Boolean(depositRefusal(state, "party", index))}
              onAct={() => onInput({ t: "deposit", from: "party", index })}
              extra={
                <button
                  type="button"
                  className="ghost small"
                  disabled={state.party.length <= 1}
                  onClick={() => onInput({ t: "store", index })}
                  title="Into the box"
                >
                  Box
                </button>
              }
            />
          ))}
        </div>

        <h3>Box · {state.box.length}</h3>
        {state.box.length ? (
          <div className="boxList scrolls">
            {state.box.map((creature, index) => (
              <Row
                key={creature.uid}
                creature={creature}
                action="Take out"
                label="Into your party"
                disabled={state.party.length >= 6}
                onAct={() => onInput({ t: "retrieve", index })}
                extra={
                  <button
                    type="button"
                    className="ghost small"
                    disabled={Boolean(depositRefusal(state, "box", index))}
                    onClick={() => onInput({ t: "deposit", from: "box", index })}
                    title={depositRefusal(state, "box", index) ?? "Straight to the daycare"}
                  >
                    Daycare
                  </button>
                }
              />
            ))}
          </div>
        ) : (
          <p className="muted">Nothing boxed. Anything caught with a full party ends up here.</p>
        )}
      </div>
    </section>
  );
}

export function speciesName(id: string): string {
  return speciesById(id).name;
}
