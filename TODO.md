# HomeFlow — task split

Vivek owns the platform, the front half of the lifecycle (Site → Sales → CRM → customer portal) **and the AWS deploy** (one owner, task 23).
Amarsh owns the back half (Accounts → Legal → QA → After keys → Management) and the quality gates (typecheck, lint, CI).
Work top to bottom within your list. Phase 1 is small fixes; Phase 2 is the big foundation pieces; Phase 3 is building out each role screen to the spec.

One task = one branch = one PR, with tests and Playwright screenshots. If a task adds a DB table or a new dependency, say so in the PR title.

Renumbered 2026-09-05 after the spec audit (nothing had started — 0 PRs, 0 of 41 done). **NEW** = a spec MUST that was in neither the code nor this list. **MOVED** = re-sequenced to match the spec's own P0 order (HOMEFLOW-OS.md §24).

---

## Vivek

### Phase 1 — fixes

1. **Stop the API crashing on bad ids.** Add an Express error middleware and wrap every GET route in try/catch so an unknown project or unit returns `404 {errors:[{code:"not_found"}]}` instead of killing the process. Same middleware handles malformed JSON bodies (today it returns an HTML stack trace with file paths) and turns raw Postgres errors into structured `{code, message}` errors.
2. **Block "return" on an active booking.** Only a `submitted` booking can be returned to Sales. Today an active booking can be returned, which flips the villa back to available while the customer, demands, receipts and agreement still hang off it.
3. **Guard progress regression.** Moving a component backwards (e.g. structure from verified to not started) must require a reason and record who did it, the old value and the new value. A structural gate that is Hard Closed must never reopen through this path.
4. **Fix "who am I" on the customer portal.** The portal currently shows whoever booked most recently (after the e2e suite runs, Karthik becomes Anita). Also remove the `?booking_id=` query parameter — anyone can read any customer's home with it. Resolve "me" from a stub user header until real login lands.
5. **Make `npm test` pass from the root.** Vitest in the workspace app is picking up the Playwright spec and failing (it fails, it does not hang — fix the HANDOFF note). Exclude `e2e/**`. Add root scripts for `lint`, `dev:customer` and the customer app's e2e.
6. **Validate unit and project creation.** Unknown component code on a progress update returns 400 instead of a silent 200. Creating a unit without type or facing returns a clean validation error instead of `Cannot read properties of undefined`. Add unique constraints on project code and on unit number within a project.
7. **Layout and token fixes.** Customer portal overflows horizontally at 320px (the RERA number doesn't wrap). Workspace mobile header at 375px: the "HomeFlow" wordmark collides with the nav chips. Customer hero uses a hard-coded hex gradient (`Home.tsx` `#e7ddd0`, `#cdd6cb`) — replace with theme tokens. Customer app has no dark mode path — wire `data-theme` / `prefers-color-scheme` like the workspace.
8. **Project-scope the CRM screen.** The acceptance queue and customer list show every project's bookings regardless of the project selector. Add `project_id` filters to the bookings and customers endpoints and pass the selected project down.
9. **Split oversized files you own.** `SiteProgress.tsx` (214) and `schema.ts` (206) are over the 200-line rule.

### Phase 2 — foundation

10. **Durable Postgres.** Run a real Postgres in Docker for local dev, keep PGlite only for tests. The `db` port takes a connection string from env — this is also what lets the same handlers hit Aurora in task 23. Split the single schema string into versioned migration files. Add `docker-compose.yml`, a `Makefile` with `make dev`, and `.env.example`.
11. **Login with Google via Cognito — and role-gated mutations.** CDK: add Google as a federated identity provider on the user pool. Local: run `cognito-local` so nobody needs an AWS account to develop. API: JWT middleware that rejects unauthenticated calls and exposes `user_id`, `role_ids`, `authorized_project_ids`. Both apps: Sign in with Google, logout. Staff self-signup stays off; customers get an invite path tied to their booking.
    **NEW clause (project-site #7, sales #4, §26 "Sales and CRM can view but cannot edit"):** every mutating route declares which roles may call it, and the middleware returns `403 {code:"forbidden"}` otherwise. Minimum: `PUT /units/:id/progress` and anything that changes a gate → project-site roles only; receipts → Accounts; document approve/execute → Legal; snag close → QA. One test per route proving Sales gets 403.
12. **Row-level security by project.** Set a Postgres session variable from the JWT and add RLS policies so a user only ever sees rows in their authorized projects. Depends on tasks 10 and 11.
13. **Separate config seed from demo seed.** Component definitions, gate rules, payment plans, policies are config and always load. Karthik / Meera / Ananya / Rohan only load when `HOMEFLOW_DEMO=1`.
14. **MOVED — Journey and SLA engine + Policy Studio** (was 20, Phase 3). Journey templates with stages, tasks, durations, dependencies and gates; a journey instance per booking with baseline, current plan, forecast and actual dates; SLA clocks with start, pause, warn, breach. Policy Studio screens so gate rules, payment plans, handover policy and templates are editable data, not seed SQL. Why moved: the spec puts this in weeks 1–2 of P0; Promise Ledger due dates (19), pre-breach alerts (Amarsh 21), My Day ranking (Amarsh 11) and the materiality threshold (Amarsh 20) all read from it. Start right after 13; it can run alongside 11–12.
15. **Shared packages.** Create `packages/ui` (tokens, `cn`, `formatINR`, Button, Card, chips) and `packages/core` (shared types) and point both apps at them. Do this last in the phase so it doesn't churn under the others.

### Phase 3 — role slices

16. **Site: bulk progress updates.** Select many units, choose a component and state, preview which units and gates will change, then commit. Allow a per-unit exception with a reason. Every correction records actor, timestamp, prior value, new value, reason.
17. **NEW — Site: drawing / spec revision control** (project-site #9, §26). Each unit-level drawing or specification carries a version. Releasing a new revision supersedes the previous one, which becomes read-only but stays viewable with its release date and approver. Progress updates and change requests reference the released revision id, never "latest". Editing a superseded revision is rejected with the id of the current one.
18. **Sales: filters, compare, matching.** Inventory filters (Highly Customisable, Kitchen Open, Electrical Open, Flooring Open, Ready to Move). Pick three or more units and compare gates side by side. Personalisation discovery: capture a prospect's Must-Have / Preferred needs and rank available units with a plain-language explanation. Show an expected closing date on Closing gates.
19. **NEW — Sales: pitch angles from live gates** (sales #8). Each unit's sales card shows pitch angles derived from its current gate state ("kitchen still open — layout can change", "ready to move") and nothing else. An angle disappears the moment its gate closes; Sales cannot type a free-text angle. Depends on 18.
20. **CRM: Customer 360 and the Promise Ledger.** Tabs on Customer 360 (Journey, Payments, Documents, Commitments, Communications, Experience). Structured return-reason taxonomy that reopens a Sales action. On accept, create onboarding actions and start the journey. Build the Promise Ledger: commitments with owner, due date, status, evidence, and a pre-breach alert before the due date. Build the customer-update approval queue: staff preview exactly what the customer will see, then approve or suppress.
21. **NEW — CRM: customer merge** (crm-rm #6). Two customer records for the same person merge into one Customer Twin: bookings, communications, commitments, documents and check-ins move to the survivor; the merged-away id stays resolvable (redirects, never 404); nothing is deleted; the merge is an event with actor and reason. Depends on 20 and Amarsh's 10 (event log).
22. **Change Requests.** Customer or prospect raises a change (kitchen, electrical, flooring). It routes by the live gate: normal, conditional, exception, or reject with reason — capture is never blocked. Feasibility → costing → internal approval → customer quote → customer acceptance → payment gate → release to site → QA → as-built closure. Add Change Window Hold for Sales with auto-expiry and Project approval.
23. **Customer portal screens.** Bottom tab bar with Journey, My Home, Payments, Documents, Requests. Add Registration and Handover screens. Customer can raise a change request and a service request. Progress stage should advance only when the mapped component is verified, not merely complete.
24. **AWS deploy — one owner, one sitting** (was 21 "deploy path"). Do **not** start the deploy-day part until 10, 11, 12 and Amarsh's 10 are merged: today `db.ts` is in-memory PGlite and there is no auth, so an earlier deploy ships an API with no database and no login, and starts the Aurora bill for nothing.

    **Ask Pranava now (blocking):** which AWS account to deploy into, region (ap-south-1 unless told otherwise) and budget approval (HANDOFF §4.2); a Google OAuth client id + secret for the Cognito IdP; whether to use CloudFront URLs or a Pranava domain.

    **Build (CDK, PR-reviewed, `npm run synth` green — this is the real work):**
    a. Bundle `services/api` into the Lambda with `NodejsFunction` (esbuild); delete the `infra/lambda/index.mjs` shell. Handler reads `DATABASE_URL` from Secrets Manager and talks to Aurora through the same `db` port as local.
    b. Cognito authorizer on every route except `/api/health`; Google IdP on the user pool; secrets in Secrets Manager, never in git.
    c. Both SPAs on S3 + CloudFront (origin access control); `VITE_API_URL` injected at build time.
    d. CORS = the two CloudFront origins only. `RemovalPolicy.RETAIN` + deletion protection on Aurora and buckets; remove `autoDeleteObjects`.
    e. Migrations + config seed run as a one-off step against Aurora (custom resource or a `migrate` Lambda — pick one, write it in `infra/README.md`).

    **Deploy day (the one-shot, from the CLI with Claude, ~1 hour):**
    1. AWS CLI profile for the Pranava account; `aws sts get-caller-identity` must show **their** account id before anything else runs.
    2. `cdk bootstrap aws://<account>/ap-south-1`
    3. `cdk deploy HomeFlowPlatform` then `cdk deploy HomeFlowApp` with `--require-approval broadening`.
    4. Run migrations + config seed. `HOMEFLOW_DEMO` unset — no Karthik / Meera / Ananya / Rohan in prod.
    5. Smoke: `/api/health` → 200; unauthenticated `/api/projects` → 401; Google sign-in as a staff account → workspace loads with East Crest config and zero bookings; customer invite → My Pranava Home for one real booking.
    6. Build both SPAs against the deployed API URL, `aws s3 sync`, CloudFront invalidation.
    7. Record account, region, stack names, URLs and expected monthly cost in `infra/README.md`. Create a billing alarm.

    Idle running cost: see the note at the bottom of this file.

---

## Amarsh

### Phase 1 — fixes

1. **NEW — Typecheck gate. Do this first.** The API has no typecheck script; `tsx` runs it untyped and `tsc --noEmit` reports 113 errors (7 in `src`: `demands.ts` 2, `legal-docs.ts` 4, `qa.ts` 1; 106 in `*.test.ts`). Add `typecheck` (`tsc --noEmit`) to `services/api`, both apps, and a root `npm run typecheck`. Fix the 7 src errors and the 106 test errors — do not exclude tests from the check. Everything after this lands on a typed base.
    Triage (2026-09-05): one root cause. `db.query(...)` is called without a row generic in `bookings.ts`, `customer.ts`, `demands.ts`, `legal-docs.ts`, `qa.ts` and the lifecycle modules, so helper return types collapse to `{}` / `{} | null` / `unknown[]`; every test that reads `.status` or `.id` off those then fails. Adding `db.query<RowType>(...)` at each untyped call site clears all 7 src errors and ~100 of the 106 test errors. All 7 src errors are typing gaps, not logic bugs. Enumerate the call sites with a grep first, fix all, re-grep.
2. **Validate receipt amounts.** Posting `{"amount":"abc"}` is accepted today — `Number("abc")` is `NaN`, which passes both the `<= 0` and `> remaining` checks — and leaves the demand with a null balance and status `part_paid`. Require a finite number, greater than zero, not more than the remaining balance. Add a test.
3. **Validate check-ins.** Satisfaction score must be 1–5 (today 99 is accepted). Capturing a check-in that doesn't exist must return 404, not `200 {}`.
4. **Make "why now" tell the truth.** The customer portal says "Your flooring is complete — this milestone is now due" for a villa whose flooring hasn't started. Derive the sentence from the unit's actual component progress, not from the demand status. Fix the V110 seed so demands are consistent with progress.
    **Decided 2026-09-05 (Amarsh):** short and factual wording. Stage verified → "Structure verified — payment due." · Booking-time payment → "Booking payment — due." · Not yet reached → "Upcoming — after flooring is verified." (stage noun substituted per milestone). Depends on 5 (null due dates).
5. **Stop stamping today's date on future demands.** When a booking is accepted, every scheduled milestone demand gets `due_date = today`. Leave it null (or a planned date) and only set it when the construction trigger fires. Check the customer portal shows "Upcoming" without a date.
    **Decided 2026-09-05 (Amarsh):** null, no estimated date. `demand.due_date` becomes nullable (schema change approved). Planned dates arrive with Vivek's 14 later.
6. **Stop the commitments gate auto-passing.** The handover "commitments" gate always passes because nothing supplies the value. Until the Promise Ledger exists, evaluate it honestly and show the blocker.
7. **Make "Act" on an intervention do something.** Today it flips a status flag. Make it idempotent, record who acted and when, and create a stub action row for the owner.
8. **Human labels instead of raw enums.** Sales shows `Handed_over`, QA shows `financial · open`, Legal shows `readiness in progress`. Add label maps for sale status, gate types and registration status.
9. **Split oversized files you own.** `demands.ts` (237), `legal-docs.ts` (213), `qa.ts` (211) are over the 200-line rule.

### Phase 2 — foundation

10. **Event log.** Add an append-only `event` table with the envelope from the spec (type, actor, project, entity, payload, correlation id, timestamp). Inject an `events` port into handlers and emit an event from every existing mutation: booking submitted/accepted/returned, receipt posted, PTP recorded, progress updated, gate changed, document generated/approved/executed, registration completed, snag closed, handover completed, warranty opened/closed, check-in captured. No update or delete on this table, ever.
11. **Universal Action and My Day.** Add an `action` table (type, owner, related booking/unit/project, priority, SLA due, state, evidence requirement). Every handshake creates a receiving action: CRM accept → onboarding actions; demand becomes due → collections action; handover blocked → QA action; intervention → owner action. Build `GET /me/day` returning ranked actions with a plain-language "why now", and a My Day screen in the workspace. SLA due dates come from Vivek's 14 once it lands; until then, the action carries its own due date.
12. **Handover override.** Endpoint and UI to override a non-safety hard gate with a named authority, a reason and evidence; the override is written to the event log. Safety and statutory gates reject the override outright. Depends on task 10.
13. **Data freshness.** Compare each unit's last progress update against a policy threshold. When stale, gates return a freshness status and Sales, CRM and the customer portal show "Verification Required" instead of a confident open/closed chip.
14. **Lint and CI.** Add an ESLint config (the `lint` script exists but nothing is installed). GitHub Actions on every PR: typecheck (task 1), lint, unit tests, Playwright, CDK synth. Publish the coverage report on each PR; set the threshold from the baseline measured on 2026-09-05 (bottom of this file) and ratchet it up, never down.
    **Decide (found 2026-09-05, PR #2):** CLAUDE.md says Playwright screenshots "live in `e2e/__screenshots__/`" and the definition of done requires reviewing them, but `apps/workspace/.gitignore` excludes that folder — so no screenshot has ever been committed and reviewers can't see them in a PR. Either track the folder (and accept binary churn) or have CI upload screenshots as a PR artifact and fix the CLAUDE.md wording. Pick one here and apply it in the same PR.

### Phase 3 — role slices

15. **Accounts: forecasting and loans.** Overdue-reason picker in the collections UI (API exists, no UI). Loans screen: sanctioned, disbursed, available, next demand, days-to-demand vs days-to-disbursement gap. Collections forecast lines per expected receipt with probability and source. Immutable month-start snapshot, latest forecast, actual-to-date, variance against both. Project cash-flow planner with drill-down to booking.
16. **NEW — Accounts: scenario mode** (accounts #7). The forecast has two lanes, *committed* and *scenario*. Receipts expected from unsold units or hypothetical future sales live only in scenario; the committed forecast, the month-start snapshot and every Control Tower cash number exclude them. Switching lanes is explicit in the UI and never silent. Depends on 15.
17. **Legal: templates and clauses.** Pick the template by project, property type and transaction type (today there is one AOS template). Regenerate as v2 when source data changes, keep v1 untouched, show a diff. Clause library with Locked / Parameterised / Negotiable clauses; deviations need Legal approval and create a new version. Retired templates can't generate but old documents stay viewable. Document preview screen. Stop hard-coding the SRO reference in the UI.
18. **NEW — Legal: Sale Deed prerequisites and segregation of duties** (legal #6; HANDOFF §4.3). Sale Deed generation requires H7 financial clearance, an executed AOS and complete applicant KYC, and blocks with the named missing item. The user who generated or last edited a document cannot approve or execute it — a second Legal user must. Both rules are tested and both emit events. Depends on 17 and 10.
19. **NEW — Legal: lease document type** (legal #9). Add `LEASE` as a transaction type on the same template / version / clause machinery as AOS and Sale Deed, with its own required fields. No parallel code path. Depends on 17.
20. **QA: snags and evidence.** Create snags from the UI (severity, location, trade, description). Separate "site declares complete" from "QA verified". Real before/after evidence with file upload to S3 via signed URLs (LocalStack locally) instead of canned text. Repeat-defect flag and analytics by trade and contractor.
21. **After keys: service and warranty.** Create warranty cases from the UI. Out-of-coverage cases go through a real quote flow instead of a ₹1 placeholder. Root-cause code on closure feeds the QA repeat-defect analytics. Check-in scores feed a Customer Health signal.
    **Found 2026-09-05 (PR #4):** the workspace never asks for a score — `apps/workspace/src/api-lifecycle.ts:163` hardcodes `satisfaction_score: 5` on every capture, so every check-in on record is a 5 and the Health signal would be constant. Add a real 1–5 input to the After keys capture action. Also: the spec never defines the check-in scale or a default (`post-handover/spec.md` §2.2 names the field only); the API now enforces 1–5 as an assumption — confirm the scale with Pranava (see Open questions).
22. **Management: drill-down and KPIs.** Every intervention drills Project → Unit → Booking. Cash-flow views on the tower (current-month actual, next-month forecast, 90-day, prior actual, variance) — depends on task 15. KPI explorer with trend and drivers for each metric, no decorative badges. Remove the hard-coded "Priya Nair" owner.
23. **NEW — Management: materiality threshold** (management #6). The Control Tower surfaces an intervention only when it crosses a per-project materiality threshold (₹ amount, days overdue, or count) held as Policy Studio data, not code. Below threshold it is reachable through drill-down but never on the tower. Today `tower.ts` uses "material" as copy text only. Depends on 22 and Vivek's 14.
24. **Notifications.** Daily digest of My Day, pre-breach alerts before an SLA or commitment fails, quiet hours. In-app first; email/WhatsApp adapters behind the customer visibility filter. Depends on task 11.
25. **API contract.** Version all routes under `/api/v1`, generate OpenAPI from the routes, consistent `{data, meta, errors}` envelope, cursor pagination on list endpoints.

---

## Open questions for Pranava

Things the code cannot decide. Ask at the next client touchpoint; each has a task waiting on the answer.

| Question | Blocks |
|---|---|
| Which AWS account, region and monthly budget (≈ $107/month idle, see baselines) may we deploy into? | Vivek 24 |
| Google OAuth client id + secret for the Cognito identity provider; CloudFront URLs or a Pranava domain? | Vivek 11, 24 |
| Check-in satisfaction scale — is 1–5 right, and is there a default when the RM skips it? The spec names the field but not the scale. | Amarsh 21 |
| Should a handover be blocked or only flagged when no commitment data exists yet? | Amarsh 6 |

## Found while building

Bugs and gaps discovered during a task that belong to a different task. Each is already folded into its owning task above; this is the running log so nothing is lost between sessions.

| Date | Found in | Finding | Folded into |
|---|---|---|---|
| 2026-09-05 | PR #4 (Amarsh 3) | Workspace hardcodes `satisfaction_score: 5` on every check-in capture | Amarsh 21 |
| 2026-09-05 | PR #4 (Amarsh 3) | Spec defines no check-in scale or default; 1–5 is an assumption | Amarsh 21, Open questions |
| 2026-09-05 | PR #4 (Amarsh 3) | `routes-lifecycle.ts` `fail()` mapped every error to 400; now `not_found` → 404 for approve/execute document, close snag, close warranty, capture check-in, act intervention | Done in PR #4 |
| 2026-09-05 | PR #2 (Amarsh 8) | Playwright screenshots are gitignored while CLAUDE.md requires them to be reviewed | Amarsh 14 |
| 2026-09-05 | PR #2 (Amarsh 8) | QA screen shows "Commitments · Passed" green on every villa including ones failing three other gates — visible instance of the auto-pass bug | Amarsh 6 (already listed) |
| 2026-09-05 | PR #5 (Amarsh 2) | `postReceipt` now accepts finite numeric strings (`"500"`) and coerces once; `recordPtp` next to it still requires a strict number. Pick one rule for all money inputs when doing the API contract. | Amarsh 25 |
| 2026-09-05 | PR #5 (Amarsh 2) | `demands.test.ts` is at exactly 200 lines — the next receipt/demand test must split it (e.g. `demands-receipts.test.ts`) first | Whoever adds the next demand test |
| 2026-09-05 | PR #4 (Amarsh 3) | Harness auto-checkpoint commit (`claude: update …`) landed on the PR branch — squash-merge PRs so these don't reach `main` | Merge process |

## Shared-file rule

`server.ts`, `schema.ts`, `App.tsx` will be touched by both of you. Whoever opens a PR on one of those first that day owns it; the other rebases on top rather than opening a competing PR.

## Baselines measured 2026-09-05

Measured with `vitest run --coverage` (v8 provider) per package; Playwright not included.

| Package | Lines | Branches | Notes |
|---|---|---|---|
| `services/api` | **79.6%** | 74.7% | 78/78 tests. `server.ts` and `routes-lifecycle.ts` are **0%** and account for 292 of the 392 uncovered lines — the Express shell has no tests at all. Domain files (gates, readiness, clearance, handover, tower, transparency) all ≥85% lines; on branches `transparency.ts` 59%, `tower-view.ts` 54%, `readiness.ts` 75% miss the 80% bar. |
| `apps/workspace` | **3.7%** | — | 4 RTL tests. 0 of 11 pages have any coverage; 3 of 7 `ui/` components at 0%. 9 Playwright tests cover the screens visually but don't count here. |
| `apps/my-pranava-home` | **0%** | — | No unit tests. 2 Playwright tests. |

CI threshold to start from (Amarsh 14): API 79% lines / 74% branches, ratchet up only. Workspace and customer app: set a threshold once task-level tests exist; today it would be decorative.

**AWS, checked with `aws sts get-caller-identity`:** the CLI on Amarsh's machine is signed in as `Amarsh_claude` in account **975050032697 — our account, not Pranava's**. `infra/cdk.context.json` also carries a stale second account (`907213363571`) from an earlier synth. Task Vivek 24 step 1 exists because of this.

**Idle cost of what the CDK creates today (ESTIMATE, ap-south-1 list prices via `aws pricing`):** 1 NAT gateway $0.056/hr ≈ $41/mo + Aurora Serverless v2 floor 0.5 ACU × $0.18/ACU-hr ≈ $66/mo → **≈ $107/month (~₹9,000) with zero traffic**, because `serverlessV2MinCapacity: 0.5` has no auto-pause. Pranava should approve this number before deploy day.
