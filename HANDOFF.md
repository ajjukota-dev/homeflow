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

A **demoable vertical slice** of the post-sales OS on a laptop. Staff can walk Site → Sales → CRM → Accounts → Legal → QA/handover → After keys → Management. The customer can open one home. Domain engines (gates, clearance, readiness, handover, control tower) are unit-tested. CDK **synths**; it has **not** been deployed.

This is a working UI and domain core. It is **not** production.

### Two apps + one API + CDK (undeployed)

| Piece | Path | Local URL | What you see |
|---|---|---|---|
| Staff workspace | `apps/workspace` | http://localhost:5173 | HomeFlow sidebar: Site, Sales, CRM, Accounts, Legal, QA / Handover, After keys, Management |
| Customer portal | `apps/my-pranava-home` | http://localhost:5174 | **My Pranava Home** — one family, currently **Hello, Karthik** / Villa V110 |
| Domain API | `services/api` | http://localhost:3001 | Express + **in-memory PGlite**. Restarting the API **wipes all data** and re-seeds |
| AWS CDK | `infra/` | — | Platform (Cognito user pool, EventBridge, S3) + App (VPC, Aurora Serverless v2, Lambda, HTTP API). `npm run synth` works. **No `cdk deploy` yet** |

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

Customer app is **read-only** today (no login, no actions). Workspace has no login — anyone on the laptop can click every role.

### Tests (local)

- API unit/integration: `npm --prefix services/api test` (Vitest + real PGlite)
- Workspace component tests: `npm --prefix apps/workspace test` (Vitest can hang after passing — known; do not treat hang as failure)
- Playwright: `npm run test:e2e` from repo root / `npm run e2e` in `apps/workspace`
- Frontend build: `npm run build` · CDK: `npm run synth`

---

## 3. Seeded data — this is not production data

**Almost everything you see in the UI is fake demo data**, inserted on API boot from `services/api/src/seed.ts` and `services/api/src/seed-lifecycle.ts`.

There is **no login**, so there are **no real registered users**. There is **no durable database**. PGlite lives in process memory. Playwright and browser click-throughs mutate that memory until the API process dies.

### Demo project: East Crest (`p_eastcrest`)

East Crest values (RERA number, DLP months, registration %, stage names) are **seed/config**, not to be hard-coded in engines. Production projects must come from Policy Studio / config tables.

| Unit | Sale status in seed | Demo person | Why it exists |
|---|---|---|---|
| V101, V104, V108 | Available to book | — | Sales inventory |
| V110 | Booked | **Karthik Iyer** | Overdue / true-risk collections; executed AOS; waiting on finance; customer portal “me” |
| V111 | Booked | **Meera Krishnan** | Disputed dues + loan + **critical snag** (live wiring) |
| V112 | Registered, keys-eligible | **Ananya Rao** | Happy-path H9 handover |
| V113 | Already handed over | **Rohan Desai** | DLP, open warranty (guest-bath mixer), check-ins, service history |

RM in seed: **Priya Nair**. Org AOS template: `tpl_aos`. Customer portal `/api/me/home` currently returns the **first active booking by booking number** → Karthik / V110.

**Production must not ship this cast.** Real customers, PAN, phones, consideration, RERA, and registration references come from Pranava’s live operations — KYC, bookings, receipts, SRO — not from `seed.ts`. Keep a **config seed** (component definitions, gate rules, payment-plan templates, overdue reasons). Separate **demo seed** so it never runs in prod.

---

## 4. What has to be built next

Priority order for the person taking this over:

### 4.1 Login / logout + Google Sign-In (Rambabu Gauru)

Stakeholder **Rambabu Gauru** asked for **Google login**. That is an explicit product requirement for identity.

Do it the spec way, not a one-off Google button in the SPA:

- Auth is **Amazon Cognito** ([`docs/spec/foundation/architecture.md`](docs/spec/foundation/architecture.md) §3, §7). CDK already creates a User Pool with workspace + customer app clients (`infra/lib/platform-stack.ts`) — **email/password only, no Google IdP, not wired to the apps**.
- Add **Google as a Cognito federated identity provider** (Hosted UI / OAuth). Workspace staff and My Pranava Home customers both get **Sign in with Google**, plus **logout** (Cognito global sign-out + clear local session).
- JWTs must carry `user_id`, `role_ids`, `authorized_project_ids`. API Gateway (or the Express adapter locally) **must reject unauthenticated calls**. Today the API is **wide open**.
- Map Google accounts to HomeFlow roles (Sales, CRM, Accounts, … vs customer). Self-sign-up stays **off** for staff (`selfSignUpEnabled: false`). Customers need a defined invite / booking-link path — do not let a random Google account see Karthik’s home.
- Local parity: Cognito-local or LocalStack so Google/Cognito can be tested without making every laptop depend on live AWS ([architecture §6b](docs/spec/foundation/architecture.md)).

