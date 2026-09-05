import { useEffect, useState } from "react";
import { Login } from "./pages/Login";
import { ResetPassword } from "./pages/ResetPassword";
import { InviteAccept } from "./pages/InviteAccept";
import { useAuth } from "./auth/AuthContext";
import { Workspace } from "./Workspace";

// Minimal pathname router (no react-router dependency): /invite/:token and
// /reset/:token are public; everything else is gated by requireSession via
// GET /auth/me (01-identity-access.md Screens).
function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = (to: string) => {
    window.history.pushState({}, "", to);
    setPath(to);
  };
  return { path, navigate };
}

export function App() {
  const { status, me, logout } = useAuth();
  const { path, navigate } = usePath();

  const inviteToken = path.match(/^\/invite\/([^/]+)/)?.[1];
  const resetToken = path.match(/^\/reset\/([^/]+)/)?.[1];

  if (inviteToken) return <InviteAccept token={inviteToken} />;
  if (resetToken) return <ResetPassword token={resetToken} onDone={() => navigate("/")} />;

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="h-10 w-10 animate-pulse rounded-full bg-surface-2" />
      </div>
    );
  }

  if (status === "unauthenticated" || !me) return <Login />;

  return <Workspace me={me} onLogout={logout} />;
}
