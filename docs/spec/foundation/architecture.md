# Foundation · Architecture

The target technical architecture. Every slice follows these patterns so all slices compose into one deployable system. **System independence** is law: every core workflow runs without any external connector. **v1 is the base** ([`v1-reuse.md`](v1-reuse.md)): this architecture is what v1 becomes, not a replacement for it.

> Revised 5 Sep 2026, from first principles. Neither the original per-domain Lambda topology nor the 4 Sep "container + Aurora + SQS + Cognito" revision survives unchanged. Each layer below was chosen by asking *what does a developer with single-digit projects, hundreds of units, low-thousands of bookings and a two-person engineering team actually need*, and picking the smallest thing that is durable, secure and identical on a laptop. §10 lists what was rejected and why; §11 lists the point at which each choice should be revisited.

---

## 1. Principles

| Principle | Consequence |
|---|---|
| **System-independent core** | No external CRM/ERP/construction/DMS/FM is a prerequisite. Connectors are optional adapters behind an anti-corruption layer. |
| **Project-partitioned** | `project_id` on every downstream row; RLS enforced at the DB. |
| **Event-sourced audit** | Every consequential change emits an immutable event ([`event-log.md`](event-log.md)). |
| **Config over code** | Journey stages, SLAs, gate rules, approval matrices, templates, copy are data (Policy Studio), not deploys. |
| **API-first** | Every capability is a versioned REST endpoint with OpenAPI (FastAPI generates it); the React apps are clients. |
| **One truth, many views** | Twins are composed server-side; roles get scoped projections, never copies. |
| **Evolve, don't duplicate** | v1's modules are carried; the foundation is slid underneath them (PDF §1). |
| **Postgres is the platform** | Records, events, jobs, sessions, search and the append-only guarantee all live in one Postgres. A second store is added only when Postgres measurably cannot do the job. |
| **Same image everywhere** | One Docker image runs on the laptop and in AWS. Nothing in the image knows which. |

---

## 2. Topology

```
                     homeflow.pranava.in         my.pranava.in
                              │                        │
                              ▼                        ▼
                    ┌────────────────────────────────────────┐
                    │  ALB (TLS, two hostnames → one target)  │
                    └────────────────────┬───────────────────┘
                                         │
                    ┌────────────────────▼───────────────────┐
                    │  ECS Fargate service · 1–2 tasks        │  one image:
                    │  FastAPI  /api/v1  + both SPAs (static) │   · API
                    │  in-process job ticker (advisory lock)  │   · workspace dist  (Host: homeflow.)
                    └───────┬─────────────────────┬──────────┘   · customer dist   (Host: my.)
                            │                     │
                 ┌──────────▼──────────┐  ┌───────▼────────┐        outbound (no NAT, tasks have public IPs):
                 │ RDS PostgreSQL 16   │  │ S3 (private,   │        Google OIDC · WhatsApp/SMS provider · SES
                 │ records · event log │  │ versioned)     │
                 │ jobs · sessions     │  │ presigned URLs │
                 │ RLS by project      │  └────────────────┘
                 └─────────────────────┘
```

Region **ap-south-1 (Mumbai)**: customer PII stays in India (DPDP Act 2023) and Hyderabad users get the lowest latency.

### 2.1 Why one process, one Postgres

HomeFlow's screens are cross-domain by design — handover eligibility reads QA, snags, receipts, documents, registration and unit utilities in one query; the Control Tower reads everything. Every split (per-domain functions, per-context databases, a separate bus) adds a hop to the hottest read paths and a second source of truth to keep honest, and the business asked for none of it. One API process, **modules as folders** (`services/api/modules/<role>/`), one schema, RLS by project. Handshakes H1–H12 are explicit functions that emit events — transfers of *responsibility*, not service boundaries.

### 2.2 Module layout (bounded contexts as folders)

`services/api/modules/`: `project_site` · `sales` · `crm_rm` · `accounts` · `legal` · `qa` · `post_handover` · `customer_portal` · `management` — plus kernels: `identity` (sessions, OIDC, OTP, RLS context, RBAC matrix), `action` (Universal Action + SLA ladder), `journey` (templates, instances, date model), `documents` (Factory), `events` (append-only log), `jobs` (outbox + ticker), `files` (S3 pointers + presigned URLs), `notifications`.

