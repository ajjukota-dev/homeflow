// 09-specification-revisions.md §API. Same req/unwrap pattern as pages/finance/api.ts and
// pages/customisation/api.ts.
import { ApiError } from "../../auth/api";

export type SpecItem = { spec: string; brand_model?: string | null; qty?: number | null };
export type SpecItems = Record<string, SpecItem>;

export interface Baseline {
  id: string; project_id: string; product_type: "APARTMENT" | "VILLA" | "PLOT" | "MIXED"; unit_type: string | null;
  name: string; version: number; items: SpecItems; status: "DRAFT" | "APPROVED" | "RETIRED";
  approved_by: string | null; approved_at: string | null; created_at: string;
}

export interface CatalogueItem {
  id: string; project_id: string | null; category_code: string; code: string; name: string; description: string | null;
  unit_price_inr: number; vendor_cost_inr: number; lead_days: number; product_types: string[]; constraints: Record<string, unknown>; active: boolean;
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

export const specificationApi = {
  listBaselines: (projectId?: string) => req<Baseline[]>("GET", `/api/specification-baselines${projectId ? `?project_id=${projectId}` : ""}`),
  createBaseline: (input: { project_id: string; product_type: Baseline["product_type"]; unit_type?: string | null; name: string; items: SpecItems }) =>
    req<Baseline>("POST", "/api/specification-baselines", input),
  updateBaseline: (id: string, input: { name?: string; items?: SpecItems }) => req<Baseline>("PUT", `/api/specification-baselines/${id}`, input),
  approveBaseline: (id: string) => req<Baseline>("POST", `/api/specification-baselines/${id}/approve`),

  listCatalogue: (query: { project_id?: string; category_code?: string; include_inactive?: boolean }) => {
    const params = new URLSearchParams();
    if (query.project_id) params.set("project_id", query.project_id);
    if (query.category_code) params.set("category_code", query.category_code);
    if (query.include_inactive) params.set("include_inactive", "true");
    const qs = params.toString();
    return req<CatalogueItem[]>("GET", `/api/variation-catalogue${qs ? `?${qs}` : ""}`);
  },
  putCatalogue: (items: (Omit<CatalogueItem, "id"> & { id?: string })[]) => req<CatalogueItem[]>("PUT", "/api/variation-catalogue", { items }),
};
