import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Home } from "./Home";
import { AuthProvider } from "./auth/AuthContext";
import { AuthGate } from "./auth/AuthGate";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <AuthGate>
        <Home />
      </AuthGate>
    </AuthProvider>
  </StrictMode>
);
