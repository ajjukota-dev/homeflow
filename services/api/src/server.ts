import express from "express";
import cors from "cors";
import { initDb, checkHealth } from "./db";
import { registerStaticRoutes } from "./static";
import { registerLocalFileRoutes } from "./ports/files";
import { listUnits, getUnit, setProgress } from "./handlers";
import {
  MANDATORY_DOCS,
  createBooking,
  listBookings,
  acceptBooking,
  returnBooking,
  listCustomers,
  getCustomer,
} from "./bookings";
import { getCustomerHome, firstActiveBooking, bookingForCustomerUser } from "./customer";
import { listProjects, createProject, createUnit } from "./projects";
import {
  listDemands,
  setOverdueReason,
  recordPtp,
} from "./demands";
import { postReceipt } from "./demands-receipts";
import { projectCollections, listOverdueReasons } from "./collections-view";
import { registerLifecycleRoutes } from "./routes-lifecycle";
import { registerAuthRoutes } from "./auth/routes";
import { requireSession, type AuthedRequest } from "./auth/middleware";
import { registerModelRoutes } from "./routes-model";
import { registerJourneyRoutes } from "./routes-journey";
import { registerJourneyInstanceRoutes } from "./routes-journey-instances";
import { registerActionRoutes } from "./routes-actions";
import { registerStudioRoutes } from "./routes-studio";
import { registerCollectionsRoutes } from "./routes-collections";
import { registerLoanRoutes } from "./routes-loans";
import { registerEscalationRoutes } from "./routes-escalations";
import { registerCommitmentRoutes } from "./routes-commitments";
import { registerScoreRoutes } from "./routes-scores";
import { registerMyDayRoutes } from "./routes-myday";
import { registerSalesHandoverRoutes } from "./routes-sales-handover";
import { registerProgressRoutes } from "./routes-progress";
import { registerQaRoutes } from "./routes-qa";
import { registerChangeabilityRoutes } from "./routes-changeability";
import { registerSalesRoutes } from "./routes-sales";
import { registerSpecificationRoutes } from "./routes-specification";
import { registerDocumentRoutes } from "./routes-documents";
import { registerChangeRequestRoutes } from "./routes-change-requests";
import { registerRegistrationRoutes } from "./routes-registration";
import { registerHandoverRoutes } from "./routes-handover";
import { registerNotificationRoutes } from "./routes-notifications";
import { registerForecastRoutes } from "./routes-forecast";
import { registerPortalRoutes } from "./routes-portal";
import { getAudit } from "./events";
import { failHttp } from "./authz/httpError";

// Local API gateway. Handlers are Lambda-portable; this Express wrapper is the local
// mirror (architecture.md §6b) — the same handlers run behind API Gateway on AWS.
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Container health check (03-platform-deploy.md) — checks the DB, used by App
// Runner and the deploy smoke test. Registered before requireSession: App
// Runner's health probe carries no session cookie.
app.get("/health", async (_req, res) => {
  const dbOk = await checkHealth();
  res.status(dbOk ? 200 : 503).json({ ok: dbOk, db: dbOk });
});

// 01-identity-access.md API: auth routes are public/self-gated; requireSession
// below covers every other route ("on every non-auth route").
registerAuthRoutes(app);
app.use(requireSession);

app.get("/api/units", async (req: AuthedRequest, res) => {
  try {
    res.json({ data: await listUnits(req.query.project_id as string | undefined, { actor: req.actor! }) });
  } catch (e) {
    failHttp(res, e);
  }
});

// --- Projects & unit creation (project-site master data) ---
app.get("/api/projects", async (req: AuthedRequest, res) => {
  try {
    res.json({ data: await listProjects({ actor: req.actor! }) });
  } catch (e) {
    failHttp(res, e);
  }
});

app.post("/api/projects", async (req: AuthedRequest, res) => {
  try {
    res.json({ data: await createProject(req.body, { actor: req.actor! }) });
  } catch (e) {
    failHttp(res, e);
  }
});

app.post("/api/projects/:id/units", async (req: AuthedRequest, res) => {
  try {
    res.json({ data: await createUnit(req.params.id, req.body, { actor: req.actor! }) });
  } catch (e) {
    failHttp(res, e);
  }
});

