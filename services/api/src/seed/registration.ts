import { randomUUID } from "node:crypto";
import type { DbClient } from "../db/types";

// 23-registration.md rule 4/5: a single global (project_id NULL, jurisdiction NULL) fallback
// template so `loadTemplate` always resolves to something on a fresh DB. `day_of_items` uses the
// 7 items the spec's own Data section names by name ("originals to carry, ID proofs, photos,
// witnesses, DD/challan, POA original, company authorisation") — generic to any project, not
// invented. `sro_offices` ships empty (real SRO office names/addresses are Amarsh's to supply,
// same as East Crest's own duration numbers elsewhere — inventing some to look populated would be
// exactly the hardcoding CLAUDE.md forbids). `jurisdiction_lead_days: 15` is a placeholder,
// UNCONFIRMED, same class as 18's cr_approval_rule thresholds.
export async function seedRegistrationConfig(db: DbClient): Promise<void> {
  const existing = await db.query<{ count: string }>(`SELECT count(*)::text FROM registration_checklist_template WHERE project_id IS NULL AND jurisdiction IS NULL`);
  if (Number(existing.rows[0]?.count ?? 0) > 0) return; // idempotent

  const preItems = [
    { key: "documents", label: "Customer documents" },
    { key: "payments", label: "Payments due" },
    { key: "tds", label: "TDS" },
    { key: "appointments", label: "Appointments" },
    { key: "signatures", label: "Signatures" },
  ];
  const dayOfItems = [
    { key: "originals_to_carry", label: "Originals to carry" },
    { key: "id_proofs", label: "ID proofs" },
    { key: "photographs", label: "Photographs" },
    { key: "witnesses", label: "Witnesses" },
    { key: "dd_challan", label: "DD / challan" },
    { key: "poa_original", label: "POA original" },
    { key: "company_authorisation", label: "Company authorisation" },
  ];
  await db.query(
    `INSERT INTO registration_checklist_template (id, project_id, jurisdiction, pre_items, day_of_items, sro_offices, jurisdiction_lead_days)
     VALUES ($1,NULL,NULL,$2::jsonb,$3::jsonb,'[]'::jsonb,15)`,
    [randomUUID(), JSON.stringify(preItems), JSON.stringify(dayOfItems)]
  );
}
