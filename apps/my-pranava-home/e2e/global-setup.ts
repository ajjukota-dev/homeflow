import { request } from "@playwright/test";

// 26-customer-portal.md's real `/api/portal/*` API replaced the old placeholder `/api/me/home`
// (transparency.ts's staff-friendly firstActiveBooking() preview) this app used to run on — every
// portal endpoint now requires a real CUSTOMER-kind actor (rule 1: `myBooking(ctx)` throws
// "portal access requires a customer login" for any STAFF session, SUPER_ADMIN included). So the
// default storageState must be the seeded demo customer, not SUPER_ADMIN as before; auth.spec.ts
// separately covers the logged-out/wrong-password/sign-in flow with its own empty storageState.
export default async function globalSetup() {
  const ctx = await request.newContext({ baseURL: "http://localhost:5174" });
  const res = await ctx.post("/api/auth/login", { data: { email: "customer@demo.pranava", password: "Demo@2026" } });
  if (!res.ok()) throw new Error(`global-setup login failed: ${res.status()} ${await res.text()}`);
  await ctx.storageState({ path: "e2e/.auth/customer.json" });
  await ctx.dispose();
}
