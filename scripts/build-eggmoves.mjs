/**
 * Generates the egg-move manifest the engine reads.
 *
 * Its own script rather than another output of `build-dex.mjs`, and
 * deliberately so: that one rewrites the species, the moves, the learnsets and
 * the type chart in one go, and running it to add a single new file would
 * quietly restate every one of them against whatever `@pkmn/dex` ships today.
 * A roster that changes underneath a save is the one thing this project will
 * not do by accident. This writes one file and touches nothing else.
 *
 *   node scripts/build-eggmoves.mjs
 *
 * Output: src/data/eggmoves.json — { [speciesId]: moveId[] }
 *
 * ## What counts as an egg move
 *
 * Showdown's learnsets tag every way a species can come by a move: `8L36` is
 * level thirty-six, `8M` is a machine, and `8E` is an egg. This reads the last
 * of those, merged down the prevo chain exactly as the level moves and the
 * machine moves are — so an Ivysaur's list contains Bulbasaur's, and asking
 * any member of a line gives the line's answer.
 *
 * Two filters, and both matter:
 *
 *   - A move the engine does not have is dropped. The move manifest is built
 *     from a narrower set than the learnsets mention, and a move id nothing
 *     can look up is a crash waiting in a daycare.
 *   - A move the species already learns by levelling is dropped. It would be
 *     an egg move you could get by waiting, which is not a thing worth
 *     breeding for and would read as noise in the handbook.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Dex } from "@pkmn/dex";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "data", "eggmoves.json");

/** The species and move manifests as they stand, so nothing is invented. */
const species = JSON.parse(
  await import("node:fs").then((fs) => fs.readFileSync(join(ROOT, "src", "data", "species.json"), "utf8")),
);
const moves = JSON.parse(
  await import("node:fs").then((fs) => fs.readFileSync(join(ROOT, "src", "data", "moves.json"), "utf8")),
);
const learnsets = JSON.parse(
  await import("node:fs").then((fs) => fs.readFileSync(join(ROOT, "src", "data", "learnsets.json"), "utf8")),
);

const KNOWN_MOVES = new Set(moves.map((move) => move.id));

/** Every move this species can come by from an egg, down the prevo chain. */
async function eggMovesFor(id) {
  const found = new Set();
  let current = Dex.species.get(id);

  for (let step = 0; current && step < 8; step++) {
    const learnset = await Dex.learnsets.get(current.id);
    if (learnset?.learnset) {
      for (const [moveId, sources] of Object.entries(learnset.learnset)) {
        if (sources.some((source) => /^\dE$/.test(source))) found.add(moveId);
      }
    }
    current = current.prevo ? Dex.species.get(current.prevo) : null;
  }

  return found;
}

const out = {};
let pairs = 0;

for (const entry of species) {
  const byLevel = new Set((learnsets[entry.id] ?? []).map(([, moveId]) => moveId));
  const found = [...(await eggMovesFor(entry.id))]
    .filter((moveId) => KNOWN_MOVES.has(moveId) && !byLevel.has(moveId))
    .sort();
  if (!found.length) continue;
  out[entry.id] = found;
  pairs += found.length;
}

writeFileSync(OUT, `${JSON.stringify(out)}\n`, "utf8");
console.log(`eggmoves   ${Object.keys(out).length} species, ${pairs} moves`);
