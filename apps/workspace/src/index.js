import React from "react";
import ReactDOM from "react-dom/client";
import { SessionProvider } from "@homeflow/ui";

import "@homeflow/ui/ui.css";
import "@/index.css";
import App from "@/App";

// SessionProvider makes the one GET /me/session call and owns signed-in state
// for the whole app (technical/09 §4). AuthProvider adapts it to v1's shape.
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </React.StrictMode>,
);
