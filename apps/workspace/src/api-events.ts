// Event log client (spec 02 §API) — kept separate from api.ts to respect the 200-line rule.

export interface AuditRow {
  id: string;
  occurred_at: string;
  type: string;
  entity_type: string;
  entity_id: string;
  project_id: string | null;
  actor_user_id: string | null;
  actor_kind: string;
  payload: Record<string, unknown>;
  source_ref: string | null;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()).data as T;
}

export const eventsApi = {
  audit: (entityType: string, entityId: string) =>
    fetch(`/api/audit?entity_type=${entityType}&entity_id=${entityId}`).then((r) => json<AuditRow[]>(r)),
};
