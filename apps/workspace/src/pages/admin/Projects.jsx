import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import StatusPill from "@/components/StatusPill";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const empty = () => ({ code: "", name: "", type: "Apartment", location: "", status: "Active" });

export default function AdminProjects() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty());
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await api.get("/projects");
      setRows(r.data);
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(empty());
    setOpen(true);
  };

  const openEdit = (p) => {
    setEditing(p);
    setForm({ code: p.code, name: p.name, type: p.type, location: p.location, status: p.status });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { ...form, code: form.code.trim().toUpperCase(), name: form.name.trim(), location: form.location.trim() };
      if (editing) {
        await api.put(`/projects/${editing.id}`, body);
        toast.success("Project updated");
      } else {
        await api.post("/projects", body);
        toast.success("Project created");
      }
      setOpen(false);
      refresh();
    } catch (err) {
      apiErrorToast(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="admin-projects">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">{rows.length} project{rows.length === 1 ? "" : "s"}</div>
        <Button onClick={openCreate} className="h-9 bg-brand-500 hover:bg-brand-600 text-white" data-testid="projects-new">
          <Plus className="h-4 w-4" /> New project
        </Button>
      </div>

      <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Code</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Name</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Type</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Location</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Status</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Created</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-gray-500">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-gray-500">No projects.</TableCell></TableRow>
            ) : (
              rows.map((p) => (
                <TableRow key={p.id} className="h-10" data-testid={`project-row-${p.code}`}>
                  <TableCell className="px-3 text-xs text-gray-700 font-mono">{p.code}</TableCell>
                  <TableCell className="px-3 text-sm text-gray-900 font-medium">{p.name}</TableCell>
                  <TableCell className="px-3 text-sm text-gray-700">{p.type}</TableCell>
                  <TableCell className="px-3 text-sm text-gray-700">{p.location}</TableCell>
                  <TableCell className="px-3"><StatusPill status={p.status} /></TableCell>
                  <TableCell className="px-3 text-xs text-gray-500">{formatDate(p.created_at)}</TableCell>
                  <TableCell className="px-3 text-right">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openEdit(p)} data-testid={`project-edit-${p.code}`}>
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
        <DialogContent className="max-w-md" data-testid="project-dialog">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit project" : "New project"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Code</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required data-testid="project-form-code" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger data-testid="project-form-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Apartment">Apartment</SelectItem>
                    <SelectItem value="Villa">Villa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="project-form-name" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Location</Label>
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} required data-testid="project-form-location" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger data-testid="project-form-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Handover">Handover</SelectItem>
                  <SelectItem value="Closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving} className="bg-brand-500 hover:bg-brand-600 text-white" data-testid="project-form-submit">
                {saving ? "Saving…" : editing ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
