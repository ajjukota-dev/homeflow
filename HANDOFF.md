# HomeFlow — handoff

This file is for the next engineer (or agent) picking up the repo. **Start here, then follow the spec — do not invent a second product.**

HomeFlow is a real product we will operate, not a prototype. The local demo is intentionally seeded so you can see the UI and the domain. Production means real people, real bookings, login, and AWS — not East Crest sample customers living in memory.

---

## 1. What the business is

Pranava is a residential developer. It builds **projects** (villas / apartments) and sells **units** to families. HomeFlow is the operating system for **everything after a unit is booked** — money, papers, that exact home’s construction, changes, registration, keys, and life after move-in.

It is **not** construction CAD and **not** the general ledger. It is **not** the office-leasing / FMWork product.

### Spec is the contract (do not rewrite it)

| What | Where |
|---|---|
| Plain-English product story | [`docs/CONTEXT.md`](docs/CONTEXT.md) |
| Full OS narrative | [`docs/HOMEFLOW-OS.md`](docs/HOMEFLOW-OS.md) |
| **Build contract (authoritative)** | [`docs/spec/README.md`](docs/spec/README.md) |
| Foundation (twins, gates, handshakes, architecture, design) | [`docs/spec/foundation/`](docs/spec/foundation/) |
| Role modules | [`docs/spec/roles/`](docs/spec/roles/) |
| Design PDF | [`docs/Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf`](docs/Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf) |
| Interactive spec canvas | [`canvases/homeflow-2-design-spec.canvas.tsx`](canvases/homeflow-2-design-spec.canvas.tsx) |
| Engineering rules | [`CLAUDE.md`](CLAUDE.md) |

`docs/spec/foundation/` wins over any role file. Role files win over ad-hoc code.

Three nouns that never mix: **Project** (the site) · **Unit** (the physical home) · **Booking** (this family + this unit + this ownership period).

Target architecture: React SPAs + AWS (Cognito, API Gateway, Lambda, Aurora PostgreSQL, EventBridge, S3). Local-first with AWS parity: [`docs/spec/foundation/architecture.md`](docs/spec/foundation/architecture.md) §6b.

---

## 2. What has been built

A **local, logged-in** post-sales OS. Staff sign in at `/login` on the workspace. Each accepted occupant signs in on the customer portal to **their** home — not a single hardcoded Karthik view. Domain engines (gates, clearance, readiness, handover, control tower, RLS) are unit-tested. CDK **synths**; it has **not** been deployed for this `main`. Do not treat `https://we947t2rq2.ap-south-1.awsapprunner.com` as this product.

This is a working UI and domain core on a laptop. It is **not** production AWS.

### Two apps + one API + CDK (undeployed)

| Piece | Path | Local URL | What you see |
|---|---|---|---|
| Staff workspace | `apps/workspace` | http://localhost:5173 | Sign in, then My Day / Site / Sales / CRM / Accounts / Legal / QA / After keys / Management / Policy Studio / Queues (role-gated) |
| Customer portal | `apps/my-pranava-home` | http://localhost:5174 | **My Pranava Home** — session-scoped to the logged-in occupant (Ananya `customer@`, Rohan `rohan@`, Karthik `karthik@`, Nisha `nisha@`, …) |
| Domain API | `services/api` | http://localhost:3001 | Express + **persisted PGlite** at `services/api/.data/pglite`. Restart **keeps** data. Reset is stop API → `npm run db:reset` → start |
| AWS CDK | `infra/` | — | Synths. **No `cdk deploy` for this main.** Local Postgres 16 runbook: [`docs/handover/local-postgres.md`](docs/handover/local-postgres.md) |

### Domain slices that exist (vertical, not every acceptance test)

| Slice | Staff screen | Behaviour you can click |
|---|---|---|
| Site | Unit Progress Control | Record structure / MEP / flooring / finishing; changeability gates re-derive |
| Sales | Inventory + book | Book a villa; CRM receives the file |
| CRM | Queue + Customer 360 | Accept booking; RM owns the customer |
| Accounts | Collections | True-risk / due / overdue / disputed; post a receipt |
| Legal | Document factory | Generate → approve → execute AOS; registration blocked until H7 financial clearance |
| QA / Handover | QA & handover | Evidence-based readiness (not a typed %); complete handover only when hard gates pass |
| After keys | After keys | DLP windows, warranty close, 7/30/90 check-ins, permanent service ledger |
| Management | Control tower | Exactly five interventions (customer, cash, handover, reputation, margin) + Act |
| Customer | My Pranava Home | Build tracker, personalisation windows, payments with “why due”, home passport, RERA/escrow paperwork, keys window. **No internal `TRUE_RISK` / snag internals** |

### What the UI is

The UI in these two apps **is** the product look we are going with: Apple-homely tokens, no glassmorphism, no purple AI aesthetic. Design language: [`docs/spec/foundation/design-language.md`](docs/spec/foundation/design-language.md). Keep it. Do not restyle from scratch.

Both apps **require login**. Password for every demo account: `Demo@2026`. Roster and landings: [`docs/demo/click-path.md`](docs/demo/click-path.md). CRM staff land on **My Day**. Super Admin invites new staff from Admin → Users; they set a password from the file-mailer `/invite/:token` link.

