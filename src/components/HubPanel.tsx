"use client";

import {
  BREEDING_ITEMS,
  breedingRefusal,
  generationsToMax,
  chromaOdds,
  climbChance,
  flatBonus,
  tierMatrix,
  type DaycareState,
  STEPS_PER_EGG,
  type BreedingItem,
} from "@/engine/breeding";
import { species as speciesById } from "@/engine/dex";
import { depositRefusal, partyOrderRefusal, type GameState, type Input } from "@/engine/engine";
import { ivTotal, IV_MAX } from "@/engine/stats";
import { STAT_IDS, type Individual } from "@/engine/types";
import type { World } from "@/engine/world";
import { chroma, variant } from "@/engine/variants";
import { swatchFor } from "@/render/palette";
import { hasItem, item as itemSpec } from "@/engine/items";
import { displayName } from "@/lib/narrate";
import { ReleaseButton } from "./ReleaseButton";
import { Sprite } from "./Sprite";
import { GenderMark, VariantTag } from "./PartyStrip";

/**
 * The hub: the daycare and the box.
 *
 * Both live here rather than in a menu you carry, because walking back is
 * what makes walking out mean anything. The engine enforces it too — a
 * deposit anywhere else is refused.
 */

/**
 * What this pairing will do to the shine ladder, as a row of odds.
 *
 * The matrix is computed from the rule rather than written beside it, so the
 * panel cannot claim odds the engine does not roll. With no pair deposited it
 * shows the ordinary-times-ordinary row, which is the one worth knowing: even
 * from nothing, every hundredth child climbs.
 */
