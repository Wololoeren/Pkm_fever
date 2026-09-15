import { extraEffects, type MoveEffect } from "@/engine/statusmoves";

/**
 * What a move's engine-side effect does, in a sentence.
 *
 * The manifest row carries five fields and the hover note read those, which
 * left every move whose whole point lives in `statusmoves.ts` — Sweet Kiss,
 * Leech Seed, Protect, the weathers — with a note that said "No damage" and
 * nothing else. This is the other half of the note: one sentence per shape,
 * and the `never` at the bottom is what makes a new shape a compile error
 * here rather than a silent blank on the screen.
 *
 * Numbers are named where the move has one — a share, a count of turns —
 * because "restores some health" is the kind of sentence a player learns to
 * stop reading.
 */

const STAT_NAMES: Record<string, string> = {
  atk: "Attack",
  def: "Defence",
  spa: "Sp. Atk",
  spd: "Sp. Def",
  spe: "Speed",
  accuracy: "accuracy",
  evasion: "evasion",
};

const SCREEN_TEXT: Record<string, string> = {
  reflect: "halves physical damage to its side",
  lightscreen: "halves special damage to its side",
  mist: "stops the other side lowering its side's stats",
  safeguard: "stops its side being given a condition",
  luckychant: "stops critical hits against its side",
  tailwind: "doubles its side's Speed",
};

const WEATHER_TEXT: Record<string, string> = {
  sun: "harsh sunlight: Fire ×1.5, Water ×0.5",
  rain: "rain: Water ×1.5, Fire ×0.5, Thunder and Hurricane never miss",
  sand: "a sandstorm: a sixteenth a turn off anything not Rock, Ground or Steel",
  hail: "hail: a sixteenth a turn off anything not Ice, and Blizzard never misses",
  snow: "snow: Ice types take less from physical moves, and Blizzard never misses",
};

const TERRAIN_TEXT: Record<string, string> = {
  electric: "Electric Terrain: Electric moves ×1.3 from the ground, and nothing on the ground can sleep",
  grassy: "Grassy Terrain: Grass moves ×1.3 from the ground, and everything on the ground mends a sixteenth a turn",
  misty: "Misty Terrain: Dragon moves ×0.5 into the ground, and nothing on the ground takes a condition",
  psychic: "Psychic Terrain: Psychic moves ×1.3 from the ground, and nothing with priority reaches the ground",
};

function share(n: number): string {
  if (n === 1) return "all";
  if (n === 2) return "half";
  if (n === 3) return "a third";
  if (n === 4) return "a quarter";
  return `a ${n === 8 ? "eighth" : n === 16 ? "sixteenth" : `1/${n}`}`;
}

