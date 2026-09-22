"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BattleView } from "@/components/BattleView";
import { CheatMenu } from "@/components/CheatMenu";
import { EGG, EvolutionScene } from "@/components/EvolutionScene";
import { Inspect } from "@/components/Inspect";
import { DexPanel } from "@/components/DexPanel";
import { JournalPanel } from "@/components/JournalPanel";
import { isMuted, setMuted } from "@/lib/sound";
import { NewsFace } from "@/components/Doomscroller";
import { BigMaps, MiniMap, type BigMapsOpen } from "@/components/MiniMap";
import { PvpScreen } from "@/components/PvpScreen";
import { GameCanvas } from "@/components/GameCanvas";
import { ArenaPanel } from "@/components/ArenaPanel";
import { BagPanel } from "@/components/BagPanel";
import { FieldMovePanel } from "@/components/FieldMovePanel";
import { NotesPanel } from "@/components/NotesPanel";
import { QuestPanel } from "@/components/QuestPanel";
import { LearnPanel } from "@/components/LearnPanel";
import { TalkPanel } from "@/components/TalkPanel";
import { VaultScreen } from "@/components/VaultScreen";
import { entriesFromRun, mergeEntries, readVault, rosterOf, writeVault } from "@/lib/vault";
import { HubPanel } from "@/components/HubPanel";
import { MartPanel } from "@/components/MartPanel";
import { MainMenu, rememberedTrainerName, rememberTrainerName } from "@/components/MainMenu";
import { EggSlots, PartyStrip } from "@/components/PartyStrip";
import { StarterPick } from "@/components/StarterPick";
import { TouchPad } from "@/components/TouchPad";
import { timeOf, untilNext, TIME_NAMES } from "@/engine/daynight";
import { huntLeft } from "@/engine/hunt";
import type { NewsItem } from "@/engine/news";
import {
  joinFeed,
  readFriendPosts,
  writeFriendPosts,
  FRIENDS_ROOMS_MAX,
  cleanCodes,
  readFriendsCodes,
  writeFriendsCodes,
  FRIEND_POSTS_KEPT,
  type FeedRoom,
  type FriendPost,
} from "@/lib/friends";
import type { PartyStatus } from "@/lib/party";
import { joinPost, postId, type Bid, type Listing, type PostRoom } from "@/lib/post";
import { TradePost } from "@/components/TradePost";
import { stepToward } from "@/lib/pathing";
import { beatLength, beatsFor, catchFor } from "@/lib/beats";
import { BALLS, countOf, hasItem, item } from "@/engine/items";
import { ability } from "@/engine/abilities";
import { quest as questSpec, rewardText } from "@/engine/quests";
import { gym as gymSpec, LEVELS_PER_BADGE } from "@/engine/gyms";
import { ALL_SPECIES, move as moveById, species as speciesById } from "@/engine/dex";
import type { BattleAction } from "@/engine/battle";
import { applyInput, bestRod, EGGOMETER, cleanTrainerName, TRAINER_NAME_MAX, critterDoing, fishRefusal, FISH_STEPS, IllegalInput, initialState, pendingChanges, readyEgg, rivalCountdown, isWildBattle, opponentHint, opponentLabel, ownedAbilities, reduce, stateHash, type Notice, type Direction, type GameState, type Input } from "@/engine/engine";
import { DEFAULT_WORLD } from "@/engine/types";
import { generateWorld, type InteriorRole, type World } from "@/engine/world";
import {
  clearAutosave,
  downloadSave,
  flushAutosave,
  normaliseSeed,
  readAutosaves,
  newRunId,
  randomSeed,
  readAutosaveRaw,
  scheduleAutosave,
  type SaveFile,
} from "@/lib/save";
import { routeLabel } from "@/render/tiles";

interface Session {
  /** A random name for this run, kept in every save of it. See `SaveFile.run`. */
  run: string;
  world: World;
  seed: string;
  inputs: Input[];
  state: GameState;
}

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: "n",
  ArrowDown: "s",
  ArrowLeft: "w",
  ArrowRight: "e",
  w: "n",
  s: "s",
  a: "w",
  d: "e",
};

/**
 * How long a held direction waits before the next step.
 *
 * Holding a key used to walk you at **the operating system's** key-repeat
 * rate, which is a setting in a control panel somewhere: typically half a
 * second of nothing and then thirty steps a second. So the walk began with a
 * stutter, ran at a speed nobody chose, and was a different speed on the next
 * machine — which makes it not a game feel at all, it is whatever the player
 * happened to have configured for repeating a letter in a word processor.
 *
 * 120ms is about eight tiles a second, and it is *ours*: the first step is
 * immediate, the rest are evenly spaced, and a route is eighty-eight tiles
 * across, so crossing one is eleven seconds of holding a key rather than
 * eighty-eight presses.
 */
const STEP_INTERVAL = 120;

/**
 * What a room with no panel of its own says.
 *
 * Keyed on what the building is for, because the catch-all was "Somebody lives
 * here. There is nothing to do but look around" for *every* interior that was
 * not the daycare, the centre or the mart — which meant a gym hall said it
 * too, standing in front of a gym leader, and the Cup's house said it to five
 * people who were waiting to fight you.
 *
 * A missing entry falls back to the house line, which is the safe reading: the
 * worst a new sort of room can say is that somebody lives in it.
 */
const INDOORS_NOTE: Partial<Record<InteriorRole, string>> = {
  guest: "A guest room in Hearth's terraces. Anybody who runs something out in the world can live here once you have done business with them — talk to them and invite them.",
  house: "Somebody lives here. There is nothing to do but look around — step back out the way you came.",
  gym: "A gym. The leader is in here somewhere, and they are not waiting for you to be ready.",
  cup: "The Cup. Five of them, and whoever keeps the door. Nothing in this house gives a spent move back, so what is in your bag is what you have.",
};

/**
 * Whether the testing shortcuts exist at all.
 *
 * Only under `npm run dev`. Next inlines `NODE_ENV` at build time, so in a
 * production build this is the literal `false` and the menu, its shortcut and
 * everything only they import drop out of the bundle.
 *
 * The engine still accepts `cheat` inputs either way. A save made in dev has
 * them in its log, and it has to load, replay and verify (as cheated) anywhere.
 */
const CHEATS_AVAILABLE = process.env.NODE_ENV === "development";

/** Where the auto-continue box is remembered, per browser. Not in the save: it is a preference, not a game. */
const AUTO_CONTINUE_KEY = "pkm-fever.autoContinue";
/** Whether the feed is allowed to pop up. It keeps writing either way. */
const NEWS_MUTED_KEY = "pkm-fever.newsMuted";
/** How long a line from the feed sits in the corner. */
const NEWS_TOAST_MS = 6000;
/** How long a quiet battle end stays on screen before continuing by itself. */
const AUTO_CONTINUE_MS = 900;

/**
 * A save from before trainer names asks for one, once.
 *
 * Everything it has already caught is signed with the name the moment it is
 * given, so nothing is lost by choosing late.
 */
function TrainerPrompt({ onInput }: { onInput: (input: Input) => void }) {
  const [name, setName] = useState("");
  useEffect(() => setName(rememberedTrainerName()), []);
  const ok = cleanTrainerName(name).length > 0;
  return (
    <section className="panel">
      <h3>Choose a trainer name</h3>
      <p className="muted">It goes on everything you catch, as &ldquo;caught by&rdquo;, and stays with it through trades.</p>
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ok) return;
          rememberTrainerName(cleanTrainerName(name));
          onInput({ t: "trainer", name });
        }}
      >
        <input
          value={name}
          maxLength={TRAINER_NAME_MAX}
          onChange={(event) => setName(event.target.value)}
          aria-label="Trainer name"
          spellCheck={false}
        />
        <button type="submit" className="primary" disabled={!ok}>
          Save
        </button>
      </form>
    </section>
  );
}

/**
 * A short purple blink over the whole screen when poison hurts someone on the
 * map. Only for a tick that arrives while you watch: loading a save whose last
 * poison tick is already in it does not flash.
 */
function PoisonFlash({ at }: { at: number | null }) {
  const seen = useRef(at);
  const [flash, setFlash] = useState<number | null>(null);
  useEffect(() => {
    if (at === seen.current) return;
    seen.current = at;
    if (at == null) return;
    setFlash(at);
    const done = setTimeout(() => setFlash(null), 400);
    return () => clearTimeout(done);
  }, [at]);
  return flash == null ? null : <div key={flash} className="poisonFlash" aria-hidden="true" />;
}

/**
 * What sits in the map of rooms while a join is still in flight.
 *
 * A room that has been asked for but has not arrived yet still has to be in
 * the map, or a second render opens it again — and two swarms on one code is
 * every message twice. It is never called: the moment the real room lands it
 * takes this one's place, and if the code was dropped meanwhile the arriving
 * room leaves immediately.
 *
 * The map is the only thing that decides whether a room lives, and the two
 * effects below have no cleanup at all. That is deliberate and it is a bug
 * fix. They used to carry a `live` flag that every re-run flipped, and a join
 * still in flight when that happened resolved into `room.leave()` — which,
 * because the transport hands back the same underlying room for the same
 * code, tore down the *working* room the second pass had just made. React's
 * development mode runs every effect twice, so this fired most times a tab
 * loaded with a code already remembered: the connection said "1 other", and
 * nothing that other person said ever arrived. A room is left in exactly one
 * place now — the loop above, when its code is gone from the list — and a
 * tab closing takes the rest with it, which is what closing a tab does.
 */