A module may **read** any table (they are one system of record) and **write** only its own. Cross-module writes go through a handshake function in the owning module.

### 2.3 Background work without a queue

The `job` table is the queue: a row per unit of work (`send_notification`, `sla_tick`, `snapshot_forecast`, `generate_document`), claimed with `SELECT … FOR UPDATE SKIP LOCKED`, retried with backoff, dead-lettered after N attempts by a status column. A ticker inside the API process wakes every few seconds; `pg_try_advisory_lock` guarantees only one task runs it even with two API tasks. Cron-shaped work (SLA clocks, daily digests, freshness decay) is a `schedule` row the ticker expands into jobs.

Event → consumer fan-out is the same mechanism: a handshake appends to `event` and inserts the jobs its consumers need in **the same transaction**. Nothing can be emitted without being recorded, and nothing recorded can be lost.

---

## 3. Service choices

| Concern | Choice | Why this, and not the alternative |
|---|---|---|
| **Data** | **RDS for PostgreSQL 16**, `db.t4g.micro` → `small`, encrypted, 14-day automated backups + PITR, single-AZ to start (Multi-AZ is a flag) | Same engine binary family as `postgres:16` in Docker — true parity, every extension available. Aurora's advantages (storage auto-scale to 128 TB, sub-10s failover, global replicas, 15 readers) solve problems this product will not have for years, at 3–5× the price and with a storage engine that has no local equivalent. Moving to Aurora later is a snapshot restore. |
| **Compute** | **ECS Fargate**, one service, tasks in **public subnets with public IPs**, ALB in front, 0.5 vCPU / 1 GB to start | Runs the exact local image. Public IPs avoid a NAT gateway (≈ $35/month) for outbound calls to Google / WhatsApp / SES; the security group admits only the ALB. `ApplicationLoadBalancedFargateService` is one CDK construct. |
| **Frontends** | Built into the image; FastAPI serves `workspace/dist` for `homeflow.` and `my-pranava-home/dist` for `my.` by `Host` header | One deployable, one URL per app, same-origin cookies (no CORS, simpler CSRF). CloudFront adds nothing for a few hundred users in one country. |
| **Files** | **S3**, private, versioned, SSE-S3, presigned URLs, keys `{project_id}/{entity_type}/{entity_id}/{file_id}` | Local: MinIO. Versioning gives legal documents an immutable history for free. |
| **Events** | `event` table, append-only by **grant** (`REVOKE UPDATE, DELETE`), not by convention | The DB enforces the spec's immutability; no code path can undo it. |
| **Jobs / bus** | `job` + `schedule` tables, in-process ticker (§2.3) | No SQS, no EventBridge, no LocalStack. Same transaction as the write it reacts to. |
| **Staff identity** | **Google OIDC, server-side** (`authlib`): the API redirects to Google, verifies the ID token against Google's JWKS, requires the Pranava Workspace `hd` claim, and admits only emails present in `user`. Roles and projects come from Postgres. | Rambabu asked for Google login; Google Workspace already provides passwords, MFA, offboarding. No password ever exists in HomeFlow. Works from `localhost` with a dev OAuth client — real parity, no `cognito-local`. |
| **Customer identity** | **OTP** on the booking's verified mobile via WhatsApp (SMS fallback) through one DLT-registered Indian provider; 6 digits, hashed, 5-minute expiry, 5 attempts, per-number rate limit | Indian buyers log in by phone, not by Google. Any managed IdP would still need this flow and the same provider; owning it removes a broker (Emergent's today, Cognito's tomorrow). |
| **Sessions** | `session` table; `HttpOnly; Secure; SameSite=Lax` cookie; mutating requests require an `X-Requested-With` header | Revocable server-side (offboarding = delete row), auditable, no JWT rotation logic. |
| **Email** | SES (Mumbai) | Local: Mailpit. |
| **WhatsApp / SMS** | One provider adapter behind the `notifications` kernel (MSG91 or Gupshup — pick at implementation, both are DLT-compliant) | Also carries OTP. Local: a console adapter that writes to the outbox viewer. |
| **Search** | Postgres `pg_trgm` + `tsvector` | Hundreds of units, thousands of people. |
| **PDF** | WeasyPrint in the image (from v1) | Needs Pango/Cairo — a container, not a zip. |
| **Secrets** | Secrets Manager: DB credentials (RDS-managed rotation), Google client secret, provider keys | Local: `.env`. Never in git. |
| **Observability** | CloudWatch Logs (JSON lines with `correlation_id`), ALB access logs, RDS Performance Insights (free tier), a `/health` that checks DB + S3 | X-Ray / Sentry when the first production bug cannot be found from logs. |
| **IaC** | AWS CDK (TypeScript), two stacks: `data` (VPC, RDS, S3 — `RemovalPolicy.RETAIN`) and `service` (ECS, ALB, ACM, Route 53) | Stateful and stateless separated so a bad service deploy can never touch data. ~200 lines total. |
| **CI/CD** | GitHub Actions: lint → mypy/tsc → pytest/vitest → build image → push ECR → `cdk deploy service` | Migrations run at container start under an advisory lock. |

