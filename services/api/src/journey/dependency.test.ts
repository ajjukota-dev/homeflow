import { describe, expect, it } from "vitest";
import { hasCycle } from "./dependency";

describe("journey/dependency: hasCycle", () => {
  it("no cycle in a simple chain", () => {
    expect(
      hasCycle([
        { from_task_code: "A", to_task_code: "B" },
        { from_task_code: "B", to_task_code: "C" },
      ])
    ).toBe(false);
  });

  it("no cycle with a diamond (A->B, A->C, B->D, C->D)", () => {
    expect(
      hasCycle([
        { from_task_code: "A", to_task_code: "B" },
        { from_task_code: "A", to_task_code: "C" },
        { from_task_code: "B", to_task_code: "D" },
        { from_task_code: "C", to_task_code: "D" },
      ])
    ).toBe(false);
  });

  it("detects a direct 2-node cycle", () => {
    expect(
      hasCycle([
        { from_task_code: "A", to_task_code: "B" },
        { from_task_code: "B", to_task_code: "A" },
      ])
    ).toBe(true);
  });

  it("detects a longer cycle (A->B->C->A)", () => {
    expect(
      hasCycle([
        { from_task_code: "A", to_task_code: "B" },
        { from_task_code: "B", to_task_code: "C" },
        { from_task_code: "C", to_task_code: "A" },
      ])
    ).toBe(true);
  });

  it("empty graph has no cycle", () => {
    expect(hasCycle([])).toBe(false);
  });

  it("self-loop is a cycle", () => {
    expect(hasCycle([{ from_task_code: "A", to_task_code: "A" }])).toBe(true);
  });
});
