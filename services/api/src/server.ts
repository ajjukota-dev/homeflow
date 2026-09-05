import express from "express";
import cors from "cors";
import { initDb } from "./db";
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
import { getCustomerHome, firstActiveBooking } from "./customer";
import { listProjects, createProject, createUnit } from "./projects";
import {
  listDemands,
  setOverdueReason,
  recordPtp,
} from "./demands";
import { postReceipt } from "./demands-receipts";
import { projectCollections, listOverdueReasons } from "./collections-view";
import { registerLifecycleRoutes } from "./routes-lifecycle";
import { getAudit } from "./events";

// Local API gateway. Handlers are Lambda-portable; this Express wrapper is the local
// mirror (architecture.md §6b) — the same handlers run behind API Gateway on AWS.
const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/units", async (req, res) => {
  res.json({ data: await listUnits(req.query.project_id as string | undefined) });
});

// --- Projects & unit creation (project-site master data) ---
app.get("/api/projects", async (_req, res) => res.json({ data: await listProjects() }));

app.post("/api/projects", async (req, res) => {
  try {
    res.json({ data: await createProject(req.body) });
  } catch (e) {
    res.status(400).json({ errors: [{ code: "bad_request", message: String((e as Error).message) }] });
  }
});

app.post("/api/projects/:id/units", async (req, res) => {
  try {
    res.json({ data: await createUnit(req.params.id, req.body) });
  } catch (e) {
    res.status(400).json({ errors: [{ code: "bad_request", message: String((e as Error).message) }] });
  }
});

app.get("/api/units/:id", async (req, res) => {
  const unit = await getUnit(req.params.id);
  if (!unit) return res.status(404).json({ errors: [{ code: "not_found" }] });
  res.json({ data: unit });
});

app.put("/api/units/:id/progress", async (req, res) => {
  const { component_code, state_code } = req.body ?? {};
  if (!component_code || !state_code) {
    return res.status(400).json({ errors: [{ code: "missing_fields" }] });
  }
  try {
    const unit = await setProgress(req.params.id, component_code, state_code);
    res.json({ data: unit });
  } catch (e) {
    res.status(400).json({ errors: [{ code: "bad_request", message: String(e) }] });
  }
});

// --- Bookings + CRM handoff (H2) ---
app.get("/api/booking-config", (_req, res) => res.json({ data: { mandatory_docs: MANDATORY_DOCS } }));

app.post("/api/units/:id/book", async (req, res) => {
  try {
    res.json({ data: await createBooking(req.params.id, req.body) });
  } catch (e) {
    const err = e as Error & { missing?: string[] };
    if (err.missing) return res.status(400).json({ errors: [{ code: "incomplete", missing: err.missing }] });
    res.status(400).json({ errors: [{ code: "bad_request", message: String(err.message) }] });
  }
});

app.get("/api/bookings", async (req, res) => {
  res.json({ data: await listBookings(req.query.status as string | undefined) });
});

app.post("/api/bookings/:id/accept", async (req, res) => {
  try {
    res.json({ data: await acceptBooking(req.params.id) });
  } catch (e) {
    res.status(400).json({ errors: [{ code: "bad_request", message: String((e as Error).message) }] });
  }
});

app.post("/api/bookings/:id/return", async (req, res) => {
  const reason = req.body?.reason;
  if (!reason) return res.status(400).json({ errors: [{ code: "missing_reason" }] });
  res.json({ data: await returnBooking(req.params.id, reason) });
});

// --- My Pranava Home (customer portal, H10-filtered) ---
app.get("/api/me/home", async (req, res) => {
  const bookingId = (req.query.booking_id as string) || (await firstActiveBooking());
  if (!bookingId) return res.status(404).json({ errors: [{ code: "no_booking" }] });
  const home = await getCustomerHome(bookingId);
  if (!home) return res.status(404).json({ errors: [{ code: "not_found" }] });
  res.json({ data: home });
});

app.get("/api/customers", async (_req, res) => res.json({ data: await listCustomers() }));
app.get("/api/customers/:id", async (req, res) => {
  const c = await getCustomer(req.params.id);
  if (!c) return res.status(404).json({ errors: [{ code: "not_found" }] });
  res.json({ data: c });
});

// --- Accounts / collections (H3, true-risk, T2 source) ---
app.get("/api/bookings/:id/demands", async (req, res) => {
  res.json({ data: await listDemands(req.params.id) });
});

app.get("/api/overdue-reasons", async (_req, res) => res.json({ data: await listOverdueReasons() }));

app.get("/api/projects/:id/collections", async (req, res) => {
  res.json({ data: await projectCollections(req.params.id) });
});

app.post("/api/demands/:id/receipt", async (req, res) => {
  try {
    const key = (req.headers["idempotency-key"] as string | undefined) ?? req.body?.idempotency_key;
    res.json({
      data: await postReceipt(req.params.id, {
        amount: Number(req.body?.amount),
        mode: req.body?.mode,
        idempotency_key: key,
      }),
    });
  } catch (e) {
    res.status(400).json({ errors: [{ code: "bad_request", message: String((e as Error).message) }] });
  }
});

app.post("/api/demands/:id/overdue-reason", async (req, res) => {
  try {
    res.json({ data: await setOverdueReason(req.params.id, req.body?.reason_code) });
  } catch (e) {
    res.status(400).json({ errors: [{ code: "bad_request", message: String((e as Error).message) }] });
  }
});

app.post("/api/demands/:id/ptp", async (req, res) => {
  try {
    res.json({
      data: await recordPtp(req.params.id, {
        expected_date: req.body?.expected_date,
        expected_amount: Number(req.body?.expected_amount),
      }),
    });
  } catch (e) {
    res.status(400).json({ errors: [{ code: "bad_request", message: String((e as Error).message) }] });
  }
});

// --- Audit (02 §API) — paged, masked; the workspace Activity tab reads this ---
app.get("/api/audit", async (req, res) => {
  const result = await getAudit({
    entity_type: req.query.entity_type as string | undefined,
    entity_id: req.query.entity_id as string | undefined,
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
    page: req.query.page ? Number(req.query.page) : undefined,
    page_size: req.query.page_size ? Number(req.query.page_size) : undefined,
  });
  res.json({ data: result.data, page: result.page, page_size: result.page_size, total: result.total });
});

registerLifecycleRoutes(app);

const PORT = Number(process.env.PORT ?? 3001);
initDb().then(() => {
  app.listen(PORT, () => console.log(`HomeFlow API ready → http://localhost:${PORT}`));
});