**AI engines** (later) run as jobs, emit `ai_recommendation` Actions/events, never auto-execute consequential steps ([`universal-action.md`](universal-action.md) §5).

### 3.1 Monthly cost, production

| Item | ≈ USD |
|---|---|
| RDS `db.t4g.micro` single-AZ + 20 GB | 15 |
| Fargate 0.5 vCPU / 1 GB × 1 task | 18 |
| ALB | 18 |
| S3, SES, Secrets Manager, Route 53, logs | 6 |
| **Total** | **≈ 57** |

For comparison the 4 Sep shape (Aurora Serverless v2 + Fargate + ALB + NAT + SQS/EventBridge + Cognito) lands near $150; the original Lambda-per-domain shape with OpenSearch near $200. Multi-AZ RDS and a second task add ≈ $35.

---

## 4. API conventions

- **Base:** `/api/v1`. Versioned; breaking changes bump the version.
- **Auth:** session cookie. Middleware loads the session, then `role_ids` + `authorized_project_ids` from Postgres, and sets the RLS GUC (`SET LOCAL app.user_id, app.project_ids`). Unauthenticated → 401, always. Staff and customer sessions are distinct realms (`session.kind`); a customer session can only reach `customer_portal` routes.
- **Project scope:** derived from the resource; `X-Project-Id` only for the selector context; server re-validates.
- **Shape:** JSON, `snake_case`, envelope `{ data, meta, errors }`.
- **Errors:** `{ errors: [{ code, field?, message, source_ref? }] }` — never HTML, never a stack trace, never a file path. Postgres `23503` → 404, `23505` → 409, `22P02` → 400, everything else → 500 with a logged `correlation_id`.
- **Reads never write.** A GET that must persist a derived view (e.g. Control Tower interventions) does so through a job, not the request.
- **Pagination:** cursor (`meta.next_cursor`). **Idempotency:** mutating handshake endpoints accept `Idempotency-Key`.
- **RLS:** every query runs under the session GUC; no endpoint may bypass it. The API connects as `homeflow_app`, a role with RLS enforced and no `UPDATE`/`DELETE` on `event`.

Endpoint naming mirrors entities and handshakes:
```
GET  /units?project_id=&filter=kitchen_open
GET  /units/{id}/changeability
POST /bookings/{id}/handover/submit | /accept | /return
POST /change-requests
POST /documents/{id}/generate
GET  /me/day
GET  /projects/{id}/control-tower
```

---

## 5. The Journey / SLA engine (shared kernel)

Carried from v1's `workflow_engine.py` ([`v1-reuse.md`](v1-reuse.md) §1) and extended:

- **Objects:** `JourneyTemplate`, `JourneyTemplateVersion`, `JourneyStageTemplate`, `JourneyTaskTemplate`, dependency/gate defs, `JourneyInstance`, `StageInstance`, `TimelinePlanRevision`, `TimelineForecastRevision`, `SlaPolicy`, `SlaClockEvent`, `WorkingCalendar`, `DelayReason`.
- **Inheritance:** Pranava Standard Template → Project Template (overrides) → Booking instance → record-level exception. A template version change never silently mutates active journeys.
- **Date model:** baseline / current-plan / forecast / actual per [`universal-action.md`](universal-action.md) §4.
- **Parallel streams:** dependencies and gates govern execution, not stage numbers. v1's sequential stage-advance is replaced by dependency data.
- **SLA clocks:** start/pause/resume/warn/breach/complete, each an event; the `sla_tick` schedule drives the L0–L4 ladder.

