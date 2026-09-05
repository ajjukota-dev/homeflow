# HomeFlow

Post-sales operating system for Pranava’s villa and apartment projects.

**Taking this repo over?** Read [`HANDOFF.md`](HANDOFF.md) first — what the business is, what is demo vs production, Google login, and AWS CDK work remaining.

After a family books a unit, HomeFlow is the system that collects money, generates papers, tracks that exact home’s construction, handles customer changes (kitchen, flooring), registers the sale, hands over keys, and supports the home after move-in.

This is **not** the office-leasing / FMWork product in `pranavaPortal`. Same company, different product.

## What’s in this repo

| Path | What it is |
|---|---|
| [HANDOFF.md](HANDOFF.md) | Handoff: built vs remaining, seeded demo data, Google login, productionise |
| [docs/CONTEXT.md](docs/CONTEXT.md) | Plain-English product story and how the flow works |
| [docs/HOMEFLOW-OS.md](docs/HOMEFLOW-OS.md) | Full structured OS spec from the canvas — twins, villa flow, modules, gates, build contracts |
| [docs/Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf](docs/Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf) | Full design spec v8 (source of truth) |
| [canvases/homeflow-2-design-spec.canvas.tsx](canvases/homeflow-2-design-spec.canvas.tsx) | Interactive canvas of the full spec — keywords, journey, modules, gates, Emergent build rules |

## How to open the canvas

In Cursor, open this folder as the workspace, then open `canvases/homeflow-2-design-spec.canvas.tsx` beside chat. Start on the **Plain English** tab.

## Three things that never mix

- **Project** — East Crest (or any site). All reporting rolls up here.
- **Unit** — the physical villa/flat. Exists before it is sold. Keeps history if the buyer changes.
- **Booking** — this customer + this unit + this ownership period.

## Running the local stack

Everything runs on a laptop — Postgres 16, MinIO, Mailpit and the FastAPI image — with no AWS
account (`docs/spec/technical/10-infra-and-delivery.md` §2).

```bash
cp .env.example .env          # .env is git-ignored
docker compose up -d --build  # or: npm run stack:dev
curl http://localhost:8001/health          # {"db":"ok","s3":"ok","version":"…"}
```

| Service | URL |
|---|---|
| API | http://localhost:8001 (`/health`, `/api/docs`) |
| Postgres | `localhost:5434` (inside compose: `postgres:5432`) — override with `POSTGRES_HOST_PORT` |
| MinIO console | http://localhost:9001 (`homeflow` / `homeflow123`), bucket `homeflow-files` |
| Mailpit | http://localhost:8025 |

Tests: `docker compose exec api uv run pytest` (or `npm run stack:test`). The RLS sweep and the
other stack tests are marked `integration` and run against the compose Postgres from the host:
`cd services/api && uv run pytest -m integration`.

### `make` on Windows

`Makefile` is the canonical entry point (`make dev | down | reset | test | lint | e2e | synth`),
but Windows has no `make` out of the box. Either install it —

```powershell
winget install GnuWin32.Make      # or: choco install make
```

— or use the equivalent npm scripts, which run the same docker compose commands:
`npm run stack:dev | stack:down | stack:reset | stack:test`.

## Running the two frontends

Both apps are Vite (`docs/spec/technical/09-frontend.md`). In dev each runs on its own port and
proxies `/api` and `/auth` to the API on `:8001`, so the `hf_session` cookie stays same-origin.

```bash
npm install                                     # one install for the whole workspace
npm run dev:workspace                           # internal app  → http://localhost:5173
npm run dev:customer                            # customer app  → http://localhost:5174
```

Sign in to the workspace at `/login`. With `VITE_DEV_LOGIN=1` (set in `apps/workspace/.env.local`)
the screen also lists the seeded staff — `aarti.rao@pranava.local` (super admin), `sneha.reddy`
(CRM), `nikhil.varma` (sales), and the rest. The API refuses that route unless `ENV=local`.

**In the container both apps are served by the API by `Host` header** — no separate web server,
no CORS. `docker compose up -d --build` then:

| Host | Serves |
|---|---|
| http://localhost:8001/ | the workspace |
| http://my.localhost:8001/ | My Pranava Home (browsers resolve `*.localhost` to loopback) |

For curl: `curl -H "Host: my.localhost:8001" http://localhost:8001/`.

Shared frontend code lives in `packages/ui` (`@homeflow/ui`): design tokens, the API client,
`useSession`, `useQuery`, `<Async>` and the component set. Tokens are the **only** place colours,
spacing, radii and type are defined; an ESLint rule fails a build that hard-codes a hex or a pixel.

```
npm run build       # packages/ui + both apps
npm run typecheck   # tsc --noEmit everywhere
npm run lint        # eslint
npm test            # vitest
npm run test:e2e    # playwright, 1440 / 768 / 375
npm run gen:api     # regenerate packages/ui/src/api/types.ts from the running API
```

## CI

`.github/workflows/ci.yml` runs on every pull request and every push to `main`.

| Job | What it runs | A PR fails when |
|---|---|---|
| **backend** | `ruff`, `mypy --strict`, `pytest` against `postgres:16` + MinIO service containers | lint, types or any of the 121 tests fail |
| **frontend** | `tsc --noEmit`, `eslint`, `vitest`, `npm run build` for `packages/ui` and both apps | a type error, a lint error (including a Tailwind arbitrary value), a failing test, or a broken build |
| **image** | `docker build`, run the image, wait for `/health`, check both hostnames serve, `npm run gen:api` + `git diff --exit-code`, `schemathesis`, Playwright at three breakpoints | the image will not build or boot, a hostname serves the wrong app, `packages/ui/src/api/types.ts` is stale, the contract returns a 5xx, or a screen test fails. Screenshots upload as an artifact either way |
| **infra** | `npm test -w @homeflow/infra`, `cdk synth` for prod and staging | a CDK assertion regresses (NAT gateway, unencrypted RDS, public bucket, `s3:*` in the task role, …) or synth breaks |
| **api-surface** | posts the generated-types diff versus `main` as a PR comment | never — it is informational, and it is skipped when the surface did not change |

Which Python files are linted and type-checked is one list, `scripts/ci-targets.sh`, sourced by
both the workflow and the local runner. v1's carried modules are not on it; each is added in the
PR that ports it.

### Running CI on a laptop

```bash
npm run stack:dev            # the compose stack must be up
npm run ci:local             # every job, in CI's order
npm run ci:local -- backend  # or: frontend | contract | image | e2e | infra
```

`scripts/ci-local.sh` runs the same commands in the same order and prints a pass/fail line per
step. What it cannot mirror: GitHub's service containers (it uses the compose stack you already
have) and the image job's empty database.

`.github/workflows/release.yml` builds and deploys on a `v*` tag, but it is **not armed** — it is
gated on a repository environment named `prod` with required reviewers, which does not exist and
must not until Pranava approves the AWS account, region and budget. See `infra/README.md`.