const PENDING_FEED: FeedRoom = { say: () => {}, leave: () => {} };
const PENDING_POST: PostRoom = {
  show: () => {},
  bid: () => {},
  pull: () => {},
  strike: () => {},
  decline: () => {},
  leave: () => {},
};

export default function Page() {
  const [session, setSession] = useState<Session | null>(null);
  /**
   * The live state, for the room handlers.
   *
   * They are built once, when a room is joined, and outlive every render
   * after it — so anything of the game they need has to be read through a
   * ref rather than closed over.
   */
  const stateRef = useRef<GameState | null>(null);
  /**
   * What to call us, asked at the moment a line is sent.
   *
   * Not read when a room is joined: a code remembered in this browser is
   * rejoined as the page loads, before a save has been continued, so a name
   * taken then is "Somebody" for the whole sitting — which is what every line
   * reaching a friend used to say.
   */
  const trainerName = useCallback(() => stateRef.current?.trainerName || "Somebody", []);
  const [autosaves, setAutosaves] = useState<SaveFile[]>([]);
  const [pvp, setPvp] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [vaultNote, setVaultNote] = useState<string | null>(null);
  const [cheats, setCheats] = useState(false);
  /**
   * The evolution notice whose reveal has already been sat through.
   *
   * The notice object itself rather than a boolean, so nothing has to reset
   * it: every notice is a fresh object, so the next stone is a different
   * object and shows its own scene. The battle's version of this keys on the
   * turn instead, because a battle can produce several and they arrive in the
   * same object.
   */
  const [seenEvolution, setSeenEvolution] = useState<Notice | null>(null);
  /** uid of whatever is being looked at, or null. */
  const [inspecting, setInspecting] = useState<number | null>(null);
  // Sound on or off. Read once the page is in a browser, like the autosave.
  const [muted, setMutedState] = useState(false);
  useEffect(() => setMutedState(isMuted()), []);

  // localStorage is not available while the static export is being rendered,
  // so the autosave is looked up once the page is actually in a browser.
  useEffect(() => setAutosaves(readAutosaves()), []);

  const start = useCallback((seed: string, inputs: Input[] = [], run: string = newRunId()) => {
    const clean = normaliseSeed(seed);
    const world = generateWorld(DEFAULT_WORLD, clean, ALL_SPECIES);
    try {
      setSession({ run, world, seed: clean, inputs, state: reduce(world, inputs) });
    } catch {
      // A log that will not replay is a corrupt save, not a playable one.
      setSession({ run, world, seed: clean, inputs: [], state: initialState(world) });
    }
  }, []);

  /**
   * The only way state ever changes.
   *
   * The input log is the source of truth and the state is derived from it, so
   * what the browser holds is exactly what a save file holds. An input the
   * engine refuses — walking into a tree — is dropped rather than recorded:
   * the log must stay replayable.
   */
  const dispatch = useCallback((input: Input) => {
    setSession((current) => {
      if (!current) return current;
      try {
        const state = applyInput(current.world, current.state, input);
        return { ...current, inputs: [...current.inputs, input], state };
      } catch (error) {
        /**
         * A refusal is ordinary. Anything else is a bug wearing a refusal's
         * clothes, and it says so out loud.
         *
         * `IllegalInput` is the engine saying no — walking into a tree, a
         * potion in a battle, a deposit outside the daycare — and it happens
         * constantly and correctly. Every *other* throw that lands here is a
         * crash, and this `catch` is exactly wide enough to hide one: the
         * Toxic bug spent months reaching the player as "that move is not
         * legal" because `STATUS_IMMUNE["tox"]` was undefined and `.includes`
         * threw from a move that was perfectly legal. It took a hundred
         * battles of a probe to find something a single line here would have
         * named on the first occurrence.
         *
         * The session is still kept rather than torn down. A crash in one
         * input should cost that input, not the playthrough — the log is
         * intact and the state is the last good one, which is the most
         * recoverable position there is.
         */
        if (!(error instanceof IllegalInput)) {
          console.error("[pkm-fever] input crashed the engine", input, error);
        }
        return current;
      }
    });
  }, []);

  /**
   * The autosave, on a timer rather than on every keystroke.
   *
   * It used to be written from inside the state updater above, once per input.
   * That is a side effect in a function React is allowed to call twice, and it
   * serialises the *entire* log every step — which is nothing at a hundred
   * inputs and a dropped frame every step by the time a save is worth having.
   *
   * Here it is an effect over the log, debounced, so the cost is proportional
   * to how long you play rather than to how fast you walk. `flushAutosave`
   * pays whatever is owed when the tab goes away, which is the one moment a
   * debounce would otherwise cost real progress.
   */
  useEffect(() => {
    if (!session) return;
    // The roster rides along so the vault can read this run's creatures even
    // after a later engine can no longer replay its log.
    scheduleAutosave(session.seed, session.inputs, rosterOf(session.state), session.run);
  }, [session]);

  useEffect(() => {
    // `pagehide` rather than `beforeunload`: it fires on a mobile tab being
    // backgrounded, which is how a phone ends a session, and `beforeunload`
    // does not.
    const flush = () => flushAutosave();
    const onHidden = () => {
      if (document.visibilityState === "hidden") flushAutosave();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
      flushAutosave();
    };
  }, []);

  const state = session?.state;
  // Read by the room handlers, which outlive the render that built them.
  stateRef.current = state ?? null;

  /**
   * The evolution to sit through, if a stone produced one and it has not been.
   *
   * Bound here rather than read out of `state.notice` inside the JSX, because
   * the variant lookup is a callback and TypeScript drops the narrowing from
   * `notice.t === "evolved"` the moment the access happens inside one. The
   * alternative was a cast, which would have been a way of insisting the
   * notice is the shape it is rather than showing it.
   */
  // Not after answering an offer: that scene has just played, and showing the
  // reveal again on the notice it leaves behind was the evolution playing twice.
  const evolved =
    state?.notice?.t === "evolved" && !state.notice.watched && seenEvolution !== state.notice
      ? state.notice
      : null;

  /**
   * An evolution waiting to be answered, and the creature it is about.
   *
   * The other half of the same screen, and the reason `EvolutionScene` grew a
   * cancel. Growing into a change no longer applies it: the engine records an
   * offer, this plays it, and whichever way the scene ends goes back as an
   * input — so a save replays the answer the player actually gave rather than
   * evolving what they refused.
   *
   * Only out of a battle. `evolveRefusal` allows the field and the aftermath
   * of a fight and nothing else, which is where these games have always put
   * it: mid-battle is no time to be asked, and twenty seconds of animation
   * over a fight that is still going is worse than no scene at all.
   */
  /** An egg ready to open, out in the field and nowhere else. */
  const hatching = state?.phase === "field" ? readyEgg(state) : null;

  const offered = (() => {
    if (!state) return null;
    if (state.phase !== "field" && state.phase !== "battleEnd") return null;
    const [first] = pendingChanges(state);
    return first ?? null;
  })();

  /**
   * Which directions are held, in the order they were pressed.
   *
   * A list rather than one direction, and the **last** one wins. Rolling a
   * thumb from one arrow to the next without letting go of the first is how
   * anybody actually turns a corner at speed, and with a single slot that
   * reads as the turn being ignored until the old key comes up.
   */
  const held = useRef<Direction[]>([]);
  const walkTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * Whether a step is legal at all, in a ref.
   *
   * The timer below must not be torn down and rebuilt every time the state
   * changes — which is every step — so it reads this instead of closing over
   * `state`.
   */
  const canWalk = useRef(false);
  /** Where a tap or click on a map asked to walk to, on the route it was asked on. */
  const [walkTarget, setWalkTarget] = useState<{ route: string; x: number; y: number } | null>(null);
  const [bigMaps, setBigMaps] = useState<BigMapsOpen>({ local: false, region: false });
  /** An item the bag should open, asked for from outside it: the Fly button. */
  const [openBagItem, setOpenBagItem] = useState<{ item: string; at: number } | null>(null);

  /*
   * The feed, in the corner.
   *
   * The newest line, for a few seconds, and then gone — the feed keeps every
   * one of them and the Doomscroller reads them back, so nothing is lost by
   * missing one. Muting stops the corner and nothing else: a feed you have
   * muted is still a feed, which is the joke and also what you would want.
   */
  const [newsMuted, setNewsMuted] = useState(false);
  /**
   * Muting, and the way back from it.
   *
   * The button that mutes lives on the thing being muted, which meant that
   * once it was pressed there was nothing left on screen to press again — a
   * door that only opened one way, and a save file you had to edit to undo a
   * click. It is a toggle in two places now: beside the sound, where it can
   * always be reached, and on the feed's own panel, next to the line that
   * mentions muting in the first place.
   */
  const muteNews = useCallback((quiet: boolean) => {
    setNewsMuted(quiet);
    if (quiet) setShown(null);
    try {
      if (quiet) localStorage.setItem(NEWS_MUTED_KEY, "1");
      else localStorage.removeItem(NEWS_MUTED_KEY);
    } catch {
      // No storage: it holds for this sitting, which is what was asked.
    }
  }, []);
  useEffect(() => {
    try {
      setNewsMuted(localStorage.getItem(NEWS_MUTED_KEY) === "1");
    } catch {
      // No storage: it simply starts unmuted.
    }
  }, []);
  /*
   * The friends' feed: everybody on a room code shouting their own lines.
   *
   * Several codes at once, because friends are not one group - see
   * `FRIENDS_ROOMS_MAX`. Each code is its own swarm with its own status and
   * its own head count; what they share is the one pile of posts, each
   * tagged with the room it arrived on.
   *
   * Kept out of the game state on purpose. What a friend says happened in
   * their game is a claim about somebody else's save, and the engine takes
   * nothing from the network - so this lives in the page and in this
   * browser's storage, and the Doomscroller reads it there.
   */
  const [friendsCodes, setFriendsCodes] = useState<string[]>([]);
  const [friendsStatus, setFriendsStatus] = useState<Record<string, PartyStatus | null>>({});
  const [friendsHere, setFriendsHere] = useState<Record<string, number>>({});
  const [friendPosts, setFriendPosts] = useState<FriendPost[]>([]);
  const feedRooms = useRef<Map<string, FeedRoom>>(new Map());
  useEffect(() => {
    setFriendPosts(readFriendPosts());
    setFriendsCodes(readFriendsCodes());
  }, []);

  /**
   * Every code we are in, joined; everything else, left.
   *
   * A diff against what is already open rather than a teardown and rebuild,
   * because a swarm takes seconds to form and adding a fourth room should
   * not drop the three that are working.
   */
  const joinedFeeds = friendsCodes.join(",");
  useEffect(() => {
    const wanted = joinedFeeds ? joinedFeeds.split(",") : [];
    const open = feedRooms.current;

    for (const [code, room] of [...open]) {
      if (wanted.includes(code)) continue;
      room.leave();
      open.delete(code);
      setFriendsStatus((before) => ({ ...before, [code]: null }));
      setFriendsHere((before) => ({ ...before, [code]: 0 }));
    }

    for (const code of wanted) {
      if (open.has(code)) continue;
      // Held before the promise settles, so two renders in a row cannot open
      // the same room twice.
      open.set(code, PENDING_FEED);
      void joinFeed(code, trainerName, {
        onPost: (post) =>
          setFriendPosts((before) => {
            const next = [...before, { ...post, code }].slice(-FRIEND_POSTS_KEPT);
            writeFriendPosts(next);
            return next;
          }),
        onStatus: (status) => setFriendsStatus((before) => ({ ...before, [code]: status })),
        onCount: (count) => setFriendsHere((before) => ({ ...before, [code]: count })),
      }).then((room) => {
        // Still wanted, and still the join this placeholder was left for.
        if (open.get(code) !== PENDING_FEED) {
          room.leave();
          return;
        }
        open.set(code, room);
      });
    }
    // `trainerName` is stable — it reads the name through a ref when a line
    // is sent, so it never re-joins a room.
  }, [joinedFeeds, trainerName]);

  /*
   * Tim's board, on the same room code the feed uses.
   *
   * Everything here is other people's browsers talking. None of it is state:
   * a listing is somebody's word, and only a deal both sides pressed reaches
   * the engine — as an ordinary input, on each side separately.
   */
  const [boards, setBoards] = useState<Record<string, Listing[]>>({});
  const [myListings, setMyListings] = useState<Listing[]>([]);
  const [bids, setBids] = useState<Bid[]>([]);
  /**
   * What we offered in each bid we sent, by bid id.
   *
   * Our own bids never reach `bids` - that is the pile of what other people
   * have offered *us* - so without this a struck deal had nothing to hand
   * over and the creature we bid stayed in the party.
   */
  const sentBids = useRef<Record<string, number>>({});
  const postRooms = useRef<Map<string, PostRoom>>(new Map());
  const listingsRef = useRef<Listing[]>([]);

  useEffect(() => {
    const wanted = joinedFeeds ? joinedFeeds.split(",") : [];
    const open = postRooms.current;

    for (const [code, room] of [...open]) {
      if (wanted.includes(code)) continue;
      room.leave();
      open.delete(code);
      // A board only exists while its room does.
      setBoards((before) => {
        const next: Record<string, Listing[]> = {};
        for (const [key, listings] of Object.entries(before)) {
          if (!key.startsWith(code + ":")) next[key] = listings;
        }
        return next;
      });
      setBids((before) => before.filter((one) => one.code !== code));
    }

    for (const code of wanted) {
      if (open.has(code)) continue;
      open.set(code, PENDING_POST);
      void joinPost(code, trainerName, {
        onBoard: (from, who, listings) =>
          setBoards((before) => ({
            ...before,
            [code + ":" + from]: listings.map((one) => ({ ...one, who, code })),
          })),
        onBid: (bid) => setBids((before) => [...before.filter((one) => one.id !== bid.id), { ...bid, code }]),
        onPull: (id) => setBids((before) => before.filter((one) => one.id !== id)),
        onDeclined: () => {
          // Their no is only ours to hear: the listing stays up and the bid we
          // made is simply gone from their board.
        },
        onStruck: (deal) => {
          // Their half is done. Ours is the mirror of it: what they gave, we
          // receive; what they took, we pay.
          // What we put up for it: our own bid, or - if this is somehow an
          // answer to somebody else's - nothing of ours goes.
          const offeredUid = sentBids.current[deal.bid];
          const giving =
            offeredUid === undefined ? -1 : (stateRef.current?.party.findIndex((one) => one.uid === offeredUid) ?? -1);
          delete sentBids.current[deal.bid];
          dispatch({
            t: "postDeal",
            give: giving >= 0 ? giving : null,
            receive: deal.creature,
            paid: -(deal.cash ?? 0),
            who: deal.who,
          });
          setBids((before) => before.filter((one) => one.id !== deal.bid));
        },
        onStatus: () => {
          /* The feed's own status line is the one worth showing. */
        },
        onGone: (from) =>
          setBoards((before) => {
            const next = { ...before };
            delete next[code + ":" + from];
            return next;
          }),
      }).then((room) => {
        if (open.get(code) !== PENDING_POST) {
          room.leave();
          return;
        }
        open.set(code, room);
        // Whatever we already have up goes onto the new board too.
        room.show(
          listingsRef.current.map(({ id, who, creature, asking, wants }) => ({ id, who, creature, asking, wants })),
        );
      });
    }

    // `trainerName` is stable, like the feed's.
  }, [joinedFeeds, dispatch, trainerName]);

  // What the handlers above need to read without re-joining the room.
  listingsRef.current = myListings;

  /** Our board, shouted again to every room we are in whenever it changes. */
  const showBoard = useCallback((listings: Listing[]) => {
    setMyListings(listings);
    const wire = listings.map(({ id, who, creature, asking, wants }) => ({ id, who, creature, asking, wants }));
    for (const room of postRooms.current.values()) room.show(wire);
  }, []);

  /**
   * The room of friends, in one object.
   *
   * Two places want it now — the Doomscroller's Friends tab and the button
   * under the node map — and a fresh object built in each of their props
   * would be two rooms that happened to agree, plus a re-render of both on
   * every keystroke.
   */
  const friendsRoom = useMemo(
    () => ({
      codes: friendsCodes,
      status: friendsStatus,
      here: friendsHere,
      posts: friendPosts,
      max: FRIENDS_ROOMS_MAX,
      onJoin: (code: string) =>
        setFriendsCodes((before) => {
          const next = cleanCodes([...before, code]);
          writeFriendsCodes(next);
          return next;
        }),
      onLeave: (code: string) =>
        setFriendsCodes((before) => {
          const next = before.filter((one) => one !== code);
          writeFriendsCodes(next);
          return next;
        }),
    }),
    [friendsCodes, friendsStatus, friendsHere, friendPosts],
  );

  const news = state?.news;
  const latest = news?.at(-1) ?? null;

  /*
   * Our own lines, out to every room.
   *
   * Everything written since the last one we sent, not just the newest: one
   * input can write two lines — winning a fight and the fifty that the
   * experience for it crossed — and sending "the latest" dropped the first
   * of them. It used to remember the step count it last spoke on, which was
   * worse again: a battle does not move your step count, so a second line in
   * the same fight looked like one already said.
   *
   * The line itself is remembered, and the feed is append-only, so "the ones
   * after that one" is exactly "the ones not yet said". Nothing is replayed
   * to somebody who joins later: a feed that shouted your last forty lines at
   * every arrival would be a feed nobody kept open.
   */
  const said = useRef<NewsItem | null>(null);
  useEffect(() => {
    if (!news?.length || !feedRooms.current.size) return;
    const from = said.current ? news.indexOf(said.current) : -1;
    if (from < 0) {
      // Nothing of ours to match against: this is the first pass, a loaded
      // save, or a room joined just now. Whatever is already in the feed is
      // old, so it becomes the mark and nothing goes out — otherwise every
      // reload would announce the last line again to everybody listening.
      said.current = news[news.length - 1];
      return;
    }
    const fresh = news.slice(from + 1);
    if (!fresh.length) return;
    said.current = news[news.length - 1];
    for (const room of feedRooms.current.values()) {
      for (const item of fresh) room.say(item);
    }
    // `joinedFeeds` so that joining a room sets the mark rather than
    // shouting whatever was last said before it was joined.
  }, [news, joinedFeeds]);
  const [shown, setShown] = useState<NewsItem | null>(null);
  useEffect(() => {
    if (!latest || newsMuted) return;
    setShown(latest);
    const timer = setTimeout(() => setShown(null), NEWS_TOAST_MS);
    return () => clearTimeout(timer);
  }, [latest, newsMuted]);

  /*
   * And a friend's line pops up the same way.
   *
   * Subscribing to somebody was only visible inside the Doomscroller's
   * Friends tab, which is an item found hours in — so for most of a run the
   * answer to "did that reach them?" was that it had, silently, where nobody
   * was looking. Same strip, same mute, and never on the first render: posts
   * read back from storage are old news by definition.
   */
  const [heard, setHeard] = useState<FriendPost | null>(null);
  const lastHeard = useRef<FriendPost | null>(null);
  /**
   * Whether the first pass has gone by.
   *
   * Its own flag rather than "there was a post before this one", which is the
   * same thing only when there *was* one: a browser subscribing for the first
   * time has none, so the first line a friend ever sent looked like the
   * restored-from-storage case and was swallowed.
   */
  const settled = useRef(false);
  const newestPost = friendPosts.at(-1) ?? null;
  useEffect(() => {
    const before = lastHeard.current;
    lastHeard.current = newestPost;
    if (!settled.current) {
      settled.current = true;
      return;
    }
    if (!newestPost || newestPost === before || newsMuted) return;
    setHeard(newestPost);
    const timer = setTimeout(() => setHeard(null), NEWS_TOAST_MS);
    return () => clearTimeout(timer);
  }, [newestPost, newsMuted]);
  const changeBigMaps = useCallback((change: Partial<BigMapsOpen>) => setBigMaps((open) => ({ ...open, ...change })), []);
  // Not while a hatching or an evolution is on screen: a key still held from
  // the last step would otherwise walk on underneath the scene.
  const sceneUp = Boolean(hatching || offered);
  useEffect(() => {
    canWalk.current = state?.phase === "field" && !sceneUp;
  }, [state?.phase, sceneUp]);

  const stopWalking = useCallback(() => {
    if (walkTimer.current === null) return;
    clearInterval(walkTimer.current);
    walkTimer.current = null;
  }, []);

  const startWalking = useCallback(() => {
    if (walkTimer.current !== null) return;
    walkTimer.current = setInterval(() => {
      const dir = held.current[held.current.length - 1];
      // Nothing held, or a battle started under us. Either way the walk is
      // over: stepping out of an encounter because a key was still down is
      // exactly the input nobody meant to give.
      if (!dir || !canWalk.current) {
        stopWalking();
        return;
      }
      dispatch({ t: "move", dir });
    }, STEP_INTERVAL);
  }, [dispatch, stopWalking]);

  // A key held while the window loses focus never sends its keyup, so without
  // this, alt-tabbing away mid-stride leaves the player walking forever.
  useEffect(() => {
    const release = () => {
      held.current = [];
      stopWalking();
    };
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("blur", release);
      release();
    };
  }, [stopWalking]);

  useEffect(() => {
    if (!state) return;

    function onKeyUp(event: KeyboardEvent) {
      const dir = KEY_DIRECTIONS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (!dir) return;
      held.current = held.current.filter((one) => one !== dir);
      if (!held.current.length) stopWalking();
    }

    function onKey(event: KeyboardEvent) {
      if (!state) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

      // Somebody typing a room code should not be walking across a route at
      // eight tiles a second, which is what WASD in a text box became the
      // moment holding a key meant something.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      // Three modifiers and a letter, so nothing reaches it by accident.
      if (CHEATS_AVAILABLE && event.ctrlKey && event.shiftKey && event.altKey && key === "z") {
        event.preventDefault();
        setCheats((open) => !open);
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      if (state.phase === "field") {
        // F for the rod. Silently ignored where there is no water or no rod,
        // exactly as the button is greyed out there: a keybind that threw
        // would be a keybind that punished you for pressing it inland.
        if (key === "f" && !event.repeat) {
          event.preventDefault();
          if (session && !fishRefusal(session.world, state)) dispatch({ t: "fish" });
          return;
        }

        const dir = KEY_DIRECTIONS[key];
        if (!dir) return;
        event.preventDefault();
        // The operating system's own repeat, thrown away. The cadence is
        // `STEP_INTERVAL`'s to set, and honouring both would be two walks
        // racing each other.
        if (event.repeat) return;
        if (!held.current.includes(dir)) held.current.push(dir);
        // A key always wins over a tap: the walk it started is over.
        setWalkTarget(null);
        dispatch({ t: "move", dir });
        startWalking();
        return;
      }

      if (state.phase === "battleEnd") {
        if (key === "Enter" || key === " ") {
          event.preventDefault();
          dispatch({ t: "continue" });
        }
        return;
      }

      // awaitingSwitch is a pair, so testing the array itself is permanently
      // truthy and the negation permanently false — which killed every battle
      // key. Side 0 is us; a replacement is chosen from the party strip, not
      // the keyboard.
      if (state.phase === "battle" && state.battle && !state.battle.awaitingSwitch[0]) {
        // The same guard the field path has, for the same reason and one more.
        // A key held down while walking is still held when the grass produces
        // something, and the operating system's repeat arrives here as though
        // it were a fresh press — so a battle could be a move deep before the
        // player had seen what they had run into.
        if (event.repeat) return;
        if (key >= "1" && key <= "4") {
          event.preventDefault();
          dispatch({ t: "fight", moveIndex: Number(key) - 1 });
        } else if (key === "b" && isWildBattle(state.battle)) {
          event.preventDefault();
          dispatch({ t: "ball" });
        } else if (key === "r" && isWildBattle(state.battle)) {
          event.preventDefault();
          dispatch({ t: "flee" });
        }
      }
    }

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [state, session, dispatch, startWalking, stopWalking]);

  // What you can do is a property of where you are standing. The daycare and
  // the centre are buildings now, so their panels appear when you are inside
  // one rather than following you around town.
  const here = state ? session?.world.routes.get(state.route) : undefined;
  const indoors = state?.phase === "field" && here?.kind === "interior";
  const inDaycare = indoors && here?.role === "daycare";
  const inCentre = indoors && here?.role === "centre";
  const inMart = indoors && here?.role === "mart";
  const inHub = inDaycare || inCentre;

  /** What the inspector is looking at, and whether it is in the party — which
   * decides whether its moves can be rearranged. */
  const inspected = useMemo(() => {
    if (!state || inspecting === null) return null;
    const index = state.party.findIndex((creature) => creature.uid === inspecting);
    if (index >= 0) return { creature: state.party[index], index };
    const boxed = state.box.find((creature) => creature.uid === inspecting);
    return boxed ? { creature: boxed, index: -1 } : null;
  }, [state, inspecting]);

  /*
   * Continuing past a battle by itself, for a player who has ticked the box —
   * off by default, because reading the log back is how some people play.
   * Only when nothing worth stopping for happened: no level, no move learned
   * or offered, no evolution. A short pause first, so the last line of the
   * log is on screen before the field is.
   */
  const [autoContinue, setAutoContinue] = useState(false);
  useEffect(() => {
    try {
      setAutoContinue(localStorage.getItem(AUTO_CONTINUE_KEY) === "1");
    } catch {
      // No storage: the box simply starts unticked.
    }
  }, []);
  const quietEnd =
    state?.phase === "battleEnd" &&
    !(state.battle?.events ?? []).some(
      (event) => event.t === "exp" && (event.levels > 0 || event.learned.length > 0 || event.offered.length > 0 || Boolean(event.evolved)),
    );
  // The last turn's animation first — a ball's flight, wobbles and stars, or a
  // faint — so a catch is seen landing rather than cut off by the field.
  const lastTurn = state?.phase === "battleEnd" && state.battle ? state.battle : null;
  const lastCatch = lastTurn ? catchFor(lastTurn.events, lastTurn.turn) : null;
  const tail = lastTurn
    ? Math.max(
        lastCatch?.length ?? 0,
        beatLength(beatsFor(lastTurn.events, lastCatch?.outcome === "escaped" ? lastCatch.length : 0)),
      )
    : 0;
  useEffect(() => {
    if (!autoContinue || !quietEnd) return;
    const timer = setTimeout(() => dispatch({ t: "continue" }), AUTO_CONTINUE_MS + tail);
    return () => clearTimeout(timer);
  }, [autoContinue, quietEnd, state?.tick, dispatch, tail]);

  /*
   * Tap-to-walk. One ordinary step every `STEP_INTERVAL` toward the tile that
   * was pointed at, the step worked out again each time from where you are —
   * so the log holds nothing but moves. It stops on arrival, on a
   * conversation or a door into somewhere else, and when a step goes nowhere,
   * which is the engine refusing it. A battle or a hatching only pauses it:
   * the walk picks up where it left off once you are back on the field — unless
   * the battle ended somewhere else, at a nurse, which is a different route.
   */
  useEffect(() => {
    if (!walkTarget || !state || !session) return;
    if (state.phase === "battle" || state.phase === "battleEnd" || sceneUp) return;
    const done =
      state.phase !== "field" ||
      state.talking !== null ||
      state.route !== walkTarget.route ||
      (state.x === walkTarget.x && state.y === walkTarget.y);
    const dir = done ? null : stepToward(session.world, state, walkTarget);
    if (!dir) {
      setWalkTarget(null);
      return;
    }
    const step = setTimeout(() => dispatch({ t: "move", dir }), STEP_INTERVAL);
    // Nothing changed after the step was sent: it was refused, and the walk ends.
    const stuck = setTimeout(() => setWalkTarget(null), STEP_INTERVAL * 4);
    return () => {
      clearTimeout(step);
      clearTimeout(stuck);
    };
  }, [walkTarget, state, session, sceneUp, dispatch]);

  /** A tile pointed at on a map: walk there, or stop if it is where you already are. */
  const walkTo = useCallback(
    (x: number, y: number) => {
      if (!state) return;
      setWalkTarget(state.x === x && state.y === y ? null : { route: state.route, x, y });
    },
    [state],
  );

  /** The on-screen pad: a direction held down, the same as a key held down. */
  const padDown = useCallback(
    (dir: Direction) => {
      if (!canWalk.current) return;
      setWalkTarget(null);
      if (!held.current.includes(dir)) held.current.push(dir);
      dispatch({ t: "move", dir });
      startWalking();
    },
    [dispatch, startWalking],
  );
  const padUp = useCallback(
    (dir: Direction) => {
      held.current = held.current.filter((one) => one !== dir);
      if (!held.current.length) stopWalking();
    },
    [stopWalking],
  );

  if ((!session || !state) && vaultOpen) {
    return (
      <main className="shell">
        <VaultScreen
          autosave={readAutosaveRaw()}
          onExit={() => setVaultOpen(false)}
          onBegin={(seed, trainer, creatures, hard) => {
            clearAutosave();
            setVaultOpen(false);
            start(seed, [
              { t: "trainer", name: trainer },
              // Before the creature arrives, because it is only legal while
              // the run has not started.
              { t: "setDifficulty", id: hard },
              // The first one on its own as well as the whole team: a log
              // written here is read by engines that predate taking three.
              { t: "vaultStart", creature: creatures[0], creatures },
            ]);
          }}
        />
      </main>
    );
  }

  if (!session || !state) {
    return (
      <main className="shell">
        <MainMenu
          onVault={() => setVaultOpen(true)}
          autosaves={autosaves}
          onNew={(seed, trainer) => {
            clearAutosave();
            // The name is the first input, so it is in the save like
            // everything else and replays onto every creature caught.
            start(seed, [{ t: "trainer", name: trainer }]);
          }}
          onLoad={(save) => start(save.seed, save.inputs, save.run)}
        />
      </main>
    );
  }

  if (pvp) {
    return (
      <main className="shell">
        <PvpScreen
          roster={[...state.party, ...state.box]}
          seed={session.world.seed}
          moves={session.inputs.length}
          onExit={() => setPvp(false)}
          onPrize={(creature) => dispatch({ t: "prize", receive: creature })}
          onTrade={(giveUid, received) => {
            const give = state.party.findIndex((creature) => creature.uid === giveUid);
            if (give >= 0) dispatch({ t: "trade", give, receive: received });
          }}
        />
      </main>
    );
  }

  if (state.phase === "starter") {
    return (
      <main className="shell">
        <StarterPick
          world={session.world}
          chosen={state.difficulty}
          onDifficulty={(id) => dispatch({ t: "setDifficulty", id })}
          onPick={(index) => dispatch({ t: "pickStarter", index })}
          // A new world on a new seed, keeping what was already decided before
          // the pick — the trainer's name, a vault creature — so rerolling is
          // only ever a different three to choose from.
          onReroll={() => {
            clearAutosave();
            start(randomSeed(), session.inputs.filter((input) => input.t !== "pickStarter"));
          }}
        />
      </main>
    );
  }

  /**
   * Who you have, built once and shown in one of two places.
   *
   * Beside the field during a battle, under the map while you are walking, and
   * nowhere at all in a town, where the hub panel already lists everybody.
   * One panel rather than two, because two would be two answers to the same
   * question and they would drift.
   */
  const fighting = state.phase === "battle" || state.phase === "battleEnd";
  //
  // Given a callback when the battle wants somebody sent out, in which case the
  // cards become the thing you press and the panel says so. Reordering and the
  // full sheet are withheld while choosing: a click meant to send a creature
  // out should not sometimes open a stat screen instead.
  const partyPanel = (choosing: ((index: number) => void) | null) => (
    <section className={`panel${choosing ? " choosing" : ""}`}>
      <h3>{choosing ? "Send out who?" : "Party"}</h3>
      <PartyStrip
        party={state.party}
        activeIndex={state.battle?.sides[0].active}
        onSelect={choosing ?? undefined}
        onInspect={choosing ? undefined : setInspecting}
        onReorder={choosing ? undefined : (from, to) => dispatch({ t: "reorderParty", from, to })}
      />
      <EggSlots eggs={state.eggs} exact={hasItem(state.bag, EGGOMETER)} />
    </section>
  );

  return (
    <main className="shell game">
      <header className="hud">
        <div>
          <h2>{here?.label ?? routeLabel(state.route)}</h2>
          <p className="muted">
            seed <code>{session.seed}</code> · {session.inputs.length} moves · hash <code>{stateHash(state)}</code> ·{" "}
            <span title={`${untilNext(state.stepsTaken).toLocaleString()} steps until it changes`}>
              {TIME_NAMES[timeOf(state.stepsTaken)]}
            </span>
          </p>
        </div>
        <div className="hudStats">
          <div>
            <dt>Money</dt>
            <dd>¤{state.money.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Balls</dt>
            <dd>{BALLS.reduce((total, ball) => total + countOf(state.bag, ball.id), 0)}</dd>
          </div>
          <div>
            <dt>Badges</dt>
            <dd>{state.badges.length} of 8</dd>
          </div>
          <div>
            <dt>Boxed</dt>
            <dd>{state.box.length}</dd>
          </div>
        </div>
      </header>

      {state?.talking === "trader" && session && state ? (
        <TradePost
          state={state}
          codes={friendsCodes}
          here={Object.keys(boards).length}
          listings={Object.values(boards).flat()}
          mine={myListings}
          bids={bids}
          onList={(index, asking, wants) => {
            const creature = state.party[index];
            if (!creature) return;
            showBoard([
              ...myListings,
              {
                id: postId(),
                who: state.trainerName || "Somebody",
                from: "me",
                creature,
                asking,
                wants,
                heard: Date.now(),
              },
            ]);
          }}
          onUnlist={(id) => showBoard(myListings.filter((one) => one.id !== id))}
          onBid={(listing, giving, cash) => {
            const creature = giving === null ? null : (state.party[giving] ?? null);
            const id = postId();
            if (creature) sentBids.current[id] = creature.uid;
            postRooms.current.get(listing.code ?? "")?.bid({
              id,
              listing: listing.id,
              who: state.trainerName || "Somebody",
              creature,
              cash,
            });
          }}
          onAccept={(bid) => {
            const listing = myListings.find((one) => one.id === bid.listing);
            if (!listing) return;
            const give = state.party.findIndex((one) => one.uid === listing.creature.uid);
            // Ours first, then the word to them: a deal we could not apply is
            // not a deal we should be telling anybody about.
            dispatch({
              t: "postDeal",
              give: give >= 0 ? give : null,
              receive: bid.creature,
              paid: bid.cash,
              who: bid.who,
            });
            postRooms.current.get(bid.code ?? "")?.strike({
              bid: bid.id,
              listing: listing.id,
              creature: listing.creature,
              cash: bid.cash,
            });
            showBoard(myListings.filter((one) => one.id !== listing.id));
            setBids((before) => before.filter((one) => one.id !== bid.id));
          }}
          onDecline={(bid) => {
            postRooms.current.get(bid.code ?? "")?.decline(bid.id);
            setBids((before) => before.filter((one) => one.id !== bid.id));
          }}
          onClose={() => dispatch({ t: "endTalk" })}
        />
      ) : null}

      {heard && !newsMuted ? (
        <aside className="newsToast friendToast" role="status" aria-live="polite">
          <NewsFace face={heard.face} />
          <span className="newsWho">{heard.who}</span>
          <span>{heard.text}</span>
        </aside>
      ) : null}

      {shown && !newsMuted ? (
        <aside className="newsToast" role="status" aria-live="polite">
          <NewsFace face={shown.face} />
          <span className="newsMark">FEED</span>
          <span>{shown.text}</span>
          <button
            type="button"
            className="ghost small"
            title="Stop it popping up. It keeps writing, the Doomscroller keeps every line, and the switch beside the sound brings it back."
            onClick={() => muteNews(true)}
          >
            Mute
          </button>
        </aside>
      ) : null}

      {/* Out here rather than in the field, so a battle does not close them. */}
      <BigMaps world={session.world} state={state} open={bigMaps} onOpen={changeBigMaps} onTileClick={walkTo} />

      {state.phase === "battle" || state.phase === "battleEnd" ? (
        <BattleView
          aside={partyPanel}
          battle={state.battle!}
          role={0}
          // Only a wild battle gets a ball count, because that is what
          // BattleView reads as "balls and running are legal here".
          balls={
            isWildBattle(state.battle)
              ? BALLS.map((ball) => ({ id: ball.id, name: ball.name, count: countOf(state.bag, ball.id) }))
              : undefined
          }
          // Whose it is, worked out from the battle's own tag. Left to its
          // default, every trainer and gym leader in the game fielded "Wild"
          // creatures.
          opponentLabel={opponentLabel(session.world, state.battle)}
          // Only in the wild: the ball is an answer to "do I need this one".
          caught={isWildBattle(state.battle) ? state.caught : undefined}
          owned={ownedAbilities(state)}
          opening={opponentHint(session.world, state.battle)?.text}
          onAction={dispatch as (action: BattleAction) => void}
          footer={
            state.phase === "battleEnd" ? (
              <>
                <button type="button" className="primary" onClick={() => dispatch({ t: "continue" })} autoFocus>
                  Continue
                </button>
                <p className="hint">
                  <kbd>Enter</kbd> or <kbd>Space</kbd>
                </p>
                <label className="hint autoContinue">
                  <input
                    type="checkbox"
                    checked={autoContinue}
                    onChange={(event) => {
                      setAutoContinue(event.target.checked);
                      try {
                        localStorage.setItem(AUTO_CONTINUE_KEY, event.target.checked ? "1" : "0");
                      } catch {
                        // Remembered for this session only.
                      }
                    }}
                  />{" "}
                  Continue by itself when nothing levelled, learned or evolved
                </label>
              </>
            ) : undefined
          }
        />
      ) : (
        <section className="field">
          {/* The map, the little map, and what you are out here for. The
              quests sit beside the minimap because they are read the same
              way — a glance while walking, rather than something you stop and
              open a panel for. */}
          <div className="fieldRow">
            <GameCanvas world={session.world} state={state} onTileClick={walkTo} />
            {/* Straight under the map on a phone, where a thumb is; hidden elsewhere. */}
            <TouchPad onDown={padDown} onUp={padUp} />
            <MiniMap
              world={session.world}
              state={state}
              onTileClick={walkTo}
              bigMaps={bigMaps}
              onBigMaps={changeBigMaps}
              friends={friendsRoom}
            />
            <section className="panel questsBeside">
              <h3>Quests</h3>
              <QuestPanel world={session.world} state={state} onInput={dispatch} />
            </section>
          </div>
          <p className="hint">
            <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> or <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> to
            walk, or tap or click anywhere on a map you have already seen to walk there. Tall grass has things in it.
            Every gap in the wall leads somewhere; the small map shows which of them you have taken.
          </p>
          {/* Somebody is behind you. A number counting down, because there is
              nothing to *do* about him except be ready, and a warning you can
              act on is a warning worth giving. */}
          {rivalCountdown(state) !== null ? (
            <p className="error">
              Somebody is following you. {rivalCountdown(state)} moves before they catch up.
            </p>
          ) : null}
          {state.notice?.t === "whiteout" ? (
            <p className="error">
              Everything fainted. You woke up in{" "}
              {session.world.routes.get(state.notice.at)?.label ?? "Hearth"}, patched up
              {state.notice.lost ? ` — and ¤${state.notice.lost.toLocaleString()} lighter` : ""}.
            </p>
          ) : null}
          {state.notice?.t === "caught" ? (
            <p className="good">Caught it!{state.notice.boxed ? " Party was full, so it went to the box." : ""}</p>
          ) : null}
          {state.notice?.t === "found" ? (
            <p className="good">
              You found the {item(state.notice.item).name}! {item(state.notice.item).blurb} Apply it at
              the daycare back in Hearth.
            </p>
          ) : null}
          {state.notice?.t === "beatTrainer" ? (
            <p className="good">
              You beat {state.notice.name}, and they handed over ¤{state.notice.money.toLocaleString()}.
            </p>
          ) : null}
          {state.notice?.t === "usedMove" ? (
            <p className="good">Used {moveById(state.notice.move).name}.</p>
          ) : null}
          {state.notice?.t === "travelled" ? (
            <p className="good">
              The Grey Line walked you to{" "}
              {session.world.routes.get(state.notice.route)?.label ?? state.notice.route}.
            </p>
          ) : null}
          {state.notice?.t === "used" ? (
            <p className="good">
              Used the {item(state.notice.item).name} on {state.notice.on}.
            </p>
          ) : null}
          {state.notice?.t === "bought" ? (
            <p className="good">
              Bought {state.notice.count} x {item(state.notice.item).name}.
            </p>
          ) : null}
          {state.notice?.t === "sold" ? (
            <p className="good">
              Sold {state.notice.count} x {item(state.notice.item).name}.
            </p>
          ) : null}
          {state.notice?.t === "foraged" ? (
            <p className="good">
              {state.notice.finds
                .map((find) => {
                  const who = state.party.find((one) => one.uid === find.uid);
                  const name = who ? (who.nickname ?? speciesById(who.speciesId).name) : "Someone";
                  return `${name} found a ${item(find.item).name}.`;
                })
                .join(" ")}
            </p>
          ) : null}
          {state.notice?.t === "picked" ? (
            <p className="good">Picked up a {item(state.notice.item).name}.</p>
          ) : null}
          {state.notice?.t === "noticed" ? (
            <p className="muted">
              {critterDoing(session.world, state.route, state.notice.critterId) ??
                `The ${speciesById(state.notice.speciesId).name} looks up at you, and goes back to whatever it was doing.`}
            </p>
          ) : null}
          {state.notice?.t === "joined" ? (
            <p className="good">
              {critterDoing(session.world, state.route, state.notice.critterId) ??
                `The ${speciesById(state.notice.speciesId).name} decided to come along.`}
              {state.notice.boxed ? " Your party was full, so it is in the box." : ""}
            </p>
          ) : null}
          {state.notice?.t === "given" ? (
            <p className="good">
              {state.notice.on} is carrying the {item(state.notice.item).name}.
            </p>
          ) : null}
          {state.notice?.t === "took" ? (
            <p className="good">
              Took the {item(state.notice.item).name} back off {state.notice.on}.
            </p>
          ) : null}
          {state.notice?.t === "gift" ? (
            <p className="good">
              {state.notice.from} gave you a {item(state.notice.item).name}.
            </p>
          ) : null}
          {state.notice?.t === "loadedOut" ? (
            <p className="good">
              {state.notice.name} is back: {state.notice.brought}{" "}
              {state.notice.brought === 1 ? "creature" : "creatures"} in the party
              {state.notice.missing ? `, ${state.notice.missing} of them no longer with you` : ""}.
            </p>
          ) : null}
          {state.notice?.t === "healed" ? (
            <p className="good">{state.notice.by} patched everyone up.</p>
          ) : null}
          {state.notice?.t === "swindled" ? (
            <p className="error">
              You open the ball. It is not a {state.notice.promised}. It is a {state.notice.got}, and somebody has
              written &ldquo;{state.notice.promised.toUpperCase()}&rdquo; on it in marker. When you look up,{" "}
              {state.notice.by} is smiling. Your {state.notice.given} is already gone.
            </p>
          ) : null}
          {state.notice?.t === "workshopLeft" ? (
            <p className="good">
              {state.notice.name} got to work{" "}
              {{ ice: "churning ice cream", fire: "roasting chickens", water: "watering the plants" }[state.notice.station]}.
            </p>
          ) : null}
          {state.notice?.t === "workshopTaken" ? (
            <p className="good">
              {state.notice.name} came back from the workshop
              {state.notice.levels > 0 ? `, ${state.notice.levels} level${state.notice.levels === 1 ? "" : "s"} up` : ""}
              {state.notice.boxed ? " and went to the box" : ""}.
            </p>
          ) : null}
          {state.notice?.t === "bidPlaced" ? (
            <p className="good">
              Bid ¤{state.notice.price.toLocaleString()} on the {speciesById(state.notice.speciesId).name}. The money is
              held until the lot closes.
            </p>
          ) : null}
          {state.notice?.t === "bidsSettled" ? (
            <p className={state.notice.won.length ? "good" : "muted"}>
              {state.notice.won.length
                ? `The hammer came down your way: ${state.notice.won.map((id) => speciesById(id).name).join(", ")} ${state.notice.won.length === 1 ? "is" : "are"} yours${state.notice.boxed ? " (sent to the box)" : ""}.`
                : "Outbid on every closed lot."}
              {state.notice.refunded > 0 ? ` ¤${state.notice.refunded.toLocaleString()} came back to you.` : ""}
            </p>
          ) : null}
          {state.notice?.t === "pageant" ? (
            <p className={state.notice.won ? "good" : "muted"}>
              {state.notice.name} scored {state.notice.score} against {state.notice.toBeat}
              {state.notice.won ? " — and won a Ribbon! 🎀" : ". No Ribbon this time."}
            </p>
          ) : null}
          {state.notice?.t === "photoshot" ? (
            <p className="good">
              ¤100,000 for {state.notice.name}&apos;s photoshoot. It came back burned out, and the Ribbon went on the cover.
            </p>
          ) : null}
          {state.notice?.t === "influenceLeft" ? (
            <p className="good">{state.notice.name} is now being posted about. Walk, and the algorithm does the rest.</p>
          ) : null}
          {state.notice?.t === "influenceTaken" ? (
            <p className="good">
              {state.notice.name} came back Famous {state.notice.fame}
              {state.notice.boxed ? " (sent to the box)" : ""}.
            </p>
          ) : null}
          {state.notice?.t === "streamRegistered" ? (
            <p className="good">{state.notice.name} is live. ¤10,000 in the pool, one a step to keep it going.</p>
          ) : null}
          {state.notice?.t === "streamCashed" ? (
            <p className="good">
              {state.notice.stopped ? "Stream ended. " : ""}You took ¤{state.notice.money.toLocaleString()} out of the pool.
            </p>
          ) : null}
          {state.notice?.t === "streamBroke" ? (
            <p className="error">The stream&apos;s pool went below nothing, so the Streamer pulled the plug.</p>
          ) : null}
          {state.notice?.t === "therapyLeft" ? (
            <p className="good">{state.notice.name} lay down on Dr. Couch&apos;s couch. A thousand steps.</p>
          ) : null}
          {state.notice?.t === "therapyTaken" ? (
            <p className="good">
              {state.notice.name} came back {state.notice.became}
              {state.notice.became === "Redeemed" ? " — triple experience and effort from now on" : " — it listens to you now, and earns double experience"}
              {state.notice.boxed ? " (sent to the box)" : ""}.
            </p>
          ) : null}
          {state.notice?.t === "insured" ? (
            <p className="good">You bought Egg Insurance. Apply it at the daycare and every ordinary incubated egg pays out.</p>
          ) : null}
          {state.notice?.t === "invited" ? (
            <p className="good">
              {state.notice.name} packed up and moved into {state.notice.room}, in Hearth&apos;s terraces.
            </p>
          ) : null}
          {state.notice?.t === "sentHome" ? (
            <p className="good">{state.notice.name} went back to where you first found them.</p>
          ) : null}
          {state.notice?.t === "chromaTraded" ? (
            <p className="good">
              The Colour Collector took {state.notice.name} and paid {state.notice.candy} Chroma Candy.
            </p>
          ) : null}
          {state.notice?.t === "giftSwapped" ? (
            <p className="good">Swapped {state.notice.name} for a Secret Gift. Open it from the bag.</p>
          ) : null}
          {state.notice?.t === "giftOpened" ? (
            <p className="good">
              The Secret Gift held{" "}
              {state.notice.contents.map((part) => `${part.count} × ${item(part.what).name}`).join(", ")}.
            </p>
          ) : null}
          {state.notice?.t === "tutorLeft" ? (
            <p className="good">
              {state.notice.name} is staying with the Ability Tutor to learn {ability(state.notice.abilityId).name}.
            </p>
          ) : null}
          {state.notice?.t === "tutorTaken" ? (
            <p className="good">
              {state.notice.name} came back knowing {ability(state.notice.abilityId).name}
              {state.notice.boxed ? " (sent to the box)" : ""}.
            </p>
          ) : null}
          {state.notice?.t === "eggSold" ? (
            <p className="good">
              Sold an egg for ¤{state.notice.money.toLocaleString()}.
              {state.notice.count === 2 ? " He looks at the two of them for a long time." : ""}
            </p>
          ) : null}
          {state.notice?.t === "pawned" ? (
            <p className="good">
              Sold {state.notice.name} (Lv{state.notice.level}) to the pawnbroker for ¤
              {state.notice.money.toLocaleString()}.
            </p>
          ) : null}
          {state.notice?.t === "swapped" ? (
            <p className="good">
              Traded your {state.notice.given} for their {state.notice.got}.
            </p>
          ) : null}
          {state.notice?.t === "questTaken" ? (
            <p className="good">Took on {questSpec(state.notice.id).name}.</p>
          ) : null}
          {state.notice?.t === "questDone" ? (
            <p className="good">
              {questSpec(state.notice.id).name} done — paid {rewardText(questSpec(state.notice.id).reward)}.
            </p>
          ) : null}
          {state.notice?.t === "cleared" ? (
            <p className="good">Used {item(state.notice.item).name}. The way is open.</p>
          ) : null}
          {state.notice?.t === "badge" ? (
            <p className="good">
              Beat {gymSpec(state.notice.gym).leader} — the {gymSpec(state.notice.gym).name} badge is
              yours. Every other gym just got {LEVELS_PER_BADGE} levels harder.
            </p>
          ) : null}
          {state.hunt ? (
            <p className="hint">
              Hunting {speciesById(state.hunt.offer.speciesId).name} on{" "}
              <strong>{session.world.routes.get(state.hunt.offer.routeId)?.label ?? "somewhere"}</strong> —{" "}
              {huntLeft(state.hunt, state.stepsTaken).toLocaleString()} steps left. It runs; go the other way
              round and meet it coming.
            </p>
          ) : null}
          {state.notice?.t === "huntOn" ? (
            <p className="good">
              {speciesById(state.notice.speciesId).name} was last seen on{" "}
              {session.world.routes.get(state.notice.routeId)?.label ?? "somewhere"}.
            </p>
          ) : null}
          {state.notice?.t === "huntOff" ? (
            <p className="muted">
              The {speciesById(state.notice.speciesId).name} has moved on. Bex will have found something else.
            </p>
          ) : null}
          {state.notice?.t === "clubRound" ? (
            <p className="good">
              That is {state.notice.round} down. He is already holding the next one — and nobody
              here is going to mention any of this afterwards.
            </p>
          ) : null}
          {state.notice?.t === "clubDone" ? (
            <p className="good">
              {speciesById(state.notice.speciesId).name} is the only one of yours still on its feet
              after {state.notice.rounds} {state.notice.rounds === 1 ? "bout" : "bouts"}. Paid ¤
              {state.notice.purse.toLocaleString()}, and you were never here.
            </p>
          ) : null}
          {state.notice?.t === "released" ? (
            <p className="muted">You let {state.notice.name} go.</p>
          ) : null}
          {state.notice?.t === "appraised" ? (
            <p className="good">
              Sold your {state.notice.name} — {state.notice.tier} rung
              {state.notice.tier === 1 ? "" : "s"} of shine, for{" "}
              {state.notice.money
                ? `¤${state.notice.money.toLocaleString()}`
                : `${state.notice.glitter} Glitter`}
              .
            </p>
          ) : null}
          {state.notice?.t === "taught" ? (
            <p className="good">
              {state.notice.name}{" "}
              {state.notice.forgot
                ? `forgot ${moveById(state.notice.forgot).name} and learned`
                : "learned"}{" "}
              {moveById(state.notice.learned).name}.
            </p>
          ) : null}
          {state.notice?.t === "lured" ? (
            <p className="good">
              Lit the {item(state.notice.item).name}. It burns until move{" "}
              {state.notice.until.toLocaleString()}.
            </p>
          ) : null}
          {state.notice?.t === "expShare" ? (
            <p className="good">
              {state.notice.on} reached level 40, and you were given an Exp. Share! Give it to a
              creature from the Bag: it earns half the experience of every battle your team wins,
              even without fighting.
            </p>
          ) : null}
          {state.notice?.t === "foundEgg" ? (
            <p className={state.notice.taken ? "good" : "muted"}>
              {state.notice.taken
                ? "You found an egg lying on the ground! Keep walking with it and see what hatches."
                : "There is an egg here, but you have no room to carry it. Make space in your party and come back."}
            </p>
          ) : null}
          {state.notice?.t === "eggIncubated" ? (
            <p className="good">An egg went into the incubator. It hatches into the box as you walk.</p>
          ) : null}
          {state.notice?.t === "eggTaken" ? (
            <p className="good">
              You took the egg. Keep walking with it and see what hatches.
            </p>
          ) : null}
          {state.notice?.t === "hatched" ? (
            <p className="good">
              {speciesById(state.notice.speciesId).name} hatched from the egg!
              {state.notice.boxed ? " It went to the Hatched box." : ""}
              {state.notice.payout ? ` Nothing special, so the insurance paid out: 1 ${item(state.notice.payout).name}.` : ""}
              {state.notice.gift
                ? ` That makes fifteen — the daycare hands you an ${item(state.notice.gift).name}. Every egg now shows its exact steps.`
                : ""}
            </p>
          ) : null}
          {state.notice?.t === "gadget" ? (
            <p className="good">
              You have met six of the people who run something out there, and one of them presses a{" "}
              {item(state.notice.item).name} into your hand: every clock they keep, in one feed. It is in your bag
              under Keys.
            </p>
          ) : null}
          {state.notice?.t === "heldTaken" ? (
            <p className="good">
              Took back {state.notice.count} held item{state.notice.count === 1 ? "" : "s"} from the box.
            </p>
          ) : null}
        </section>
      )}

      {!state.trainerName ? <TrainerPrompt onInput={dispatch} /> : null}

      <PoisonFlash at={state.poisonedAt} />

      {state.talking ? (
        <TalkPanel world={session.world} state={state} onInput={dispatch} />
      ) : null}

      {/* Above the map and below a conversation: it is a question waiting for
          you rather than something happening now, and it keeps until the
          person in front of you is finished. */}
      {state.phase === "field" && !state.talking ? (
        <LearnPanel state={state} onInput={dispatch} />
      ) : null}

      {inHub ? (
        <HubPanel
          world={session.world}
          state={state}
          onInput={dispatch}
          onPvp={() => setPvp(true)}
          onInspect={setInspecting}
          showDaycare={Boolean(inDaycare)}
          showPvp={Boolean(inCentre)}
        />
      ) : null}

      {/* A bracket follows you: three fights with a walk between them, and
          having to go back and ask the host for each one would be three walks
          nobody wants. */}
      {state.phase === "field" && state.arena ? (
        <ArenaPanel world={session.world} state={state} onInput={dispatch} />
      ) : null}

      {inMart ? (
        <section className="panel">
          <MartPanel world={session.world} state={state} onInput={dispatch} />
        </section>
      ) : null}

      {indoors && !inHub && !inMart ? (
        <section className="panel">
          <p className="muted">{INDOORS_NOTE[here!.role ?? "house"] ?? INDOORS_NOTE.house}</p>
        </section>
      ) : null}

      {/* The question comes first when there is one: the offer has to be
          answered before a reveal for something else makes any sense. */}
      {offered ? (
        <EvolutionScene
          key={`${offered.uid}:${offered.to}`}
          from={offered.creature.speciesId}
          to={offered.to}
          variantId={offered.creature.variantId}
          onDone={() =>
            dispatch({ t: "evolve", uid: offered.uid, to: offered.to, accept: true })
          }
          onCancel={() =>
            dispatch({ t: "evolve", uid: offered.uid, to: offered.to, accept: false })
          }
        />
      ) : hatching ? (
        // An egg that has walked its steps. The creature is already decided;
        // the scene ending, however it ends, is what opens it.
        <EvolutionScene
          key={`egg:${hatching.from}:${hatching.index}:${hatching.egg.total}`}
          from={EGG}
          to={hatching.egg.creature.speciesId}
          variantId={hatching.egg.creature.variantId}
          onDone={() =>
            dispatch(
              hatching.from === "incubator"
                ? { t: "hatch", index: hatching.index, from: "incubator" }
                : { t: "hatch", index: hatching.index },
            )
          }
        />
      ) : evolved ? (
        <EvolutionScene
          from={evolved.from}
          to={evolved.to}
          // The party is where an appearance is recorded, and the notice says
          // which member. It has already changed species by the time this is
          // read, which is why the notice carries both names and the creature
          // carries neither.
          variantId={state.party.find((one) => one.uid === evolved.uid)?.variantId ?? "normal"}
          onDone={() => setSeenEvolution(evolved)}
        />
      ) : null}

      {CHEATS_AVAILABLE && cheats ? (
        <CheatMenu world={session.world} state={state} onInput={dispatch} onClose={() => setCheats(false)} />
      ) : null}

      {inspected ? (
        <Inspect
          world={session.world}
          creature={inspected.creature}
          index={inspected.index}
          state={state}
          onInput={dispatch}
          onClose={() => setInspecting(null)}
        />
      ) : null}

      {/* Who you have and what you are carrying, side by side. Either can be
          absent — the party is hidden indoors where the hub panel already
          lists it, and the bag only appears in the field — and whichever
          remains takes the full width rather than sitting in half of it. */}
      <div className="sideBySide">
        {/* Not here during a battle: it is up beside the field instead, which
            is where you want it when you are deciding who to send out. */}
        {inHub || fighting ? null : partyPanel(null)}

        {state.phase === "field" ? (
          <section className="panel">
            <div className="row">
              <h3>Bag</h3>
              {/* Fishing is offered where it is legal and refused where it is
                  not, in the engine's own words. */}
              <button
                type="button"
                className="ghost"
                disabled={Boolean(fishRefusal(session.world, state))}
                title={fishRefusal(session.world, state) ?? `Cast a line (F) — it takes ${FISH_STEPS} steps`}
                onClick={() => dispatch({ t: "fish" })}
              >
                {bestRod(state.bag) ? `Fish (${bestRod(state.bag)!.name})` : "Fish"}
              </button>
              {/* And the other thing you do from where you are standing.
                  Fly lives in the bag, under Tools, behind two clicks — which
                  is two clicks every time you cross the world. This opens the
                  same map the item does. */}
              <button
                type="button"
                className="ghost"
                disabled={!state.bag["hm-fly"]}
                title={state.bag["hm-fly"] ? "Open the map and fly" : "You have no way to fly"}
                onClick={() => setOpenBagItem({ item: "hm-fly", at: Date.now() })}
              >
                Fly
              </button>
            </div>
            <BagPanel
              world={session.world}
              state={state}
              onInput={dispatch}
              opened={openBagItem}
              friends={friendsRoom}
              newsMuted={newsMuted}
              onNewsMuted={muteNews}
            />

            {/* And what your party can do out here, under the bag because it
                is the same kind of question: something you have, used on the
                place you are standing. Renders nothing when nobody has one. */}
            <FieldMovePanel world={session.world} state={state} onInput={dispatch} />
          </section>
        ) : null}
      </div>

      {/* What you have met, against where you met it.
          
          Folded shut, because it grows all game and is a thing you go and look
          at rather than a thing you read while walking — unlike the map beside
          the canvas, which is glanced at every few steps. A `details` rather
          than a piece of state, since which panels somebody has open is the
          browser's business and emphatically not the save's. */}
      {fighting ? null : (
        <details className="panel notesPanel">
          <summary>
            <h3>Field notes</h3>
          </summary>
          <NotesPanel world={session.world} state={state} />
        </details>
      )}

      {fighting ? null : (
        <details className="panel notesPanel">
          <summary>
            <h3>Pokédex</h3>
          </summary>
          <DexPanel world={session.world} state={state} />
        </details>
      )}

      {fighting ? null : (
        <details className="panel notesPanel">
          <summary>
            <h3>Journal</h3>
          </summary>
          <JournalPanel world={session.world} state={state} inputs={session.inputs} />
        </details>
      )}

      <section className="panel">
        <div className="row">
          <button
            type="button"
            className="ghost"
            onClick={() => downloadSave(session.seed, session.inputs, rosterOf(state), session.run)}
          >
            Save to file
          </button>
          <button
            type="button"
            className="ghost"
            title="Put every creature this run owns into the vault. A later add updates them."
            onClick={() => {
              const merged = mergeEntries(readVault(), entriesFromRun(session.seed, session.inputs, state, session.run));
              setVaultNote(
                writeVault(merged.vault)
                  ? `Vault: ${merged.added} added, ${merged.updated} updated.`
                  : "This browser would not store the vault.",
              );
            }}
          >
            Add this run to the vault
          </button>
          {vaultNote ? <span className="muted">{vaultNote}</span> : null}
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setMuted(!muted);
              setMutedState(!muted);
            }}
            title="A handful of synthesised cues: a hit, a critical, a miss, a faint, a heal, a catch, a level"
          >
            Sound: {muted ? "off" : "on"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => muteNews(!newsMuted)}
            title={
              newsMuted
                ? "The feed is still writing every line — this starts them popping up in the corner again"
                : "Stop feed lines popping up in the corner. Nothing stops being written."
            }
          >
            Feed: {newsMuted ? "muted" : "on"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              if (confirm("Leave this run? The autosave stays, so you can continue it later.")) {
                setAutosaves(readAutosaves());
                setSession(null);
              }
            }}
          >
            Main menu
          </button>
        </div>
      </section>
    </main>
  );
}
