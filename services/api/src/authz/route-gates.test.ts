import { describe, it, expect, beforeAll } from "vitest";
import { initDb } from "../db";
import { ctxWithRoles, customerCtx, superAdminCtx } from "./test-helpers";
import { setProgress, listUnits } from "../handlers";
import { postReceipt } from "../demands-receipts";
import { executeDocument, generateDocument } from "../legal-docs";
import { verifyComponent } from "../qa";
import { createProject } from "../projects";
import { confirmBooking } from "../model/bookings";
import { getCustomerHome } from "../customer";

// R0.6: authorize()/requireRole() calls throw before any row lookup, so a wrong-role
// call can use a placeholder id and still prove rejection — the check that matters is
// "does this reject the wrong actor", not "does it find real data" (authorize.test.ts
// already covers the pure effectiveLevel math; these exercise the handlers themselves).
describe("R0.6 — wired authorize()/requireRole() actually reject the wrong actor", () => {
  beforeAll(async () => {
    await initDb();
  });

  it("SALES has no WRITE on collections — postReceipt rejects", async () => {
    await expect(
      postReceipt("does-not-matter", { amount: 100 }, ctxWithRoles(["SALES"]))
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("ACCOUNTS has WRITE on collections — postReceipt gets past the gate (fails later, on the real lookup)", async () => {
    await expect(
      postReceipt("does-not-matter", { amount: 100 }, ctxWithRoles(["ACCOUNTS"]))
    ).rejects.not.toMatchObject({ code: "forbidden" });
  });

  it("SALES has no WRITE on unit_readiness — setProgress rejects", async () => {
    await expect(
      setProgress("does-not-matter", "structure", "complete", ctxWithRoles(["SALES"]))
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("SALES has no WRITE on unit_readiness — verifyComponent rejects", async () => {
    await expect(
      verifyComponent("does-not-matter", "structure", "note", ctxWithRoles(["SALES"]))
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("SITE has no WRITE on legal — generateDocument rejects", async () => {
    await expect(
      generateDocument("does-not-matter", "AOS", ctxWithRoles(["SITE"]))
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("SITE has no WRITE on legal — executeDocument rejects", async () => {
    await expect(executeDocument("does-not-matter", ctxWithRoles(["SITE"]))).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("master data: ACCOUNTS isn't a site-setup role — createProject rejects", async () => {
    await expect(createProject({ code: "x", name: "x" }, ctxWithRoles(["ACCOUNTS"]))).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("master data: SITE is a site-setup role — createProject gets past the gate", async () => {
    await expect(createProject({ code: "rgtest1", name: "Gate Test" }, ctxWithRoles(["SITE"]))).resolves.toMatchObject(
      { code: "RGTEST1" }
    );
  });

  it("master data: LEGAL isn't a booking-admin role — confirmBooking rejects", async () => {
    await expect(confirmBooking("does-not-matter", ctxWithRoles(["LEGAL"]))).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("master data: CUSTOMER isn't staff — listUnits (sales inventory) rejects", async () => {
    await expect(listUnits(undefined, customerCtx())).rejects.toMatchObject({ code: "forbidden" });
  });

  it("SALES is staff — listUnits (sales inventory) gets past the gate", async () => {
    await expect(listUnits(undefined, ctxWithRoles(["SALES"]))).resolves.toBeInstanceOf(Array);
  });

  it("SITE has NONE on customer_journey — getCustomerHome (portal preview) rejects", async () => {
    await expect(getCustomerHome("does-not-matter", ctxWithRoles(["SITE"]))).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("SUPER_ADMIN passes every gate above", async () => {
    await expect(listUnits(undefined, superAdminCtx)).resolves.toBeInstanceOf(Array);
  });
});
