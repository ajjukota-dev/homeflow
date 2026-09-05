# HomeFlow — open items (audit 2026-09-04)

Baseline from a fresh clone: API tests 78/78 pass · `tsc` + `vite build` clean for both apps · CDK synth OK · workspace Playwright 13/13 · customer Playwright 2/2 · screenshots at 1440/768/375/320 look professional, no console errors.

Everything below was found by reading the spec + code and by hitting the running app/API. Ordered by severity; tick as we go.

---

## A · Bugs (found by testing — fix first)

| # | Item | Evidence | Where |
|---|---|---|---|
| A1 | **A single GET kills the whole API process.** `/control-tower` is the only GET that writes, so it is the only one that crashes today — but **all 18 GET routes are unguarded**, so any future write or constraint on a read path becomes a second kill switch. Six other project routes return `200 {data:[]}` for a project that doesn't exist (silently wrong, not an error). Malformed JSON returns an HTML stack trace with local file paths. | `GET /api/projects/nope/control-tower` → FK 23503 → unhandled rejection → Node exits. Reproduced 5 Sep 2026, both apps offline. Walkthrough: https://claude.ai/code/artifact/9fe008d7-65d3-4c09-ad6e-060189fe8efa | `server.ts`, `routes-lifecycle.ts:108`, `tower-view.ts:116` |
| A2 | **Receipt with non-numeric amount is accepted and corrupts the demand** (`amount=null`, `remaining=null`, status `part_paid`). `NaN <= 0` and `NaN > remaining` are both false. | `POST /demands/:id/receipt {"amount":"abc"}` → 200 | `demands.ts postReceipt` |
| A3 | **An active booking can be "returned"**; unit flips to `available` while customer, demands, receipts, docs still hang off it. No status guard. | `POST /bookings/b_v111/return` → `returned`, V111 `available` | `bookings.ts returnBooking` |
| A4 | **Physical progress can be regressed on a handed-over unit with no reason/audit**, and a `HARD_CLOSED` structural gate silently reopens to `OPEN`. Spec: reopening needs authorized correction + reason + audit; HARD_CLOSED never reopens by ordinary path. | `PUT /units/u_v113/progress structure=not_started` → structural `OPEN` | `handlers.ts setProgress` |
| A5 | **Customer portal "me" flips to whoever booked last.** `ORDER BY booking_number` — after the e2e suite books V101, `/api/me/home` shows Anita Sharma, not Karthik. | confirmed after running e2e | `customer.ts firstActiveBooking` |
| A6 | **`/api/me/home?booking_id=` returns any booking** — IDOR; no auth at all today. | `?booking_id=b_v111` → Meera's home | `server.ts` |
| A7 | **Customer T2 "why now" lies**: V110 "Flooring laid" is overdue but flooring is `not_started`; customer reads "Your flooring is complete — this milestone is now due." Copy derives from status, not from actual progress. Seed is also inconsistent (demand raised before trigger). | `/api/me/home` payments | `collections.ts whyNow`, `seed.ts` |
| A8 | **New bookings stamp `due_date = today` on every scheduled demand** (H3 setup). Customer sees "Upcoming" milestones all dated today; ageing math will be wrong the moment they become due. | Anita's demands all `2026-09-04` | `demands.ts setupFunding` |
| A9 | `npm test` at root **fails**: workspace Vitest picks up `e2e/visual.spec.ts` (Playwright `test()`), 1 file fails. HANDOFF says "hangs" — it actually fails. Needs `exclude: ["e2e/**"]` in vite test config. | `npm --prefix apps/workspace test` | `apps/workspace/vite.config.ts` |
| A10 | Check-in satisfaction score unvalidated (`99` accepted); `POST /checkins/nope/capture` returns `200 {}`. | probes | `warranty.ts` |
| A11 | Unknown component code in progress update is silently a no-op 200. | `component_code: roof` | `db.ts setState` |
| A12 | `POST /projects/:id/units` without `unit_type`/`facing` → 400 with `Cannot read properties of undefined (reading 'trim')` (crash message leaked, not a structured error). Duplicate project `code` allowed (no unique constraint). Duplicate unit_number per project allowed. | probes | `projects.ts`, `schema.ts` |
| A13 | Malformed JSON body returns Express default **HTML stack trace with local file paths**. No error middleware. | `-d '{bad'` | `server.ts` |
| A14 | PTP with missing/invalid date surfaces raw Postgres error text to the client. | probes | `demands.ts recordPtp` |
| A15 | Customer portal has **horizontal overflow at 320px** (RERA number doesn't wrap). | screenshot `cust-320` | `HomeExtras.tsx` |
| A16 | Workspace mobile header (≤375): "HomeFlow" wordmark collides with the scrolling nav chips. | screenshots `ws-*-375` | `App.tsx` |
| A17 | CRM queue + customers list are **not project-scoped** (no `projectId` prop; `/api/bookings`, `/api/customers` have no project filter). Switching to West Park still shows East Crest customers. | `CrmQueue.tsx`, `bookings.ts` | spec data-model §4 |
| A18 | `commitments` handover gate is hard-coded to pass (`commitments_clear` never supplied) — no Promise Ledger exists yet. | `qa.ts handoverForBooking` | gates.md B |
| A19 | Intervention `Act` only flips a status flag; creates no Action, no owner assignment, no event. Acting twice is silently OK. | `tower-view.ts actIntervention` | H11 |
| A20 | Raw enum strings leak into staff UI: `Handed_over` chip (Sales), `financial · open` gate chips (QA), `readiness in progress` etc. Need labels. | screenshots | `SalesInventory.tsx`, `QaHandover.tsx` |
| A21 | Customer hero uses arbitrary hex gradient `from-[#e7ddd0] to-[#cdd6cb]` — banned by CLAUDE.md (tokens only, no gradients). Customer app also has no dark-mode path. | `Home.tsx:31` | design-language |

---

## B · Foundation gaps (spec MUSTs with zero implementation)

| # | Item | Spec |
|---|---|---|
| B1 | **No event log at all.** No `event` table, nothing emits `booking.handover.accepted`, `unit.gate.changed`, `receipt.posted`, … "Event-sourced audit" is principle #1 in CLAUDE.md. | event-log.md, Appendix B |
| B2 | **No Universal Action object / My Day.** No `action` table; handshakes create no receiving Action; no SLA ladder L0–L4. | universal-action.md |
| B3 | **No authentication / authorization.** API wide open; no Cognito, no JWT claims, no RLS by `project_id`. Google Sign-In (Rambabu) is the #1 handoff ask. | architecture §3/§7, HANDOFF 4.1 |
| B4 | **No durable database.** In-memory PGlite; restart wipes everything. No migrations. | HANDOFF 4.2 |
| B5 | **No Journey / SLA engine.** No `JourneyTemplate`, `JourneyInstance`, `SlaPolicy`, baseline/current/forecast/actual dates. East Crest stage names exist only implicitly. | architecture §5, §34 |
| B6 | **No Policy Studio.** Gate rules, payment plans, handover policy, templates are seed SQL, not editable config. | §21 |
| B7 | **No Change Request / customisation workflow** (H5/H6): no CR entity, feasibility, quote, payment gate, as-built revision. Customer "Make it yours" is display-only. | §8.7, §30 |
| B8 | **No freshness / "Verification Required"** on unit progress (`updated_at` exists but is never surfaced or thresholded). | §30.3, gates key #3 |
| B9 | **No Promise Ledger / commitments**, no pre-breach alerts. | §8.11, customer-twin §2.5 |
| B10 | **No H10 visibility filter / customer update approval queue**; portal reads live projections directly. | handshakes H10, crm-rm screen F |
| B11 | **No collections forecasting** — snapshots, `CollectionForecastLine`, actual-vs-forecast, cash-flow planner. (P0 in roadmap.) | §31, accounts AT 4–8 |
| B12 | **No handover override path** in API/UI (`applyOverride` exists as a pure fn but is never called). | gates B.4, mgmt AT 5 |
| B13 | **No file/evidence upload** (S3 signed URLs); QA evidence is a free-text note. | §8.8 |
| B14 | **No notifications** (digest, pre-breach, quiet hours). | §23 |
| B15 | **No OpenAPI / `/api/v1` versioning**; no `{data, meta, errors}` envelope consistency; no pagination. | architecture §4 |
| B16 | **No `packages/`** (shared UI/types duplicated: `cn`, `formatINR`, tokens, css exist in both apps). | CLAUDE.md repo structure |
| B17 | **No local mirror**: no `docker-compose.yml`, no `Makefile`/`make dev`, no LocalStack, no `.env.example`. | architecture §6b, build-conventions §1 |
| B18 | **No CI**, no ESLint config (`npm run lint` is declared but there is no eslint config or dependency). | CLAUDE.md DoD |
| B19 | Lambda is a stub (`infra/lambda/index.mjs`); no bundler, no Cognito authorizer, no SPA hosting, CORS `*`, `DESTROY` policies everywhere. Never deployed. | HANDOFF 4.2 |
| B20 | Demo seed and config seed are one function — demo cast would ship to prod. | HANDOFF §3 |

---

## C · Role slices — acceptance tests not yet met

Per `docs/spec/roles/*/spec.md` Part 4. ✅ = passes today.

**project-site** — ✅1 ✅2 ✅4 ✅7(UI only, not API) · ❌3 bulk update + preview + unit exception · ❌5 stale → Verification Required · ❌6 progress correction audit (actor/prior/new/reason) · ❌8 HARD_CLOSED reopen guard (A4) · ❌9 CR revision release

**sales** — ✅7 ✅8 · ❌1 filters + compare ≥3 units · ❌2 personalisation discovery / requirement-to-unit match · ❌3 gate expiry forecast · ❌4 (no API-level enforcement, only UI) · ❌5 Change Window Hold · ❌6 prospect CR

**crm-rm** — ✅1(partly: return reason is free text, not taxonomy; no Sales action reopened) ✅4 · ❌2 journey + onboarding actions on accept · ❌3 commitments · ❌5 H10 approval preview · ❌6 customer merge · ❌7 pre-breach · ❌8 My Day. Customer 360 has no tabs (Journey/Payments/Docs/Commitments/Comms/Experience).

**accounts** — ✅1 ✅2 ✅3 ✅9 · ❌4–8 all forecasting/loans/snapshots/scenarios. Loans screen missing. Overdue reason can only be set via API (no UI).

**legal** — ✅2 ✅3 ✅7(partly) ✅10 · ❌1 template selection by project/property/transaction (only AOS, one template) · ❌4 v2 regeneration + compare · ❌5 clause library / locked clauses / deviations · ❌6 Sale Deed pre-reqs · ❌8 retired template · ❌9 lease. No document preview/workspace screen; SRO reference hard-coded `SRO/BNG/2026/LOCAL` in UI.

**qa** — ✅1 ✅3 ✅4(partly, no override) ✅7 ✅8 · ❌2 site-declaration vs QA-verification as separate states · ❌5 before/after evidence is auto-filled canned text in UI · ❌6 repeat-defect analytics. No snag creation UI.

**post-handover** — ✅1 ✅2 ✅3(partly, chargeable = ₹1 placeholder) · ❌4 root-cause → QA analytics · ❌5 check-in feeds Customer Health · ❌6 customer can't raise a service request. No warranty case creation UI.

**customer** — ✅4(A7 aside) ✅5 ✅7 ✅8 · ❌1/2 no auth/RLS (A5, A6) · ❌3 stage advance is from `complete`, spec says verified · ❌6 raise CR. Only screens A/C/D/I/J exist; no Journey/Documents/Requests/Registration/Handover tabs, no bottom tab bar.

**management** — ✅1 ✅2 ✅6 · ❌3 drill-down · ❌4 cash-flow views · ❌5 override · ❌7 KPI explorer. Intervention owner "Priya Nair" hard-coded in `tower-view.ts`; RM hard-coded in `acceptBooking`.

---

## D · Hygiene

- D1 `HANDOFF.md` test note is wrong (see A9); README says spec canvas is for Cursor — fine, but `canvases/` is 129 KB of Cursor-only TSX in the repo.
- D2 Five files >200 lines (`SiteProgress.tsx`, `demands.ts`, `legal-docs.ts`, `qa.ts`, `schema.ts`) vs CLAUDE.md rule.
- D3 Sales cards show a placeholder icon where spec wants a unit photo.
- D4 Customer app lacks `data-theme`/prefers-color-scheme handling.
- D5 Root `package.json` has no `dev` for the customer app, no `test:e2e` for it, no `lint`.

---

## E · Task split

See [TASKS.md](TASKS.md) — plain-language task lists for Vivek and Amarsh.
