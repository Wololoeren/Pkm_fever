import type { BattleEvent, SideIndex } from "@/engine/battle";
import { ability } from "@/engine/abilities";
import { move as moveById, species as speciesById } from "@/engine/dex";
import type { Individual } from "@/engine/types";
import { item as itemById } from "@/engine/items";

/**
 * Turns the battle's structured events into sentences.
 *
 * The engine deliberately emits tags rather than strings, so that the words
 * the game uses are never part of a state hash and can be changed — or
 * translated — without invalidating a single save file. This is where they
 * become English.
 */

const STATUS_TEXT: Record<string, string> = {
  brn: "was burned",
  psn: "was poisoned",
  par: "was paralysed",
  slp: "fell asleep",
  frz: "was frozen solid",
};

const BLOCKED_TEXT: Record<string, string> = {
  slp: "is fast asleep",
  frz: "is frozen solid",
  par: "is paralysed and cannot move",
};

/**
 * The two probability ladders, which are not stats and do not read like them.
 *
 * Kept apart from STAT_NAMES on purpose: "its Attack fell" and "its accuracy
 * fell" are different sentences, and the engine emits a different event for
 * each so this file can tell them apart.
 */
const AIM_NAMES: Record<string, string> = {
  accuracy: "accuracy",
  evasion: "evasiveness",
};

/**
 * What each condition sounds like when it lands, and when it bites.
 *
 * One entry per `VolatileKind`, because a condition the player cannot see is a
 * condition they will report as broken — which is exactly what happened to
 * Leech Seed. The words are here rather than in the engine so that changing
 * them cannot invalidate a save.
 */
const VOLATILE_TEXT: Record<string, string> = {
  roused: "was shaken out of it",
  spun: "spun free",
  cleared: "had its stat changes wiped away",
  seeded: "was seeded",
  // Landing and biting are two sentences. Sharing one made the turn a seed
  // took hold read as the game stuttering.
  sapped: "had its health sapped",
  confused: "became confused",
  // Not the same line as becoming confused. They were both "became confused"
  // for a moment, which reads as the game repeating itself rather than as the
  // creature having just punched itself.
  selfhit: "hurt itself in its confusion",
  snapped: "shook it off",
  shield: "protected itself",
  endure: "braced itself",
  crit: "is getting pumped",
  yawn: "grew drowsy",
  nightmare: "fell into a nightmare",
  dreaming: "is caught in a nightmare",
  trapped: "can no longer escape",
  drowsy: "grew drowsy",
  rooted: "planted its roots",
  infatuated: "fell in love",
  smitten: "is in love and cannot bring itself to move",
  copied: "copied its foe's stat changes",
  swapped: "switched stat changes with its foe",
  split: "has had its stats altered",
  stockpiled: "stockpiled",
  sure: "took aim",
  bonded: "is trying to take its foe down with it",
  avenged: "was taken down with it",
  wished: "made a wish",
  blessed: "fainted, and left a wish for the next one",
  afloat: "is floating off the ground",
  retyped: "changed type",
  seen: "was identified",
  inverted: "had its stat changes turned upside down",
  decoy: "put up a substitute",
  decoyhit: "had its substitute take the hit",
  decoybroke: "had its substitute broken",
  taunted: "fell for the taunt",
  disabled: "had a move disabled",
  encored: "got an encore",
  tormented: "is being tormented",
  imprisoning: "sealed the moves it knows",
  healblocked: "was prevented from healing",
  grudging: "wants its foe to bear a grudge",
  grudged: "lost every use of that move to the grudge",
  powdered: "is covered in powder",
  exploded: "was caught in the powder's explosion",
  electrified: "is charged with electricity",
  octolocked: "is locked in an octopus hold",
  cursed: "was cursed",
  curseBite: "is afflicted by the curse",
  guarding: "is guarding its side",
  snatching: "waits for a move to snatch",
  snatched: "snatched the move",
  coated: "shrouded itself in a magic coat",
  bounced: "bounced the move back",
  mimicked: "learned the move by mimicking it",
  embargoed: "can't use items anymore",
  abilityChanged: "had its ability changed",
  passed: "was passed the baton",
  camouflaged: "blended into its surroundings",
  enraged: "is building up rage",
  exposed: "is left wide open",
  smacked: "fell straight down",
  salted: "is being salt cured",
  saltBite: "is hurt by the salt",
  syrupy: "got covered in sticky syrup",
  restricted: "can't use that move right now",
  uproar: "caused an uproar",
  worn: "is free of a restriction",
};

