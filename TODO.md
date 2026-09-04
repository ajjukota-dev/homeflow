# HomeFlow 2.0 — final-state scope

**Source of truth: `docs/Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf` only.** Everything else under `docs/` (HOMEFLOW-OS.md, `docs/spec/**`) was AI-derived from it on 2026-09-03 and never reviewed; use it as a cross-check, never as the requirement. Page numbers below (`p13`) cite the PDF. The PDF names no database, language, cloud or auth provider ("System-Independent Architecture", p1); every stack choice in this file is ours and is marked as such.

**Method.** Build the end state the PDF describes, in the PDF's own priority order (§24 P0 → P1 → P2), with **no intermediate state that gets thrown away**. Each workstream below is a capability the client will recognise, not an engineering step. Bug fixes survive because the code they fix survives; stopgaps do not.

Rewritten 2026-09-05 04:20 IST (Amarsh: "the technical specs were vibecoded; move to the final state; no redundant intermediates"). The previous 48-task list is in git history (`3baa6e3`).

---

## 1. The final state in one paragraph (p33 §29)

A customer opens My Pranava Home and understands their journey. An employee opens My Day and knows what matters. A functional head sees where the process fails. Management sees only material exceptions. The unit retains a permanent digital history. Risk is predicted before it becomes a complaint. Every failure traces to customer, schedule and margin impact.

## 2. What already exists (measured 2026-09-05)

27 of the derived spec's 73 role tests built; 9 Phase-1 PRs open (#1–#9: typecheck gate, labels, file split, check-in + receipt validation, null due dates, truthful why-now, honest commitments gate, idempotent Act). 30 Postgres tables, 90 API tests, 55 UI tests, 22 Playwright specs. Engines that carry forward unchanged in intent: changeability gates (`gates.ts`), demand schedule + true-risk buckets (`collections*.ts`, `demands*.ts`), H7 clearance, evidence-based readiness, hard/soft handover gates, control tower ranking, customer transparency projection (T2–T6), DLP/warranty/check-ins, legal generate→approve→execute. No auth, no roles, no journey/SLA engine, no actions, no event log, in-memory DB, undeployed.

## 3. Stack decisions (ours, not the client's — say so if you disagree)

| Decision | Choice | Why this is the fast clean path |
|---|---|---|
| Language / runtime | TypeScript, Node 20, Express handlers already framework-free | 27/73 already here with tests; one language for API, both UIs and shared types |
| Database | PostgreSQL. Locally PGlite **persisted to disk** (one constructor arg), in prod any managed Postgres. Same SQL, one `db` port, versioned migrations | Removes the Docker-Postgres step entirely; PGlite in-memory stays for tests |
| Auth | Google sign-in via OpenID Connect (`openid-client`) + our own httpOnly session cookie; users, roles, Project Team Assignments in Postgres | Rambabu asked for Google login (HANDOFF §4.1). Cognito adds an AWS-account dependency we don't have and the PDF doesn't ask for it. Staff self-signup off; customers via booking-bound invite |
| Authorization | Role × module × action matrix as **data** (p26 §21 "Role/permission matrix and field-level sensitivity") + project scoping by Project Team Assignment; enforced in one middleware; field masking for financial/PII per p23 §17 | Matrix is Policy Studio config, not code |
| Files / evidence | Object-storage port: local-disk adapter now, S3-compatible adapter by env | p16 §8.8 mandatory photographs/tests/certificates |
| Documents (PDF output) | HTML template → PDF via headless Chromium (Playwright is already a dev dependency) | p38 §32 governed generation; no WeasyPrint/Python |
| Deploy | One container (API + both SPAs as static) + managed Postgres + object storage. First target: AWS (App Runner or ECS Fargate + RDS Postgres + S3) once Pranava's account/budget exists; runs identically on any container host | Replaces the Lambda/Aurora/CDK path, which needed API bundling, an authorizer and CloudFront before anything worked (≈$107/mo idle). Existing `infra/` is deleted or rewritten for this shape |
| UI | React + Vite + Tailwind tokens (design-language already in place), two SPAs, shared `packages/ui` only when a third consumer appears | Keep what exists; no extraction for its own sake |
| Tests / CI | Vitest + Playwright as now; GitHub Actions: typecheck, unit, Playwright (`--workers=1` until per-test DB), coverage report | Already measured baseline 79.6% API lines |
| Explicitly not built (p32 §27) | Chatbot, unexplained scores, a second chat stream, manual progress %, chart-heavy dashboards, AI auto-send, duplicated accounting masters, project-specific code branches | Client's own list |

