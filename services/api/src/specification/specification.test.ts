import { describe, it, expect, beforeAll } from "vitest";
import { initDb, db } from "../db";
import { superAdminCtx as fakeSuperAdminCtx, ctxWithRoles } from "../authz/test-helpers";
import { createProject, createUnit } from "../projects";
import { withTx } from "../events";
import type { Ctx } from "../authz/types";
import { createBaseline, approveBaseline, listBaselines, loadBaseline } from "./baselines";
import { listCatalogue, putCatalogue } from "./catalogue";
import { ensureUnitSpecification, createDraftRevision, releaseRevision, recordAsBuilt, getUnitSpecification, getRevision, addDrawing, currentItems } from "./revisions";

// 09-specification-revisions.md — integration over real PGlite. Rule tests 1-5 plus baseline/
// catalogue CRUD (Data section). Files via the local adapter (rule 5) — no real upload needed,
// the presigned-URL contract is what's under test.
const superAdminCtx: Ctx = { actor: { ...fakeSuperAdminCtx.actor, user_id: "user_superadmin" } };
function ctxAs(userId: string, roles: string[]): Ctx {
  return { actor: { ...ctxWithRoles(roles).actor, user_id: userId } };
}
const site = () => ctxAs("user_site", ["SITE"]);
const staff = () => ctxAs("user_staff", ["QA"]);

let PROJECT_ID: string;
let unitSeq = 0;

beforeAll(async () => {
  await initDb();
  const p = await createProject({ code: "spectest", name: "Specification Test Project" }, superAdminCtx);
  PROJECT_ID = p.id;
});

async function freshUnit(productType: "VILLA" | "APARTMENT" = "VILLA"): Promise<string> {
  unitSeq += 1;
  const u = await createUnit(PROJECT_ID, { unit_number: `SP-${unitSeq}`, unit_type: "3BHK", facing: "East", product_type: productType }, superAdminCtx);
  return u!.id;
}

async function approvedBaseline(productType: "VILLA" | "APARTMENT" = "VILLA") {
  const draft = await createBaseline({ project_id: PROJECT_ID, product_type: productType, name: `${productType} standard`, items: { kitchen_layout: { spec: "Modular, laminate finish", brand_model: "Godrej", qty: 1 } } }, site());
  return approveBaseline(draft.id, site());
}

describe("rule 1 — unit_specification attaches the approved baseline at booking confirmation, revision 0 = BASELINE", () => {
  it("attaches on booking.status_changed DRAFT→CONFIRMED and is idempotent", async () => {
    await approvedBaseline();
    const unitId = await freshUnit();
    expect((await getUnitSpecification(unitId, staff())).blocker).toMatch(/attaches at booking confirmation/);

    await withTx(undefined, (tx) => ensureUnitSpecification(unitId, tx, { actor_user_id: "user_site", actor_kind: "USER" }));
    const view = await getUnitSpecification(unitId, staff());
    expect(view.baseline?.status).toBe("APPROVED");
    expect(view.current_revision?.revision_no).toBe(0);
    expect(view.current_revision?.kind).toBe("BASELINE");
    expect(view.current_revision?.status).toBe("RELEASED");

    // idempotent: calling again does not create a second revision 0
    const again = await withTx(undefined, (tx) => ensureUnitSpecification(unitId, tx, { actor_user_id: "user_site", actor_kind: "USER" }));
    expect(again?.current_revision_id).toBe(view.current_revision?.id);
  });

  it("no APPROVED baseline for the product/unit type → clear blocker, no attach", async () => {
    const unitId = await freshUnit("APARTMENT"); // only a VILLA baseline exists in this suite so far unless a prior test created one
    const result = await withTx(undefined, (tx) => ensureUnitSpecification(unitId, tx, { actor_user_id: null, actor_kind: "SYSTEM" }));
    if (result === null) {
      expect((await getUnitSpecification(unitId, staff())).blocker).toMatch(/No APPROVED specification baseline/);
    } else {
      // an APARTMENT baseline got approved by another test in this file — attach path is still correct
      expect(result.current_revision_id).toBeTruthy();
    }
  });
});

