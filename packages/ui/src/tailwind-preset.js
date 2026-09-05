/** HomeFlow shared Tailwind preset — docs/specs/32-design-system.md.
 * Token-mapped theme (colour, spacing, type, radii, shadows, easing/durations) both apps extend.
 * Additive: apps keep their own `theme.extend` on top, so existing screens are unaffected until
 * they migrate to `@homeflow/ui` component classes/tokens.
 * @type {import('tailwindcss').Config}
 */
export default {
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: {
          DEFAULT: "var(--surface)",
          raised: "var(--surface-raised)",
        },
        line: "var(--line)",
        fg: {
          DEFAULT: "var(--fg)",
          muted: "var(--fg-muted)",
          subtle: "var(--fg-subtle)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          fg: "var(--accent-fg)",
          soft: "var(--accent-soft)",
        },
        ok: { DEFAULT: "var(--ok)", soft: "var(--ok-soft)", fg: "var(--ok-fg)" },
        info: { DEFAULT: "var(--info)", soft: "var(--info-soft)", fg: "var(--info-fg)" },
        warn: { DEFAULT: "var(--warn)", soft: "var(--warn-soft)", fg: "var(--warn-fg)" },
        danger: { DEFAULT: "var(--danger)", soft: "var(--danger-soft)", fg: "var(--danger-fg)" },
      },
      fontFamily: {
        // Headings/wordmark/portal-display use Jost; body/UI/data uses Geist Sans; codes/IDs use Geist Mono.
        // "* Fallback" entries are the size-adjusted metric-match faces declared in fonts.css.
        heading: ["Jost", "Jost Fallback", "Arial", "sans-serif"],
        sans: ["Geist Sans", "Geist Sans Fallback", "Segoe UI", "Arial", "sans-serif"],
        mono: ["Geist Mono", "Geist Mono Fallback", "ui-monospace", "SF Mono", "monospace"],
      },
      fontSize: {
        // Workspace scale (12/13/14/16/20/24/30), obvious steps, no 15/17px in-betweens.
        "ws-xs": ["0.75rem", { lineHeight: "1.45" }],
        "ws-sm": ["0.8125rem", { lineHeight: "1.45" }],
        "ws-body": ["0.875rem", { lineHeight: "1.5" }],
        "ws-md": ["1rem", { lineHeight: "1.5" }],
        "ws-lg": ["1.25rem", { lineHeight: "1.2", letterSpacing: "-0.01em" }],
        "ws-xl": ["1.5rem", { lineHeight: "1.2", letterSpacing: "-0.015em" }],
        "ws-2xl": ["1.875rem", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        // Portal scale (14/16/18/22/28/36/48), body measure 60-70ch.
        "portal-sm": ["0.875rem", { lineHeight: "1.5" }],
        "portal-body": ["1rem", { lineHeight: "1.6" }],
        "portal-md": ["1.125rem", { lineHeight: "1.5" }],
        "portal-lg": ["1.375rem", { lineHeight: "1.3", letterSpacing: "-0.01em" }],
        "portal-xl": ["1.75rem", { lineHeight: "1.2", letterSpacing: "-0.015em" }],
        "portal-2xl": ["2.25rem", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        "portal-3xl": ["3rem", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
      },
      spacing: {
        // 4px base scale, named for the values not commonly already covered by Tailwind's default.
        18: "4.5rem",
      },
      borderRadius: {
        card: "var(--radius-card)",
        control: "var(--radius-control)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        panel: "var(--shadow-panel)",
      },
      maxWidth: {
        workspace: "var(--container-workspace)",
        portal: "var(--container-portal)",
      },
      transitionTimingFunction: {
        "ds-out": "var(--ease-out-expo)",
      },
      transitionDuration: {
        micro: "160ms",
        panel: "240ms",
        page: "400ms",
      },
    },
  },
  plugins: [],
};
