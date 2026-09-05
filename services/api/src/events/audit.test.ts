import { describe, it, expect, beforeAll } from "vitest";
import { initDb } from "../db";
import { appendEvent, withTx } from "./append";
import { getAudit } from "./audit";

beforeAll(async () => {
  await initDb();
});

describe("GET /audit (02 §API)", () => {
  it("filters by entity_type and entity_id and pages results", async () => {
    await withTx(undefined, async (tx) => {
      await appendEvent(tx, {
        type: "unit.created",
        entity_type: "unit",
        entity_id: "u_audit1",
        payload: { unit_number: "V999" },
      });
      await appendEvent(tx, {
        type: "unit.sale_status_changed",
        entity_type: "unit",
        entity_id: "u_audit1",
        payload: { from: "AVAILABLE", to: "HELD" },
      });
      await appendEvent(tx, { type: "unit.created", entity_type: "unit", entity_id: "u_audit_other" });
    });
    const r = await getAudit({ entity_type: "unit", entity_id: "u_audit1" });
    expect(r.total).toBe(2);
    expect(r.data.every((row) => row.entity_id === "u_audit1")).toBe(true);
    expect(r.data[0].occurred_at >= r.data[1].occurred_at).toBe(true); // newest first

    const paged = await getAudit({ entity_type: "unit", entity_id: "u_audit1", page: 1, page_size: 1 });
    expect(paged.data).toHaveLength(1);
    expect(paged.total).toBe(2);
  });
});
