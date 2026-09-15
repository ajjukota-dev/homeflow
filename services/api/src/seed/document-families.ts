import type { DbClient } from "../db/types";

// 22-document-factory.md sale families as APPROVED templates. No Chromium / generateDocument.
// LEASE is unassigned (this product does not lease).

const FAMILIES: { code: string; name: string; transaction_type: string; body: string }[] = [
  { code: "AOS", name: "Agreement of Sale", transaction_type: "SALE", body: "<p>Agreement of Sale for {{unit_code}}.</p>" },
  { code: "SALE_DEED", name: "Sale Deed", transaction_type: "SALE", body: "<p>Sale Deed for {{unit_code}}.</p>" },
  { code: "ADDENDUM", name: "Addendum", transaction_type: "ADDENDUM", body: "<p>Addendum to the agreement for {{unit_code}}.</p>" },
  { code: "DEMAND", name: "Demand letter", transaction_type: "STATEMENT", body: "<p>Demand for {{unit_code}}.</p>" },
  { code: "RECEIPT", name: "Receipt", transaction_type: "STATEMENT", body: "<p>Receipt for {{unit_code}}.</p>" },
  { code: "HANDOVER_LETTER", name: "Handover letter", transaction_type: "LETTER", body: "<p>Handover letter for {{unit_code}}.</p>" },
  { code: "VARIATION", name: "Variation / customisation agreement", transaction_type: "CUSTOMISATION", body: "<p>Variation for {{unit_code}}.</p>" },
  { code: "CANCELLATION", name: "Cancellation", transaction_type: "CANCELLATION", body: "<p>Cancellation for {{unit_code}}.</p>" },
];

export const FACTORY_FAMILIES = FAMILIES;
export const FACTORY_FAMILY_CODES = FAMILIES.map((f) => f.code);

export async function seedDocumentFactoryFamilies(db: DbClient): Promise<void> {
  for (const f of FAMILIES) {
    const existing = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM doc_factory_template WHERE family_code = $1 AND status = 'APPROVED' AND project_id IS NULL`,
      [f.code]
    );
    if (Number(existing.rows[0]?.n ?? 0) > 0) continue;
    await db.query(
      `INSERT INTO doc_factory_template
         (id, family_code, name, transaction_type, status, version, body_html, created_by)
       VALUES ($1,$2,$3,$4,'APPROVED',1,$5,'user_legal')`,
      [`dtpl_seed_${f.code.toLowerCase()}`, f.code, f.name, f.transaction_type, f.body]
    );
  }
}
