async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()).data as T;
}

export interface LegalDoc {
  id: string;
  document_family: string;
  status: string;
  version: number;
}

export interface LegalRow {
  booking_id: string;
  unit_id: string;
  unit_number: string;
  customer_name: string;
  document: LegalDoc | null;
  financial: { cleared: boolean; reason: string | null; paid_pct: number };
  registration: { id: string | null; status: string; sro_reference: string | null };
}

export interface ReadyComponent {
  code: string;
  label: string;
  qa_verified: boolean;
}

export interface SnagRow {
  id: string;
  severity: string;
  location: string;
  trade: string;
  description: string;
  status: string;
}

export interface ReadinessRow {
  id: string;
  unit_number: string;
  booking_id: string;
  customer_name: string;
  value: number;
  drivers: string[];
  qa_approved: boolean;
  components: ReadyComponent[];
  snags: SnagRow[];
}

export interface HandoverGateView {
  type: string;
  classification: string;
  state: string;
  blockers: string[];
}

export interface HandoverRow {
  booking_id: string;
  unit_id: string;
  unit_number: string;
  customer_name: string;
  eligible: boolean;
  lifecycle: string;
  gates: HandoverGateView[];
  blockers: { gate: string; reason: string }[];
  readiness: { value: number; drivers: string[] };
}

export interface WarrantyView {
  windows: {
    id: string;
    unit_id: string;
    booking_id: string;
    unit_number: string;
    customer_name: string;
    dlp_start: string;
    dlp_end: string;
    status: string;
    policy_months: number;
  }[];
  cases: {
    id: string;
    unit_id: string;
    unit_number: string;
    customer_name: string;
    description: string;
    coverage: string;
    status: string;
    severity: string;
  }[];
  checkins: {
    id: string;
    booking_id: string;
    unit_number: string;
    customer_name: string;
    day: number;
    status: string;
    satisfaction_score: number | null;
  }[];
}

export interface ServiceEvent {
  id: string;
  event_type: string;
  description: string;
  actor: string;
  occurred_at: string;
}

export interface Intervention {
  id: string;
  category: string;
  rank: number;
  material: boolean;
  headline: string;
  owner: string;
  status: string;
  booking_id?: string;
  unit_id?: string;
  decision_pack: {
    what_happened: string;
    impact: { customer: string; rupee: number };
    dependencies: string[];
    recommended_decision: string;
    evidence_links: string[];
  };
}

async function mutate<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json();
  if (!res.ok) {
    const err = new Error(payload.errors?.[0]?.message ?? `API ${res.status}`) as Error & {
      errors?: { field?: string; message: string; source_ref?: string }[];
    };
    err.errors = payload.errors;
    throw err;
  }
  return payload.data as T;
}

export const lifecycleApi = {
  legalQueue: (projectId: string) => fetch(`/api/projects/${projectId}/legal`).then((r) => json<LegalRow[]>(r)),
  generateAos: (bookingId: string) => mutate<LegalDoc>(`/api/bookings/${bookingId}/documents/generate`, { document_family: "AOS" }),
  approveDoc: (id: string) => mutate<LegalDoc>(`/api/documents/${id}/approve`),
  executeDoc: (id: string) => mutate<LegalDoc>(`/api/documents/${id}/execute`),
  completeRegistration: (bookingId: string, sro_reference: string) =>
    mutate(`/api/bookings/${bookingId}/registration/complete`, { sro_reference }),
  readiness: (projectId: string) => fetch(`/api/projects/${projectId}/readiness`).then((r) => json<ReadinessRow[]>(r)),
  verifyQa: (unitId: string, component: string) =>
    mutate(`/api/units/${unitId}/qa/${component}/verify`, { evidence_note: "Checklist and photo signed off" }),
  closeSnag: (id: string) =>
    mutate(`/api/snags/${id}/close`, { before_note: "Defect photographed before work", after_note: "Rectified and re-photographed" }),
  handover: (projectId: string) => fetch(`/api/projects/${projectId}/handover`).then((r) => json<HandoverRow[]>(r)),
  completeHandover: (bookingId: string) => mutate(`/api/bookings/${bookingId}/handover/complete`),
  warranty: (projectId: string) => fetch(`/api/projects/${projectId}/warranty`).then((r) => json<WarrantyView>(r)),
  serviceHistory: (unitId: string) => fetch(`/api/units/${unitId}/service-history`).then((r) => json<ServiceEvent[]>(r)),
  closeWarranty: (id: string) => mutate(`/api/warranty-cases/${id}/close`),
  captureCheckin: (id: string) => mutate(`/api/checkins/${id}/capture`, { satisfaction_score: 5 }),
  controlTower: (projectId: string) =>
    fetch(`/api/projects/${projectId}/control-tower`).then((r) => json<{ interventions: Intervention[] }>(r)),
  actIntervention: (id: string) => mutate(`/api/interventions/${id}/act`),
};
