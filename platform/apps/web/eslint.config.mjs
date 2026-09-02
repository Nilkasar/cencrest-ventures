import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Next 16 removed `next lint` in favor of the plain ESLint CLI, and
// eslint-config-next now ships ready-made flat config arrays (see
// node_modules/next/dist/docs/.../03-eslint.md) — spread them directly
// rather than going through @eslint/eslintrc's FlatCompat, which crashes
// (circular structure) trying to legacy-wrap these. The couple of rules
// @bebest/config's base adds on top of typescript-eslint's defaults are
// re-declared here instead of spreading that base, to avoid registering a
// second, independent `@typescript-eslint` plugin instance alongside the
// one `eslint-config-next/typescript` already provides.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/**", ".turbo/**"]),
]);
