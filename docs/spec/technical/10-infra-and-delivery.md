# 10 · Infrastructure and delivery

One image, everywhere. Locally under `docker compose`; in AWS on ECS Fargate behind an ALB with RDS and S3 ([`../foundation/architecture.md`](../foundation/architecture.md) §2–3, §7). Nothing in the image knows which.

---

## 1. Dockerfile (`services/api/Dockerfile`)

```dockerfile
FROM node:22-alpine AS web
WORKDIR /w
COPY package*.json ./ ; COPY apps ./apps ; COPY packages ./packages
RUN npm ci && npm run build -w apps/workspace -w apps/my-pranava-home

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf-2.0-0 fonts-noto-core && rm -rf /var/lib/apt/lists/*   # WeasyPrint
WORKDIR /app
COPY services/api/pyproject.toml services/api/uv.lock ./
RUN pip install uv && uv sync --frozen --no-dev
COPY services/api ./
COPY --from=web /w/apps/workspace/dist ./static/workspace
COPY --from=web /w/apps/my-pranava-home/dist ./static/customer
USER 1000
EXPOSE 8001
HEALTHCHECK CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8001/health')"
CMD ["./entrypoint.sh"]      # alembic upgrade head (advisory lock) → seed config → uvicorn app:app --host 0.0.0.0 --port 8001 --workers 1
```

One uvicorn worker per task (the ticker is per process; scale by tasks, not workers). Image ≈ 350 MB. Built once in CI, tagged with the git SHA, pushed to ECR; the same tag is what `docker compose` runs when `HOMEFLOW_IMAGE` is set (otherwise compose builds locally with the source mounted).

## 2. `docker-compose.yml`

| service | image | notes |
|---|---|---|
| `postgres` | `postgres:16` | `POSTGRES_DB=homeflow`; init script creates `homeflow_owner` and `homeflow_app`; volume `pg` |
| `minio` | `minio/minio` | console `:9001`, API `:9000`; volume `minio` (`./.data/minio`); `mc` sidecar creates bucket `homeflow-files` |
| `mailpit` | `axllent/mailpit` | SMTP `:1025`, UI `:8025` |
| `api` | built from `services/api` | `:8001`; `./services/api` mounted; `--reload`; env from `.env` |

`.env.example` lists every key in [`01`](01-backend-layout.md) §5 with local values. No LocalStack, no cognito-local, no worker service.

## 3. Makefile

```
dev:    docker compose up -d --build && $(MAKE) wait && docker compose exec api alembic upgrade head && docker compose exec api python -m seeds.config && [ "$$HOMEFLOW_DEMO" = 1 ] && docker compose exec api python -m seeds.demo || true
down:   docker compose down
reset:  docker compose down -v && $(MAKE) dev
test:   docker compose exec api pytest && npm test --workspaces
e2e:    npm run e2e --workspaces
lint:   docker compose exec api sh -c "ruff check . && mypy ." && npm run lint --workspaces
synth:  cd infra && npm run synth
```

`make dev` on a fresh clone must reach a green `/health` and a rendered workspace within a few minutes with no AWS account (architecture §7 acceptance).

## 4. CDK (`infra/`, TypeScript, `ap-south-1`)

Two stacks, one `bin/homeflow.ts`, `stage` context (`prod`; `staging` when needed).

**`DataStack`** (everything `RemovalPolicy.RETAIN`, `terminationProtection: true` in prod)
- `ec2.Vpc` — 2 AZs, public subnets only (`natGateways: 0`), plus isolated subnets for RDS.
- `rds.DatabaseInstance` — `PostgresEngineVersion.VER_16`, `t4g.micro` (prod flag → `t4g.small`, `multiAz`), 20 GB gp3 autoscaling to 100, `storageEncrypted`, `backupRetention: 14 days`, `deletionProtection`, `enablePerformanceInsights`, parameter group `rds.force_ssl=1`, credentials `homeflow_owner` in Secrets Manager with rotation; a custom resource (Lambda, one-off) creates `homeflow_app` and stores its secret.
- `s3.Bucket` files — `blockPublicAccess: ALL`, `versioned`, `encryption: S3_MANAGED`, lifecycle noncurrent → IA 90 d, CORS for presigned PUT from the two hostnames.
- `s3.Bucket` alb-logs.
- `secretsmanager.Secret` × 3 — `google-oauth`, `messaging-provider`, `session-secret` (values set by hand once, never in code).
- Outputs: VPC id, DB secret ARNs, bucket names.

