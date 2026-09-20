import { FORM_BASE, move as moveById, species as speciesById } from "./dex";
import type { Gender } from "./gender";
import { isItem, item } from "./items";
import type { Individual } from "./types";

/**
 * Every evolution that is not a plain level or a plain stone.
 *
 * The manifest names eighty-odd of these by how the games do them — a trade,
 * friendship, a move known, a place, three critical hits in one battle — and
 * this game has no trading partner who hands creatures back, no friendship,
 * and no clock. So each one is given a rule this game *can* check, as close to
 * the original as that allows, and written down here in one table rather than
 * scattered as special cases:
 *
 *   - **A trade** is a Linking Cord, used like a stone.
 *   - **A trade holding an item** is a level-up holding that item — or a
 *     Linking Cord used while holding it — and the item is used up.
 *   - **Holding an item** at a level-up works the same way.
 *   - **Friendship** is a Soothe Bell carried at a level-up. Kept, not spent.
 *   - **Knowing a move** is exactly that, at a level-up.
 *   - **The rest** each get the nearest honest thing: a move they learn, an
 *     item, or a level.
 *
 * `tests/evolutions.test.ts` checks that every such evolution in the manifest
 * has a rule here, and that every item and move a rule names exists.
 */

export type EvolutionNeed =
  /** Holding the item with this name. `spent`: the item is gone afterwards. */
  | { t: "hold"; item: string; spent: boolean }
  /** Knowing this move. */
  | { t: "move"; move: string }
  /** Knowing any move of this type. */
  | { t: "moveType"; type: string }
  /** At or above this level. */
  | { t: "level"; level: number }
  /** Of this gender. */
  | { t: "gender"; gender: Gender }
  /** One creature in `per`, decided by its uid, so the same creature always gets the same answer. */
  | { t: "rare"; per: number };

export interface EvolutionRule {
  from: string;
  to: string;
  /** A level-up, or an item used from the bag (by name). */
  via: { t: "levelUp" } | { t: "use"; item: string };
  needs: readonly EvolutionNeed[];
}

export const LINKING_CORD = "Linking Cord";
export const SOOTHE_BELL = "Soothe Bell";

const levelUp = { t: "levelUp" } as const;
const usedItem = (name: string) => ({ t: "use", item: name }) as const;
const hold = (name: string, spent = true): EvolutionNeed => ({ t: "hold", item: name, spent });
const knows = (moveId: string): EvolutionNeed => ({ t: "move", move: moveId });
const knowsType = (type: string): EvolutionNeed => ({ t: "moveType", type });
const atLevel = (level: number): EvolutionNeed => ({ t: "level", level });
const bell = hold(SOOTHE_BELL, false);

/** A trade: a Linking Cord, or — when the trade wanted an item held — a level-up or a cord while holding it. */
function traded(from: string, to: string, held: string | null): EvolutionRule[] {
  if (!held) return [{ from, to, via: usedItem(LINKING_CORD), needs: [] }];
  return [
    { from, to, via: levelUp, needs: [hold(held)] },
    { from, to, via: usedItem(LINKING_CORD), needs: [hold(held)] },
  ];
}

/**
 * The table. Order matters where one species has two doors: the first rule
 * that fits wins, so the pickier door is listed first.
 */
