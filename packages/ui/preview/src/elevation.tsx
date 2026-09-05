import { createRoot } from "react-dom/client";
import { PreviewPage, Section } from "./Shell";

function Elevation() {
  return (
    <PreviewPage title="Elevation">
      <Section
        title="Cards — hairline border, no shadow"
        description="Surface + 1px line, radius 12px. Declare elevation once: border or shadow, never both."
      >
        <div className="max-w-sm rounded-card border border-line bg-surface p-4">
          <p className="text-ws-body font-medium text-fg">Unit A-1204</p>
          <p className="mt-1 text-ws-sm text-fg-muted">Sunrise Meadows, Tower A · 3 BHK · 1,420 sqft</p>
        </div>
      </Section>
      <Section
        title="Popovers / drawers — shadow, no border"
        description="Offset + soft blur: 0 12px 32px -8px rgb(0 0 0 / .18). Never a zero-offset colour halo."
      >
        <div className="max-w-sm rounded-card bg-surface p-4 shadow-panel">
          <p className="text-ws-body font-medium text-fg">Record receipt</p>
          <p className="mt-1 text-ws-sm text-fg-muted">₹5,00,000.00 against demand DEM-000342</p>
        </div>
      </Section>
      <Section title="Radii" description="Card 12px, control 8px, pill 999px (chips only).">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex size-16 items-center justify-center rounded-card border border-line bg-surface text-ws-xs text-fg-muted">
            card
          </div>
          <div className="flex size-16 items-center justify-center rounded-control border border-line bg-surface text-ws-xs text-fg-muted">
            control
          </div>
          <div className="flex h-8 items-center justify-center rounded-pill border border-line bg-surface px-4 text-ws-xs text-fg-muted">
            pill
          </div>
        </div>
      </Section>
    </PreviewPage>
  );
}

createRoot(document.getElementById("root")!).render(<Elevation />);
