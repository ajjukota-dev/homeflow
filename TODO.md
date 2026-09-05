# HomeFlow 2.0 — final-state scope

**Source of truth: `docs/Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf` only.** Everything else under `docs/` (HOMEFLOW-OS.md, `docs/spec/**`) was AI-derived from it on 2026-09-03 and never reviewed; use it as a cross-check, never as the requirement. Page numbers below (`p13`) cite the PDF. The PDF names no database, language, cloud or auth provider ("System-Independent Architecture", p1); every stack choice in this file is ours and is marked as such.

**Method.** Build the end state the PDF describes, in the PDF's own priority order (§24 P0 → P1 → P2), with **no intermediate state that gets thrown away**. Each workstream below is a capability the client will recognise, not an engineering step. Bug fixes survive because the code they fix survives; stopgaps do not.

Rewritten 2026-09-05 04:20 IST (Amarsh: "the technical specs were vibecoded; move to the final state; no redundant intermediates"). The previous 48-task list is in git history (`3baa6e3`).

---

## 0. Status board (updated on every merge — the "where are we" view)

**Position:** R0 nearly done (4/5 merged) · **Live URL:** https://we947t2rq2.ap-south-1.awsapprunner.com (`/health` → `{"ok":true,"db":true}` against real RDS) · **Last deploy:** 2026-09-05 R0-03 merge · **Last updated:** 2026-09-05 08:45 IST

```
Specs merged    [██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]  4 / 33 (01 in final verification)
Deployed + E2E  [██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]  4 / 33
```

Legend: ⬜ not started · 🟨 in progress (branch open) · 🟩 merged to main · 🟦 deployed to URL with journey green · ⛔ blocked (see §9)

