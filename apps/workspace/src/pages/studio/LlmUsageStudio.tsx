// 31-intelligence.md Studio: "LLM budget/usage." studio/registry.ts's own comment explains why
// this stays a bespoke read-only screen, not the generic table editor: the budget cap is a single
// env var (`LLM_MONTHLY_BUDGET_INR`), read live on every LLM call — there is no config table for
// a tab to CRUD. Flagged honestly here rather than faking an editable field that would silently
// do nothing.
import { useEffect, useState } from "react";
import { PageHeader, EmptyState, Skeleton, Card, CardBody } from "@homeflow/ui";
import { CircleAlert } from "lucide-react";
import { formatINR } from "../../ui/MoneyFigure";
import { suggestionsApi, type LlmUsage } from "../suggestions/api";

export function LlmUsageStudio() {
  const [usage, setUsage] = useState<LlmUsage | null | undefined>(undefined);
  const [error, setError] = useState(false);

  useEffect(() => {
    suggestionsApi.usage().then(setUsage).catch(() => setError(true));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="LLM budget & usage" description="Month-to-date spend on every LLM task this codebase runs (rule 5's own budget cap)." />

      {error && <EmptyState icon={CircleAlert} message="Couldn't load LLM usage." />}
      {!error && usage === undefined && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {!error && usage && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card>
              <CardBody>
                <p className="text-ws-sm text-fg-muted">Calls this month</p>
                <p className="hf-tnum mt-1 text-ws-xl font-semibold text-fg">{usage.month_to_date.total_calls}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="text-ws-sm text-fg-muted">Tokens this month</p>
                <p className="hf-tnum mt-1 text-ws-xl font-semibold text-fg">{Number(usage.month_to_date.total_tokens).toLocaleString("en-IN")}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="text-ws-sm text-fg-muted">Spend this month</p>
                <p className="hf-tnum mt-1 text-ws-xl font-semibold text-fg">{formatINR(usage.month_to_date.total_cost_inr)}</p>
              </CardBody>
            </Card>
          </div>
          <p className="text-footnote text-fg-muted">
            The monthly budget cap is set by the <code className="rounded bg-surface-2 px-1 py-0.5 text-caption">LLM_MONTHLY_BUDGET_INR</code> environment
            variable, checked live before every LLM call — it has no config-table row, so it can't be edited from this screen. When spend reaches the cap,
            rule-based features keep working; only LLM-suggestion tasks stop being created for the rest of the month.
          </p>
        </>
      )}
    </div>
  );
}
