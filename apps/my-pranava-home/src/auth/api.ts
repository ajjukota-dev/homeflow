// Auth API client (01-identity-access.md API). Cookies ride same-origin
// (Vite proxies /api → the local API).
export interface Me {
  user: { id: string; email: string; display_name: string; kind: "STAFF" | "CUSTOMER" };
  roles: string[];
  project_ids: string[] | "ALL";
  default_project_id: string | null;
}

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const first = body.errors?.[0] ?? { code: "bad_request", message: `API ${res.status}` };
    throw new ApiError(first.code, first.message ?? first.code);
  }
  return body.data as T;
}

function post<T>(url: string, body: unknown): Promise<T> {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) =>
    unwrap<T>(r)
  );
}

export const authApi = {
  login: (email: string, password: string) => post<{ actor: unknown }>("/api/auth/login", { email, password }),
  logout: () => post<{ ok: boolean }>("/api/auth/logout", {}),
  me: () => fetch("/api/auth/me").then((r) => unwrap<Me>(r)),
  requestReset: (email: string) => post<{ ok: boolean }>("/api/auth/reset/request", { email }),
  completeReset: (token: string, password: string) => post<{ ok: boolean }>("/api/auth/reset/complete", { token, password }),
  acceptInvite: (token: string, password: string) => post<{ actor: unknown }>("/api/auth/invite/accept", { token, password }),
};
