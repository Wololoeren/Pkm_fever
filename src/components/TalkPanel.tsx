"use client";

import { useEffect, useMemo, useState } from "react";
import {
  appraisal,
  appraiseRefusal,
  arenaRefusal,
  farmCollectRefusal,
  reclaimPrice,
  reclaimRefusal,
  farmLeaveRefusal,
  farmPlantRefusal,
  farmTakeRefusal,
  huntOffers,
  huntRefusal,
  clubBoutRefusal,
  clubRefusal,
  offerRefusal,
  cutRefusal,
  printRefusal,
  reforgeRefusal,
  shredReady,
  shredRefusal,
  shredValue,
  bidRefusal,
  closedBids,
  WORKSHOP_JOBS,
  WORKSHOP_STATIONS,
  workshopLeaveRefusal,
  workshopTakeRefusal,
  collectRefusalAuction,
  pawnRefusal,
  pawnReady,
  pawnValue,
  pawnWait,
  shredWait,
  speakingTo,
  stations,
  tradeRefusal,
  travelRefusal,
  pageantEnterRefusal,
  PHOTOSHOOT_PAY,
  photoshootRefusal,
  fameLevel,
  fameToNext,
  fameWorth,
  FAME_STEP,
  influenceLeaveRefusal,
  influenceTakeRefusal,
  STREAM_EARN,
  STREAM_FAINT,
  STREAM_STAKE,
  streamCashRefusal,
  streamPayout,
  streamRegisterRefusal,
  INSURANCE_PRICE,
  insuranceRefusal,
  THERAPY_PRICE,
  therapyLeaveRefusal,
  therapyTakeRefusal,
  therapyWait,
  inviteRefusal,
  LODGER_KINDS,
  lodgingOf,
  sendHomeRefusal,
  chromaTradeRefusal,
  giftSwapRefusal,
  tutorLeaveRefusal,
  tutorTakeRefusal,
  tutorWait,
  eggValue,
  sellEggRefusal,
  atFullHealth,
  withMoves,
  type GameState,
  type Input,
} from "@/engine/engine";
import { contender as cupSpec, CUP_SIZE } from "@/engine/cup";
import { difficulty } from "@/engine/difficulty";
import { gym as gymSpec, gymBreakdown } from "@/engine/gyms";
import { arena, arenaBreakdown, ARENA_ROUNDS, ARENA_SIZE } from "@/engine/arenas";
import { huntLine } from "@/engine/hunt";
import { basketCount, farmEvery, farmLeft, farmSuits, farmWorking, ALL_BERRIES, FARM_JOBS, FARM_WORK, FARM_YIELD } from "@/engine/farm";
import { missingInks, printable, PRINT_COOLDOWN, PRINT_PRICE } from "@/engine/printer";
import { PAWN_COOLDOWN, PAWN_PER_LEVEL, SHRED_COOLDOWN, SHRED_PER_CANDY } from "@/engine/engine";
import { CUT_COOLDOWN, cutReady, cutWait } from "@/engine/lapidary";
import { natureName } from "@/engine/smith";
import { AUCTION_TICK, askingPrice, board, keenness, lot as auctionLot, lotCreature } from "@/engine/auction";
import { ability } from "@/engine/abilities";
import { chromaCandyFor, TUTOR_STAY, TUTOR_STEP, tutorBoard, type PricePart } from "@/engine/tutor";
import { PAGEANT_ROUND, pageantField, pageantParts, pageantRound, pageantScore, pageantToBeat } from "@/engine/pageant";
import { StatHover } from "./StatHover";
import { Sprite } from "@/components/Sprite";
import { chroma } from "@/engine/variants";
import { species as speciesById } from "@/engine/dex";
import { bagEntries, item } from "@/engine/items";
import { dialogueOf, EGG_BUYER_AFTER_TWO, givesText } from "@/engine/npc";
import { goalText, quest as questSpec, rewardText } from "@/engine/quests";
import type { World } from "@/engine/world";
import { displayName } from "@/lib/narrate";
import { RegionMap } from "./MiniMap";