function ShineMatrix({
  pair,
  applied,
}: {
  pair: DaycareState["slots"];
  applied: readonly BreedingItem[];
}) {
  const first = pair[0] ? variant(pair[0].variantId).tier : 0;
  const second = pair[1] ? variant(pair[1].variantId).tier : 0;
  const levelSum = (pair[0]?.level ?? 0) + (pair[1]?.level ?? 0);
  const odds = tierMatrix(first, second, applied, levelSum);
  const colours = chromaOdds(
    pair[0] ? variant(pair[0].variantId).chromaId : null,
    pair[1] ? variant(pair[1].variantId).chromaId : null,
    applied,
  );

  return (
    <div className="ladder">
      <p className="muted">
        {pair[0] && pair[1]
          ? `${TIER_LABELS[first]} x ${TIER_LABELS[second]} — the child starts at the average and can climb.`
          : "With nothing deposited, what an ordinary pair would give."}
      </p>
      <div className="ladderRow">
        {odds.map((share, tier) => (
          <div key={tier} className={`rung${share > 0 ? " lit" : ""}`} title={`${TIER_LABELS[tier]}`}>
            <span className="rungName">{TIER_LABELS[tier]}</span>
            <span className="rungOdds">{formatShare(share)}</span>
          </div>
        ))}
      </div>

      <p className="muted ladderNote">
        A climb is worth {(climbChance(applied, levelSum) / 100).toFixed(2)}% here — one percent to
        begin with, and a twentieth of a percent for every level across the pair
        {levelSum ? ` (${levelSum} of them)` : ""}. Raising them is worth something too.
        {flatBonus(applied) ? (
          <>
            {" "}
            What you have applied adds a flat{" "}
            <strong>{(flatBonus(applied) / 100).toFixed(2)}%</strong> on top.
          </>
        ) : null}
        {applied.includes("glitter") ? (
          <>
            {" "}
            The Glitter goes when the egg does — one pinch per egg, and the odds above drop back
            when the last of it is spent.
          </>
        ) : null}
      </p>

      <h4 className="ladderSub">Colour</h4>
      <div className="chromaRow">
        {colours.map((row) => (
          <div key={row.id ?? "none"} className="rung lit">
            <span
              className="rungName"
              style={row.id ? { color: swatchFor(variant(row.id)) } : undefined}
            >
              {row.id ? chroma(row.id).name : "None"}
            </span>
            <span className="rungOdds">{formatShare(row.share)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const TIER_LABELS = ["Normal", "Faded", "Washed", "Turning", "Nearly", "Shiny"];

/** Odds this small need more than one decimal or they all read as "0.0%". */
function formatShare(perMille: number): string {
  if (perMille === 0) return "—";
  const percent = perMille / 10;
  if (percent >= 1) return `${percent.toFixed(percent >= 10 ? 0 : 1)}%`;
  if (percent >= 0.01) return `${percent.toFixed(2)}%`;
  return "<0.01%";
}

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
          <strong>
            {displayName(creature)} <GenderMark gender={creature.gender} />
          </strong>
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
  onInspect,
}: {
  creature: Individual;
  action: string;
  label: string;
  disabled?: boolean;
  onAct: () => void;
  extra?: React.ReactNode;
  onInspect?: (uid: number) => void;
}) {
  return (
    <div className="boxRow">
      <Sprite speciesId={creature.speciesId} variantId={creature.variantId} size={40} />
      <div className="cardBody">
        <div className="cardTop">
          <strong>
            {displayName(creature)} <GenderMark gender={creature.gender} />
          </strong>
          <span className="muted">Lv{creature.level}</span>
        </div>
        {ivBar(creature)}
      </div>
      <VariantTag variantId={creature.variantId} />
      {onInspect ? (
        <button type="button" className="ghost small" onClick={() => onInspect(creature.uid)} title="Stats and moves">
          Look
        </button>
      ) : null}
      <button type="button" className="ghost small" onClick={onAct} disabled={disabled} title={label}>
        {action}
      </button>
      {extra}
    </div>
  );
}

export function HubPanel({
  world,
  state,
  onInput,
  onPvp,
  onInspect,
  showDaycare,
  showPvp,
}: {
  world: World;
  state: GameState;
  onInput: (input: Input) => void;
  onPvp: () => void;
  onInspect: (uid: number) => void;
  /** The daycare and the centre are separate buildings; each panel belongs to
   * the one you are standing in. */
  showDaycare: boolean;
  showPvp: boolean;
}) {
  const [first, second] = state.daycare.slots;
  const refusal = first && second ? breedingRefusal(first, second) : null;
  const pair = Boolean(first && second) && refusal === null;
  const progress = pair ? state.daycare.steps / STEPS_PER_EGG : 0;
  const slotsFull = Boolean(first && second);

  return (
    <section className="hub">
      {showDaycare ? (
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

        {slotsFull && refusal ? (
          <p className="error">
            {refusal} — so nothing will come of it. A Ditto pairs with almost anything, and so
            does anyone Trans.
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

        <h3>The ladder</h3>
        <ShineMatrix pair={state.daycare.slots} applied={state.daycare.applied} />

        <h3>Items</h3>
        <div className="items">
          {BREEDING_ITEMS.map((item: BreedingItem) => {
            const owned = hasItem(state.bag, item);
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
                  {itemSpec(item).name}
                  {on ? " ·  on" : ""}
                </span>
                <span className="muted itemBlurb">
                  {owned ? itemSpec(item).blurb : "Not found yet — it is out there somewhere."}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      ) : null}

      <div className="hubCol">
        {showPvp ? (
          <>
        <h3>Other players</h3>
        <p className="muted">
          Battle or trade with somebody else, browser to browser. Both happen here rather than
          from a menu, because a town is somewhere you walk back to.
        </p>
        <div className="row">
          <button type="button" onClick={onPvp} disabled={!state.party.length}>
            PvP
          </button>
        </div>
          </>
        ) : null}

        <h3>Party</h3>
        <div className="boxList">
          {state.party.map((creature, index) => (
            <Row
              key={creature.uid}
              creature={creature}
              onInspect={onInspect}
              action="Deposit"
              label={depositRefusal(world, state, "party", index) ?? "Leave at the daycare"}
              disabled={Boolean(depositRefusal(world, state, "party", index))}
              onAct={() => onInput({ t: "deposit", from: "party", index })}
              extra={
                <>
                  <button
                    type="button"
                    className="ghost small"
                    disabled={Boolean(partyOrderRefusal(state, index, index - 1))}
                    onClick={() => onInput({ t: "reorderParty", from: index, to: index - 1 })}
                    aria-label={`Move ${displayName(creature)} up`}
                    title="Move up — slot one leads"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="ghost small"
                    disabled={Boolean(partyOrderRefusal(state, index, index + 1))}
                    onClick={() => onInput({ t: "reorderParty", from: index, to: index + 1 })}
                    aria-label={`Move ${displayName(creature)} down`}
                    title="Move down"
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    className="ghost small"
                    disabled={state.party.length <= 1}
                    onClick={() => onInput({ t: "store", index })}
                    title="Into the box"
                  >
                    Box
                  </button>
                  <ReleaseButton
                    state={state}
                    from="party"
                    index={index}
                    creature={creature}
                    onInput={onInput}
                  />
                </>
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
                onInspect={onInspect}
                action="Take out"
                label="Into your party"
                disabled={state.party.length >= 6}
                onAct={() => onInput({ t: "retrieve", index })}
                extra={
                  <>
                  <button
                    type="button"
                    className="ghost small"
                    disabled={Boolean(depositRefusal(world, state, "box", index))}
                    onClick={() => onInput({ t: "deposit", from: "box", index })}
                    title={depositRefusal(world, state, "box", index) ?? "Straight to the daycare"}
                  >
                    Daycare
                  </button>
                  <ReleaseButton
                    state={state}
                    from="box"
                    index={index}
                    creature={creature}
                    onInput={onInput}
                  />
                  </>
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
