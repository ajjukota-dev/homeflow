import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("renders a real button element with its label", () => {
    render(<Button>Record receipt</Button>);
    expect(screen.getByRole("button", { name: "Record receipt" })).toBeInTheDocument();
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Cancel</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("marks itself busy and refuses clicks while loading", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Saving
      </Button>,
    );
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button, { pointerEventsCheck: 0 });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("carries the variant class so the token styles apply", () => {
    render(<Button variant="secondary">Return</Button>);
    expect(screen.getByRole("button").className).toContain("hf-btn--secondary");
  });
});
