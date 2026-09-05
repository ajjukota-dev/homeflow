import { useEffect, useState } from "react";
import { ArrowLeft, Check } from "lucide-react";
import { api, type Booking, type DocItem, type Unit } from "../api";
import { Card, CardBody } from "../ui/Card";
import { Button } from "../ui/Button";
import { ScoreDial } from "../ui/ScoreDial";
import { cn } from "../lib/utils";

const inputCls =
  "w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-body outline-none focus:border-accent";

/** Mirrors the server completeness gate (bookings.ts) for live UX feedback. */
function assess(name: string, phone: string, pan: string, consideration: number, docs: DocItem[]) {
  const checks = [
    { key: "Applicant name", ok: !!name.trim() },
    { key: "Phone", ok: /^\d{10}$/.test(phone) },
    { key: "PAN", ok: /^[A-Z]{5}\d{4}[A-Z]$/i.test(pan) },
    { key: "Consideration", ok: consideration > 0 },
    ...docs.map((d) => ({ key: d.type, ok: d.received })),
  ];
  const present = checks.filter((c) => c.ok).length;
  return {
    score: docs.length ? Math.round((present / checks.length) * 100) : 0,
    missing: checks.filter((c) => !c.ok).map((c) => c.key),
  };
}

export function BookingWizard({
  unit,
  onCancel,
  onBooked,
}: {
  unit: Unit;
  onCancel: () => void;
  onBooked: (b: Booking) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pan, setPan] = useState("");
  const [consideration, setConsideration] = useState("");
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.bookingConfig().then((c) => setDocs(c.mandatory_docs.map((type) => ({ type, received: false }))));
  }, []);

  const considerationNum = Number(consideration.replace(/[^\d]/g, "")) || 0;
  const { score, missing } = assess(name, phone, pan, considerationNum, docs);
  const ready = score === 100;

  function toggleDoc(type: string) {
    setDocs((d) => d.map((x) => (x.type === type ? { ...x, received: !x.received } : x)));
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const b = await api.book(unit.id, {
        applicant: { display_name: name, phone, pan },
        total_consideration: considerationNum,
        docs,
      });
      onBooked(b);
    } catch (e) {
      const err = e as Error & { missing?: string[] };
      setError(err.missing ? `Missing: ${err.missing.join(", ")}` : "Could not create booking.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <button
        onClick={onCancel}
        className="mb-4 inline-flex items-center gap-1.5 text-subhead font-medium text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" /> Back to inventory
      </button>
      <header className="mb-6">
        <h1 className="text-large font-bold">Book Villa {unit.unit_number}</h1>
        <p className="mt-1 text-subhead text-fg-muted">
          {unit.unit_type} · {unit.facing} facing. Complete the file — CRM can only accept a 100% file.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardBody className="flex flex-col gap-4">
            <label className="block">
              <span className="mb-1.5 block text-subhead text-fg-muted">Primary applicant</span>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Anita Sharma" />
            </label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-subhead text-fg-muted">Phone</span>
                <input
                  className={inputCls}
                  value={phone}
                  inputMode="numeric"
                  maxLength={10}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="10-digit mobile"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-subhead text-fg-muted">PAN</span>
                <input
                  className={cn(inputCls, "uppercase")}
                  value={pan}
                  maxLength={10}
                  onChange={(e) => setPan(e.target.value.toUpperCase())}
                  placeholder="ABCDE1234F"
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-subhead text-fg-muted">Total consideration (₹)</span>
              <input
                className={inputCls}
                value={consideration}
                inputMode="numeric"
                onChange={(e) => setConsideration(e.target.value)}
                placeholder="e.g. 1,25,00,000"
              />
            </label>

            <div>
              <span className="mb-2 block text-subhead text-fg-muted">Mandatory documents</span>
              <div className="flex flex-col gap-2">
                {docs.map((d) => (
                  <button
                    key={d.type}
                    onClick={() => toggleDoc(d.type)}
                    role="checkbox"
                    aria-checked={d.received}
                    className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-left hover:bg-surface-2"
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-md border",
                        d.received ? "border-transparent bg-accent text-accent-fg" : "border-line"
                      )}
                    >
                      {d.received && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span className="text-body">{d.type}</span>
                    <span className="ml-auto text-footnote text-fg-subtle">
                      {d.received ? "Received" : "Required"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card className="h-fit">
          <CardBody>
            <h2 className="text-title3 font-semibold">Completeness</h2>
            <p className="mt-1 text-footnote text-fg-muted">The CRM handoff gate (H2).</p>
            <div className="my-4 flex justify-center">
              <ScoreDial value={score} size={96} label={ready ? "Ready to submit" : "Incomplete"} />
            </div>
            {missing.length > 0 ? (
              <ul className="mb-4 flex flex-col gap-1.5">
                {missing.map((m) => (
                  <li key={m} className="text-footnote text-fg-muted">
                    • {m}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-4 text-footnote text-ontrack">All requirements met.</p>
            )}
            {error && <p className="mb-3 text-footnote text-overdue">{error}</p>}
            <Button className="w-full" disabled={!ready || submitting} onClick={submit}>
              {submitting ? "Submitting…" : "Submit to CRM"}
            </Button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
