import type { DbClient } from "../db/types";

// 15-qa-evidence-snags.md config: checklist templates + snag SLA by severity. Config in every
// environment (like seed/sla-policies.ts). Items are Emergent's T11 checklist
// (docs/reference/emergent-business-rules.md §2.3: civil, electrical, plumbing, painting,
// cleaning; apartments add tower_deps + access_card) spread over the four real seeded components
// (seed.ts: structure, mep_first_fix, flooring, finishing). Evidence kinds, min_photos = 1 and the
// per-item snag severities are UNCONFIRMED placeholders — Emergent's checklist had none of them.

interface TemplateItem { code: string; label: string; evidence: "NONE" | "PHOTO" | "TEST_REPORT" | "CERTIFICATE"; required: boolean; severity?: "CRITICAL" | "MAJOR" | "MINOR"; category?: string }

const TEMPLATES: { id: string; component_code: string; product_types: string[] | null; items: TemplateItem[] }[] = [
  {
    id: "qat_structure", component_code: "structure", product_types: null,
    items: [{ code: "civil", label: "Civil works complete and cured", evidence: "PHOTO", required: true, severity: "CRITICAL", category: "CIVIL" }],
  },
  {
    id: "qat_mep_first_fix", component_code: "mep_first_fix", product_types: null,
    items: [
      { code: "electrical", label: "Electrical conduits, DB and earthing", evidence: "TEST_REPORT", required: true, severity: "CRITICAL", category: "ELECTRICAL" },
      { code: "plumbing", label: "Plumbing lines pressure-tested", evidence: "TEST_REPORT", required: true, severity: "MAJOR", category: "PLUMBING" },
    ],
  },
  {
    id: "qat_flooring", component_code: "flooring", product_types: null,
    items: [{ code: "flooring", label: "Flooring laid, level and grouted", evidence: "PHOTO", required: true, severity: "MAJOR", category: "FLOORING" }],
  },
  {
    id: "qat_finishing", component_code: "finishing", product_types: null,
    items: [
      { code: "painting", label: "Painting complete, no patches", evidence: "PHOTO", required: true, severity: "MINOR", category: "PAINTING" },
      { code: "cleaning", label: "Unit cleaned and debris removed", evidence: "PHOTO", required: true, severity: "MINOR", category: "CLEANING" },
    ],
  },
  {
    id: "qat_finishing_apartment", component_code: "finishing", product_types: ["APARTMENT"],
    items: [
      { code: "painting", label: "Painting complete, no patches", evidence: "PHOTO", required: true, severity: "MINOR", category: "PAINTING" },
      { code: "cleaning", label: "Unit cleaned and debris removed", evidence: "PHOTO", required: true, severity: "MINOR", category: "CLEANING" },
      { code: "tower_deps", label: "Tower dependencies (lift, common power) available", evidence: "NONE", required: true, severity: "MAJOR", category: "OTHER" },
      { code: "access_card", label: "Access card issued", evidence: "NONE", required: false, category: "OTHER" },
    ],
  },
];

// Rule 6 / Data table: CRITICAL 2 d (Emergent [E §11.1]), MAJOR 7 d and MINOR 15 d
// DEFAULT_UNCONFIRMED. Calendar days — a live-wiring snag doesn't wait for Monday.
const SNAG_SLAS: { severity: "critical" | "major" | "minor"; days: number; unconfirmed: boolean }[] = [
  { severity: "critical", days: 2, unconfirmed: false },
  { severity: "major", days: 7, unconfirmed: true },
  { severity: "minor", days: 15, unconfirmed: true },
];

/** Templates reference component_definition rows, which today are demo data (seed.ts), so this
 *  runs after the demo seed; components a deployment doesn't have are skipped, and real
 *  templates arrive through PUT /qa/checklist-templates. */
export async function seedQaTemplates(db: DbClient): Promise<void> {
  const existing = await db.query<{ count: string }>(`SELECT count(*)::text FROM qa_checklist_template`);
  if (Number(existing.rows[0]?.count ?? 0) > 0) return; // idempotent

  for (const t of TEMPLATES) {
    await db.query(
      `INSERT INTO qa_checklist_template (id, component_code, product_types, items, min_photos)
       SELECT $1, $2, $3::text[], $4::jsonb, 1 WHERE EXISTS (SELECT 1 FROM component_definition WHERE code = $2)`,
      [t.id, t.component_code, t.product_types, JSON.stringify(t.items)]
    );
  }
}

/** Config in every environment (like seed/sla-policies.ts). */
export async function seedSnagSlaPolicies(db: DbClient): Promise<void> {
  const existing = await db.query<{ count: string }>(`SELECT count(*)::text FROM snag_sla_policy`);
  if (Number(existing.rows[0]?.count ?? 0) > 0) return; // idempotent

  for (const s of SNAG_SLAS) {
    const id = `snag_${s.severity}`;
    // Attach 12's standard ladder so scanEscalations picks snag clocks up (seedEscalationConfig's
    // own UPDATE only ran over the rows that existed when it first seeded).
    await db.query(
      `INSERT INTO sla_policy (id, code, applies_to, target_ref, duration_value, duration_unit, due_soon_lead_days, effective_from, escalation_ladder_id)
       VALUES ($1,$1,'SNAG_SEVERITY',$2,$3,'CALENDAR_DAYS',1,'2020-01-01',(SELECT id FROM escalation_ladder WHERE code = 'STANDARD' LIMIT 1))`,
      [id, s.severity.toUpperCase(), s.days]
    );
    await db.query(`INSERT INTO snag_sla_policy (severity, sla_policy_id, unconfirmed) VALUES ($1,$2,$3)`, [s.severity, id, s.unconfirmed]);
  }
}