## 4. Workstreams (the deliverables)

Each has: **Goal** in the PDF's words · **Scope** · **Exists** today · **Acceptance** = PDF tests it must pass · **Needs** = dependencies. Letters are ids; order of build is in §5, not here.

### A. Platform — identity, roles, project scoping, event log, persistence, deploy
**Goal (p6 §4.4, p23 §17, p27 §22):** "Project is a universal filter and security dimension"; "Immutable event/audit log for consequential changes"; "Hard-gate overrides require named authority, reason and evidence."
**Scope:** Google OIDC login + sessions; `user`, `role`, `permission_matrix` (data), `team`, `project_team_assignment` (p36 §31.1 fields: project, team, department, role_scope, assignment_type Dedicated/Shared/Central, primary/backup owner, effective_from/to, capacity, escalation_manager); every request resolves an actor + authorized projects; workspace opens in the user's default Project with a selector when authorized for more (p20 §13); field-level masking for financial/PII by role; append-only `event` table using Appendix B taxonomy (p42) emitted from every mutation; Postgres by env + migrations; container build; CI.
**Exists:** nothing of this. `db.ts` is `new PGlite()` in-memory; API wide open.
**Acceptance:** p37 §31.5 tests 1 ("Project-dedicated CRM user sees only assigned Project work by default; shared manager can switch"), 2 ("receipt posted against a Booking appears under the correct Project without manual selection"), 9 (effective-dated assignments don't rewrite history); p31 §26 "Critical workflows and edits have a complete audit trail"; p44 §33.6 test 3 ("Sales cannot edit Project-owned physical status or technical gates").
**Needs:** nothing. Everything else needs A.

### B. Canonical model — Portfolio → Project → Hierarchy → Unit → Booking → Customer/Applicant
**Goal (p4–6 §4):** seven entities that "must persist independently"; "Attach it to the Booking wherever the fact belongs to a particular customer-unit ownership relationship"; hierarchy keys mandatory on Unit; Project immutable on Unit (p27 §22); derived `project_id` on every downstream row validated against Unit/Booking (p36 §31.1).
**Scope:** add `portfolio`, `project_hierarchy_node` (Phase/Tower/Block/Cluster/Floor), `applicant` (co-owners, roles), booking lifecycle incl. cancel/transfer/resale keeping unit history; project master fields (RERA, escrow, launch/handover dates); dedupe/merge for customers preserving history (p27 §22); single master identifiers.
**Exists:** `project`, `unit`, `booking`, `customer`, `booking_applicant` tables; no hierarchy, no portfolio, no transfer/merge.
**Acceptance:** p31 §26 first two bullets ("Every active booking resolves to exactly one current unit and one or more valid applicants"; "Unit history remains intact when booking/customer changes") and "traced Portfolio → Project → Unit → Booking/Customer without duplicate manual project tagging".
**Needs:** A (actor on every write).

### C. Unit Digital Twin — Progress Control, Changeability Engine, freshness
**Goal (p13–15 §8.7.1, p33–35 §30, p43–44 §33):** "customisation availability … must be derived from the live physical state of each Unit Digital Twin and governed by configurable gates"; five states OPEN / CLOSING / CONDITIONAL / EXCEPTION ONLY / HARD CLOSED; "No API or UI path available to Sales/CRM may directly mutate UnitProgressState, ChangeGateRule or technical hard-gate state."
**Scope:** objects from p33 §30.1 — `UnitProgressState` (component, state_code, pct, actual_date, planned_next_event, source, updated_by/at, freshness), `ChangeCategory`, `ChangeGateRule` (trigger, condition, resulting state, hard/soft, effective dates, exception authority), `UnitChangeGate` (current_state, reason_code, source_event, expected_close_at, closing_event, last_evaluated_at, freshness_status). Project Unit Status Console with Project → Phase/Tower → Floor → Unit drill-down, **bulk update with affected-unit/gate preview and unit-level exceptions**, source + timestamp on every state, reopen-a-closed-gate requires reason (p13). Rule re-evaluation on every progress/procurement/policy change; gate-expiry forecast; freshness threshold → "Verification Required" (p34 §30.3). Unit 360 → Changeability matrix (p34 §30.2). Specification baseline + drawing/spec revision control with superseded lock (p5 §4.1, p12).
**Exists:** `gates.ts` pure engine (5 states, trigger rules), `unit_progress`, `component_definition`, `change_category`, `change_gate_rule` tables, Site progress screen. Missing: bulk + preview, exceptions, freshness, expiry forecast, source/actor, revision control, role gating.
**Acceptance:** all ten of p35 §30.5 and all eight of p44 §33.6.
**Needs:** A, B.

### D. Sales — inventory changeability view, personalisation discovery, holds, booking
**Goal (p14, p26 §20, p43 §33.3):** "Sales inventory must expose Construction %, expected possession window, Customisation Flexibility score and the current gate summary"; filters "Highly Customisable, Layout Flexible, Kitchen Changes Open, Electrical Changes Open, Flooring Selection Open, Bathroom Specification Open and Ready-to-Move"; compare ≥3 units; Must Have / Preferred / Not Important → Requirement Compatibility score "with a plain-language explanation … must never imply engineering approval"; Change Window Hold with expiry, Project approval, configured limits (p14).
**Scope:** objects `ProspectPersonalisationNeed`, `UnitRequirementMatch`, `ChangeWindowHold` (p34 §30.1); Sales inventory + compare + discovery screens; hold request/approve/expire; booking with applicants, commercial approvals and deviations attached (p9 §8.1); Sales read-only on physics.
**Exists:** inventory + book flow, gate chips, flexibility index (`readiness`/`gates`). Missing: filters, compare, discovery/match, holds, applicants UI, approvals.
**Acceptance:** p35 §30.5 tests 4, 6, 8; p31–32 §26 "Sales can filter/compare … see source timestamp/freshness"; "Must Have / Preferred … compared … without implying technical approval"; "Any Change Window Hold is time-bound, Project-approved, automatically expires".
**Needs:** C.

### E. Sales → CRM handover gate
**Goal (p9 §8.1):** "Make CRM acceptance a controlled quality gate": completeness score before submit; mandatory vs conditional document checklist by project/product/customer type; return reason taxonomy; first-time-right metric; automatic CRM actions on acceptance.
**Exists:** completeness gate in `bookings.ts`, accept/return, CRM queue. Missing: configurable checklist, return taxonomy, FTR metric, action generation (needs G).
**Acceptance:** Appendix B events "Sales handover submitted / returned / accepted"; p9 bullets as tests.
**Needs:** B, G, Q (checklist config).

### F. Journey Template + Universal Timeline/SLA Engine
**Goal (p22 §16, p44–47 §34):** "Do not hardcode any Project-specific number of days, dates, charges, milestones, stage names or customer wording"; Pranava Standard Journey Template → Project Template (inherit + override) → Journey instance per booking; universal date model **baseline / current plan / forecast / actual** with variance; SLA separate from plan; statuses On Track / Due Soon / At Risk / Overdue / Completed On Time / Completed Late derived, never painted; parallel streams — "a journey is not blocked merely because a prior numbered stage is open unless an explicit dependency or gate says so"; template versioning that never reshapes active journeys.
**Scope:** objects p46 §34.6 — `JourneyTemplate/Version`, `JourneyStageTemplate`, `JourneyTaskTemplate`, dependencies/gates, `JourneyInstance`, `StageInstance`, `TimelinePlanRevision`, `TimelineForecastRevision`, `SlaPolicy`, `SlaClockEvent`, `ProjectCalendar`, `DelayReason`. Screens p46 §34.5: Journey Template Studio, Project Journey Control, Customer/Booking Journey Timeline (customer layer + internal layer), Stage/Task detail, Management analytics. The 11 generic stages (p45) seeded as the Pranava Standard; East Crest's seven stages mapped as a Project override (p47 §35) — configuration, not code.
**Exists:** nothing. (Customer portal has a hardcoded 5-step tracker — replaced by the customer layer of this.)
**Acceptance:** all ten of p47 §34.7.
**Needs:** A, B. Feeds G, L, O, P.

### G. Universal Action + My Day + escalation + notifications
**Goal (p8–9 §7, p17 §8.13, p22 §16, p28 §23):** "Every actionable item … should normalize into one Action object" with the p8 field list and states New / In Progress / Waiting Internal / Waiting Customer / Blocked / Ready for Approval / Closed / Cancelled; My Day "ranked by deadline, customer impact, revenue impact, dependency impact and escalation risk" with a plain-language "Why now?"; L0–L4 escalation with system-generated decision packs; notifications: in-app default, daily digest, pre-breach alerts, quiet hours.
**Scope:** `action` table + creation from every handshake (accept → onboarding actions, demand due → collections action, snag → QA action, commitment at risk → owner action, intervention → owner action, document gap, approval); departmental queues; `GET /me/day`; escalation rules as config with tiers and backup owners; notification preferences + digest job; evidence required for closure (p8).
**Exists:** nothing (Act on intervention stamps `acted_at` only).
**Acceptance:** p31 §26 "Every actionable record appears in the universal action engine with owner, SLA and evidence requirement"; p22 §16 decision-pack contents; p28 §23 rules.
**Needs:** A, F (SLA clocks).

### H. Customer Change Requests & Unit Customisations
**Goal (p11–12 §8.7, p42 App. A):** full status flow Draft/Requested → Feasibility Review → Costing → Awaiting Approval → Awaiting Customer → Awaiting Payment → Approved → Released → In Progress → Ready for QA → QA Verified → Customer Accepted → As-Built Closed (+ Rejected/Withdrawn/Cancelled); multiple line items by room/trade; mandatory impact assessment (cost, schedule, technical, handover); approval matrix by type/value/margin/schedule/pre-or-post freeze; customer quotation with validity; payment gate before release unless authorized exception; drawing/spec revision release + superseded lock; auto-generated site/procurement/vendor actions; QA evidence before acceptance; as-built updates the twin; cancellation/reversal with abortive cost; profitability view (price, vendor cost, tax, waiver, contribution). Capture never blocked by a closed gate — routed (p13).
**Exists:** nothing.
**Acceptance:** p31 §26 four customisation bullets ("unique request ID, structured scope, impact assessment, approval state and auditable disposition"; "No change can be released to Site before … gates are satisfied"; "Site, QA and Procurement can identify the current released drawing/specification revision"; "Every completed customisation updates the permanent Unit Digital Twin … and preserves variation economics"); p35 §30.5 test 7 (request after registration/handover scheduling still captured, routed).
**Needs:** C, G, I (payment gate), K (QA), Q (approval matrix, catalogue, freeze dates).

### I. Collections, cash-flow forecasting, loans, TDS
**Goal (p9–10 §8.3–8.4, p36–37 §31):** "Move from reporting outstanding to predicting cash realization"; separate outstanding / due / overdue / disputed / loan-dependent / promise-to-pay / true risk; reason codes on every overdue; `CollectionForecastLine` per expected receipt with source types Contractual Due / Overdue Recovery / Promise-to-Pay / Loan Disbursement / Registration-Final Demand / Approved Reschedule / Manual Finance Override / Scenario-only Future Sales; immutable `ForecastSnapshot`s (month-start, weekly) + revisions; Actual vs Forecast-at-Month-Start vs Latest vs Actual-to-Date; waterfall (opening, due, expected, recovery, loan inflow, shortfall, closing, confidence); probability rule-based and explainable; Base/Conservative/Stretch scenarios never overwriting baseline; committed vs scenario lanes never mixed; no double counting; loans (sanctioned, disbursed, available, next demand, days-to-demand vs days-to-disbursement, lender contact, risk); TDS verification workflow; waiver approval + leakage.
**Scope:** screens p36–37 §31.3 — Project Cash Flow Planner, Project Collections Forecast, Portfolio Project Comparison, Project 360 header; overdue-reason picker UI; loans screen; TDS + waiver workflows; early-payment rule (Open question).
**Exists:** demand schedule (H3), buckets incl. TRUE_RISK and PTP, reason codes API, receipts (validated), clearance H7, loan_case table. Missing: forecast lines/snapshots/scenarios, planner screens, loans UI, TDS, waivers.
**Acceptance:** all ten of p37 §31.5; p31 §26 "Every overdue collection has a structured reason and next action"; management can view "last-period actual, current actual-to-date, next-month forecast and 30/60/90-day forecast by Project and portfolio"; "retains forecast snapshots and calculates forecast-to-actual variance without overwriting prior forecasts".
**Needs:** A, B, F (plan dates), G (actions).

### J. Legal Document Factory + Registration
**Goal (p9 §8.2, p10 §8.5–8.6, p38–41 §32):** "governed transaction/document platform, not free-form mail merge": document families (AOS, Sale Deed, Lease, Leave & Licence, Addendum, Allotment letter, Demand letter, Receipt/Statement, NOC, Possession letter, Declaration, Customisation agreement, Cancellation/Transfer, project letters) all configurable; objects p38 §32.2 — `DocumentTemplate` (project scope, legal entity, property type, transaction type, jurisdiction, effective dates, version, status Draft/Under Review/Approved/Retired, checksum), `MergeFieldDefinition`, `ClauseLibrary` (Locked / Parameterized / Negotiable-with-Approval), `ClauseSelectionRule`, `GeneratedDocument` (template version, data snapshot id, selected clauses, versions), `DocumentDeviation`, `DocumentApproval`, `ExecutionRecord`; readiness panel Ready/Warning/Blocked; canonical workflow Select → Readiness → Draft → Validation → Internal Review → Legal/Commercial Approval → Customer Review → Approved-for-Execution → eSign/Wet/Registration → Final → Archive; every revision immutable; redline with structured change summary; checksum-locked finals visible from Project/Unit/Booking/Customer; segregation of duties (no self-approval of own deviation); Template & Clause Studio. Registration: readiness checklist (documents, payments, TDS, appointments, signatures), SRO slot scheduling with change history, hard pre-registration gate, day-of checklist, registered document archive, forecast date with confidence.
**Exists:** one AOS template, generate → approve → execute, registration blocked until H7, `registration_case`. Missing: everything structural above.
**Acceptance:** all ten of p41 §32.11; p32 §26 six document bullets.
**Needs:** A, B, I (consideration, clearance), object storage (A), PDF renderer (§3).

### K. Readiness, QA, snags, handover
**Goal (p7–8 §6, p16 §8.8–8.10, p17 §9):** three scores — Unit Readiness, Customer/Booking Readiness, Handover Readiness — each with "current value, trend, top three drivers, confidence level, and recommended actions"; component hierarchy by room/trade/system; checklist completion with mandatory photographs/tests/certificates; "Site declaration and independent QA verification as separate states"; common-area/utility/statutory dependencies; exception queue for failed/repeat inspections; snags with category, severity, location, trade, contractor, root cause, SLA by severity, before/after evidence, customer verification, repeat flag, cost; handover as gated event — eight gate dimensions (p17 §9: Financial, Legal, Registration, Physical, Quality, Commitments, Customer, FM/Community) with the override column as written; predicted handover date + confidence; appointment workflow + customer confirmation; digital handover checklist (keys, meters, manuals, warranties, signatures, photographs).
**Exists:** evidence-based readiness engine, snag table, hard/soft handover gates for six dimensions, handover record, QA screen. Missing: Customer + FM gates, site-declared vs QA-verified split, real evidence upload, snag CRUD + SLA + root cause + analytics, appointment workflow, digital checklist, predicted date, named-authority override UI (safety gates never), exception queue, score drivers/trend/confidence.
**Acceptance:** p31 §26 "Every readiness score is explainable down to component/blocker level"; "Hard handover gates cannot be bypassed without configured authority and audit reason"; Appendix A Snag and Handover statuses; Appendix B events.
**Needs:** A, C, G, L (commitments gate reads real data).

### L. Commitments — the Promise Ledger
**Goal (p16 §8.11, p41 App. A):** "Promise, owner, beneficiary, due date, financial impact, approval and evidence"; internal vs customer-facing; statuses Draft / Approved / Active / At Risk / Fulfilled / Breached / Waived-Cancelled; pre-breach alerts + recovery plan; broken-promise rate by team and root cause; confidence from dependencies. (AI promise detection is P1+.)
**Exists:** nothing — the commitments handover gate currently reports "Not verified" (PR #7). This workstream makes it a real hard gate again.
**Acceptance:** p31 §26 "Every customer-facing commitment has owner, due date, status, dependencies and evidence"; §24 P0 row.
**Needs:** A, G (actions + pre-breach), F (SLA).

### M. Communications
**Goal (p16 §8.12):** omnichannel log (call, email, WhatsApp, SMS, meeting, notice); strict internal vs customer-visible separation; templates with project/legal/compliance approval; frequency guardrails. (AI summary/sentiment are P1+.)
**Exists:** nothing.
**Acceptance:** Appendix B "Customer contact sent / response received"; p23 §17 "Internal notes … remain internal".
**Needs:** A, Q (templates, approval), G (contact actions).

### N. Post-handover — DLP/warranty, service, Home Passport, check-ins, advocacy
**Goal (p17 §8.14):** move-in tasks + FM onboarding; warranty case management; Digital Home Passport (equipment, serials, manuals, warranties); service history on the unit; 7/30/90-day and DLP-closure check-ins; referral/testimonial workflow.
**Exists:** DLP windows, warranty cases (₹1 placeholder for out-of-coverage), service history, check-ins (score now validated; UI hardcodes 5), passport items. Missing: real check-in input, quote flow, move-in tasks, FM onboarding, advocacy, root-cause → QA analytics.
**Acceptance:** p17 bullets as tests; Appendix B warranty events.
**Needs:** G, K.

### O. Customer portal — My Pranava Home
**Goal (p18–19 §11–12):** areas Journey, My Home, Payments, Documents, Registration, Handover, Requests (raise service requests **and** submit/approve unit customisations, quotations, drawings), Commitments, Home Passport; visibility rule verbatim: "show commitments, milestones, actions required from customer, approved dates and final evidence. Do not show internal blame, employee performance, vendor disputes, internal notes or unapproved forecasts"; moments that matter (p19 §12) incl. Booking+24h welcome and 7/30/90 check-ins; customer login via booking-bound invite (A).
**Exists:** read-only portal for one hardcoded booking (Karthik), T2–T6 projections, hardcoded 5-step tracker. Missing: login, Documents, Registration, Handover, Requests (incl. customisation approval), Commitments areas; journey layer from F; stage-level visibility config (p27 §21).
**Acceptance:** p31 §26 "Customer-facing information never exposes internal notes or unapproved assumptions"; p47 §34.7 test 9 ("Customer-facing journey hides internal-only tasks").
**Needs:** A, F, H, J, K, L.

### P. Management — Control Tower, Project Cash Flow, KPIs, exceptions, profitability
**Goal (p21 §14, p21–22 §15, p24–25 §19):** "five problems that need intervention, not fifty charts"; Portfolio / Cash / Project Cash Flow / Project Performance / Experience / Execution / Profitability views with drill-down to Unit/Booking; five system-generated ranked interventions with owner, rupee/customer impact and decision; Management > Exceptions (stale gates, high-value exceptions, holds affecting schedule, post-gate changes, change margin impact — p34 §30.2); KPI framework p24 §19 by domain; profitability economic objects p21 §15 (commercial leakage, service leakage, quality cost, delay cost, cost-to-serve, unit contribution, customisation economics); materiality thresholds as config.
**Exists:** control tower with five interventions, Act. Missing: drill-down, cash-flow views (from I), exceptions view, KPI explorer, profitability, thresholds.
**Acceptance:** p31 §26 "Management can identify the top five portfolio interventions without navigating multiple reports"; p37 §31.5 test 10 (all dashboards drill to Unit/Booking and back to Project 360).
**Needs:** I, F, G, H, K.

### Q. Policy Studio — every configurable thing, as data
**Goal (p26–27 §21):** the full list — workflow templates by product (apartment, villa, office, plotted), conditional task rules, SLA policies + calendars + pause reasons, approval authority matrix, handover gate configuration, communication templates, score weights/thresholds, role/permission matrix + field sensitivity, escalation routing + management thresholds, customisation policy (catalogue, freeze dates, constraints, quotation validity, payment gates, cancellation), variation approval matrix, change-gate rule studio, gate-expiry source mapping, Change Window Hold policy, freshness thresholds, project master + hierarchy, Project Team Assignment matrix, forecast policy, period calendar, cash-flow targets, template versioning with migration rule, parallel-stream config, stage-level customer visibility + wording, timeline policy. Effective-dated versions with change log.
**Exists:** config tables for components, gate rules, payment plans, policies (seeded, not editable).
**Acceptance:** p47 §34.7 tests 1, 2, 5; p31–32 §26 "Approved users can generate … only from an approved template version valid for the relevant Project/transaction context".
**Needs:** A. Each other workstream lands its own studio tab as it lands (no big-bang admin).

### R. Customer 360 / Unit 360 / Booking 360 (P1)
**Goal (p25 §20):** the three twin screens; Project 360 header everywhere (p37 §31.3) with context retained across modules.
**Exists:** Customer 360 (basic), unit detail. **Needs:** B, C, F, I, J, K, L.

### S. Intelligence layer (P1–P2, rule-based first — p18 §10)
Journey risk, next best action, collection risk, commitment risk, sentiment, document intelligence, quality root cause, profitability leakage; copilots last. **Not started until G, I, L, K produce the data.** Every score must show value, trend, three drivers, confidence, recommended action (p8 §6).

---

## 5. Sequence — the PDF's priorities, run as parallel lanes

Agents build; Amarsh and Vivek review. Person-split is for **review ownership only**. Lanes run concurrently once their dependency is merged.

| Wave | PDF priority | Lanes (parallel) | Merged means |
|---|---|---|---|
| **0** (now) | — | Merge PRs #1–#9 | Typed base, validated inputs, honest gates |
| **1** | P0 foundation (p28 §24, p30 §25 weeks 1–2) | **A** platform · **B** canonical model · **F** journey/SLA engine | Login works, roles/projects enforced, every write emits an event, Postgres by env, container deploys, journeys instantiate on booking with the 11 standard stages |
| **2** | P0 (weeks 3–8) | **C** twin + changeability (bulk, freshness, expiry) · **G** actions/My Day/escalation · **L** Promise Ledger · **K** readiness/gates/snags (evidence, 8 gates, override) · **E** handover gate | The §30.5, §33.6 and §34.7 acceptance tests pass; My Day ranks real actions; commitments gate is hard again |
| **3** | P0 (weeks 7–12) | **H** change requests · **I** collections forecast/loans/TDS · **J** document factory + registration · **Q** studio tabs for what landed | §31.5 and §32.11 pass; East Crest configured as a Project override, not code |
| **4** | P1 (3–6 months) | **O** portal (all areas, login) · **P** control tower/cash-flow/KPIs/exceptions · **R** 360s · **M** communications · **N** post-handover completion | §26 all 30 bullets pass end to end |
| **5** | P1–P2 | **S** intelligence, document intelligence, copilots; profitability analytics; vendor learning | — |

Review load: waves 1–3 land 3–5 PRs each. If that's too much to read, the lever is fewer lanes per wave, not smaller intermediates.

## 6. What was cut from the previous list, and why

| Old task | Why it's gone |
|---|---|
| V4 stub `x-user` header for "who am I" | Superseded by real login (A). Portal identity comes from the invite session |
| V10 Docker Postgres + docker-compose + Makefile; V11 `cognito-local`; V21/V24 Lambda bundling, Cognito authorizer, CloudFront | Superseded by §3: PGlite-on-disk locally, managed Postgres by env, one container. Nothing to run locally but `npm run dev` |
| V15 `packages/ui`, `packages/core` | Refactor with no functional requirement behind it; do it when a third consumer exists |
| V9 / A9 file splits, A14 lint | Hygiene; keep the 200-line rule in review, drop the tasks (A9 already done in #3) |
| A25 `/api/v1` + OpenAPI | PDF says nothing about API versioning; add OpenAPI when an external consumer appears (p23 §18 says integrations are optional) |
| A6 soft-gate stopgap (shipped as #7), A7 `acted_by = null` (shipped as #8) | Kept as shipped, but both are superseded in wave 2 by L (real hard gate) and A (real actor). No further stopgaps |
| A12 handover override as a separate task; A13 data freshness | Folded into K and C respectively — they are properties of those engines, not features |
| "Vivek/Amarsh" as sequencing | Replaced by lanes; ownership stays for review |

Kept from the old list because the bugs are in surviving code: V1 error middleware, V2 block return on active booking, V3 progress-regression reason/audit (now part of C), V6 validation + unique constraints, V7 layout/tokens/dark mode, V8 CRM project filter (subsumed by A's project scoping), A9a IST dates, the paid-demand wording follow-up.

## 7. Decisions taken (Amarsh, 2026-09-05 04:30 IST)

1. **Auth = Google sign-in + email/password.** Provider is our call (see §3 update below).
2. **Deploy as a container, not Lambda** — yes. `infra/` CDK stacks to be replaced.
3. **Wave 1 lanes in parallel** — yes. Claude merges; no human review gate.
4. **East Crest** stays demo config only — yes.
5. **Single owner: Amarsh.** Vivek is out of the plan. Review ownership in §5 is moot; Claude builds and verifies, Amarsh accepts by using the deployed app.
6. **Hosting: Amarsh's personal AWS account for now** (account `975050032697`, IAM user `Amarsh_claude`, local profile `pranava`, region `ap-south-1`). Real customer PII must not land here — move to Pranava's account before go-live. The access key was shared in chat on 2026-09-05 → rotate after the deploy spike.
7. **Requirements pass before build:** keep asking until the build can run autonomously; run every spike first (§7a).

§3 update — auth provider: with an AWS account in hand, **Cognito user pool** (Google as federated IdP + email/password, custom login page calling the Cognito API, API verifies the JWT) replaces the self-hosted OIDC+sessions choice. Reason: password storage, reset flows and Google federation come for free and the security surface is smaller; cost ₹0 under 50k users. Local dev points at a `dev` pool.

### 7a. Spikes to run before wave 1 (each ends in a committed, working proof)

| # | Spike | Proves |
|---|---|---|
| S1 | Existing 30-table schema + tests on real Postgres (RDS) via one `db` port; PGlite-on-disk locally; SQL migration runner | PGlite ↔ Postgres SQL parity, migration path |
| S2 | Cognito pool (Google IdP + email/password) + custom login page + JWT middleware + invite flow | Auth end to end, both methods, no hosted-UI look |
| S3 | One Dockerfile (API serves both SPAs) → App Runner + RDS + S3, deployed by script; measure monthly cost | Deploy shape, cost |
| S4 | HTML → PDF with Chromium inside the container (₹, Indian names, A4) | Document Factory renderer |
| S5 | Evidence upload: presigned S3 PUT + local-disk adapter; photo from phone camera at 375px | Files port |
| S6 | Per-test database so Playwright runs in parallel | CI speed, no shared-DB flakiness |
| S7 | Email via SES (sandbox, verified senders) for invite / reset / daily digest | Notification channel |
| S8 | (only if approved) one Claude API call classifying a communication into a commitment | Intelligence layer feasibility/cost |

## 8. Open questions for Pranava

| Question | Blocks |
|---|---|
| Which AWS account/region/budget may we deploy into (or any other host)? | A deploy |
| Google OAuth client id/secret; domain or default URL? | A |
| Is anyone entering real data into the Emergent preview app? Rotate the tokens committed in its `qa/*.tok`. | Cut-over |
| Check-in satisfaction scale (1–5 assumed) and default when skipped (p17 §8.14 names 7/30/90 only) | N |
| May a customer pay an instalment before its trigger fires? | I |
| Working-day calendar and holidays per project (p46 §34.3 calendar) | F |
| Materiality thresholds for management alerts (p28 §23) | P |
| Change-freeze dates, allowed catalogue and payment-gate % per project (p11 §8.7) | H, Q |

## 9. Record

**Done (open PRs, verified 2026-09-05):** #1 typecheck gate · #2 human labels · #3 file split · #4 check-in validation · #5 receipt validation · #6 null due dates on scheduled demands · #7 commitments gate "Not verified" · #8 idempotent Act + `acted_at` · #9 truthful why-now. Merge order: #1 → #3 → #5 → #6 → #9; #1 → #4 → #8; #1 → #7; #2 any time; squash-merge #4.

**Found while building (carried):** `today()` uses the UTC day (fix in A: one `todayIst()`/project calendar); workspace hardcodes `satisfaction_score: 5` (N); Playwright screenshots gitignored while the rule says review them (CI uploads them as artifacts — A); e2e suite mutates the shared in-memory DB (A gives tests their own DB); `postReceipt` accepts receipts on scheduled demands (I, Open question); `demands.test.ts` at 200 lines (split on next touch); V110 seed flooring → `complete` (demo note).

**Baselines (2026-09-05):** API 79.6% lines / 74.7% branches (server.ts and routes-lifecycle.ts 0%); workspace 3.7%; customer app 0%. Idle cost of the old CDK stack ≈ $107/month — moot under §3.