Empty lists use an honest empty message + Retry where there is an error — not a spinner forever. Loading uses skeletons. Money the role cannot see renders as "—".

### Tests (local)

- API unit/integration: `cd services/api && npm test` (Vitest + PGlite). Unset `PLAYWRIGHT_BROWSERS_PATH` if Chromium is missing (PDF tests). Run unsandboxed on this machine.
- Workspace component tests: `npm --prefix apps/workspace test`
- Playwright: `npx playwright test` in `apps/workspace` (staff) and `apps/my-pranava-home` (portal). Dev servers must already be on :5173 / :5174 / :3001. Use `localhost`, not `127.0.0.1` (Vite listens on IPv6).
- Frontend build: `npm run build` · CDK: `npm run synth` (no AWS bill)

---

## 3. Seeded data — this is not production data

**Almost everything you see in the UI is fake demo data**, created on first boot of an empty DB via handlers (`createBooking` → accept → journey), not `INSERT INTO booking` for occupants. Config (roles, SLA, templates) seeds every empty environment; demo people seed only when `NODE_ENV` is not `production` (or `SEED_DEMO=1`).

There **is** login. Demo staff and customers are real `user` rows with passwords. PGlite is **on disk** (`services/api/.data/pglite`). Restarting the API does **not** wipe it. To get a clean roster: **stop the API first**, then `npm run db:reset` in `services/api`, then start the API again (first boot re-migrates and re-seeds).

Do **not** book V101 / V104 / V108 — they are the spare inventory pool.

Full occupant roster (Karthik, Meera, Ananya, Rohan, Aditi, Harish, Nisha, Suresh, Kavya, Deepak, Ishaan, Leela, Farhan, Gita, Anjali, Vivek, Tanvi hold): [`docs/demo/click-path.md`](docs/demo/click-path.md).

East Crest (`p_eastcrest`) and Pranava Meadows (`p_meadows`) are two projects with **different** durations in Studio/seed rows, same engines. Durations are not one in-code constant.

**Production must not ship this cast.** Real customers, PAN, phones, consideration, RERA, and registration references come from Pranava’s live operations.

### Known gaps (do not “fix” by inventing engines)

- After `createPlanRevision`, **forecast still equals baseline** (no `timeline_forecast_revision` handler). Plan ≠ baseline is real on BK-V110 / BK-MT201.
- Queues may still show raw `user_*` owner ids.
- Portal home journey strip can say “Your timeline will appear here once it’s set up” until CRM publishes customer-visible dates — staff 360 Journey is populated.
- GitHub `ci` / `deploy` workflows have been red since before Phase 4; not a handover ID.

---

## 4. What has to be built next (not a second OS)

Email/password login, My Day, Policy Studio, files port, scheduler, and RLS are **already in this main**. Do not rebuild them.

Parked until leads supply tokens / spend:

- **Google OIDC** — only with a real OAuth client. Email/password is complete. Do not add `openid-client` without asking.
- **AWS deploy** of this main — costs money. Ask first. Default path is [`docs/handover/local-postgres.md`](docs/handover/local-postgres.md).
- Forecast-revision engine (do not invent SOP day counts to close the forecast=baseline gap).
- Chatbot, WhatsApp runtime, vendor portal — out of spec (§27).

Still product-shaped leftovers (not Phase 5): Cognito authorizer on a real HTTP API, Aurora instead of PGlite/local Postgres, their mailer instead of the file outbox, loading real registrations instead of demo people.

---

## 5. How to run what exists today

Vite binds `localhost` (`[::1]`). Use `http://localhost:5173` — `127.0.0.1` will fail to connect.

```bash
# 1. Stop any API on :3001, then reset, then start API (seeds on empty DB)
#    (if something is already listening, kill it first — reset while the API is up is a no-op against a live file)
cd services/api && npm run db:reset && npm start   # http://localhost:3001  GET /health → {"ok":true,"db":true}

# 2. Staff UI (new terminal)
npm run dev:web          # http://localhost:5173

# 3. Customer UI (new terminal)
npm --prefix apps/my-pranava-home run dev   # http://localhost:5174
```

Log in as `crm@demo.pranava` / `Demo@2026` → **My Day**. Open CRM / RM → Karthik Iyer → View journey (not empty). Portal: `customer@demo.pranava` (Ananya V112), `rohan@demo.pranava` (Rohan V113), `nisha@demo.pranava` (Nisha MT1-201). Click-path: [`docs/demo/click-path.md`](docs/demo/click-path.md).

```bash
cd services/api && npm test
npm run build
npm run synth            # CDK CloudFormation only — no AWS bill
```

---

## 6. Guardrails (do not break these)

- Do not start a chatbot, unexplained scores, or East-Crest-only code branches.
- Do not hard-delete financial / legal / commitment / spec history.
- Do not let Sales or CRM mutate unit physics or gates.
- Do not leak internal collections language (`TRUE_RISK`, snag internals) to the customer app.
- Do not commit secrets. Do not deploy AWS without an explicit spend yes.
- Schema/migrations, new dependencies, foundation spec edits, CI/infra, widening customer-visible data: **ask first**.

When in doubt: read the spec, then `CLAUDE.md`, then [`docs/demo/click-path.md`](docs/demo/click-path.md).