**`ServiceStack`**
- `ecr.Repository` (or import).
- `ecs.Cluster` on the VPC; `ecsPatterns.ApplicationLoadBalancedFargateService` — `cpu: 512, memoryLimitMiB: 1024, desiredCount: 1` (prod flag → 2), `assignPublicIp: true` (public subnets, no NAT), `taskSubnets: public`, container port 8001, health check `/health`, `circuitBreaker: { rollback: true }`, `minHealthyPercent: 100, maxHealthyPercent: 200`.
- Environment from settings table; secrets via `ecs.Secret.fromSecretsManager` (`DATABASE_URL` assembled by the entrypoint from the app secret's fields).
- Task role: `s3:GetObject/PutObject/DeleteObject/ListBucket` on the files bucket only; `ses:SendEmail` from `noreply@pranava.in`; `secretsmanager:GetSecretValue` on the three secrets. Nothing else.
- Security groups: ALB ← 443 from anywhere (80 → 301 to 443); service ← ALB only; RDS ← service SG only.
- `certificatemanager.Certificate` (DNS-validated) for `homeflow.pranava.in` + `my.pranava.in`; `route53.ARecord` × 2 → ALB (hosted zone imported).
- Logs: `awslogs` driver → `/homeflow/api`, 90-day retention. Alarms (SNS → email): ALB 5xx rate > 2 % for 5 min, target unhealthy, RDS free storage < 2 GB, RDS CPU > 80 % 15 min, metric filter on log pattern `"job.dead"` > 0.
- Scheduled scale-to-zero for `staging` only.

`npm run synth` runs in CI on every PR; `cdk deploy` only from the release workflow, only after Pranava approves account, region and budget (HANDOFF rule).

## 5. CI/CD (GitHub Actions)

**`ci.yml`** on every PR and push to `main`:
1. `services/api`: `uv sync` → `ruff` → `mypy` → `pytest` (unit; integration against a `postgres:16` + `minio` service container) → import-linter contracts.
2. `apps/*`, `packages/ui`: `npm ci` → `tsc --noEmit` → `eslint` → `vitest` → `npm run build`.
3. `docker build` the image (no push) → start it with the service containers → `schemathesis` contract run → Playwright e2e at three breakpoints → upload screenshots as artifacts.
4. `infra`: `npm run synth`; diff of `openapi.json` posted as a PR comment.

**`release.yml`** on a tag `v*`: build → push to ECR (`:sha`, `:vX.Y.Z`) → `cdk deploy ServiceStack --require-approval never` with the new tag → smoke test `GET /health` and one authenticated request → notify. `DataStack` is deployed manually, by a person, with `--require-approval broadening`.

Rollback = redeploy the previous tag (ECS keeps the last task definition; the circuit breaker rolls back a failing deploy automatically). Migrations are forward-only, so a rollback must be to a version compatible with the current schema; every migration PR states that.

## 6. Secrets and configuration

| Secret | Where | Rotation |
|---|---|---|
| RDS owner + app passwords | Secrets Manager (RDS-managed) | 30 days automatic; the app reads at start |
| Google OAuth client secret | Secrets Manager `google-oauth` | manual, on compromise |
| Messaging provider key | Secrets Manager `messaging-provider` | manual |
| `SESSION_SECRET` | Secrets Manager `session-secret` | yearly; invalidates only OTP hashes |
| Local | `.env` (git-ignored) | — |

No secret in git, CDK code, task definitions as plain env, or logs (a log formatter redacts `password`, `secret`, `token`, `code`).

## 7. Observability

- Logs: JSON lines `{ts, level, request_id, correlation_id, user_id, realm, route, status, duration_ms, msg}`; CloudWatch Logs Insights queries saved for "errors by route", "slow requests", "dead jobs".
- Health: `GET /health` → `{ db: ok, s3: ok, ticker: { holder: bool, last_tick_at }, version }`; the ALB checks it every 30 s.
- Metrics: ALB and RDS built-ins; app-level counts (jobs done/failed, events appended, OTPs sent) as log lines with `metric:` prefix → metric filters. No custom metrics SDK.
- Tracing: `request_id` end to end (browser sends `X-Request-Id`; error screens show it). X-Ray only if this proves insufficient.

## 8. Backup and restore

- RDS automated backups 14 days + PITR (RPO ≤ 5 min). S3 versioning (a deleted or overwritten object is recoverable for 90 days as a noncurrent version).
- **Restore drill**, quarterly and before go-live: restore the RDS snapshot to a new instance, point a staging service at it, run the RLS + acceptance tests, record time (target RTO ≤ 1 h). Runbook in `infra/README.md`.
- Config seeds are code; demo data is disposable; the `event` table is the audit of record and is included in every backup by construction.

## 9. Environments

| | local | staging (on demand) | prod |
|---|---|---|---|
| Stack | compose | both stacks, `stage=staging`, `t4g.micro`, 1 task, scale-to-zero nightly | both stacks, `stage=prod` |
| Data | seeds | anonymised snapshot of prod | live |
| Hosts | `localhost:8001`, `my.localhost:8001` | `staging.homeflow.pranava.in`, `my-staging.…` | `homeflow.pranava.in`, `my.pranava.in` |
| Google | dev OAuth client | prod client (extra redirect URI) | prod client |
| Messaging | console | provider sandbox | provider |
