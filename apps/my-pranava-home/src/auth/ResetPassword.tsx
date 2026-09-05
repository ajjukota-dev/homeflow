import { useState, type FormEvent } from "react";
import { authApi } from "./api";

const inputCls = "w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-body outline-none focus-visible:border-accent disabled:opacity-50";
const buttonCls = "w-full rounded-lg bg-accent px-4 py-2.5 text-body font-semibold text-accent-fg disabled:opacity-50";

/** /reset/:token (01-identity-access.md Screens, portal + Rule 3). */
export function ResetPassword({ token, onDone }: { token: string; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    try {
      await authApi.completeReset(token, password);
      setDone(true);
    } catch {
      setError("This reset link is invalid or has expired.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-5">
      <h1 className="text-title font-bold tracking-tight">Set a new password</h1>
      {done ? (
        <div className="mt-6 flex flex-col gap-4">
          <p className="text-footnote text-fg-muted">Your password has been reset. Sign in with your new password.</p>
          <button className={buttonCls} onClick={onDone}>
            Go to sign in
          </button>
        </div>
      ) : (
        <form className="mt-6 flex flex-col gap-4" onSubmit={submit} noValidate>
          <label className="flex flex-col gap-1.5 text-footnote font-medium">
            New password
            <input className={inputCls} type="password" autoComplete="new-password" required disabled={busy} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5 text-footnote font-medium">
            Confirm password
            <input className={inputCls} type="password" autoComplete="new-password" required disabled={busy} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          {error && (
            <p role="alert" className="text-footnote font-medium text-atrisk">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy} className={buttonCls}>
            {busy ? "Saving…" : "Set password"}
          </button>
        </form>
      )}
    </div>
  );
}