| Wave | Spec | Status | Notes |
|---|---|---|---|
| R0 | 03 platform & deploy | 🟩 | merged (PR #12 + hotfix #14) — live URL above |
| R0 | 01 identity & access | 🟨 | PR #13 — e2e re-verifying after merge-conflict + nav-locator fixes (agent af79a733190f00d5b) |
| R0 | 32 design system | 🟩 | merged (PR #11) — Jost/Geist, tokens, 8 primitives, axe clean |
| R0 | 02 event log | 🟩 | merged (PR #10) |
| R0 | 04 canonical model | 🟩 | merged (PR #10) |
| R0.5 | **schema reconciliation** — generate `docs/specs/SCHEMA.md` from merged 01/02/04 migrations (ground truth), diff against every downstream spec's assumed columns/FKs/enums, fix drift in spec text before R2 starts | ⬜ | gap flagged by Amarsh 06:35 — specs were never cross-checked against each other, only self-consistent |
| R0.6 | **authorize()/mask()/assertProjectScope() wired into every route** — currently only `/api/admin/*` and the CUSTOMER branch of `/api/me/home` call the permission-matrix check; the other ~21 handlers in `server.ts` rely solely on `requireSession` (any authenticated user, any role, can call them) plus client-side nav filtering | ⬜ | flagged by the PR #13 build agent, confirmed by re-inspection 08:40 — real gap against the "prod-ready" claim (§7 decision 22) and against S2's own spike goal ("middleware on every route"); UI nav filtering means a demo click-through won't surface it, but a direct API call would. Needs: per-route module-name mapping (33-module list, `docs/specs/01-identity-access.md`) + minimum level per verb, then one pass through `server.ts`/`routes-model.ts`/`routes-lifecycle.ts`. Sized ~21 routes — its own lane, run after 01 merges, before or parallel with R2 |
| R1 | screen migration + journeys + Roadmap page + demo seed | ⬜ | |
| R2 | 05 journey templates | ⬜ | |
| R2 | 06 timeline & SLA | ⬜ | |
| R2 | 10 universal action | ⬜ | |
| R2 | 25 policy studio shell + approval matrix | ⬜ | |
| R3 (CFO first) | 19 collections & true risk | ⬜ | |
| R3 | 21 loans | ⬜ | |
| R3 | 20 cash forecast | ⬜ | |
| R3 | 12 escalations & notifications | ⬜ | |
| R3 | 13 promise ledger | ⬜ | |
| R3 | 14 readiness scores | ⬜ | |
| R4 | 27 management control tower | ⬜ | |
| R4 | 11 my day | ⬜ | |
| R4 | 26 customer portal | ⬜ | |
| R4 | 17 sales→CRM handover | ⬜ | |
| R4 | 22 document factory | ⬜ | |
| R5 | 07 unit progress control | ⬜ | |
| R5 | 08 changeability engine | ⬜ | |
| R5 | 09 spec revisions | ⬜ | |
| R5 | 24 sales inventory & discovery | ⬜ | |
| R5 | 18 change requests | ⬜ | |
| R6 | 15 QA evidence & snags | ⬜ | |
| R6 | 16 handover gates | ⬜ | |
| R6 | 23 registration | ⬜ | |
| R6 | 29 communications | ⬜ | |
| R6 | 30 post-handover | ⬜ | |
| R7 | 28 360 views | ⬜ | |
| R7 | 31 intelligence | ⬜ | |

Order follows dependency first, then Amarsh's Q3 priority (cash → Control Tower → portal → My Day → customisation → handover/QA → documents). Detailed log: `docs/demo/run-log.md`; demo script: `docs/demo/click-path.md`.

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
| Auth | **Self-hosted email/password now** (argon2id hashes, server-side sessions in Postgres, httpOnly cookie, invite + reset by email); **Google sign-in added later** as a second method via OpenID Connect once Pranava provides an OAuth client (their Google Workspace). No Cognito. Staff self-signup off; customers via booking-bound invite | Decided 2026-09-05 05:00: Emergent's Google login ran through Emergent's own broker (`auth.emergentagent.com`) — nothing reusable; the client demo is today, so email/password with seeded demo users ships first and is not throwaway |
| Email | Gmail SMTP (Amarsh's account, app password in `services/api/.env.local`) for invites, resets, digests during build; switch to Pranava's mailbox/domain at handover (client question) | ~500 mails/day cap is fine for dev/demo; SES needs a verified domain we don't have yet |
| AI text tasks | OpenAI API (Amarsh's key in `.env.local`) behind one `llm` port; rules first, LLM only where rules can't (p18 §10) | Amarsh's choice 2026-09-05; the port lets the provider change without touching features |
| Authorization | Role × module × action matrix as **data** (p26 §21 "Role/permission matrix and field-level sensitivity") + project scoping by Project Team Assignment; enforced in one middleware; field masking for financial/PII per p23 §17 | Matrix is Policy Studio config, not code |
| Files / evidence | Object-storage port: local-disk adapter now, S3-compatible adapter by env | p16 §8.8 mandatory photographs/tests/certificates |
| Documents (PDF output) | HTML template → PDF via headless Chromium (Playwright is already a dev dependency) | p38 §32 governed generation; no WeasyPrint/Python |
| Deploy | One container (API + both SPAs as static) → **AWS App Runner + RDS Postgres (db.t4g.micro, single-AZ while building) + S3**, in Amarsh's account `975050032697`, `ap-south-1`, IaC as a small CDK app or plain scripts; runs identically on any container host. Target ₹3–5k/month, measured in S3 | Replaces the Lambda/Aurora/CDK path (API bundling, authorizer, CloudFront before anything worked; ≈$107/mo idle). Existing `infra/` is deleted. Demo today is shown **from AWS** with a prod-ready claim: HTTPS, real login, persistent DB, backups on, health check, logs |
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

### 5a. The autonomous run (starts on Amarsh's "go"; nothing below is started before that)

Ground rules: Sonnet agents, `isolation: "worktree"`, one branch + PR per lane, each agent gets exactly one `docs/specs/*.md` file plus `docs/specs/00-conventions.md`; agent must not touch files outside its spec's "Files" list; Claude (main thread) reviews the diff against the spec's acceptance list, runs the full suite on the merged result, merges (squash), deploys `main` to the App Runner URL, updates `TODO.md`. Max 4 agents concurrently. Never kill processes by name. Never `git stash`.

| Step | Lanes in parallel | Exit criterion |
|---|---|---|
| R0 spikes + design foundation | S1 → S3 · S2(+S7) · S5+S4 · S6+S8 · **32 design system** (tokens, fonts, motion, first primitives, previews synced to Claude Design) | Demo URL live over HTTPS with login; 100 API + 52 UI tests green on Postgres; cost measured; Amarsh has approved tokens + primitives in Claude Design |
| R1 demo hardening | migrate existing screens to `packages/ui` · seeded demo users per role · demo data for 3 products · **E2E journeys** for every existing feature at 375/1440 (`e2e/journeys/sale-to-handover.spec.ts` etc.) · smoke against the URL | Amarsh can log in as each role and walk Sales → CRM → Collections → QA → Handover → Portal on the URL, in the new design, with the journeys green |
| R2 wave 1 | A (remaining: roles/permission matrix, project scoping, event log) · B · F | §26 audit/trace bullets, p37 §31.5 t1/t2/t9, p47 §34.7 all ten |
| R3 wave 2 | C · G · L · K · E | p35 §30.5, p44 §33.6, commitments gate hard, My Day ranks real actions |
| R4 wave 3 | H · I · J · D · Q tabs | p37 §31.5, p41 §32.11, §26 customisation + document bullets |
| R5 wave 4 | O · P · R · M · N | §26 all bullets end to end |
| R6 wave 5 | S | rule-based scores with drivers; OpenAI text tasks behind the port |

After every merged lane: deploy, screenshot, one-paragraph note in §9 "Record". If a lane fails its acceptance twice, stop the lane and write the blocker in §9 instead of retrying a third time.

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
8. **No CSV importers.** Pranava's existing Excel/Tally data is loaded by Claude Code directly into the DB when needed; richer demo data is added as building/testing requires. Keep a scripted seed path (SQL/JSON), not an import UI.
9. **Intelligence layer = rules first, LLM where the PDF says AI, using OpenAI** (Amarsh's key, in `services/api/.env.local`, gitignored; rotate — it was shared in chat). S8 targets the OpenAI API, not Claude.
10. **Products: apartments + villas + plots** from day one — `product_type` on Project/Unit, journey templates and change categories keyed by product (PDF §21 "workflow templates by product").
11. **Hosting shape: App Runner + RDS Postgres + S3, ~₹3–5k/month**, measured in S3.

Defaults accepted by silence (2026-09-05): staff-entered receipts/loans/SRO slots (no bank/government/lender integration); portal Payments view-only, no gateway; document execution recorded by uploaded signed scan, no e-sign vendor; in-app + SES email are live channels, WhatsApp/SMS/calls logged not sent; English only; responsive web with phone camera upload, no native app; Emergent-extracted values as editable seed defaults; roles exactly PDF §13.

12. **Google sign-in deferred** (05:00): Emergent's Google login is Emergent's broker, not reusable. Email/password ships now; Google needs an OAuth client from Pranava → §8.
13. **Gmail SMTP now, client mailbox later** → §8.
14. **Demo today is shown from AWS** with a prod-ready claim → the run starts with deploy + login (§5a).
15. **Parallelise** the autonomous run with Sonnet agents in worktrees, one PR per lane; Claude merges (worktrees removed before `gh pr merge --delete-branch` — see §9 lesson).
16. **Specs:** one file per feature in `docs/specs/` (§10). `docs/spec/` (legacy, vibecoded) is deleted once `docs/specs/` covers it.

17. **Design system overhaul first** (05:40): Amarsh — "colours or spacing or font or size looks really cheap and bad, and animations are expected." Measured cause: no webfont (Segoe UI on Windows), generic blue accent, ghost cards, zero authored motion. Spec `docs/specs/32-design-system.md`; `packages/ui` shared by both apps (reverses the earlier `packages/` cut — a shared design system is the justifying consumer); previews synced to Claude Design for his review; tokens + primitives approved before screens migrate.
18. **End-to-end journeys are the definition of done**, not unit tests: every feature ships a Playwright journey against real API + seeded data at 375/1440 with axe; cross-feature journeys in `e2e/journeys/`; same journeys run against the URL after each deploy; Claude reviews screenshots/traces before merge. (conventions §DoD updated)
19. **Clean-code gates**: ESLint strict + Prettier + `knip` in CI alongside tsc/tests.
21. **Brand (05:50):** researched from the logo file + pranavagroup.com — orange `#E74C0A` (logo `#E65123`), ink `#1C1F26`, charcoal `#424242`, Jost typeface, tagline "Presenting the Future". Assets in `docs/brand/`. Orange is the accent only; Jost for headings, Geist for body/data. Claude Design project "Pranava HomeFlow" created (`a9dbd115-c63e-4358-a8fe-a57754659c37`); `/design-login` done. Still ask Pranava for the SVG logo (§8).
24. **AWS naming (06:40):** account `975050032697` already holds an unrelated `Project=pranava-portal` (EC2 `pranava-test`, S3 `pranava-fmwork-test-975050032697`, IAM `pranava-portal-ec2`/`pranava-test-ec2-role`) — not HomeFlow, don't touch. All HomeFlow resources tagged `Project=homeflow`, prefixed `homeflow-`. Sent as a correction to the running platform lane (spec 03 updated).
22. **Demo (05:58): today, CEO + CFO, not movable, "complete app, prod-usable after adding the client's Google/mailbox".** Claude stated the dependency-graph estimate (days, not hours, for P0+P1) and the refusal to show mock screens or static numbers; Amarsh: "trust the process and keep going as far and fast as you can". Rule for today: build in dependency order, deploy every merged lane to the URL, demo exactly what is verified end to end at demo time, label the rest "in build" honestly. Amarsh will switch his own session to Sonnet during implementation (forks inherit the parent model).
23. **Grill-me outcomes (06:05–06:20):** Q2 demo hour → Amarsh tells Claude later; freeze `main` 90 min before, smoke everything against the URL, fixes only inside the freeze. Q3 priority after foundation: cash/collections → Control Tower → portal → My Day → customisation/twin → handover/QA → documents. Q4 demo data extended per feature only where needed, always reconciling. Q5 default App Runner URL (custom domain is a client ask). Q6 Claude Design review non-blocking today. Q7 4 lanes (→6 if no 429s), push often, resume on same branch, two acceptance failures = stop and log. Q8 role accounts `<role>@demo.pranava` / `Demo@2026`, plus a live invite of the CFO in the room (smoke-tested first). Q9 three-line report per merge + `docs/demo/run-log.md` + `docs/demo/click-path.md`. Q10 no dead ends; Management → Roadmap page. Q11 main thread stays on Fable, no forks, Sonnet agents only. Target = everything; if short at demo time, decide together then.
20. New dependencies approved for 32: `motion` (framer-motion v12), self-hosted Geist Sans/Mono + Newsreader woff2, `@axe-core/playwright`. Any other new dependency still needs a one-line ask.

25. **Authorization gap logged, not silently fixed inline (08:40):** PR #13 (identity/access) wires `authorize()`/`mask()`/`assertProjectScope()` into `/api/admin/*` and the customer branch of `/api/me/home` only — every other existing route enforces authentication (`requireSession`, no route is reachable unauthenticated) but not authorization (any role can call any other route; the workspace UI's nav filtering is the only thing hiding this today). Queued as **R0.6** (§0) rather than patched mid-review: it touches ~21 routes across 3 files, is exactly the kind of change that should be its own reviewed lane, and R0's own definition of done didn't originally require it to block this merge. Decision: merge 01 with the gap open and documented, close R0.6 right after — not carried silently into R2+.

(Earlier Cognito note withdrawn — superseded by 12.)

### 7a. Spikes (each ends in a committed, working proof; run first, in parallel where the table allows)

| # | Spike | Proves | Parallel lane |
|---|---|---|---|
| S1 | Existing schema + 100 API tests on real Postgres (RDS) via one `db` port; PGlite-on-disk locally; SQL migration runner | PGlite ↔ Postgres SQL parity, migration path | 1 |
| S3 | One Dockerfile (API serves both SPAs) → App Runner + RDS + S3 in `975050032697`, deployed by script; HTTPS URL; measured monthly cost | Deploy shape, cost, demo URL | 1 (after S1's `db` port) |
| S2 | Self-hosted email/password: `user`, `session`, argon2id, login/logout/invite/reset, seeded demo users per PDF §13 role, middleware on every route, both SPAs' login screens | Real login on the demo URL | 2 |
| S7 | Gmail SMTP mailer port (invite, reset, digest) with a local "write to file" adapter for tests | Email channel | 2 (inside S2) |
| S5 | Evidence upload: presigned S3 PUT + local-disk adapter; phone camera capture at 375px | Files port | 3 |
| S4 | HTML → PDF with Chromium inside the container (₹, Indian names, A4, Draft watermark) | Document Factory renderer | 3 |
| S6 | One DB per test file; Playwright with `--workers=4` green | CI speed, no shared-DB flakiness | 4 |
| S8 | One OpenAI call behind the `llm` port classifying a communication into a commitment candidate, with cost logged | Intelligence layer wiring | 4 |

## 8. Open questions for Pranava

| Question | Blocks |
|---|---|
| Pranava's own AWS account (or host) for go-live — building in Amarsh's `975050032697` meanwhile; no real customer PII until moved | Go-live |
| **Google sign-in:** an OAuth client from Pranava's Google Workspace (client id/secret, allowed domain) — email/password works without it | A (Google method) |
| **Email sender:** Pranava mailbox/domain for invites, resets, digests (SMTP or SES credentials) — Amarsh's Gmail is used meanwhile | A (email) |
| App domain (e.g. `homeflow.pranava.in`) for HTTPS + cookies — App Runner default URL meanwhile | Deploy |
| **Logo SVG** + any brand guideline PDF + project photography (colours/typeface already taken from pranavagroup.com; JPEG/PNG logo in `docs/brand/`) | 32 polish |
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

**Merge lesson (05:00):** `gh pr merge --delete-branch` on stacked PRs while agent worktrees still hold the branches → branch delete fails → GitHub never retargets children → #3–#9 landed on their parent branches instead of `main`. Fixed by cherry-picking each squash commit onto `main` in dependency order (two conflicts resolved: `QaHandover.tsx`, `ControlTower.tsx`). Rule: `git worktree remove` first, merge parent, wait for retarget, then merge child. All nine PRs verified on `main` at `862900c`: tsc 0/0, API 100/100, workspace 52/52.

**Secrets shared in chat on 2026-09-05 (rotate after R0):** AWS access key for `Amarsh_claude`; OpenAI project key; Gmail app password. All stored only in `~/.aws/credentials` and `services/api/.env.local` (gitignored, verified).

## 10. Specs — `docs/specs/`

One file per feature; the build contract for the autonomous run. `00-conventions.md` applies to every file. Written 2026-09-05 from the PDF + `docs/reference/emergent-business-rules.md` seeds; **[E]** marks Emergent-derived defaults, **[ours]** marks engineering choices.

| File | Feature | Workstream | Wave |
|---|---|---|---|
| `00-conventions.md` | Stack, DB, ids, events, dates, errors, status vocabularies, UI bar, DoD | — | — |
| `01-identity-access.md` | Login (email/password now, Google later), sessions, invites, users, roles, permission matrix, field masking, project scoping | A | R0–R2 |
| `02-event-log.md` | Append-only event log, Appendix B taxonomy, audit views | A | R2 |
| `03-platform-deploy.md` | Postgres port, migrations, container, App Runner/RDS/S3, files port, mailer port, PDF renderer, CI | A | R0 |
| `04-canonical-model.md` | Portfolio, Project, hierarchy nodes, Unit, Booking, Customer, Applicant, product types | B | R2 |
| `05-journey-templates.md` | Journey/Stage/Task templates, versions, product overlays, Journey Template Studio | F | R2 |
| `06-timeline-sla-engine.md` | Journey instances, four-date model, SLA policies/clocks, calendars, delay reasons, status derivation | F | R2 |
| `07-unit-progress-control.md` | UnitProgressState, component hierarchy, bulk update + preview, freshness, source/actor | C | R3 |
| `08-changeability-engine.md` | ChangeCategory, ChangeGateRule, UnitChangeGate, five states, expiry forecast, exceptions, Sales read-only | C | R3 |
| `09-specification-revisions.md` | Specification baseline, drawing/spec revision control, superseded lock | C/H | R3 |
| `10-universal-action.md` | Action object, states, creation from handshakes, queues, evidence-to-close | G | R3 |
| `11-my-day-ranking.md` | My Day ranking, "Why now?", departmental queues | G | R3 |
| `12-escalations-notifications.md` | L0–L4 ladder, decision packs, notification rules, digest, pre-breach, quiet hours | G | R3 |
| `13-promise-ledger.md` | Commitments | L | R3 |
| `14-readiness-scores.md` | Unit / Customer-Booking / Handover readiness with drivers, trend, confidence | K | R3 |
| `15-qa-evidence-snags.md` | Checklists + evidence, site-declared vs QA-verified, snag lifecycle, SLA by severity, analytics | K | R3 |
| `16-handover-gates.md` | Eight gate dimensions, override with authority, appointment, digital handover checklist | K | R3 |
| `17-sales-crm-handover.md` | Packet, completeness, checklist by customer type, return taxonomy, FTR metric, actions on accept | E | R3 |
| `18-change-requests.md` | Change request lifecycle, line items, impact assessment, approval matrix, quotation, payment gate, execution, as-built, economics | H | R4 |
| `19-collections-true-risk.md` | Demand schedule, buckets, reason codes, PTP, receipts, waivers, TDS, financial clearance | I | R4 |
| `20-cash-forecast.md` | Forecast lines, snapshots, waterfall, scenarios, planner screens, portfolio comparison | I | R4 |
| `21-loans.md` | Loan cases, sanction/disbursement, validity, gap vs demand, lender contacts | I | R4 |
| `22-document-factory.md` | Templates, merge fields, clause library, selection rules, readiness panel, generation workflow, deviations, approvals, execution, archive, Studio | J | R4 |
| `23-registration.md` | Readiness checklist, SRO slot, hard pre-registration gate, day-of checklist, archive, forecast date | J | R4 |
| `24-sales-inventory-discovery.md` | Inventory changeability view, filters, compare, personalisation needs, requirement match, Change Window Hold, booking with applicants | D | R4 |
| `25-policy-studio.md` | Every configurable table, effective dating, change log, per-workstream tabs | Q | R4 |
| `26-customer-portal.md` | My Pranava Home areas, visibility rules, customer login/invite, moments that matter | O | R5 |
| `27-management-control-tower.md` | Five interventions, cash-flow views, KPI framework, exceptions, profitability | P | R5 |
| `28-360-views.md` | Customer / Unit / Booking 360, Project 360 header | R | R5 |
| `29-communications.md` | Omnichannel log, internal vs customer-visible, templates + approval, guardrails | M | R5 |
| `30-post-handover.md` | Move-in, DLP/warranty, Home Passport, service history, check-ins, advocacy | N | R5 |
| `31-intelligence.md` | Rule-based risk/next-action/collection/commitment scores; OpenAI text tasks behind `llm` port | S | R6 |
| `32-design-system.md` | `packages/ui`: tokens, Geist/Newsreader, spacing, colour, elevation, motion, primitives, Claude Design sync, migration | — (all) | R0–R1 |
