// Token-literal lint gate — spec 32-design-system.md Rule 1 + Acceptance
// ("Token lint: CI fails on a planted #0a6cff in a component").
// Scoped to packages/ui/src only (not the whole monorepo): the existing apps'
// pre-@homeflow/ui screens still hard-code raw values in places and migrate
// screen-by-screen per Rule 10, so a repo-wide rule would fail on code this
// lane doesn't own. `eslint.config.js` (flat config) is ESLint 9's default —
// the spec's "Files" list says `.eslintrc*`, written before ESLint dropped
// that format; flat config is the current equivalent, flagged in the PR.
import tsParser from "@typescript-eslint/parser";

// Raw hex colour (#abc / #aabbcc / #aabbccdd) or a bare `NNpx` literal.
const HEX = "#[0-9a-fA-F]{3,4}\\b|#[0-9a-fA-F]{6}\\b|#[0-9a-fA-F]{8}\\b";
const PX = "\\b\\d+px\\b";
const TOKEN_LITERAL = `(${HEX}|${PX})`;

const message =
  "No raw hex colour or px literal in class names — use a design token / Tailwind theme class " +
  "(tokens.css, tailwind-preset.js). Spec 32-design-system.md Rule 1.";

export default [
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: "module" },
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        // className="...#hex..." / className="...12px..."
        { selector: `JSXAttribute[name.name='className'] Literal[value=/${TOKEN_LITERAL}/]`, message },
        // className={`...${x}...#hex...`} template literals
        { selector: `JSXAttribute[name.name='className'] TemplateElement[value.raw=/${TOKEN_LITERAL}/]`, message },
        // cn("...#hex..."), clsx(...), cva("...")
        { selector: `CallExpression[callee.name=/^(cn|clsx|cva)$/] Literal[value=/${TOKEN_LITERAL}/]`, message },
        { selector: `CallExpression[callee.name=/^(cn|clsx|cva)$/] TemplateElement[value.raw=/${TOKEN_LITERAL}/]`, message },
      ],
    },
  },
];
