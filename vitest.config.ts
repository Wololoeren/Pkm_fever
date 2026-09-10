import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

/** The engine is plain TypeScript with no DOM in it, so the tests need
 * nothing but the "@/" alias the app itself uses. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    /**
     * Twenty seconds, not five.
     *
     * A world takes about half a second to generate — a maze per route, a
     * reachability walk per person placed, and a loop traced for every roamer
     * — and a dozen tests build eight or twelve of them to show that something
     * holds on every seed rather than on one. Those were already running at
     * three seconds against a five-second default, which is one slow machine
     * away from a red suite that means nothing.
     *
     * Raised here rather than test by test so the reason is written once.
     */
    testTimeout: 20_000,
  },
});
