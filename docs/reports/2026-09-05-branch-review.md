# Branch review and consolidation brief — 5 Sep 2026

**Written for Amarsh's agent, running on Amarsh's laptop.** Read this whole file before touching the repository. It records what two people built in parallel on the same product, the evidence gathered, the decision taken, and exactly how to consolidate the two lines of work and then produce the task file. Nothing in this file is a guess; every number was measured on Vivek's laptop on 5 Sep 2026 and the command that produced it is quoted. Amarsh's laptop also carries uncommitted work of his own; section 5 says what to do with it before anything else.

Requirement authority throughout is **the spec**: `docs/Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf`, Rambabu's 48-page HomeFlow 2.0 design spec, tracked in both branches; `docs/HOMEFLOW-OS.md` is its transcription. Wherever this file says "the spec" it means that document; Amarsh's files cite it by page as `pNN §X`. The spec names no language, database, cloud or auth provider. Every stack choice on either branch is an engineering choice, and this review judges them by how well they reach the spec's final state.

---

## 1. The situation in one paragraph

Two lines of work exist. **Amarsh's** is on `origin/main` (also `origin/Amarsh`, same commit `ef7455f`): 72 commits pushed on 5 Sep on top of the TypeScript prototype, with his own spec set under `docs/specs/`, a live deployment, and a passing test suite. **Vivek's** is the uncommitted working tree of this clone (`c:\Users\Vivek\Pranava-HomeFlow`, base commit `5beee5b`, about 136 changed paths): v1's Python backend brought in on Postgres with row-level security, a new identity, events and files kernel, the frontend on Vite, CDK stacks and CI, plus a spec review and a technical spec under `docs/spec/`. Neither author saw the other's work: Vivek's was never pushed, and Amarsh's `CLAUDE.md` now labels `docs/spec/` a legacy draft. Both were built against the same spec in the same 24 hours.

**Decision:** consolidate onto **Amarsh's branch as the base** and port a bounded set of Vivek's foundation pieces into it (section 6). Do not follow Vivek's branch as it stands, and do not take Amarsh's unchanged.

---

## 2. What exists where

### 2.1 Amarsh — `origin/main` at `ef7455f`

```
$ git merge-base --is-ancestor 5beee5b origin/main   → true (our base is an ancestor)
$ git rev-list --count 5beee5b..origin/main         → 72
$ git diff --shortstat 5beee5b origin/main          → 417 files changed, 27365 insertions(+), 5692 deletions(-)
$ git diff --stat 5beee5b origin/main -- docs/spec CLAUDE.md → only CLAUDE.md, 1 line
python files: 0   ts files: 292   *.test.ts(x): 61   TS LOC in services/api: 13,055
```

Stack (from his `TODO.md` §3 and `docs/specs/00-conventions.md`): TypeScript strict, Node, Express handlers written framework-free; PostgreSQL through one `db` port, `pg` in prod (RDS), PGlite persisted to `./.data/pglite` for local dev, PGlite in-memory for tests; SQL migrations `services/api/migrations/0000–0005` applied on boot; self-hosted email/password auth (argon2id, server-side sessions in Postgres, httpOnly cookie), Google sign-in deferred; permission matrix as data with `authorize()` on 49 routes; append-only `event` table with after-commit dispatch to subscribers and a retry job; journey templates plus timeline/SLA engine (pure functions, 99 tests); `packages/ui` design system (Jost, Geist, Newsreader, motion, axe); OpenAI behind an `llm` port; PDF via headless Chromium; one container on AWS App Runner plus RDS `db.t4g.micro` plus S3, provisioned by bash scripts in `infra/scripts/`, in Amarsh's personal account `975050032697`, region `ap-south-1`. CI: `.github/workflows/ci.yml` and `deploy.yml`.

Merged specs (his status board): 03 platform, 01 identity, 32 design system, 02 event log, 04 canonical model, schema reconciliation, R0.6 authorization, R1 screen migration + apartment seed + sale-to-handover journey + roadmap page, R2 05 journey templates (backend), R2 06 timeline & SLA (backend). Remaining 27 specs are listed on his Management → Roadmap page and in `TODO.md` §0 in waves R2–R7.