/** The travel map, drawn bigger than the one under the field map: it is picked from, not glanced at. */
const TRAVEL_MAP = 280;

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
  /** The tutor's offer picked on his board, whose price the party list below pays. */
  const [lesson, setLesson] = useState<number | null>(null);

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
  const serviceOptions: Option[] = useMemo(() => {
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

    if (person.kind === "workshop") {
      return WORKSHOP_STATIONS.flatMap((station): Option[] => {
        const held = state.workshop[station];
        if (held) {
          return [
            {
              label: `Fetch ${displayName(held.creature)} · Lv${held.creature.level} from ${WORKSHOP_JOBS[station]}`,
              why: workshopTakeRefusal(world, state, station),
              run: () => onInput({ t: "workshopTake", station }),
            },
          ];
        }
        // Only the party members who could do the job are offered for it.
        return state.party.flatMap((creature, index) =>
          speciesById(creature.speciesId).types.includes(station)
            ? [
                {
                  label: `Leave ${displayName(creature)} · Lv${creature.level} ${WORKSHOP_JOBS[station]}`,
                  why: workshopLeaveRefusal(world, state, station, index, creature.uid),
                  run: () => onInput({ t: "workshopLeave", station, index, confirm: creature.uid }),
                },
              ]
            : [],
        );
      });
    }

    if (person.kind === "lost") {
      // One line per thing handed in, each with its own fee. Sorted by name
      // so the counter reads the same way twice.
      return bagEntries(state.lost)
        .sort(([a], [b]) => item(a).name.localeCompare(item(b).name))
        .map(([id, count]) => ({
          label: `${item(id).name}${count > 1 ? ` ×${count}` : ""} · ¤${reclaimPrice(id).toLocaleString()}`,
          why: reclaimRefusal(world, state, id),
          run: () => onInput({ t: "reclaim", item: id }),
        }));
    }

    if (person.kind === "farm") {
      const basket = basketCount(state.farm.basket);
      return [
        // The basket first: it is what you came back for.
        ...(basket
          ? [
              {
                label: `Take the basket · ${basket} berr${basket === 1 ? "y" : "ies"}`,
                why: farmCollectRefusal(world, state),
                run: () => onInput({ t: "farmCollect" }),
              },
            ]
          : []),
        ...FARM_JOBS.flatMap((job): Option[] => {
          const hand = state.farm.hands[job];
          if (hand) {
            return [
              {
                label: `Fetch ${displayName(hand.creature)} · Lv${hand.creature.level} from ${FARM_WORK[job]}`,
                why: farmTakeRefusal(world, state, job),
                run: () => onInput({ t: "farmTake", job }),
              },
            ];
          }
          // Only the ones that could do the job are offered for it.
          return state.party.flatMap((creature, index) =>
            farmSuits(creature, job)
              ? [
                  {
                    label: `Leave ${displayName(creature)} · Lv${creature.level} ${FARM_WORK[job]}`,
                    why: farmLeaveRefusal(world, state, job, index, creature.uid),
                    run: () => onInput({ t: "farmLeave", job, index, confirm: creature.uid }),
                  },
                ]
              : [],
          );
        }),
        // And the beds. A berry from the bag goes into the ground and that bed
        // grows it from then on; a bed can be given back to whatever it fancies.
        ...state.farm.beds.flatMap((bed, at): Option[] =>
          bed
            ? [
                {
                  label: `Bed ${at + 1} · ${item(bed).name} — dig it up`,
                  why: farmPlantRefusal(world, state, at, null),
                  run: () => onInput({ t: "farmPlant", bed: at, item: null }),
                },
              ]
            : bagEntries(state.bag)
                .filter(([id]) => ALL_BERRIES.includes(id))
                .slice(0, 6)
                .map(([id]) => ({
                  label: `Plant ${item(id).name} in bed ${at + 1}`,
                  why: farmPlantRefusal(world, state, at, id),
                  run: () => onInput({ t: "farmPlant", bed: at, item: id }),
                })),
        ),
      ];
    }

    if (person.kind === "auction") {
      const settle = closedBids(world, state);
      return [
        {
          label: settle.length
            ? `Settle ${settle.length} closed lot${settle.length === 1 ? "" : "s"}`
            : "Settle closed lots",
          why: collectRefusalAuction(world, state),
          run: () => onInput({ t: "collectBids" }),
        },
        // Armed: the money leaves now and does not come back until the lot closes.
        ...board(world.seed, state.stepsTaken).map((lot) => ({
          label: `Bid ¤${askingPrice(world.seed, lot.n, state.stepsTaken).toLocaleString()} · ${speciesById(lot.speciesId).name} Lv${lot.level}`,
          why: bidRefusal(world, state, lot.n),
          arms: -1 - lot.n,
          run: () => onInput({ t: "bid", n: lot.n }),
        })),
      ];
    }

    if (person.kind === "chromabuy") {
      // Only the ones wearing a colour are worth listing; the rest would be a
      // column of greyed rows saying the same thing.
      return state.party.flatMap((creature, index) =>
        chromaCandyFor(creature)
          ? [
              {
                label: `Trade ${displayName(creature)} for ${chromaCandyFor(creature)} Chroma Candy`,
                why: chromaTradeRefusal(world, state, index, creature.uid),
                arms: creature.uid,
                run: () => onInput({ t: "chromaTrade", index, confirm: creature.uid }),
              },
            ]
          : [],
      );
    }

    if (person.kind === "therapy") {
      if (state.therapy) {
        return [
          {
            label: `Fetch ${displayName(state.therapy.creature)} from the couch`,
            why: therapyTakeRefusal(world, state),
            run: () => onInput({ t: "therapyTake" }),
          },
        ];
      }
      // Only the ones with something to work through are worth a row.
      return state.party.flatMap((creature, index) =>
        creature.traded || creature.prize || creature.burnedOut
          ? [
              {
                label: `${displayName(creature)} on the couch — becomes ${creature.prize ? "Redeemed" : creature.traded ? "Rehabilitated" : "Recovered"} · ¤${THERAPY_PRICE.toLocaleString()}`,
                why: therapyLeaveRefusal(world, state, index, creature.uid),
                arms: creature.uid,
                run: () => onInput({ t: "therapyLeave", index, confirm: creature.uid }),
              },
            ]
          : [],
      );
    }

    if (person.kind === "pageant") {
      const toBeat = pageantToBeat(world.seed, pageantRound(state.stepsTaken));
      return state.party.map((creature, index) => {
        const score = pageantScore(creature);
        return {
          label: `Enter ${displayName(creature)} · scores ${score} against ${toBeat} to beat${score > toBeat ? " — it would win" : ""}`,
          why: pageantEnterRefusal(world, state, index, creature.uid),
          arms: creature.uid,
          run: () => onInput({ t: "pageantEnter", index, confirm: creature.uid }),
        };
      });
    }

    if (person.kind === "photoshoot") {
      return state.party.flatMap((creature, index) =>
        creature.ribbon
          ? [
              {
                label: `Sell ${displayName(creature)}'s photoshoot for ¤${PHOTOSHOOT_PAY.toLocaleString()} — it comes back Burned Out`,
                why: photoshootRefusal(world, state, index, creature.uid),
                arms: creature.uid,
                run: () => onInput({ t: "photoshoot", index, confirm: creature.uid }),
              },
            ]
          : [],
      );
    }

    if (person.kind === "influence") {
      if (state.influencing) {
        return [
          {
            label: `Fetch ${displayName(state.influencing.creature)} — Famous ${fameLevel({
              ...state.influencing.creature,
              fameSteps: (state.influencing.creature.fameSteps ?? 0) + state.stepsTaken - state.influencing.since,
            })} so far`,
            why: influenceTakeRefusal(world, state),
            run: () => onInput({ t: "influenceTake" }),
          },
        ];
      }
      return state.party.flatMap((creature, index) =>
        fameWorth(creature)
          ? [
              {
                label: `Leave ${displayName(creature)} to go viral · Famous ${fameLevel(creature)}`,
                why: influenceLeaveRefusal(world, state, index, creature.uid),
                run: () => onInput({ t: "influenceLeave", index, confirm: creature.uid }),
              },
            ]
          : [],
      );
    }

    if (person.kind === "stream") {
      if (state.stream) {
        return [
          {
            label: `Collect ¤${streamPayout(state, false).toLocaleString()} (everything above the stake)`,
            why: streamCashRefusal(world, state, false),
            run: () => onInput({ t: "streamCollect" }),
          },
          {
            label: `End the stream and take the whole pool · ¤${streamPayout(state, true).toLocaleString()}`,
            why: streamCashRefusal(world, state, true),
            arms: -2,
            run: () => onInput({ t: "streamUnregister" }),
          },
        ];
      }
      return state.party.flatMap((creature, index) =>
        fameLevel(creature) >= 1
          ? [
              {
                label: `Go live with ${displayName(creature)} · Famous ${fameLevel(creature)} · ¤${STREAM_STAKE.toLocaleString()} stake`,
                why: streamRegisterRefusal(world, state, index, creature.uid),
                run: () => onInput({ t: "streamRegister", index, confirm: creature.uid }),
              },
            ]
          : [],
      );
    }

    if (person.kind === "insure") {
      return [
        {
          label: `Buy Egg Insurance · ¤${INSURANCE_PRICE.toLocaleString()}`,
          why: insuranceRefusal(world, state),
          run: () => onInput({ t: "buyInsurance" }),
        },
      ];
    }

    if (person.kind === "giftswap") {
      return state.party.map((creature, index) => ({
        label: `Swap ${displayName(creature)} · Lv${creature.level} for a Secret Gift`,
        why: giftSwapRefusal(world, state, index, creature.uid),
        arms: creature.uid,
        run: () => onInput({ t: "giftSwap", index, confirm: creature.uid }),
      }));
    }

    if (person.kind === "tutor") {
      if (state.tutoring) {
        return [
          {
            label: `Fetch ${displayName(state.tutoring.creature)} — it is learning ${ability(state.tutoring.abilityId).name}`,
            why: tutorTakeRefusal(world, state),
            run: () => onInput({ t: "tutorTake" }),
          },
        ];
      }
      const offer = tutorBoard(world.seed, state.stepsTaken).find((one) => one.n === lesson);
      if (!offer) return [];
      return state.party.map((creature, index) => ({
        label: `Leave ${displayName(creature)} to learn ${ability(offer.abilityId).name}`,
        why: tutorLeaveRefusal(world, state, offer.n, index, creature.uid),
        arms: creature.uid,
        run: () => {
          onInput({ t: "tutorLeave", n: offer.n, index, confirm: creature.uid });
          setLesson(null);
        },
      }));
    }

    if (person.kind === "eggbuy") {
      // Armed: a sold egg does not come back, and a list of rows all saying
      // "egg" is exactly the kind of list a click can slide on.
      return state.eggs.map((egg, index) => ({
        label: `Sell egg ${index + 1} for ¤${eggValue(egg).toLocaleString()}`,
        why: sellEggRefusal(world, state, index, egg.creature.uid),
        arms: -100000 - egg.creature.uid,
        run: () => onInput({ t: "sellEgg", index, confirm: egg.creature.uid }),
      }));
    }

    if (person.kind === "pawn") {
      // Armed like the shredder's: a sale does not come back.
      return state.party.map((creature, index) => ({
        label: `Sell ${displayName(creature)} · Lv${creature.level} for ¤${pawnValue(creature).toLocaleString()}`,
        why: pawnRefusal(world, state, index, creature.uid),
        arms: creature.uid,
        run: () => onInput({ t: "pawn", index, confirm: creature.uid }),
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

    if (person.kind === "hunt") {
      // The board itself: five lines, each its own button, and the one you
      // take is the one you are then walking to find.
      return huntOffers(world, state).map((offer, index) => ({
        label: huntLine(offer, world.routes.get(offer.routeId)?.label ?? offer.routeId),
        why: huntRefusal(world, state, index),
        run: () => onInput({ t: "huntTake", index }),
      }));
    }

    if (person.kind === "fightclub") {
      // One button either way: stepping in for the first time, and taking the
      // next bout of a series already running. He is holding one of yours in
      // between, and he is not handing it back until somebody goes down.
      const standing = state.party.filter((one) => one.hp > 0).length;
      return state.club
        ? [
            {
              label: `Again · ${state.club.round} down, ${standing} of yours still up`,
              why: clubBoutRefusal(state),
              run: () => onInput({ t: "clubFight" }),
            },
          ]
        : [
            {
              label: `Step in · he picks one of yours, the rest of them answer for it`,
              why: clubRefusal(state),
              run: () => onInput({ t: "clubEnter" }),
            },
          ];
    }

    if (person.kind === "travel") {
      /*
       * The towns only, as buttons; everywhere else is a dot on the map.
       *
       * Late in a run a coach reaches most of fifty places, and fifty numbered
       * rows is not a menu — it is a directory, and one you have to read in
       * full to find the one place you actually meant. The towns are the
       * journeys that get asked for again and again (the centre, the mart, the
       * gym), there are never more than four of them, and they are the ones
       * whose names a player knows. So they keep their buttons and their
       * number keys, and the rest of the network moves onto the map, where a
       * place is found by looking rather than by reading.
       */
      return network.reachable
        .filter(({ route }) => route?.kind === "town")
        .map(({ id, route }) => ({
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
  }, [world, state, person, onInput, payIn, network, lesson]);

  /*
   * And, for anybody who runs something, the offer of a room in Hearth — or,
   * for somebody who already has one, the offer to go back. Last in the list,
   * so it never takes the number key a service already had.
   */
  const options: Option[] = useMemo(() => {
    if (!person || !LODGER_KINDS.has(person.kind)) return serviceOptions;
    const lodging = lodgingOf(state, person.id);
    const hosting: Option = lodging
      ? {
          label: `Ask ${person.name} to go back to where you found them`,
          why: sendHomeRefusal(world, state),
          run: () => onInput({ t: "sendHome" }),
        }
      : {
          label: `Invite ${person.name} to live in Hearth`,
          why: inviteRefusal(world, state),
          run: () => onInput({ t: "invite" }),
        };
    return [...serviceOptions, hosting];
  }, [serviceOptions, person, state, world, onInput]);

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

      {[
        ...dialogueOf(person, state.helped.includes(person.id)),
        ...(person.kind === "eggbuy" && state.eggsSold >= 2 ? EGG_BUYER_AFTER_TWO : []),
      ].map((line, index) => (
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
          ¤{PRINT_PRICE.toLocaleString()} a go, paid whether it prints or not. One in four comes out as
          sludge, and the machine needs {PRINT_COOLDOWN} moves between goes.
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

      {person.kind === "auction" ? <AuctionBoard world={world} state={state} /> : null}
      {person.kind === "pageant" ? <PageantBoard world={world} state={state} /> : null}
      {person.kind === "photoshoot" ? (
        // What he mumbles past, said plainly: nobody should lose a Ribbon by surprise.
        <p className="muted">
          {state.party.some((creature) => creature.ribbon)
            ? "The small print: the Ribbon is gone for good, and the creature comes back Burned Out — a tenth of the experience until Dr. Couch has seen it."
            : "Nobody in your party has a Ribbon."}
        </p>
      ) : null}
      {person.kind === "influence" ? (
        <p className="muted">
          {state.influencing
            ? (() => {
                const posted = state.stepsTaken - state.influencing.since;
                const next = fameToNext(state.influencing.creature, posted);
                return `${displayName(state.influencing.creature)} has been posted for ${posted.toLocaleString()} steps. ${
                  next === null ? "As famous as it gets." : `${next.toLocaleString()} more to the next level.`
                }`;
              })()
            : `Famous 1 after ${FAME_STEP.toLocaleString()} steps, Famous 2 after ${(FAME_STEP * 2).toLocaleString()} more, and so on to Famous 5 — each divided by its worth: one per shine rung, two for a colour, one per ability.`}
        </p>
      ) : null}
      {person.kind === "stream" ? (
        <p className="muted">
          {state.stream
            ? `Pool ¤${state.stream.pool.toLocaleString()}. One a step to stay live; below nothing and he pulls the plug.`
            : `Per foe knocked out, by level: ${STREAM_EARN.map((earn, at) => `Famous ${at + 1} ×${earn}`).join(", ")}. When the famous one faints: ${STREAM_FAINT.map((cost) => `-${cost.toLocaleString()}`).join(" / ")}.`}
        </p>
      ) : null}
      {person.kind === "therapy" ? (
        <p className="muted">
          {state.therapy
            ? therapyWait(state)
              ? `${displayName(state.therapy.creature)} is on the couch — ${therapyWait(state).toLocaleString()} more steps.`
              : `${displayName(state.therapy.creature)} is ready to go home.`
            : state.party.some((creature) => creature.traded || creature.prize || creature.burnedOut)
              ? "Rehabilitated: obeys at any level, double experience. Redeemed: triple experience and effort. A thousand steps on the couch."
              : "Nobody in your party is traded, a prize or burned out."}
        </p>
      ) : null}
      {person.kind === "tutor" ? (
        <TutorBoard world={world} state={state} picked={lesson} onPick={setLesson} />
      ) : null}
      {person.kind === "chromabuy" && !state.party.some((creature) => chromaCandyFor(creature)) ? (
        <p className="muted">Nobody in your party is wearing a colour.</p>
      ) : null}

      {person.kind === "lost" ? (
        <p className="muted small">
          {Object.keys(state.lost).length
            ? "Everything here left your hands some other way than being used: sold over a counter, carried off on the back of something you traded, planted, or used up by an evolution. The fee is the greater of what it is worth and ¤250."
            : "Nothing of yours has been handed in. Sell something, trade away a creature that was carrying something, or plant a berry, and it will find its way here."}
        </p>
      ) : null}

      {person.kind === "farm" ? (
        <div className="muted">
          <p className="small">
            {farmWorking(state.farm)
              ? `Five beds, three hands, a harvest of ${FARM_YIELD} every ${farmEvery(state.farm).toLocaleString()} steps — ${farmLeft(state.farm)?.toLocaleString()} to go. Better workers, quicker harvests.`
              : `Nothing grows until all three jobs are filled. ${FARM_JOBS.filter((job) => !state.farm.hands[job]).map((job) => FARM_WORK[job]).join(", ")} still wants somebody.`}
          </p>
          <p className="small">
            {state.farm.beds.map((bed, at) => `${at + 1}: ${bed ? item(bed).name : "fallow"}`).join(" · ")}
          </p>
          {basketCount(state.farm.basket) ? (
            <p className="small">
              In the basket:{" "}
              {bagEntries(state.farm.basket)
                .map(([id, count]) => `${item(id).name} x${count}`)
                .join(", ")}
              .
            </p>
          ) : null}
        </div>
      ) : null}

      {person.kind === "workshop" ? (
        <div className="muted">
          {WORKSHOP_STATIONS.map((station) => {
            const held = state.workshop[station];
            const job = { ice: "Ice cream (an Ice type)", fire: "Roast chicken (a Fire type)", water: "The garden (a Water type)" }[station];
            return (
              <p key={station}>
                {job}:{" "}
                {held
                  ? `${displayName(held.creature)}, Lv${held.creature.level} (arrived at Lv${held.fromLevel})`
                  : "nobody"}
              </p>
            );
          })}
          <p>One experience point per step you take. No new moves and no evolving while it works.</p>
        </div>
      ) : null}

      {person.kind === "pawn" ? (
        <p className="muted">
          ¤{PAWN_PER_LEVEL} for every level, and anything it is holding comes back to your bag. It does not come
          back.
          {pawnReady(state.stepsTaken, state.pawnedAt)
            ? ` One at a time: he needs ${PAWN_COOLDOWN} steps to sell each one on.`
            : ` He is still selling the last one on — ${pawnWait(state.stepsTaken, state.pawnedAt)} steps.`}
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
        <>
          <p className="muted">
            {network.reachable.length
              ? `${network.reachable.length} of their posts you have already walked to — ringed in green on the map. Click one.`
              : "Nowhere to send you yet — they only go back the way you have come."}
            {network.closed
              ? ` ${network.closed} more they keep, somewhere you have not been.`
              : ""}
          </p>
          {network.reachable.length ? (
            <div className="travelMap">
              <RegionMap
                world={world}
                state={state}
                outer={state.route}
                size={TRAVEL_MAP}
                reachable={network.reachable.map((stop) => stop.id)}
                onPick={(routeId) => onInput({ t: "npcTravel", route: routeId })}
              />
              <span className="muted small">Hover a dot for its name. The towns are on the buttons below.</span>
            </div>
          ) : null}
        </>
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
      ) : person.kind === "tutor" && !state.tutoring ? null : (
        // The tutor's board has its own "choose an ability" line, and saying
        // "nothing on offer" under eight offers would be the wrong half.
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
  const hard = difficulty(state.difficulty);
  const sums = gymBreakdown(spec, state.tick, state.badges.length, hard);

  return (
    <p className="muted">
      <strong>{spec.name}</strong> — {spec.team + hard.gymTeam} {spec.type} types at level{" "}
      <strong>{sums.total}</strong>. That is {sums.base} to start with, {sums.fromMoves} for the{" "}
      {state.tick.toLocaleString()} moves you have taken, and {sums.fromBadges} for the{" "}
      {state.badges.length} badges you already hold. Winning hands over {item(spec.tool).name}.
      {hard.gymEv ? (
        <>
          {" "}
          Everything they field has {hard.gymEv} effort spent and {hard.gymIv} in every stat
          {hard.gymHeld ? ", and is carrying something" : ""}.
        </>
      ) : null}
    </p>
  );
}


/**
 * A price, part by part, each marked against what you have: green where you
 * have enough, red with the count where you do not — "3 Pearl (you have 1)".
 */
function PriceLine({ price, state }: { price: readonly PricePart[]; state: GameState }) {
  return (
    <span className="priceLine">
      {price.map((part, at) => {
        const have = part.what === "money" ? state.money : (state.bag[part.what] ?? 0);
        const enough = have >= part.count;
        const label = part.what === "money" ? `¤${part.count.toLocaleString()}` : `${part.count} ${item(part.what).name}`;
        return (
          <span key={at} className={enough ? "good" : "error"}>
            {at > 0 ? " · " : ""}
            {label}
            {enough ? "" : ` (you have ${part.what === "money" ? `¤${have.toLocaleString()}` : have})`}
          </span>
        );
      })}
    </span>
  );
}

/**
 * The pageant's line-up: fifteen contestants, best first, each with its score.
 * Click one for its full sheet and how the score adds up.
 */
function PageantBoard({ world, state }: { world: World; state: GameState }) {
  const round = pageantRound(state.stepsTaken);
  const field = pageantField(world.seed, round)
    .map((creature) => ({ creature, score: pageantScore(creature) }))
    .sort((a, b) => b.score - a.score);
  const [looking, setLooking] = useState<number | null>(null);
  const shown = looking === null ? null : field.find((one) => one.creature.uid === looking);
  const next = PAGEANT_ROUND - (state.stepsTaken % PAGEANT_ROUND);

  return (
    <div className="auction">
      <p className="muted">
        This line-up for {next.toLocaleString()} more steps.{" "}
        {state.pageantEntered === round ? "You have entered this one." : "One entry per line-up."} Beat the top score to
        win a Ribbon.
      </p>
      <div className="auctionBoard">
        {field.map(({ creature, score }, at) => (
          <button
            key={creature.uid}
            type="button"
            className={`auctionLot${looking === creature.uid ? " looking" : ""}`}
            onClick={() => setLooking(looking === creature.uid ? null : creature.uid)}
          >
            <Sprite
              speciesId={creature.speciesId}
              variantId={creature.variantId}
              abilities={creature.abilities}
              heldItem={creature.heldItem}
              size={48}
            />
            <strong>{speciesById(creature.speciesId).name}</strong>
            <span className="muted">Lv{creature.level}</span>
            <span>
              {at === 0 ? "👑 " : ""}
              {score} pts
            </span>
          </button>
        ))}
      </div>
      {shown ? (
        <div className="auctionSheet">
          <p className="muted">
            {pageantParts(shown.creature)
              .filter((part) => part.points)
              .map((part) => `${part.label} ${part.points}`)
              .join(" + ")}{" "}
            = <strong>{shown.score}</strong>
          </p>
          <StatHover creature={atFullHealth(withMoves(shown.creature))} title="On the circuit" />
        </div>
      ) : (
        <p className="hint">Click a contestant for its sheet and how its score adds up.</p>
      )}
    </div>
  );
}

/**
 * The tutor's board: eight abilities, soonest to leave first, each with what it
 * does, what it costs and how long it stays up. Click one to choose it; the
 * party list under the conversation then says who can learn it.
 */
function TutorBoard({
  world,
  state,
  picked,
  onPick,
}: {
  world: World;
  state: GameState;
  picked: number | null;
  onPick: (n: number | null) => void;
}) {
  if (state.tutoring) {
    const wait = tutorWait(state);
    return (
      <p className={wait ? "muted" : "good"}>
        {displayName(state.tutoring.creature)} is learning {ability(state.tutoring.abilityId).name}.{" "}
        {wait ? `${wait.toLocaleString()} more steps.` : "It is ready to go home."}
      </p>
    );
  }

  const offers = tutorBoard(world.seed, state.stepsTaken);
  return (
    <div className="auction">
      <p className="muted">
        Pick an ability, then who learns it. The price is paid when you leave them, and they stay{" "}
        {TUTOR_STAY.toLocaleString()} steps. One comes off the board every {TUTOR_STEP.toLocaleString()} steps.
      </p>
      <div className="tutorBoard">
        {offers.map((offer) => {
          const left = offer.closesAt - state.stepsTaken;
          const spec = ability(offer.abilityId);
          return (
            <button
              key={offer.n}
              type="button"
              className={`tutorOffer${picked === offer.n ? " looking" : ""}`}
              aria-pressed={picked === offer.n}
              onClick={() => onPick(picked === offer.n ? null : offer.n)}
            >
              <strong>{spec.name}</strong>
              <span className="muted small">{spec.blurb}</span>
              <PriceLine price={offer.price} state={state} />
              <span className="muted small">
                {left.toLocaleString()} step{left === 1 ? "" : "s"} left on the board
              </span>
            </button>
          );
        })}
      </div>
      {picked === null ? <p className="hint">Choose an ability to see who can learn it.</p> : null}
    </div>
  );
}

/**
 * The board: six lots, soonest to close first, each with its countdown and
 * whether you are in on it. Closed lots you bid on stay listed below until
 * they are settled.
 */
function AuctionBoard({ world, state }: { world: World; state: GameState }) {
  const lots = board(world.seed, state.stepsTaken);
  const closed = closedBids(world, state);
  /*
   * The lot whose sheet is open. Clicking a lot shows exactly what a winning
   * bid delivers — `lotCreature`, given moves and health the way the engine
   * gives them on delivery — so what you inspect is what you would be paying
   * for, not a description of it.
   */
  const [looking, setLooking] = useState<number | null>(null);
  const inspected =
    looking !== null && lots.some((lot) => lot.n === looking)
      ? atFullHealth(withMoves(lotCreature(world.seed, looking)))
      : null;
  return (
    <div className="auction">
      <p className="muted">
        Every lot opens at a third of what it is worth and climbs toward it: every {AUCTION_TICK} steps
        somebody in the room may go a tenth higher, and the cheaper a lot still looks the likelier that is. By
        the time one closes it is usually going for about what it is worth. Bid and the money is held. If
        nobody outbids you before it closes, it is yours; if somebody does, you can go again at the new price
        or let it go and take every coin back. Settle closed lots here either way.
      </p>
      <div className="auctionBoard">
        {lots.map((lot) => {
          const bid = state.bids.find((one) => one.n === lot.n);
          const ask = askingPrice(world.seed, lot.n, state.stepsTaken);
          const mine = Boolean(bid) && bid!.price >= ask;
          const beaten = Boolean(bid) && bid!.price < ask;
          const left = lot.closesAt - state.stepsTaken;
          return (
            <button
              key={lot.n}
              type="button"
              className={`auctionLot${mine ? " bidOn" : ""}${beaten ? " outbid" : ""}${looking === lot.n ? " looking" : ""}`}
              title="Click for its full sheet"
              aria-pressed={looking === lot.n}
              onClick={() => setLooking(looking === lot.n ? null : lot.n)}
            >
              <Sprite
                speciesId={lot.speciesId}
                variantId={lot.variantId}
                abilities={lotCreature(world.seed, lot.n).abilities}
                size={96}
              />
              <strong>{speciesById(lot.speciesId).name}</strong>
              <span className="muted">Lv{lot.level}</span>
              <span>¤{ask.toLocaleString()}</span>
              <span className="muted" title={`Worth ¤${lot.price.toLocaleString()}`}>
                {(keenness(lot.price, ask) / 10).toFixed(0)}% a raise per {AUCTION_TICK}
              </span>
              <span className="muted">
                {left.toLocaleString()} step{left === 1 ? "" : "s"} left
              </span>
              {mine ? <span className="tag rise">YOUR BID</span> : null}
              {beaten ? <span className="tag fall">OUTBID ¤{bid!.price.toLocaleString()}</span> : null}
            </button>
          );
        })}
      </div>
      {inspected ? (
        <div className="auctionSheet">
          <StatHover creature={inspected} title={`Lot ${looking} — what a winning bid delivers`} />
          <button type="button" className="ghost small" onClick={() => setLooking(null)}>
            Close the sheet
          </button>
        </div>
      ) : (
        <p className="hint">Click a lot to see its full sheet before you bid.</p>
      )}
      {closed.length ? (
        <p className="good">
          Closed and waiting for you:{" "}
          {closed
            .map((bid) => speciesById(auctionLot(world.seed, bid.n).speciesId).name)
            .join(", ")}
          .
        </p>
      ) : null}
    </div>
  );
}
