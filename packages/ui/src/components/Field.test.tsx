import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field } from "./Field";

describe("Field", () => {
  it("associates the label with the control", () => {
    render(<Field label="Mobile number" />);
    expect(screen.getByLabelText("Mobile number")).toBeInTheDocument();
  });

  it("describes the control with its hint", () => {
    render(<Field label="Mobile number" hint="The number on your booking." />);
    expect(screen.getByLabelText("Mobile number")).toHaveAccessibleDescription("The number on your booking.");
  });

  it("announces a server field error and marks the control invalid", () => {
    render(<Field label="Amount" error="Receipt cannot exceed the remaining balance." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Receipt cannot exceed the remaining balance.");
    expect(screen.getByLabelText("Amount")).toHaveAttribute("aria-invalid", "true");
  });
});