Do **not** skip Cognito and talk to Google’s SDK only from the browser. Cognito is the identity kernel; Google is how the user signs in.

### 4.2 Productionise (AWS CDK + real data) — follow the rules

Read and obey [`CLAUDE.md`](CLAUDE.md), [`docs/spec/foundation/architecture.md`](docs/spec/foundation/architecture.md), [`docs/spec/foundation/build-conventions.md`](docs/spec/foundation/build-conventions.md).

Minimum to call this production:

1. **Durable Postgres** — Aurora (CDK app stack already sketches it). Same SQL as local. Versioned migrations. **RLS by `project_id`.**
2. **Stop using in-memory PGlite in prod.** Local may keep PGlite or move to Docker Postgres; prod is Aurora.
3. **Finish CDK for real deploy** (`infra/`):
   - Bundle `services/api` handlers into the Lambda (replace `infra/lambda/index.mjs` shell)
   - Cognito **authorizer** on the HTTP API
   - Google IdP on the user pool
   - Host both SPAs (S3 + CloudFront per architecture)
   - Restrict CORS (today `allowOrigins: ["*"]` — dev only)
   - **Harden:** `RemovalPolicy.RETAIN`, deletion protection, no `autoDeleteObjects` in prod
   - Region **ap-south-1 (Mumbai)** unless the account standard says otherwise
4. **Point apps at the deployed API** by env — same handlers, no rewrite.
5. **Load real registrations** — projects, units, bookings, applicants, demands, receipts, legal docs — from Pranava source systems or a controlled migration. Demo people (Karthik, Meera, Ananya, Rohan) stay in **dev/demo only**.
6. **CI:** typecheck, unit, contract, then `cdk deploy` via pipeline. No manual prod clicks.
7. Extract shared UI/types to `packages/` when touching both apps (spec repo shape).

**Deploying CDK / creating AWS resources costs money.** Do not deploy until Pranava explicitly approves the account, region, and budget. `cdk synth` is free; `cdk deploy` is not.

### 4.3 Remaining product (after identity + persistence)

The slices above are **demoable paths**, not the full role acceptance lists. Still to build, from the spec (do not invent extras):

- Policy Studio (journey / SLA / gates / templates as data)
- Employee **My Day**
- Legal clause library, segregation of duties
- Named handover **override** UI (safety gates still never overridable)
- Management KPI explorer (Control Tower stays five interventions, not fifty charts)
- Evidence / document **file upload** to S3 (signed URLs)
- Notifications (H10 visibility filter — no AI auto-send of consequential customer comms)
- OpenAPI `/api/v1`, docker-compose local mirror (Postgres + LocalStack)
- Real “me” for the customer app (booking from the logged-in Google/Cognito user, not `ORDER BY booking_number`)

---

## 5. How to run what exists today

```bash
# API (required — seeds East Crest in memory)
npm run dev:api          # http://localhost:3001

# Staff UI
npm run dev:web          # http://localhost:5173

# Customer UI
npm --prefix apps/my-pranava-home run dev   # http://localhost:5174
```

If 5173 looks empty, wait for the API — the project dropdown is **East Crest**. Customer 5174 is a **different site** from the staff app.

```bash
npm --prefix services/api test
npm run build
npm run synth            # CDK CloudFormation only — no AWS bill
```

---

## 6. Guardrails (do not break these)

- Do not start a chatbot, unexplained scores, or East-Crest-only code branches.
- Do not hard-delete financial / legal / commitment / spec history.
- Do not let Sales or CRM mutate unit physics or gates.
- Do not leak internal collections language (`TRUE_RISK`, snag internals) to the customer app.
- Do not commit secrets. Cognito Google client secret belongs in Secrets Manager / SSM, never in git.
- Schema/migrations, new dependencies, foundation spec edits, CI/infra, widening customer-visible data: **ask first**.

When in doubt: read the spec, then `CLAUDE.md`. The UI you already have is the UI to productionise — add login, real data, and AWS around it.
