import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, ShieldOff, ShieldCheck } from "lucide-react";

import { api, apiErrorMessage, apiErrorToast } from "@/lib/api";
import { formatDate } from "@/lib/format";
import StatusPill from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const empty = () => ({
  email: "",
  name: "",
  phone: "",
  role_id: "",
  department_id: "",
  manager_id: "",
  active: true,
  password: "",
});

export default function AdminUsers() {
  const [rows, setRows] = useState([]);
  const [roles, setRoles] = useState([]);
  const [depts, setDepts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty());
  const [saving, setSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [u, r, d] = await Promise.all([
        api.get("/users", { params: { include_inactive: true } }),
        api.get("/roles"),
        api.get("/departments", { params: { include_inactive: true } }),
      ]);
      setRows(u.data);
      setRoles(r.data);
      setDepts(d.data);
    } catch (e) {
      apiErrorToast(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const roleById = useMemo(() => Object.fromEntries(roles.map((r) => [r.id, r])), [roles]);
  const deptById = useMemo(() => Object.fromEntries(depts.map((d) => [d.id, d])), [depts]);

  const visible = useMemo(() => rows.filter((u) => (showInactive ? true : u.active)), [rows, showInactive]);

  const openCreate = () => {
    setEditing(null);
    setForm(empty());
    setOpen(true);
  };

  const openEdit = (u) => {
    setEditing(u);
    setForm({
      email: u.email || "",
      name: u.name || "",
      phone: u.phone || "",
      role_id: u.role_id || "",
      department_id: u.department_id || "",
      manager_id: u.manager_id || "",
      active: u.active,
      password: "",
    });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.role_id) {
      toast.error("Role is required.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        email: form.email.trim(),
        name: form.name.trim(),
        phone: form.phone || null,
        role_id: form.role_id,
        department_id: form.department_id || null,
        manager_id: form.manager_id || null,
        active: form.active,
      };
      if (editing) {
        if (form.password.trim()) body.password = form.password;
        await api.put(`/users/${editing.id}`, body);
        toast.success("User updated");
      } else {
        if (!form.password.trim()) {
          toast.error("Password is required for new users.");
          setSaving(false);
          return;
        }
        body.password = form.password;
        await api.post("/users", body);
        toast.success("User created");
      }
      setOpen(false);
      refresh();
    } catch (err) {
      apiErrorToast(err);
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (u) => {
    if (!window.confirm(`Deactivate ${u.name}?`)) return;
    try {
      await api.delete(`/users/${u.id}`);
      toast.success("User deactivated");
      refresh();
    } catch (e) {
      apiErrorToast(e);
    }
  };

  const activate = async (u) => {
    try {
      await api.put(`/users/${u.id}`, { active: true });
      toast.success("User activated");
      refresh();
    } catch (e) {
      apiErrorToast(e);
    }
  };

  return (
    <div className="space-y-4" data-testid="admin-users">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-sm text-gray-500" data-testid="admin-users-count">
            {visible.length} user{visible.length === 1 ? "" : "s"}
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <Switch checked={showInactive} onCheckedChange={setShowInactive} data-testid="show-inactive-toggle" />
            Show inactive
          </label>
        </div>
        <Button onClick={openCreate} className="h-9 bg-brand-500 hover:bg-brand-600 text-white" data-testid="admin-users-new">
          <Plus className="h-4 w-4" /> New user
        </Button>
      </div>

      <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead className="h-9 text-xs uppercase tracking-wide text-slate-600 font-semibold px-3">Name</TableHead>
              <TableHead className="h-9 text-xs uppercase tracking-wide text-slate-600 font-semibold px-3">Email</TableHead>
              <TableHead className="h-9 text-xs uppercase tracking-wide text-slate-600 font-semibold px-3">Role</TableHead>
              <TableHead className="h-9 text-xs uppercase tracking-wide text-slate-600 font-semibold px-3">Department</TableHead>
              <TableHead className="h-9 text-xs uppercase tracking-wide text-slate-600 font-semibold px-3">Status</TableHead>
              <TableHead className="h-9 text-xs uppercase tracking-wide text-slate-600 font-semibold px-3">Updated</TableHead>
              <TableHead className="h-9 text-xs uppercase tracking-wide text-slate-600 font-semibold px-3 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-gray-500 py-6">Loading…</TableCell>
              </TableRow>
            ) : visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-gray-500 py-6">No users.</TableCell>
              </TableRow>
            ) : (
              visible.map((u) => (
                <TableRow key={u.id} className="h-10" data-testid={`user-row-${u.email}`}>
                  <TableCell className="px-3 text-sm text-gray-900 font-medium">{u.name}</TableCell>
                  <TableCell className="px-3 text-sm text-gray-700 font-mono text-xs">{u.email}</TableCell>
                  <TableCell className="px-3 text-sm text-gray-700">{roleById[u.role_id]?.name || "—"}</TableCell>
                  <TableCell className="px-3 text-sm text-gray-700">{deptById[u.department_id]?.name || "—"}</TableCell>
                  <TableCell className="px-3">
                    <StatusPill status={u.active ? "Active" : "Inactive"} tone={u.active ? "green" : "grey"} />
                  </TableCell>
                  <TableCell className="px-3 text-xs text-gray-500">{formatDate(u.updated_at)}</TableCell>
                  <TableCell className="px-3 text-right">
                    <div className="inline-flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openEdit(u)} data-testid={`user-edit-${u.email}`}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                      {u.active ? (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-red-700 hover:text-red-800" onClick={() => deactivate(u)} data-testid={`user-deactivate-${u.email}`}>
                          <ShieldOff className="h-3.5 w-3.5" /> Deactivate
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-green-700 hover:text-green-800" onClick={() => activate(u)} data-testid={`user-activate-${u.email}`}>
                          <ShieldCheck className="h-3.5 w-3.5" /> Activate
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" data-testid="user-dialog">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit user" : "New user"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Full name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="user-form-name" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required data-testid="user-form-email" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="user-form-phone" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Password {editing ? "(leave blank to keep)" : ""}</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="user-form-password" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Select value={form.role_id} onValueChange={(v) => setForm({ ...form, role_id: v })}>
                <SelectTrigger data-testid="user-form-role"><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Department</Label>
              <Select value={form.department_id || "__none__"} onValueChange={(v) => setForm({ ...form, department_id: v === "__none__" ? "" : v })}>
                <SelectTrigger data-testid="user-form-department"><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {depts.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Manager</Label>
              <Select value={form.manager_id || "__none__"} onValueChange={(v) => setForm({ ...form, manager_id: v === "__none__" ? "" : v })}>
                <SelectTrigger data-testid="user-form-manager"><SelectValue placeholder="Select manager (optional)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {rows.filter((r) => r.active && (!editing || r.id !== editing.id)).map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name} · {r.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} data-testid="user-form-active" />
              <span className="text-xs text-gray-600">Active</span>
            </div>
            <DialogFooter className="col-span-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)} data-testid="user-form-cancel">Cancel</Button>
              <Button type="submit" disabled={saving} className="bg-brand-500 hover:bg-brand-600 text-white" data-testid="user-form-submit">
                {saving ? "Saving…" : editing ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
