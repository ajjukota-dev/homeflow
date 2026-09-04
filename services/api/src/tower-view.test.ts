import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "./db";
import { controlTower, actIntervention } from "./tower-view";

beforeAll(async () => {
  await initDb();
});

describe("actIntervention (management/spec.md H11 — Act)", () => {
  it("sets status acted and stamps acted_at, leaving acted_by null until Cognito", async () => {
    const tower = await controlTower("p_eastcrest");
    const id = tower.interventions[0].id;
    const acted = await actIntervention(id);
    expect(acted.status).toBe("acted");
    expect(acted.acted_at).not.toBeNull();
    expect(acted.acted_by).toBeNull();
  });

  it("is idempotent: a second Act returns the same acted_at and writes nothing new", async () => {
    const tower = await controlTower("p_eastcrest");
    const id = tower.interventions[1].id;
    const first = await actIntervention(id);
    expect(first.acted_at).toBeTruthy();
    const before = await db.query<{ count: string }>(
      `SELECT count(*) FROM intervention WHERE status = 'acted'`
    );
    const second = await actIntervention(id);
    const after = await db.query<{ count: string }>(
      `SELECT count(*) FROM intervention WHERE status = 'acted'`
    );
    expect(second.acted_at).toEqual(first.acted_at);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("throws not_found for an unknown intervention id", async () => {
    await expect(actIntervention("does-not-exist")).rejects.toThrow("not_found");
  });

  it("carries acted_at into the tower response so the UI can show when", async () => {
    const before = await controlTower("p_eastcrest");
    const id = before.interventions[2].id;
    await actIntervention(id);
    const row = (await controlTower("p_eastcrest")).interventions.find((i) => i.id === id)!;
    expect(row.status).toBe("acted");
    expect(row.acted_at).toBeTruthy();
  });
});
