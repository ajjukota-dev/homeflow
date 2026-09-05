/**
 * Staff sign-in (technical/03 §1). One button: the browser leaves for Google and
 * comes back with a cookie. No password field exists anywhere in HomeFlow 2.0.
 *
 * `VITE_DEV_LOGIN=1` adds the seeded staff list, which hits `/auth/dev-login`.
 * The API refuses that route unless ENV=local and HOMEFLOW_DEV_LOGIN=1, so this
 * list is inert against staging or prod even if a build leaks the flag.
 */
import { useState } from "react";
import { Button } from "../components/Button";

/** Seeded by `seeds.config.demo_users` — kept here so the dev list needs no API call. */
export const DEV_USERS: readonly { email: string; name: string; role: string }[] = [
  { email: "aarti.rao@pranava.local", name: "Aarti Rao", role: "Super admin" },
  { email: "rambabu.k@pranava.local", name: "Rambabu K", role: "Management" },
  { email: "sneha.reddy@pranava.local", name: "Sneha Reddy", role: "CRM / RM" },
  { email: "nikhil.varma@pranava.local", name: "Nikhil Varma", role: "Sales" },
  { email: "prakash.iyer@pranava.local", name: "Prakash Iyer", role: "Accounts" },
  { email: "suresh.babu@pranava.local", name: "Suresh Babu", role: "Site engineer" },
];

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export interface StaffSignInProps {
  /** Path to return to after Google; defaults to the current location. */
  next?: string;
  devLogin?: boolean;
}

export function StaffSignIn({ next, devLogin = false }: StaffSignInProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const target = next ?? (typeof window === "undefined" ? "/" : window.location.pathname + window.location.search);

  const go = (href: string, key: string) => {
    setBusy(key);
    window.location.assign(href);
  };

  return (
    <div className="hf-signin" data-testid="staff-signin">
      <main className="hf-signin__card">
        <div className="hf-signin__brand">
          <span className="hf-signin__mark" aria-hidden>
            HF
          </span>
          <span className="hf-signin__wordmark">Pranava HomeFlow</span>
        </div>
        <h1>Sign in to HomeFlow</h1>
        <p className="hf-signin__lede">
          Use your Pranava Workspace account. Accounts are created by an administrator — if yours is not recognised, ask
          them to add you.
        </p>
        <Button
          block
          variant="secondary"
          loading={busy === "google"}
          onClick={() => go(`/auth/google/start?next=${encodeURIComponent(target)}`, "google")}
          data-testid="signin-google"
        >
          <GoogleG />
          Continue with Google
        </Button>

        {devLogin && (
          <>
            <div className="hf-signin__divider">Local development</div>
            <ul className="hf-signin__devlist" data-testid="signin-devlist">
              {DEV_USERS.map((u) => (
                <li key={u.email}>
                  <button
                    type="button"
                    className="hf-signin__devuser"
                    disabled={busy !== null}
                    onClick={() => go(`/auth/dev-login?user=${encodeURIComponent(u.email)}`, u.email)}
                  >
                    <span>{u.name}</span>
                    <small>
                      {u.role} · {u.email}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
            <p className="hf-signin__foot">
              Seeded users, local only. The API rejects this route unless <code>ENV=local</code>.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
