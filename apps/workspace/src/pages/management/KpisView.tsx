import { useCallback, useEffect, useState } from "react";
import { Card, CardBody, Dialog, DialogContent, Tabs, TabsList, TabsTrigger } from "@homeflow/ui";
import { formatINR } from "../../ui/MoneyFigure";
import { cn } from "../../lib/utils";
import { managementApi, type KpiDrill, type KpiView } from "./api";

const DOMAINS = [
  "SALES_HANDOVER",
  "JOURNEY",
  "COLLECTIONS",
  "LEGAL_REGISTRATION",
  "QUALITY_HANDOVER",
  "CUSTOMISATION",
  "POST_HANDOVER",
  "EXPERIENCE",
  "PROFITABILITY",
] as const;

const DOMAIN_LABEL: Record<string, string> = {
  SALES_HANDOVER: "Sales handover",
  JOURNEY: "Journey",
  COLLECTIONS: "Collections",
  LEGAL_REGISTRATION: "Legal & registration",
  QUALITY_HANDOVER: "Quality & handover",
  CUSTOMISATION: "Customisation",
  POST_HANDOVER: "Post-handover",
  EXPERIENCE: "Experience",
  PROFITABILITY: "Profitability",
};

function formatValue(k: Pick<KpiView, "unit" | "value">): string {
  if (k.value === null) return "No data";
  if (k.unit === "PERCENT") return `${k.value.toFixed(1)}%`;
  if (k.unit === "DAYS") return `${k.value.toFixed(1)}d`;
  if (k.unit === "INR") return formatINR(k.value);
  return k.value.toFixed(k.unit === "SCORE" ? 1 : 0);
}

function trendTone(k: KpiView): string {
  if (k.trend === null || k.trend === 0) return "text-fg-subtle";
  const improving = k.direction === "HIGHER_BETTER" ? k.trend > 0 : k.trend < 0;
  return improving ? "text-ontrack" : "text-overdue";
}

function onTargetTone(k: KpiView): string {
  if (k.value === null || k.target === null) return "";
  const met = k.direction === "HIGHER_BETTER" ? k.value >= k.target : k.value <= k.target;
  return met ? "text-ontrack" : "text-overdue";
}

/** 27-management-control-tower.md rule 4 — KPIs by domain, value/target/trend, drill to the
 *  underlying facts + snapshot history (rule 4's "each number links to the underlying list"). */
export function KpisView({ projectId }: { projectId: string }) {
  const [domain, setDomain] = useState<(typeof DOMAINS)[number]>("SALES_HANDOVER");
  const [kpis, setKpis] = useState<KpiView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [drill, setDrill] = useState<KpiDrill | null>(null);
  const [drilling, setDrilling] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!projectId) return;
    setLoading(true);
    setError(false);
    managementApi.kpis(projectId, domain).then(setKpis).catch(() => setError(true)).finally(() => setLoading(false));
  }, [projectId, domain]);

  useEffect(load, [load]);

  async function openDrill(code: string) {
    setDrilling(code);
    try {
      setDrill(await managementApi.kpiDrill(code, projectId));
    } finally {
      setDrilling(null);
    }
  }

  return (
    <div>
      {/* shrink-0: see ControlTower.tsx's own comment — without it a long label wraps instead of
          the row scrolling horizontally. */}
      <div className="mb-4 overflow-x-auto">
        <Tabs value={domain} onValueChange={(v) => setDomain(v as (typeof DOMAINS)[number])}>
          <TabsList className="flex-nowrap">
            {DOMAINS.map((d) => (
              <TabsTrigger key={d} value={d} className="shrink-0 whitespace-nowrap">
                {DOMAIN_LABEL[d]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {error && (
        <Card>
          <CardBody className="text-subhead text-overdue">Couldn't reach the API on :3001.</CardBody>
        </Card>
      )}
      {!error && loading && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-busy="true" aria-label="Loading KPIs">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-line bg-surface-2" />
          ))}
        </div>
      )}
      {!error && !loading && kpis.length === 0 && (
        <Card>
          <CardBody className="text-subhead text-fg-muted">No KPIs defined for this domain.</CardBody>
        </Card>
      )}
      {!error && !loading && kpis.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {kpis.map((k) => (
            <Card key={k.code}>
              <CardBody>
                <div className="text-caption font-medium uppercase tracking-wide text-fg-subtle">{k.name}</div>
                <div className={cn("mt-1 text-title2 font-bold tabular-nums", onTargetTone(k))}>{formatValue(k)}</div>
                <div className="mt-1 flex items-center gap-2 text-footnote text-fg-muted">
                  <span>Target: {k.target === null ? "—" : formatValue({ unit: k.unit, value: k.target })}</span>
                  {k.trend !== null && (
                    <span className={trendTone(k)}>
                      {k.trend > 0 ? "▲" : k.trend < 0 ? "▼" : "–"} {Math.abs(k.trend).toFixed(1)}
                    </span>
                  )}
                </div>
                <button onClick={() => openDrill(k.code)} disabled={drilling === k.code} className="mt-2 text-footnote font-medium text-accent underline decoration-dotted">
                  {drilling === k.code ? "Loading…" : "Drill in"}
                </button>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={drill !== null} onOpenChange={(o) => !o && setDrill(null)}>
        {drill && (
          <DialogContent title={drill.name} description={`${drill.current.numerator} / ${drill.current.denominator} — ${DOMAIN_LABEL[drill.domain] ?? drill.domain}`}>
            <div className="flex flex-col gap-2">
              <div className="text-title2 font-bold">{formatValue({ unit: drill.unit, value: drill.current.value })}</div>
              {drill.history.length === 0 ? (
                <p className="text-footnote text-fg-muted">No snapshot history yet.</p>
              ) : (
                <table className="w-full text-footnote">
                  <thead>
                    <tr className="text-caption uppercase tracking-wide text-fg-subtle">
                      <th className="p-1 text-left">Period</th>
                      <th className="p-1 text-left">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drill.history.map((h) => (
                      <tr key={h.period} className="border-t border-line">
                        <td className="p-1">{h.period}</td>
                        <td className="p-1">{formatValue({ unit: drill.unit, value: h.value })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
