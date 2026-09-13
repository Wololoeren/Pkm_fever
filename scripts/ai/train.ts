/**
 * Trains the trainer's policy and, with --write, ships it.
 *
 *   npm run ai:train -- --seed fever --iterations 3 --games 40 --write
 *
 * Runs through vite-node so it can import the engine as the tests do. Every
 * number it prints is a pure function of the flags, so a run can be repeated.
 */
import { writeFileSync } from "node:fs";
import { arena } from "@/ai/arena";
import { FEATURE_NAMES } from "@/ai/features";
import { oraclePolicy } from "@/ai/oracle";
import { linearPolicy, UNIFORM } from "@/ai/policy";
import { randomMatchups } from "@/ai/teams";
import { collect, iterate, report } from "@/ai/train";
import { TRAINED_WEIGHTS } from "@/ai";

function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}
const has = (name: string) => process.argv.includes(`--${name}`);

const seed = flag("seed", "fever");
const iterations = Number(flag("iterations", "3"));
const games = Number(flag("games", "40"));
const size = Number(flag("size", "3"));
const samples = Number(flag("samples", "2"));
const horizon = Number(flag("horizon", "1"));
const epochs = Number(flag("epochs", "20"));
const evalGames = Number(flag("eval", "60"));
const l2 = Number(flag("l2", "0.0001"));
const temperature = Number(flag("temperature", "300"));
const fromShipped = has("continue");

const started = Date.now();
const log = (line: string) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${line}`);

log(`training on seed "${seed}": ${iterations} rounds x ${games} games, teams of ${size}, oracle s${samples}/h${horizon}`);
const result = iterate({
  seed,
  iterations,
  init: fromShipped ? TRAINED_WEIGHTS.map((w) => w / 1000) : null,
  collect: { games, size, oracle: { samples, horizon } },
  fit: { epochs, l2, temperature },
  log,
});

log("weights:");
for (let at = 0; at < FEATURE_NAMES.length; at++) {
  console.log(`  ${FEATURE_NAMES[at].padEnd(14)} ${String(result.weights[at]).padStart(7)}`);
}

// Decisions the student never trained on, played by the teacher alone: how
// much value the student gives away per decision, out of sample, is the one
// number here that is not noisy.
const held = collect(`${seed}:held`, null, { games: Math.max(10, Math.floor(games / 3)), size, oracle: { samples, horizon } });
const heldReport = report(held, result.weights);
log(`held-out: agreement ${heldReport.agreementMille / 10}%, mean regret ${heldReport.meanRegret} over ${heldReport.samples} decisions (hand-set/shipped: ${report(held, TRAINED_WEIGHTS).meanRegret})`);

const student = linearPolicy(result.weights, "student");
const matchups = randomMatchups(`${seed}:eval`, evalGames, { size });
const versusUniform = arena(seed, matchups, student, UNIFORM);
log(`vs uniform: ${versusUniform.wins[0]}-${versusUniform.wins[1]} (${versusUniform.draws} drawn), ${versusUniform.shareMille / 10}% of decided`);
const versusShipped = arena(seed, matchups, student, linearPolicy(TRAINED_WEIGHTS, "shipped"));
log(`vs shipped: ${versusShipped.wins[0]}-${versusShipped.wins[1]} (${versusShipped.draws} drawn), ${versusShipped.shareMille / 10}% of decided`);
const teacher = oraclePolicy({ samples, horizon });
const fewer = matchups.slice(0, Math.max(1, Math.floor(evalGames / 6)));
const versusTeacher = arena(seed, fewer, student, teacher);
log(`vs teacher (${fewer.length} matchups): ${versusTeacher.wins[0]}-${versusTeacher.wins[1]} (${versusTeacher.draws} drawn), ${versusTeacher.shareMille / 10}% of decided`);

// Only weights that beat the shipped ones out of sample are worth shipping:
// a run that lost to them would replace the opponent with a worse one and
// bump the engine version for it. --force writes anyway.
const better = heldReport.meanRegret < report(held, TRAINED_WEIGHTS).meanRegret;
if (has("write") && !better && !has("force")) {
  log("not written: the shipped weights lose less on the held-out set (pass --force to write anyway)");
}
if (has("write") && (better || has("force"))) {
  const file = {
    features: FEATURE_NAMES,
    weights: result.weights,
    trained: {
      seed,
      iterations,
      games,
      size,
      oracle: { samples, horizon },
      decisions: result.samples.length,
      agreementMille: result.reports.at(-1)?.agreementMille,
      meanRegret: result.reports.at(-1)?.meanRegret,
      heldOutAgreementMille: heldReport.agreementMille,
      heldOutRegret: heldReport.meanRegret,
      versusUniformMille: versusUniform.shareMille,
      versusTeacherMille: versusTeacher.shareMille,
      at: new Date().toISOString().slice(0, 10),
    },
  };
  writeFileSync("src/data/ai-weights.json", JSON.stringify(file, null, 2) + "\n");
  log("wrote src/data/ai-weights.json");
}
