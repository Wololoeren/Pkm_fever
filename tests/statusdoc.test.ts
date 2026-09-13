import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `docs/status.md` against the engine it describes.
 *
 * The other two reference documents are guarded by asking whether they *name*
 * everything — abilities.md must mention all eighty-nine, items.md all seventy
 * held items. That is the right guard for a list, and it is the wrong one
 * here, because this file is not a list. It is a page of arithmetic, and the
 * way it goes wrong is not by losing a row: it is by saying an eighth where
 * the engine says a quarter, months after somebody changed the constant and
 * had no reason to think a document was reading it.
 *
 * So this reads the numbers out of the source and asserts the document is
 * written in terms of them. Change `SEED_SHARE` to 6 and the expected phrase
 * becomes "maxHp / 6", which the document does not contain, and this fails
 * naming the constant.
 *
 * Reading the source rather than importing it is deliberate. Most of these are
 * module-private in `battle.ts` and ought to stay that way — a documentation
 * test is not a reason to widen the engine's surface, and the M9 and C21
 * guards already read source for the same reason.
 */

const root = process.cwd();
const doc = readFileSync(join(root, "docs", "status.md"), "utf8");
const battle = readFileSync(join(root, "src", "engine", "battle.ts"), "utf8");
const statusmoves = readFileSync(join(root, "src", "engine", "statusmoves.ts"), "utf8");

/** A named `const NAME = 12;` out of a source file. */
function constant(source: string, name: string): number {
  const found = source.match(new RegExp(`const ${name} = (\\d+);`));
  expect(found, `${name} was renamed or is no longer a plain number`).not.toBeNull();
  return Number(found![1]);
}

/** A number out of an arbitrary expression, by a pattern with one group. */
function literal(source: string, pattern: RegExp, what: string): number {
  const found = source.match(pattern);
  expect(found, `${what} moved; the guard cannot find it any more`).not.toBeNull();
  return Number(found![1]);
}

/** The document has to contain this, and the expectation says which number. */
function says(phrase: string, because: string): void {
  expect(doc.includes(phrase), `docs/status.md does not say "${phrase}" (${because})`).toBe(true);
}

