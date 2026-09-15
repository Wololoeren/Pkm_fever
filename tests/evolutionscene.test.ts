import { describe, expect, it } from "vitest";
import { shapeAt } from "@/components/EvolutionScene";

/** The hatching and evolution scene: which shape is on screen when. */
describe("the evolution scene's flicker", () => {
  it("ES1: nothing of the new shape shows before the flicker has swapped once", () => {
    // The whole gather, and the first stretch of the flicker, are the old
    // shape (the egg). The bug was a frame of the new one at 4.0s, in colour.
    for (let t = 0; t < 4_600; t += 10) expect(shapeAt(t), `at ${t}ms`).toBe("before");
    expect(shapeAt(4_000 + 700)).toBe("after");
  });

  it("ES2: it still flickers, faster towards the end, and ends on the new shape", () => {
    let swaps = 0;
    let last = shapeAt(4_000);
    for (let t = 4_000; t < 15_000; t += 5) {
      const now = shapeAt(t);
      if (now !== last) swaps++;
      last = now;
    }
    expect(swaps).toBeGreaterThan(40);
    expect(shapeAt(15_000)).toBe("after");
    expect(shapeAt(19_999)).toBe("after");
  });
});