const BASE_RULES: readonly EvolutionRule[] = [
  // Trades.
  ...traded("poliwhirl", "politoed", "King's Rock"),
  ...traded("kadabra", "alakazam", null),
  ...traded("machoke", "machamp", null),
  ...traded("graveler", "golem", null),
  ...traded("graveleralola", "golemalola", null),
  ...traded("slowpoke", "slowking", "King's Rock"),
  ...traded("haunter", "gengar", null),
  ...traded("onix", "steelix", "Metal Coat"),
  ...traded("rhydon", "rhyperior", "Protector"),
  ...traded("seadra", "kingdra", "Dragon Scale"),
  ...traded("scyther", "scizor", "Metal Coat"),
  ...traded("electabuzz", "electivire", "Electirizer"),
  ...traded("magmar", "magmortar", "Magmarizer"),
  ...traded("porygon", "porygon2", "Up-Grade"),
  ...traded("porygon2", "porygonz", "Dubious Disc"),
  ...traded("feebas", "milotic", "Prism Scale"),
  ...traded("dusclops", "dusknoir", "Reaper Cloth"),
  ...traded("clamperl", "gorebyss", "Deep Sea Scale"),
  ...traded("clamperl", "huntail", "Deep Sea Tooth"),
  ...traded("boldore", "gigalith", null),
  ...traded("gurdurr", "conkeldurr", null),
  ...traded("karrablast", "escavalier", null),
  ...traded("shelmet", "accelgor", null),
  ...traded("spritzee", "aromatisse", "Sachet"),
  ...traded("swirlix", "slurpuff", "Whipped Dream"),
  ...traded("phantump", "trevenant", null),
  ...traded("pumpkaboo", "gourgeist", null),

  // Holding something at a level-up.
  { from: "gligar", to: "gliscor", via: levelUp, needs: [hold("Razor Fang")] },
  { from: "sneasel", to: "weavile", via: levelUp, needs: [hold("Razor Claw")] },
  { from: "sneaselhisui", to: "sneasler", via: levelUp, needs: [hold("Razor Claw")] },
  { from: "happiny", to: "chansey", via: levelUp, needs: [hold("Oval Stone")] },

  // Friendship: a Soothe Bell. Eevee's three are told apart by what it knows.
  { from: "eevee", to: "sylveon", via: levelUp, needs: [bell, knowsType("fairy")] },
  { from: "eevee", to: "espeon", via: levelUp, needs: [bell, knowsType("psychic")] },
  { from: "eevee", to: "umbreon", via: levelUp, needs: [bell, knowsType("dark")] },
  ...(
    [
      ["golbat", "crobat"],
      ["meowthalola", "persianalola"],
      ["chansey", "blissey"],
      ["pichu", "pikachu"],
      ["cleffa", "clefairy"],
      ["igglybuff", "jigglypuff"],
      ["togepi", "togetic"],
      ["azurill", "marill"],
      ["budew", "roselia"],
      ["buneary", "lopunny"],
      ["chingling", "chimecho"],
      ["munchlax", "snorlax"],
      ["riolu", "lucario"],
      ["woobat", "swoobat"],
      ["swadloon", "leavanny"],
      ["typenull", "silvally"],
      ["snom", "frosmoth"],
    ] as const
  ).map(([from, to]): EvolutionRule => ({ from, to, via: levelUp, needs: [bell] })),

  // Knowing a move.
  { from: "lickitung", to: "lickilicky", via: levelUp, needs: [knows("rollout")] },
  { from: "tangela", to: "tangrowth", via: levelUp, needs: [knows("ancientpower")] },
  { from: "aipom", to: "ambipom", via: levelUp, needs: [knows("doublehit")] },
  { from: "yanma", to: "yanmega", via: levelUp, needs: [knows("ancientpower")] },
  { from: "girafarig", to: "farigiraf", via: levelUp, needs: [knows("twinbeam")] },
  // One Dunsparce in a hundred grows the extra segment, as in the games.
  { from: "dunsparce", to: "dudunsparcethreesegment", via: levelUp, needs: [knows("hyperdrill"), { t: "rare", per: 100 }] },
  { from: "dunsparce", to: "dudunsparce", via: levelUp, needs: [knows("hyperdrill")] },
  { from: "piloswine", to: "mamoswine", via: levelUp, needs: [knows("ancientpower")] },
  { from: "bonsly", to: "sudowoodo", via: levelUp, needs: [knows("mimic")] },
  // The Galarian Mr. Mime is the one that learned the cold.
  { from: "mimejr", to: "mrmimegalar", via: levelUp, needs: [knows("mimic"), knowsType("ice")] },
  { from: "mimejr", to: "mrmime", via: levelUp, needs: [knows("mimic")] },
  { from: "steenee", to: "tsareena", via: levelUp, needs: [knows("stomp")] },
  { from: "poipole", to: "naganadel", via: levelUp, needs: [knows("dragonpulse")] },
  { from: "clobbopus", to: "grapploct", via: levelUp, needs: [knows("taunt")] },
  { from: "dipplin", to: "hydrapple", via: levelUp, needs: [knows("dragonpulse")] },

  // Somewhere special. There is no magnetic field and no Remoraid to swim
  // beside, so: an Electric move, and a level.
  { from: "nosepass", to: "probopass", via: levelUp, needs: [knowsType("electric")] },
  { from: "mantyke", to: "mantine", via: levelUp, needs: [atLevel(30)] },

  // The rest: each the nearest thing this game can see.
  { from: "primeape", to: "annihilape", via: levelUp, needs: [knows("ragefist")] },
  { from: "farfetchdgalar", to: "sirfetchd", via: levelUp, needs: [hold("Leek")] },
  { from: "qwilfishhisui", to: "overqwil", via: levelUp, needs: [knows("barbbarrage")] },
  { from: "ursaring", to: "ursaluna", via: usedItem("Peat Block"), needs: [] },
  { from: "stantler", to: "wyrdeer", via: levelUp, needs: [knows("zenheadbutt")] },
  { from: "basculinwhitestriped", to: "basculegionf", via: levelUp, needs: [atLevel(36), { t: "gender", gender: "female" }] },
  { from: "basculinwhitestriped", to: "basculegion", via: levelUp, needs: [atLevel(36)] },
  { from: "yamaskgalar", to: "runerigus", via: levelUp, needs: [atLevel(34)] },
  { from: "bisharp", to: "kingambit", via: levelUp, needs: [hold("Leader's Crest")] },
  { from: "milcery", to: "alcremie", via: usedItem("Strawberry Sweet"), needs: [] },
  { from: "kubfu", to: "urshifu", via: usedItem("Scroll of Darkness"), needs: [] },
  { from: "kubfu", to: "urshifurapidstrike", via: usedItem("Scroll of Waters"), needs: [] },
  { from: "pawmo", to: "pawmot", via: levelUp, needs: [atLevel(35)] },
  { from: "bramblin", to: "brambleghast", via: levelUp, needs: [atLevel(30)] },
  { from: "rellor", to: "rabsca", via: levelUp, needs: [atLevel(30)] },
  { from: "gimmighoul", to: "gholdengo", via: usedItem("Gimmighoul Coin"), needs: [] },
];