Live URL recorded in his TODO: `https://we947t2rq2.ap-south-1.awsapprunner.com` (`/health` → `{"ok":true,"db":true}`). R1/R2 not yet deployed there.

His test suite, run here in a scratch worktree:

```
$ git worktree add --detach <scratch>/amarsh-main origin/main && npm ci
$ cd services/api && npx vitest run
  first run: 36 files failed — "Failed to load url @electric-sql/pglite"
  (root `npm ci` did not install services/api's own dependencies; a workspace/lockfile hygiene issue on his side)
$ cd services/api && npm install && npx vitest run
  Test Files  3 failed | 53 passed (56)
  Tests       1 failed | 310 passed | 12 skipped (323)
  the one failure: src/pdf/pdf.test.ts "renders a sample AOS … to an A4 PDF buffer" — needs Chromium installed; environmental
$ cd apps/workspace && npx vitest run   → 64 passed (5 files)
```

Scratch worktree path: `C:\Users\Vivek\AppData\Local\Temp\claude\c--Users-Vivek-Pranava-HomeFlow\065ebd73-d045-4964-b1af-5f1d8f61c8b7\scratchpad\amarsh-main`. Run `git worktree prune` after deleting it.

### 2.2 Vivek — this working tree, uncommitted, base `5beee5b`

```
$ git status --short | wc -l   → 136
```

Built on 5 Sep by three Opus sessions, each with a report in `docs/reports/`:

| Report | Delivered | Verified state |
|---|---|---|
| `2026-09-05-items-1-3.md` | v1 backend copied from `Pranava-V2/HomeFlow` (tag `v1-freeze` = `7854b05`) into `services/api`, reshaped into `kernel/ modules/ domain/`; `docker-compose.yml` (postgres:16 on host 5434, MinIO, Mailpit, api); kernel base (settings, `tx()` with RLS GUCs, error envelope, request id, pagination, idempotency, `/health`); Alembic migrations 0001–0003 with the `rls()` helper; RLS sweep test; uuid v7 | stack healthy, 18 tests |
| `2026-09-05-items-4-6.md` | Google OIDC server-side, customer OTP, session table + `hf_session` cookie, CSRF middleware, permission matrix seeded (585 rows) from v1's `rbac_matrix.py`, redaction; event catalogue (150 + 12 types) with `append()` and same-transaction job fan-out, ticker under advisory lock, retry/dead, schedules; files presign → PUT → confirm → 302 on MinIO/S3 | 121 tests |
| `2026-09-05-items-7-9.md` | v1's frontend on Vite in `apps/workspace` (27 screens, cookie session, no token in browser); `packages/ui` (44 tests); customer OTP sign-in; both SPAs served by the container by hostname; CDK `DataStack` + `ServiceStack` (Fargate, RDS, no NAT; 25 assertions); `.github/workflows/ci.yml` + `release.yml`; `scripts/ci-local.sh` | 121 backend + 49 frontend + 25 infra tests; `npm run ci:local` 16 steps green |

Also in the working tree: `docs/spec/00-REVIEW.md` (review of the original spec against v1), `docs/spec/foundation/v1-reuse.md`, `docs/spec/foundation/architecture.md` (rewritten twice; final: Fargate + RDS + S3, jobs/sessions/events in Postgres, Google OIDC + OTP), `docs/spec/technical/README.md` + `01`–`12` (the technical spec), `docs/TASKS.md` (task split written against that technical spec), `docs/OPEN-ITEMS.md`, `HANDOFF.md` banner, `CLAUDE.md` edits, and the prototype moved to `services/legacy-ts/` and `apps/legacy-ts/`.

Important limits of this work: v1's 30 routers still read and write **Mongo** (gated behind `HOMEFLOW_V1_MONGO`, default off); no business slice was built; the Mongo → Postgres data migration was designed (`docs/spec/technical/11-migration-runbook.md`) but not run; nothing was ever pushed or deployed.

### 2.3 v1 — `C:\Users\Vivek\Pranava-V2\HomeFlow`

