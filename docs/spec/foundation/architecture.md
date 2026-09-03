# Foundation · Architecture (AWS + React)

The target technical architecture. An agent building any role slice follows these patterns so all slices compose into one deployable system. **System independence** is law: every core workflow must run without any external connector.

---

## 1. Principles

| Principle | Consequence |
|---|---|
| **System-independent core** | No external CRM/ERP/construction/DMS/FM is a prerequisite. Connectors are optional adapters behind an anti-corruption layer. |
| **Project-partitioned** | `project_id` on every downstream row; RLS enforced at the DB. |
| **Event-sourced audit** | Every consequential change emits an immutable event ([`event-log.md`](event-log.md)). |
| **Config over code** | Journey stages, SLAs, gate rules, approval matrices, templates, copy are data (Policy Studio), not deploys. |
| **API-first** | Every capability is a versioned REST endpoint with OpenAPI; the React app is just a client. |
| **One truth, many views** | Twins are composed server-side; roles get scoped projections, never copies. |

---

## 2. High-level topology

```
                         ┌─────────────────────────────┐
   React SPA (Webpack) ─▶│  CloudFront + S3 (static)    │
   My Pranava Home       └─────────────────────────────┘
   + Workspace                     │  HTTPS
                                   ▼
                         ┌─────────────────────────────┐
                         │  API Gateway (REST, /api/v1) │
                         │  + Cognito authorizer        │
                         └─────────────────────────────┘
                                   │
                   ┌───────────────┼───────────────────┐
                   ▼               ▼                    ▼
          ┌──────────────┐ ┌──────────────┐   ┌──────────────────┐
          │ Lambda svcs  │ │ Lambda svcs  │   │  Async workers   │
          │ (per domain) │ │ (per domain) │   │  (SQS-triggered) │
          └──────────────┘ └──────────────┘   └──────────────────┘
                   │               │                    │
                   ▼               ▼                    ▼
          ┌──────────────────────────────────────────────────────┐
          │  Aurora PostgreSQL (system of record, RLS by project) │
          └──────────────────────────────────────────────────────┘
                   │               │                    │
          ┌────────────┐   ┌──────────────┐    ┌──────────────────┐
          │ EventBridge│   │  S3 (files,  │    │ OpenSearch       │
          │ + SQS      │   │  docs, photos│    │ (search/inventory│
          │ (events)   │   │  KMS-encrypt)│    │  filters)        │
          └────────────┘   └──────────────┘    └──────────────────┘
```

### 2.1 Service decomposition (bounded contexts = role modules)

Each role module maps to a bounded context with its own Lambda service group + schema namespace, all on shared Aurora:

`project-site` · `sales` · `crm-rm` · `accounts` · `legal` · `qa` · `customer-portal` · `management` — plus shared kernels: `identity` (Cognito, RLS, teams), `action` (Universal Action), `journey` (templates/SLA), `documents` (Factory), `notifications`, `events`.

Cross-context communication is via **handshake events** ([`handshakes.md`](handshakes.md)) on EventBridge, not direct DB reads across contexts.

---

## 3. AWS service choices

| Concern | Service | Notes |
|---|---|---|
| Static hosting | S3 + CloudFront | React SPA, two entry bundles (customer / workspace). |
| API | API Gateway (REST) | Versioned `/api/v1`; OpenAPI source of truth. |
| Compute | Lambda (Node/TypeScript) | Per-domain handlers; container images where cold-start matters. |
| Data | Aurora PostgreSQL (Serverless v2) | System of record; RLS by `project_id`. |
| Events | EventBridge + SQS | Fan-out to gate engine, notifications, analytics; DLQs. |
| Files | S3 + KMS | Documents, drawings, photos, evidence. Signed URLs only. |
| Search | OpenSearch | Sales inventory filters, unit/customer search, document metadata. |
| Auth | Cognito | User pools + role/project claims → RLS. |
| Secrets | Secrets Manager / SSM | No secrets in code or env files. |
| Async/scheduled | EventBridge Scheduler + Step Functions | Gate reconciliation, forecast snapshots, SLA clocks, digests. |
| Notifications | SES (email) + SNS/pinpoint + WhatsApp/SMS adapters | Behind the `notifications` service + H10 visibility filter. |
| Observability | CloudWatch + X-Ray | Structured logs, traces, alarms. |
| IaC | AWS CDK (TypeScript) | All infra as code; per-env stacks. |

**AI engines** (journey risk, collection risk, commitment risk, sentiment, document intelligence) run as separate services invoked async; they **emit `ai_recommendation` Actions/events** and never auto-execute consequential steps ([`universal-action.md`](universal-action.md) §5).

---

## 4. API conventions

