/**
 * Renders the realm-appropriate sign-in whenever the session store says
 * anonymous, and the app once it says authenticated (technical/09 §3–§4).
 */
import type { ReactNode } from "react";
import { ErrorState } from "../components/ErrorState";
import { SkeletonTable } from "../components/Skeleton";
import { CustomerSignIn } from "./CustomerSignIn";
import { StaffSignIn } from "./StaffSignIn";
import { useSession } from "./session";

export interface SignInGateProps {
  realm: "staff" | "customer";
  devLogin?: boolean;
  children: ReactNode;
  /** Shown while the first /me/session call is in flight. */
  fallback?: ReactNode;
}

export function SignInGate({ realm, devLogin = false, children, fallback }: SignInGateProps) {
  const { state, reload } = useSession();

  if (state.status === "loading") {
    return (
      <div className="hf-signin">
        <div className="hf-signin__card">{fallback ?? <SkeletonTable rows={3} columns={1} />}</div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="hf-signin">
        <div className="hf-signin__card">
          <ErrorState error={state.error} onRetry={() => void reload()} title="We couldn’t check your sign-in" />
        </div>
      </div>
    );
  }
  if (state.status === "anonymous") {
    return realm === "staff" ? <StaffSignIn devLogin={devLogin} /> : <CustomerSignIn onSignedIn={() => void reload()} />;
  }
  return <>{children}</>;
}
