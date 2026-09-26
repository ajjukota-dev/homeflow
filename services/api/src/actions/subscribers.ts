import { onEvent, type AppendedEvent } from "../events";
import { db } from "../db";
import { autoCloseFromSource } from "./core";

// Spec 10 rule 7: when a source entity closes, auto-close its open actions with
// close_note = "Resolved by <event>". Only events that already exist. An event
// whose module does not exist is not subscribed — it creates nothing.

let registered = false;

function sourceFromEvent(event: AppendedEvent): { type: string; id: string } | null {
  if (event.type === "snag.closed") return { type: "snag", id: event.entity_id };
  if (event.type === "warranty.case_closed") return { type: "warranty_case", id: event.entity_id };
  if (event.type === "payment.received") {
    const demandId = (event.payload as { demand_id?: string } | undefined)?.demand_id;
    return demandId ? { type: "demand", id: demandId } : null;
  }
  if (event.type === "commitment.fulfilled" || event.type === "commitment.waived") {
    return { type: "commitment", id: event.entity_id };
  }
  return null;
}

async function autoCloseOnSourceClosed(event: AppendedEvent): Promise<void> {
  const source = sourceFromEvent(event);
  if (!source) return;
  const open = await db.query<{ id: string }>(
    `SELECT id FROM action
      WHERE source_entity_type = $1 AND source_entity_id = $2
        AND status NOT IN ('Closed', 'Cancelled')`,
    [source.type, source.id]
  );
  for (const row of open.rows) {
    await autoCloseFromSource(row.id, event.type);
  }
}

export function registerActionSubscribers(): void {
  if (registered) return;
  registered = true;
  onEvent("snag.closed", "actions.auto_close_on_snag_closed", autoCloseOnSourceClosed);
  onEvent("warranty.case_closed", "actions.auto_close_on_warranty_closed", autoCloseOnSourceClosed);
  onEvent("payment.received", "actions.auto_close_on_payment_received", autoCloseOnSourceClosed);
  onEvent("commitment.fulfilled", "actions.auto_close_on_commitment_fulfilled", autoCloseOnSourceClosed);
  onEvent("commitment.waived", "actions.auto_close_on_commitment_waived", autoCloseOnSourceClosed);
}
