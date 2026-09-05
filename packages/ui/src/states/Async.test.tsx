import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Async } from "./Async";
import { ApiError } from "../api/client";

const list = (data: string[] | undefined, extra = {}) => (
  <Async data={data} empty={{ title: "No units here yet" }} {...extra}>
    {(rows) => (
      <ul>
        {rows.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    )}
  </Async>
);

describe("<Async> — the four required states", () => {
  it("loading: shows a skeleton, not a spinner", () => {
    render(list(undefined));
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
  });

  it("empty: shows the real copy for the list", () => {
    render(list([]));
    expect(screen.getByRole("heading", { name: "No units here yet" })).toBeInTheDocument();
  });

  it("error: shows the code, the request id and a retry", async () => {
    const onRetry = vi.fn();
    render(
      list(undefined, {
        error: new ApiError({ code: "GATE_FAILED", message: "Slab is poured.", status: 409, request_id: "req-7" }),
        onRetry,
      }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Slab is poured.");
    expect(screen.getByText(/GATE_FAILED · request req-7/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("data: renders the children with the payload", () => {
    render(list(["A-1204", "B-0703"]));
    expect(screen.getByText("A-1204")).toBeInTheDocument();
    expect(screen.getByText("B-0703")).toBeInTheDocument();
  });
});
