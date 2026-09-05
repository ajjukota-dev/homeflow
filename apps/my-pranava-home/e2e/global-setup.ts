import { request } from "@playwright/test";

// Pre-existing visual.spec.ts drives the app assuming it's already open, and
// its fixtures (e.g. "V110's flooring hasn't started") are written against
// whichever booking firstActiveBooking() picks — which only happens for a
// STAFF session (/api/me/home resolves a CUSTOMER session to its own booking
// via customer_login instead, so logging in as the demo customer here would
// silently swap that spec onto Ananya Rao's booking and break its assertions).
// Log in as SUPER_ADMIN as the default storageState; auth.spec.ts overrides
// this per-test to exercise the real customer login.
export default async function globalSetup() {
  const ctx = await request.newContext({ baseURL: "http://localhost:5174" });
  const res = await ctx.post("/api/auth/login", { data: { email: "superadmin@demo.pranava", password: "Demo@2026" } });
  if (!res.ok()) throw new Error(`global-setup login failed: ${res.status()} ${await res.text()}`);
  await ctx.storageState({ path: "e2e/.auth/superadmin.json" });
  await ctx.dispose();
}
