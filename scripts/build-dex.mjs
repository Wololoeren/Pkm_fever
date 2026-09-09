/**
 * Generates the species manifest the engine reads.
 *
 * Nothing in src/engine ever names a species literally — everything goes
 * through the files this writes, which is what keeps the roster a swappable
 * data file rather than something welded into the game. Point this at a
 * different source and the game runs on a different bestiary without an
 * engine change.
 *
 * Deliberately *not* wired into prebuild. A roster that changed quietly
 * between two builds would invalidate every save file in existence without
 * anybody noticing. Run it on purpose, read the diff, then commit.
 *
 *   node scripts/build-dex.mjs
 *
 * Four outputs, split by how they are used in the browser:
 *   src/data/species.json    small, always loaded
 *   src/data/types.json      the 18x18 chart, tiny
 *   src/data/moves.json      loaded with the battle system
 *   src/data/learnsets.json  largest, loaded when a level-up needs it
 *   src/data/machines.json   which species each TM will take, as bitsets
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Dex } from "@pkmn/dex";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "src", "data");

const STAT_IDS = ["hp", "atk", "def", "spa", "spd", "spe"];

/**
 * The ungenerationed Dex, on purpose.
 *
 * A generation-scoped view only contains what that generation could legally
 * use — asking gen 9 for Machop returns nothing at all, because it is not in
 * Scarlet and Violet. This game is not bound by any generation's legality
 * rules, so it reads the whole catalogue and takes the most recent data it
 * finds for each species.
 */
const ALL = Dex.species.all();

/**
 * What counts as a creature somebody could own.
 *
 * `Past` and `LGPE` are kept: those are real species that a current game
 * happens not to include, which is a competitive-legality concern rather than
 * ours. `CAP` and `Custom` are fan-made and Showdown-internal respectively,
 * and battle-only formes (Mega, Gigantamax) cannot be caught.
 */
const EXCLUDED_KINDS = new Set(["CAP", "Custom"]);

function isPlayable(species) {
  if (!species.exists || species.num <= 0 || species.battleOnly) return false;
  return !EXCLUDED_KINDS.has(species.isNonstandard);
}

/**
 * Catch rate is not in Showdown's data at all — it simulates battles, not
 * capture — so it is derived here rather than copied. A monotone function of
 * base stat total is honest about what it is, and behaves better than
 * vanilla's table, which is full of historical accidents.
 */
function catchRateFor(base) {
  const bst = STAT_IDS.reduce((total, stat) => total + base[stat], 0);
  return Math.min(255, Math.max(3, Math.round(320 - bst * 0.42)));
}

/** Experience yield is missing for the same reason, and derived the same way:
 * a stronger opponent should be worth more, and nothing else matters. */
function baseExpFor(base) {
  const bst = STAT_IDS.reduce((total, stat) => total + base[stat], 0);
  return Math.round(bst * 0.9);
}

/**
 * Level-up moves, merged down the prevo chain so an evolved form knows what
 * its earlier stage learned.
 *
 * Sources look like "8L36" — generation 8, learned at level 36. A species
 * usually appears in several generations with the levels shifted, so the most
 * recent generation wins, and within it the earliest level. That gives every
 * species a modern moveset without excluding the ones a current game dropped.
 */
async function levelMovesFor(species) {
  const best = new Map();

  for (let current = species; current; current = current.prevo ? Dex.species.get(current.prevo) : null) {
    const learnset = await Dex.learnsets.get(current.id);
    if (!learnset?.learnset) continue;

    for (const [moveId, sources] of Object.entries(learnset.learnset)) {
      for (const source of sources) {
        const match = /^(\d)L(\d+)$/.exec(source);
        if (!match) continue;

        const gen = Number(match[1]);
        const level = Number(match[2]);
        const known = best.get(moveId);
        if (!known || gen > known.gen || (gen === known.gen && level < known.level)) {
          best.set(moveId, { gen, level });
        }
      }
    }
  }

  return [...best.entries()]
    .map(([moveId, { level }]) => [level, moveId])
    .sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1));
}

/**
 * Moves this species can be taught by machine, merged down the prevo chain.
 *
 * The same walk as `levelMovesFor`, reading `8M` — generation 8, learned from
 * a machine — instead of `8L36`. No level and no ordering: a machine move is
 * available or it is not, and which generation's machine it was is not a fact
 * this game has any use for.
 *
 * Which moves are TMs is therefore *derived* rather than listed. Every real
 * game numbers its own hundred and renumbers them next generation, and the
 * data ships no numbering at all, so a TM here is named after its move. That
 * is the one naming that cannot go stale or quietly disagree with a game
 * somebody remembers.
 */
