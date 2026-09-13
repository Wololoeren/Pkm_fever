/**
 * Pits the shipped policy against the uniform one and the teacher on fresh
 * matchups, and says how it did.
 *
 *   npm run ai:eval -- --seed other --games 100
 */
import { TRAINED } from "@/ai";
import { arena } from "@/ai/arena";
import { oraclePolicy } from "@/ai/oracle";
import { UNIFORM } from "@/ai/policy";
import { randomMatchups } from "@/ai/teams";

function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}
const seed = flag("seed", "judge");
const games = Number(flag("games", "100"));
const size = Number(flag("size", "3"));

const held = randomMatchups(seed, games, { size });
const line = (label: string, result: ReturnType<typeof arena>) =>
  console.log(
    `${label.padEnd(12)} ${result.wins[0]}-${result.wins[1]} (${result.draws} drawn), ${result.shareMille / 10}% of decided, ${result.meanTurns} turns each`,
  );
line("vs uniform", arena(seed, held, TRAINED, UNIFORM));
line("vs teacher", arena(seed, held.slice(0, Math.max(1, Math.floor(games / 5))), TRAINED, oraclePolicy({ samples: 2, horizon: 1 })));
