import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { initDb, db } from "../db";
import { appendEvent, withTx } from "./append";
import { onEvent, clearSubscribers, retryFailedDeliveries } from "./subscribers";

// Rule 4 (02): subscribers run after commit, are idempotent, and a failure is logged to
// event_delivery_failure and retried by a job — never swallowed.

beforeAll(async () => {
  await initDb();
});
afterEach(() => clearSubscribers());

describe("event subscribers (02 rule 4)", () => {
  it("runs a subscriber only after the transaction commits", async () => {
    const seen: string[] = [];
    onEvent("unit.created", "test-recorder", (e) => {
      seen.push(e.entity_id);
    });
    await withTx(undefined, async (tx) => {
      await appendEvent(tx, { type: "unit.created", entity_type: "unit", entity_id: "u_sub1" });
      // Not dispatched yet — we're still inside the transaction.
      expect(seen).toEqual([]);
    });
    expect(seen).toEqual(["u_sub1"]);
  });

  it("never dispatches an event whose transaction rolled back", async () => {
    const seen: string[] = [];
    onEvent("unit.created", "test-recorder", (e) => {
      seen.push(e.entity_id);
    });
    await expect(
      withTx(undefined, async (tx) => {
        await appendEvent(tx, { type: "unit.created", entity_type: "unit", entity_id: "u_sub2" });
        throw new Error("force rollback");
      })
    ).rejects.toThrow("force rollback");
    expect(seen).toEqual([]);
  });

  it("logs a failing subscriber to event_delivery_failure instead of throwing, and a retry can resolve it", async () => {
    let attempt = 0;
    onEvent("unit.created", "flaky-subscriber", () => {
      attempt++;
      if (attempt === 1) throw new Error("boom");
    });
    await withTx(undefined, async (tx) => {
      await appendEvent(tx, { type: "unit.created", entity_type: "unit", entity_id: "u_sub3" });
    });
    const failures = await db.query<{ subscriber: string; resolved_at: string | null }>(
      `SELECT subscriber, resolved_at FROM event_delivery_failure ef
         JOIN event e ON e.id = ef.event_id WHERE e.entity_id = 'u_sub3'`
    );
    expect(failures.rows).toHaveLength(1);
    expect(failures.rows[0].resolved_at).toBeNull();

    const result = await retryFailedDeliveries();
    expect(result.resolved).toBeGreaterThanOrEqual(1);
    const after = await db.query<{ resolved_at: string | null }>(
      `SELECT resolved_at FROM event_delivery_failure ef
         JOIN event e ON e.id = ef.event_id WHERE e.entity_id = 'u_sub3'`
    );
    expect(after.rows[0].resolved_at).not.toBeNull();
  });
});
