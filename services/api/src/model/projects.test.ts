import { describe, it, expect, beforeAll } from "vitest";
import { initDb } from "../db";
import { createProject } from "../projects";
import { getProjectMaster, updateProject, defaultPortfolioId } from "./projects";

beforeAll(async () => {
  await initDb();
});

describe("project master (04 §Data, §API PATCH /projects/:id)", () => {
  it("getProjectMaster returns every §Data column, including location", async () => {
    const p = await createProject({ code: "master1", name: "Master Test" });
    const master = await getProjectMaster(p.id);
    expect(master).toMatchObject({
      id: p.id,
      code: "MASTER1",
      name: "Master Test",
      product_type: "VILLA",
      status: "ACTIVE",
    });
    expect(master!.portfolio_id).toBe(await defaultPortfolioId());
    expect(master!.location).toBeNull();
  });

  it("updateProject patches whitelisted fields and returns the updated row", async () => {
    const p = await createProject({ code: "master2", name: "Master Test 2" });
    const updated = await updateProject(p.id, {
      product_type: "MIXED",
      status: "PLANNING",
      legal_entity: "Pranava Meadows LLP",
      location: "Chennai",
    });
    expect(updated.product_type).toBe("MIXED");
    expect(updated.status).toBe("PLANNING");
    expect(updated.legal_entity).toBe("Pranava Meadows LLP");
    expect(updated.location).toBe("Chennai");
  });

  it("ignores unknown/non-patchable fields (code and id are immutable via this endpoint)", async () => {
    const p = await createProject({ code: "master3", name: "Master Test 3" });
    // @ts-expect-error — id/code are deliberately not in PATCHABLE
    const updated = await updateProject(p.id, { id: "hacked", code: "HACKED" });
    expect(updated.id).toBe(p.id);
    expect(updated.code).toBe("MASTER3");
  });

  it("rejects an unknown project id", async () => {
    await expect(updateProject("does_not_exist", { status: "CLOSED" })).rejects.toThrow();
  });
});
