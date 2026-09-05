import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TAB_REGISTRY, tabsForRoles } from "./registry";

// 25-policy-studio.md §Acceptance: "p26-27 §21 list: every bullet maps to a tab (checklist test
// in this spec's test file asserts the tab registry contains each)." Parses the spec's own
// ## Tabs line rather than hand-duplicating the ~56-item list a second time here — a future edit
// to the spec's Tabs line will make this test start failing instead of silently drifting.

// services/api/src/studio/registry.test.ts -> src -> api -> services -> homeflow (repo root)
const repoRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));
const specPath = join(repoRoot, "docs", "specs", "25-policy-studio.md");

function parseSpecTabs(): { spec: number; label: string }[] {
  const text = readFileSync(specPath, "utf8");
  const tabsLine = text.split("\n").find((l) => l.includes(" · ") && /^\d\d? /.test(l.trim()))!;
  const groups = tabsLine.split(" · ");
  const out: { spec: number; label: string }[] = [];
  for (const group of groups) {
    const m = group.trim().match(/^(\d+)\s+(.*)$/);
    if (!m) continue;
    const spec = Number(m[1]);
    for (const label of m[2].replace(/\.$/, "").split(", ")) out.push({ spec, label: label.trim() });
  }
  return out;
}

describe("studio/registry: tab coverage (25-policy-studio.md §Tabs)", () => {
  it("every bullet from the spec's own Tabs line is present in TAB_REGISTRY", () => {
    const specTabs = parseSpecTabs();
    expect(specTabs.length).toBeGreaterThan(40); // sanity: the parser actually found the real list
    const registered = new Set(TAB_REGISTRY.map((t) => `${t.owner_spec}:${t.label}`));
    const missing = specTabs.filter((t) => !registered.has(`${t.spec}:${t.label}`)).map((t) => `${t.spec} ${t.label}`);
    expect(missing).toEqual([]);
  });

  it("TAB_REGISTRY has no entries beyond what the spec lists (no invented tabs)", () => {
    const specTabs = new Set(parseSpecTabs().map((t) => `${t.spec}:${t.label}`));
    const extra = TAB_REGISTRY.filter((t) => !specTabs.has(`${t.owner_spec}:${t.label}`)).map((t) => t.key);
    expect(extra).toEqual([]);
  });
});

describe("studio/registry: tabsForRoles (rule 3)", () => {
  it("a non-staff role (e.g. bare CUSTOMER) sees no tabs", () => {
    expect(tabsForRoles(["CUSTOMER"])).toEqual([]);
  });

  it("a department role can edit only its own named tabs, not another department's", () => {
    const legal = tabsForRoles(["LEGAL"]);
    const templates = legal.find((t) => t.key === "22.templates")!;
    const paymentPlans = legal.find((t) => t.key === "19.payment_plans")!;
    expect(templates.can_edit).toBe(true);
    expect(paymentPlans.can_edit).toBe(false); // ACCOUNTS-owned, per rule 3
  });

  it("SUPER_ADMIN can edit every tab (rule 3: edits everything)", () => {
    const rows = tabsForRoles(["SUPER_ADMIN"]);
    expect(rows.every((t) => t.can_edit)).toBe(true);
  });

  it("a staff role with read-only access to every tab still sees the list, just can't edit", () => {
    const site = tabsForRoles(["SITE"]);
    expect(site.length).toBe(TAB_REGISTRY.length);
    const templates = site.find((t) => t.key === "22.templates")!;
    expect(templates.can_edit).toBe(false);
  });
});
