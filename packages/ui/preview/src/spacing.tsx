import { createRoot } from "react-dom/client";
import { PreviewPage, Section } from "./Shell";

const SCALE = [4, 8, 12, 16, 24, 32, 48, 64];

function Spacing() {
  return (
    <PreviewPage title="Spacing">
      <Section title="4px scale" description="Tight within groups (4-8), generous between (24-48); more space above a heading than below.">
        <div className="flex flex-col gap-4">
          {SCALE.map((px) => (
            <div key={px} className="flex items-center gap-4">
              <span className="hf-tnum w-12 text-ws-sm text-fg-muted">{px}px</span>
              <div className="h-4 bg-accent-soft" style={{ width: px * 4 }} />
            </div>
          ))}
        </div>
      </Section>
      <Section title="Applied: tight vs generous" description="A commitment row group (tight 8px) separated from the next section by 32px.">
        <div className="max-w-md rounded-card border border-line bg-surface p-4">
          <div className="flex flex-col gap-2">
            <p className="text-ws-body text-fg">Slab casting — 8th floor</p>
            <p className="text-ws-sm text-fg-muted">Due 18 Sep 2026 · Owner: Rohan Mehta</p>
          </div>
          <div className="mt-8 flex flex-col gap-2">
            <p className="text-ws-body text-fg">Structural inspection</p>
            <p className="text-ws-sm text-fg-muted">Due 30 Sep 2026 · Owner: QA Team</p>
          </div>
        </div>
      </Section>
      <Section title="Container widths" description="1280px workspace, 880px portal reading measure.">
        <p className="hf-tnum text-ws-body text-fg">--container-workspace: 1280px · --container-portal: 880px</p>
      </Section>
    </PreviewPage>
  );
}

createRoot(document.getElementById("root")!).render(<Spacing />);
