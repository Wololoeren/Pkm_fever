/**
 * Generates the battle-form manifest the engine reads.
 *
 * Its own script, and its own file, for the same reason the egg moves have
 * one: `build-dex.mjs` rewrites the whole roster in one go, and running it to
 * add a file would restate every species against whatever `@pkmn/dex` ships
 * today. This writes `src/data/forms.json` and touches nothing else.
 *
 *   node scripts/build-forms.mjs
 *
 * ## What is in here and what is not
 *
 * These are the shapes a creature takes *during a fight* — Castform in the
 * rain, Aegislash with the sword out, Mimikyu after the hit that breaks it.
 * The roster deliberately does not contain them: `isPlayable` drops every
 * `battleOnly` forme, and it should, because none of them is a thing you can
 * catch, hatch, breed, buy at an auction or find lying in the grass. They are
 * states, not species.
 *
 * So they are loaded beside the roster rather than into it: `species()` can
 * resolve one, so its stats, its types and its sprite all work, while
 * `ALL_SPECIES` never mentions it, so no pool the world draws from moves by a
 * single entry. See `FORM_SPECIES` in dex.ts.
 *
 * The numbers are the form's own — that is the whole point of a form — but
 * `catchRate` and `baseExp` are copied from the base species rather than
 * recomputed. Nothing wild is ever one of these, and experience is paid on
 * what fainted, which is the base: a Darmanitan that went Zen and fell over is
 * worth a Darmanitan.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Dex } from "@pkmn/dex";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "data", "forms.json");

/**
 * Which forms, by the species that wears them.
 *
 * Listed rather than derived: "every battle-only forme" would sweep in the
 * Megas, the Gigantamaxes, the Totems and Minior's seven colours, none of
 * which this game has a trigger for. The rules that drive these live in
 * `src/engine/forms.ts`; this is only the data they need.
 */
// Cherrim-Sunshine is deliberately absent: same types, same stats, same
// picture. See the note at the top of src/engine/forms.ts.
const WANTED = [
  "Castform-Sunny",
  "Castform-Rainy",
  "Castform-Snowy",
  "Darmanitan-Zen",
  "Darmanitan-Galar-Zen",
  "Minior-Meteor",
  "Wishiwashi-School",
  "Mimikyu-Busted",
  "Eiscue-Noice",
  "Morpeko-Hangry",
  "Aegislash-Blade",
  "Meloetta-Pirouette",
];

const species = JSON.parse(readFileSync(join(ROOT, "src", "data", "species.json"), "utf8"));
const byId = new Map(species.map((entry) => [entry.id, entry]));

/**
 * Where PokeAPI calls a form something else.
 *
 * Its list is not quite the dex's: the meteor shell is filed under the red
 * core that lives inside it, and Galar's Zen mode spells out that it is
 * Galar's. Two names, written down rather than guessed at, because the
 * fallback is silently wearing the wrong picture.
 */
const SPRITE_ALIAS = {
  "minior-meteor": "minior-red-meteor",
  "darmanitan-galarzen": "darmanitan-galar-zen",
};

/** PokeAPI's naming, the same rule build-dex.mjs uses for regional forms. */
function pokeApiName(entry) {
  const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const base = slug(entry.baseSpecies || entry.name);
  return entry.forme ? `${base}-${slug(entry.forme)}` : base;
}

async function spriteNumbers() {
  try {
    const response = await fetch("https://pokeapi.co/api/v2/pokemon?limit=2000");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { results } = await response.json();
    return new Map(results.map((row) => [row.name, Number(row.url.split("/").filter(Boolean).pop())]));
  } catch (error) {
    console.warn(`! could not reach PokeAPI (${error.message}) — forms will wear the base sprite`);
    return new Map();
  }
}

const spriteIds = await spriteNumbers();
const out = {};
let missing = 0;

for (const name of WANTED) {
  const forme = Dex.species.get(name);
  if (!forme?.exists) {
    console.warn(`! no such forme: ${name}`);
    missing += 1;
    continue;
  }

  /*
   * What it is a form *of*, in this roster's terms.
   *
   * Not `baseSpecies`: that says "Darmanitan" for Darmanitan-Galar-Zen, and
   * the thing that turns into it here is Darmanitan-Galar, which the roster
   * carries as a species of its own. The longest roster id the form's id
   * begins with is the honest answer, and it is the same rule the event
   * forms use in dex.ts.
   */
  const base = [...byId.values()]
    .filter((entry) => forme.id.startsWith(entry.id))
    .sort((a, b) => b.id.length - a.id.length)[0];
  if (!base) {
    console.warn(`! ${name}: its base ${forme.baseSpecies} is not in the roster`);
    missing += 1;
    continue;
  }

  const apiName = pokeApiName(forme);
  const sprite = spriteIds.get(SPRITE_ALIAS[apiName] ?? apiName);
  if (!sprite) console.warn(`! ${name}: no sprite of its own, wearing ${base.name}'s`);

  out[forme.id] = {
    id: forme.id,
    num: base.num,
    name: forme.name,
    types: forme.types.map((type) => type.toLowerCase()),
    base: {
      hp: forme.baseStats.hp,
      atk: forme.baseStats.atk,
      def: forme.baseStats.def,
      spa: forme.baseStats.spa,
      spd: forme.baseStats.spd,
      spe: forme.baseStats.spe,
    },
    // A form is never in an egg, never for sale and never in the grass, and
    // these are the three fields that would say otherwise.
    eggGroups: ["Undiscovered"],
    catchRate: base.catchRate,
    baseExp: base.baseExp,
    spriteNum: sprite ?? base.spriteNum,
    evolvesTo: [],
    /** The species it goes back to when it leaves the field. */
    formOf: base.id,
  };
}

writeFileSync(OUT, `${JSON.stringify(out, null, 0)}\n`, "utf8");
console.log(`forms      ${Object.keys(out).length} written${missing ? `, ${missing} missing` : ""}`);
