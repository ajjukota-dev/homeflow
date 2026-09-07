import { useCallback, useEffect, useState } from "react";
import { Button, Input, Select, SelectTrigger, SelectOptions, EmptyState } from "@homeflow/ui";
import { BookOpen, Plus } from "lucide-react";
import { ApiError } from "../../auth/api";
import { postHandoverApi, type PassportItem } from "./api";

const KINDS = ["EQUIPMENT", "FINISH", "DOCUMENT", "WARRANTY", "CONTACT"];

function AddItemForm({ unitId, onAdded }: { unitId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("EQUIPMENT");
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [serial, setSerial] = useState("");
  const [warrantyUntil, setWarrantyUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="mr-1.5 size-4" aria-hidden /> Add item
      </Button>
    );
  }

  async function add() {
    if (!category.trim() || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await postHandoverApi.putPassportItem(unitId, { kind, category: category.trim(), name: name.trim(), brand: brand.trim() || null, serial: serial.trim() || null, warranty_until: warrantyUntil || null });
      setOpen(false);
      setCategory(""); setName(""); setBrand(""); setSerial(""); setWarrantyUntil("");
      onAdded();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3">
      <Select value={kind} onValueChange={setKind}>
        <SelectTrigger placeholder="Kind" />
        <SelectOptions options={KINDS.map((k) => ({ value: k, label: k }))} />
      </Select>
      <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category (e.g. AC, Water heater)" />
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
      <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand / model (optional)" />
      <Input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Serial number (optional)" />
      <label className="text-caption text-fg-muted">
        Warranty until
        <input type="date" value={warrantyUntil} onChange={(e) => setWarrantyUntil(e.target.value)} className="mt-1 block w-full rounded-lg border border-line bg-surface px-3 py-2 text-body" />
      </label>
      {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" onClick={add} disabled={busy || !category.trim() || !name.trim()}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </div>
  );
}

/** Screens: "passport editor" — Digital Home Passport (equipment, serials, manuals, warranties).
 *  `manual_file_id`/upload is out of scope: no file-upload port exists anywhere in this codebase
 *  yet (same gap `CommitmentDrawer.tsx`/16's signature-pad flow already flagged, not faked here
 *  either — the field just stays empty until a real upload port lands). */
export function PassportPanel({ unitId, canWrite }: { unitId: string; canWrite: boolean }) {
  const [items, setItems] = useState<PassportItem[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    postHandoverApi.passport(unitId).then(setItems).catch(() => setError(true));
  }, [unitId]);

  useEffect(load, [load]);

  if (error) return <EmptyState icon={BookOpen} message="Couldn't reach the API on :3001." action={{ label: "Retry", onClick: load }} />;
  if (items === null) return <p className="text-footnote text-fg-muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-3">
      {canWrite && <AddItemForm unitId={unitId} onAdded={load} />}
      {items.length === 0 ? (
        <p className="text-footnote text-fg-muted">Nothing in the passport yet — pre-fills from 09's as-built spec when available.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((it) => (
            <li key={it.id} className="rounded-lg border border-line p-3 text-footnote">
              <p className="font-semibold text-fg">{it.name}{it.kind ? ` · ${it.kind}` : ""}</p>
              <p className="text-fg-muted">{[it.category, it.brand, it.serial ? `SN ${it.serial}` : null, it.warranty_until ? `warranty until ${it.warranty_until.slice(0, 10)}` : null].filter(Boolean).join(" · ")}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
