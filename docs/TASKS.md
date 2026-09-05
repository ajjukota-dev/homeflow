# HomeFlow — task split (aligned to the technical spec, 5 Sep 2026)

Every task below maps to a file in [`docs/spec/technical/`](spec/technical/README.md) (the number in brackets). Read that file before starting the task; it has the DDL, flows and signatures, so the task text here stays short.

Vivek owns the platform and the front half of the lifecycle (Site → Sales → CRM → customer portal). Amarsh owns the Action/journey kernel and the back half (Accounts → Legal → QA → After keys → Management). Shared tasks are done together or in agreed halves.

One task = one branch = one PR with tests at the level [12] names and Playwright screenshots for any screen. A PR that adds a table, a policy or a dependency says so in its title ("Ask first" in CLAUDE.md).

**The fixes previously listed against the TypeScript repo are withdrawn.** That code is replaced by v1 on Postgres; each of those behaviours is now an acceptance item inside the slice that owns it (marked ⟲ below) so nothing is lost and nothing is built twice.

---

## Order of work

```
Week 1–2   Shared 1–3  →  Vivek 1–4 (v1 in, make dev, kernel base, first migrations)
Week 2–4   Vivek 5–8 (identity, events+jobs, files, frontend base)     ‖  Amarsh 1–4 (engines, action kernel, journey, documents)
Week 4–5   Shared 4–6 (migration rehearsal, CI guards, demo seed)      ‖  Amarsh 5–6 (notifications, migrations for his tables)
Week 5+    Slices — each owner's list, in order; Shared 7 (Policy Studio) grows as slices need config
```

Nothing after Vivek 4 can be tested without it; nothing in Phase "slices" starts before Shared 4 (rehearsed migration) because every slice is built against migrated data, not the seed.

---

## Shared

1. **Decisions to close with Rambabu before any code.** Freeze v1 at `7854b05` and stop the Emergent agent; the design decision (`00-REVIEW.md` → Design); confirm `ap-south-1` and the two hostnames; pick the messaging provider (MSG91 or Gupshup) so the adapter has a target. Owner: Vivek asks; both record the answers in `00-REVIEW.md`.

2. **Module contract and CI guards** [01 §2, §7]. Agree the five-file module shape and write the guards that enforce it: import-linter contracts (`domain` imports nothing from the stack; modules import each other only via `handshakes.py`), the "reads never write" marker test, the write-fence test (sales/crm get 403 on progress, gate rules, QA, overrides), the "every route has `require()`" test. Vivek writes the linter config; Amarsh writes the pytest guards. Lands before the first module is migrated so v1's routers are reshaped against it, not before it.

3. **Event catalogue and consumers map** [04 §1–2]. One file each, both reviewed by both: Amarsh owns `catalogue.py` (every type in `event-log.md` §3 with `reason_required`, subject keys, payload model) and the test that every `append(` call site uses it; Vivek owns `consumers.py` (event → jobs) and the ticker. Adding an event or a consumer later is a one-line PR to the owner's file.

4. **Migration rehearsal** [11]. Vivek runs export → load → files → verify against a local Postgres; Amarsh writes the transforms for payments, TDS, loans, clearance, legal, registration, snags, handover, commitments, escalations; Vivek writes users, roles, teams, projects, hierarchy, units, customers, bookings, applicants, CRs, comms, workflow. `verify.py` green on the full dump twice before any slice begins. Second rehearsal on staging when it exists.

5. **Demo seed** [02 §7]. East Crest through the real handshake functions: ~40 units at varied progress, ~25 bookings across all 11 stages, demands/receipts/loans, documents at each status, snags, one handover completed, one warranty case, one L3 escalation. Vivek seeds up to CRM acceptance; Amarsh seeds money, legal, QA, after keys, management. This is what every Playwright run screenshots.

6. **Acceptance traceability** [12 §2]. Amarsh writes `scripts/traceability.py` and the id scheme; both tag tests as they build. CI fails on an untested id only for slices marked done in this file.

7. **Policy Studio (`modules/admin`)** [07 admin, 02 §6]. Vivek builds the admin module shell, users/roles/teams/project-team-assignment (effective-dated), project master and hierarchy, change categories, gate rules, component definitions, customer stage map, schedules. Amarsh adds SLA policies, working calendars, journey template versions (approve/activate), message templates, auto-publish rules, payment plans, document templates. Each config table arrives with the slice that needs it, not all at once.