app.get("/api/units/:id", async (req: AuthedRequest, res) => {
  try {
    const unit = await getUnit(req.params.id, { actor: req.actor! });
    if (!unit) return res.status(404).json({ errors: [{ code: "not_found" }] });
    res.json({ data: unit });
  } catch (e) {
    failHttp(res, e);
  }
});

app.put("/api/units/:id/progress", async (req: AuthedRequest, res) => {
  const { component_code, state_code } = req.body ?? {};
  if (!component_code || !state_code) {
    return res.status(400).json({ errors: [{ code: "missing_fields" }] });
  }
  try {
    const unit = await setProgress(req.params.id, component_code, state_code, { actor: req.actor! });
    res.json({ data: unit });
  } catch (e) {
    failHttp(res, e);
  }
});

// --- Bookings + CRM handoff (H2) ---
app.get("/api/booking-config", (_req, res) => res.json({ data: { mandatory_docs: MANDATORY_DOCS } }));

app.post("/api/units/:id/book", async (req: AuthedRequest, res) => {
  try {
    res.json({ data: await createBooking(req.params.id, req.body, { actor: req.actor! }) });
  } catch (e) {
    const err = e as Error & { missing?: string[] };
    if (err.missing) return res.status(400).json({ errors: [{ code: "incomplete", missing: err.missing }] });
    failHttp(res, e);
  }
});

app.get("/api/bookings", async (req: AuthedRequest, res) => {
  try {
    res.json({ data: await listBookings(req.query.status as string | undefined, { actor: req.actor! }) });
  } catch (e) {
    failHttp(res, e);
  }
});

app.post("/api/bookings/:id/accept", async (req: AuthedRequest, res) => {
  try {
    res.json({ data: await acceptBooking(req.params.id, { actor: req.actor! }) });
  } catch (e) {
    failHttp(res, e);
  }
});

app.post("/api/bookings/:id/return", async (req: AuthedRequest, res) => {
  const reason = req.body?.reason;
  if (!reason) return res.status(400).json({ errors: [{ code: "missing_reason" }] });
  try {
    res.json({ data: await returnBooking(req.params.id, reason, { actor: req.actor! }) });
  } catch (e) {
    failHttp(res, e);
  }
});

// --- My Pranava Home (customer portal, H10-filtered) ---
// 01-identity-access.md Rule 4: a CUSTOMER session always resolves to its own
// booking via customer_login — booking_id/firstActiveBooking() fallbacks are
// for staff previewing the portal only, never for an authenticated customer
// (that used to leak whichever booking was "first active" to any customer).
app.get("/api/me/home", async (req: AuthedRequest, res) => {
  const actor = req.actor!;
  const bookingId =
    actor.kind === "CUSTOMER" ? await bookingForCustomerUser(actor.user_id) : (req.query.booking_id as string) || (await firstActiveBooking());
  if (!bookingId) return res.status(404).json({ errors: [{ code: "no_booking" }] });
  try {
    const home = await getCustomerHome(bookingId, { actor });
    if (!home) return res.status(404).json({ errors: [{ code: "not_found" }] });
    res.json({ data: home });
  } catch (e) {
    failHttp(res, e);
  }
});

app.get("/api/customers", async (req: AuthedRequest, res) => {
  try {
    res.json({ data: await listCustomers({ actor: req.actor! }) });
  } catch (e) {
    failHttp(res, e);
  }
});
app.get("/api/customers/:id", async (req: AuthedRequest, res) => {
  try {
    const c = await getCustomer(req.params.id, { actor: req.actor! });
    if (!c) return res.status(404).json({ errors: [{ code: "not_found" }] });
    res.json({ data: c });
  } catch (e) {
    failHttp(res, e);
  }
});

// --- Accounts / collections (H3, true-risk, T2 source) ---
app.get("/api/bookings/:id/demands", async (req: AuthedRequest, res) => {
  try {
    res.json({ data: await listDemands(req.params.id, undefined, { actor: req.actor! }) });
  } catch (e) {
    failHttp(res, e);
  }
});