Clean tree at `7854b05`, tag `v1-freeze` added by us. FastAPI + Motor/MongoDB, 41 collections, React 19 CRA, built by an Emergent agent over about three weeks (12 Aug – 4 Sep 2026) and previewed at `customer-flow-admin.preview.emergentagent.com`. Not production-proven. Amarsh extracted its business rules into `docs/reference/emergent-business-rules.md` on his branch and treats them as editable seed defaults. Its Google login went through Emergent's broker (`auth.emergentagent.com`).

---

## 3. Findings, with evidence

### 3.1 Amarsh's branch — strengths

1. **Merged, pushed, live, tested.** 310 passing API tests, 64 workspace unit tests, a live URL, CI and deploy workflows.
2. **Journey templates and the timeline/SLA engine exist** (`services/api/src/journey/{dsl,dependency,templates,calendar,engine,sla,instances,subscribers}.ts`, migrations 0004–0005, 99 tests). This is the hardest kernel piece in the spec and Vivek's branch has none of it.
3. **Authorization on every route** via a permission matrix held as data (`authorize()` at 49 call sites).
4. **One language** for API, both UIs and shared types; files ≤ 200 lines; framework-free handlers; a disciplined `TODO.md` with honest scope cuts and a definition of done per PR.
5. **Design system** in `packages/ui` with tokens enforced by lint, axe in E2E, screens migrated (R1).
6. **A coherent build contract** in `docs/specs/00–32` plus `SCHEMA.md` reconciled from the real migrations.

### 3.2 Amarsh's branch — gaps against the spec and against safe operation

| # | Finding | Evidence | Why it matters |
|---|---|---|---|
| G1 | **Project scoping is not enforced anywhere.** Any staff role can read every project's rows through the authorized routes. | `git grep -n "assertProjectScope(" origin/main -- services/api/src` → 0 call sites outside its definition; his own `TODO.md` row R0.6b says the same | spec §4.4: Project is a universal security dimension; his conventions promise `not_found` for rows outside the actor's scope |
| G2 | **No row-level security, and none can be exercised locally.** | `git grep -i "row level security" origin/main -- services/api` → nothing. Local dev and tests run PGlite as a superuser, which bypasses RLS by definition | The DB-level safety net that Vivek's branch has is absent, and would be untestable on a laptop under his current local setup |
| G3 | **The production database is open to the internet.** | `infra/scripts/provision.sh` line 41: `authorize-security-group-ingress … --port 5432 --cidr 0.0.0.0/0`; line 52: `--publicly-accessible`. His comment: App Runner without a VPC connector has no stable egress IP | Password is the only barrier to the system of record |
| G4 | **Email/password sign-in; Google deferred.** | `TODO.md` §3 Auth row and decision 12 | Rambabu's explicit ask (HANDOFF §4.1) was Google login |
| G5 | **Personal AWS account, secrets shared in chat.** | `TODO.md` decisions 6 and 9: account `975050032697`, "access key was shared in chat → rotate"; OpenAI key and Gmail app password likewise | Must move to Pranava's account before any real PII (his own note says so); rotate all three |
| G6 | **Events are not actor-attributed.** | his `TODO.md` row R0.6c: every `appendEvent()` defaults to `actor_kind='SYSTEM'` | Audit trail cannot say who did what |
| G7 | **Local/prod parity is weaker than it looks.** PGlite (Postgres compiled to WASM, single superuser) locally vs RDS in prod. | `services/api/src/db/index.ts` lines 16–23 | Anything role-, grant- or RLS-dependent only fails in prod |
| G8 | **Root `npm ci` does not install `services/api`'s dependencies.** | first test run above | CI and fresh clones need a second install step |
| G9 | Infra is bash scripts, not IaC with tests. | `infra/scripts/*.sh`, no CDK | Fine for a demo; not reproducible in a second account without care |

None of these is a reason to abandon the branch. G1–G4 are exactly what Vivek's branch already solved.

### 3.3 Vivek's branch — strengths