- **Base:** `https://api.homeflow…/api/v1`. Versioned; breaking changes bump the version.
- **Auth:** Bearer (Cognito JWT). Claims carry `user_id`, `role_ids`, `authorized_project_ids`.
- **Project scope:** derived from the resource; `X-Project-Id` header optional only for the Project selector context. Server always re-validates against the resource's real `project_id`.
- **Shape:** JSON; `snake_case` fields (matches data model); envelope `{ data, meta, errors }`.
- **Pagination:** cursor-based (`meta.next_cursor`).
- **Errors:** `{ errors: [{ code, field?, message, source_ref? }] }` — `source_ref` lets the UI deep-link to the record to fix (used by document validation, H4).
- **Idempotency:** mutating handshake endpoints accept `Idempotency-Key`.
- **RLS:** every query runs under a Postgres session GUC set from the JWT; no endpoint may bypass it.

**Endpoint naming** mirrors entities and handshakes, e.g.:
```
GET  /units?project_id=&filter=kitchen_open        (sales inventory)
GET  /units/{id}/changeability                     (Unit Twin gate view)
POST /bookings/{id}/handover/submit                (H2 submit)
POST /bookings/{id}/handover/accept | /return      (H2 accept/return)
POST /change-requests                              (H5)
POST /documents/{id}/generate                      (H4)
GET  /me/day                                       (My Day)
GET  /projects/{id}/control-tower                  (management)
```
Each role spec defines its own endpoints; all follow these conventions.

---

## 5. The Journey / SLA engine (shared kernel)

Because it is cross-cutting, it lives in foundation-adjacent shared code, configured per project.

- **Objects:** `JourneyTemplate`, `JourneyTemplateVersion`, `JourneyStageTemplate`, `JourneyTaskTemplate`, dependency/gate defs, `JourneyInstance`, `StageInstance`, `TimelinePlanRevision`, `TimelineForecastRevision`, `SlaPolicy`, `SlaClockEvent`, `WorkingCalendar`, `DelayReason`.
- **Inheritance:** Pranava Standard Template → Project Template (overrides) → Unit/Booking instance → record-level exception. Changing a template version never silently mutates active journeys (migration rule required).
- **Date model:** baseline / current-plan / forecast / actual, per [`universal-action.md`](universal-action.md) §4. Working vs calendar days from `WorkingCalendar`.
- **Parallel streams:** Finance, Construction, Legal, Customisation, Commitments, Communication run concurrently; only explicit dependencies/gates block progression.
- **SLA clocks:** start/pause/resume/warn/breach/complete, each an event; drive the L0–L4 ladder.

### The 11-stage Pranava Standard Journey (config seed)

The Journey Template Studio seeds the enterprise-default lifecycle from this catalog. **These are configuration data, not code** — durations, SLAs, owners, and customer wording are set per project; the stage vocabulary stays stable for portfolio analytics. Stages run in parallel and converge only at gates (a stage number is for comprehension, not strict sequence).

| # | Stage | Primary gate to advance | Owning role(s) |
|---|---|---|---|
| 0 | Unit / Pre-Sales Readiness | Unit twin + changeability fresh | project-site |
| 1 | Booking & Allotment | Completeness gate (H2) | sales → crm-rm |
| 2 | Funding & Financial Setup | Payment plan + funding route (H3) | accounts |
| 3 | Agreement & Documentation | Doc validation + execution (H4) | legal |
| 4 | Construction & Unit Journey | Component progress events (H1) | project-site |
| 5 | Demands & Collections | Demand/receipt reconciliation | accounts |
| 6 | Pre-Registration Readiness | Financial clearance (H7) + doc/legal | accounts + legal |
| 7 | Registration | SRO execution + registered copy (H8) | legal |
| 8 | Pre-Handover Readiness | Physical + quality gates (H9) | qa |
| 9 | Handover & Possession | All hard gates converge | qa + crm-rm |
| 10 | Post-Handover / Facilities | DLP/warranty (H12) | post-handover |

