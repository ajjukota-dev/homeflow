import { describe, it, expect } from "vitest";
import { deriveStatus, computeStageSchedule, deriveStageEdges, type DeriveStatusInput } from "./engine";
import type { CalendarRow } from "./calendar";

const MON_FRI: CalendarRow = { working_days: [1, 2, 3, 4, 5], holidays: [] };
const DAY_MS = 24 * 60 * 60 * 1000;
const D0 = new Date("2026-09-10T00:00:00Z").getTime(); // Thursday

function iso(offsetMs: number): string {
  return new Date(D0 + offsetMs).toISOString();
}

const BASE = { dueSoonLeadDays: 2, atRisk: false } as const;

// Rule 6 status-derivation table — 12 cases, in the rule's own priority order
// (COMPLETED > OVERDUE > DUE_SOON > AT_RISK > ON_TRACK).
const CASES: [string, DeriveStatusInput, ReturnType<typeof deriveStatus>][] = [
  ["stopped + ON_TIME → COMPLETED_ON_TIME", { ...BASE, now: iso(0), dueAt: iso(0), stoppedAt: iso(-DAY_MS), outcome: "ON_TIME" }, "COMPLETED_ON_TIME"],
  ["stopped + LATE → COMPLETED_LATE", { ...BASE, now: iso(0), dueAt: iso(0), stoppedAt: iso(DAY_MS), outcome: "LATE" }, "COMPLETED_LATE"],
  ["stopped always wins even if overdue-looking", { ...BASE, now: iso(10 * DAY_MS), dueAt: iso(0), stoppedAt: iso(DAY_MS), outcome: "ON_TIME" }, "COMPLETED_ON_TIME"],
  ["no due_at, not at risk → ON_TRACK", { ...BASE, now: iso(0), dueAt: null, stoppedAt: null, outcome: null, atRisk: false }, "ON_TRACK"],
  ["no due_at, at risk → AT_RISK", { ...BASE, now: iso(0), dueAt: null, stoppedAt: null, outcome: null, atRisk: true }, "AT_RISK"],
  ["now 1ms past due → OVERDUE", { ...BASE, now: iso(1), dueAt: iso(0), stoppedAt: null, outcome: null }, "OVERDUE"],
  ["now far past due → OVERDUE (beats at-risk)", { ...BASE, now: iso(5 * DAY_MS), dueAt: iso(0), stoppedAt: null, outcome: null, atRisk: true }, "OVERDUE"],
  ["now exactly at due → DUE_SOON (not yet strictly overdue)", { ...BASE, now: iso(0), dueAt: iso(0), stoppedAt: null, outcome: null }, "DUE_SOON"],
  ["now inside the due-soon lead window → DUE_SOON", { ...BASE, now: iso(-1 * DAY_MS), dueAt: iso(0), stoppedAt: null, outcome: null }, "DUE_SOON"],
  ["now exactly at the due-soon threshold boundary → DUE_SOON (inclusive)", { ...BASE, now: iso(-2 * DAY_MS), dueAt: iso(0), stoppedAt: null, outcome: null }, "DUE_SOON"],
  ["now just before the due-soon threshold, at risk → AT_RISK", { ...BASE, now: iso(-2 * DAY_MS - 1), dueAt: iso(0), stoppedAt: null, outcome: null, atRisk: true }, "AT_RISK"],
  ["now well before due, not at risk → ON_TRACK", { ...BASE, now: iso(-10 * DAY_MS), dueAt: iso(0), stoppedAt: null, outcome: null, atRisk: false }, "ON_TRACK"],
];

describe("journey/engine: deriveStatus (rule 6, 12-case table)", () => {
  it.each(CASES)("%s", (_label, input, expected) => {
    expect(deriveStatus(input)).toBe(expected);
  });
});