**Shared-file rule.** `app.py`, `settings.py`, `migrations/versions/*`, `kernel/events/catalogue.py`, `kernel/events/consumers.py`, `packages/ui/src/tokens.css`, `packages/ui/src/api/types.ts` (generated), `docker-compose.yml`, `.github/workflows/*`. Whoever opens a PR on one of these first that day owns it; the other rebases. Migration files never get renumbered; a conflict means one of you writes the next number.

---

## Vivek

### Platform

1. **Bring v1 in, frozen** [01 §1, §6]. Tag `7854b05`. `backend/` → `services/api` reshaped into `kernel/`, `modules/`, `domain/` folders (routers moved, not rewritten yet); `frontend/` → `apps/workspace`. Remove the dependencies in [01 §6]. Delete `mobile/`, the preview-URL tests, `_phase*_verify.py`. It must still start against a throwaway Mongo once, so the reshaping is proven before storage changes.

2. **`make dev`** [10 §2–3]. Compose with `postgres:16` (init script creates `homeflow_owner` and `homeflow_app`), MinIO + bucket sidecar, Mailpit, the API image with source mounted. `.env.example` from [01 §5]. `make dev | down | reset | test | lint | e2e`. A fresh clone reaches a green `/health` with no AWS account.

3. **Kernel base** [01 §3–5, 07 §1–2]. `settings.py`; `kernel/db.py` with `tx()` setting the five GUCs; `kernel/errors.py` with the one handler and the code table; `RequestIdMiddleware`; the `{data, meta, errors}` envelope; cursor pagination helper; `Idempotency-Key` table and dependency; `/health`. ⟲ the Control Tower crash and the six routes that lie with 200-empty are fixed here, once, for every route.

4. **Migrations 0001–0003 and the RLS helper** [02 §1–4, §7]. `uuid_generate_v7()`, roles and grants, `set_updated_at`, `enforce_project_id`, the `rls(table, customer_via)` helper; identity, event, job, schedule, file_object, session, otp_challenge; project, hierarchy, unit, customer, booking, applicant, team tables; twins (progress, gates, spec items, as-built, QA evidence, snag, passport). The `tests/rls/` sweep that connects as `homeflow_app` and proves zero cross-project rows on every partitioned table. ⟲ unique project code, unique unit number per project, component FK → 400 on unknown.

5. **Identity and sessions** [03]. Google OIDC start/callback, provisioning-only users, `session` cookie rules, CSRF middleware, `Principal`, `permission` seeded from v1's `rbac_matrix.py`, `require()`, `require_role_in()`, redaction from v1's `rbac_redact.py` driven by `permission.modifiers`, customer OTP request/verify with rate limits, `HOMEFLOW_DEV_LOGIN`, the security test list in [03 §10]. Delete v1's Emergent route, JWT, bcrypt, `auth_scope.py` once RLS holds. ⟲ "who am I" on the customer portal comes from the session, never `?booking_id=`.