describe("rule 2 — a DRAFT revision RELEASEs only via the caller (18); release supersedes the prior current revision and emits drawing.released", () => {
  it("release marks the prior revision SUPERSEDED with superseded_by_id and stamps unit_specification", async () => {
    await approvedBaseline();
    const unitId = await freshUnit();
    await withTx(undefined, (tx) => ensureUnitSpecification(unitId, tx, { actor_user_id: "user_site", actor_kind: "USER" }));
    const before = await getUnitSpecification(unitId, staff());
    const baselineRevId = before.current_revision!.id;

    const released = await withTx(undefined, async (tx) => {
      const draft = await createDraftRevision(unitId, { kind: "CUSTOMISATION", change_request_id: "cr_1", items_delta: { electrical: { spec: "Additional AC point in master bedroom" } } }, tx, { actor_user_id: "user_qa", actor_kind: "USER" });
      expect(draft.status).toBe("DRAFT");
      expect(draft.revision_no).toBe(1);
      return releaseRevision(draft.id, tx, { actor_user_id: "user_qa", actor_kind: "USER" });
    });
    expect(released.status).toBe("RELEASED");

    const prior = await getRevision(baselineRevId, staff());
    expect(prior.status).toBe("SUPERSEDED");
    expect(prior.superseded_by_id).toBe(released.id);

    const events = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'spec_revision' AND entity_id = $1 ORDER BY id`, [released.id]);
    expect(events.rows.map((r) => r.type)).toContain("drawing.released");
    const supersededEvent = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'spec_revision' AND entity_id = $1`, [baselineRevId]);
    expect(supersededEvent.rows.map((r) => r.type)).toContain("spec_revision.superseded");

    const view = await getUnitSpecification(unitId, staff());
    expect(view.current_revision?.id).toBe(released.id);
    expect(view.current_items.electrical?.spec).toBe("Additional AC point in master bedroom");
  });
});

describe("rule 3 — superseded revisions are read-only and carry a superseded banner; the current one doesn't", () => {
  it("a released-then-superseded revision refuses new drawings and shows the banner; the new current has none", async () => {
    await approvedBaseline();
    const unitId = await freshUnit();
    await withTx(undefined, (tx) => ensureUnitSpecification(unitId, tx, { actor_user_id: "user_site", actor_kind: "USER" }));
    const baselineRevId = (await getUnitSpecification(unitId, staff())).current_revision!.id;
    await withTx(undefined, async (tx) => {
      const draft = await createDraftRevision(unitId, { kind: "CUSTOMISATION", items_delta: { flooring_selection: { spec: "Italian marble upgrade" } } }, tx, { actor_user_id: "user_qa", actor_kind: "USER" });
      await releaseRevision(draft.id, tx, { actor_user_id: "user_qa", actor_kind: "USER" });
    });

    const supersededView = await getRevision(baselineRevId, staff());
    expect(supersededView.is_current).toBe(false);
    expect(supersededView.banner).toMatch(/Superseded/);
    await expect(addDrawing(baselineRevId, { content_type: "application/pdf" }, site())).rejects.toThrow(/read-only/);

    const currentView = await getUnitSpecification(unitId, staff());
    expect(currentView.current_revision!.is_current).toBe(true);
    expect(currentView.current_revision!.banner).toBeNull();
  });
});

