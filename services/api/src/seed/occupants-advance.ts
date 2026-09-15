import { db } from "../db";
import { completeTaskInstance } from "../journey/instances";
import { addEvidence, getAction, setChecklistItem, startAction, submitForApproval, verifyEvidence } from "../actions/core";
import { crm, fm, legal, sa } from "./occupants-ctx";

// Advance journeys only via completeTaskInstance. T4/PT2 are conditional and usually absent.

async function task(bookingId: string, code: string): Promise<{ id: string; action_id: string; status: string } | null> {
  const r = await db.query<{ id: string; action_id: string; status: string }>(
    `SELECT ti.id, ti.action_id, ti.status FROM task_instance ti
       JOIN stage_instance si ON si.id = ti.stage_instance_id
       JOIN journey_instance ji ON ji.id = si.journey_id
      WHERE ji.booking_id = $1 AND ti.task_code = $2`,
    [bookingId, code]
  );
  return r.rows[0] ?? null;
}

async function must(bookingId: string, code: string) {
  const t = await task(bookingId, code);
  if (!t?.action_id) throw new Error(`seed: missing actionable task ${code} on ${bookingId}`);
  return t;
}

async function completeSimple(bookingId: string, code: string): Promise<void> {
  const t = await must(bookingId, code);
  if (t.status === "Closed") return;
  await completeTaskInstance(t.id, sa);
}

async function completeVerification(bookingId: string, code: string, verifier: typeof crm): Promise<void> {
  const t = await must(bookingId, code);
  if (t.status === "Closed") return;
  await completeTaskInstance(t.id, verifier);
}

async function completeEvidence(bookingId: string, code: string, verifier: typeof crm | null): Promise<void> {
  const t = await must(bookingId, code);
  if (t.status === "Closed") return;
  const evId = await addEvidence(t.action_id, `seed/${bookingId}/${code}.pdf`, "doc", sa);
  if (verifier) {
    await verifyEvidence(evId, "VERIFIED", undefined, verifier);
  } else {
    // T7/T8/T10 have no verifier_role, so verifyEvidence cannot run.
    await db.query(`UPDATE action_evidence SET verification_status = 'VERIFIED' WHERE id = $1`, [evId]);
  }
  await completeTaskInstance(t.id, sa);
}

async function completeApproval(bookingId: string): Promise<void> {
  const t = await must(bookingId, "T6");
  if (t.status === "Closed") return;
  await startAction(t.action_id, legal);
  await submitForApproval(t.action_id, legal);
  await completeTaskInstance(t.id, sa);
}

async function completeChecklist(bookingId: string, code: string): Promise<void> {
  const t = await must(bookingId, code);
  if (t.status === "Closed") return;
  const action = await getAction(t.action_id, sa);
  for (const item of action.checklist) await setChecklistItem(t.action_id, item.id, true, sa);
  await completeTaskInstance(t.id, sa);
}

export async function completePt1T1T2(bookingId: string): Promise<void> {
  await completeSimple(bookingId, "PT1");
  await completeSimple(bookingId, "T1");
  await completeVerification(bookingId, "T2", crm);
}

export async function completeThroughT11(bookingId: string): Promise<void> {
  await completePt1T1T2(bookingId);
  await completeEvidence(bookingId, "T3", crm);
  await completeSimple(bookingId, "T5");
  await completeApproval(bookingId);
  await completeEvidence(bookingId, "T7", null);
  await completeEvidence(bookingId, "T8", null);
  await completeSimple(bookingId, "T9");
  await completeEvidence(bookingId, "T10", null);
  await completeChecklist(bookingId, "T11");
}

export async function completeThroughT13(bookingId: string): Promise<void> {
  await completeThroughT11(bookingId);
  await completeSimple(bookingId, "T12");
  await completeSimple(bookingId, "PT3");
  await completeVerification(bookingId, "T13", fm);
}
