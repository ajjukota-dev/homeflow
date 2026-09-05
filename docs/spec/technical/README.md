# Technical Spec · HomeFlow 2.0

How the functional spec ([`../../HOMEFLOW-OS.md`](../../HOMEFLOW-OS.md), [`../foundation/`](../foundation/), [`../roles/`](../roles/)) is built on the architecture ([`../foundation/architecture.md`](../foundation/architecture.md)). The foundation says *what* and *why*; this set says *exactly how*: packages, tables, policies, flows, signatures, endpoints, pipelines.

**Precedence:** foundation → this technical spec → role specs' API/UI sections → code. If a role spec and this set disagree on mechanics (table shape, endpoint shape, auth), this set wins; if this set and a foundation file disagree on behaviour, the foundation wins and this set is fixed.

**Scale it is designed for** (from the PDF and Pranava's operations): projects in single digits, units in hundreds per project, bookings in low thousands, staff users ≈ 50–100, customers ≈ low thousands, events ≈ 1–2 M/year. Every number below assumes this; [`../foundation/architecture.md`](../foundation/architecture.md) §11 says what changes when it stops being true.

---

## Files

| # | File | Answers |
|---|---|---|
| 01 | [`01-backend-layout.md`](01-backend-layout.md) | Package layout, the module contract, kernel ports, request lifecycle, dependency rules |
| 02 | [`02-database.md`](02-database.md) | Naming, standard columns, kernel table DDL, RLS policies, grants, indexes, migrations, seeds |
| 03 | [`03-identity-and-access.md`](03-identity-and-access.md) | Google OIDC, customer OTP, sessions, CSRF, principal, RBAC matrix, field redaction, RLS GUCs |
| 04 | [`04-events-and-jobs.md`](04-events-and-jobs.md) | Append-only event log, transactional outbox, job ticker, schedules, retries, job catalogue |
| 05 | [`05-action-and-journey.md`](05-action-and-journey.md) | Action kernel, ranking, SLA ladder, escalation producer, journey engine ported from v1 |
| 06 | [`06-domain-engines.md`](06-domain-engines.md) | Python signatures for the pure engines (gates, collections, clearance, readiness, handover, tower, legal) |
| 07 | [`07-api.md`](07-api.md) | Conventions, the consolidated endpoint map by module, OpenAPI, contract tests |
| 08 | [`08-files-documents-notifications.md`](08-files-documents-notifications.md) | S3 file objects, Document Factory, notification outbox and adapters, the H10 filter |
| 09 | [`09-frontend.md`](09-frontend.md) | Two Vite apps, `packages/ui`, routing, data layer, auth state, required UI states |
| 10 | [`10-infra-and-delivery.md`](10-infra-and-delivery.md) | Dockerfile, compose, Makefile, CDK stacks, CI/CD, env and secrets, observability, backup/restore |
| 11 | [`11-migration-runbook.md`](11-migration-runbook.md) | Mongo → Postgres + GridFS → S3: scripts, order, verification, cutover |
| 12 | [`12-testing-and-nfr.md`](12-testing-and-nfr.md) | Test pyramid, commands, coverage gates, acceptance traceability, non-functional targets |

Read 01 → 02 → 03 → 04 before writing any backend code. Read 09 before touching either app. Read 10 before `make dev` is changed.

---

## Fixed decisions (do not reopen in code)

| Decision | Value |
|---|---|
| Language / framework | Python 3.12 · FastAPI · SQLAlchemy 2 (async, `asyncpg`) · Alembic · Pydantic v2 |
| Frontend | TypeScript strict · React 19 · Vite · Tailwind 3 · react-router 7 · axios · react-hook-form + zod |
| Database | PostgreSQL 16 — RDS in AWS, `postgres:16` locally. App connects as `homeflow_app` (RLS on, no superuser). |
| Ids | `uuid` v7 generated in SQL by `uuid_generate_v7()` (migration 0001); never client-supplied. |
| Time | `timestamptz` UTC in the DB; ISO-8601 on the wire; IST only at render. |
| Money | `numeric(14,2)` INR; never float. |
| Events | `event` table, append-only by grant. |
| Background work | `job` + `schedule` tables, in-process ticker under `pg_try_advisory_lock`. |
| Identity | Staff: Google OIDC server-side. Customers: OTP. `session` table, cookie `hf_session`. No passwords. |
| Files | S3 / MinIO via `boto3`; `file_object` rows in Postgres; presigned URLs only. |
| Compute | One image: API + both SPAs + ticker. ECS Fargate + ALB. Region `ap-south-1`. |
| Infra | CDK TypeScript, `data` + `service` stacks. |
| New dependency | Ask first. The allowed set is in 01 §6 and 09 §2. |
