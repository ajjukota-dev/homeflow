import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusChip } from "./StatusChip";
import { GateChip, GATE_STATES } from "./GateChip";

describe("StatusChip", () => {
  it("always shows a text label, never colour alone", () => {
    const { container } = render(<StatusChip tone="risk" label="Overdue" />);
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("GateChip", () => {
  it.each(GATE_STATES)("renders %s with a human label and an icon", (state) => {
    const { container } = render(<GateChip state={state} />);
    const chip = screen.getByTestId("status-chip");
    expect(chip.textContent?.trim()).not.toBe("");
    expect(chip.textContent).not.toBe(state);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("explains HARD_CLOSED in the tooltip rather than leaking the enum", () => {
    render(<GateChip state="HARD_CLOSED" />);
    expect(screen.getByTestId("status-chip")).toHaveAttribute("title", "Changes are physically impossible.");
  });
});
