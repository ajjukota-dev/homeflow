import { useEffect, useState, type FormEvent } from "react";
import { adminApi, type AdminUser } from "../../auth/adminApi";
import { ApiError } from "../../auth/api";
import { Button } from "../../ui/Button";
import { Card, CardBody, CardHeader } from "../../ui/Card";
import { ROLE_CODES } from "./roles";

const inputCls = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-subhead outline-none focus-visible:border-accent";

/** Admin → Users (01-identity-access.md Screens): list, invite, roles, disable. */
export function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function load() {
    adminApi
      .listUsers()
      .then(setUsers)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load users."));
  }

  useEffect(load, []);

  function toggleRole(code: string) {
    setRoles((prev) => (prev.includes(code) ? prev.filter((r) => r !== code) : [...prev, code]));
  }

  async function invite(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!email.trim() || !name.trim() || roles.length === 0) {
      setFormError("Email, name and at least one role are required.");
      return;
    }
    setBusy(true);
    try {
      await adminApi.createUser({ email: email.trim(), display_name: name.trim(), roles });
      setEmail("");
      setName("");
      setRoles([]);
      setFormOpen(false);
      load();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Couldn't send the invite.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(u: AdminUser) {
    await adminApi.updateUser(u.id, { status: u.status === "DISABLED" ? "ACTIVE" : "DISABLED" });
    load();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-title1 font-bold tracking-tight">Users</h1>
        <Button onClick={() => setFormOpen((v) => !v)}>{formOpen ? "Cancel" : "Invite user"}</Button>
      </div>

      {formOpen && (
        <Card>
          <CardBody>
            <form className="flex flex-col gap-3" onSubmit={invite} noValidate>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-subhead font-medium">
                  Email
                  <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} />
                </label>
                <label className="flex flex-col gap-1 text-subhead font-medium">
                  Display name
                  <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
                </label>
              </div>
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-subhead font-medium">Roles</legend>
                <div className="flex flex-wrap gap-2">
                  {ROLE_CODES.map((code) => (
                    <label key={code} className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-footnote">
                      <input type="checkbox" checked={roles.includes(code)} onChange={() => toggleRole(code)} disabled={busy} />
                      {code}
                    </label>
                  ))}
                </div>
              </fieldset>
              {formError && (
                <p role="alert" className="text-footnote font-medium text-overdue">
                  {formError}
                </p>
              )}
              <Button type="submit" disabled={busy} className="w-fit">
                {busy ? "Sending invite…" : "Send invite"}
              </Button>
            </form>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h2 className="text-title3 font-semibold">All users</h2>
        </CardHeader>
        <CardBody>
          {error && <p className="text-subhead text-overdue">{error}</p>}
          {!error && users === null && <div className="h-24 animate-pulse rounded-lg bg-surface-2" />}
          {users?.length === 0 && <p className="text-subhead text-fg-muted">No users yet.</p>}
          {users && users.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-subhead">
                <thead className="text-footnote text-fg-subtle">
                  <tr>
                    <th className="pb-2 pr-4">Name</th>
                    <th className="pb-2 pr-4">Email</th>
                    <th className="pb-2 pr-4">Roles</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t border-line">
                      <td className="py-2 pr-4 font-medium">{u.display_name}</td>
                      <td className="py-2 pr-4 text-fg-muted">{u.email}</td>
                      <td className="py-2 pr-4 text-fg-muted">{u.roles.join(", ") || "—"}</td>
                      <td className="py-2 pr-4">{u.status}</td>
                      <td className="py-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => toggleStatus(u)}>
                          {u.status === "DISABLED" ? "Enable" : "Disable"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
