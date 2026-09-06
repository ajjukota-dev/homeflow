// CRM-side customer updates queue (26-customer-portal.md rule 10). Same req/unwrap pattern as
// pages/sales-handover/api.ts.
import { ApiError } from "../../auth/api";

export interface CustomerUpdateRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  status: "DRAFT" | "PUBLISHED";
  source_event_id: string | null;
  created_at: string;
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const first = body.errors?.[0] ?? { code: "bad_request", message: `API ${res.status}` };
    throw new ApiError(first.code, first.message ?? first.code);
  }
  return body.data as T;
}

function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  return fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => unwrap<T>(r));
}

export const customerUpdatesApi = {
  forBooking: (bookingId: string) => req<CustomerUpdateRow[]>("GET", `/api/bookings/${bookingId}/customer-updates`),
  publish: (id: string, edits?: { title?: string; body?: string }) => req<{ ok: boolean }>("POST", `/api/customer-updates/${id}/publish`, edits ?? {}),
};
