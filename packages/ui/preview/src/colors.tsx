import * as React from "react";
import { createRoot } from "react-dom/client";
import { PreviewPage, Section, Swatch } from "./Shell";

const SURFACE = [
  { name: "Background", varName: "--bg" },
  { name: "Surface", varName: "--surface" },
  { name: "Surface raised", varName: "--surface-raised" },
  { name: "Line", varName: "--line" },
];
const TEXT = [
  { name: "Foreground", varName: "--fg" },
  { name: "Foreground muted", varName: "--fg-muted" },
  { name: "Foreground subtle", varName: "--fg-subtle" },
];
const ACCENT = [
  { name: "Accent", varName: "--accent" },
  { name: "Accent soft", varName: "--accent-soft" },
];
const STATUS = [
  { name: "OK", varName: "--ok" },
  { name: "OK soft", varName: "--ok-soft" },
  { name: "Info", varName: "--info" },
  { name: "Info soft", varName: "--info-soft" },
  { name: "Warn", varName: "--warn" },
  { name: "Warn soft", varName: "--warn-soft" },
  { name: "Danger", varName: "--danger" },
  { name: "Danger soft", varName: "--danger-soft" },
];

function ThemeToggle() {
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }, [dark]);
  return (
    <button
      type="button"
      onClick={() => setDark((d) => !d)}
      className="self-start rounded-control border border-line bg-surface px-3 py-1.5 text-ws-sm text-fg hover:bg-surface-raised"
    >
      {dark ? "Switch to light" : "Switch to dark"}
    </button>
  );
}

function Colors() {
  return (
    <PreviewPage title="Colors">
      <Section
        title="Theme"
        description="Dark is designed with lighter surface steps, not a mechanical invert. Toggle to inspect both."
      >
        <ThemeToggle />
      </Section>
      <Section title="Surfaces" description="Elevation by lighter surface steps, never a shadow alone in dark mode.">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {SURFACE.map((s) => (
            <Swatch key={s.varName} {...s} />
          ))}
        </div>
      </Section>
      <Section title="Text">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {TEXT.map((s) => (
            <Swatch key={s.varName} {...s} />
          ))}
        </div>
      </Section>
      <Section title="Accent — orange is accent-only" description="Primary action, focus ring, active nav, the logo. Nothing else.">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {ACCENT.map((s) => (
            <Swatch key={s.varName} {...s} />
          ))}
        </div>
      </Section>
      <Section title="Status — never orange" description="ON_TRACK green, DUE_SOON info blue, AT_RISK amber, OVERDUE red — icon + label always (see StatusChip).">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {STATUS.map((s) => (
            <Swatch key={s.varName} {...s} />
          ))}
        </div>
      </Section>
    </PreviewPage>
  );
}

createRoot(document.getElementById("root")!).render(<Colors />);
