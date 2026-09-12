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
    /**
     * Four workers with a four-gigabyte heap each, rather than one per core
     * with whatever Node's default is.
     *
     * This suite intermittently died with `ERR_IPC_CHANNEL_CLOSED` — a worker
     * process going away rather than an assertion failing, which reads as a
     * flaky suite and is not one. Memory is the explanation worth removing
     * first and the cheapest to remove: a world is about a megabyte of maps,
     * people and census before anything is asserted about it, a dozen files
     * build eight or twelve worlds apiece, and on a sixteen-core machine that
     * is sixteen workers holding all of it at once against Node's default
     * heap. Capping the forks bounds how many worlds exist at any moment and
     * the heap flag gives each fork room for the ones it does build.
     *
     * It is deliberately **not** claimed as the cause. The same machine was
     * separately caught handing Node a corrupted read of a file that is
     * correct on disk — `void 0,` arriving as `void ,` out of
     * `node_modules/typescript` — which kills a worker just as dead and is
     * nothing this file can fix. If the error comes back with these settings
     * in place, that is where to look, not here.
     */
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: 4,
        execArgv: ["--max-old-space-size=4096"],
      },
    },
  },
});
