import { useState, type FormEvent } from "react";
import { authApi } from "./api";
import { useAuth } from "./AuthContext";

const inputCls = "w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-body outline-none focus-visible:border-accent disabled:opacity-50";
const buttonCls = "w-full rounded-lg bg-accent px-4 py-2.5 text-body font-semibold text-accent-fg disabled:opacity-50";

/** /invite/:token (01-identity-access.md Screens, portal) — booking-bound customer invite. */
export function InviteAccept({ token, onDone }: { token: string; onDone: () => void }) {
  const { refresh } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    try {
      await authApi.acceptInvite(token, password);
      await refresh();
      onDone(); // leave /invite/:token so the app renders the customer's booking
    } catch {
      setError("This invite link is invalid or has expired.");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-5">
      <h1 className="text-title font-bold tracking-tight">Set your password</h1>
      <form className="mt-6 flex flex-col gap-4" onSubmit={submit} noValidate>
        <label className="flex flex-col gap-1.5 text-footnote font-medium">
          Password
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
          {busy ? "Setting up…" : "Set password and continue"}
        </button>
      </form>
    </div>
  );
}