1. **Security foundation the spec requires, proven by tests:** non-superuser app role, RLS enabled and forced on 21 tables, a sweep test that connects as the app role and asserts both "no other-project rows" and "all own-project rows" on every RLS table, append-only `event` by grant (UPDATE/DELETE denied), customer realm sees only its own booking. Files: `services/api/migrations/rls.py`, `migrations/versions/0001–0003`, `tests/rls/`.
2. **Identity as Rambabu asked:** Google OIDC server-side with `hd` enforced from the token claim, customer OTP with rate limits, revocable sessions, no passwords anywhere, one CSRF header rule, 55 security tests. Files: `services/api/kernel/identity/*`, `tests/security/*`.
3. **Transactional events and jobs:** catalogue of all 150 spec event types with a test that parses the foundation markdown, same-transaction job fan-out, ticker with advisory lock, dead-letter. Files: `services/api/kernel/events/*`, `kernel/jobs/*`.
4. **Real Postgres locally** via compose, same engine as RDS, so RLS and grants are exercised on the laptop.
5. **Infra as tested code:** two CDK stacks, no NAT, no public database, task role without wildcards, 25 assertions; synth with no credentials. Files: `infra/lib/data-stack.ts`, `service-stack.ts`, `infra/test/stacks.test.ts`.
6. **A reviewed spec:** `docs/spec/00-REVIEW.md` and `docs/spec/technical/*` contain stack-neutral designs (RLS policy pattern, identity flows, error envelope, NFR targets) that apply to either language.

### 3.4 Vivek's branch — why it is not the base

1. **Never pushed, never seen by the other builder**, so it is not integrated with anything the team is running.
2. **Two languages.** Python backend versus a team and a live system in TypeScript.
3. **v1's business logic is still on Mongo.** The hardest part of that path (migrate 30 routers and 19k lines from Motor to Postgres) had not started. The journey/SLA engine, which Amarsh has, was not started either.
4. **My earlier recommendation to build on v1 is revised.** v1 is a three-week AI build with seed data, not a production system with real users. Its value is the business rules, and those are already extracted on Amarsh's branch. Migrating its code costs about what re-implementing from the rules with tests costs, and only one of those paths keeps one language and one live system.
5. **Team decision on record.** Amarsh's `TODO.md` decision 5 (5 Sep 04:30 IST): "Single owner: Amarsh. Vivek is out of the plan." That is a human matter for Vivek, Amarsh and Rambabu; this brief does not resolve it, but the next session must not act as if it were unresolved.

### 3.5 Scorecard against the spec's requirements

| Spec requirement | Amarsh `origin/main` | Vivek working tree |
|---|---|---|
| Project as a security dimension, enforced | no (G1, G2) | yes, at the DB, tested |
| Append-only event log | yes (trigger), actor attribution missing (G6) | yes (grant), actor from principal |
| Universal Action, My Day, SLA ladder | not built (spec 10, 11) | not built (Action kernel was next) |
| Journey templates + timeline/SLA clocks | built, 99 tests | not built |
| Gates from physics, changeability | prototype engines carried (`gates.ts` etc.) | TS engines preserved for porting, none ported |
| Twins, canonical model, hierarchy | canonical model merged (spec 04) | tables in migrations 0002–0003, no routes |
| Config over code, Policy Studio | matrix, templates, SLA policies as data | permission matrix as data |
| Identity | email/password, sessions | Google OIDC + OTP, sessions, no passwords |
| Local mirrors prod | partly (PGlite vs RDS) | yes (Postgres 16 both sides) |
| Deployed | yes, live | no |
| Tests | 310 API + 64 UI + e2e | 121 API + 49 UI + 25 infra |
| Spec set | `docs/specs/00–32` + SCHEMA | `docs/spec/foundation` + `technical/01–12` |

---

## 4. Decision

**Hybrid on Amarsh's base.** Reasons in order of weight:

1. His branch is where the team, the live system, the tests and the build contract are. Switching the base would discard 27k merged lines and a working deployment to keep 136 unmerged files.
2. The spec is language-agnostic, so nothing in it favours Python. What it does demand and he lacks (G1–G4) is small to port and already built and tested on Vivek's side.
3. One language, one owner model, one spec set. The alternative is two backends for one product.

