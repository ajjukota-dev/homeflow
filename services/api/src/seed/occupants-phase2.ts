import { db } from "../db";
import { createBaseline, approveBaseline } from "../specification/baselines";
import { returnHandover } from "../sales-handover/core";
import { bookAndAccept, bookAndSubmit } from "./occupants-book";
import { crm, site } from "./occupants-ctx";
import { ADITI, HARISH, NISHA, SURESH, resolveMeadowsOccupant } from "./occupants-phase2-ctx";
import { seedNishaChangeRequest, seedTanviProspectAndHold } from "./occupants-phase2-desk";

// Phase 2 desks: packets, Meadows bookings, customisation, sales hold.
// 2.1 → 2.2 → 2.5 → 2.3 → 2.4. Journeys only on accepted (2.5). Never books V101/V104/V108.

const MEADOWS = "p_meadows";

/** setupFunding looks up payment_plan by project_id; Meadows had none. Same 5-milestone
 *  construction-linked plan as seed.ts plan_standard — not invented SOP days. */
async function ensureMeadowsPaymentPlan(): Promise<void> {
  const existing = await db.query<{ id: string }>(`SELECT id FROM payment_plan WHERE id = 'plan_meadows'`);
  if (existing.rows[0]) return;
  await db.query(`INSERT INTO payment_plan (id, project_id, name, basis) VALUES ('plan_meadows',$1,'Construction-linked plan','construction_linked')`, [MEADOWS]);
  await db.query(`
    INSERT INTO payment_plan_milestone (id, plan_id, milestone_key, milestone_label, construction_trigger_event, sequence, pct_of_consideration) VALUES
      ('plan_meadows_m1','plan_meadows','booking_token','Booking amount',NULL,1,10),
      ('plan_meadows_m2','plan_meadows','structure_milestone','Structure complete','structure:complete',2,30),
      ('plan_meadows_m3','plan_meadows','mep_milestone','MEP first-fix complete','mep_first_fix:complete',3,20),
      ('plan_meadows_m4','plan_meadows','flooring_milestone','Flooring laid','flooring:complete',4,20),
      ('plan_meadows_m5','plan_meadows','possession_milestone','Possession','finishing:verified',5,20)`);
}

async function ensureMeadowsBaselines(): Promise<void> {
  const have = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM specification_baseline WHERE project_id = $1 AND status = 'APPROVED'`,
    [MEADOWS]
  );
  if ((have.rows[0]?.n ?? 0) >= 2) return;
  const apt = await createBaseline(
    {
      project_id: MEADOWS, product_type: "APARTMENT", name: "Meadows Apartment — Standard Specification",
      items: {
        flooring: { spec: "Vitrified tiles in living and bedrooms" },
        kitchen: { spec: "Modular kitchen with granite countertop" },
      },
    },
    site
  );
  await approveBaseline(apt.id, site);
  const plot = await createBaseline(
    {
      project_id: MEADOWS, product_type: "PLOT", name: "Meadows Plot — Standard Specification",
      items: { plot: { spec: "Plotted development as per approved layout" } },
    },
    site
  );
  await approveBaseline(plot.id, site);
}

export async function seedOccupantsPhase2(): Promise<void> {
  await ensureMeadowsPaymentPlan();
  await ensureMeadowsBaselines();

  await bookAndSubmit(await resolveMeadowsOccupant(ADITI));

  await bookAndSubmit(await resolveMeadowsOccupant(HARISH));
  await returnHandover(
    HARISH.booking_id,
    "MISSING_DOCUMENTS",
    "PAN copy is cropped; please re-upload a full scan.",
    crm
  );

  await bookAndAccept(await resolveMeadowsOccupant(NISHA));
  await seedNishaChangeRequest();
  await bookAndAccept(await resolveMeadowsOccupant(SURESH));

  await seedTanviProspectAndHold();
}
