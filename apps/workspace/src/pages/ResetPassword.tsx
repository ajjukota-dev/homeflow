import { useState, type FormEvent } from "react";
import { authApi } from "../auth/api";
import { Button, Card, CardBody } from "@homeflow/ui";

const inputCls =
  "w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-body outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50";

/** /reset/:token (01-identity-access.md Screens + Rule 3). */
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
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <Card className="w-full max-w-sm">
        <CardBody className="flex flex-col gap-5">
          <h1 className="text-title1 font-bold tracking-tight">Set a new password</h1>
          {done ? (
            <div className="flex flex-col gap-4">
              <p className="text-subhead text-fg-muted">Your password has been reset. Sign in with your new password.</p>
              <Button className="w-full" onClick={onDone}>
                Go to sign in
              </Button>
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
              <label className="flex flex-col gap-1.5 text-subhead font-medium">
                New password
                <input className={inputCls} type="password" autoComplete="new-password" required disabled={busy} value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1.5 text-subhead font-medium">
                Confirm password
                <input className={inputCls} type="password" autoComplete="new-password" required disabled={busy} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </label>
              {error && (
                <p role="alert" className="text-footnote font-medium text-overdue">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? "Saving…" : "Set password"}
              </Button>
            </form>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