The 11-stage Pranava Standard Journey (config seed); v1's 8-stage Villa/Apartment templates map onto it per [`v1-reuse.md`](v1-reuse.md) §3.

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

---

## 6. Environments & delivery

| Env | Purpose |
|---|---|
| `local` | Laptop. `make dev` — see §7. Seeds config + (flagged) demo data. |
| `prod` | Live. Rolling deploy on ECS (new task healthy before old one drains). |
| `staging` | Only when a customer-facing release needs a rehearsal: the same two CDK stacks with a different stage name and a `db.t4g.micro`. Not standing. |

- **DB migrations:** Alembic, forward-only, reviewed ("Ask first"); applied at container start under `pg_advisory_lock`.
- **Backups:** RDS automated backups 14 days + PITR; S3 versioning; `event` retained forever.
- **Deploy gate:** no `cdk deploy` until Pranava approves account, region and budget. `cdk synth` in CI from day one.

---

## 7. Local-first development with AWS parity

**Rule:** every AWS-backed capability builds and tests **entirely on a laptop** with the same code that runs in AWS. No developer needs an AWS account. Re-pointing env deploys the identical artifacts.

### Local mirror

| AWS | Local | How |
|---|---|---|
| RDS PostgreSQL 16 | `postgres:16` in Docker | Same SQL, same Alembic migrations, same RLS, same `homeflow_app` role and grants. |
| S3 | **MinIO** in Docker | Same `boto3` client with `endpoint_url`; objects land in `./.data/minio/`. |
| ECS task | the same image, `docker compose` service | Source mounted with `--reload` in dev. `localhost:8001` → workspace, `my.localhost:8001` → customer (browsers resolve `*.localhost` to loopback). |
| Job ticker | same process | Identical. |
| Google OIDC | real Google, dev OAuth client with `http://localhost:8001/auth/callback` | Or `HOMEFLOW_DEV_LOGIN=1` exposes `/auth/dev-login?user=` for seeded users. |
| OTP / WhatsApp / SMS | console adapter | Code is printed to the API log and shown in the local outbox viewer. |
| SES | Mailpit in Docker | Web UI on `:8025`. |
| Secrets Manager | `.env` | One `settings()` reads env; in AWS the task definition injects secrets as env. |

`docker-compose.yml` = `postgres`, `minio`, `mailpit`, `api`. `make dev` = up → health → `alembic upgrade head` → create bucket → seed. `make down`, `make reset`, `make test`.

### The parity rule

- All AWS access goes through `boto3` with `endpoint_url` + credentials from env. One `aws_clients()` factory in `services/api/kernel/aws.py`. **No module hard-codes an endpoint.**
- Database config comes from one `settings()` — env locally, env injected from Secrets Manager in ECS. Handlers never know which.
- The API image is the same artifact locally and in ECS. `docker build` once; tag and push.

**Acceptance:** a fresh clone + `make dev` boots the full stack, migrates v1's sample data, and every role's happy-path handshake ([`handshakes.md`](handshakes.md)) can be exercised end-to-end with **no AWS account**.

---

## 8. Security & governance

- No passwords stored anywhere: staff via Google Workspace, customers via OTP.
- Postgres RLS under a non-superuser app role; least-privilege IAM task role (S3 bucket, SES send, the named secrets — nothing else).
- Encryption at rest (RDS, S3) and TLS in transit (ACM on the ALB; RDS `sslmode=require`).
- Field-level sensitivity masking by role — carried from v1's `rbac_redact.py`, driven by the `permission` table.
- Presigned, expiring S3 URLs; no public buckets.
- Immutable event log by grant; no `UPDATE`/`DELETE` on `event`.
- PII/consent honoured on export + outbound comms.
- All AI output logged (model, version, confidence, action, outcome).

---

## 9. Repository shape