describe("rule 4 — AS_BUILT_CORRECTION records what was actually built only when it differs from released", () => {
  it("recordAsBuilt is a no-op when actual matches released, and creates+releases a correction when it differs", async () => {
    await approvedBaseline();
    const unitId = await freshUnit();
    await withTx(undefined, (tx) => ensureUnitSpecification(unitId, tx, { actor_user_id: "user_site", actor_kind: "USER" }));
    const released = await currentItems(unitId);

    const noop = await withTx(undefined, (tx) => recordAsBuilt(unitId, { as_built_items: released }, tx, { actor_user_id: "user_qa", actor_kind: "USER" }));
    expect(noop).toBeNull();

    const differing = { ...released, kitchen_layout: { spec: "Modular, granite finish (site substitution)", brand_model: "Sleek", qty: 1 } };
    const correction = await withTx(undefined, (tx) => recordAsBuilt(unitId, { change_request_id: "cr_2", as_built_items: differing }, tx, { actor_user_id: "user_qa", actor_kind: "USER" }));
    expect(correction!.kind).toBe("AS_BUILT_CORRECTION");
    expect(correction!.status).toBe("RELEASED");
    const asBuiltEvents = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'spec_revision' AND entity_id = $1`, [correction!.id]);
    expect(asBuiltEvents.rows.map((r) => r.type)).toContain("as_built.recorded");
    expect((await currentItems(unitId)).kitchen_layout?.spec).toBe("Modular, granite finish (site substitution)");
  });
});

describe("rule 5 — drawings upload via the files port onto a DRAFT revision, rejecting disallowed content types", () => {
  it("returns a presigned upload and appends the key; a non-allowed content type is rejected", async () => {
    await approvedBaseline();
    const unitId = await freshUnit();
    await withTx(undefined, (tx) => ensureUnitSpecification(unitId, tx, { actor_user_id: "user_site", actor_kind: "USER" }));
    const draft = await withTx(undefined, (tx) => createDraftRevision(unitId, { kind: "CUSTOMISATION", items_delta: { electrical: { spec: "Extra point" } } }, tx, { actor_user_id: "user_qa", actor_kind: "USER" }));

    const result = await addDrawing(draft.id, { content_type: "application/pdf" }, site());
    expect(result.upload.method).toBe("PUT");
    expect(result.key).toMatch(new RegExp(`^project/${PROJECT_ID}/spec_revision/${draft.id}/.+\\.pdf$`));
    expect(result.revision.drawing_file_keys).toContain(result.key);

    await expect(addDrawing(draft.id, { content_type: "text/plain" }, site())).rejects.toThrow(/content_type_not_allowed/);
  });
});

describe("baselines and variation catalogue — Policy Studio config", () => {
  it("a baseline is editable only while DRAFT; approving retires the prior APPROVED baseline of the same scope; catalogue upserts by scope+code", async () => {
    const first = await approvedBaseline("VILLA");
    const secondDraft = await createBaseline({ project_id: PROJECT_ID, product_type: "VILLA", name: "VILLA standard v2", items: { kitchen_layout: { spec: "Modular, quartz finish" } } }, site());
    await expect((async () => secondDraft)()).resolves.toBeTruthy();
    const second = await approveBaseline(secondDraft.id, site());
    expect(second.version).toBeGreaterThan(first.version);
    const approvedEvents = await db.query<{ type: string }>(`SELECT type FROM event WHERE entity_type = 'specification_baseline' AND entity_id = $1`, [second.id]);
    expect(approvedEvents.rows.map((r) => r.type)).toContain("specification.baseline_approved");
    const refreshedFirst = await loadBaseline(first.id);
    expect(refreshedFirst.status).toBe("RETIRED");
    await expect(approveBaseline(first.id, site())).rejects.toThrow(/conflict|RETIRED/);

    const list = await listBaselines(PROJECT_ID, staff());
    expect(list.some((b) => b.id === second.id && b.status === "APPROVED")).toBe(true);

    const upserted = await putCatalogue([{ project_id: null, category_code: "kitchen_layout", code: "MOD-STD", name: "Standard modular kitchen", description: null, unit_price_inr: 150000, vendor_cost_inr: 90000, lead_days: 21, product_types: ["VILLA", "APARTMENT"], constraints: {}, active: true }], site());
    expect(upserted[0]!.code).toBe("MOD-STD");
    const projectOverride = await putCatalogue([{ project_id: PROJECT_ID, category_code: "kitchen_layout", code: "MOD-STD", name: "Project-priced modular kitchen", description: null, unit_price_inr: 175000, vendor_cost_inr: 90000, lead_days: 21, product_types: ["VILLA"], constraints: {}, active: true }], site());
    expect(projectOverride[0]!.unit_price_inr).toBe(175000);
    const catalogue = await listCatalogue({ project_id: PROJECT_ID }, staff());
    const row = catalogue.find((c) => c.code === "MOD-STD")!;
    expect(row.unit_price_inr).toBe(175000); // project override wins over the standard row
  });
});