async function machineMovesFor(species) {
  const found = new Set();

  for (let current = species; current; current = current.prevo ? Dex.species.get(current.prevo) : null) {
    const learnset = await Dex.learnsets.get(current.id);
    if (!learnset?.learnset) continue;

    for (const [moveId, sources] of Object.entries(learnset.learnset)) {
      if (sources.some((source) => /^\dM$/.test(source))) found.add(moveId);
    }
  }

  return [...found].sort();
}

/**
 * One species' machine list as a bitset over the shared move table.
 *
 * Sixty-nine thousand species-and-move pairs written out as arrays of strings
 * is several megabytes of manifest for a static export to carry. As bits over
 * one sorted table it is forty-one bytes a species, and base64 makes it a
 * string JSON can hold without escaping.
 */
function packBits(ids, index) {
  const bytes = new Uint8Array(Math.ceil(index.size / 8));
  for (const id of ids) {
    const at = index.get(id);
    if (at === undefined) continue;
    bytes[at >> 3] |= 1 << (at & 7);
  }
  return Buffer.from(bytes).toString("base64");
}

/**
 * Which sprite belongs to which species.
 *
 * PokeAPI keys its sprites by its own id, which is the national dex number for
 * a base species and something in the 10000s for every regional form — Alolan
 * Vulpix is 10103, not 37. Without the mapping a regional form shows its base
 * form's art, which is wrong in a way players notice immediately.
 *
 * The only network call in this script, and the reason it stays out of
 * prebuild. If it fails the build still succeeds with base-form sprites, since
 * a missing regional sprite is a cosmetic problem and an unbuildable manifest
 * is not.
 */
async function spriteNumbers() {
  try {
    const response = await fetch("https://pokeapi.co/api/v2/pokemon?limit=2000");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const { results } = await response.json();
    return new Map(results.map((row) => [row.name, Number(row.url.split("/").filter(Boolean).pop())]));
  } catch (error) {
    console.warn(`! could not reach PokeAPI (${error.message}) — regional forms will use base-form sprites`);
    return new Map();
  }
}

/** PokeAPI's naming: "vulpix-alola" for what the dex calls Vulpix-Alola. */
function pokeApiName(entry) {
  const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const base = slug(entry.baseSpecies || entry.name);
  return entry.forme ? `${base}-${slug(entry.forme)}` : base;
}

const spriteIds = await spriteNumbers();

const species = [];
const learnsets = {};
const machinesBySpecies = {};
const skipped = [];
let mappedForms = 0;

for (const entry of ALL) {
  if (!isPlayable(entry)) continue;

  const moveList = await levelMovesFor(entry);

  // A creature with no moves would soft-lock the first battle it walked into,
  // so it does not belong in the manifest at all. In practice this catches the
  // alternate formes whose learnset lives under the base species — Rotom Wash,
  // the Arceus plates, Deoxys Attack — which are form changes driven by an
  // item rather than things found in grass. Filtering on "has a learnset of
  // its own" keeps every regional variant, which does, and needs no editing
  // when the data changes.
  if (!moveList.length) {
    skipped.push(entry.id);
    continue;
  }

  const base = {};
  for (const stat of STAT_IDS) base[stat] = entry.baseStats[stat];

  const spriteNum = spriteIds.get(pokeApiName(entry)) ?? entry.num;
  if (spriteNum !== entry.num) mappedForms++;

  species.push({
    id: entry.id,
    num: entry.num,
    name: entry.name,
    types: entry.types.map((t) => t.toLowerCase()),
    base,
    eggGroups: entry.eggGroups ?? [],
    catchRate: catchRateFor(base),
    baseExp: baseExpFor(base),
    /** PokeAPI's sprite id, which is the dex number except for regional
     * forms. Rendering asks for this, never `num`. */
    spriteNum,
    evolvesTo: [],
  });

  learnsets[entry.id] = moveList;
  machinesBySpecies[entry.id] = await machineMovesFor(entry);
}

species.sort((a, b) => a.num - b.num || (a.id < b.id ? -1 : 1));