/** The name of what it is holding, or null. */
function heldName(individual: Individual): string | null {
  return individual.heldItem && isItem(individual.heldItem) ? item(individual.heldItem).name : null;
}


/**
 * And the same rules again for the event forms, which evolve the way the form
 * they are a costume of does — see `FORM_BASE` in dex.ts for which those are
 * and why.
 *
 * Copied rather than written out, because a spiky-eared Pichu that needed a
 * Soothe Bell on Tuesdays while an ordinary one did not would be a bug wearing
 * a feature's clothes. Appended rather than interleaved: a rule only ever
 * fires on its own `from`, so nothing here can get in front of anything above.
 */
const FORM_RULES: readonly EvolutionRule[] = [...FORM_BASE].flatMap(([form, base]) =>
  BASE_RULES.filter((rule) => rule.from === base).map((rule) => ({ ...rule, from: form })),
);

export const EVOLUTION_RULES: readonly EvolutionRule[] = [...BASE_RULES, ...FORM_RULES];

function meets(individual: Individual, need: EvolutionNeed): boolean {
  switch (need.t) {
    case "hold":
      return heldName(individual) === need.item;
    case "move":
      return individual.moves.includes(need.move);
    case "moveType":
      return individual.moves.some((moveId) => moveById(moveId).type === need.type);
    case "level":
      return individual.level >= need.level;
    case "gender":
      return individual.gender === need.gender;
    case "rare":
      return individual.uid % need.per === 0;
  }
}

