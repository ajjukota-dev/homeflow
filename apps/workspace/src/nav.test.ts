import { describe, it, expect } from "vitest";
import { defaultViewFor, NAV, ROLE_HOME } from "./nav";

// Pins the SUPER_ADMIN regression from 11-my-day-ranking.md's Build note: a role
// with no explicit ROLE_HOME entry falls through to visible[0], which silently
// changes when NAV's array order changes (as it did when "myday" was inserted first).
describe("defaultViewFor", () => {
  it("lands SUPER_ADMIN on site regardless of NAV array order", () => {
    const visible = NAV.map((n) => n.id);
    expect(defaultViewFor(["SUPER_ADMIN"], visible)).toBe("site");
  });

  // The previous version of this test used the full unfiltered NAV.map(n => n.id) list for
  // `visible`, which every role can see by construction — expect(visible).toContain(home) could
  // never fail. Real coverage requires the visible set a role would ACTUALLY have (its own
  // NAV.roles membership), so a role landing on a tab it can't see is caught.
  it("every role's configured home is a view that role can actually see", () => {
    for (const [role, home] of Object.entries(ROLE_HOME)) {
      const visibleForRole = NAV.filter((n) => n.roles.includes(role)).map((n) => n.id);
      expect(defaultViewFor([role], visibleForRole)).toBe(home);
    }
  });

  it("a role with no ROLE_HOME entry falls through to the first visible tab, not silently to some other role's home", () => {
    expect(defaultViewFor(["NOT_A_REAL_ROLE"], ["accounts", "legal"])).toBe("accounts");
  });
});
