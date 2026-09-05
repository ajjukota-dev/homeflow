import { useState, type FormEvent } from "react";
import { authApi } from "../auth/api";
import { useAuth } from "../auth/AuthContext";
import { Button } from "../ui/Button";
import { Card, CardBody } from "../ui/Card";

const inputCls =
  "w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-body outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50";

/** /invite/:token (01-identity-access.md Screens) — the live invite smoke test's set-password step. */
export function InviteAccept({ token }: { token: string }) {
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
      await refresh(); // lands in the actor's workspace (e.g. Management)
    } catch {
      setError("This invite link is invalid or has expired.");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <Card className="w-full max-w-sm">
        <CardBody className="flex flex-col gap-5">
          <h1 className="text-title1 font-bold tracking-tight">Set your password</h1>
          <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
            <label className="flex flex-col gap-1.5 text-subhead font-medium">
              Password
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
              {busy ? "Setting up…" : "Set password and continue"}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
