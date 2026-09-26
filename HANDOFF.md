# HomeFlow — handoff

This file is for the next engineer (or agent) picking up the repo. **Start here, then follow the spec — do not invent a second product.**

**Team, 26 Sep 2026:** pull `main`. The 23 Sep bugs are closed (`58f4428`). W01–W14 live shots are in [`docs/handover/workflow-artifacts.md`](docs/handover/workflow-artifacts.md) and [`docs/handover/artifacts/`](docs/handover/artifacts/). Walk: [`docs/demo/click-path.md`](docs/demo/click-path.md). Password `Demo@2026`. What's still open is **§3**.

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
| Sales | Sales Desk | Inventory discovery, holds, `bookFromInventory` |
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

## 3. What's left (26 Sep 2026)

The 23 Sep list (isolation, portal denylist, CORS, reset throttle, scheduler skip-lock, one warranty/doc HTTP owner, forecast-follows-plan, queue display names, AT_RISK from data, action auto-close subscriber, migration `0048`, CI + no-deploy) is **closed** on `58f4428`. Live walk the same day: CRM cannot see Nisha/Meadows; management can; Rohan Passport has no `vendor_contact`; queues say **Owned by Priya Nair**; reset 6th request is 429; evil Origin gets no CORS. **Do not reopen those as leftover work.**

Phases 1–6 of the build queue are closed. Do not start a second OS.

### Next work (do this)

| What | Where | Notes |
|---|---|---|
| **Walk W01–W14 with the team** | [`docs/handover/workflow-artifacts.md`](docs/handover/workflow-artifacts.md) | Shots captured 26 Sep 2026 after `db:reset`. Replay: `CAPTURE_ARTIFACTS=1` Playwright specs (skipped in default CI). |
| **Prove CI on GitHub** | `.github/workflows/ci.yml` | Root `npm ci` + no-op `deploy.yml` are on this main. Actions on the remote were not re-run from here. |

### Honest leftovers (real gaps — do not fake)

- **No progress/SLA forecast engine.** Plan revision copies planned → forecast and keeps the old plan on `timeline_plan_revision`. Karthik/Nisha can show plan ≠ baseline; after a revision, forecast equals the **new** plan and slippage is vs baseline. Do not invent SOP day counts or paint AT_RISK to look busy.
- **No customer Action Required screen.** Spec 10 rule 6 portal surface is out. Do not add it.
- **Portal Home Passport equipment** can stay empty even after a staff passport write (`t4Passport` projection). Service history may still show. That is a projection gap, not a denylist miss — do not put `vendor_contact` back to “fill” equipment.
- **Portal home journey strip** can say “Your timeline will appear here once it's set up” until CRM publishes customer-visible dates. Staff 360 / Journey Control is populated.
- **Portal does not label Leela as NRI** (residency is on `customer.residency`).
- **`BookingWizard.tsx` is dead.** Sales Desk is the book path. The old **Sales** nav tab is still read-only `SalesInventory` (no book).
- **`createBooking` is a test helper** that still `INSERT`s. HTTP book and seed use `bookFromInventory`.
- **Studio leftovers** (matrix editor, some bespoke tabs, `importProjectConfig` stub) stay deferred. Do not invent Policy Studio screens.
- **P1b** (thread `app.*` GUCs onto every live `db.query` so RLS is not superuser-bypass) is still parked. Isolation today is `assertProjectScope` / `rowsInProjectScope` on handlers.
- **Local `/health` `commit` is null** unless the process is started with `GIT_SHA` / `GITHUB_SHA`. The field exists; CI/Docker set it.
- **Chromium PDF tests** fail if Playwright browsers are missing. Unset `PLAYWRIGHT_BROWSERS_PATH` or skip; do not “fix” by stubbing PDFs.
- Live `.data/pglite` is dirty after Playwright or a walk that claimed/revised — **stop API → `npm run db:reset` → restart** before a clean demo.
- Workspace and portal share `localhost` cookies. Logging into the portal as Rohan **replaces** the staff session. Log out (or use a separate browser) before switching apps.

### Parked — ask first (tokens / money)

- **Google OIDC / customer OTP** — need a real OAuth client. Email/password is complete. Do not add `openid-client` without asking.
- **`cdk deploy` / AWS of this `main`** — costs money. Ask first. Default run is laptop + optional [`docs/handover/local-postgres.md`](docs/handover/local-postgres.md). Ignore `https://we947t2rq2.ap-south-1.awsapprunner.com` — that is an older deploy, not this tree.
- Chatbot, WhatsApp runtime, vendor portal — out of spec (§27).

### Production (not this laptop)

Real customers instead of the demo cast; their mailer instead of the file outbox; Aurora (or managed Postgres) instead of PGlite; Cognito/authorizer only if they choose that later. **Do not ship East Crest / Meadows sample people.**

---

## 4. Seeded data — this is not production data

**Almost everything you see in the UI is fake demo data**, created on first boot of an empty DB via handlers (`bookFromInventory` → confirm → submitHandover → acceptHandover → journey), not `INSERT INTO booking` for occupants. Config (roles, SLA, templates) seeds every empty environment; demo people seed only when `NODE_ENV` is not `production` (or `SEED_DEMO=1`). Canonical book path is Sales Desk `BookUnitDialog` → `bookFromInventory`. Plan revisions also write `timeline_forecast_revision` (forecast dates copy the new planned dates; no SOP engine).

There **is** login. Demo staff and customers are real `user` rows with passwords. PGlite is **on disk** (`services/api/.data/pglite`). Restarting the API does **not** wipe it. To get a clean roster: **stop the API first**, then `npm run db:reset` in `services/api`, then start the API again (first boot re-migrates and re-seeds).

Do **not** book V101 / V104 / V108 — they are the spare inventory pool.

Full occupant roster (Karthik, Meera, Ananya, Rohan, Aditi, Harish, Nisha, Suresh, Kavya, Deepak, Ishaan, Leela, Farhan, Gita, Anjali, Vivek, Tanvi hold): [`docs/demo/click-path.md`](docs/demo/click-path.md).

East Crest (`p_eastcrest`) and Pranava Meadows (`p_meadows`) are two projects with **different** durations in Studio/seed rows, same engines. Durations are not one in-code constant.

**Production must not ship this cast.** Real customers, PAN, phones, consideration, RERA, and registration references come from Pranava’s live operations.

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
