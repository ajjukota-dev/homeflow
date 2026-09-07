import { useCallback, useEffect, useState } from "react";
import { Card, CardBody, Button, Dialog, DialogContent, Field, Input, EmptyState, Skeleton, Badge } from "@homeflow/ui";
import { UserPlus, Users2 } from "lucide-react";
import { ApiError } from "../../auth/api";
import { salesApi, type Prospect, type InventoryUnit } from "./api";
import { ProspectDrawer } from "./ProspectDrawer";
import { PROSPECT_STATUS_LABEL } from "./labels";

const WRITE_ROLES = ["SALES", "MANAGEMENT", "SUPER_ADMIN"]; // sales/prospects.ts's real SALES_WRITE_ROLES

function NewProspectDialog({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName(""); setPhone(""); setEmail(""); setSource(""); setError(null);
  }

  async function submit() {
    if (!name.trim()) return setError("Name is required.");
    setBusy(true);
    setError(null);
    try {
      await salesApi.createProspect({ project_id: projectId, name: name.trim(), phone: phone || undefined, email: email || undefined, source: source || undefined });
      setOpen(false);
      reset();
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't create that prospect.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" /> New prospect
      </Button>
      <DialogContent title="New prospect" description="Sales' own lead — needs and matches are captured after creation.">
        <div className="flex flex-col gap-3">
          <Field label="Name" htmlFor="prs-name" required>
            <Input id="prs-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Phone" htmlFor="prs-phone">
            <Input id="prs-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="prs-email">
            <Input id="prs-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Source" htmlFor="prs-source" hint="e.g. walk-in, referral, portal">
            <Input id="prs-source" value={source} onChange={(e) => setSource(e.target.value)} />
          </Field>
          {error && <p role="alert" className="text-footnote text-overdue">{error}</p>}
          <Button onClick={submit} disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create prospect"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 24-sales-inventory-discovery.md rule 4/5/9 Screen "Prospect discovery" list — detail (needs +
 *  matches + mark lost) lives in ProspectDrawer.tsx. */
export function ProspectsPanel({ projectId, roles, units }: { projectId: string; roles: string[]; units: InventoryUnit[] }) {
  const [items, setItems] = useState<Prospect[] | null>(null);
  const [error, setError] = useState(false);
  const [openProspect, setOpenProspect] = useState<Prospect | null>(null);

  const canWrite = roles.some((r) => WRITE_ROLES.includes(r));

  const load = useCallback(() => {
    if (!projectId) return;
    setError(false);
    salesApi.listProspects(projectId).then(setItems).catch(() => setError(true));
  }, [projectId]);
  useEffect(load, [load]);

  return (
    <div>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-title2 font-bold text-fg">Prospects</h2>
          <p className="text-footnote text-fg-muted">Capture requirements, see real-time compatibility as gates move.</p>
        </div>
        {canWrite && <NewProspectDialog projectId={projectId} onCreated={load} />}
      </header>

      {error && (
        <Card>
          <CardBody className="text-subhead text-overdue">Couldn't reach the API on :3001.</CardBody>
        </Card>
      )}
      {!error && items === null && (
        <div className="flex flex-col gap-2">
          <Skeleton variant="text" />
          <Skeleton variant="text" />
        </div>
      )}
      {!error && items !== null && items.length === 0 && (
        <EmptyState icon={Users2} message="No prospects for this project yet." />
      )}
      {!error && items !== null && items.length > 0 && (
        <div className="flex flex-col gap-2">
          {items.map((p) => (
            <button
              key={p.id}
              onClick={() => setOpenProspect(p)}
              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3 text-left transition-colors hover:border-accent"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-subhead font-semibold text-fg">{p.name}</span>
                  <Badge>{p.code}</Badge>
                </div>
                <p className="text-footnote text-fg-muted">{p.phone ?? p.email ?? "No contact on file"}{p.source ? ` · ${p.source}` : ""}</p>
              </div>
              <Badge>{PROSPECT_STATUS_LABEL[p.status] ?? p.status}</Badge>
            </button>
          ))}
        </div>
      )}

      <ProspectDrawer prospect={openProspect} units={units} onClose={() => setOpenProspect(null)} onChanged={load} />
    </div>
  );
}
