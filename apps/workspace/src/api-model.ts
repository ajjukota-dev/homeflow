// Canonical-model client (spec 04 §API) — project master, hierarchy, bulk units, customer
// merge/residency. Kept separate from api.ts to respect the 200-line rule.
import type { Customer } from "./api";

export type ProductType = "APARTMENT" | "VILLA" | "PLOT" | "MIXED";
export type ProjectStatus = "PLANNING" | "ACTIVE" | "HANDOVER" | "CLOSED";
export type HierarchyKind = "PHASE" | "TOWER" | "BLOCK" | "CLUSTER" | "FLOOR" | "STREET";

export interface ProjectMaster {
  id: string;
  code: string;
  name: string;
  portfolio_id: string | null;
  product_type: ProductType;
  legal_entity: string | null;
  jurisdiction: string | null;
  rera_reg_no: string | null;
  escrow_account_ref: string | null;
  location: string | null;
  launch_date: string | null;
  planned_handover_date: string | null;
  status: ProjectStatus;
}

export interface HierarchyNode {
  id: string;
  project_id: string;
  parent_id: string | null;
  kind: HierarchyKind;
  code: string;
  name: string;
  sort_order: number;
  planned_handover_date: string | null;
}

export interface AdminUnit {
  id: string;
  unit_number: string;
  code: string;
  unit_type: string;
  facing: string;
  product_type: ProductType;
  sale_status: string;
  hierarchy_node_id: string;
  floor_no: number | null;
  carpet_area_sqft: number | null;
  plot_area_sqyd: number | null;
  base_price_inr: number | null;
}

export interface BulkUnitRangeInput {
  hierarchy_node_id?: string;
  floor_from: number;
  floor_to: number;
  letter_from: string;
  letter_to: string;
  unit_type: string;
  facing: string;
  product_type?: ProductType;
  base_price_inr?: number;
  carpet_area_sqft?: number;
}

export interface MergePreview {
  from: Customer & { id: string; code?: string };
  into: Customer & { id: string; code?: string };
  bookings_to_repoint: number;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.errors?.[0]?.message ?? `API ${res.status}`);
  }
  return (await res.json()).data as T;
}

const postJson = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const patchJson = (url: string, body: unknown) =>
  fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const modelApi = {
  getProjectMaster: (id: string) => fetch(`/api/projects/${id}/master`).then((r) => json<ProjectMaster>(r)),
  updateProject: (id: string, patch: Partial<Omit<ProjectMaster, "id" | "code" | "portfolio_id">>) =>
    patchJson(`/api/projects/${id}`, patch).then((r) => json<ProjectMaster>(r)),

  listHierarchy: (projectId: string) =>
    fetch(`/api/projects/${projectId}/hierarchy`).then((r) => json<HierarchyNode[]>(r)),
  createHierarchyNode: (
    projectId: string,
    input: { kind: HierarchyKind; code: string; name: string; parent_id?: string | null }
  ) => postJson(`/api/projects/${projectId}/hierarchy`, input).then((r) => json<HierarchyNode>(r)),

  // Named distinctly from api.ts's booking-facing listUnits (different projection/endpoint) —
  // the two are spread into the same `api` object and a name clash would silently shadow one.
  listProjectUnits: (projectId: string) =>
    fetch(`/api/projects/${projectId}/units`).then((r) => json<AdminUnit[]>(r)),
  bulkCreateUnits: (projectId: string, input: BulkUnitRangeInput) =>
    postJson(`/api/projects/${projectId}/units/bulk`, input).then((r) =>
      json<{ unit_ids: string[]; count: number }>(r)
    ),

  mergePreview: (fromId: string, intoId: string) =>
    fetch(`/api/customers/${fromId}/merge-preview?into=${intoId}`).then((r) => json<MergePreview>(r)),
  mergeCustomer: (fromId: string, intoId: string) =>
    postJson(`/api/customers/${fromId}/merge`, { into_customer_id: intoId }).then((r) => json<{ ok: true }>(r)),
  updateResidency: (customerId: string, residency: "RESIDENT" | "NRI" | "OCI") =>
    patchJson(`/api/customers/${customerId}/residency`, { residency }).then((r) => json<{ ok: true }>(r)),
};
