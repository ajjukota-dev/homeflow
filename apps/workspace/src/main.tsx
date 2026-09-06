import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@homeflow/ui";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import "./index.css";

// TooltipProvider wired at the root: Radix's Tooltip throws ("must be used within
// TooltipProvider") without it — found via a real test crash building 13-promise-ledger.md's
// confidence-driver tooltip, this component's first consumer anywhere in this app.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </TooltipProvider>
  </StrictMode>
);
