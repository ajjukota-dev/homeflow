import { useState } from "react";
import { Drawer, DrawerContent, Field, Input, Textarea, Select, SelectTrigger, SelectOptions, Switch, Button } from "@homeflow/ui";
import { ROLE_CODES } from "../admin/roles";
import type { TaskDef, TaskType, ExecutionType, ExternalParty, Priority } from "./JourneyTemplateStudio";

const TASK_TYPES: { value: TaskType; label: string }[] = [
  { value: "MANDATORY", label: "Mandatory" },
  { value: "CONDITIONAL", label: "Conditional" },
];
const EXECUTION_TYPES: { value: ExecutionType; label: string }[] = [
  { value: "SIMPLE", label: "Simple" },
  { value: "VERIFICATION", label: "Verification" },
  { value: "EVIDENCE", label: "Evidence" },
  { value: "APPROVAL", label: "Approval" },
  { value: "CHECKLIST", label: "Checklist" },
  { value: "EXTERNAL", label: "External" },
];
const EXTERNAL_PARTIES: { value: ExternalParty; label: string }[] = [
  { value: "CUSTOMER", label: "Customer" },
  { value: "SRO", label: "SRO" },
  { value: "BANK", label: "Bank" },
  { value: "VENDOR", label: "Vendor" },
];
const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "CRITICAL", label: "Critical" },
];
const ROLE_OPTIONS = ROLE_CODES.filter((r) => r !== "SUPER_ADMIN").map((r) => ({ value: r, label: r }));

/** Add/edit one task (05 Data: journey_task_template, `execution_type` [E §2.2]). Fields that
 * only apply to a specific execution_type (verifier/approver/external_party/document
 * category/checklist) show only when relevant — avoids a form full of fields that don't apply. */
