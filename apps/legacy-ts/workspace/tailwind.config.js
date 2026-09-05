/** HomeFlow — Apple-homely theme. Tokens are semantic CSS variables (light + dark),
 *  so components never hard-code colour. */
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: {
          DEFAULT: "var(--surface)",
          2: "var(--surface-2)",
        },
        line: "var(--border)",
        fg: {
          DEFAULT: "var(--fg)",
          muted: "var(--fg-muted)",
          subtle: "var(--fg-subtle)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          fg: "var(--accent-fg)",
        },
        ontrack: "var(--on-track)",
        due: "var(--due)",
        atrisk: "var(--at-risk)",
        overdue: "var(--overdue)",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "SF Pro Display",
          "Inter",
          "system-ui",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SF Mono", "JetBrains Mono", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        xl: "calc(var(--radius) + 6px)",
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04)",
        pop: "0 8px 30px rgba(0,0,0,0.08)",
      },
      fontSize: {
        // Apple Dynamic Type–ish scale
        caption: ["0.75rem", { lineHeight: "1rem" }],
        footnote: ["0.8125rem", { lineHeight: "1.1rem" }],
        subhead: ["0.9375rem", { lineHeight: "1.4rem" }],
        body: ["1.0625rem", { lineHeight: "1.5rem" }],
        title3: ["1.25rem", { lineHeight: "1.6rem", letterSpacing: "-0.01em" }],
        title2: ["1.375rem", { lineHeight: "1.7rem", letterSpacing: "-0.01em" }],
        title1: ["1.75rem", { lineHeight: "2.1rem", letterSpacing: "-0.02em" }],
        large: ["2.125rem", { lineHeight: "2.4rem", letterSpacing: "-0.02em" }],
      },
    },
  },
  plugins: [],
};