```
homeflow/
├── infra/                  → AWS CDK: data stack (VPC, RDS, S3) · service stack (ECS, ALB, DNS)
├── services/
│   └── api/                → FastAPI (from v1), one image, serves /api/v1 and both SPAs
│       ├── kernel/         →   identity · action · journey · documents · events · jobs · files · notifications · aws
│       ├── modules/        →   project_site · sales · crm_rm · accounts · legal · qa · post_handover · customer_portal · management
│       ├── domain/         →   pure engines (gates, collections, clearance, readiness, handover, tower, legal) — framework-free, unit-tested
│       ├── migrations/     →   Alembic
│       └── seeds/          →   config seed (always) · demo seed (flagged)
├── apps/
│   ├── workspace/          → internal React SPA (from v1, on Vite)
│   └── my-pranava-home/    → customer React SPA
├── packages/
│   └── ui/                 → shared tokens + components for both SPAs
├── docker-compose.yml · Makefile · .env.example
└── docs/spec/              → this spec set
```

---

## 10. Rejected, and why

| Option | Rejected because |
|---|---|
| **Aurora** (Serverless v2 or provisioned) | Pays for scale-out and failover this product will not need for years; the storage engine has no local twin. RDS Postgres is the same engine as the laptop. |
| **Lambda + Mangum** (one function) | Cold starts on every idle wake for Python + SQLAlchemy + WeasyPrint; Postgres connections need RDS Proxy; the local execution model (uvicorn) differs from prod. |
| **App Runner** | A VPC connector to reach RDS forces all outbound through a NAT (+ $35/month) — same cost as Fargate + ALB with a 120 s request cap and no WebSockets. |
| **One EC2 host running `docker compose`** | Cheapest and highest parity, but a snowflake host and a single point of failure with manual patching. Fargate costs ≈ $20 more and removes the host. |
| **Cognito** | Adds a broker between HomeFlow and Google (exactly what v1's Emergent dependency is), a Hosted UI nobody wants, and a local stand-in (`cognito-local`) that is not the real thing. Customer OTP would still be our code and our SMS provider. |
| **SQS / EventBridge** | A second source of truth beside the `event` table, a local emulator, and at-least-once semantics the app must dedupe. A Postgres outbox in the same transaction is stronger and simpler. |
| **OpenSearch, Redis, Step Functions, CloudFront, X-Ray, Pinpoint** | No measured need. Each is one line to add later; each is ongoing cost and a local emulator now. |
| **Supabase / Neon / Render** (non-AWS) | Technically an excellent fit (Postgres + RLS + auth + storage, ≈ $25/month). Rejected only because Pranava owns its AWS account and data and wants no second vendor. If that constraint ever lifts, this is the alternative. |
| **Separate worker service** | Correct shape eventually; unnecessary until a job needs more CPU than the API or runs longer than a minute. Same image, second ECS service — a 10-line change. |

## 11. When to revisit

| Signal | Change |
|---|---|
| A job blocks the API or runs > 60 s | Add the `worker` ECS service (same image, `python -m kernel.jobs`). |
| p95 API latency > 500 ms with CPU saturated | Second Fargate task; then `db.t4g.small`. |
| A customer-facing outage is unacceptable | RDS Multi-AZ flag; second task. |
| Storage > 1 TB or > 3 000 writes/s | Aurora (snapshot restore). |
| A non-Google staff IdP or SAML is required | Cognito or Keycloak in front of the same session table. |
| A consumer outside this codebase needs events | EventBridge fed from the `event` table (outbox relay). |
| Live push is required (not polling) | Server-Sent Events from the API; ALB supports them. |

---

## 12. Non-negotiables

1. Core workflows run with **zero** external connectors configured.
2. One system of record; modules read freely, write only their own tables, and cross-write through handshake functions that emit events.
3. RLS is enforced at the DB, not just the app.
4. The event log is append-only by database grant.
5. Config (journey/SLA/gates/templates/copy) changes without a code deploy.
6. Customer-facing surfaces pass through the H10 visibility filter.
7. The full system builds and tests locally with **no AWS account**; the identical image deploys to AWS by re-pointing env.
8. v1's modules are carried, not rewritten ([`v1-reuse.md`](v1-reuse.md)).
9. No passwords are stored; no secret is committed.
