# Local-first Postgres 16 runbook

Phase 5.5 default. This is **not** an AWS deploy. Do not create App Runner, RDS, or CDK stacks until spend is an explicit yes. The old URL `https://we947t2rq2.ap-south-1.awsapprunner.com` is R0 — not this `main`.

Handlers stay the same. Only the `db` adapter changes.

## Two local databases

| | Default laptop (this demo) | Optional parity |
|---|---|---|
| Engine | PGlite (WASM Postgres) | Postgres 16 in Docker |
| When | `DATABASE_URL` **unset** | `DATABASE_URL` set |
| File / volume | `services/api/.data/pglite` | Docker volume `homeflow_pg` |
| Tests | Always in-memory PGlite (`NODE_ENV=test` / `VITEST`) | not used by vitest |
| Backup | Copy the `.data/pglite` directory while the API is **stopped** | `docker compose` volume, or `pg_dump` |

Compose file: repo-root [`docker-compose.yml`](../../docker-compose.yml) (`postgres:16`, host port **5433** unless `POSTGRES_HOST_PORT` is set). Env template: [`.env.example`](../../.env.example).

## PGlite (no Docker)

```bash
# Stop API first
cd services/api
npm run db:reset          # deletes ./.data/pglite
npm start                 # migrate + config seed + demo seed on empty DB
# GET http://localhost:3001/health  →  {"ok":true,"db":true}
```

Vite UIs (new terminals):

```bash
npm run dev:web                                 # workspace http://localhost:5173
npm --prefix apps/my-pranava-home run dev       # portal  http://localhost:5174
```

Use `localhost`, not `127.0.0.1` (Vite binds `[::1]`).

Demo seed runs only when `NODE_ENV` is not `production`, unless `SEED_DEMO=1`. Production-shaped boots must not get Karthik.

## Postgres 16 (Docker)

Costs nothing beyond local Docker. Do not point this at RDS.

```bash
docker compose up -d postgres
# wait until healthy (pg_isready in the compose healthcheck)

# services/api/.env.local (gitignored) — copy from .env.example:
# DATABASE_URL=postgres://postgres:postgres@localhost:5433/homeflow
# PORT=3001
# SESSION_SECRET=a-long-random-string

cd services/api
# First boot: migrations + seed via initDb() on npm start
# Or migrations only:
npm run migrate
npm start
```

Same UI commands as above. RLS (`homeflow_app` + `app.realm` / `app.project_ids`) is on the request path for both adapters (`wrapWithRls`). Do not unset it to make a test pass.

## Scheduler, mail, files

- Scheduler: on after listen (default 60s). `HOMEFLOW_SCHEDULER=0` to disable.
- Mail: unset `SMTP_HOST` → files under `services/api/.data/mail` (invite links).
- Files: unset `FILES_BUCKET` → `services/api/.data/files`.

## Health and backups

- Health: `GET http://localhost:3001/health` must return `{"ok":true,"db":true}`.
- PGlite backup = copy `services/api/.data/` (stop API first). Restore = replace the directory, then start.
- Postgres backup = `docker volume` `homeflow_pg`, or `pg_dump -h localhost -p 5433 -U postgres homeflow`.
- Reset PGlite demo: stop API → `npm run db:reset` → start. Reset Docker: `docker compose down -v` (destroys the volume) then `up -d` and start the API.

## What this runbook is not

- Not App Runner / RDS / Cognito Hosted UI.
- Not a fix for GitHub Actions `ci` / `deploy` credentials.
- Not Google OIDC. Email/password is the local identity.
