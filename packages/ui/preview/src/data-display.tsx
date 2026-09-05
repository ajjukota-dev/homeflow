import * as React from "react";
import { createRoot } from "react-dom/client";
import { PreviewPage, Section } from "./Shell";
import {
  Table,
  StatusChip,
  Badge,
  ScoreCard,
  KeyValue,
  Avatar,
  Skeleton,
  formatInr,
  type JourneyStatus,
} from "../../src";

const FIRST_NAMES = [
  "Priyanka", "Rohan", "Fatima", "Arjun", "Ananya", "Vikram", "Meera", "Suresh",
  "Kavya", "Aditya", "Lakshmi", "Rajesh", "Divya", "Karthik", "Sneha", "Manoj",
];
const LAST_NAMES = [
  "Deshmukh", "Mehta", "Sheikh", "Subramaniam", "Iyer", "Nair", "Reddy", "Gupta",
  "Krishnan", "Bhatt", "Rao", "Kapoor", "Menon", "Pillai", "Verma", "Chowdhury",
];
const STATUSES: JourneyStatus[] = ["ON_TRACK", "DUE_SOON", "AT_RISK", "OVERDUE", "COMPLETED_ON_TIME"];

function makeUnits(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    const last = LAST_NAMES[(i * 3 + 1) % LAST_NAMES.length];
    const tower = String.fromCharCode(65 + (i % 4));
    const floor = 1 + (i % 18);
    return {
      id: `UNT-${String(100000 + i)}`,
      unitCode: `${tower}-${String(floor).padStart(2, "0")}${String(1 + (i % 8)).padStart(2, "0")}`,
      customer: `${first} ${last}`,
      status: STATUSES[i % STATUSES.length],
      outstanding: ((i * 137) % 4500000) + 25000,
    };
  });
}

const UNITS_200 = makeUnits(200);
const UNITS_SMALL = UNITS_200.slice(0, 6);

function DataDisplay() {
  const [loading, setLoading] = React.useState(false);
  return (
    <PreviewPage title="Data display">
      <Section title="StatusChip — journey statuses">
        <div className="flex flex-wrap gap-2">
          {(["ON_TRACK", "DUE_SOON", "AT_RISK", "OVERDUE", "COMPLETED_ON_TIME", "COMPLETED_LATE"] as const).map(
            (s) => (
              <StatusChip key={s} status={s} />
            ),
          )}
        </div>
      </Section>
      <Section title="StatusChip — gate states">
        <div className="flex flex-wrap gap-2">
          {(["OPEN", "CLOSING", "CONDITIONAL", "EXCEPTION_ONLY", "HARD_CLOSED"] as const).map((s) => (
            <StatusChip key={s} status={s} />
          ))}
        </div>
      </Section>
      <Section title="Badge">
        <div className="flex flex-wrap gap-2">
          <Badge>4 open</Badge>
          <Badge tone="accent">New</Badge>
        </div>
      </Section>
      <Section title="ScoreCard" description="Value + trend + 3 drivers + confidence + actions — never a bare hero number.">
        <div className="max-w-xs">
          <ScoreCard
            label="Collections readiness"
            value="82"
            trend={{ direction: "up", label: "+4 vs last week" }}
            confidence="high"
            drivers={[
              { label: "3 demands overdue > 30 days", impact: "negative" },
              { label: "Receipts posted same-day (avg)", impact: "positive" },
              { label: "No disputed demands this cycle", impact: "positive" },
            ]}
            actions={[{ label: "View demands", onClick: () => {} }]}
          />
        </div>
      </Section>
      <Section title="KeyValue">
        <KeyValue
          className="max-w-md"
          items={[
            { key: "Unit", value: "A-1204" },
            { key: "Customer", value: "Priyanka Deshmukh" },
            { key: "Agreement value", value: `₹${formatInr(12345678)}` },
            { key: "Outstanding", value: `₹${formatInr(2495678)}` },
          ]}
        />
      </Section>
      <Section title="Avatar">
        <div className="flex items-center gap-3">
          <Avatar name="Priyanka Deshmukh" size="sm" />
          <Avatar name="Rohan Mehta" />
        </div>
      </Section>
      <Section title="Skeleton">
        <div className="flex max-w-sm flex-col gap-2">
          <Skeleton variant="text" />
          <Skeleton variant="text" className="w-2/3" />
          <Skeleton variant="block" />
        </div>
      </Section>
      <Section
        title="Table — small, sortable"
        description="Sticky header, compact density, empty/loading/error states."
      >
        <div className="mb-3 flex gap-2">
          <button
            type="button"
            onClick={() => setLoading((l) => !l)}
            className="rounded-control border border-line bg-surface px-3 py-1.5 text-ws-sm text-fg hover:bg-surface-raised"
          >
            Toggle loading
          </button>
        </div>
        <Table
          loading={loading}
          columns={[
            { key: "unitCode", header: "Unit", render: (r) => r.unitCode, sortable: true },
            { key: "customer", header: "Customer", render: (r) => r.customer, sortable: true },
            { key: "status", header: "Status", render: (r) => <StatusChip status={r.status} /> },
            {
              key: "outstanding",
              header: "Outstanding",
              render: (r) => <span className="hf-tnum">₹{formatInr(r.outstanding)}</span>,
            },
          ]}
          rows={UNITS_SMALL}
          getRowId={(r) => r.id}
        />
      </Section>
      <Section title="Table — empty">
        <Table
          columns={[{ key: "unitCode", header: "Unit", render: (r: (typeof UNITS_SMALL)[number]) => r.unitCode }]}
          rows={[]}
          getRowId={(r: (typeof UNITS_SMALL)[number]) => r.id}
          emptyMessage="No units match this filter yet."
          emptyAction={{ label: "Clear filters", onClick: () => {} }}
        />
      </Section>
      <Section title="Table — error">
        <Table
          columns={[{ key: "unitCode", header: "Unit", render: (r: (typeof UNITS_SMALL)[number]) => r.unitCode }]}
          rows={[]}
          getRowId={(r: (typeof UNITS_SMALL)[number]) => r.id}
          error={{ message: "Couldn't load units — the collections service didn't respond.", onRetry: () => {} }}
        />
      </Section>
      <Section title="Table — 200 rows, virtualised">
        <Table
          columns={[
            { key: "unitCode", header: "Unit", render: (r) => r.unitCode, sortable: true, width: 112 },
            { key: "customer", header: "Customer", render: (r) => r.customer },
            { key: "status", header: "Status", render: (r) => <StatusChip status={r.status} /> },
            {
              key: "outstanding",
              header: "Outstanding",
              render: (r) => <span className="hf-tnum">₹{formatInr(r.outstanding)}</span>,
            },
          ]}
          rows={UNITS_200}
          getRowId={(r) => r.id}
        />
      </Section>
    </PreviewPage>
  );
}

createRoot(document.getElementById("root")!).render(<DataDisplay />);
