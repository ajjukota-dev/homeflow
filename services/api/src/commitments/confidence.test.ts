import { describe, it, expect } from "vitest";
import { computeConfidence } from "./confidence";

describe("computeConfidence (rule 5)", () => {
  it("scores 100 with no drivers when nothing is wrong", () => {
    const r = computeConfidence({ dependencies: [], ownerOpenCount: 0, departmentFulfilledCount: 0, departmentBreachedCount: 0 });
    expect(r.score).toBe(100);
    expect(r.drivers).toEqual([]);
  });

  it("penalizes a blocked dependency more than a merely overdue one", () => {
    const blocked = computeConfidence({ dependencies: [{ type: "ACTION", resolved: { blocked: true, overdue: false, satisfied: false } }], ownerOpenCount: 0, departmentFulfilledCount: 0, departmentBreachedCount: 0 });
    const overdue = computeConfidence({ dependencies: [{ type: "ACTION", resolved: { blocked: false, overdue: true, satisfied: false } }], ownerOpenCount: 0, departmentFulfilledCount: 0, departmentBreachedCount: 0 });
    expect(blocked.score).toBeLessThan(overdue.score);
    expect(overdue.score).toBeLessThan(100);
  });

  it("ignores a satisfied dependency and a CHANGE_REQUEST/PROGRESS dependency with no resolved facts (neutral, not guessed)", () => {
    const r = computeConfidence({
      dependencies: [
        { type: "ACTION", resolved: { blocked: false, overdue: false, satisfied: true } },
        { type: "CHANGE_REQUEST" },
        { type: "PROGRESS" },
      ],
      ownerOpenCount: 0,
      departmentFulfilledCount: 0,
      departmentBreachedCount: 0,
    });
    expect(r.score).toBe(100);
    expect(r.drivers).toEqual([]);
  });

  it("penalizes owner overload beyond the free allowance, capped at -30", () => {
    const light = computeConfidence({ dependencies: [], ownerOpenCount: 2, departmentFulfilledCount: 0, departmentBreachedCount: 0 });
    const heavy = computeConfidence({ dependencies: [], ownerOpenCount: 20, departmentFulfilledCount: 0, departmentBreachedCount: 0 });
    expect(light.score).toBe(100);
    expect(heavy.score).toBe(70);
  });

  it("reflects a poor departmental fulfilment history but not a perfect one", () => {
    const poor = computeConfidence({ dependencies: [], ownerOpenCount: 0, departmentFulfilledCount: 0, departmentBreachedCount: 4 });
    const perfect = computeConfidence({ dependencies: [], ownerOpenCount: 0, departmentFulfilledCount: 4, departmentBreachedCount: 0 });
    expect(poor.score).toBe(80);
    expect(perfect.score).toBe(100);
  });

  it("never drops below 0", () => {
    const manyBlocked = Array.from({ length: 6 }, () => ({ type: "ACTION" as const, resolved: { blocked: true, overdue: false, satisfied: false } }));
    const r = computeConfidence({
      dependencies: manyBlocked,
      ownerOpenCount: 50,
      departmentFulfilledCount: 0,
      departmentBreachedCount: 10,
    });
    expect(r.score).toBe(0);
  });
});
