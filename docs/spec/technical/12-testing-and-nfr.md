# 12 · Testing and non-functional requirements

---

## 1. Test pyramid

| Level | Where | Runner | What must be covered |
|---|---|---|---|
| Domain unit | `services/api/domain/test_*.py` | pytest + hypothesis | every engine in [`06`](06-domain-engines.md); ≥ 80 % line coverage on `domain/`, monotonic properties |
| Kernel unit | `services/api/kernel/**/test_*.py` | pytest (fake `Tx`, injected `Clock`) | action transitions, SLA ladder, ranking cache, event catalogue, consumers map, job runner retry/dead, OTP + session logic, redaction, H10 builders |
| Integration | `services/api/tests/integration/` | pytest against compose Postgres + MinIO, as `homeflow_app` | each handshake H1–H12 end to end (request → rows → events → jobs → receiving Action), RLS matrix, grants, presign/confirm, document generation to a real PDF, ticker advisory lock |
| Contract | CI job | schemathesis | every route, both realms, no 500, no hidden key in customer responses |
| Security | `services/api/tests/security/` | pytest | the checklist in [`03`](03-identity-and-access.md) §10, write fences, CSRF, open redirect, no-existence-leak 404s |
| Component | `apps/**/src/**/*.test.tsx`, `packages/ui` | Vitest + RTL | every shared component; every page's loading/empty/error/data states; axe on render |
| E2E / visual | `apps/*/e2e/*.spec.ts` | Playwright, 1440 / 768 / 375 | one happy path per role slice; screenshots reviewed; zero console errors |
| Acceptance | `services/api/tests/acceptance/` + e2e tags | pytest / Playwright | one automated test per acceptance test id (below) |

`make test` runs the first two levels plus Vitest; CI runs everything. A PR that adds behaviour without a test at the right level is not merged.

## 2. Acceptance traceability

Every "Key behaviours (acceptance-testable)" item in the foundation files and every "Part 4" item in the role specs has a stable id: `F-<file>-<n>` (e.g. `F-gates-4` = "HARD_CLOSED cannot be reopened by ordinary override") and `R-<role>-<n>`. A test declares it with `@pytest.mark.acceptance("F-gates-4")` or a Playwright tag `@F-gates-4`. `scripts/traceability.py` lists ids with no test and fails CI once a slice that owns them is marked done in `docs/TASKS.md`. The generated matrix is committed to `docs/spec/technical/traceability.md` on release.

## 3. Fixtures and data

- Domain tests: dataclass literals, no DB.
- Integration: a per-test transaction rolled back, on a database migrated once per session; `factories.py` builds project → unit → booking → … through the real handshake functions so every fixture has consistent events.
- E2E: the demo seed (`HOMEFLOW_DEMO=1`), reset by `make reset` before the run; tests never depend on order.
- Time: `Clock` injected everywhere SLA/forecast math runs; tests never sleep.

## 4. Non-functional targets

| Area | Target | How it is met / checked |
|---|---|---|
| Latency | p95 ≤ 400 ms for list/360 reads, ≤ 1.5 s for handshake writes, ≤ 3 s for `/me/home`, at 50 concurrent users | indexed queries (02 §5), cached rank/score columns, `tower.refresh` off the request path; k6 script in `services/api/tests/perf/` run before go-live and quarterly |
| Throughput | 20 req/s sustained on one 0.5 vCPU task | same k6 run |
| Availability | 99.5 % monthly (single-AZ RDS, 1–2 tasks); 99.9 % after the Multi-AZ trigger fires | ALB health checks, ECS circuit breaker, alarms (10 §4) |
| Durability | RPO ≤ 5 min (PITR), RTO ≤ 1 h; S3 versioning 90 d | restore drill quarterly (10 §8) |
| Data residency | all data and backups in `ap-south-1` | CDK region pinned; no cross-region replication |
| Security | no passwords; sessions revocable; RLS on every partitioned table; append-only event; least-privilege task role; TLS everywhere; secrets in Secrets Manager; dependency audit (`pip-audit`, `npm audit`) in CI | tests in 03 §10 + CI |
| Privacy | PAN/Aadhaar/bank masked by default; consent gates outbound comms; export controlled by role | redaction tests; `notify.send` guardrails test |
| Auditability | every consequential change → event with actor, before/after, reason where required; reconstructable by `correlation_id` | 04 §7 tests; catalogue coverage test |
| Accessibility | WCAG 2.1 AA: keyboard, focus, labels, 4.5:1, status not by colour alone | axe in e2e; component tests for chips |
| Responsiveness | usable at 320 px; verified at 375 / 768 / 1024 / 1440 | Playwright screenshots |
| Browser support | last 2 versions of Chrome, Edge, Safari (macOS/iOS), Firefox; Android Chrome for the customer app | Playwright projects: chromium, webkit |
| Observability | every error carries a `request_id` visible to the user and searchable in logs; dead jobs alarm within 5 min | 10 §7 |
| Maintainability | files ≤ ~200 lines; `mypy --strict` on domain/kernel; import contracts; no unused exports; one-line spec reference per module | CI |
| Cost | ≤ USD 100 / month in prod at this scale | AWS budget alarm at 80 USD |
| Capacity ceilings | 1 M events/year, 10 k Actions open, 5 k files/month without design change | architecture §11 lists the trigger for each change |

## 5. Definition of done (per slice) — restated as checks

1. `make lint` and `make test` green; new behaviour has tests at the level in §1.
2. `npm run build` clean for both apps; `npm run synth` clean.
3. Playwright screenshots at three breakpoints reviewed; zero console errors; axe clean.
4. Every new list/tab has loading, empty, error, data states.
5. Acceptance ids owned by the slice have tests (§2).
6. `make dev` from a fresh clone still boots; every migrated v1 screen still renders.
7. No spec drift, or the spec (foundation first, then this set, then role spec) was updated in the same PR.
