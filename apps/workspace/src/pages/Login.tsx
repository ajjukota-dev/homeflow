import { useState, type FormEvent } from "react";
import { authApi, ApiError } from "../auth/api";
import { useAuth } from "../auth/AuthContext";
import { Button } from "../ui/Button";
import { Card, CardBody } from "../ui/Card";

const inputCls =
  "w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-body outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50";

/** /login (01-identity-access.md Screens): email/password, "Forgot password", error state. */
export function Login() {
  const { refresh } = useAuth();
  const [mode, setMode] = useState<"signin" | "forgot" | "forgot-sent">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await authApi.login(email.trim(), password);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError && e.code === "rate_limited" ? "Too many attempts — try again in 15 minutes." : "Incorrect email or password.");
    } finally {
      setBusy(false);
    }
  }

  async function submitForgot(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await authApi.requestReset(email.trim()).catch(() => undefined);
    setBusy(false);
    setMode("forgot-sent");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <Card className="w-full max-w-sm">
        <CardBody className="flex flex-col gap-5">
          <h1 className="text-title1 font-bold tracking-tight">
            {mode === "signin" ? "Sign in" : "Reset your password"}
          </h1>

          {mode === "signin" && (
            <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
              <label className="flex flex-col gap-1.5 text-subhead font-medium">
                Email
                <input
                  className={inputCls}
                  type="email"
                  autoComplete="username"
                  required
                  disabled={busy}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-subhead font-medium">
                Password
                <input
                  className={inputCls}
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={busy}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {error && (
                <p role="alert" className="text-footnote font-medium text-overdue">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy} className="mt-1 w-full">
                {busy ? "Signing in…" : "Sign in"}
              </Button>
              <button
                type="button"
                onClick={() => setMode("forgot")}
                className="text-footnote font-medium text-accent hover:underline"
              >
                Forgot password?
              </button>
            </form>
          )}

          {mode === "forgot" && (
            <form className="flex flex-col gap-4" onSubmit={submitForgot} noValidate>
              <p className="text-subhead text-fg-muted">Enter your email and we’ll send a reset link.</p>
              <label className="flex flex-col gap-1.5 text-subhead font-medium">
                Email
                <input
                  className={inputCls}
                  type="email"
                  required
                  disabled={busy}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? "Sending…" : "Send reset link"}
              </Button>
              <button type="button" onClick={() => setMode("signin")} className="text-footnote font-medium text-accent hover:underline">
                Back to sign in
              </button>
            </form>
          )}

          {mode === "forgot-sent" && (
            <div className="flex flex-col gap-4">
              <p className="text-subhead text-fg-muted">
                If an account exists for that email, a reset link is on its way.
              </p>
              <Button variant="outline" onClick={() => setMode("signin")} className="w-full">
                Back to sign in
              </Button>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
