import { describe, it, expect, beforeAll } from "vitest";
import { initDb } from "../db";
import { createProject } from "../projects";
import { createHierarchyNode, listHierarchy } from "./hierarchy";

beforeAll(async () => {
  await initDb();
});

describe("project_hierarchy_node (04 §Data, p36 §31.1)", () => {
  it("East Crest's seeded phase is visible", async () => {
    const nodes = await listHierarchy("p_eastcrest");
    expect(nodes.some((n) => n.code === "P1" && n.kind === "PHASE")).toBe(true);
  });

  it("creates a Tower under a Phase and lists both, parent-first", async () => {
    const p = await createProject({ code: "hier1", name: "Hierarchy Test" });
    const phase = await createHierarchyNode(p.id, { kind: "PHASE", code: "PH1", name: "Phase 1" });
    const tower = await createHierarchyNode(p.id, {
      kind: "TOWER",
      code: "T1",
      name: "Tower 1",
      parent_id: phase.id,
    });
    const nodes = await listHierarchy(p.id);
    expect(nodes.find((n) => n.id === phase.id)?.parent_id).toBeNull();
    expect(nodes.find((n) => n.id === tower.id)?.parent_id).toBe(phase.id);
  });

  it("rejects a parent from a different project", async () => {
    const p1 = await createProject({ code: "hier2", name: "Hierarchy Test 2" });
    const p2 = await createProject({ code: "hier3", name: "Hierarchy Test 3" });
    const phase = await createHierarchyNode(p1.id, { kind: "PHASE", code: "PH1", name: "Phase 1" });
    await expect(
      createHierarchyNode(p2.id, { kind: "TOWER", code: "T1", name: "Tower 1", parent_id: phase.id })
    ).rejects.toThrow();
  });

  it("rejects a node with no code or name", async () => {
    const p = await createProject({ code: "hier4", name: "Hierarchy Test 4" });
    await expect(createHierarchyNode(p.id, { kind: "PHASE", code: "", name: "" })).rejects.toThrow();
  });
});
