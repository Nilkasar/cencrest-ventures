// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Shared ESLint flat config. Apps extend this and add framework-specific rules. */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
  {
    ignores: ["dist/**", ".next/**", "node_modules/**", ".turbo/**"],
  },
);
