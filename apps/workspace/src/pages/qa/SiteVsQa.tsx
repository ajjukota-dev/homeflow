import { useState } from "react";
import { Button, Card, CardBody } from "@homeflow/ui";
import type { ReadinessRow } from "../../api-lifecycle";
import { qaApi } from "./api";

/** 15 rule 1 — site declaration is a distinct act from independent QA verification. */
export function SiteVsQa({ units, roles, onChanged }: { units: ReadinessRow[]; roles: string[]; onChanged: () => void }) {
  const canSite = roles.some((r) => r === "SITE" || r === "SUPER_ADMIN");
  const canQa = roles.some((r) => r === "QA" || r === "SUPER_ADMIN");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work.");
    }
    setBusy(null);
  }

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-title3 font-semibold">Site declaration vs QA verify</h2>
      <p className="mb-4 max-w-2xl text-footnote text-fg-muted">
        Site records a declaration. QA independently verifies. They are different inspections, not the same tick.
      </p>
      {error && (
        <p role="alert" className="mb-3 text-footnote text-overdue">
          {error}
        </p>
      )}
      {units.length === 0 ? (
        <Card>
          <CardBody className="text-subhead text-fg-muted">No booked units to declare or verify.</CardBody>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {units.map((u) => (
            <li key={u.id}>
              <Card>
                <CardBody>
                  <div className="text-headline font-semibold">
                    {u.customer_name} · Villa {u.unit_number}
                  </div>
                  <ul className="mt-3 flex flex-col gap-2">
                    {u.components.map((c) => (
                      <li key={c.code} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-footnote text-fg">{c.label}</span>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={!canSite || busy === `${u.id}-${c.code}-site`}
                            onClick={() => run(`${u.id}-${c.code}-site`, () => qaApi.startInspection(u.id, c.code, "SITE_DECLARATION"))}
                          >
                            Site declare {c.label}
                          </Button>
                          <Button
                            size="sm"
                            disabled={!canQa || busy === `${u.id}-${c.code}-qa`}
                            onClick={() => run(`${u.id}-${c.code}-qa`, () => qaApi.startInspection(u.id, c.code, "QA_VERIFICATION"))}
                          >
                            QA verify {c.label}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
