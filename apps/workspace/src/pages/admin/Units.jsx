import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import StatusPill from "@/components/StatusPill";
import { formatINR } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const emptyForm = (projectId = "") => ({
  project_id: projectId,
  code: "",
  tower: "",
  floor: "",
  unit_no: "",
  unit_type: "",
  carpet_area_sqft: "",
  facing: "",
  parking_count: "0",
  status: "Available",
  base_price_inr: "",
});

const UNIT_STATUSES = ["Available", "Booked", "Registered", "Handed Over"];

export default function AdminUnits() {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/projects").then((r) => {
      setProjects(r.data);
      if (r.data.length && !projectId) setProjectId(r.data[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = async (pid) => {
    if (!pid) return;
    setLoading(true);
    try {
      const r = await api.get("/units", { params: { project_id: pid } });
      setRows(r.data);
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (projectId) refresh(projectId);
  }, [projectId]);

  const projectById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm(projectId));
    setOpen(true);
  };

  const openEdit = (u) => {
    setEditing(u);
    setForm({
      project_id: u.project_id,
      code: u.code,
      tower: u.tower || "",
      floor: u.floor || "",
      unit_no: u.unit_no,
      unit_type: u.unit_type || "",
      carpet_area_sqft: String(u.carpet_area_sqft ?? ""),
      facing: u.facing || "",
      parking_count: String(u.parking_count ?? 0),
      status: u.status,
      base_price_inr: String(u.base_price_inr ?? ""),
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        project_id: form.project_id,
        code: form.code.trim(),
        tower: form.tower.trim() || null,
        floor: form.floor.trim() || null,
        unit_no: form.unit_no.trim(),
        unit_type: form.unit_type.trim() || null,
        carpet_area_sqft: Number(form.carpet_area_sqft),
        facing: form.facing.trim() || null,
        parking_count: Number(form.parking_count || 0),
        status: form.status,
        base_price_inr: Number(form.base_price_inr),
      };
      if (editing) {
        await api.put(`/units/${editing.id}`, body);
        toast.success("Unit updated");
      } else {
        await api.post("/units", body);
        toast.success("Unit created");
      }
      setOpen(false);
      refresh(projectId);
    } catch (err) {
      apiErrorToast(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="admin-units">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Label className="text-xs text-gray-600">Project</Label>
          <div className="w-64">
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger data-testid="units-project-filter"><SelectValue placeholder="Select project" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-sm text-gray-500">{rows.length} unit{rows.length === 1 ? "" : "s"}</div>
        </div>
        <Button onClick={openCreate} disabled={!projectId} className="h-9 bg-brand-500 hover:bg-brand-600 text-white" data-testid="units-new">
          <Plus className="h-4 w-4" /> New unit
        </Button>
      </div>

      <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Code</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Tower/Floor/No.</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Type</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold text-right">Carpet (sqft)</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Facing</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Status</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold text-right">Base price</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} className="py-6 text-center text-sm text-gray-500">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="py-6 text-center text-sm text-gray-500">No units in this project.</TableCell></TableRow>
            ) : (
              rows.map((u) => (
                <TableRow key={u.id} className="h-10" data-testid={`unit-row-${u.code}`}>
                  <TableCell className="px-3 font-mono text-xs text-gray-700">{u.code}</TableCell>
                  <TableCell className="px-3 text-sm text-gray-700">{[u.tower, u.floor, u.unit_no].filter(Boolean).join(" · ")}</TableCell>
                  <TableCell className="px-3 text-sm text-gray-700">{u.unit_type || "—"}</TableCell>
                  <TableCell className="px-3 text-sm text-gray-700 text-right tabular-nums">{u.carpet_area_sqft}</TableCell>
                  <TableCell className="px-3 text-sm text-gray-700">{u.facing || "—"}</TableCell>
                  <TableCell className="px-3"><StatusPill status={u.status} /></TableCell>
                  <TableCell className="px-3 text-sm text-gray-900 text-right tabular-nums">{formatINR(u.base_price_inr)}</TableCell>
                  <TableCell className="px-3 text-right">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openEdit(u)} data-testid={`unit-edit-${u.code}`}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl" data-testid="unit-dialog">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit unit" : "New unit"} · {projectById[form.project_id]?.name || ""}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Project</Label>
              <Select value={form.project_id} onValueChange={(v) => setForm({ ...form, project_id: v })}>
                <SelectTrigger data-testid="unit-form-project"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Code</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required data-testid="unit-form-code" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger data-testid="unit-form-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UNIT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tower</Label>
              <Input value={form.tower} onChange={(e) => setForm({ ...form, tower: e.target.value })} data-testid="unit-form-tower" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Floor</Label>
              <Input value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} data-testid="unit-form-floor" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Unit No.</Label>
              <Input value={form.unit_no} onChange={(e) => setForm({ ...form, unit_no: e.target.value })} required data-testid="unit-form-no" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Input value={form.unit_type} onChange={(e) => setForm({ ...form, unit_type: e.target.value })} placeholder="3BHK / 4BHK Villa" data-testid="unit-form-type" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Carpet area (sqft)</Label>
              <Input type="number" value={form.carpet_area_sqft} onChange={(e) => setForm({ ...form, carpet_area_sqft: e.target.value })} required data-testid="unit-form-area" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Facing</Label>
              <Input value={form.facing} onChange={(e) => setForm({ ...form, facing: e.target.value })} data-testid="unit-form-facing" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Parking count</Label>
              <Input type="number" value={form.parking_count} onChange={(e) => setForm({ ...form, parking_count: e.target.value })} data-testid="unit-form-parking" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Base price (INR)</Label>
              <Input type="number" value={form.base_price_inr} onChange={(e) => setForm({ ...form, base_price_inr: e.target.value })} required data-testid="unit-form-price" />
            </div>
            <DialogFooter className="col-span-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving} className="bg-brand-500 hover:bg-brand-600 text-white" data-testid="unit-form-submit">
                {saving ? "Saving…" : editing ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
