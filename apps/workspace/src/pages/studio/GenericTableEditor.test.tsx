import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { GenericTableEditor } from "./GenericTableEditor";
import type { GenericTableDef } from "./registry";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const DEF: GenericTableDef = { primaryKey: "code", columns: ["label", "counts_against_sla"] };

describe("GenericTableEditor", () => {
  it("shows a loading skeleton, then real rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(200, { data: [{ code: "CUSTOMER_DELAY", label: "Customer delay", counts_against_sla: false }] })))
    );
    render(<GenericTableEditor table="delay_reason" label="Delay reasons" def={DEF} canEdit={false} />);
    await waitFor(() => expect(screen.getByText("CUSTOMER_DELAY")).toBeInTheDocument());
    expect(screen.getByText("Customer delay")).toBeInTheDocument();
    // canEdit=false: no Edit/Add row controls rendered (rule 3 read-only)
    expect(screen.queryByRole("button", { name: "Add row" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("shows an empty state with an add-row action when the table has no rows and the user can edit", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(200, { data: [] }))));
    render(<GenericTableEditor table="delay_reason" label="Delay reasons" def={DEF} canEdit />);
    await waitFor(() => expect(screen.getByText(/No delay_reason rows yet/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Add the first row" })).toBeInTheDocument();
  });

  it("shows a retryable error state when the table fails to load", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(500, { errors: [{ code: "internal" }] }))));
    render(<GenericTableEditor table="delay_reason" label="Delay reasons" def={DEF} canEdit={false} />);
    await waitFor(() => expect(screen.getByText(/Couldn't load delay_reason/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
