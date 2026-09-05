/**
 * Legacy client for v1's routers, which are still mounted bare under `/api/*`
 * and do not speak the `{data, meta}` envelope yet (technical/07 §1).
 *
 * What changed from v1: there is no token in JavaScript any more. The
 * `hf_session` cookie travels with `withCredentials`, `X-Requested-With`
 * satisfies the CSRF middleware (technical/03 §5), and the localStorage token
 * store, the `Authorization` header, the refresh queue and the redirect to
 * `/login` on 401 are all gone — a 401 now flips `useSession()` to signed-out
 * and the sign-in gate takes over.
 *
 * ponytail: this module exists only while v1 routers do. New code imports
 * `api` from `@homeflow/ui`, which targets `/api/v1`. Each ported page deletes
 * one more importer of this file (TASKS Vivek 12-15).
 */
import { createClient } from "@homeflow/ui";
import { toast } from "sonner";

export const API_BASE = "/api";

export const api = createClient(API_BASE, { unwrap: false });

/** A readable message for any failure. Structured RBAC denials stay silent. */
export function apiErrorMessage(err) {
  if (!err) return "Something went wrong.";
  if (err.code === "FORBIDDEN") return "";
  return err.message || "Something went wrong.";
}

export function apiErrorToast(err) {
  const msg = apiErrorMessage(err);
  if (!msg || !msg.trim()) return;
  toast.error(msg);
}
