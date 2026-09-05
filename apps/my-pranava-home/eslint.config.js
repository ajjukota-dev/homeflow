import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import homeflow from "@homeflow/ui/eslint-rules";

/** My Pranava Home lint (technical/09 §2). Tokens only — the rule is an error here. */
export default [
  { ignores: ["dist/**", "node_modules/**", "e2e/__screenshots__/**", "test-results/**", "playwright-report/**"] },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks, homeflow },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "homeflow/no-arbitrary-tailwind": "error",
      // TypeScript reports undefined identifiers and unused locals itself
      // (`noUnusedLocals` is on); the core rules misread type-only positions.
      "no-undef": "off",
      "no-unused-vars": "off",
    },
  },
  {
    files: ["*.config.{js,ts}", "e2e/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
];