describe("journey/engine: computeStageSchedule (rules 2 + 4)", () => {
  it("a chain schedules sequentially", () => {
    const windows = computeStageSchedule(
      [{ code: "A", planned_duration_days: 2 }, { code: "B", planned_duration_days: 3 }],
      [{ from: "A", to: "B", lag_days: 0 }],
      "2026-09-07", // Monday
      MON_FRI
    );
    expect(windows.get("A")).toEqual({ start: "2026-09-07", end: "2026-09-09" });
    expect(windows.get("B")).toEqual({ start: "2026-09-09", end: "2026-09-14" });
  });

  it("parallel streams with no edge between them both start on the journey start date", () => {
    const windows = computeStageSchedule(
      [{ code: "LEGAL", planned_duration_days: 5 }, { code: "FINANCE", planned_duration_days: 3 }],
      [],
      "2026-09-07",
      MON_FRI
    );
    expect(windows.get("LEGAL")!.start).toBe("2026-09-07");
    expect(windows.get("FINANCE")!.start).toBe("2026-09-07");
  });

  it("a stage with two predecessors starts after the later of the two finishes", () => {
    const windows = computeStageSchedule(
      [
        { code: "A", planned_duration_days: 1 },
        { code: "B", planned_duration_days: 4 },
        { code: "C", planned_duration_days: 1 },
      ],
      [
        { from: "A", to: "C", lag_days: 0 },
        { from: "B", to: "C", lag_days: 0 },
      ],
      "2026-09-07",
      MON_FRI
    );
    // A ends 09-08, B ends 09-11 (Fri) — C must wait for the later of the two.
    expect(windows.get("C")!.start).toBe(windows.get("B")!.end);
  });

  it("lag_days delays the successor beyond the predecessor's own end date", () => {
    const windows = computeStageSchedule(
      [{ code: "A", planned_duration_days: 1 }, { code: "B", planned_duration_days: 1 }],
      [{ from: "A", to: "B", lag_days: 2 }],
      "2026-09-07",
      MON_FRI
    );
    const aEnd = windows.get("A")!.end;
    expect(windows.get("B")!.start > aEnd).toBe(true);
  });

  it("deriveStageEdges rolls task-level dependencies up to stage-level, dropping same-stage edges", () => {
    const taskStageCode = new Map([
      ["T1", "BOOKING"], ["T2", "SALES_CRM_HANDOVER"], ["T3", "DOCS_KYC"], ["T5", "AGREEMENT"],
    ]);
    const edges = deriveStageEdges(taskStageCode, [
      { from_task_code: "T1", to_task_code: "T2", lag_days: 0 }, // cross-stage
      { from_task_code: "T3", to_task_code: "T5", lag_days: 1 },
      { from_task_code: "T2", to_task_code: "T3", lag_days: 0 },
    ]);
    expect(edges).toEqual(
      expect.arrayContaining([
        { from: "BOOKING", to: "SALES_CRM_HANDOVER", lag_days: 0 },
        { from: "DOCS_KYC", to: "AGREEMENT", lag_days: 1 },
        { from: "SALES_CRM_HANDOVER", to: "DOCS_KYC", lag_days: 0 },
      ])
    );
    expect(edges).toHaveLength(3);
  });

  it("deriveStageEdges drops a same-stage edge and keeps the longer lag on a duplicate pair", () => {
    const taskStageCode = new Map([["T3", "DOCS_KYC"], ["T4", "DOCS_KYC"], ["T5", "AGREEMENT"], ["T6", "AGREEMENT"]]);
    const edges = deriveStageEdges(taskStageCode, [
      { from_task_code: "T3", to_task_code: "T4", lag_days: 0 }, // same stage — dropped
      { from_task_code: "T3", to_task_code: "T5", lag_days: 1 },
      { from_task_code: "T4", to_task_code: "T6", lag_days: 3 }, // same pair, longer lag
    ]);
    expect(edges).toEqual([{ from: "DOCS_KYC", to: "AGREEMENT", lag_days: 3 }]);
  });

  it("throws on a cyclic stage graph", () => {
    expect(() =>
      computeStageSchedule(
        [{ code: "A", planned_duration_days: 1 }, { code: "B", planned_duration_days: 1 }],
        [{ from: "A", to: "B", lag_days: 0 }, { from: "B", to: "A", lag_days: 0 }],
        "2026-09-07",
        MON_FRI
      )
    ).toThrow(/cyclic/);
  });
});
