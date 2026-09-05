import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import StatusPill from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const empty = () => ({ name: "", code: "", active: true });

export default function AdminDepartments() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty());
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await api.get("/departments", { params: { include_inactive: true } });
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

  const openEdit = (d) => {
    setEditing(d);
    setForm({ name: d.name, code: d.code, active: d.active });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { name: form.name.trim(), code: form.code.trim().toUpperCase(), active: form.active };
      if (editing) {
        await api.put(`/departments/${editing.id}`, body);
        toast.success("Department updated");
      } else {
        await api.post("/departments", body);
        toast.success("Department created");
      }
      setOpen(false);
      refresh();
    } catch (err) {
      apiErrorToast(err);
    } finally {
      setSaving(false);
    }
  };

  const del = async (d) => {
    if (!window.confirm(`Deactivate department "${d.name}"?`)) return;
    try {
      await api.delete(`/departments/${d.id}`);
      toast.success("Department deactivated");
      refresh();
    } catch (e) {
      apiErrorToast(e);
    }
  };

  return (
    <div className="space-y-4" data-testid="admin-departments">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">{rows.length} department{rows.length === 1 ? "" : "s"}</div>
        <Button onClick={openCreate} className="h-9 bg-brand-500 hover:bg-brand-600 text-white" data-testid="departments-new">
          <Plus className="h-4 w-4" /> New department
        </Button>
      </div>

      <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Name</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Code</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold">Status</TableHead>
              <TableHead className="h-9 px-3 text-xs uppercase tracking-wide text-slate-600 font-semibold text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-gray-500">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-gray-500">No departments.</TableCell></TableRow>
            ) : (
              rows.map((d) => (
                <TableRow key={d.id} className="h-10" data-testid={`dept-row-${d.code}`}>
                  <TableCell className="px-3 text-sm text-gray-900 font-medium">{d.name}</TableCell>
                  <TableCell className="px-3 text-xs text-gray-700 font-mono">{d.code}</TableCell>
                  <TableCell className="px-3">
                    <StatusPill status={d.active ? "Active" : "Inactive"} tone={d.active ? "green" : "grey"} />
                  </TableCell>
                  <TableCell className="px-3 text-right">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openEdit(d)} data-testid={`dept-edit-${d.code}`}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    {d.active && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-red-700 hover:text-red-800" onClick={() => del(d)} data-testid={`dept-delete-${d.code}`}>
                        <Trash2 className="h-3.5 w-3.5" /> Deactivate
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" data-testid="dept-dialog">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit department" : "New department"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="dept-form-name" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Code</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required data-testid="dept-form-code" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} data-testid="dept-form-active" />
              <span className="text-xs text-gray-600">Active</span>
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving} className="bg-brand-500 hover:bg-brand-600 text-white" data-testid="dept-form-submit">
                {saving ? "Saving…" : editing ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
