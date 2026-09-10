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
