import { describe, expect, it } from "vitest";
import { STATUS_EFFECTS } from "@/engine/statusmoves";
import { effectLines, effectText } from "@/lib/effectText";

/**
 * The hover note's second half: what statusmoves.ts does with a move, in
 * words. The guard is that nothing honoured is left unsaid.
 */
describe("effect text", () => {
  it("E1: every honoured move has a sentence, and none of them is blank", () => {
    for (const [id, effects] of Object.entries(STATUS_EFFECTS)) {
      const lines = effectLines(id);
      expect(lines.length, `${id} has no line`).toBe(effects.length);
      for (const line of lines) {
        expect(line.length, `${id}: "${line}"`).toBeGreaterThan(12);
        expect(line.startsWith("[object"), `${id} fell through`).toBe(false);
      }
    }
  });

  it("E2: the words say what the move does", () => {
    expect(effectLines("sweetkiss")[0]).toContain("Confuses");
    expect(effectLines("leechseed")[0]).toContain("eighth");
    expect(effectLines("raindance")[0]).toContain("rain");
    expect(effectLines("tackle")).toEqual([]);
    expect(effectText({ t: "side", id: "reflect", turns: 5 })).toContain("5 turns");
  });
});
