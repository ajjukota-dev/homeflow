import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { appendEvent, withTx } from "./append";

// Rule 1 (02): "ctx.events.append(e) runs in the same DB transaction as the mutation;
// a failed append fails the mutation." Also: event is append-only (Data §).

beforeAll(async () => {
  await initDb();
});

describe("event log — transactional append (02 rule 1)", () => {
  it("commits the mutation and the event together", async () => {
    await withTx(undefined, async (tx) => {
      await tx.query(`INSERT INTO project (id, code, name) VALUES ('p_evt1','EVT1','Evt Test')`);
      await appendEvent(tx, { type: "unit.created", entity_type: "project", entity_id: "p_evt1", project_id: "p_evt1" });
    });
    const p = await db.query(`SELECT id FROM project WHERE id = 'p_evt1'`);
    const e = await db.query(`SELECT id FROM event WHERE entity_id = 'p_evt1'`);
    expect(p.rows.length).toBe(1);
    expect(e.rows.length).toBe(1);
  });

  it("rolls back the mutation when the append fails", async () => {
    await expect(
      withTx(undefined, async (tx) => {
        await tx.query(`INSERT INTO project (id, code, name) VALUES ('p_evt2','EVT2','Evt Test 2')`);
        // Unregistered type — FK violation on event_type(name) forces append to fail,
        // proving the mutation and the append share one transaction.
        await appendEvent(tx, { type: "not_a_registered_type", entity_type: "project", entity_id: "p_evt2" });
      })
    ).rejects.toThrow();
    const p = await db.query(`SELECT id FROM project WHERE id = 'p_evt2'`);
    expect(p.rows.length).toBe(0);
  });

  it("is append-only — UPDATE and DELETE both throw", async () => {
    await withTx(undefined, async (tx) => {
      await appendEvent(tx, { type: "unit.created", entity_type: "unit", entity_id: "u_immutable" });
    });
    const row = await db.query<{ id: string }>(`SELECT id FROM event WHERE entity_id = 'u_immutable'`);
    await expect(db.query(`UPDATE event SET type = 'booking.created' WHERE id = $1`, [row.rows[0].id])).rejects.toThrow();
    await expect(db.query(`DELETE FROM event WHERE id = $1`, [row.rows[0].id])).rejects.toThrow();
  });
});