// Evolutions are recorded on the child in the dex (Ivysaur knows it came from
// Bulbasaur at 16), but the engine asks the question from the other side, so
// invert the relation once here rather than searching at runtime.
const byId = new Map(species.map((s) => [s.id, s]));
for (const entry of ALL) {
  if (!isPlayable(entry) || !entry.prevo) continue;

  const parent = byId.get(Dex.species.get(entry.prevo).id);
  const child = byId.get(entry.id);
  if (!parent || !child) continue;

  parent.evolvesTo.push({
    id: child.id,
    level: entry.evoLevel ?? 0,
    method: entry.evoType ?? "level",
    item: entry.evoItem ?? null,
  });
}
for (const entry of species) {
  entry.evolvesTo.sort((a, b) => (a.id < b.id ? -1 : 1));
}

// ------------------------------------------------------------------- moves

/** Only the five stages the battle system models. Accuracy and evasion are
 * left out on purpose: they interact with every accuracy check in the game
 * and are not worth the surface area until the format asks for them. */
const STAGE_STATS = ["atk", "def", "spa", "spd", "spe"];

function boostsOf(raw) {
  if (!raw) return null;
  const out = {};
  for (const stat of STAGE_STATS) {
    if (raw[stat]) out[stat] = raw[stat];
  }
  return Object.keys(out).length ? out : null;
}

/** Showdown models a secondary as a chance plus whatever it inflicts. Only
 * the parts the battle system understands are carried across, so a move never
 * claims an effect the engine will silently drop. */
function secondaryOf(move) {
  const raw = move.secondary ?? (move.secondaries?.length ? move.secondaries[0] : null);
  if (!raw) return null;

  const status = raw.status ?? null;
  const boosts = boostsOf(raw.boosts ?? raw.self?.boosts);
  if (!status && !boosts) return null;

  return {
    chance: raw.chance ?? 100,
    status,
    boosts,
    self: Boolean(raw.self && !raw.boosts),
  };
}

// Every move some species can reach, by growing into it or by being taught
// it. A move nothing can learn is a row the engine would never read; a move
// only a machine grants is one it would otherwise look up and not find.
const usedMoves = new Set();
for (const list of Object.values(learnsets)) {
  for (const [, moveId] of list) usedMoves.add(moveId);
}
for (const list of Object.values(machinesBySpecies)) {
  for (const moveId of list) usedMoves.add(moveId);
}

// The shared table every species' bitset is read against. Sorted, so a rebuild
// on the same data produces byte-identical output.
const machineMoves = [...new Set(Object.values(machinesBySpecies).flat())]
  .filter((id) => Dex.moves.get(id)?.exists)
  .sort();
const machineIndex = new Map(machineMoves.map((id, at) => [id, at]));

const machines = {
  moves: machineMoves,
  learners: Object.fromEntries(
    Object.entries(machinesBySpecies).map(([id, list]) => [id, packBits(list, machineIndex)]),
  ),
};

const moves = [...usedMoves]
  .map((id) => Dex.moves.get(id))
  .filter((move) => move?.exists)
  .map((move) => ({
    id: move.id,
    name: move.name,
    type: move.type.toLowerCase(),
    category: move.category.toLowerCase(),
    power: move.basePower ?? 0,
    // `true` means "cannot miss"; 0 carries that through to the engine.
    accuracy: move.accuracy === true ? 0 : (move.accuracy ?? 0),
    pp: move.pp ?? 0,
    priority: move.priority ?? 0,
    critRatio: move.critRatio ?? 1,
    /** Where a status move's boosts land — "self" or "normal". */
    target: move.target ?? "normal",
    status: move.status ?? null,
    boosts: boostsOf(move.boosts),
    secondary: secondaryOf(move),
    drain: move.drain ?? null,
    recoil: move.recoil ?? null,
    heal: move.heal ?? null,
  }))
  .sort((a, b) => (a.id < b.id ? -1 : 1));

// ---------------------------------------------------------------- starters

/**
 * The starter trios, in generation order, each column one type.
 *
 * Curated rather than derived, because there is no signature to derive from.
 * "Is a starter" is a designer's decision, not a property of the data: the
 * first cut asked for three-stage lines with a base stat total between 280 and
 * 330 and duly offered Beldum, Klink and Solosis, which are three-stage lines
 * with a base stat total between 280 and 330 and are not starters.
 *
 * So it is a list, and it lives here rather than in src/engine, which never
 * names a species. The engine reads what this emits.
 */