/** One effect, one sentence. Exhaustive: a new shape fails to compile here. */
export function effectText(effect: MoveEffect): string {
  switch (effect.t) {
    case "seed":
      return "Seeds the target: an eighth of its health a turn goes to whoever is opposite. Not on a Grass type.";
    case "confuse":
      return "Confuses the target for 4 turns: a third of its turns it hits itself instead.";
    case "nightmare":
      return "Only on a sleeping target: it loses a quarter of its health every turn it stays asleep.";
    case "yawn":
      return "The target falls asleep at the end of the next turn, unless something stops it.";
    case "perish":
      return "Both sides faint in 4 turns unless they switch out.";
    case "trap":
      return "The target cannot switch out or run.";
    case "shield":
      return effect.endure
        ? "Survives anything this turn on at least 1 HP. Used again in a row, it usually fails."
        : "Nothing lands on it this turn. Used again in a row, it usually fails.";
    case "crit":
      return `Raises its critical hit rate ${effect.stages} stage${effect.stages === 1 ? "" : "s"}.`;
    case "aim":
      return `${effect.onSelf ? "Its own" : "The target's"} ${STAT_NAMES[effect.which]} ${effect.delta > 0 ? "up" : "down"} ${Math.abs(effect.delta)} stage${Math.abs(effect.delta) === 1 ? "" : "s"}.`;
    case "heal":
      return effect.weather === "sun"
        ? `Restores ${share(effect.share)} of its health; two thirds in sun, a quarter in other weather.`
        : effect.weather === "sand"
          ? `Restores ${share(effect.share)} of its health; all of it in a sandstorm.`
          : `Restores ${share(effect.share)} of its health.`;
    case "rest":
      return "Fully heals and cures itself, then sleeps for 2 turns.";
    case "painSplit":
      return "Adds both sides' health together and splits it evenly.";
    case "bellyDrum":
      return "Costs half its health for Attack at +6.";
    case "haze":
      return "Resets every stat change on both sides.";
    case "cure":
      return effect.who === "party" ? "Cures every condition in the whole party." : "Cures its own condition.";
    case "purify":
      return "Cures the target's condition, and then restores half of its own health.";
    case "side":
      return `For ${effect.turns} turns, ${SCREEN_TEXT[effect.id] ?? effect.id}.`;
    case "forceOut":
      return "Ends a wild battle, or makes a trainer switch to another creature.";
    case "retreat":
      return "Escapes a wild battle, or switches out against a trainer.";
    case "transform":
      return "Becomes a copy of the target: its species, stats, abilities and moves, at 5 PP each.";
    case "sketch":
      return "Permanently learns the target's last move, in place of this one.";
    case "roots":
      return effect.plant
        ? "Restores a sixteenth of its health every turn, and roots it: it cannot switch, run or be blown away."
        : "Restores a sixteenth of its health every turn.";
    case "infatuate":
      return "If the two would pair, the target is in love: half its turns it cannot move.";
    case "mend":
      return `Restores ${share(effect.share)} of the target's health.`;
    case "sap":
      return "Restores health equal to the target's Attack, and lowers that Attack a stage.";
    case "copyStages":
      return "Copies the target's stat changes onto itself.";
    case "swapStages":
      return `Swaps ${effect.stats.map((stat) => STAT_NAMES[stat]).join(" and ")} changes${effect.aim ? ", and accuracy and evasion," : ""} with the target.`;
    case "splitStats":
      return effect.swap
        ? `Swaps its ${effect.stats.map((stat) => STAT_NAMES[stat]).join(" and ")} with the target's.`
        : `Averages its ${effect.stats.map((stat) => STAT_NAMES[stat]).join(" and ")} with the target's.`;
    case "stockpile":
      return "Stockpiles, up to 3: each raises Defence and Sp. Def a stage, until it is spent by Swallow or Spit Up.";
    case "swallow":
      return "Spends its stockpile to heal: a quarter, a half, or all of its health for 1, 2 or 3.";
    case "unstock":
      return "100 power per stockpile, and spends them all. Fails with none.";
    case "sure":
      return "Its next move cannot miss.";
    case "bond":
      return "If it is knocked out by a move before it moves again, the attacker faints too.";
    case "wish":
      return "At the end of the next turn, whoever is standing here restores half its health.";
    case "sacrifice":
      return "It faints; the one sent out next arrives at full health with no condition. Fails alone.";
    case "revive":
      return "Brings one fainted party member back at half health.";
    case "float":
      return `${effect.onSelf ? "It floats" : "The target floats"} for ${effect.turns} turns: Ground attacks cannot reach it.`;
    case "retype":
      return effect.add
        ? `Adds ${effect.types.join("/")} to the target's types.`
        : `The target becomes pure ${effect.types.join("/")}.`;
    case "mirrorTypes":
      return "Takes the target's types.";
    case "conversion":
      return "Becomes the type of its first move.";
    case "conversion2":
      return "Becomes a type that resists the target's last move.";
    case "see":
      return effect.through === "ghost"
        ? "Normal and Fighting moves can hit the target despite a Ghost type."
        : "Psychic moves can hit the target despite a Dark type.";
    case "drench":
      return "On a poisoned target: Attack, Sp. Atk and Speed each down a stage.";
    case "acupressure":
      return "A random stat, two stages up.";
    case "psychoShift":
      return "Passes its own condition to the target.";
    case "powerTrick":
      return "Swaps its own Attack and Defence.";
    case "invert":
      return "Turns the target's stat changes upside down.";
    case "heartened":
      return effect.share
        ? `Cures its condition and restores ${share(effect.share)} of its health.`
        : `Cures its condition and raises ${Object.keys(effect.boosts ?? {}).map((stat) => STAT_NAMES[stat]).join(" and ")}.`;
    case "flowerShield":
      return "A stage of Defence for every Grass type on the field.";
    case "call":
      return effect.from === "any"
        ? "Uses a random move."
        : effect.from === "foe"
          ? "Uses the move last used against it."
          : effect.from === "self"
            ? "Only while asleep: uses one of its own moves at random."
            : "Uses a random move known by somebody else in the party.";
    case "instruct":
      return "The target uses its last move again, now.";
    case "spite":
      return "Takes 4 PP off the target's last move.";
    case "weather":
      return `For 5 turns, ${WEATHER_TEXT[effect.id] ?? effect.id}.`;
    case "terrain":
      return `For 5 turns, ${TERRAIN_TEXT[effect.id] ?? effect.id}.`;
    case "sport":
      return effect.id === "water" ? "For 5 turns, Fire moves are ×0.333." : "For 5 turns, Electric moves are ×0.333.";
    case "veil":
      return "Only in hail or snow: Reflect and Light Screen both, for 5 turns.";
    case "room":
      return {
        gravity: "For 5 turns: everything is grounded, accuracy is ×5/3, and flying and jumping moves fail. Fails if already up.",
        trickroom: "For 5 turns, the slower creature moves first within the same priority. Using it again ends it.",
        wonderroom: "For 5 turns, Defence and Sp. Def are exchanged when hit (stages stay put). Using it again ends it.",
        magicroom: "For 5 turns, held items do nothing. Using it again ends it.",
        fairylock: "Nobody can switch out or run this turn and next.",
      }[effect.id];
    case "ionDeluge":
      return "For the rest of this turn, Normal moves are Electric.";
    case "courtChange":
      return "Swaps every screen and hazard between the two sides.";
    case "camouflage":
      return "The user becomes the type of the ground it is on (the terrain's type if a terrain is up).";
    case "ability":
      return {
        worry: "The target's abilities become Insomnia, which also wakes it.",
        gastro: "The target's abilities are switched off until it switches out.",
        entrain: "The target's abilities become the user's.",
        copy: "The user's abilities become the target's.",
        swap: "The user and the target exchange abilities.",
        simple: "The target's abilities become Simple: every stage change to it is doubled.",
      }[effect.how];
    case "batonPass":
      return "Switches out, passing stat stages, confusion, seeds, a substitute and other conditions to the next one.";
    case "shedTail":
      return "Costs half its max HP: switches out and leaves a substitute of a quarter of its HP for the next one.";
    case "partingShot":
      return "Lowers the target's Attack and Sp. Atk by 1 stage, then the user switches out.";
    case "hazard":
      return {
        stealthrock: "Rocks on the foe's side: every arrival takes 1/8 of its max HP, scaled by how Rock hits it.",
        spikes: "Spikes on the foe's side (up to 3 layers): grounded arrivals take 1/8, 1/6 or 1/4 of max HP.",
        toxicspikes: "Poison spikes on the foe's side (up to 2 layers): grounded arrivals are poisoned; a grounded Poison type clears them.",
        stickyweb: "A web on the foe's side: grounded arrivals lose 1 Speed stage.",
      }[effect.id];
    case "defog":
      return "Lowers the target's evasion by 1 stage, clears its Reflect, Light Screen, Mist and Safeguard, and clears every hazard on both sides.";
    case "tidyUp":
      return "Clears every hazard and substitute on both sides, then raises Attack and Speed by 1 stage.";
    case "meFirst":
      return "Uses the target's chosen attack first, at 1.5× power. Fails if the target has already moved or chose a status move.";
    case "naturePower":
      return "Becomes a move decided by the terrain, or by the ground the battle is on.";
    case "snatch":
      return "This turn, steals the next status move the foe uses on itself.";
    case "magicCoat":
      return "This turn, bounces status moves aimed at the user back at whoever used them.";
    case "mimic":
      return "Replaces Mimic with the target's last move (5 PP) until the user switches out.";
    case "embargo":
      return "The target's held item does nothing for 5 turns.";
    case "recycle":
      return "Brings back the last item the user used up, if it holds nothing.";
    case "trick":
      return "The user and the target exchange held items. Items move back after a battle against a trainer.";
    case "bestow":
      return "Gives the user's held item to a target holding nothing.";
    case "eatBerry":
      return effect.both
        ? "Both creatures eat their held berry now, whatever it was waiting for."
        : "The user eats its held berry now and raises its Defence by 2 stages. Fails without a berry.";
    case "taunt":
      return "For 3 turns, the target cannot use status moves.";
    case "disable":
      return "For 4 turns, the target cannot use the move it used last.";
    case "encore":
      return "For 3 turns, the target can only use the move it used last.";
    case "imprison":
      return "The foe cannot use any move the user also knows, until the user switches out.";
    case "torment":
      return "The target cannot use the same move twice in a row.";
    case "healBlock":
      return `For ${effect.turns} turns, the target cannot heal and cannot use healing moves.`;
    case "grudge":
      return "If the user faints to a move before it moves again, that move loses all its PP.";
    case "substitute":
      return "Costs 1/4 of max HP: a decoy with that much HP takes hits and blocks most status moves.";
    case "powder":
      return "This turn, if the target uses a Fire move it fails and the target loses 1/4 of its max HP.";
    case "electrify":
      return "The target's move this turn becomes Electric. Fails if it already moved.";
    case "octolock":
      return "The target cannot switch out or run, and loses 1 Defence and Sp. Def stage every turn while the user stays in.";
    case "curse":
      return "A Ghost user loses half its max HP and the target loses 1/4 of its max HP every turn. Anything else: Attack and Defence +1, Speed −1.";
    case "guard":
      return {
        quick: "This turn, blocks moves with raised priority aimed at the user.",
        wide: "This turn, blocks moves that hit everything opposite (Earthquake, Surf, Rock Slide…).",
        crafty: "This turn, blocks status moves aimed at the user.",
        mat: "Only on the user's first turn out: blocks damaging moves this turn.",
      }[effect.kind];
    case "nothing":
      return "Does nothing. That is the point.";
    default: {
      const missed: never = effect;
      return String(missed);
    }
  }
}

/** Every sentence a move's engine-side effects add up to. Empty for most attacks. */
export function effectLines(moveId: string): string[] {
  return extraEffects(moveId).map(effectText);
}
