import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
});
