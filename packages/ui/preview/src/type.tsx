import { createRoot } from "react-dom/client";
import { PreviewPage, Section } from "./Shell";

// Literal class names (not built at runtime) so Tailwind's static scanner picks each one up.
const WORKSPACE_STEPS = [
  { cls: "text-ws-xs", px: "12" },
  { cls: "text-ws-sm", px: "13" },
  { cls: "text-ws-body", px: "14 (body)" },
  { cls: "text-ws-md", px: "16" },
  { cls: "text-ws-lg", px: "20" },
  { cls: "text-ws-xl", px: "24" },
  { cls: "text-ws-2xl", px: "30" },
] as const;

const PORTAL_STEPS = [
  { cls: "text-portal-sm", px: "14" },
  { cls: "text-portal-body", px: "16 (body)" },
  { cls: "text-portal-md", px: "18" },
  { cls: "text-portal-lg", px: "22" },
  { cls: "text-portal-xl", px: "28" },
  { cls: "text-portal-2xl", px: "36" },
  { cls: "text-portal-3xl", px: "48" },
] as const;

function Type() {
  return (
    <PreviewPage title="Type">
      <Section title="Headings — Jost" description="h1/h2 in both apps, weights 500-600, tracking -0.01em.">
        <h1 className="font-heading text-ws-2xl font-semibold tracking-[-0.02em] text-fg">
          Sunrise Meadows, Tower B — handover readiness
        </h1>
        <h2 className="font-heading text-ws-xl font-medium tracking-[-0.015em] text-fg">
          Unit B-1204 · Rohan Mehta &amp; Priyanka Deshmukh
        </h2>
      </Section>
      <Section
        title="Body / UI — Geist Sans"
        description="Tabular figures (.hf-tnum) on amounts and codes; comfortable measure for long strings."
      >
        <p className="max-w-[65ch] text-ws-body text-fg">
          The demand for milestone &ldquo;Slab casting — 8th floor&rdquo; was raised on 12 Aug 2026 for unit
          A-1204 against agreement value ₹1,23,45,678.00; ₹98,50,000.00 has been received to date, leaving
          ₹24,95,678.00 outstanding across two pending receipts.
        </p>
        <p className="hf-tnum text-ws-md text-fg">₹1,23,45,678.00 · UNT-000482 · A-1204</p>
      </Section>
      <Section title="Codes — Geist Mono" description="Ids and codes only, never a stand-in for 'technical'.">
        <p className="font-mono text-ws-body text-fg">CMT-004821 · BKG-002190 · CUS-001007</p>
      </Section>
      <Section title="Workspace scale" description="12 / 13 / 14 / 16 / 20 / 24 / 30 — obvious steps, no 15/17px in-betweens.">
        <div className="flex flex-col gap-2">
          {WORKSPACE_STEPS.map((step) => (
            <p key={step.cls} className={`${step.cls} text-fg`}>
              {step.px}px — Handover gate closed on schedule for A-1204
            </p>
          ))}
        </div>
      </Section>
      <Section title="Portal scale" description="14 / 16 / 18 / 22 / 28 / 36 / 48 — body measure 60-70ch, warmer/larger for reading.">
        <div className="flex max-w-portal flex-col gap-2">
          {PORTAL_STEPS.map((step) => (
            <p key={step.cls} className={`${step.cls} text-fg`}>
              {step.px}px — Your home is on track for handover in March 2027
            </p>
          ))}
        </div>
      </Section>
    </PreviewPage>
  );
}

createRoot(document.getElementById("root")!).render(<Type />);
