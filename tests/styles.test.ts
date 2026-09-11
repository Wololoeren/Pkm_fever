import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crispSize } from "@/components/Sprite";

/**
 * The one thing about the stylesheet that can break silently.
 *
 * Every hover panel in this game is built the same way: the panel sits in the
 * markup at `opacity: 0`, and a second rule turns it on when something is
 * hovered or focused. Nothing in TypeScript knows the two rules exist, nothing
 * renders differently when one of them stops matching, and the panel is still
 * in the DOM with all its content — so a screen reader and `get_page_text`
 * both report it as present while a player sees nothing at all.
 *
 * That is exactly what happened to the starter cards. Their detail panel was
 * replaced by the shared StatHover, the markup changed, and the CSS kept
 * asking for `.starterDetail` — a class nothing had carried since — plus a
 * `.starterCard` nested inside a `.starterCard`, which cannot match anything.
 * Both selectors were dead, the panel never lit, and the only symptom was that
 * hovering a starter did nothing.
 *
 * So: anything that hides itself must have something that shows it again.
 */

const CSS = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");

/** Every `selector { ... }` block, with its declarations. */
function rules(): { selector: string; body: string }[] {
  const found: { selector: string; body: string }[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;

  for (let match = pattern.exec(CSS); match; match = pattern.exec(CSS)) {
    const selector = match[1].replace(/\/\*[\s\S]*?\*\//g, "").trim();
    // Skip at-rules; their braces wrap other rules, which the next pass finds.
    if (!selector || selector.startsWith("@")) continue;
    found.push({ selector, body: match[2] });
  }

  return found;
}

/** The last class named in a selector — the thing the rule is really about. */
function subject(selector: string): string | null {
  const classes = selector.split(/[\s>+~]+/).pop()?.match(/\.[A-Za-z][\w-]*/g);
  return classes ? classes[classes.length - 1] : null;
}

/**
 * Every class a selector mentions, pseudo-classes dropped.
 *
 * The whole chain rather than the trailing class, because two different panels
 * share the `.statHover` class — the one over a starter card and the one over
 * a creature on the battlefield. Comparing only the last class let the
 * battlefield's reveal rule stand in for the starter card's, which is how the
 * first cut of this test passed while the starter card was dead.
 */
function classesIn(selector: string): Set<string> {
  return new Set(selector.match(/\.[A-Za-z][\w-]*/g) ?? []);
}

describe("hover panels", () => {
  it("Y1: everything hidden at opacity 0 has a rule that shows it again", () => {
    const all = rules();

    const hidden = all.filter(
      (rule) => /(^|;)\s*opacity:\s*0\s*(;|$)/.test(rule.body) && subject(rule.selector),
    );
    // If this ever hits zero the test has stopped testing anything.
    expect(hidden.length).toBeGreaterThan(3);

    const shows = all.filter((rule) => /(^|;)\s*opacity:\s*1\s*(;|$)/.test(rule.body));

    for (const rule of hidden) {
      // A rule that shows this one again has to be about at least the same
      // things: same panel, same thing you hover to get it, plus whatever
      // state it adds. Anything less is a rule about some other panel.
      const wanted = classesIn(rule.selector);
      const revealed = shows.some((show) =>
        show.selector
          .split(",")
          .some((one) => [...wanted].every((name) => classesIn(one).has(name))),
      );
      expect(revealed, `${rule.selector} hides itself and nothing shows it again`).toBe(true);
    }
  });

  it("Y2: no rule asks for the same class twice in a row", () => {
    // `.starterCard:focus-visible .starterCard .statHover` was the other half
    // of the same bug: a card inside a card, which no markup produces. It
    // reads as plausible and matches nothing.
    for (const rule of rules()) {
      for (const one of rule.selector.split(",")) {
        const parts = one.trim().split(/[\s>+~]+/).filter(Boolean);
        const seen = parts.map((part) => part.match(/\.[A-Za-z][\w-]*/)?.[0]).filter(Boolean);
        expect(
          new Set(seen).size,
          `${one.trim()} names the same class at two depths`,
        ).toBe(seen.length);
      }
    }
  });
});

describe("colour as meaning", () => {
  it("Y5: the classes that carry a meaning by colour alone have a rule", () => {
    // The move arrows and the badge row say what they say almost entirely
    // through colour: a green ▲ and a red ▼ are the same glyph turned over,
    // and "DEF ↓" beside "SPE ↑" is only legible because one of them is red.
    // Lose the rule and the markup still renders — same text, same layout, in
    // the body colour — so there is nothing to notice and nothing to report
    // except that the screen is somehow harder to read than it was.
    //
    // Named rather than scraped out of the components on purpose: a test that
    // collects every className in the app would flag the dozens that are
    // layout hooks with no styling of their own, and a test that flags
    // everything gets an exception list instead of a fix.
    const needed = [
      // How a move lands on what is out.
      ".eff",
      ".eff.up",
      ".eff.down",
      ".eff.none",
      // And everything happening to a creature, under its health bar.
      ".badgeRow",
      ".tag.rise",
      ".tag.fall",
    ];

    const all = rules();
    for (const name of needed) {
      const wanted = classesIn(name);
      const styled = all.some((rule) =>
        rule.selector
          .split(",")
          .some((one) => [...wanted].every((part) => classesIn(one).has(part))),
      );
      expect(styled, `${name} is in the markup and nothing in the stylesheet`).toBe(true);
    }
  });
});

describe("appearances on screen", () => {
  it("Y6: nothing tells a sprite what a creature looks like", () => {
    // An appearance is a fact about a creature, and the only honest source for
    // it is the creature. A literal in the markup is the screen deciding
    // instead — which is not a compile error, not a runtime error, and not
    // visibly wrong either, because "normal" is exactly what nine creatures in
    // ten look like. It is wrong only for the ones a player cares about, and
    // the evolution scene had it for as long as the scene existed: a shiny
    // that had been shiny for forty levels arrived at its own reveal in
    // factory colours.
    //
    // Block comments are stripped first, because this file's own explanation
    // of the bug quotes it.
    const offenders: string[] = [];

    for (const dir of [["src", "components"], ["src", "app"]]) {
      const root = join(process.cwd(), ...dir);
      for (const file of readdirSync(root)) {
        if (!file.endsWith(".tsx")) continue;
        const source = readFileSync(join(root, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
        for (const match of source.matchAll(/variantId\s*=\s*"([^"]*)"/g)) {
          offenders.push(`${file}: variantId="${match[1]}"`);
        }
      }
    }

    expect(offenders, offenders.join("; ")).toEqual([]);

    // And the test has to be looking at something: every sprite on screen
    // should be getting its appearance from somewhere.
    let passed = 0;
    for (const dir of [["src", "components"], ["src", "app"]]) {
      const root = join(process.cwd(), ...dir);
      for (const file of readdirSync(root)) {
        if (!file.endsWith(".tsx")) continue;
        const source = readFileSync(join(root, file), "utf8");
        passed += [...source.matchAll(/variantId=\{/g)].length;
      }
    }
    expect(passed).toBeGreaterThan(10);
  });
});

describe("pixel art", () => {
  it("Y3: every sprite is asked for at a size the art divides into", () => {
    // The sprites are 96 pixels square. At the battle's old 148 the
    // nearest-neighbour scale was 1.54, so forty-four source columns came out
    // one pixel wide and fifty-two came out two — outlines that wobble and a
    // creature that reads as slightly stretched in places.
    //
    // Sprite snaps whatever it is handed, so a wrong number here is corrected
    // rather than broken. This is about the *other* half: a call site asking
    // for 148 and silently getting 192 is a layout nobody can reason about
    // from reading it.
    const wanted: { file: string; size: number }[] = [];

    for (const file of readdirSync(join(process.cwd(), "src", "components"))) {
      if (!file.endsWith(".tsx")) continue;
      const source = readFileSync(join(process.cwd(), "src", "components", file), "utf8");
      for (const match of source.matchAll(/<Sprite[^>]*?size=\{(\d+)\}/g)) {
        wanted.push({ file, size: Number(match[1]) });
      }
    }

    expect(wanted.length).toBeGreaterThan(5);
    for (const { file, size } of wanted) {
      expect(crispSize(size), `${file} asks for ${size}, which snaps to ${crispSize(size)}`).toBe(
        size,
      );
    }
  });

  it("Y4: nothing scales a sprite by a fraction once it has settled", () => {
    // A transform mid-animation is fine — it is moving and nobody can see the
    // edges. One that a sprite comes to rest at is the same uneven division
    // by another road.
    const settled = CSS.match(/\.evolve-reveal \.evolveSprite \{([^}]*)\}/);
    expect(settled, "the reveal rule moved or was renamed").not.toBeNull();
    expect(settled![1]).not.toMatch(/scale\(\s*[01]?\.\d/);
  });
});
