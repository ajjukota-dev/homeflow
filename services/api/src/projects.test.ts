import { describe, it, expect, beforeAll } from "vitest";
import { initDb } from "./db";
import { listProjects, createProject, createUnit } from "./projects";
import { listUnits } from "./handlers";
import { superAdminCtx } from "./authz/test-helpers";

beforeAll(async () => {
  await initDb();
});

describe("project-site master data creation", () => {
  it("seed project exists", async () => {
    const ps = await listProjects(superAdminCtx);
    expect(ps.some((p) => p.code === "EASTCREST")).toBe(true);
  });

  it("creates a project", async () => {
    const p = await createProject({ code: "westpark", name: "West Park" }, superAdminCtx);
    expect(p.code).toBe("WESTPARK");
    const ps = await listProjects(superAdminCtx);
    expect(ps.some((x) => x.id === p.id)).toBe(true);
  });

  it("creates a unit that immediately has derived gates + is available", async () => {
    const p = await createProject({ code: "northvale", name: "North Vale" }, superAdminCtx);
    const u = await createUnit(p.id, { unit_number: "N-101", unit_type: "2BHK", facing: "East" }, superAdminCtx);
    expect(u?.unit_number).toBe("N-101");
    expect(u?.sale_status).toBe("available");
    // brand-new unit: all components not_started → everything OPEN, score 100
    expect(u?.score).toBe(100);
    // project-scoped listing returns only that project's unit
    const list = await listUnits(p.id, superAdminCtx);
    expect(list.length).toBe(1);
    expect(list[0].unit_number).toBe("N-101");
  });

  it("rejects a unit with no number", async () => {
    const p = await createProject({ code: "eastvale", name: "East Vale" }, superAdminCtx);
    await expect(createUnit(p.id, { unit_number: "", unit_type: "3BHK", facing: "East" }, superAdminCtx)).rejects.toThrow();
  });
});