What this costs Vivek's side: the Python backend, the v1 workspace on Vite, the `packages/ui` package, the CI and CDK as shipped are **not** carried as code. The security foundation, the identity flows, the compose Postgres, the CDK stacks as a reference for locking the database down, and the stack-neutral spec documents **are** carried.

---

## 5. Preserve before you touch anything

Two sets of uncommitted work exist, on two laptops. Neither may be lost, and neither may be merged into `main` blindly.

### 5a. Vivek's laptop — already done when you read this

Vivek's working tree was committed to the branch **`vivek/v1-on-postgres`** (branched from `5beee5b`) and pushed to `origin`, together with this review file. That branch is the source to port from (section 6) and the record of the technical spec. Do not merge it into `main`. Verify it is there:

```bash
git fetch --all --prune
git log --oneline -3 origin/vivek/v1-on-postgres
git show origin/vivek/v1-on-postgres:docs/reports/2026-09-05-branch-review.md | head -5   # this file
```

### 5b. Amarsh's laptop — first action of this session

Before fetching or switching branches, secure whatever is uncommitted on Amarsh's machine:

```bash
git status --short                       # read every line; know what it is
git stash list                           # anything already stashed?
```

If the uncommitted work is a coherent change, commit it on the branch it belongs to. If it is half-done, stash it with a name so it cannot be confused with anything else:

```bash
git stash push -u -m "amarsh pre-consolidation $(date +%F-%H%M)"
```

Write one line in `docs/demo/run-log.md` saying what that uncommitted work was and where it went (commit hash or stash name). Only then:

```bash
git fetch --all --prune
git checkout main && git pull --ff-only          # or stay on his current main if it is ahead of origin
git checkout -b consolidate
npm ci && (cd services/api && npm install)       # G8: the API needs its own install today
cd services/api && npx vitest run                # expect ~310 passed; the pdf test needs Chromium
```

Record the numbers you get in the run-log before changing anything; they are the baseline the ports must not regress.

---

## 6. What to port from `vivek/v1-on-postgres` into the consolidated branch

In this order; each is one PR with tests, following his `docs/specs/00-conventions.md` definition of done.

