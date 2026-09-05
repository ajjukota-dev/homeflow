import { onEvent, type AppendedEvent } from "../events";
import { evaluateUnit } from "./core";

// 08-changeability-engine.md rule 3: re-evaluate on every progress / handover-schedule change.
// Runs after commit via events/subscribers.ts (02 rule 4); each evaluation opens its own
// transaction. procurement.ordered / drawing.released have no producer yet — see core.ts header.
let registered = false;

export function registerChangeabilitySubscribers(): void {
  if (registered) return;
  registered = true;
  const perUnit = (trigger: string) => async (event: AppendedEvent) => {
    if (!event.unit_id) return;
    await evaluateUnit(event.unit_id, { trigger, sourceEventId: event.id });
  };
  onEvent("progress.updated", "changeability.reevaluate", perUnit("progress.updated"));
  onEvent("progress.reopened", "changeability.reevaluate", perUnit("progress.reopened"));
  onEvent("handover.scheduled", "changeability.reevaluate", perUnit("handover.scheduled"));
  onEvent("progress.bulk_applied", "changeability.reevaluate", async (event: AppendedEvent) => {
    const unitIds = (event.payload?.unit_ids as string[] | undefined) ?? [];
    for (const unitId of unitIds) await evaluateUnit(unitId, { trigger: "progress.bulk_applied", sourceEventId: event.id });
  });
}
