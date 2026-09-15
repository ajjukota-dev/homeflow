// 15-qa-evidence-snags.md — thin client for inspections + exception queue.

export type InspectionKind = "SITE_DECLARATION" | "QA_VERIFICATION" | "RE_INSPECTION";

export interface QaExceptionRow {
  id: string;
  unit_id: string;
  unit_number: string;
  component_code: string;
  kind: string;
  status: string;
  attempt_no: number;
  failure_reason: string | null;
  failures_on_component: number;
  pattern: { component: string; contractors: string[]; root_causes: string[] };
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const first = body.errors?.[0] ?? { code: "bad_request", message: `API ${res.status}` };
    throw new Error(first.message ?? first.code);
  }
  return body.data as T;
}

export const qaApi = {
  exceptions: (projectId: string) =>
    fetch(`/api/projects/${projectId}/qa/exceptions`).then((r) => unwrap<QaExceptionRow[]>(r)),
  startInspection: (unitId: string, component_code: string, kind: InspectionKind) =>
    fetch(`/api/units/${unitId}/inspections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ component_code, kind }),
    }).then((r) => unwrap<unknown>(r)),
};