describe("the reference matches the engine", () => {
  it("V1: the per-turn fractions are the engine's", () => {
    // Burn and poison are inline in `residual` rather than named, so they are
    // read off the ternary that picks between them.
    const brn = literal(battle, /const fraction = creature\.status === "brn" \? (\d+)/, "the burn fraction");
    const psn = literal(battle, /const fraction = creature\.status === "brn" \? \d+ : (\d+)/, "the poison fraction");

    says(`max(1, floor(maxHp / ${brn}))`, "burn's share");
    says(`max(1, floor(maxHp / ${psn}))`, "poison's share");
    says(`max(1, floor(maxHp / ${constant(battle, "SEED_SHARE")}))`, "Leech Seed's share");
    says(`max(1, floor(maxHp / ${constant(battle, "NIGHTMARE_SHARE")}))`, "Nightmare's share");
    says(`max(1, floor(maxHp / ${constant(battle, "ROOTS_SHARE")}))`, "Aqua Ring's share");
    says(`floor(maxHp / ${constant(battle, "WISH_SHARE")})`, "Wish's share");
  });

  it("V2: the rolls that end a turn or a condition are the engine's", () => {
    const par = literal(battle, /`\$\{side\}-par`, (\d+)\)/, "the paralysis skip chance");
    const thaw = literal(battle, /`\$\{side\}-thaw`, (\d+)\)/, "the thaw chance");
    const sleep = literal(battle, /tag, "slp"\), (\d+)\)/, "the sleep roll");

    says(`**${par}%** each turn to lose the turn`, "paralysis");
    says(`a **${thaw}%** roll every turn`, "freeze");
    // The roll is `1 + intBelow(rng, 3)`, so the range it can produce is what
    // the document has to name, not the 3.
    says(`1 + intBelow(rng, ${sleep})`, "the sleep counter");
    says(`set to **${[...Array(sleep)].map((_, at) => at + 1).join(", ").replace(/, ([^,]*)$/, " or $1")}** on landing`, "the sleep range");
  });

  it("V3: confusion's three numbers are the engine's", () => {
    says(`**${constant(battle, "CONFUSED_TURNS")} turns**`, "how long confusion lasts");
    says(`a **${constant(battle, "CONFUSED_CHANCE")}%** chance to hit itself`, "confusion's odds");
    says(`a **${constant(battle, "INFATUATED_CHANCE")}%** chance each turn to lose the turn`, "infatuation's odds");
    says(`**${constant(battle, "CONFUSED_POWER")} power**`, "what it hits itself with");
    // And the formula, which is the part a reader cannot check against
    // anything else.
    says(
      `floor((floor(2·level/5) + 2) · ${constant(battle, "CONFUSED_POWER")} · atk / def / 50) + 2`,
      "confusion's damage",
    );
  });

  it("V4: the counters are the engine's", () => {
    says(`counts **${constant(battle, "PERISH_TURNS")}** down to 0`, "Perish Song");
    says(`**${constant(battle, "YAWN_TURNS")} turns**, then sleep`, "Yawn");
    says(`**${constant(battle, "WISH_TURNS")} turns**, then`, "Wish");
    says(`a counter, up to **${constant(battle, "STOCKPILE_MAX")}**`, "Stockpile");
    says(`for **${constant(statusmoves, "MAGNET_RISE_TURNS")}** or **${constant(statusmoves, "TELEKINESIS_TURNS")}** turns`, "Magnet Rise and Telekinesis");
    const field = readFileSync(join(root, "src", "engine", "field.ts"), "utf8");
    says(`all lasting **${constant(field, "FIELD_TURNS")} turns**`, "how long the field lasts");
    says(`max(1, floor(maxHp / ${constant(field, "FIELD_SHARE")}))`, "sand's bite");
    says(`last **${constant(statusmoves, "SCREEN_TURNS")} turns**`, "how long a screen lasts");
  });

  it("V5: the shield streak and the crit ladder are the engine's", () => {
    const odds = battle.match(/const odds = (Math\.min\(100, Math\.max\(1, Math\.floor\(100 \/ 3 \*\* streak\)\)\));/);
    expect(odds, "the shield streak formula moved").not.toBeNull();
    says("odds = max(1, floor(100 / 3 ** streak))", "the shield streak");

    const ladder = battle.match(/const CRIT_ODDS = \[([\d, ]+)\];/);
    expect(ladder, "CRIT_ODDS moved or was renamed").not.toBeNull();
    says(`CRIT_ODDS = [${ladder![1]}]`, "the crit ladder");

    // And the ladder spelled out in words, so the table cannot drift from the
    // array beside it.
    const rungs = ladder![1].split(",").map((one) => Number(one.trim()));
    says(`one in ${rungs[0] === 24 ? "twenty-four" : rungs[0]}`, "the first rung");
  });

  it("V6: both stage ladders are the engine's", () => {
    // Halves for the stats, thirds for accuracy and evasion. The document
    // makes a point of them being different ladders, so if one of them ever
    // becomes the other this is where it is noticed.
    // Each read out of its own function body. Sliced rather than matched,
    // because the two bodies are the same shape to a regex and telling them
    // apart by pattern is how a guard ends up measuring the wrong one twice.
    const body = (name: string): string => {
      const opens = battle.indexOf(`function ${name}(`);
      expect(opens, `${name} moved or was renamed`).toBeGreaterThan(-1);
      return battle.slice(opens, battle.indexOf("\n}", opens));
    };

    const stat = literal(body("stageFactor"), /\[(\d+) \+ clamped/, "stageFactor");
    const aim = literal(body("aimFactor"), /\[(\d+) \+ clamped/, "aimFactor");

    says(`(${stat} + n) / ${stat}  :  ${stat} / (${stat} - n)`, "the stat ladder");
    expect(aim, "the two ladders became the same one").not.toBe(stat);
    says(`(${aim} + n) / ${aim}  :  ${aim} / (${aim} - n)`, "the aim ladder");
  });

  it("V7: every condition, volatile and screen is named", () => {
    // The half the other two reference documents guard: a page missing a row
    // is worse than no page, because nobody checks a document they have no
    // reason to distrust.
    // The five, read out of the union in types.ts for the same reason the
    // volatiles are read out of their interface: a sixth added without a row
    // here should fail here rather than be noticed by a player.
    const conditions = readFileSync(join(root, "src", "engine", "types.ts"), "utf8").match(
      /export type StatusId =([^;]*);/,
    );
    expect(conditions, "the StatusId union moved or was renamed").not.toBeNull();

    const ids = [...conditions![1].matchAll(/"(\w+)"/g)].map((one) => one[1]);
    expect(ids.length).toBe(5);
    for (const id of ids) says(`**${id.toUpperCase()}**`, `the ${id} row`);

    const shapes = battle.match(/export interface Volatiles \{([\s\S]*?)\n\}/);
    expect(shapes, "the Volatiles interface moved").not.toBeNull();
    const fields = [...shapes![1].matchAll(/^\s{2}(\w+)\?:/gm)].map((one) => one[1]);
    expect(fields.length).toBeGreaterThan(8);

    /**
     * The exact phrase the document uses for each, because they are not all
     * table rows: `shieldStreak` is bookkeeping rather than a condition and
     * gets a section under Shield instead, and `yawn` is called Drowsy on the
     * badge so it is called Drowsy here.
     */
    const shown: Record<string, string> = {
      seeded: "**Seeded**",
      confusion: "**Confused**",
      shield: "**Shield**",
      shieldStreak: "### The shield streak",
      crit: "**Crit** (Focus Energy)",
      yawn: "**Drowsy** (Yawn)",
      nightmare: "**Nightmare**",
      perish: "**Perish**",
      trapped: "**Trapped**",
      rooted: "**Rooted**",
      infatuated: "**Infatuated**",
      stats: "**Altered**",
      stockpile: "**Stockpile**",
      sure: "**Locked on**",
      bonded: "**Bonded**",
      wish: "**Wish**",
      blessing: "**Blessing**",
      afloat: "**Afloat**",
      types: "**Retyped**",
      seen: "**Seen**",
      // What a damaging move leaves behind, which is its own section rather
      // than more rows in the first table: the ones above arrived with the
      // status moves and these came from the other direction entirely.
      committed: "**Committed**",
      // The three that spell out what `committed` is doing are described in
      // that row rather than given rows of their own — a reader wants "it is
      // locked into Outrage for two more turns", not three separate entries
      // for the id, the kind and the counter.
      commitment: "**Committed**",
      commitTurns: "**Committed**",
      rolled: "**Committed**",
      hidden: "**Away**",
      curled: "**Curled**",
      recharging: "**Recharging**",
      flinched: "**Flinched**",
      bound: "**Bound**",
      biding: "**Biding**",
      bided: "**Biding**",
      fresh: "**New**",
    };
    for (const field of fields) {
      expect(shown[field], `${field} has no row in docs/status.md`).toBeDefined();
      says(shown[field], `the ${field} row`);
    }

    const screens = statusmoves.match(/export type SideConditionId =([\s\S]*?);/);
    expect(screens, "the SideConditionId union moved").not.toBeNull();
    const names: Record<string, string> = {
      reflect: "Reflect",
      lightscreen: "Light Screen",
      mist: "Mist",
      safeguard: "Safeguard",
      luckychant: "Lucky Chant",
      tailwind: "Tailwind",
    };
    const sides = [...screens![1].matchAll(/"(\w+)"/g)].map((one) => one[1]);
    expect(sides.length).toBe(6);
    for (const id of sides) {
      expect(names[id], `${id} has no row in docs/status.md`).toBeDefined();
      says(`**${names[id]}**`, `the ${id} row`);
    }
  });
});
