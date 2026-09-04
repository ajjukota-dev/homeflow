# 03 — Platform: persistence, ports, container, AWS, CI

## Purpose
Make the app run the same on a laptop and on AWS, with a prod-ready claim for the demo (TODO §3, §7 #14): HTTPS URL, real login, persistent Postgres with backups, health check, logs, measured cost. This is spikes S1, S3, S4, S5, S6, S7, S8 in TODO §7a, delivered as one feature.

## Data / infrastructure
| Piece | Choice **[ours]** |
|---|---|
| `db` port | `query<T>(sql, params)`, `tx(fn)`. Adapters: `pglite` (in-memory for tests; file `./.data/pglite` for dev), `pg` (Pool from `DATABASE_URL`). Chosen by env. SQL must be valid on both (no PGlite-only or pg-only extensions; `citext` and `pgcrypto` verified on both) |
| Migrations | `services/api/migrations/NNNN_name.sql`, `schema_migration` table, runner `npm run migrate` also invoked at API boot; forward-only; each additive |
| `files` port | `putPresigned(key, contentType)`, `getPresigned(key)`, `delete(key)`; adapters `local-disk` (`./.data/files`, served by API in dev) and `s3` (bucket from env). Keys `project/{project_id}/{entity}/{id}/{uuid}.{ext}`. Max 25 MB; images/PDF only |
| `mailer` port | `send({to, subject, html, text})`; adapters `smtp` (Gmail, `SMTP_*` env), `file` (writes `.eml` to `./.data/mail` for tests/dev). Templates in `services/api/src/mail/templates/*.html`, brand-neutral, plain layout |
| `pdf` port | `render(html) → Buffer` via Playwright Chromium in the container (`mcr.microsoft.com/playwright` base or `apt` deps); fonts with ₹ and Indic glyphs installed; A4; test renders a sample AOS |
| `clock` port | `nowIst()`, `todayIst()`; injectable |
| `llm` port | `complete({system, user, json_schema?}) → {text|json, tokens, cost_inr}`; adapter `openai` (`OPENAI_API_KEY`, model from env, default `gpt-4o-mini`), adapter `fake` for tests. Every call logged to `llm_call` (purpose, tokens, cost) |
| Container | One `Dockerfile` (multi-stage: build both SPAs, build API, runtime node:20 + Chromium deps). API serves `/` → workspace, `/home` → my-pranava-home, `/api/*` → handlers. `PORT` 8080. `GET /health` checks DB |
| AWS | Account `975050032697`, `ap-south-1`, profile `pranava`. **App Runner** service from ECR image (1 vCPU / 2 GB, min 1 instance) · **RDS Postgres 16** `db.t4g.micro`, 20 GB gp3, single-AZ, automated backups 7 d, deletion protection on · **S3** bucket (private, SSE-S3, lifecycle none) · **ECR** repo · **Secrets Manager** for `DATABASE_URL`, `SESSION_SECRET`, `SMTP_PASS`, `OPENAI_API_KEY` · IAM role for App Runner (S3 + Secrets read) · CloudWatch logs 30 d · AWS Budget alert at ₹5,000/month to Amarsh's email. IaC: a small CDK app in `infra/` replacing the old stacks (`cdk deploy` idempotent) |
| CI | GitHub Actions: `typecheck`, `test` (API, workspace, portal), `e2e` (Playwright, `--workers=4`, screenshots as artifacts), `docker build`. `deploy` job on `main`: build → push ECR → App Runner deploy → run migrations → smoke `GET /health` and login |

## Rules
1. No cloud service is a hard dependency of a core workflow: every port has a local adapter; `npm run dev` works offline.
2. Same SQL, both adapters: the full API suite runs against PGlite in CI and against a Postgres service container nightly/`workflow_dispatch`.
3. One DB per test file (`createTestDb()`); Playwright specs seed through the API, never share state.
4. Secrets only from env/Secrets Manager; `.env.example` lists every variable with a comment; the repo has no secret (CI grep for `sk-`, `AKIA`, `SMTP_PASS=` patterns fails the build).
5. Deploy is scripted and repeatable: `npm run deploy` from a clean checkout of `main` produces the same service.
6. Cost is measured: after S3, record the App Runner + RDS + S3 monthly estimate from Cost Explorer / pricing in TODO §9.
7. Old `infra/` (Cognito, EventBridge, Aurora, Lambda, HTTP API) is deleted in the same PR that adds the new IaC.

## Acceptance
- Spike proofs: 100 API tests green against RDS via `pg` (S1) · `https://<app-runner>.awsapprunner.com/health` returns 200 with DB check (S3) · login works on that URL with seeded users (needs 01) · sample AOS PDF renders in-container with ₹ glyph (S4) · phone photo upload → S3 → visible in QA screen (S5) · Playwright `--workers=4` green (S6) · invite mail arrives via Gmail SMTP (S7) · one OpenAI classification call logged with cost (S8).
- Rule tests 1–4; a "secret grep" CI step demonstrably fails on a planted fake key once, then passes.

## Depends on / Feeds
Depends on nothing. Feeds everything.

## Files
`services/api/src/ports/**`, `services/api/src/db/**`, `services/api/migrations/**`, `services/api/src/mail/**`, `services/api/src/pdf/**`, `services/api/src/llm/**`, `Dockerfile`, `.dockerignore`, `infra/**` (rewritten), `.github/workflows/**`, `.env.example`, root `package.json` scripts, `apps/*/vite.config.ts` (base paths).

## Not in this feature
Custom domain/TLS cert (needs Pranava's domain — TODO §8); multi-AZ/read replicas; WAF; SES.
