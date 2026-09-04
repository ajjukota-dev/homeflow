import { db } from "./db";
import { t2Payments } from "./collections-view";
import { type ProgressState } from "./gates";

// Customer-safe T4 / T5 / T6 projections (customer-transparency.md). Internal codes never cross.

export async function t4Passport(unitId: string) {
  const r = await db.query<{
    category: string;
    name: string;
    brand_model: string | null;
    paint_tile_code: string | null;
    warranty_months: number | null;
  }>(
    `SELECT category, name, brand_model, paint_tile_code, warranty_months
       FROM home_passport_item
      WHERE unit_id = $1 AND customer_facing = true AND approved = true
      ORDER BY category, name`,
    [unitId]
  );
  return r.rows.map((row) => ({
    type: row.category,
    name: row.name,
    brand_model: row.brand_model,
    paint_tile_code: row.paint_tile_code,
    warranty_months: row.warranty_months,
  }));
}

export async function t5Legal(bookingId: string, projectId: string) {
  const p = await db.query<{ rera_reg_no: string | null; escrow_note: string | null }>(
    `SELECT rera_reg_no, escrow_note FROM project WHERE id = $1`,
    [projectId]
  );
  const docs = await db.query<{ document_family: string; status: string }>(
    `SELECT document_family, status FROM generated_document
      WHERE booking_id = $1 AND status IN ('executed','archived')
      ORDER BY version DESC`,
    [bookingId]
  );
  const nameFor = (family: string) => (family === "AOS" ? "Agreement for sale" : family);
  const statusFor = (status: string) => (status === "archived" ? "Registered" : "Signed");
  return {
    rera_reg_no: p.rows[0]?.rera_reg_no ?? null,
    escrow_note: p.rows[0]?.escrow_note ?? null,
    my_documents: docs.rows.map((d) => ({ name: nameFor(d.document_family), status: statusFor(d.status) })),
  };
}

function monthLabel(offset: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return d.toLocaleString("en-IN", { month: "short" });
}

export async function t6Keys(
  bookingId: string,
  eligible: boolean,
  completed: boolean,
  progress: Record<string, ProgressState>
) {
  const payments = await t2Payments(bookingId, progress);
  const my_todos = (payments?.schedule ?? [])
    .filter((line) => line.status === "Due")
    .map((line) => ({ label: `Pay ${line.milestone_label}`, status: "open" as const }));
  if (completed) {
    return { expected_window: "Keys already with you", confidence_label: "Complete", my_todos: [] };
  }
  if (eligible) {
    return {
      expected_window: `${monthLabel(0)}–${monthLabel(1)}`,
      confidence_label: "On track",
      my_todos,
    };
  }
  return {
    expected_window: `${monthLabel(1)}–${monthLabel(3)}`,
    confidence_label: "Firming up",
    my_todos,
  };
}
