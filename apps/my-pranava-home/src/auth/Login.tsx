import { useState, type FormEvent } from "react";
import { authApi, ApiError } from "./api";
import { useAuth } from "./AuthContext";

const inputCls = "w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-body outline-none focus-visible:border-accent disabled:opacity-50";
const buttonCls = "w-full rounded-lg bg-accent px-4 py-2.5 text-body font-semibold text-accent-fg disabled:opacity-50";

/** /login (01-identity-access.md Screens, portal): email/password, forgot password, error state. */
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
    <div className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-5">
      <h1 className="text-title font-bold tracking-tight">{mode === "signin" ? "Sign in" : "Reset your password"}</h1>

      {mode === "signin" && (
        <form className="mt-6 flex flex-col gap-4" onSubmit={submit} noValidate>
          <label className="flex flex-col gap-1.5 text-footnote font-medium">
            Email
            <input className={inputCls} type="email" autoComplete="username" required disabled={busy} value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5 text-footnote font-medium">
            Password
            <input className={inputCls} type="password" autoComplete="current-password" required disabled={busy} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && (
            <p role="alert" className="text-footnote font-medium text-atrisk">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy} className={buttonCls}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <button type="button" onClick={() => setMode("forgot")} className="text-footnote font-medium text-accent">
            Forgot password?
          </button>
        </form>
      )}

      {mode === "forgot" && (
        <form className="mt-6 flex flex-col gap-4" onSubmit={submitForgot} noValidate>
          <p className="text-footnote text-fg-muted">Enter your email and we’ll send a reset link.</p>
          <label className="flex flex-col gap-1.5 text-footnote font-medium">
            Email
            <input className={inputCls} type="email" required disabled={busy} value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button type="submit" disabled={busy} className={buttonCls}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
          <button type="button" onClick={() => setMode("signin")} className="text-footnote font-medium text-accent">
            Back to sign in
          </button>
        </form>
      )}

      {mode === "forgot-sent" && (
        <div className="mt-6 flex flex-col gap-4">
          <p className="text-footnote text-fg-muted">If an account exists for that email, a reset link is on its way.</p>
          <button onClick={() => setMode("signin")} className={buttonCls}>
            Back to sign in
          </button>
        </div>
      )}
    </div>
  );
}
