import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertNoDenylistedKeys, redactDenylisted } from "./denylist";

// Bug 5: exact-name blocking let vendor_contact and internal_notes_v2 through.
// The customer Passport screen and every portal payload must drop both.

describe("customer field denylist — close names", () => {
  it("fails if vendor_contact reaches a customer-visible payload", () => {
    const leaked = {
      equipment: [{ name: "Borewell pump", vendor_contact: "9848012345", internal_notes_v2: "do not show" }],
    };
    expect(() => assertNoDenylistedKeys(leaked)).toThrow(/vendor_contact/);
    const clean = redactDenylisted(leaked);
    expect(JSON.stringify(clean)).not.toContain("vendor_contact");
    expect(JSON.stringify(clean)).not.toContain("internal_notes_v2");
    expect(clean.equipment[0]?.name).toBe("Borewell pump");
  });

  it("blocks a close name of an exact denylist entry", () => {
    expect(() => assertNoDenylistedKeys({ internal_notes_v2: "secret" })).toThrow(/internal_notes_v2/);
    expect(() => assertNoDenylistedKeys({ forecast_slip_days: 4 })).toThrow(/forecast_slip_days/);
  });

  it("the portal Passport screen does not render vendor_contact", () => {
    const passport = readFileSync(
      new URL("../../../../apps/my-pranava-home/src/pages/Passport.tsx", import.meta.url),
      "utf8"
    );
    const client = readFileSync(
      new URL("../../../../apps/my-pranava-home/src/portal-api.ts", import.meta.url),
      "utf8"
    );
    expect(passport).not.toContain("vendor_contact");
    expect(client).not.toContain("vendor_contact");
  });
});
