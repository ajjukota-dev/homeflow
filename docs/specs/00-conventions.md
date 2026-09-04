# Workstream specs — the build contract

One file per workstream in `TODO.md §4` (A–S). Each is written so an agent can build it **without asking**: data model, rules, API, screens, acceptance tests, dependencies, what not to build. Requirement authority is the client PDF (`docs/Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf`, cited as `pNN §X`). Seed values marked **[E]** come from `docs/reference/emergent-business-rules.md` — Pranava's own decisions as encoded in their earlier app; they are editable defaults in Policy Studio, never code constants. Anything marked **[ours]** is an engineering choice.

`docs/spec/**` and `docs/HOMEFLOW-OS.md` are legacy (AI-derived, unreviewed). Where these files and those disagree, these win.

## Conventions every workstream follows

| Topic | Rule |
|---|---|
| Stack | TypeScript strict, Express handlers Express-free (plain `(input, ctx) => result`), React + Vite + Tailwind tokens, Vitest, Playwright. No `any` without a comment saying why. Files ≤ 200 lines. |
| Database | PostgreSQL. Local dev: PGlite persisted to `./.data/pglite` **[ours]**; tests: PGlite in-memory, one DB per test file; prod: RDS via `pg`. One `db` port (`query(sql, params)`), SQL migrations in `services/api/migrations/NNNN_name.sql`, applied by `npm run migrate` and on API boot. Field names `snake_case`. Money `numeric(14,2)` INR. Times `timestamptz`; calendar dates `date`. |
| Identity | Every table that belongs to a project carries `project_id` **derived** from Unit/Booking, never user-supplied (p36 §31.1). Every write goes through `ctx.actor` (user id + roles + authorized project ids). |
| Codes | Human ids `PREFIX-000001` from a per-prefix sequence **[E]**: `CUS-`, `BKG-`, `UNT-`, `ACT-`, `CMT-` (commitment), `COM-` (communication), `CR-` (change request), `SNG-`, `ESC-`, `DOC-`, `REG-`, `LN-`, `HO-`. |
| Events | Every consequential mutation appends to `event` (workstream A) with the Appendix B taxonomy (p42). Append-only. No hard deletes of financial/legal/commitment/spec history — `status = 'cancelled'` + reason. |
| Dates | "Today" = IST calendar day via one `todayIst()`; project working-day calendar (F) for SLA math. Never `new Date().toISOString().slice(0,10)`. |
| Errors | `{ code, message, field?, source_ref? }`. `validation` → 400, `forbidden` → 403, `not_found` → 404 (also for rows outside the actor's project scope **[E]**), `conflict` → 409, `gate_blocked` → 422 with `blockers[]`. |
| Status vocabularies | Appendix A (p41–42) verbatim for Action, Change Request, Commitment, Document, Snag, Handover. `SCREAMING_SNAKE` in code (`HARD_CLOSED`), human labels via `apps/workspace/src/lib/labels.ts`. |
| Config over code | Anything the PDF lists in §21 Policy Studio (p26–27) is a table with `effective_from/effective_to`, `version`, `changed_by`, never a constant. Seed via `services/api/src/seed/*.ts`, one file per config family. East Crest values live only in `seed/demo-east-crest.ts`. |
| UI | Design tokens only; loading/empty/error states on every list; WCAG AA; screenshots at 1440/768/375 reviewed before merge; no purple/indigo, no glass, no filler text. One `h1` per page. |
| Explainability | Every score/flag exposes `value, trend, drivers[3], confidence, actions[]` (p8 §6). No number without a "why". |
| Product awareness | `product_type ∈ {APARTMENT, VILLA, PLOT}` on Project (default for units) and Unit; templates, change categories, checklists and readiness components are keyed by product type. Plots have no interior components. |

## Definition of done (per PR)

1. Failing test first for every rule below the "Rules" heading; `npm test` green in `services/api`, `apps/workspace`, `apps/my-pranava-home`; `tsc` 0 errors everywhere.
2. Acceptance tests listed in the workstream file exist as automated tests, named after their PDF reference (e.g. `p35-30.5-t4`).
3. Playwright screenshots of every new/changed screen at 3 breakpoints committed under `e2e/__screenshots__/` and looked at.
4. Migration is additive and applied on boot; seed updated; demo data still loads.
5. Events emitted and asserted for every mutation named in the workstream's Events list.
6. `TODO.md` updated: workstream status, anything found while building, new client questions.

## Files

| File | Workstream | Wave |
|---|---|---|
| `A-platform.md` | Identity, roles, project scoping, event log, persistence, deploy, notifications transport | 1 |
| `B-canonical-model.md` | Portfolio → Project → Hierarchy → Unit → Booking → Customer/Applicant | 1 |
| `F-journey-sla.md` | Journey templates, universal timeline, SLA engine, calendars | 1 |
| `C-unit-twin-changeability.md` | Unit progress control, changeability engine, freshness, revisions | 2 |
| `G-actions-myday.md` | Universal Action, My Day, escalation ladder, notifications, digest | 2 |
| `L-promise-ledger.md` | Commitments | 2 |
| `K-readiness-qa-handover.md` | Readiness scores, QA evidence, snags, handover gates | 2 |
| `E-sales-crm-handover.md` | Sales → CRM quality gate | 2 |
| `H-change-requests.md` | Customer change requests & customisation | 3 |
| `I-collections-forecast.md` | Collections, cash forecast, loans, TDS, clearance | 3 |
| `J-document-factory-registration.md` | Legal Document Factory, registration | 3 |
| `Q-policy-studio.md` | Configuration surfaces | 3 (tabs land with each workstream) |
| `D-sales-inventory.md` | Inventory changeability view, discovery, holds, booking | 3 |
| `O-customer-portal.md` | My Pranava Home | 4 |
| `P-management.md` | Control Tower, cash-flow views, KPIs, exceptions, profitability | 4 |
| `R-360s.md` | Customer / Unit / Booking 360, Project 360 header | 4 |
| `M-communications.md` | Omnichannel log, templates, guardrails | 4 |
| `N-post-handover.md` | DLP/warranty, Home Passport, check-ins, advocacy | 4 |
| `S-intelligence.md` | Rule-based intelligence, OpenAI-backed text tasks | 5 |
