import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import react from "eslint-plugin-react";
import tseslint from "typescript-eslint";
import homeflow from "@homeflow/ui/eslint-rules";

/**
 * Workspace lint (technical/09 §2). v1 had no ESLint config of its own — craco
 * ran the react-hooks rules through webpack, and that disappears with CRA.
 */
export default [
  { ignores: ["dist/**", "node_modules/**", "e2e/__screenshots__/**", "test-results/**", "playwright-report/**"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks, react, homeflow },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Without this, `no-unused-vars` cannot see a component used only in JSX.
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      "homeflow/no-arbitrary-tailwind": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    rules: {
      // TypeScript reports undefined identifiers and unused locals itself, and
      // the core rules misread type-only positions.
      "no-undef": "off",
      "no-unused-vars": "off",
    },
  },
  {
    // Config, e2e and test files run in Node / Vitest.
    files: ["*.config.{js,ts}", "e2e/**/*.ts", "src/**/*.test.{js,jsx,ts,tsx}", "src/test-setup.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    /**
     * v1's pages, carried in verbatim. They hold 368 Tailwind arbitrary lengths
     * and 5 arbitrary hexes. Restyling them is explicitly out of scope until the
     * design decision at the top of design-language.md lands, so the token rule
     * warns here instead of failing the build, and v1's own conventions (unused
     * imports left behind by refactors, empty catch blocks) are tolerated.
     *
     * ponytail: the ceiling is "this debt stays visible but unenforced". Each
     * page moves out of this list as it is ported (TASKS Vivek 12-15); when the
     * list is empty, delete this block.
     */
    files: ["src/pages/**", "src/components/**", "src/hooks/**", "src/lib/**", "src/context/**", "src/App.js"],
    ignores: ["src/pages/Login.jsx", "src/lib/api.js", "src/lib/auth.jsx", "src/context/PermissionsContext.jsx"],
    rules: {
      "homeflow/no-arbitrary-tailwind": "warn",
      "no-unused-vars": "warn",
      "no-empty": "warn",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
