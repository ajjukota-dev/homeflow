import { useState } from "react";
import { Drawer, DrawerContent, Field, Input, Select, SelectTrigger, SelectOptions, Switch, Button, Checkbox } from "@homeflow/ui";
import { ROLE_CODES } from "../admin/roles";
import { STREAMS, type StageDef, type Stream } from "./JourneyTemplateStudio";

/** Add/edit one stage's own fields (05 Data: journey_stage_template + stage_visibility_rule).
 * Tasks are edited separately (JourneyTemplateTaskDrawer) — a stage's task list is untouched by
 * this drawer's save (JourneyTemplateVersionEditor re-attaches `tasks` on the existing stage). */
export function JourneyTemplateStageDrawer({
  stage,
  existingCodes,
  onClose,
  onSave,
  onRemove,
}: {
  stage: StageDef | null;
  existingCodes: string[];
  onClose: () => void;
  onSave: (stage: StageDef) => void;
  onRemove?: () => void;
}) {
  const [code, setCode] = useState(stage?.code ?? "");
  const [name, setName] = useState(stage?.name ?? "");
  const [customerName, setCustomerName] = useState(stage?.customer_name ?? "");
  const [stream, setStream] = useState<Stream>(stage?.stream ?? "COMMERCIAL");
  const [sortOrder, setSortOrder] = useState(String(stage?.sort_order ?? 0));
  const [duration, setDuration] = useState(String(stage?.planned_duration_days ?? 1));
  const [department, setDepartment] = useState(stage?.owner_department ?? "");
  const [isMandatory, setIsMandatory] = useState(stage?.is_mandatory ?? true);
  const [customerVisible, setCustomerVisible] = useState(stage?.customer_visible ?? true);
  const [conditionExpr, setConditionExpr] = useState(stage?.condition_expr ?? "");
  const [entryGateExpr, setEntryGateExpr] = useState(stage?.entry_gate_expr ?? "");
  const [visibility, setVisibility] = useState<Set<string>>(
    new Set(stage?.visibility?.filter((v) => v.visible).map((v) => v.role_code) ?? ROLE_CODES.filter((r) => r !== "SUPER_ADMIN"))
  );
  const [error, setError] = useState<string | null>(null);

  const isNew = stage === null;
  const codeTaken = isNew && existingCodes.includes(code.trim());

  function toggleRole(role: string) {
    setVisibility((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  function submit() {
    setError(null);
    if (!code.trim() || !name.trim() || !department.trim()) {
      setError("Code, name and owner department are required.");
      return;
    }
    if (codeTaken) {
      setError(`Stage code "${code.trim()}" already exists in this version.`);
      return;
    }
    if (!Number.isFinite(Number(duration)) || Number(duration) < 0) {
      setError("Planned duration must be a non-negative number of days.");
      return;
    }
    onSave({
      code: code.trim(),
      name: name.trim(),
      customer_name: customerName.trim() || null,
      sort_order: Number(sortOrder) || 0,
      stream,
      customer_visible: customerVisible,
      planned_duration_days: Number(duration),
      owner_department: department.trim(),
      entry_gate_expr: entryGateExpr.trim() || null,
      is_mandatory: isMandatory,
      condition_expr: conditionExpr.trim() || null,
      tasks: stage?.tasks ?? [],
      visibility: ROLE_CODES.map((role_code) => ({ role_code, visible: visibility.has(role_code) })),
    });
  }

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent open title={isNew ? "Add stage" : `Edit stage — ${stage!.code}`} width={640}>
        <div className="flex flex-col gap-4 p-6">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code" htmlFor="st-code" required hint="Stable across versions (rule 4)">
              <Input id="st-code" value={code} onChange={(e) => setCode(e.target.value)} disabled={!isNew} />
            </Field>
            <Field label="Stream" htmlFor="st-stream" required>
              <Select value={stream} onValueChange={(v) => setStream(v as Stream)}>
                <SelectTrigger id="st-stream" />
                <SelectOptions options={STREAMS} />
              </Select>
            </Field>
          </div>
          <Field label="Internal name" htmlFor="st-name" required>
            <Input id="st-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Customer wording" htmlFor="st-customer-name" hint="Blank falls back to the internal name">
            <Input id="st-customer-name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Planned duration (days)" htmlFor="st-duration" required>
              <Input id="st-duration" type="number" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} />
            </Field>
            <Field label="Owner department" htmlFor="st-dept" required hint="Role code, e.g. SITE">
              <Input id="st-dept" value={department} onChange={(e) => setDepartment(e.target.value)} />
            </Field>
          </div>
          <Field label="Sort order" htmlFor="st-sort">
            <Input id="st-sort" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </Field>
          <div className="flex items-center gap-3">
            <Switch checked={isMandatory} onCheckedChange={setIsMandatory} label="Mandatory stage" />
            <Switch checked={customerVisible} onCheckedChange={setCustomerVisible} label="Customer-visible" />
          </div>
          <Field label="Condition (conditional stage)" htmlFor="st-cond" hint='e.g. booking.has_change_requests == true — blank means unconditional'>
            <Input id="st-cond" value={conditionExpr} onChange={(e) => setConditionExpr(e.target.value)} />
          </Field>
          <Field label="Entry gate expression" htmlFor="st-gate" hint="Optional — references a gate from 08/16/19">
            <Input id="st-gate" value={entryGateExpr} onChange={(e) => setEntryGateExpr(e.target.value)} />
          </Field>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-ws-sm font-medium text-fg">Visible to roles (stage_visibility_rule)</legend>
            <div className="grid grid-cols-2 gap-1.5">
              {ROLE_CODES.filter((r) => r !== "SUPER_ADMIN").map((role) => (
                <label key={role} className="flex items-center gap-2 text-footnote">
                  <Checkbox checked={visibility.has(role)} onCheckedChange={() => toggleRole(role)} aria-label={`Visible to ${role}`} />
                  {role}
                </label>
              ))}
            </div>
          </fieldset>

          {error && (
            <p role="alert" className="text-footnote text-danger">
              {error}
            </p>
          )}

          <div className="mt-2 flex items-center justify-between gap-2">
            {onRemove ? (
              <button type="button" onClick={onRemove} className="text-footnote text-danger underline">
                Remove stage
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={submit}>Save</Button>
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
