// 17-sales-crm-handover.md rules 1-2. Pure, framework-free — resolves which checklist rows
// apply to a given (product_type, residency) and scores a packet's satisfied-item set against
// them. Project-specific rows (project_id set) override the standard row with the same
// item_code for that project; nothing here queries the DB (core.ts does the resolution query).

export interface ChecklistRuleRow {
  id: string;
  project_id: string | null;
  product_type: string | null;
  residency: "RESIDENT" | "NRI" | "OCI" | "ANY";
  item_code: string;
  kind: "FIELD" | "DOCUMENT" | "CONFIRMATION" | "APPROVAL";
  required: boolean;
  weight: number;
}

export interface ChecklistItemResult {
  item_code: string;
  kind: ChecklistRuleRow["kind"];
  required: boolean;
  weight: number;
  satisfied: boolean;
}

export interface CompletenessResult {
  score: number;
  detail: ChecklistItemResult[];
  blockers: string[];
}

/** Rule 2: project override beats standard; product_type null = matches any; residency ANY
 *  always applies, plus the specific RESIDENT/NRI/OCI rows for this applicant's residency. */
export function resolveChecklistRules(
  rows: ChecklistRuleRow[],
  productType: string | null,
  residency: "RESIDENT" | "NRI" | "OCI",
  projectId: string
): ChecklistRuleRow[] {
  const candidates = rows.filter(
    (r) =>
      (r.product_type === null || r.product_type === productType) &&
      (r.residency === "ANY" || r.residency === residency)
  );
  const byItem = new Map<string, ChecklistRuleRow>();
  for (const r of candidates) {
    const existing = byItem.get(r.item_code);
    // A project-specific row always wins over a standard one for the same item_code.
    if (!existing || (r.project_id === projectId && existing.project_id === null)) {
      byItem.set(r.item_code, r);
    }
  }
  return [...byItem.values()];
}

/** Rule 1: score = Σ weight of satisfied / Σ weight × 100. `satisfied` is supplied by the
 *  caller per item_code (core.ts derives it from the live packet + booking.docs + the
 *  commercial-approval check) — this function only aggregates. */
export function scoreCompleteness(rules: ChecklistRuleRow[], satisfied: Set<string>): CompletenessResult {
  const detail: ChecklistItemResult[] = rules.map((r) => ({
    item_code: r.item_code,
    kind: r.kind,
    required: r.required,
    weight: r.weight,
    satisfied: satisfied.has(r.item_code),
  }));
  const totalWeight = detail.reduce((sum, d) => sum + d.weight, 0);
  const satisfiedWeight = detail.filter((d) => d.satisfied).reduce((sum, d) => sum + d.weight, 0);
  const score = totalWeight === 0 ? 100 : Math.round((satisfiedWeight / totalWeight) * 100);
  const blockers = detail.filter((d) => d.required && !d.satisfied).map((d) => d.item_code);
  return { score, detail, blockers };
}