function fits(individual: Individual, rule: EvolutionRule): boolean {
  return rule.from === individual.speciesId && rule.needs.every((need) => meets(individual, need));
}

/** What a level-up would make of it through the table, or null. */
export function specialEvolutionAt(individual: Individual): string | null {
  return EVOLUTION_RULES.find((rule) => rule.via.t === "levelUp" && fits(individual, rule))?.to ?? null;
}

/** What using the item with this name would make of it through the table, or null. */
export function specialEvolutionByItem(individual: Individual, itemName: string): string | null {
  return EVOLUTION_RULES.find((rule) => rule.via.t === "use" && rule.via.item === itemName && fits(individual, rule))?.to ?? null;
}

/**
 * What it is holding after becoming `into`: the item the evolution used up is
 * gone, anything else stays.
 */
export function heldAfterEvolving(before: Individual, into: string): string | null {
  const spent = EVOLUTION_RULES.some(
    (rule) =>
      rule.to === into &&
      fits(before, rule) &&
      rule.needs.some((need) => need.t === "hold" && need.spent && heldName(before) === need.item),
  );
  return spent ? null : before.heldItem;
}

/**
 * Why an offered evolution through the table can no longer be taken, or null.
 *
 * An offer waits in the save, and in the meantime the Metal Coat can be taken
 * back or the move forgotten. Evolving anyway would keep the item the
 * evolution was supposed to use up.
 */
export function specialEvolutionLapsed(individual: Individual, into: string): string | null {
  const rules = EVOLUTION_RULES.filter((rule) => rule.from === individual.speciesId && rule.to === into && rule.via.t === "levelUp");
  if (!rules.length || rules.some((rule) => fits(individual, rule))) return null;
  return `it no longer meets what that needs — ${describeSpecialEvolution(individual.speciesId, into)}`;
}

/** Every item name a rule asks to be used from the bag. */
export function evolutionUseItems(): string[] {
  return [...new Set(EVOLUTION_RULES.flatMap((rule) => (rule.via.t === "use" ? [rule.via.item] : [])))].sort();
}

/** Every item name a rule asks to be held. */
export function evolutionHoldItems(): string[] {
  return [...new Set(EVOLUTION_RULES.flatMap((rule) => rule.needs.flatMap((need) => (need.t === "hold" ? [need.item] : []))))].sort();
}

/** A sentence for the handbook or a tooltip: how `from` becomes `to` under these rules, or null. */
export function describeSpecialEvolution(from: string, to: string): string | null {
  const rules = EVOLUTION_RULES.filter((rule) => rule.from === from && rule.to === to);
  if (!rules.length) return null;
  return rules
    .map((rule) => {
      const parts = rule.needs.map((need) => {
        switch (need.t) {
          case "hold":
            return `holding ${need.item}${need.spent ? " (used up)" : ""}`;
          case "move":
            return `knowing ${moveById(need.move).name}`;
          case "moveType":
            return `knowing a ${need.type[0].toUpperCase()}${need.type.slice(1)}-type move`;
          case "level":
            return `at level ${need.level}+`;
          case "gender":
            return `if ${need.gender}`;
          case "rare":
            return `(1 in ${need.per})`;
        }
      });
      const how = rule.via.t === "use" ? `use a ${rule.via.item}` : "level up";
      return [how, ...parts].join(" ");
    })
    .join(", or ");
}

/** Whether a species id exists — for the guard test. */
export function ruleSpeciesExist(rule: EvolutionRule): boolean {
  try {
    speciesById(rule.from);
    speciesById(rule.to);
    return true;
  } catch {
    return false;
  }
}
