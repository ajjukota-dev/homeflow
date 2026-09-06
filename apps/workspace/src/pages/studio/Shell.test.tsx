import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Studio } from "./Shell";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Studio shell", () => {
  it("renders exactly one h1 for a generic-table tab (CLAUDE.md: one h1 per page)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/studio/tabs") {
          return Promise.resolve(
            jsonResponse(200, {
              data: [{ key: "31.risk_rules", label: "Risk rules", owner_spec: 31, built: true, edit_roles: ["MANAGEMENT"], can_edit: true }],
            })
          );
        }
        return Promise.resolve(jsonResponse(200, { data: [] }));
      })
    );
    render(<Studio />);
    await waitFor(() => expect(screen.getAllByText("Risk rules").length).toBeGreaterThan(0));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("switching between tables with different primaryKey columns doesn't render stale rows against the new def (regression: key={tableName} on GenericTableEditor in Shell.tsx)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/studio/tabs") {
          return Promise.resolve(
            jsonResponse(200, {
              data: [
                { key: "12.escalation_rules", label: "Escalation rules", owner_spec: 12, built: true, edit_roles: ["MANAGEMENT"], can_edit: true },
                { key: "24.filter_thresholds", label: "Filter thresholds", owner_spec: 24, built: true, edit_roles: ["MANAGEMENT"], can_edit: true },
              ],
            })
          );
        }
        // escalation_rule's primaryKey is rule_key; sales_policy's primaryKey is id — the exact
        // mismatched-PK pair that reproduced the pre-fix "duplicate key" warning live.
        if (url === "/api/studio/escalation_rule") {
          return Promise.resolve(jsonResponse(200, { data: [{ rule_key: "r1" }, { rule_key: "r2" }] }));
        }
        if (url === "/api/studio/sales_policy") {
          return Promise.resolve(jsonResponse(200, { data: [{ id: "p1" }, { id: "p2" }] }));
        }
        return Promise.resolve(jsonResponse(200, { data: [] }));
      })
    );

    render(<Studio />);
    await waitFor(() => expect(screen.getAllByText("escalation_rule", { exact: false }).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByText("Filter thresholds"));
    await waitFor(() => expect(screen.getAllByText("sales_policy", { exact: false }).length).toBeGreaterThan(0));

    const keyWarnings = consoleError.mock.calls.filter((call) => /same key|unique "key"/i.test(String(call[0])));
    expect(keyWarnings).toHaveLength(0);
    consoleError.mockRestore();
  });
});
