import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SessionProvider, SignInGate } from "@homeflow/ui";
import { Home } from "./Home";

import "@homeflow/ui/ui.css";
import "./index.css";

// The customer skin is selected by a data attribute, so one token file serves
// both apps (packages/ui/src/tokens.css).
document.documentElement.dataset.skin = "customer";

// Who the viewer is comes from the session cookie via GET /me/session — never
// from a `?booking_id=` in the URL (technical/03 §2, TASKS Vivek 5 ⟲).
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SessionProvider>
      <SignInGate realm="customer">
        <Home />
      </SignInGate>
    </SessionProvider>
  </StrictMode>,
);
