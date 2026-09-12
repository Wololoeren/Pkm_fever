import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

/**
 * `next-env.d.ts` is ignored because it is generated.
 *
 * Next writes it on every build, it is a triple-slash reference by design, and
 * the rule against those is a rule about code somebody writes. Left in, the
 * one error in the project is a file nobody can fix and `npm run lint` can
 * never be a gate — which is the only thing a linter is for.
 */
const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { ignores: [".next/**", "out/**", "node_modules/**", "src/data/**", "next-env.d.ts"] },
];

export default config;