Each stage instantiates its default tasks/gates/SLAs from the Project template version on booking confirm ([`JourneyInstance`](#5-the-journey--sla-engine-shared-kernel)); record-level exceptions are authorized overrides, never silent template mutation.

---

## 6. Environments & delivery

| Env | Purpose |
|---|---|
| `dev` | Per-developer / integration. Seed data incl. East Crest config sample. |
| `staging` | UAT, pilot project rehearsal. |
| `prod` | Live. Blue/green or canary on Lambda + CloudFront. |

- **CI/CD:** build → typecheck → lint → unit tests → contract tests (OpenAPI) → deploy via CDK. No manual prod changes.
- **DB migrations:** versioned, forward-only, reviewed (schema changes are "Ask first" per boundaries).
- **Feature flags:** for progressive role rollout (build order in `README.md`).
- **Backups/retention:** Aurora PITR; S3 versioning + lifecycle; events retained per compliance policy.

---

## 6b. Local-first development with AWS parity

**Rule:** every AWS-backed capability must be buildable and testable **entirely on a laptop**, with the same code that runs in AWS. No developer needs a live AWS account to build a role slice. When local tests pass, the *same* artifacts deploy to real AWS by switching endpoints/credentials — no code rewrite.

### Local mirror stack

| AWS service | Local mirror | How |
|---|---|---|
| Aurora PostgreSQL | Postgres in Docker | Same SQL + RLS; migrations run identically. |
| Lambda + API Gateway | **AWS SAM Local** (`sam local start-api`) or `serverless-offline` | Runs handlers as local HTTP; same handler code. |
| EventBridge + SQS | **LocalStack** | Same event bus / queue APIs via SDK. |
| S3 (files) | **LocalStack** S3 (or MinIO) | Signed-URL flow works locally. |
| Cognito (auth) | **LocalStack** Cognito or a local JWT issuer + `cognito-local` | Issues JWTs with the same claims (`role_ids`, `authorized_project_ids`). |
| OpenSearch | Dockerized OpenSearch (or Elasticsearch-compatible) | Same query client. |
| Step Functions / Scheduler | LocalStack / cron shim | Reconciliation + snapshot jobs run on a local timer. |

Orchestrated by a single **`docker-compose.yml`** + a `make dev` (or `npm run dev:local`) target that boots the whole mirror and seeds East Crest sample config.

### The parity rule (how code stays deploy-agnostic)

- All AWS access goes through the **AWS SDK v3** with a configurable **endpoint + credentials** resolved from env:
  - Local: `AWS_ENDPOINT_URL=http://localhost:4566` (LocalStack), local Postgres DSN, local JWT issuer.
  - AWS: real endpoints, IAM role credentials, Secrets Manager.
- **No service hard-codes an AWS endpoint.** One `awsClients` factory in `packages/core` reads env and returns clients that point local or cloud.
- Handler code (Lambda) is written framework-agnostic (pure `(event) => result`), so the *same* function runs under SAM Local and under real Lambda.
- Infra is CDK; a local profile can `cdklocal` deploy against LocalStack to smoke-test stacks before touching a real account.

### Workflow

```
1. Build a role slice against the local mirror (docker-compose up).
2. Unit + integration + contract tests pass locally (no cloud needed).
3. cdklocal deploy → smoke test the stack shape on LocalStack.
4. Wire real AWS: swap env to cloud endpoints + IAM creds (CI/CD).
5. cdk deploy to dev → staging → prod (blue/green).
```

**Acceptance:** a fresh clone + `make dev` boots the full stack locally, seeds sample data, and every role's happy-path handshake ([`handshakes.md`](handshakes.md)) can be exercised end-to-end with **no AWS account**. The identical code, re-pointed by env, runs in AWS.

---

## 7. Security & governance

- Cognito + RLS; least-privilege IAM per Lambda.
- KMS encryption at rest (Aurora, S3); TLS in transit.
- Field-level sensitivity masking by role (margins, discounts, cost-to-serve).
- Signed, expiring S3 URLs for all file access; no public buckets.
- Immutable event log; no delete grants.
- PII/consent honored on export + outbound comms.
- All AI output logged (model, version, confidence, action, outcome).

---

## 8. Repository shape (for the agent)

```
homeflow/
├── infra/                 → AWS CDK stacks (per service + shared)
├── packages/
│   ├── ui/                → shared React component library (design-language tokens)
│   ├── core/              → shared types (generated from data model), event schemas
│   └── config/            → Policy Studio schemas, journey templates, seed configs
├── services/
│   ├── identity/  action/  journey/  documents/  notifications/  events/
│   ├── project-site/  sales/  crm-rm/  accounts/  legal/  qa/
│   ├── customer-portal/  management/
│   └── ai/                → prediction engines
├── apps/
│   ├── workspace/         → internal React SPA (roles)
│   └── my-pranava-home/   → customer React SPA
└── docs/spec/             → this spec set
```

An agent building a role reads: `foundation/*` + that role's `spec.md` + the handshakes it participates in, then implements the service (`services/<role>/`), its slice of `apps/`, and shared types in `packages/core`.

---

## 9. Non-negotiables (architecture-level)

1. Core workflows run with **zero** external connectors configured.
2. No cross-context direct DB access — only events + APIs.
3. RLS is enforced at the DB, not just the app.
4. The event log is append-only with no delete path.
5. Config (journey/SLA/gates/templates/copy) changes without a code deploy.
6. Customer-facing surfaces pass through the H10 visibility filter — no internal data leakage.
7. The full system builds and tests locally with **no AWS account** (§6b); the identical code deploys to AWS by re-pointing env.
