import { createRoot } from "react-dom/client";
import logoMarkUrl from "../../src/brand/logo-mark.svg?url";
import logoUrl from "../../src/brand/logo.svg?url";
import { PreviewPage, Section } from "./Shell";

function Brand() {
  return (
    <PreviewPage title="Brand">
      <Section
        title="Mark"
        description="Redrawn as clean geometric SVG from docs/brand/pranava-group-logo.jpeg — two chevron-tower silhouettes, charcoal (left half of each slat) and orange (right half)."
      >
        <div className="flex flex-wrap items-end gap-8 rounded-card border border-line bg-surface p-6">
          <img src={logoMarkUrl} alt="Pranava Group mark" className="h-28" />
          <img src={logoMarkUrl} alt="Pranava Group mark, small" className="h-12" />
        </div>
      </Section>
      <Section title="Wordmark" description="Jost, wide tracking, wordmark + tagline lockup.">
        <div className="rounded-card border border-line bg-surface p-6">
          <img src={logoUrl} alt="Pranava Group — Presenting the Future" className="h-24" />
        </div>
      </Section>
      <Section title="Usage" description="Orange is the accent only: primary action, focus ring, active nav, the logo — nothing else.">
        <ul className="max-w-prose list-disc pl-5 text-ws-body text-fg-muted">
          <li>Ink/charcoal do the structure; status colours never use orange (see Colors).</li>
          <li>Jost carries headings, wordmark, portal display type.</li>
          <li>Geist Sans carries body/UI/data; Geist Mono carries codes and unit ids (e.g. A-1204).</li>
        </ul>
      </Section>
    </PreviewPage>
  );
}

createRoot(document.getElementById("root")!).render(<Brand />);