const HAZARD_TEXT: Record<string, [string, string, string]> = {
  stealthrock: ["Pointed stones float around", "Pointed stones dug into", "The pointed stones disappeared from"],
  spikes: ["Spikes were scattered around", "Spikes hurt", "The spikes disappeared from"],
  toxicspikes: ["Poison spikes were scattered around", "Poison spikes reached", "The poison spikes disappeared from"],
  stickyweb: ["A sticky web spread out around", "A sticky web caught", "The sticky web disappeared from"],
};

const ITEM_MOVED_TEXT: Record<string, (who: string, what: string) => string> = {
  stolen: (who, what) => `${who} stole ${what}!`,
  swapped: (who, what) => `${who} received ${what}!`,
  given: (who, what) => `${who} was given ${what}!`,
  knocked: (who, what) => `${who} lost its ${what}!`,
  burnt: (who, what) => `${who}'s ${what} was burnt up!`,
  recycled: (who, what) => `${who} recycled ${what}!`,
  eaten: (who, what) => `${who} ate its ${what}!`,
  muffled: (who, what) => `${who}'s ${what} stopped working!`,
  unmuffled: (who, what) => `${who}'s ${what} works again!`,
};

/** The field arriving and leaving. One sentence each way, like the screens. */
const FIELD_TEXT: Record<string, [string, string]> = {
  sun: ["The sunlight turned harsh!", "The sunlight faded."],
  rain: ["It started to rain!", "The rain stopped."],
  sand: ["A sandstorm kicked up!", "The sandstorm subsided."],
  hail: ["It started to hail!", "The hail stopped."],
  snow: ["It started to snow!", "The snow stopped."],
  electric: ["An electric current ran across the ground!", "The electricity disappeared."],
  grassy: ["Grass grew to cover the ground!", "The grass disappeared."],
  misty: ["Mist swirled around the field!", "The mist disappeared."],
  psychic: ["The ground got weird!", "The weirdness disappeared."],
  water: ["Fire's power was weakened!", "The effects of Water Sport faded."],
  mud: ["Electricity's power was weakened!", "The effects of Mud Sport faded."],
  gravity: ["Gravity intensified!", "Gravity returned to normal."],
  trickroom: ["The dimensions were twisted!", "The twisted dimensions returned to normal."],
  wonderroom: ["A bizarre area swapped Defense and Sp. Def!", "The bizarre area disappeared."],
  magicroom: ["A bizarre area made held items lose their effects!", "Held items work again."],
  fairylock: ["No one will be able to run away during the next turn!", "The fairy lock wore off."],
};

const WEATHERED_TEXT: Record<string, string> = {
  sand: "is buffeted by the sandstorm",
  hail: "is pelted by hail",
};

const SCREEN_TEXT: Record<string, string> = {
  reflect: "Reflect came up",
  lightscreen: "Light Screen came up",
  mist: "a mist gathered",
  safeguard: "Safeguard is watching",
  luckychant: "a chant went up",
  tailwind: "the wind is behind it",
};

const STAT_NAMES: Record<string, string> = {
  // HP is here for effort, which can land in it. Stat stages never do.
  hp: "HP",
  atk: "Attack",
  def: "Defense",
  spa: "Sp. Atk",
  spd: "Sp. Def",
  spe: "Speed",
};

function effectivenessText(quarters: number): string {
  if (quarters === 0) return "";
  if (quarters > 4) return "It's super effective!";
  if (quarters < 4) return "It's not very effective.";
  return "";
}

/**
 * One piece of a line, and what it is.
 *
 * The log used to be flat strings, which meant the only way to colour a move
 * name was to go looking for it again in the finished sentence — and "used
 * Tackle!" is not a pattern, it is a coincidence that holds until somebody
 * translates the word "used".
 *
 * So the words come out already labelled. `move` carries the side that used
 * it, because whose move it was is the whole basis of the colour and this
 * module has no opinion about which side the reader is sitting on. `key` is
 * the handful of phrases worth catching out of the corner of an eye — a
 * critical hit, a type matchup, a miss — which is a judgement about *emphasis*
 * rather than about who did what, and so belongs here rather than in a
 * stylesheet matching on text.
 */
export type LogPart =
  | { t: "text"; text: string }
  | { t: "move"; text: string; side: SideIndex }
  | { t: "key"; text: string };

export type LogLine = readonly LogPart[];

/**
 * The log as structure: every line, in pieces, each piece labelled.
 *
 * `narrate` below is this joined back into strings, and is what anything that
 * only wants words should use.
 */
