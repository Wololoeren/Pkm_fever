import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

/** The engine is plain TypeScript with no DOM in it, so the tests need
 * nothing but the "@/" alias the app itself uses. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
