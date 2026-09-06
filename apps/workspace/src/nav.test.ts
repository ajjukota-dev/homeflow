import { describe, it, expect } from "vitest";
import { defaultViewFor, NAV } from "./nav";

// Pins the SUPER_ADMIN regression from 11-my-day-ranking.md's Build note: a role
// with no explicit ROLE_HOME entry falls through to visible[0], which silently
// changes when NAV's array order changes (as it did when "myday" was inserted first).
describe("defaultViewFor", () => {
  it("lands SUPER_ADMIN on site regardless of NAV array order", () => {
    const visible = NAV.map((n) => n.id);
    expect(defaultViewFor(["SUPER_ADMIN"], visible)).toBe("site");
  });

  it("every role in NAV resolves to a view it can actually see", () => {
    const visible = NAV.map((n) => n.id);
    const roles = new Set(NAV.flatMap((n) => n.roles));
    for (const role of roles) {
      const home = defaultViewFor([role], visible);
      expect(visible).toContain(home);
    }
  });
});
