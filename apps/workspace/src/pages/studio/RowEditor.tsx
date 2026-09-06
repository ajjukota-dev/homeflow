import { useState } from "react";
import { Drawer, DrawerContent, Field, Input, Textarea, Button } from "@homeflow/ui";
import { ApiError } from "../../auth/api";
import { studioApi, type StudioRow } from "./api";
import type { GenericTableDef } from "./registry";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function toFieldValue(def: GenericTableDef, col: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (def.jsonColumns?.includes(col)) return JSON.stringify(value, null, 2);
  if (def.arrayColumns?.includes(col)) return Array.isArray(value) ? value.join(", ") : String(value);
  return typeof value === "boolean" ? String(value) : String(value);
}

function fromFieldValue(def: GenericTableDef, col: string, raw: string): unknown {
  // An empty text box means "no value", not the literal string "" — Postgres rejects "" for a
  // typed column (date/int/etc), e.g. risk_rule.effective_to, so blank always maps to null, not
  // "" or [] or {}. For a NOT NULL column this surfaces as a save error (fails loud, same as any
  // other required-field omission) rather than the wrong outcome: several of these tables use a
  // nullable `product_types text[]`/jsonb column where NULL has its own real meaning ("applies to
  // every product type" / "not configured") that [] or {} would silently and wrongly overwrite.
  if (raw.trim() === "") return null;
  if (def.jsonColumns?.includes(col)) return JSON.parse(raw);
  if (def.arrayColumns?.includes(col)) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (!Number.isNaN(Number(raw)) && /^-?\d+(\.\d+)?$/.test(raw.trim())) return Number(raw);
  return raw;
}

/** Add/edit one row of a generic-envelope Studio table (25-policy-studio.md rule 1): draft then
 *  publish in one guided flow, since a bare draft with no publish step is invisible to everyone
 *  else — real callers always want both, and the two-step API contract is still exactly followed
 *  underneath (draftStudioRow, then publishStudioRow with the effective date the user picked). */
export function RowEditor({
  table,
  def,
  row,
  onClose,
  onSaved,
}: {
  table: string;
  def: GenericTableDef;
  row: StudioRow | null; // null = new row
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = row === null;
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    if (isNew) out[def.primaryKey] = "";
    for (const c of def.columns) out[c] = row ? toFieldValue(def, c, row[c]) : "";
    return out;
  });
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const parsed: StudioRow = {};
      for (const c of def.columns) parsed[c] = fromFieldValue(def, c, values[c] ?? "");
      const rowId = isNew ? values[def.primaryKey] : (row![def.primaryKey] as string);
      if (isNew) parsed[def.primaryKey] = rowId;
      if (!rowId?.trim()) throw new ApiError("validation", `${def.primaryKey} is required`);
      const draft = await studioApi.draftRow(table, isNew ? null : rowId, parsed, note || undefined);
      await studioApi.publishRow(table, draft.id, effectiveFrom, note || undefined);
      onSaved();
    } catch (e) {
      if (e instanceof ApiError) setError(e.code === "forbidden" ? "You don't have edit access for this tab." : e.message);
      else if (e instanceof SyntaxError) setError("One of the JSON fields isn't valid JSON.");
      else setError("Couldn't save this change.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent open title={isNew ? `New ${table} row` : `Edit ${row![def.primaryKey]}`} width={480}>
        <div className="flex flex-col gap-4">
          {isNew && (
            <Field label={def.primaryKey} htmlFor="pk">
              <Input value={values[def.primaryKey]} onChange={(e) => setValues((v) => ({ ...v, [def.primaryKey]: e.target.value }))} />
            </Field>
          )}
          {def.columns.map((c) => (
            <Field key={c} label={c} htmlFor={`f-${c}`} hint={def.jsonColumns?.includes(c) ? "JSON" : def.arrayColumns?.includes(c) ? "comma-separated" : undefined}>
              {def.jsonColumns?.includes(c) ? (
                <Textarea rows={4} value={values[c]} onChange={(e) => setValues((v) => ({ ...v, [c]: e.target.value }))} />
              ) : (
                <Input value={values[c]} onChange={(e) => setValues((v) => ({ ...v, [c]: e.target.value }))} />
              )}
            </Field>
          ))}
          {/* This is the policy_version publish date (when the edit takes effect system-wide) —
              named "Publish date" to stay distinct from a same-named `effective_from` column some
              tables (risk_rule, probability_rule) already carry as their own business data,
              rendered above like any other field. */}
          <Field label="Publish date" htmlFor="ef" hint="When this change takes effect" required>
            <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </Field>
          <Field label="Change note" htmlFor="note" hint="Why this change — kept in the history log">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error && (
            <p role="alert" className="text-ws-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Publishing…" : "Save & publish"}
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
