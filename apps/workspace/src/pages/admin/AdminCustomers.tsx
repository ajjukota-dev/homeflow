import { useEffect, useMemo, useState } from "react";
import { api, type CustomerRow } from "../../api";
import type { MergePreview } from "../../api-model";
import { Card, CardBody, Button } from "@homeflow/ui";
import { kycStatusLabel } from "../../lib/labels";

// 04 §Screens "Customers" — search, merge with preview (rule 5, p27 §22 dedupe preserving history).

const inputCls = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-subhead outline-none focus:border-accent";

export function AdminCustomers() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [fromId, setFromId] = useState("");
  const [intoId, setIntoId] = useState("");
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [merging, setMerging] = useState(false);
  const [merged, setMerged] = useState(false);

  function reload() {
    setLoading(true);
    setError(null);
    api
      .listCustomers()
      .then(setCustomers)
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  const filtered = useMemo(
    () =>
      customers.filter((c) => c.display_name.toLowerCase().includes(search.toLowerCase()) || c.primary_phone.includes(search)),
    [customers, search]
  );

  async function loadPreview() {
    setError(null);
    setMerged(false);
    if (!fromId || !intoId || fromId === intoId) {
      setError("Pick two different customers to merge");
      return;
    }
    try {
      setPreview(await api.mergePreview(fromId, intoId));
    } catch (e) {
      setError(String((e as Error).message));
      setPreview(null);
    }
  }

  async function confirmMerge() {
    if (!preview) return;
    setMerging(true);
    try {
      await api.mergeCustomer(fromId, intoId);
      setMerged(true);
      setPreview(null);
      reload();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setMerging(false);
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-large font-bold">Customers</h1>

      <input
        className={inputCls + " mb-6 max-w-sm"}
        placeholder="Search by name or phone"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search customers"
      />

      {error && <p className="mb-4 text-subhead text-overdue">{error}</p>}
      {loading && <div className="h-40 animate-pulse rounded-xl border border-line bg-surface-2" />}
      {!loading && filtered.length === 0 && <p className="text-subhead text-fg-muted">No customers found.</p>}

      {!loading && filtered.length > 0 && (
        <div className="mb-6 overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-subhead">
            <thead className="bg-surface-2 text-footnote text-fg-muted">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">KYC</th>
                <th className="px-3 py-2">Booking</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="px-3 py-2 font-medium">{c.display_name}</td>
                  <td className="px-3 py-2 text-fg-muted">{c.primary_phone}</td>
                  <td className="px-3 py-2">{kycStatusLabel(c.kyc_status)}</td>
                  <td className="px-3 py-2">
                    {c.unit_number} · {c.booking_number}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Card>
        <CardBody>
          <h2 className="mb-3 text-title3 font-semibold">Merge duplicate customers</h2>
          {merged && <p className="mb-2 text-footnote text-ontrack">Merged — history preserved on both codes.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-footnote text-fg-muted">
              From (will be marked merged)
              <select className={inputCls} value={fromId} onChange={(e) => setFromId(e.target.value)} aria-label="Merge from">
                <option value="">Select…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name} ({c.primary_phone})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-footnote text-fg-muted">
              Into (survives)
              <select className={inputCls} value={intoId} onChange={(e) => setIntoId(e.target.value)} aria-label="Merge into">
                <option value="">Select…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name} ({c.primary_phone})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Button size="sm" variant="secondary" className="mt-4" onClick={loadPreview}>
            Preview merge
          </Button>

          {preview && (
            <div className="mt-4 rounded-lg border border-line bg-surface-2 p-4 text-subhead">
              <p>
                <strong>{preview.from.display_name}</strong> → <strong>{preview.into.display_name}</strong>
              </p>
              <p className="mt-1 text-footnote text-fg-muted">
                {preview.bookings_to_repoint} booking(s) will re-point to the surviving customer. Both customer
                codes remain in history.
              </p>
              <Button size="sm" className="mt-3" onClick={confirmMerge} disabled={merging}>
                {merging ? "Merging…" : "Confirm merge"}
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
