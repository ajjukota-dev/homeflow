import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { AreaScreen } from "../components/AreaScreen";
import { portalApi, SERVICE_REQUEST_CATEGORIES, SERVICE_REQUEST_SEVERITIES, type ServiceRequestCategory, type ServiceRequestSeverity } from "../portal-api";
import { useArea } from "../lib/useArea";
import { formatINR } from "../lib/utils";

const SERVICE_CATEGORY_LABEL: Record<ServiceRequestCategory, string> = {
  STRUCTURAL: "Structural", WATERPROOFING: "Waterproofing", ELECTRICAL: "Electrical", PLUMBING: "Plumbing", FITTINGS: "Fittings & fixtures",
};
const SERVICE_STATUS_TONE: Record<string, string> = {
  "Received": "text-fg-muted", "Being reviewed": "text-due", "Assigned": "text-due", "In progress": "text-due",
  "Fix complete — please confirm": "text-accent", "Closed": "text-ontrack", "Not approved": "text-overdue",
};

/** 26-customer-portal.md rule 7: raise customisation (customer-visible categories only), see
 *  feasibility outcome, quotation accept, snags raised at walkthrough.
 *  30-post-handover.md rules 2/3: raise a service/warranty request, see coverage once triaged,
 *  accept an out-of-coverage quote, confirm a completed fix. */