const STARTER_TRIOS = [
  ["bulbasaur", "charmander", "squirtle"],
  ["chikorita", "cyndaquil", "totodile"],
  ["treecko", "torchic", "mudkip"],
  ["turtwig", "chimchar", "piplup"],
  ["snivy", "tepig", "oshawott"],
  ["chespin", "fennekin", "froakie"],
  ["rowlet", "litten", "popplio"],
  ["grookey", "scorbunny", "sobble"],
  ["sprigatito", "fuecoco", "quaxly"],
];

/** Column order. A trio is always one of each, in this order. */
const STARTER_TYPES = ["grass", "fire", "water"];

/**
 * Checks the list against the manifest and refuses to emit a broken one.
 *
 * A starter that is missing, mistyped, or not actually the bottom of a
 * three-stage line would reach the player as a wrong or empty choice on the
 * very first screen. Better to fail the build somebody ran on purpose.
 */
function checkStarters(byId) {
  const problems = [];

  for (const trio of STARTER_TRIOS) {
    if (trio.length !== STARTER_TYPES.length) {
      problems.push(`${trio.join("/")}: expected ${STARTER_TYPES.length} members`);
      continue;
    }

    trio.forEach((id, column) => {
      const entry = byId.get(id);
      if (!entry) {
        problems.push(`${id}: not in the manifest`);
        return;
      }
      if (entry.types[0] !== STARTER_TYPES[column]) {
        problems.push(`${id}: primary type is ${entry.types[0]}, expected ${STARTER_TYPES[column]}`);
      }

      // At *least* one final form, not exactly one: Quilava evolves into both
      // Typhlosion and Typhlosion-Hisui, and Dewott and Dartrix branch the
      // same way. Demanding a single final form quietly disqualified
      // Cyndaquil, Oshawott and Rowlet — three real starters — which is
      // exactly the kind of thing this check exists to catch.
      const middle = entry.evolvesTo.length >= 1 ? byId.get(entry.evolvesTo[0].id) : null;
      if (!middle || middle.evolvesTo.length < 1) {
        problems.push(`${id}: not the bottom of a three-stage line`);
      }
    });
  }

  if (problems.length) {
    console.error("! the starter list does not match the manifest:");
    for (const problem of problems) console.error(`    ${problem}`);
    process.exit(1);
  }
}

checkStarters(byId);

// ------------------------------------------------------------------- types

/**
 * The type chart, in quarters: 4 is neutral, 8 super effective, 2 resisted,
 * 0 immune. Quarters rather than floats because damage is integer arithmetic
 * all the way down, and 0.25x is the smallest step two types can produce.
 *
 * Showdown stores it on the *defending* type as damageTaken, where 0 means
 * neutral, 1 weak, 2 resistant and 3 immune. Inverted here once so the engine
 * can ask the question the way it actually arises: attacker against defender.
 */
const TYPE_QUARTERS = { 0: 4, 1: 8, 2: 2, 3: 0 };

const typeNames = Dex.types
  .all()
  .filter((type) => type.exists && !EXCLUDED_KINDS.has(type.isNonstandard))
  .map((type) => type.name)
  .sort();

const chart = {};
for (const attacking of typeNames) {
  chart[attacking.toLowerCase()] = {};
  for (const defending of typeNames) {
    const taken = Dex.types.get(defending).damageTaken[attacking];
    chart[attacking.toLowerCase()][defending.toLowerCase()] = TYPE_QUARTERS[taken] ?? 4;
  }
}

// ------------------------------------------------------------------- output

mkdirSync(OUT_DIR, { recursive: true });

const write = (name, value) => {
  writeFileSync(join(OUT_DIR, name), JSON.stringify(value) + "\n");
};

write("species.json", species);
write("moves.json", moves);
write("learnsets.json", learnsets);
write("machines.json", machines);
write("types.json", chart);
write("starters.json", { types: STARTER_TYPES, trios: STARTER_TRIOS });

console.log(`species    ${species.length}`);
console.log(`moves      ${moves.length}`);
console.log(`learnsets  ${Object.keys(learnsets).length}`);
console.log(`machines   ${machineMoves.length} moves over ${Object.keys(machines.learners).length} species`);
console.log(`types      ${typeNames.length}x${typeNames.length} chart`);
console.log(`starters   ${STARTER_TRIOS.length} trios, one of each of ${STARTER_TYPES.join("/")}`);
console.log(`sprites    ${mappedForms} regional forms mapped to their own art`);
console.log(`skipped    ${skipped.length} formes with no learnset of their own`);