export function JourneyTemplateTaskDrawer({
  task,
  existingCodes,
  onClose,
  onSave,
  onRemove,
}: {
  task: TaskDef | null;
  existingCodes: string[];
  onClose: () => void;
  onSave: (task: TaskDef) => void;
  onRemove?: () => void;
}) {
  const [code, setCode] = useState(task?.code ?? "");
  const [title, setTitle] = useState(task?.title ?? "");
  const [customerTitle, setCustomerTitle] = useState(task?.customer_title ?? "");
  const [ownerRole, setOwnerRole] = useState(task?.owner_role ?? "SALES");
  const [taskType, setTaskType] = useState<TaskType>(task?.task_type ?? "MANDATORY");
  const [executionType, setExecutionType] = useState<ExecutionType>(task?.execution_type ?? "SIMPLE");
  const [verifierRole, setVerifierRole] = useState(task?.verifier_role ?? "");
  const [approverRole, setApproverRole] = useState(task?.approver_role ?? "");
  const [externalParty, setExternalParty] = useState<ExternalParty | "">(task?.external_party ?? "");
  const [docCategory, setDocCategory] = useState(task?.required_document_category ?? "");
  const [checklist, setChecklist] = useState((task?.checklist_items ?? []).join("\n"));
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "MEDIUM");
  const [conditionExpr, setConditionExpr] = useState(task?.condition_expr ?? "");
  const [customerVisible, setCustomerVisible] = useState(task?.customer_visible ?? true);
  const [sortOrder, setSortOrder] = useState(String(task?.sort_order ?? 0));
  const [error, setError] = useState<string | null>(null);

  const isNew = task === null;
  const codeTaken = isNew && existingCodes.includes(code.trim());

  function submit() {
    setError(null);
    if (!code.trim() || !title.trim()) {
      setError("Code and title are required.");
      return;
    }
    if (codeTaken) {
      setError(`Task code "${code.trim()}" already exists in this stage.`);
      return;
    }
    if (executionType === "VERIFICATION" && !verifierRole.trim()) {
      setError("A verification task needs a verifier role.");
      return;
    }
    if (executionType === "APPROVAL" && !approverRole.trim()) {
      setError("An approval task needs an approver role.");
      return;
    }
    onSave({
      code: code.trim(),
      title: title.trim(),
      customer_title: customerTitle.trim() || null,
      owner_role: ownerRole,
      task_type: taskType,
      execution_type: executionType,
      verifier_role: executionType === "VERIFICATION" ? verifierRole.trim() : null,
      approver_role: executionType === "APPROVAL" ? approverRole.trim() : null,
      external_party: executionType === "EXTERNAL" ? (externalParty || null) : null,
      required_document_category: executionType === "EVIDENCE" ? docCategory.trim() || null : null,
      checklist_items: executionType === "CHECKLIST" ? checklist.split("\n").map((s) => s.trim()).filter(Boolean) : [],
      priority,
      condition_expr: conditionExpr.trim() || null,
      customer_visible: customerVisible,
      sort_order: Number(sortOrder) || 0,
    });
  }

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()}>
      <DrawerContent open title={isNew ? "Add task" : `Edit task — ${task!.code}`} width={640}>
        <div className="flex flex-col gap-4 p-6">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code" htmlFor="tk-code" required>
              <Input id="tk-code" value={code} onChange={(e) => setCode(e.target.value)} disabled={!isNew} />
            </Field>
            <Field label="Owner role" htmlFor="tk-owner" required>
              <Select value={ownerRole} onValueChange={setOwnerRole}>
                <SelectTrigger id="tk-owner" />
                <SelectOptions options={ROLE_OPTIONS} />
              </Select>
            </Field>
          </div>
          <Field label="Internal title" htmlFor="tk-title" required>
            <Input id="tk-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Customer title" htmlFor="tk-customer-title" hint="Blank = internal only, never shown to the customer">
            <Input id="tk-customer-title" value={customerTitle} onChange={(e) => setCustomerTitle(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Task type" htmlFor="tk-type" required>
              <Select value={taskType} onValueChange={(v) => setTaskType(v as TaskType)}>
                <SelectTrigger id="tk-type" />
                <SelectOptions options={TASK_TYPES} />
              </Select>
            </Field>
            <Field label="Priority" htmlFor="tk-priority" required>
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger id="tk-priority" />
                <SelectOptions options={PRIORITIES} />
              </Select>
            </Field>
          </div>
          <Field label="Execution type" htmlFor="tk-exec" required hint="[E §2.2] — drives which field below applies">
            <Select value={executionType} onValueChange={(v) => setExecutionType(v as ExecutionType)}>
              <SelectTrigger id="tk-exec" />
              <SelectOptions options={EXECUTION_TYPES} />
            </Select>
          </Field>

          {executionType === "VERIFICATION" && (
            <Field label="Verifier role" htmlFor="tk-verifier" required>
              <Select value={verifierRole} onValueChange={setVerifierRole}>
                <SelectTrigger id="tk-verifier" />
                <SelectOptions options={ROLE_OPTIONS} />
              </Select>
            </Field>
          )}
          {executionType === "APPROVAL" && (
            <Field label="Approver role" htmlFor="tk-approver" required>
              <Select value={approverRole} onValueChange={setApproverRole}>
                <SelectTrigger id="tk-approver" />
                <SelectOptions options={ROLE_OPTIONS} />
              </Select>
            </Field>
          )}
          {executionType === "EXTERNAL" && (
            <Field label="External party" htmlFor="tk-external">
              <Select value={externalParty || undefined} onValueChange={(v) => setExternalParty(v as ExternalParty)}>
                <SelectTrigger id="tk-external" placeholder="Choose…" />
                <SelectOptions options={EXTERNAL_PARTIES} />
              </Select>
            </Field>
          )}
          {executionType === "EVIDENCE" && (
            <Field label="Required document category" htmlFor="tk-doc">
              <Input id="tk-doc" value={docCategory} onChange={(e) => setDocCategory(e.target.value)} />
            </Field>
          )}
          {executionType === "CHECKLIST" && (
            <Field label="Checklist items" htmlFor="tk-checklist" hint="One per line">
              <Textarea id="tk-checklist" value={checklist} onChange={(e) => setChecklist(e.target.value)} />
            </Field>
          )}

          <Field label="Condition (conditional task)" htmlFor="tk-cond" hint="Blank means unconditional">
            <Input id="tk-cond" value={conditionExpr} onChange={(e) => setConditionExpr(e.target.value)} />
          </Field>
          <div className="flex items-center gap-3">
            <Switch checked={customerVisible} onCheckedChange={setCustomerVisible} label="Customer-visible" />
          </div>
          <Field label="Sort order" htmlFor="tk-sort">
            <Input id="tk-sort" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </Field>

          {error && (
            <p role="alert" className="text-footnote text-danger">
              {error}
            </p>
          )}

          <div className="mt-2 flex items-center justify-between gap-2">
            {onRemove ? (
              <button type="button" onClick={onRemove} className="text-footnote text-danger underline">
                Remove task
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
