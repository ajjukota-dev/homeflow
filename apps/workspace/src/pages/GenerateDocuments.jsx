import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  FileSignature,
  FileText,
  KeyRound,
  Plus,
  Trash2,
  Printer,
  Download,
  Eye,
  CheckCircle2,
  Search,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import PageHeader from "@/components/PageHeader";
import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TEMPLATE_ICON = {
  sale_deed: FileSignature,
  agreement_of_sale: FileText,
  handover_document: KeyRound,
};

function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

function CustomerPicker({ value, onChange }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState("");
  const debounced = useDebounced(q, 300);
  const boxRef = useRef(null);

  useEffect(() => {
    let cancel = false;
    if (!debounced || debounced.trim().length < 1) {
      setResults([]);
      return;
    }
    setLoading(true);
    api
      .get("/customers", { params: {} })
      .then((r) => {
        const all = r.data || [];
        const needle = debounced.trim().toLowerCase();
        const filtered = all
          .filter(
            (c) =>
              (c.primary_name || "").toLowerCase().includes(needle) ||
              (c.email || "").toLowerCase().includes(needle) ||
              (c.phone || "").toLowerCase().includes(needle) ||
              (c.code || "").toLowerCase().includes(needle),
          )
          .slice(0, 15);
        if (!cancel) setResults(filtered);
      })
      .catch((e) => !cancel && apiErrorToast(e))
      .finally(() => !cancel && setLoading(false));
    return () => {
      cancel = true;
    };
  }, [debounced]);

  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const pick = (c) => {
    onChange(c.id);
    setLabel(`${c.code} · ${c.primary_name}`);
    setQ("");
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative">
      <Label className="text-sm font-medium">Customer</Label>
      <div className="relative mt-1.5">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={value ? label : q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            if (value) onChange("");
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search by name, email, phone or CUS-000xxx"
          className="pl-9"
          data-testid="doc-gen-customer-picker"
        />
      </div>
      {open && q && (
        <div className="absolute z-30 left-0 right-0 mt-1 rounded-lg border border-warm-100 bg-white shadow-xl max-h-72 overflow-y-auto">
          {loading && <div className="p-3 text-xs text-slate-500">Searching…</div>}
          {!loading && results.length === 0 && (
            <div className="p-3 text-sm text-slate-500">No matches.</div>
          )}
          {!loading &&
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pick(c)}
                className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-warm-50"
                data-testid={`doc-gen-customer-option-${c.code}`}
              >
                <span className="font-mono text-[11px] text-slate-500">{c.code}</span>
                <div className="min-w-0">
                  <div className="text-sm text-slate-900 truncate">{c.primary_name}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {[c.email, c.phone, c.city].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function BookingPicker({ customerId, value, onChange }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!customerId) {
      setBookings([]);
      onChange("");
      return;
    }
    let cancel = false;
    setLoading(true);
    api
      .get("/bookings", { params: { customer_id: customerId } })
      .then((r) => {
        if (cancel) return;
        const all = r.data || [];
        const cust = all.filter((b) => b.customer_id === customerId);
        setBookings(cust);
        if (cust.length === 1) onChange(cust[0].id);
      })
      .catch((e) => !cancel && apiErrorToast(e))
      .finally(() => !cancel && setLoading(false));
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  if (!customerId) return null;
  return (
    <div>
      <Label className="text-sm font-medium">Booking</Label>
      {loading ? (
        <div className="mt-1.5 text-xs text-slate-500 inline-flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading bookings…
        </div>
      ) : bookings.length === 0 ? (
        <div className="mt-1.5 text-sm text-red-700">
          This customer has no bookings — generate can't proceed.
        </div>
      ) : (
        <div className="mt-1.5 grid gap-2">
          {bookings.map((b) => (
            <label
              key={b.id}
              className={[
                "flex items-center gap-3 rounded-md border p-2.5 cursor-pointer",
                value === b.id ? "border-brand-500 bg-brand-50" : "border-warm-100 hover:bg-warm-50",
              ].join(" ")}
              data-testid={`doc-gen-booking-option-${b.code}`}
            >
              <input
                type="radio"
                name="booking"
                value={b.id}
                checked={value === b.id}
                onChange={() => onChange(b.id)}
                className="accent-brand-500"
                data-testid="doc-gen-booking-picker"
              />
              <div className="min-w-0 text-sm">
                <div className="font-medium text-slate-900">
                  {b.code}
                  <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${b.status === "Confirmed" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                    {b.status}
                  </span>
                </div>
                <div className="text-xs text-slate-500 truncate">
                  Unit {b._unit_code || b.unit_id?.slice(0, 8)} · Project {b._project_code || b.project_id?.slice(0, 8)}
                </div>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function ErrorText({ text, testId }) {
  if (!text) return null;
  return (
    <div className="text-xs text-red-700 mt-1" data-testid={testId}>
      {text}
    </div>
  );
}

export default function GenerateDocuments() {
  const { user } = useAuth();
  const roleCode = (user?.role?.code || "").toUpperCase();
  const isSA = !!user?.role?.is_super_admin;
  const authorised = isSA || ["MANAGEMENT", "CRM", "LEGAL"].includes(roleCode);

  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [signatoryName, setSignatoryName] = useState("");
  const [signatoryDesignation, setSignatoryDesignation] = useState("Authorised Signatory, Pranava Group");
  const [witnesses, setWitnesses] = useState([{ name: "", address: "" }, { name: "", address: "" }]);
  const [previewHtml, setPreviewHtml] = useState("");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null); // { attachmentId, category, customerId }
  const iframeRef = useRef(null);

  useEffect(() => {
    if (!authorised) return;
    api
      .get("/documents/generate/templates")
      .then((r) => setTemplates(r.data || []))
      .catch((e) => apiErrorToast(e));
  }, [authorised]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId),
    [templates, templateId],
  );

  const payload = useMemo(
    () => ({
      template_id: templateId,
      customer_id: customerId,
      booking_id: bookingId,
      signatory_name: signatoryName.trim(),
      signatory_designation: signatoryDesignation.trim(),
      witnesses: witnesses.filter((w) => w.name.trim()).map((w) => ({ name: w.name.trim(), address: (w.address || "").trim() || null })),
    }),
    [templateId, customerId, bookingId, signatoryName, signatoryDesignation, witnesses],
  );

  const validateLocal = () => {
    const e = {};
    if (!templateId) e.template_id = "Pick a template";
    if (!customerId) e.customer_id = "Pick a customer";
    if (!bookingId) e.booking_id = "Pick a booking";
    if (!signatoryName.trim()) e.signatory_name = "Signatory name required";
    if (!signatoryDesignation.trim()) e.signatory_designation = "Designation required";
    const w = witnesses.filter((x) => x.name.trim());
    if (w.length < 2) e.witnesses = "At least 2 witnesses required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const doPreview = async () => {
    if (!validateLocal()) return;
    setBusy(true);
    setSaved(null);
    try {
      const r = await api.post("/documents/generate/preview", payload, { responseType: "text" });
      setPreviewHtml(r.data);
      setErrors({});
      toast.success("Preview ready");
    } catch (err) {
      const raw = err?.response?.data;
      if (raw?.detail && typeof raw.detail === "object") setErrors(raw.detail);
      else apiErrorToast(err);
    } finally {
      setBusy(false);
    }
  };

  const doDownload = async () => {
    if (!validateLocal()) return;
    setBusy(true);
    try {
      const r = await api.post("/documents/generate/pdf", payload, { responseType: "blob" });
      // Save to Documents context returned via header
      const attachmentId = r.headers["x-attachment-id"] || r.headers["X-Attachment-Id"];
      const category = r.headers["x-attachment-category"] || selectedTemplate?.category || "";
      const blob = new Blob([r.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${selectedTemplate?.name?.replace(/\s+/g, "_") || "document"}_${bookingId.slice(0, 8)}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSaved({ attachmentId, category, customerId });
      setErrors({});
      toast.success("PDF downloaded and saved to Documents");
    } catch (err) {
      // Blob responses that were actually JSON errors need decoding
      const raw = err?.response?.data;
      if (raw instanceof Blob) {
        try {
          const text = await raw.text();
          const j = JSON.parse(text);
          if (j?.detail && typeof j.detail === "object") setErrors(j.detail);
          else toast.error(j?.detail || "Failed to generate PDF");
        } catch {
          apiErrorToast(err);
        }
      } else {
        apiErrorToast(err);
      }
    } finally {
      setBusy(false);
    }
  };

  const doPrint = () => {
    const w = iframeRef.current?.contentWindow;
    if (w) w.focus(), w.print();
  };

  const addWitness = () => setWitnesses((w) => [...w, { name: "", address: "" }]);
  const updateWitness = (i, patch) => setWitnesses((w) => w.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeWitness = (i) => setWitnesses((w) => (w.length <= 2 ? w : w.filter((_, idx) => idx !== i)));

  if (!authorised) {
    return (
      <div>
        <PageHeader
          title="Generate Documents"
          subtitle="Sale Deed / Agreement of Sale / Handover Document — templated draft PDFs"
        />
        <div className="mt-6 rounded-md border border-warm-100 bg-white p-6 text-sm text-slate-600">
          You do not have permission to generate documents. Legal, CRM, Management or Super Admin roles only.
        </div>
      </div>
    );
  }

  return (
    <div data-testid="doc-gen-page">
      <PageHeader
        title="Generate Documents"
        subtitle="Sale Deed · Agreement of Sale · Handover Document — templated PDF drafts with auto-save to the customer's Documents tab."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,45fr)_minmax(0,55fr)] gap-6 mt-6">
        {/* -------- Left: Form -------- */}
        <div className="space-y-6">
          {/* 1. Template */}
          <section className="rounded-md border border-warm-100 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-slate-600 font-semibold mb-2">
              1. Document Type
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {templates.map((t) => {
                const Icon = TEMPLATE_ICON[t.id] || FileText;
                const active = templateId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTemplateId(t.id)}
                    className={[
                      "rounded-md border p-3 text-left transition-colors",
                      active ? "border-brand-500 bg-brand-50" : "border-warm-100 hover:bg-warm-50",
                    ].join(" ")}
                    data-testid={`doc-gen-template-${t.id}`}
                  >
                    <Icon className={`h-5 w-5 mb-1.5 ${active ? "text-brand-600" : "text-slate-500"}`} />
                    <div className="text-sm font-semibold text-slate-900">{t.name}</div>
                    <div className="text-xs text-slate-500 mt-1 leading-snug">{t.description}</div>
                  </button>
                );
              })}
            </div>
            <ErrorText text={errors.template_id} testId="doc-gen-err-template" />
          </section>

          {/* 2. Customer + booking */}
          <section className="rounded-md border border-warm-100 bg-white p-4 space-y-4">
            <div className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
              2. Customer &amp; Booking
            </div>
            <CustomerPicker value={customerId} onChange={setCustomerId} />
            <ErrorText text={errors.customer_id} testId="doc-gen-err-customer" />
            <BookingPicker customerId={customerId} value={bookingId} onChange={setBookingId} />
            <ErrorText text={errors.booking_id} testId="doc-gen-err-booking" />
          </section>

          {/* 3. Signatory */}
          <section className="rounded-md border border-warm-100 bg-white p-4 space-y-3">
            <div className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
              3. Authorised Signatory (Developer)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-sm font-medium">Signatory Name</Label>
                <Input
                  value={signatoryName}
                  onChange={(e) => setSignatoryName(e.target.value)}
                  placeholder="e.g. R. Anand"
                  className="mt-1.5"
                  data-testid="doc-gen-signatory-name"
                />
                <ErrorText text={errors.signatory_name} />
              </div>
              <div>
                <Label className="text-sm font-medium">Designation</Label>
                <Input
                  value={signatoryDesignation}
                  onChange={(e) => setSignatoryDesignation(e.target.value)}
                  className="mt-1.5"
                  data-testid="doc-gen-signatory-designation"
                />
                <ErrorText text={errors.signatory_designation} />
              </div>
            </div>
          </section>

          {/* 4. Witnesses */}
          <section className="rounded-md border border-warm-100 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
                4. Witnesses (minimum 2)
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addWitness}
                data-testid="doc-gen-add-witness"
              >
                <Plus className="h-3.5 w-3.5" /> Add Witness
              </Button>
            </div>
            {witnesses.map((w, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-start">
                <div>
                  <Label className="text-sm font-medium">Witness {i + 1} name</Label>
                  <Input
                    value={w.name}
                    onChange={(e) => updateWitness(i, { name: e.target.value })}
                    placeholder="Full name"
                    className="mt-1.5"
                    data-testid={`doc-gen-witness-name-${i}`}
                  />
                </div>
                <div>
                  <Label className="text-sm font-medium">Address (optional)</Label>
                  <Input
                    value={w.address}
                    onChange={(e) => updateWitness(i, { address: e.target.value })}
                    placeholder="City / short address"
                    className="mt-1.5"
                    data-testid={`doc-gen-witness-address-${i}`}
                  />
                </div>
                <div className="sm:mt-6">
                  {witnesses.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeWitness(i)}
                      className="text-red-600 hover:text-red-700"
                      data-testid={`doc-gen-remove-witness-${i}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            <ErrorText text={errors.witnesses} testId="doc-gen-err-witnesses" />
          </section>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={doPreview}
              disabled={busy}
              data-testid="doc-gen-preview-btn"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              Generate Preview
            </Button>
            <Button
              type="button"
              onClick={doDownload}
              disabled={busy}
              className="bg-brand-500 hover:bg-brand-600 text-white"
              data-testid="doc-gen-download-btn"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download PDF
            </Button>
          </div>
        </div>

        {/* -------- Right: Preview -------- */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wide text-slate-600 font-semibold">
              Preview
            </div>
            {previewHtml && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={doPrint}
                data-testid="doc-gen-print-btn"
              >
                <Printer className="h-3.5 w-3.5" /> Print Preview
              </Button>
            )}
          </div>
          {!previewHtml ? (
            <div className="rounded-xl border-2 border-dashed border-warm-100 bg-white p-10 text-center text-sm text-slate-500 min-h-[560px] flex flex-col items-center justify-center gap-2">
              <FileText className="h-8 w-8 text-slate-300" />
              <div>Fill the form and click <span className="font-medium text-slate-700">Generate Preview</span> to see the document draft here.</div>
            </div>
          ) : (
            <div className="rounded-xl border border-warm-100 bg-white overflow-hidden" style={{ aspectRatio: "1 / 1.414" }}>
              <iframe
                ref={iframeRef}
                title="Document preview"
                srcDoc={previewHtml}
                sandbox="allow-same-origin allow-modals"
                className="w-full h-full"
                data-testid="doc-gen-preview-frame"
              />
            </div>
          )}
          {saved && (
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-900 flex items-start gap-2" data-testid="doc-gen-saved-note">
              <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
              <div className="min-w-0">
                Saved to the customer's Documents (Category: <span className="font-semibold">{saved.category}</span>).{" "}
                <Link
                  to={`/customers/${saved.customerId}?tab=documents`}
                  className="underline decoration-green-400 underline-offset-2 hover:text-green-800"
                  data-testid="doc-gen-open-documents-link"
                >
                  View in Documents tab →
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
