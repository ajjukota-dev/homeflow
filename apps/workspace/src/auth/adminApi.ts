// Admin API client — Users / Teams & Assignments / Permission matrix screens.
import { ApiError } from "./api";

export interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  status: string;
  kind: string;
  roles: string[];
}

export interface Assignment {
  id: string;
  project_id: string;
  team_id: string | null;
  user_id: string;
  department: string;
  role_scope: string;
  assignment_type: string;
  is_primary_owner: boolean;
  is_backup_owner: boolean;
  effective_from: string;
  effective_to: string | null;
  capacity_pct: number;
  escalation_manager_user_id?: string | null;
}

export interface PermissionRow {
  role_code: string;
  module: string;
  level: string;
  effective_from: string;
  effective_to: string | null;
  version: number;
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const first = body.errors?.[0] ?? { code: "bad_request", message: `API ${res.status}` };
    throw new ApiError(first.code, first.message ?? first.code);
  }
  return body.data as T;
}

function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  return fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => unwrap<T>(r));
}

export const adminApi = {
  listUsers: () => req<AdminUser[]>("GET", "/api/admin/users"),
  createUser: (input: { email: string; display_name: string; roles: string[]; kind?: "STAFF" | "CUSTOMER" }) =>
    req<{ id: string }>("POST", "/api/admin/users", input),
  updateUser: (id: string, input: { display_name?: string; roles?: string[]; status?: "ACTIVE" | "DISABLED" }) =>
    req<{ ok: boolean }>("PATCH", `/api/admin/users/${id}`, input),
  listAssignments: (projectId?: string) =>
    req<Assignment[]>("GET", `/api/admin/assignments${projectId ? `?project_id=${projectId}` : ""}`),
  createAssignment: (input: Omit<Assignment, "id">) => req<{ id: string }>("POST", "/api/admin/assignments", input),
  updateAssignment: (id: string, input: Partial<Assignment>) => req<{ ok: boolean }>("PATCH", `/api/admin/assignments/${id}`, input),
  getPermissionMatrix: () => req<PermissionRow[]>("GET", "/api/admin/permission-matrix"),
  putPermissionMatrix: (changes: { role_code: string; module: string; level: string }[]) =>
    req<{ ok: boolean }>("PUT", "/api/admin/permission-matrix", { changes }),
};