export function narrateParts(
  events: readonly BattleEvent[],
  nameOf: (side: SideIndex) => string,
  /**
   * The name of a team member by uid, for the lines about somebody who is not
   * necessarily the one out — experience is shared with everybody who fought
   * and with an Exp. Share holder on the bench.
   */
  nameOfUid?: (uid: number) => string | null,
): LogLine[] {
  const lines: LogLine[] = [];

  /** A line, from any mix of plain strings and labelled pieces. */
  const say = (...parts: (string | LogPart)[]): void => {
    lines.push(
      parts
        .filter((one) => one !== "")
        .map((one): LogPart => (typeof one === "string" ? { t: "text", text: one } : one)),
    );
  };
  const move = (moveId: string, side: SideIndex): LogPart => ({
    t: "move",
    text: moveById(moveId).name,
    side,
  });
  const key = (text: string): LogPart => ({ t: "key", text });

  for (const event of events) {
    switch (event.t) {
      case "use":
        // The move name is the one word in the line the eye should find
        // first, and whose it was decides its colour.
        say(`${nameOf(event.side)} used `, move(event.moveId, event.side), "!");
        break;
      case "miss":
        say(`${nameOf(event.side)}'s attack `, key("missed!"));
        break;
      case "immune":
        say(key("It doesn't affect "), key(`${nameOf(event.side)}.`));
        break;
      case "damage": {
        // Three pieces, because the middle two are the ones worth catching
        // sideways: a critical hit and a type matchup are the difference
        // between a turn going well and going badly, and both scroll past.
        const matchup = effectivenessText(event.quarters);
        say(
          `${nameOf(event.side)} took ${event.amount}.`,
          event.crit ? " " : "",
          event.crit ? key("A critical hit!") : "",
          matchup ? " " : "",
          matchup ? key(matchup) : "",
        );
        break;
      }
      // After the blows rather than before them, which is the order they
      // happened in: five numbers and then the count that explains why there
      // were five. `side` is the attacker here, unlike `damage`.
      case "hits":
        say(event.count === 1 ? "It hit once." : `It hit ${event.count} times!`);
        break;
      case "status":
        say(`${nameOf(event.side)} ${STATUS_TEXT[event.status] ?? "was afflicted"}!`);
        break;
      case "boost": {
        const direction = event.delta > 0 ? "rose" : "fell";
        const sharply = Math.abs(event.delta) > 1 ? " sharply" : "";
        say(`${nameOf(event.side)}'s ${STAT_NAMES[event.stat]} ${direction}${sharply}!`);
        break;
      }
      case "heal":
        say(`${nameOf(event.side)} recovered ${event.amount} HP.`);
        break;
      case "recoil":
        say(`${nameOf(event.side)} was hit by recoil for ${event.amount}.`);
        break;
      case "blocked":
        say(`${nameOf(event.side)} ${BLOCKED_TEXT[event.reason] ?? "cannot move"}!`);
        break;
      case "woke":
        say(`${nameOf(event.side)} woke up!`);
        break;
      case "thawed":
        say(`${nameOf(event.side)} thawed out!`);
        break;
      case "residual":
        say(`${nameOf(event.side)} was hurt by its ${event.status === "brn" ? "burn" : "poison"} for ${event.amount}.`);
        break;
      case "faint":
        say(`${nameOf(event.side)} fainted!`);
        break;
      case "switch":
        say("Come back! Go!");
        break;
      case "effort": {
        // Named per stat, because effort is the one stat input a player
        // directs — "it got stronger" would hide the only decision here.
        say(`Effort: +${event.amount} ${event.stats.map((stat) => STAT_NAMES[stat]).join(" and ")}.`);
        break;
      }

      case "exp": {
        const who = nameOfUid?.(event.uid);
        say(who ? `${who} gained ${event.amount} EXP.` : `Gained ${event.amount} EXP.`);
        // Named on every line, because two creatures can level in one turn and
        // "Learned Ember!" under two EXP lines does not say whose it is.
        if (event.levels > 0) say(`${who ?? "It"} levelled up! (+${event.levels})`);
        for (const learned of event.learned) say(`${who ?? "It"} learned ${moveById(learned).name}!`);
        if (event.evolved) say(`${who ?? "It"} evolved into ${speciesById(event.evolved).name}!`);
        break;
      }
      case "catchFailed":
        say("Argh! It broke free!");
        break;
      case "caught":
        say("Gotcha! It was caught!");
        break;
      case "fleeFailed":
        say("Couldn't get away!");
        break;
      case "ribbon":
        say(`${nameOf(event.side)}'s Ribbon charms the crowd — and the foe!`);
        break;
      case "disobeyed":
        // The move it picked narrates itself next, as any move does.
        if (event.moveId) {
          say(`${nameOf(event.side)} ignored orders!`);
        } else {
          say(`${nameOf(event.side)} is loafing around and won't listen.`);
        }
        break;
      case "fled":
        say("Got away safely.");
        break;
      case "noBalls":
        say("No balls left!");
        break;
      case "timeout":
        say("The battle has gone on long enough — it is decided on health.");
        break;
      case "struggling":
        say(`${nameOf(event.side)} has nothing left, and struggles!`);
        break;
      case "ability":
        say(`${nameOf(event.side)}'s ${ability(event.abilityId).name}!`);
        break;
      case "fizzled":
        // Not a miss and not a hit of zero. Endeavor against something already
        // weaker, Counter with nothing to answer — the move happened and came
        // to nothing, and saying "it took 0" would be a different claim.
        say(`${moveById(event.moveId).name} came to nothing.`);
        break;
      case "aim": {
        const direction = event.delta > 0 ? "rose" : "fell";
        const sharply = Math.abs(event.delta) > 1 ? " sharply" : "";
        say(`${nameOf(event.side)}'s ${AIM_NAMES[event.which]} ${direction}${sharply}!`);
        break;
      }
      case "volatile":
        say(`${nameOf(event.side)} ${VOLATILE_TEXT[event.which] ?? "was affected"}!`);
        break;
      case "screen":
        say(`On ${nameOf(event.side)}'s side, ${SCREEN_TEXT[event.which] ?? "something went up"}!`);
        break;
      case "shielded":
        say(`${nameOf(event.side)} protected itself!`);
        break;
      case "perish":
        // Counted down out loud, because a number nobody can see is a creature
        // that faints for no reason three turns later.
        say(
          event.turns > 0
            ? `${nameOf(event.side)}'s count fell to ${event.turns}.`
            : `${nameOf(event.side)}'s count reached zero!`,
        );
        break;
      case "transformed":
        say(`${nameOf(event.side)} transformed into ${speciesById(event.into).name}!`);
        break;
      case "sketched":
        say(`${nameOf(event.side)} sketched ${moveById(event.moveId).name}!`);
        break;
      case "field":
        say(FIELD_TEXT[event.id]?.[event.over ? 1 : 0] ?? (event.over ? "The field cleared." : "The field changed."));
        break;
      case "weathered":
        say(`${nameOf(event.side)} ${WEATHERED_TEXT[event.weather] ?? "is worn by the weather"} for ${event.amount}.`);
        break;
      case "spite":
        say(`${nameOf(event.side)}'s ${moveById(event.moveId).name} lost ${event.amount} uses!`);
        break;
      case "hazard": {
        const [laid, , gone] = HAZARD_TEXT[event.id] ?? ["Something was laid around", "", "It disappeared from"];
        say(event.layers > 0 ? `${laid} ${nameOf(event.side)}'s side!` : `${gone} ${nameOf(event.side)}'s side.`);
        break;
      }
      case "hazardHit": {
        const [, bit] = HAZARD_TEXT[event.id] ?? ["", "Something hurt", ""];
        say(event.amount > 0 ? `${bit} ${nameOf(event.side)} for ${event.amount}!` : `${bit} ${nameOf(event.side)}!`);
        break;
      }
      case "itemMoved":
        say((ITEM_MOVED_TEXT[event.how] ?? ((who: string, what: string) => `${who}'s ${what} moved!`))(nameOf(event.side), itemById(event.itemId).name));
        break;
      case "revived":
        // Named by species rather than by side, because the side's name is
        // whoever is standing and the one revived is not.
        say(`${speciesById(event.speciesId).name} was revived!`);
        break;
    }
  }

  return lines;
}

/**
 * The log as sentences.
 *
 * `narrateParts` with the labels thrown away. Kept because most callers — and
 * every test that checks what the game *said* — want a string, and because a
 * line assembled two different ways would be two lines free to disagree.
 */
export function narrate(
  events: readonly BattleEvent[],
  nameOf: (side: SideIndex) => string,
  nameOfUid?: (uid: number) => string | null,
): string[] {
  return narrateParts(events, nameOf, nameOfUid).map(flatten);
}

/** One structured line, as a sentence. */
export function flatten(line: LogLine): string {
  return line.map((part) => part.text).join("");
}

export function displayName(individual: Individual): string {
  return individual.nickname ?? speciesById(individual.speciesId).name;
}
