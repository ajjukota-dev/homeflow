/** My Pranava Home — same Apple-homely tokens as the workspace, customer skin.
 *  Extends the shared `@homeflow/ui` preset (docs/specs/32-design-system.md); this file's own
 *  `theme.extend` still wins for existing keys, so no existing screen changes yet. */
import homeflowUiPreset from "@homeflow/ui/tailwind-preset";

/** @type {import('tailwindcss').Config} */
export default {
  presets: [homeflowUiPreset],
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: { DEFAULT: "var(--surface)", 2: "var(--surface-2)" },
        line: "var(--border)",
        fg: { DEFAULT: "var(--fg)", muted: "var(--fg-muted)", subtle: "var(--fg-subtle)" },
        accent: { DEFAULT: "var(--accent)", fg: "var(--accent-fg)" },
        ontrack: "var(--on-track)",
        due: "var(--due)",
        atrisk: "var(--at-risk)",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "SF Pro Text", "SF Pro Display", "Inter", "system-ui", "sans-serif"],
      },
      borderRadius: { lg: "var(--radius)", xl: "calc(var(--radius) + 8px)" },
      boxShadow: { card: "0 1px 2px rgba(0,0,0,0.04), 0 6px 20px rgba(0,0,0,0.05)" },
      fontSize: {
        caption: ["0.8125rem", { lineHeight: "1.1rem" }],
        footnote: ["0.875rem", { lineHeight: "1.2rem" }],
        body: ["1.0625rem", { lineHeight: "1.55rem" }],
        title: ["1.375rem", { lineHeight: "1.7rem", letterSpacing: "-0.01em" }],
        large: ["2rem", { lineHeight: "2.3rem", letterSpacing: "-0.02em" }],
        hero: ["2.5rem", { lineHeight: "2.7rem", letterSpacing: "-0.02em" }],
      },
    },
  },
  plugins: [],
};
