import { useEffect, useState, type ReactNode } from "react";
import { Login } from "./Login";
import { ResetPassword } from "./ResetPassword";
import { InviteAccept } from "./InviteAccept";
import { useAuth } from "./AuthContext";

/** Minimal pathname router: /invite/:token and /reset/:token are public;
 * everything else is gated by requireSession via GET /auth/me. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const inviteToken = path.match(/^\/invite\/([^/]+)/)?.[1];
  const resetToken = path.match(/^\/reset\/([^/]+)/)?.[1];

  if (inviteToken) return <InviteAccept token={inviteToken} />;
  if (resetToken)
    return (
      <ResetPassword
        token={resetToken}
        onDone={() => {
          window.history.pushState({}, "", "/");
          setPath("/");
        }}
      />
    );

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="h-10 w-10 animate-pulse rounded-full bg-surface-2" />
      </div>
    );
  }

  if (status === "unauthenticated") return <Login />;

  return <>{children}</>;
}
