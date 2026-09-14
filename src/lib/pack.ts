import type { Input } from "@/engine/engine";

/**
 * How an input log is written down.
 *
 * A save is a seed and a list of inputs, which is the whole design — but the
 * list is *long*. Measured on a generated playthrough: 23 bytes an input, and
 * a walking log is very nearly all walking. Thirty thousand inputs of a random
 * legal walk came out 29,999 moves and one starter pick, at 690KB. A real save
 * reaches ninety thousand moves, and localStorage is five megabytes.
 *
 * So the log is packed on the way out and unpacked on the way in. Two rules,
 * and between them they do the whole job:
 *
 * **A string is a run of moves.** `{ t: "move", dir: "e" }` is 22 bytes of
 * JSON and one letter of information, and moves arrive in runs because walking
 * is what you spend a game doing. A run becomes one string — `"eenneww"` — so
 * fifty steps cost fifty-two bytes rather than eleven hundred.
 *
 * **An array is everything else.** `[op, payload]`, where the payload is the
 * input with its tag removed, so field names still travel and nothing depends
 * on the order keys happen to be written in. An input with no other fields is
 * a bare `[op]`.
 *
 * The two shapes cannot be confused for one another, which is what makes the
 * decoder a `typeof` rather than a guess.
 *
 * ## This is not the engine's business
 *
 * Nothing here changes what a log *means*, so it is not an `ENGINE_VERSION`
 * bump: the same inputs replay to the same state, they are merely spelled
 * differently on disk. `parseSave` reads both spellings, so a save written
 * before this existed still opens.
 */

/**
 * The opcode table, and the reason it is shaped like this.
 *
 * A `Record` over the input union rather than an array of names, so **adding
 * an input to the engine without giving it an opcode is a compile error**.
 * That is the whole point: the failure mode of a codec is silently dropping
 * the one input nobody thought about, and a dropped input is a save that
 * replays into a different game — which is the one thing this design promises
 * cannot happen.
 *
 * Numbers are written out rather than derived from position because they are a
 * **file format**. A save written today is read by a build made later, so the
 * number for `fish` has to still mean `fish`. Append; never renumber.
 *
 * `move` is deliberately absent. It has no opcode because it is never written
 * as an array — it is the string case above, always, even a run of one.
 */
const OPS: Record<Exclude<Input["t"], "move">, number> = {
  pickStarter: 0,
  fight: 1,
  struggle: 2,
  switch: 3,
  ball: 4,
  flee: 5,
  continue: 6,
  deposit: 7,
  withdraw: 8,
  collectEgg: 9,
  toggleItem: 10,
  store: 11,
  retrieve: 12,
  trade: 13,
  cheat: 14,
  setMoves: 15,
  reorderParty: 16,
  useItem: 17,
  fieldMove: 18,
  buyItem: 19,
  sellItem: 20,
  fish: 21,
  talk: 22,
  endTalk: 23,
  npcAccept: 24,
  npcTrade: 25,
  npcTravel: 26,
  npcSell: 27,
  learnMove: 28,
  holdItem: 29,
  claimQuest: 30,
  useTool: 31,
  fly: 32,
  release: 33,
  // Appended, never renumbered: a save written before this existed has no
  // 34 in it, and one written after has to mean the same thing forever.
  evolve: 34,
  prize: 35,
  print: 36,
  arenaEnter: 37,
  arenaFight: 38,
  arenaPrize: 39,
  shred: 40,
  cut: 41,
  reforge: 42,
  hatch: 43,
  rename: 44,
  addBox: 45,
  renameBox: 46,
  moveToBox: 47,
};

/** The same table read backwards, built once. */
const TAGS = new Map<number, string>(
  Object.entries(OPS).map(([tag, op]) => [op, tag]),
);

/** The four directions, as the letters a run is spelled in. */
const DIRECTIONS = new Set(["n", "s", "e", "w"]);

/** One token: a run of moves, or one of everything else. */
export type Packed = string | [number] | [number, Record<string, unknown>];

/**
 * Packs a log.
 *
 * Throws on an input it does not recognise rather than dropping it. A codec
 * that quietly skips something produces a file that loads, replays, and is
 * wrong — which is worse in every way than one that refuses to be written.
 */
export function packInputs(inputs: readonly Input[]): Packed[] {
  const out: Packed[] = [];
  let run: string | null = null;

  for (const input of inputs) {
    if (input.t === "move") {
      run = (run ?? "") + input.dir;
      continue;
    }
    if (run !== null) {
      out.push(run);
      run = null;
    }

    const { t, ...rest } = input;
    const op = OPS[t as Exclude<Input["t"], "move">];
    if (op === undefined) throw new Error(`cannot pack input: ${t}`);
    out.push(Object.keys(rest).length ? [op, rest] : [op]);
  }

  if (run !== null) out.push(run);
  return out;
}

/**
 * Unpacks a log, or returns null.
 *
 * Null rather than a partial list, for the same reason `parseSave` is strict:
 * a half-understood save is a different game wearing the right name, and
 * refusing to open one is the only honest answer.
 */
export function unpackInputs(packed: unknown): Input[] | null {
  if (!Array.isArray(packed)) return null;
  const out: Input[] = [];

  for (const token of packed) {
    if (typeof token === "string") {
      for (const letter of token) {
        if (!DIRECTIONS.has(letter)) return null;
        out.push({ t: "move", dir: letter as "n" | "s" | "e" | "w" });
      }
      continue;
    }

    if (!Array.isArray(token) || token.length < 1 || token.length > 2) return null;
    const tag = TAGS.get(token[0] as number);
    if (!tag) return null;

    const rest = token.length === 2 ? token[1] : {};
    if (rest === null || typeof rest !== "object" || Array.isArray(rest)) return null;
    out.push({ t: tag, ...(rest as object) } as Input);
  }

  return out;
}
