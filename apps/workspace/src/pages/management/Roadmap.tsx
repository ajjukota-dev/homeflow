import { PageHeader, Badge, cn } from "@homeflow/ui";
import roadmap from "../../roadmap.json";

interface RoadmapItem {
  spec: string;
  title: string;
  pdf_refs: string[];
  wave: string;
}

const WAVES = ["R2", "R3", "R4", "R5", "R6", "R7"];

/** Management > Roadmap (spec 27, "ships in R1, before anything else here") — the honest
 * list of not-yet-merged specs, generated from `roadmap.json` (maintained with TODO.md §0).
 * Removed once every spec is merged. */
export function Roadmap() {
  const items = roadmap as RoadmapItem[];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Roadmap"
        description="What's built and what's next — the full workstream list from the design spec, in build order."
      />

      {WAVES.map((wave) => {
        const waveItems = items.filter((i) => i.wave === wave);
        if (waveItems.length === 0) return null;
        return (
          <section key={wave} className="flex flex-col gap-3">
            <h2 className="text-ws-lg font-heading font-semibold text-fg">{wave}</h2>
            <ul className="flex flex-col gap-2">
              {waveItems.map((item) => (
                <li
                  key={item.spec}
                  className={cn(
                    "flex flex-col gap-1 rounded-control border border-line bg-surface-raised px-4 py-3",
                    "sm:flex-row sm:items-center sm:justify-between"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Badge tone="neutral">{item.spec}</Badge>
                    <span className="text-ws-sm font-medium text-fg">{item.title}</span>
                  </div>
                  <span className="text-ws-xs text-fg-muted">
                    {item.pdf_refs.join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
