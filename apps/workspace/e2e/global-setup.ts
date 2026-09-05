import { request } from "@playwright/test";

// Pre-existing specs (labels.spec.ts, visual.spec.ts) drive the app assuming
// it's already open — now every route needs a session (requireSession).
// Log in once as SUPER_ADMIN (sees every project/module) and reuse the cookie
// as storageState so those specs don't need to change.
export default async function globalSetup() {
  const ctx = await request.newContext({ baseURL: "http://localhost:5173" });
  const res = await ctx.post("/api/auth/login", { data: { email: "superadmin@demo.pranava", password: "Demo@2026" } });
  if (!res.ok()) throw new Error(`global-setup login failed: ${res.status()} ${await res.text()}`);
  await ctx.storageState({ path: "e2e/.auth/superadmin.json" });
  await ctx.dispose();
}
