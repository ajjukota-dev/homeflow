import { describe, it, expect, beforeAll } from "vitest";
import { initDb } from "./db";
import { listUnits, getUnit, setProgress } from "./handlers";

// Integration tests against a fresh in-memory PGlite DB (real SQL).
beforeAll(async () => {
  await initDb();
});

describe("handlers (integration)", () => {
  it("lists seeded units with derived gates + score", async () => {
    const units = await listUnits();
    expect(units.length).toBeGreaterThanOrEqual(3);
    const v101 = units.find((u) => u.unit_number === "V101");
    expect(v101?.score).toBe(100); // early-stage villa: everything open
    const v104 = units.find((u) => u.unit_number === "V104");
    expect(v104?.score).toBeLessThan(25); // near-complete: mostly closed
  });

  it("setProgress re-derives gates — the H1 loop", async () => {
    const before = await getUnit("u_v101");
    expect(before?.gates.find((g) => g.category_code === "electrical")?.state).toBe("OPEN");

    const after = await setProgress("u_v101", "mep_first_fix", "in_progress");
    expect(after?.gates.find((g) => g.category_code === "electrical")?.state).toBe("CLOSING");

    await setProgress("u_v101", "mep_first_fix", "not_started"); // reset
  });

  it("rejects an invalid progress state", async () => {
    await expect(
      // @ts-expect-error — deliberately invalid
      setProgress("u_v101", "mep_first_fix", "banana")
    ).rejects.toThrow();
  });
});