6. **Events and jobs** [04]. `events.append` with catalogue check and same-transaction fan-out; `jobs.enqueue` with dedupe; the ticker under `pg_try_advisory_lock`; retry/backoff/dead; `job.reap`, `job.prune`; schedule expansion; the system principal; `GET /events` and the correlation trace. Replace every `write_audit()` in v1 with a catalogued event (Amarsh's catalogue). The six guarantees in [04 §7] as tests.

7. **Files** [08 §1]. `file_object`, presign → PUT → confirm, presigned GET with visibility check, content-type and size limits, sha256 job, orphan prune, MinIO host rewrite locally. Replace v1's GridFS streaming and multipart routes. Drawings, evidence, photos, documents all use this.

8. **Frontend base** [09]. Workspace CRA → Vite, JS → TS with `allowJs` then file by file; `packages/ui` with `tokens.css`, `api/client.ts` (envelope, errors, 401 → sign-in gate, `X-Requested-With`), `useSession`, `useQuery` hook, `<Async>` with the four states, `StatusChip`/`GateChip`, `Money`, `DateText`, upload helper; `openapi-typescript` generation; sign-in screens for both realms; both apps served by the container by `Host`. ⟲ 320 px overflow, mobile header collision, hex gradient → tokens, `SiteProgress.tsx` split, `npm test` from root, ESLint installed.

9. **CDK** [10 §4]. Delete the platform stack and the Lambda/HTTP API. `DataStack` (VPC no NAT, RDS 16 `t4g.micro`, files bucket, logs bucket, three secrets, the `homeflow_app` custom resource) and `ServiceStack` (`ApplicationLoadBalancedFargateService`, public tasks, ACM + two records, task role, alarms). `npm run synth` in CI. **No `cdk deploy` until Shared 1 is closed and Pranava approves the budget.**

10. **CI/CD** [10 §5]. `ci.yml` (Python lint/types/tests with service containers, TS lint/types/tests/build, image build + schemathesis + Playwright, synth, OpenAPI diff comment) and `release.yml` (ECR push, `cdk deploy ServiceStack`, smoke). Screenshot artifacts uploaded.

11. **Engines: gates and matching** [06 §1, §9–10]. `domain/gates.py` (derive, transitions, score, holds, freshness), `completeness.py`, `matching.py` with pitch angle. Every Vitest case from `gates.ts` ported before the TS file is deleted. Hypothesis properties.

### Slices (front half)

12. **project_site** [07 project_site; roles/project-site]. Progress write with evidence, unit exception, bulk preview/commit with per-unit exception, `gate.reevaluate` and `gate.notify_affected` jobs writing `unit_change_gate` (the only writer), `freshness.scan`, `hold.expire`, CR feasibility and release (`as_built_revision`, superseded locked), hold decisions. Unit 360 page: identity, spec, progress, changeability with decomposition, as-built, events. ⟲ progress regression needs a reason and never reopens a hard gate; "why now" derives from real component state.

13. **sales** [07 sales; roles/sales]. Inventory with gate filters and freshness, changeability detail, compare, opportunities and needs, match, holds request, CR create (H5, never blocked by gate), booking draft + applicants, completeness, H2 submit with `GATE_FAILED` blockers. ⟲ human labels for every enum on screen.

14. **crm_rm** [07 crm_rm; roles/crm-rm]. H2 accept/return (return-reason taxonomy, first-time-right analytics), Customer Twin instantiate, onboarding Actions (uses Amarsh's Action kernel), customer search and 360 (twelve tabs from v1 on the new data), merge, commitments with `commitment.prebreach` job, communications with visibility divider, PTP signal only, CR quote/acceptance (H6 receive), `customer_update` approval queue with auto-publish rules, `customer.merged` audit. ⟲ only a `submitted` booking can be returned; project-scoped lists driven by the selector.

15. **customer_portal** [07 customer_portal; 08 §4–5; roles/customer]. `/me/*` on the customer realm, the six projection builders with the hidden-key hypothesis test, `customer_update.draft/publish` jobs, document download via presigned URL, raise CR and service request, appointment confirm, preferences. My Pranava Home screens for T1–T6 in the customer skin. ⟲ dark mode, tab bar, registration/handover screens.

16. **Migration cutover** [11 §3]. After Shared 4 passes twice and slices 12–15 plus Amarsh 7–11 are on main: freeze v1, dump, run, verify, smoke by role, switch DNS, keep v1 readable 30 days, delete `services/api/migration/`.

---

## Amarsh

### Kernel and engines

1. **Engines: money, readiness, handover, tower, legal** [06 §2–7]. `collections.py` (buckets, probability, why-now, forecast lines, cash-flow math), `clearance.py`, `readiness.py`, `handover.py` (evaluate, override with safety refusal), `tower.py` (pick five, decision pack), `legal.py` (readiness check with source refs, snapshot, render context, validate, compare). Every Vitest case ported; hypothesis properties (more receipts never lower clearance; a critical snag never raises readiness).

2. **Action kernel** [05 §1–4, 02 §4.5]. `action`, `sla_policy`, `escalation` tables (migration 0004 with journey tables); `create`, `transition` table with the evidence gate, `reassign`, pause/resume with calendar shift; `domain/ranking.py` and the cached `rank_score`/`why_now`; `sla.tick` ladder L1–L4 with escalation creation and decision packs; `kernel/calendar.py`; `/me/day`, `/actions/*`, `/escalations/*`, daily closure. Foundation acceptance #3, §11, §34, H11 as tests.

3. **Journey engine** [05 §5]. Port v1 `workflow_engine.py` onto the relational tables: template versions with approve/activate and migration rule, `start` creating stages, tasks and Actions with baselines from timeline policy, dependency-driven (parallel) stage start, `recompute` with forecast roll-forward and confidence, `revise_plan`/`reset_baseline` writing `timeline_revision`, `reopen` with reason, `journey.recompute_all`. Pranava Standard Journey v1 as config seed; v1's 8-stage templates mapped per `v1-reuse.md` §3. Booking journey endpoint.

4. **Document Factory** [08 §2]. Templates and versions in the DB seeded from v1's `doc_templates/`, clause library, `doc.generate` job with snapshot → sandboxed Jinja → WeasyPrint → `file_object` → checksum, DRAFT watermark rule, validation failures with `source_ref`, stage decisions with separation of duties, deviations, `document_version` on regenerate, `execution_record` append-only, compare. ⟲ SRO reference comes from the execution record, never the UI.

5. **Notifications** [08 §3–4]. `outbox`, `message_template`, `notification` (in-app), `notify.send` job with consent, quiet hours and frequency guardrails, `SesEmail`, `Messaging` (provider from Shared 1, WhatsApp with SMS fallback), `Console`, inbound webhook → `communication` + event, `digest.daily`, ladder notifications per tier. OTP delivery for Vivek 5 rides on this (console until the provider exists).

6. **Migrations 0005–0009** [02 §4.6–4.7, §6]. Money (payment plan, milestone, demand, receipt, loan case, PTP, TDS, clearance, forecast snapshot, forecast line, waiver), legal, QA/handover/post-handover, CRM twin tables (with Vivek), management and config. Each with the `rls()` helper and ownership per [02 §6].

### Slices (back half)

7. **accounts** [07 accounts; roles/accounts]. H3 receive (demand schedule materialised, milestone labels), receipts with TDS, reconcile/reverse with reason, overdue reason, waiver with authority, `collections.recompute` job, true-risk view and heatmap, loans and readiness gaps, forecast snapshot lock (`forecast.snapshot` schedule), forecast lines with override, scenarios, cash-flow per period, financial clearance (H7) evaluated on every money event. ⟲ receipt amount finite, > 0, ≤ remaining; demand `due_date` null until its trigger fires; customer-safe "why now" from the real milestone.

8. **legal** [07 legal; roles/legal]. Generate, validation view with source links, deviation/approve/reject, compare, share (→ `document_ready` update), execute, template admin, registration case with slot booking and H8 completion (`Unit.sale_status → registered`). Preview screen.

9. **qa** [07 qa; roles/qa]. Component verification with evidence (independent flag), exceptions, snags with before/after `file_object`s and repeat-defect flag, snag analytics, readiness from verified evidence, `handover.reevaluate` job, H9 declare-eligible, gate override endpoint with named authority and safety refusal (written to events), appointment, complete with checklist → H12. ⟲ commitments gate evaluated honestly from the Promise Ledger, never auto-pass; "site declares complete" separate from "QA verified".

10. **post_handover** [07 post_handover; roles/post-handover]. `post_handover.open` job (DLP window, passport finalise, 7/30/90 Actions via `checkin.due`), warranty cases with coverage and a real out-of-coverage quote flow, service history append-only on the Unit, check-in capture → `ExperienceSignal`, referral. ⟲ satisfaction score 1–5; unknown check-in → 404.

11. **management** [07 management; roles/management]. `tower.refresh` job building `intervention` rows from open escalations (GET never writes), five ranked interventions with decision packs, act/assign/escalate idempotent with actor and an owner Action, portfolio roll-up, `kpi_snapshot` builder from events, KPI explorer with drivers, overrides endpoint with authority and safety refusal, cash-flow views from accounts. ⟲ no hard-coded owner names; act records who and when.

12. **Contract and perf gates** [07 §4, 12 §4]. Schemathesis job for both realms with the hidden-key assertion, committed `openapi.json` with PR diff, the k6 script and the first run against `make dev` with the demo seed; numbers recorded in [12 §4].

---

## Done means

The seven checks in [12 §5]. Mark a task done here in the same PR that finishes it, with the acceptance ids it covers.
