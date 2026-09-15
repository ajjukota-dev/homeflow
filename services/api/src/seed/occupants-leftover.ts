import { db } from "../db";
import { seedKavyaAosDraft, seedDeepakRegistrationSlot, seedIshaanHandoverInProgress, seedKarthikOverdueReasons } from "./occupants-leftover-must";
import { seedPlanVsForecast } from "./occupants-leftover-plan";
import {
  seedLeelaNriLoan,
  seedFarhanDefaultLegal,
  seedClosedV117,
  seedAnjaliPreRegBlocked,
  seedVivekCriticalSnag,
} from "./occupants-leftover-extra";

// Phase 2 leftover 2.6–2.16 (PDF §34.2). Called after Day 2. Never books V101/V104/V108.

export async function seedOccupantsLeftover(): Promise<void> {
  const policy = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM collection_policy WHERE project_id = 'p_meadows'`
  );
  if ((policy.rows[0]?.n ?? 0) === 0) {
    await db.query(
      `INSERT INTO collection_policy (project_id, true_risk_max_probability, registration_min_pct)
       VALUES ('p_meadows', 0.40, 0.70)`
    );
  }
  await seedKavyaAosDraft();
  await seedDeepakRegistrationSlot();
  await seedIshaanHandoverInProgress();
  await seedKarthikOverdueReasons();
  await seedLeelaNriLoan();
  await seedFarhanDefaultLegal();
  await seedClosedV117();
  await seedAnjaliPreRegBlocked();
  await seedVivekCriticalSnag();
  await seedPlanVsForecast();
}