export function Requests({ onBack }: { onBack: () => void }) {
  const { data, loading, error, reload } = useArea(useCallback(() => portalApi.requests(), []));
  const { data: invites, reload: reloadInvites } = useArea(useCallback(() => portalApi.advocacyInvites(), []));
  const [raising, setRaising] = useState(false);
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const [raisingService, setRaisingService] = useState(false);
  const [svcCategory, setSvcCategory] = useState<ServiceRequestCategory | "">("");
  const [svcSeverity, setSvcSeverity] = useState<ServiceRequestSeverity>("MINOR");
  const [svcTrade, setSvcTrade] = useState("");
  const [svcDescription, setSvcDescription] = useState("");
  const [svcBusy, setSvcBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  async function raise() {
    if (!category || !title.trim()) return;
    setBusy(true);
    try {
      await portalApi.raiseRequest({ primary_category_code: category, title: title.trim() });
      setRaising(false);
      setTitle("");
      setCategory("");
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function acceptQuote(id: string) {
    await portalApi.acceptQuotation(id);
    reload();
  }

  async function raiseService() {
    if (!svcCategory || !svcTrade.trim() || !svcDescription.trim()) return;
    setSvcBusy(true);
    try {
      await portalApi.raiseServiceRequest({ category: svcCategory, trade: svcTrade.trim(), severity: svcSeverity, description: svcDescription.trim() });
      setRaisingService(false);
      setSvcCategory("");
      setSvcTrade("");
      setSvcDescription("");
      setSvcSeverity("MINOR");
      reload();
    } finally {
      setSvcBusy(false);
    }
  }

  async function verifyService(id: string) {
    setActionBusy(id);
    try {
      await portalApi.verifyServiceRequest(id);
      reload();
    } finally {
      setActionBusy(null);
    }
  }

  async function acceptServiceQuote(id: string) {
    setActionBusy(id);
    try {
      await portalApi.acceptServiceRequestQuote(id);
      reload();
    } finally {
      setActionBusy(null);
    }
  }

  async function respondInvite(id: string, status: "RECEIVED" | "DECLINED") {
    setActionBusy(id);
    try {
      await portalApi.respondAdvocacy(id, { status });
      reloadInvites();
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <AreaScreen title="Requests" onBack={onBack} loading={loading} error={error} onRetry={reload}>
      {data && (
        <div className="flex flex-col gap-4">
          {!raising ? (
            <button
              onClick={() => setRaising(true)}
              disabled={data.raisable_categories.length === 0}
              className="flex items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2.5 text-body font-medium text-accent-fg disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Raise a customisation request
            </button>
          ) : (
            <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
              <label className="text-footnote font-medium text-fg-muted">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-body">
                <option value="">Choose a category</option>
                {data.raisable_categories.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
              <label className="mt-3 block text-footnote font-medium text-fg-muted">What would you like?</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-body" />
              <div className="mt-3 flex gap-2">
                <button onClick={() => setRaising(false)} className="flex-1 rounded-full border border-line px-4 py-2 text-body font-medium">
                  Cancel
                </button>
                <button
                  onClick={raise}
                  disabled={!category || !title.trim() || busy}
                  className="flex-1 rounded-full bg-accent px-4 py-2 text-body font-medium text-accent-fg disabled:opacity-50"
                >
                  {busy ? "Sending…" : "Submit"}
                </button>
              </div>
            </div>
          )}

          {!raisingService ? (
            <button
              onClick={() => setRaisingService(true)}
              className="flex items-center justify-center gap-1.5 rounded-full border border-line px-4 py-2.5 text-body font-medium text-fg"
            >
              <Plus className="h-4 w-4" /> Raise a service or warranty request
            </button>
          ) : (
            <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
              <label className="text-footnote font-medium text-fg-muted">Category</label>
              <select
                value={svcCategory}
                onChange={(e) => setSvcCategory(e.target.value as ServiceRequestCategory)}
                className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-body"
              >
                <option value="">Choose a category</option>
                {SERVICE_REQUEST_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{SERVICE_CATEGORY_LABEL[c]}</option>
                ))}
              </select>
              <label className="mt-3 block text-footnote font-medium text-fg-muted">Trade (e.g. carpentry, electrical)</label>
              <input value={svcTrade} onChange={(e) => setSvcTrade(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-body" />
              <label className="mt-3 block text-footnote font-medium text-fg-muted">How urgent?</label>
              <select value={svcSeverity} onChange={(e) => setSvcSeverity(e.target.value as ServiceRequestSeverity)} className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-body">
                <option value="MINOR">Can wait</option>
                <option value="MAJOR">Affecting daily use</option>
                <option value="CRITICAL">Urgent — safety or major damage</option>
              </select>
              <label className="mt-3 block text-footnote font-medium text-fg-muted">Describe the issue</label>
              <textarea value={svcDescription} onChange={(e) => setSvcDescription(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-body" />
              <div className="mt-3 flex gap-2">
                <button onClick={() => setRaisingService(false)} className="flex-1 rounded-full border border-line px-4 py-2 text-body font-medium">
                  Cancel
                </button>
                <button
                  onClick={raiseService}
                  disabled={!svcCategory || !svcTrade.trim() || !svcDescription.trim() || svcBusy}
                  className="flex-1 rounded-full bg-accent px-4 py-2 text-body font-medium text-accent-fg disabled:opacity-50"
                >
                  {svcBusy ? "Sending…" : "Submit"}
                </button>
              </div>
            </div>
          )}

          <section>
            <h2 className="mb-3 text-title font-semibold">Your requests</h2>
            {data.requests.length === 0 ? (
              <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
                <p className="text-footnote text-fg-muted">Nothing raised yet.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
                {data.requests.map((r) => (
                  <div key={r.id} className="border-b border-line px-3 py-3 last:border-b-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-body font-semibold">{r.title}</p>
                        <p className="text-footnote text-fg-muted">
                          {r.code} · {r.status}
                        </p>
                      </div>
                    </div>
                    {r.quotation && (
                      <div className="mt-2 rounded-lg bg-surface-2 p-3">
                        <p className="text-footnote">
                          Quotation: <span className="font-semibold">{formatINR(r.quotation.total_inr)}</span> · {r.quotation.status}
                        </p>
                        {r.quotation.status === "ISSUED" && (
                          <button onClick={() => acceptQuote(r.quotation!.id)} className="mt-2 rounded-full bg-accent px-3 py-1.5 text-footnote font-medium text-accent-fg">
                            Accept quotation
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-title font-semibold">Service & warranty requests</h2>
            {data.service_requests.length === 0 ? (
              <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
                <p className="text-footnote text-fg-muted">Nothing raised yet.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
                {data.service_requests.map((s) => (
                  <div key={s.id} className="border-b border-line px-3 py-3 last:border-b-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-body font-semibold">{SERVICE_CATEGORY_LABEL[s.category as ServiceRequestCategory] ?? s.category}</p>
                        <p className="text-footnote text-fg-muted">{s.description}</p>
                      </div>
                      <span className={`shrink-0 text-footnote font-medium ${SERVICE_STATUS_TONE[s.status] ?? "text-fg-muted"}`}>{s.status}</span>
                    </div>
                    {s.coverage !== null && (
                      <p className="mt-1 text-caption text-fg-subtle">{s.coverage ? "Covered under warranty" : "Outside warranty coverage"}</p>
                    )}
                    {s.quote_inr !== null && !s.quote_accepted && (
                      <div className="mt-2 rounded-lg bg-surface-2 p-3">
                        <p className="text-footnote">
                          Quotation: <span className="font-semibold">{formatINR(s.quote_inr)}</span>
                        </p>
                        <button
                          onClick={() => acceptServiceQuote(s.id)}
                          disabled={actionBusy === s.id}
                          className="mt-2 rounded-full bg-accent px-3 py-1.5 text-footnote font-medium text-accent-fg disabled:opacity-50"
                        >
                          {actionBusy === s.id ? "Accepting…" : "Accept quotation"}
                        </button>
                      </div>
                    )}
                    {s.needs_verification && (
                      <div className="mt-2 rounded-lg bg-surface-2 p-3">
                        <p className="text-footnote">Marked fixed — please confirm it's resolved.</p>
                        <button
                          onClick={() => verifyService(s.id)}
                          disabled={actionBusy === s.id}
                          className="mt-2 rounded-full bg-accent px-3 py-1.5 text-footnote font-medium text-accent-fg disabled:opacity-50"
                        >
                          {actionBusy === s.id ? "Confirming…" : "Confirm it's fixed"}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {data.snags.length > 0 && (
            <section>
              <h2 className="mb-3 text-title font-semibold">Snags from your walkthrough</h2>
              <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
                {data.snags.map((s, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-line px-3 py-3 last:border-b-0">
                    <div>
                      <p className="text-body font-semibold">{s.location}</p>
                      <p className="text-footnote text-fg-muted">{s.trade}</p>
                    </div>
                    <span className={`text-footnote font-medium ${s.status === "Fixed" ? "text-ontrack" : "text-due"}`}>{s.status}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {invites && invites.filter((i) => i.status === "INVITED").length > 0 && (
            <section>
              <h2 className="mb-3 text-title font-semibold">Refer a friend</h2>
              <div className="rounded-xl border border-line bg-surface p-2 shadow-card">
                {invites.filter((i) => i.status === "INVITED").map((i) => (
                  <div key={i.id} className="flex items-center justify-between gap-2 border-b border-line px-3 py-3 last:border-b-0">
                    <p className="text-footnote text-fg-muted">
                      {i.kind === "REFERRAL" ? "You're invited to refer a friend." : "You're invited to share a testimonial."}
                    </p>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => respondInvite(i.id, "DECLINED")}
                        disabled={actionBusy === i.id}
                        className="rounded-full border border-line px-3 py-1.5 text-footnote font-medium disabled:opacity-50"
                      >
                        Not now
                      </button>
                      <button
                        onClick={() => respondInvite(i.id, "RECEIVED")}
                        disabled={actionBusy === i.id}
                        className="rounded-full bg-accent px-3 py-1.5 text-footnote font-medium text-accent-fg disabled:opacity-50"
                      >
                        {actionBusy === i.id ? "…" : "I'm in"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </AreaScreen>
  );
}