| # | Port | Source on `vivek/v1-on-postgres` | Target on his base | Notes |
|---|---|---|---|---|
| P1 | **Row-level security + app role + sweep test** | `services/api/migrations/rls.py` (policy pattern), `migrations/versions/0001_kernel.py` (roles, grants, `uuid_generate_v7`, `enforce_project_id`, `set_updated_at`), `0002_core.py` / `0003_twins.py` (which tables get which policy), `tests/rls/test_sweep.py` + `factory.py` | a new SQL migration `services/api/migrations/0006_rls.sql` written against his real tables (`docs/specs/SCHEMA.md`), a `homeflow_app` role, `set_config` of `app.realm / app.user_id / app.customer_id / app.project_ids / app.all_projects` at the start of every transaction in his `db` port (he already resolves `project_ids` in `authz/scope.ts::resolveProjectIds`), and a Vitest port of the sweep. Closes G1 and G2 at the DB. Requires P2 to be testable locally. |
| P2 | **Postgres 16 in Docker for local dev** | `docker-compose.yml` (postgres service, init SQL creating `homeflow_owner` and `homeflow_app`), `docker/postgres-init/01-roles.sql`, `Makefile` / `npm run stack:*` | his `db/index.ts` already selects `pg` when `DATABASE_URL` is set; add the compose file, document `DATABASE_URL=postgresql://homeflow_app:…@localhost:5434/homeflow` for dev, keep PGlite for unit tests. Closes G7 for anything RLS-related. Host port 5434 (5432 and 5433 are taken on this laptop). |
| P3 | **Google OIDC server-side + customer OTP as sign-in methods** | `services/api/kernel/identity/{google,oauth_state,otp,session}.py`, `tests/security/test_google_flow.py`, `test_otp_flow.py`, `docs/spec/technical/03-identity-and-access.md` | TypeScript in his `src/auth/`: `openid-client` (one dependency, needs Amarsh's approval per his rule) for the code + PKCE flow, verify `id_token`, enforce `hd` from the claim, admit only provisioned users; OTP table + rate limits; both hang off his existing `session` table and cookie. Keep his email/password as a method until Pranava's OAuth client exists. Closes G4. |
| P4 | **Lock down the database and move off bash** | `infra/lib/data-stack.ts`, `service-stack.ts`, `infra/test/stacks.test.ts`, `infra/README.md` | Either add an App Runner VPC connector and make RDS private (smallest change to his scripts), or adopt the CDK stacks (Fargate + ALB, public tasks so no NAT, RDS isolated). Do this when moving to Pranava's account; do not touch his live personal-account deployment before the demo dependencies are known. Closes G3 and G9. |
| P5 | **Actor on every event** | `kernel/identity/principal.py::as_actor()`, how `append()` takes `actor` from `tx.principal` | his `appendEvent()` should take the actor from `ctx.actor` by default (his R0.6c). Small. |
| P6 | **Stack-neutral spec content** | `docs/spec/00-REVIEW.md`, `docs/spec/technical/02-database.md` §3 (RLS pattern), `03` (identity), `07` §2 (error codes), `12` (NFR targets and test pyramid), `docs/spec/foundation/architecture.md` §10–11 (rejected options and revisit triggers) | fold into his `docs/specs/` where they add something (a `docs/specs/33-security-rls.md` and NFR targets in `00-conventions.md`), keep the rest under `docs/spec/` as reference. Do not overwrite his files. |

**Not ported (kept on the branch as reference only):** the Python backend and its kernel beyond the pieces above, Alembic, `apps/workspace` (v1's screens on Vite; they call Mongo), `apps/legacy-ts`, `services/legacy-ts`, Vivek's `packages/ui`, `.github/workflows/*` from Vivek's side, `scripts/ci-local.sh`, the `docs/TASKS.md` written for the Python plan.

**v1 (`Pranava-V2/HomeFlow`):** reference for business rules and screen inventory only, as Amarsh already treats it. The Mongo → Postgres mapping in `docs/spec/foundation/v1-reuse.md` §2 matters only if Pranava's real data lives in v1's Mongo; as far as anyone has found, v1 holds seed data only. Confirm with Rambabu before assuming.

---

## 7. Things to fix on his base that came from this review (not ports)

| # | Fix | Where |
|---|---|---|
| F1 | Rotate the AWS access key, the OpenAI key and the Gmail app password that his TODO says were shared in chat | AWS IAM user `Amarsh_claude`; `services/api/.env.local` |
| F2 | Make `npm ci` at the root install `services/api` (add it to root workspaces or its lockfile) | root `package.json`, `package-lock.json` |
| F3 | Chromium for the spec test in CI and on laptops (`npx playwright install chromium`) | CI workflow, README |
| F4 | Document that R1/R2 are not deployed to the live URL yet and that smoke against the URL is outstanding | his `TODO.md` R1 row already says so; keep it true |

---

## 8. Consolidation procedure for the next session

1. Section 5b, verbatim: secure Amarsh's uncommitted work, then branch `consolidate`, install, run his tests, record the numbers. Confirm `origin/vivek/v1-on-postgres` exists (5a).
2. Read, in this order: his `CLAUDE.md`, `TODO.md` (§0, §3, §7, §9, §10), `docs/specs/00-conventions.md`, `docs/specs/SCHEMA.md`, `docs/specs/01-identity-access.md`, `02-event-log.md`, `03-platform-deploy.md`; then `docs/spec/technical/02-database.md` §3 and `03-identity-and-access.md` from Vivek's branch (use `git show origin/vivek/v1-on-postgres:docs/spec/technical/02-database.md`).
3. Port P2 then P1 (P1 needs a real Postgres to test), then P5, then P3, following his definition of done (failing test first, ≤ 200-line files, tokens, journey/E2E where a screen is touched, `TODO.md` §0 and `docs/demo/run-log.md` updated). One PR each. Do not restyle screens. Do not add dependencies beyond `openid-client` without a one-line ask.
4. P4 and P6 are planned, not done, until the account and demo questions in section 10 are answered.
5. After P1–P3 and P5 are merged and his suite plus the new RLS sweep are green on the compose Postgres, **write the task file** (section 9).

Environment facts below describe **Vivek's laptop**, where every measurement in this file was taken; check each one on Amarsh's machine before relying on it: Windows 11, Git Bash + PowerShell; Docker running; Node 24, npm 11, Python 3.12, uv; `make` not installed; ports 5432 and 5433 taken by other containers, so compose Postgres was mapped to 5434; Chromium not installed for Playwright's PDF test. On Amarsh's machine the AWS profile `pranava` for account `975050032697` exists; do not deploy during consolidation, and do not touch the live App Runner service until the ports are merged and the account question in section 10 is answered.

---

## 9. The task file to produce after consolidation

Write `docs/TASKS.md` on the `consolidate` branch (replace whatever `TASKS.md` exists there; Vivek's Python-plan version stays on `vivek/v1-on-postgres`). Requirements:

- **Base:** Amarsh's `TODO.md` §0 waves R2–R7 and the 27 unmerged specs in `docs/specs/07–31`, each mapped to its spec page references as his spec files already do. The spec's final state is the target; his spec file is the contract per feature.
- **Order:** dependency first (his §4 "Needs" lines), then his recorded priority: cash/collections → Control Tower → customer portal → My Day → customisation and twin → handover/QA → documents.
- **First block, before any feature:** the hybrid ports P1–P6 and fixes F1–F4 from this brief, each with its source path on `vivek/v1-on-postgres`, so the security foundation lands before more business logic accretes on an unscoped database.
- **Per task:** what exists on `main` today (from his §4 and status board), what to build, the spec file and spec refs, acceptance test names per his convention (`pNN-§X-tN`), dependencies, and a suggested owner. Ownership between Vivek and Amarsh is a human decision (section 10); the file should propose a split by area (platform and front half of the lifecycle vs kernel and back half, as in the earlier plan) and say plainly that it is a proposal.
- **Style:** plain task names, no letter codes, one task = one PR, the definition of done is his `00-conventions.md` list. Mark the tasks that are Studio/UI follow-ups he deferred (05 and 06 UIs) so they are not forgotten.
- **Do not** carry over tasks from Vivek's `docs/TASKS.md` that only make sense for the Python plan (migration cutover, Alembic, WeasyPrint, Fargate CI). Carry the behaviours marked ⟲ there only if his branch does not already have them (check: receipt validation, check-in range, honest commitments gate, null due dates, idempotent Act and human labels were all merged as his PRs #2–#9).

---

## 10. Decisions only humans can make

1. **Ownership.** His TODO records Vivek out of the plan. Vivek, Amarsh and Rambabu decide who owns what; the task file proposes a split but does not decide.
2. **Account and data.** When to move from Amarsh's personal AWS account to Pranava's; no real customer data before that. P4 waits on this.
3. **Google OAuth client** from Pranava's Workspace, needed for P3 to be exercised end to end (the flow can be built and tested with a stub before that).
4. **Design.** Vivek's `design-language.md` banner and Amarsh's locked brand (Pranava orange/ink, Jost + Geist) differ; his is built and merged. Treat his as the decision unless Rambabu says otherwise.
5. **Whether v1's Mongo holds any real data** worth migrating. Nobody has confirmed either way.

---

## 11. Files this review produced or touched (on Vivek's laptop, now on `vivek/v1-on-postgres`)

- This file, `docs/reports/2026-09-05-branch-review.md`.
- `docs/reports/2026-09-05-items-1-3.md`, `-4-6.md`, `-7-9.md`: the three build reports for the Python line, with verbatim command output. Historical after consolidation, but they are where the source paths in section 6 are explained.
- `package.json`: one added script `build:static` (builds both SPAs into `services/api/static` so the compose API serves them). Only relevant to the Python line.
- A scratch worktree of `origin/main` existed on Vivek's laptop only (path in §2.1); nothing on Amarsh's machine.
- The file `22060708_BMR_p5-18_epdf.pdf` at Vivek's repo root is unrelated to HomeFlow and was **not** committed.
