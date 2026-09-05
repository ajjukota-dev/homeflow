/**
 * The HomeFlow API client (technical/09 §3).
 *
 * Cookie sessions, never a bearer token: `withCredentials` sends `hf_session`,
 * `X-Requested-With` satisfies the CSRF middleware (technical/03 §5), and the
 * response interceptor unwraps the `{ data, meta }` envelope (07 §1) so callers
 * see the payload, and turns every failure into a typed `ApiError` (07 §2).
 */
import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from "axios";

export interface ApiErrorShape {
  code: string;
  message: string;
  field?: string;
  source_ref?: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly field?: string;
  readonly source_ref?: string;
  readonly request_id?: string;
  /** Every error the envelope carried, not just the first. */
  readonly errors: ApiErrorShape[];

  constructor(init: {
    code: string;
    message: string;
    status: number;
    field?: string;
    source_ref?: string;
    request_id?: string;
    errors?: ApiErrorShape[];
  }) {
    super(init.message);
    this.name = "ApiError";
    this.code = init.code;
    this.status = init.status;
    this.field = init.field;
    this.source_ref = init.source_ref;
    this.request_id = init.request_id;
    this.errors = init.errors ?? [{ code: init.code, message: init.message }];
  }
}

type Envelope = {
  data?: unknown;
  meta?: { request_id?: string } & Record<string, unknown>;
  errors?: ApiErrorShape[];
};

export function toApiError(e: unknown): ApiError {
  const err = e as AxiosError<Envelope>;
  const status = err.response?.status ?? 0;
  const body = err.response?.data;
  const errors = Array.isArray(body?.errors) && body.errors.length > 0 ? body.errors : undefined;
  const first = errors?.[0];
  if (first) {
    return new ApiError({
      code: first.code,
      message: first.message,
      status,
      field: first.field,
      source_ref: first.source_ref,
      request_id: body?.meta?.request_id,
      errors,
    });
  }
  if (status === 0) {
    return new ApiError({ code: "NETWORK", message: "Could not reach HomeFlow. Check your connection.", status });
  }
  return new ApiError({ code: "UNEXPECTED", message: err.message || "Something went wrong.", status });
}

/** Listeners notified on 401 so the session store can flip to signed-out. */
const unauthenticatedListeners = new Set<() => void>();

export function onUnauthenticated(fn: () => void): () => void {
  unauthenticatedListeners.add(fn);
  return () => unauthenticatedListeners.delete(fn);
}

/**
 * Build a client. `unwrap: false` keeps the raw axios response for v1's routers,
 * which are still mounted at `/api/*` and do not use the envelope yet.
 * ponytail: one factory, two call sites. The legacy client disappears with the
 * last ported v1 page (TASKS Vivek 12-15).
 */
export function createClient(baseURL: string, opts: { unwrap?: boolean } = {}): AxiosInstance {
  const unwrap = opts.unwrap !== false;
  const instance = axios.create({
    baseURL,
    withCredentials: true,
    headers: { "X-Requested-With": "HomeFlow", "Content-Type": "application/json" },
  });
  instance.interceptors.response.use(
    (r) => (unwrap ? ((r.data as Envelope)?.data ?? r.data) : r),
    (e) => {
      const apiError = toApiError(e);
      if (apiError.status === 401) unauthenticatedListeners.forEach((fn) => fn());
      return Promise.reject(apiError);
    },
  );
  return instance;
}

export const api = createClient("/api/v1");

/** Typed convenience wrappers so pages do not repeat the generic every time. */
export const get = <T,>(url: string, config?: AxiosRequestConfig) => api.get(url, config) as unknown as Promise<T>;
export const post = <T,>(url: string, body?: unknown, config?: AxiosRequestConfig) =>
  api.post(url, body, config) as unknown as Promise<T>;
export const patch = <T,>(url: string, body?: unknown, config?: AxiosRequestConfig) =>
  api.patch(url, body, config) as unknown as Promise<T>;
export const del = <T,>(url: string, config?: AxiosRequestConfig) => api.delete(url, config) as unknown as Promise<T>;