app.get("/api/overdue-reasons", async (req: AuthedRequest, res) => {
  try {
    res.json({ data: await listOverdueReasons({ actor: req.actor! }) });
  } catch (e) {
    failHttp(res, e);
  }
});

app.get("/api/projects/:id/collections", async (req: AuthedRequest, res) => {
  try {
    res.json({ data: await projectCollections(req.params.id, undefined, { actor: req.actor! }) });
  } catch (e) {
    failHttp(res, e);
  }
});

app.post("/api/demands/:id/receipt", async (req: AuthedRequest, res) => {
  try {
    const key = (req.headers["idempotency-key"] as string | undefined) ?? req.body?.idempotency_key;
    res.json({
      data: await postReceipt(
        req.params.id,
        {
          amount: Number(req.body?.amount),
          mode: req.body?.mode,
          idempotency_key: key,
        },
        { actor: req.actor! }
      ),
    });
  } catch (e) {
    failHttp(res, e);
  }
});

app.post("/api/demands/:id/overdue-reason", async (req: AuthedRequest, res) => {
  try {
    // note (19-collections-true-risk.md rule 2) is optional — existing callers that only send
    // reason_code keep working unchanged.
    res.json({ data: await setOverdueReason(req.params.id, req.body?.reason_code, { actor: req.actor! }, req.body?.note) });
  } catch (e) {
    failHttp(res, e);
  }
});

app.post("/api/demands/:id/ptp", async (req: AuthedRequest, res) => {
  try {
    res.json({
      data: await recordPtp(
        req.params.id,
        {
          expected_date: req.body?.expected_date,
          expected_amount: Number(req.body?.expected_amount),
        },
        { actor: req.actor! }
      ),
    });
  } catch (e) {
    failHttp(res, e);
  }
});

// --- Audit (02 §API) — paged, masked; the workspace Activity tab reads this ---
app.get("/api/audit", async (req: AuthedRequest, res) => {
  try {
    const result = await getAudit(
      {
        entity_type: req.query.entity_type as string | undefined,
        entity_id: req.query.entity_id as string | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
        page: req.query.page ? Number(req.query.page) : undefined,
        page_size: req.query.page_size ? Number(req.query.page_size) : undefined,
      },
      { actor: req.actor! }
    );
    res.json({ data: result.data, page: result.page, page_size: result.page_size, total: result.total });
  } catch (e) {
    failHttp(res, e);
  }
});

registerLifecycleRoutes(app);
registerModelRoutes(app);
registerJourneyRoutes(app);
registerJourneyInstanceRoutes(app);
registerActionRoutes(app);
registerStudioRoutes(app);
registerCollectionsRoutes(app);
registerLoanRoutes(app);
registerEscalationRoutes(app);
registerNotificationRoutes(app);
registerCommitmentRoutes(app);
registerScoreRoutes(app);
registerMyDayRoutes(app);
registerSalesHandoverRoutes(app);
registerProgressRoutes(app);
registerQaRoutes(app);
registerChangeabilityRoutes(app);
registerSalesRoutes(app);
registerSpecificationRoutes(app);
registerDocumentRoutes(app);
registerChangeRequestRoutes(app);
registerRegistrationRoutes(app);
registerHandoverRoutes(app);
registerForecastRoutes(app);
registerPortalRoutes(app);

// files port: local-disk adapter serves its own presigned-URL routes; the
// s3 adapter needs no server route (real presigned URLs hit S3 directly).
if (!process.env.FILES_BUCKET) registerLocalFileRoutes(app);

// Any /api/* path not matched above is a real API 404, not the SPA shell —
// without this, static.ts's catch-all `app.get("*")` would hand other lanes
// an HTML index page for a typo'd or not-yet-built route (found in review).
app.use("/api", (_req, res) => res.status(404).json({ errors: [{ code: "not_found" }] }));

// Static SPA hosting (container only — see static.ts) must come after every
// /api/* route so it never shadows them.
registerStaticRoutes(app);

const PORT = Number(process.env.PORT ?? 3001);
initDb().then(() => {
  app.listen(PORT, () => console.log(`HomeFlow API ready → http://localhost:${PORT}`));
});
