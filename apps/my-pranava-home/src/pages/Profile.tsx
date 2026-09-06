import { useState } from "react";
import { AreaScreen } from "../components/AreaScreen";
import { useAuth } from "../auth/AuthContext";
import { authApi } from "../auth/api";

/** 26-customer-portal.md "Profile (contact prefs, password)". No authenticated change-password
 *  or contact-preference endpoint exists yet (only the token-based reset flow from 01) — this
 *  sends a real reset link rather than fabricating an in-session password form; contact-pref
 *  editing is flagged, not built. */
export function Profile({ onBack }: { onBack: () => void }) {
  const { me, logout } = useAuth();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function sendReset() {
    if (!me) return;
    setBusy(true);
    try {
      await authApi.requestReset(me.user.email);
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AreaScreen title="Profile" onBack={onBack} loading={false} error={false} onRetry={() => {}}>
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <p className="text-body font-semibold">{me?.user.display_name}</p>
          <p className="mt-1 text-footnote text-fg-muted">{me?.user.email}</p>
        </div>

        <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <p className="text-body font-semibold">Password</p>
          <p className="mt-1 text-footnote text-fg-muted">We'll email you a link to set a new one.</p>
          <button onClick={sendReset} disabled={busy || sent} className="mt-3 text-footnote font-medium text-accent disabled:opacity-60">
            {sent ? "Reset link sent — check your email" : busy ? "Sending…" : "Send reset link"}
          </button>
        </div>

        <button onClick={logout} className="rounded-full border border-line px-4 py-2.5 text-body font-medium text-fg">
          Log out
        </button>
      </div>
    </AreaScreen>
  );
}
