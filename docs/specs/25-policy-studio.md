# 25 — Policy Studio (configuration surfaces)

## Purpose
p26–27 §21: every configurable thing, as data, with effective dating and a change log; "Never hard-code East Crest values" (CLAUDE.md; p47 §35). Each feature lands its own tab; this spec defines the shell, the versioning contract, the approval-authority matrix used by 17/18/19/22, and the tabs no other spec owns.

## Data
| Table | Columns |
|---|---|
| `policy_version` (generic envelope, optional per table) | `table_name`, `row_id`, `version`, `effective_from`, `effective_to`, `changed_by`, `changed_at`, `change_note`, `diff jsonb` |
| `approval_authority_rule` | `id`, `domain ∈ {DISCOUNT, BROKERAGE, WAIVER, CHANGE_REQUEST, COMMITMENT, DOCUMENT_DEVIATION, GATE_OVERRIDE, HOLD, PLAN_REVISION}`, `metric ∈ {INR, PCT, DAYS, BOOL}`, `min`, `max`, `approver_role`, `second_approver_role?`, `project_id?`, `effective_from/to`, `version` — the single approval matrix (p26 §21 "approval authority matrix", "variation approval matrix") |
| `communication_template` | owned by 29 but edited here |
| `project_master` fields, `hierarchy`, `team assignments` | owned by 04/01, edited here |

## Rules
1. Every Studio table exposes: current effective rows, drafts, history (who/when/why), and "effective from" scheduling; publishing writes `policy.changed` (02) and triggers dependent re-evaluation (08 rules, 06 SLA, 14 weights).
2. Approval matrix lookup `requiredApprovers(domain, metric_value, project)` is one function used by 17 (discount/brokerage), 18 (CR value/margin/schedule/freeze), 19 (waivers), 22 (deviations), 16 (gate override approvals), 24 (holds), 06 (plan revisions). Returns roles; the requester can never be an approver; second approver where configured.
3. Access: `SUPER_ADMIN` edits everything; `MANAGEMENT` edits business policy (matrix, thresholds, weights, templates approval); department leads edit their own tabs (Legal → templates/clauses, Accounts → payment plans/reasons, Projects → components/gate rules, CRM → checklists/return reasons, QA → checklist templates); everyone else read-only.
4. Simulation: tabs that affect derived state (gate rules, score weights, SLA, matrix) offer "Preview impact" (dry-run over live data: how many units/actions change) before publish.
5. Product awareness: every template/config row carries `product_types[]`; PLOT-specific defaults are seeded (no interior components, registration-centric journey).
6. Export/import of a project's full configuration as JSON (for cloning a new project from a template project) **[ours]**.

## Tabs (owner spec → tab)
01 Permission matrix, Field sensitivity, Teams & assignments · 04 Project master, Hierarchy, Unit types, Applicant limits · 05 Journey Template Studio · 06 SLA policies, Calendars, Delay reasons · 07 Progress components, Freshness thresholds · 08 Change categories, Change Gate Rule Studio, Gate-expiry sources · 09 Specification baselines, Variation catalogue · 10 Action types · 11 Ranking weights · 12 Escalation rules, Ladders, Materiality thresholds, Notification defaults · 13 Commitment approvers/leads · 14 Score weights & thresholds · 15 QA checklist templates, Snag SLA, Contractors · 16 Handover gate configuration, Handover checklist · 17 Sales handover checklist rules, Return reasons · 18 Variation approval matrix, Customisation policy · 19 Payment plans, Overdue reasons, Clearance checklist/threshold · 20 Probability rules, Cash targets, Period calendar · 22 Templates, Clauses, Selection rules, Merge fields, Document checklist rules · 23 Registration checklists, SRO offices · 24 Hold policy, Filter thresholds · 25 Approval authority matrix, Config export/import · 26 Customer visibility & wording · 29 Communication templates, Frequency guardrails · 30 DLP/warranty policy, Check-in schedule · 31 Risk rules, LLM budget.

## API
`GET /studio/tabs` (per role) · generic `GET /studio/:table?effective_on`, `POST /studio/:table` (draft), `POST /studio/:table/:id/publish {effective_from, note}`, `GET /studio/:table/:id/history` · `POST /studio/:table/preview` · `GET/PUT /approval-authority-rules` · `GET /projects/:id/config/export`, `POST /projects/:id/config/import`.

## Screens
Studio shell: left nav grouped by domain; each tab = table with effective badge, draft/publish flow, history drawer with diffs, preview-impact panel; consistent editors (DSL fields validate live). Not chart-heavy; forms and tables.

## Events
`policy.changed` (table, row, version, by, note).

## Acceptance
p26–27 §21 list: every bullet maps to a tab (checklist test in this spec's test file asserts the tab registry contains each) · p47 §34.7 t1, t2 (via 05) · rule tests 1–6 · East Crest grep test: no East Crest literal (durations, charges, stage names) outside `seed/demo-east-crest.ts`.

## Depends on / Feeds
Depends on 01, 02. Every spec lands a tab here.

## Files
`services/api/src/studio/**`, `services/api/src/approvals/matrix.ts`, `services/api/migrations/0023_policy.sql`, `apps/workspace/src/pages/studio/Shell*.tsx`, `apps/workspace/src/pages/studio/generic/**`, tab files owned by their specs.

## Not in this feature
Content of the individual tabs (owned by their specs).

## Build note (2026-09-06) — UI shell + generic table editor

**Scope.** `apps/workspace/src/pages/studio/{Shell,GenericTableEditor,RowEditor,HistoryDrawer,api,registry}.tsx` — left nav grouped by owning spec (from the real `GET /studio/tabs`), and a real, working add/edit/publish/history flow for the 10 tables the backend's generic `/studio/:table` envelope already covers (`services/api/src/studio/core.ts::TABLE_REGISTRY`: `project_calendar`, `delay_reason`, `action_type`, `probability_rule`, `cash_target`, `period_calendar`, `customer_visibility_rule`, `frequency_guardrail`, `dlp_policy`, `risk_rule`). Wired into the workspace shell as a new "Policy Studio" nav entry, visible to every staff role (rule 3's read-any-staff-role), matching `NAV`'s existing role-filter pattern.

**Column shape has no live introspection endpoint** — `listStudioTable` returns bare rows, no metadata — so `pages/studio/registry.ts` hand-mirrors the 10 table definitions (primaryKey, columns, json/array columns) from the backend's own `TABLE_REGISTRY`. Flagged as duplication to keep in sync if that registry changes, same class of frontend/backend type duplication already accepted elsewhere in this app (e.g. `GateState`/`ProgressState` in `api.ts`).

**The other 22 tabs (bespoke-owned routes, or not built at all)** get an honest `EmptyState` — "has its own dedicated screen elsewhere" for tabs with real routes outside the generic envelope (permission matrix, journey templates, change-gate-rule studio, document factory, etc.), or "not built" matching the tab registry's own `built: false` flag. No bespoke UI was attempted for any of these in this slice — each is real, separately-scoped future work (~15 more tab UIs), not faked here.

**Real bugs found and fixed during Playwright review** (screenshotted and functionally exercised at 1440/768/375 against the live dev API, not just typechecked): (a) an empty optional field (e.g. `risk_rule.effective_to`) submitted as the literal string `""` instead of `null`, and Postgres rejects `""` for a typed column ("invalid input syntax for type date") — fixed `RowEditor.tsx::fromFieldValue` to map any blank field to `null`; (b) at exactly the 768px breakpoint, Studio's own nav+content split competed with the app's own 16rem sidebar for a 3rd column and squeezed the content pane unreadably — the split now activates at `lg` (1024px) rather than `md` (768px), confirmed by re-screenshotting; (c) risk_rule/probability_rule carry their own `effective_from` business column AND go through the generic envelope's separate `policy_version.effective_from` (the publish/schedule date) — the same word meaning two different things in one form was confusing in review, so the publish-date field is labelled "Publish date" instead of "Effective from" to disambiguate; the row's own column still renders under its real name like any other field.

**Also found, not fixed (out of scope for this slice):** a stale background API dev-process force-killed during this session's own screenshot testing corrupted its PGlite lock file, triggering the exact `_pg_initdb` WASM abort already documented in TODO.md §9 — this directly exercised (and validated) the `npm run db:reset` script added earlier the same day in the e2e-isolation-prep PR (#52).

**Also found via advisor review, fixed:** (d) `Shell.tsx`'s own nav title was a second `<h1>` alongside `GenericTableEditor`'s `PageHeader` — CLAUDE.md's "one h1 per page" — changed to `h2`, with a `Shell.test.tsx` assertion (`getAllByRole("heading", {level: 1})` has length 1); (e) `fromFieldValue`'s blank→empty mapping for array/json columns was `[]`/`{}`, but several of these tables use a nullable `product_types text[]` column where NULL means "applies to every product type" (`studio/core.ts`) — editing any unrelated field on an existing row (nearly all seeded rows have `product_types` unset) silently narrowed that to "applies to none" with no error. Blank now maps to `null` for every column, array/json included, same as the plain-column fix; a NOT NULL column then surfaces a real save error instead of silently accepting the wrong value. The accompanying code comment was also corrected — it previously asserted "every table here has these as nullable columns" without checking the DDL; several plain columns (e.g. `delay_reason.label`, `action_type.family`) are in fact `NOT NULL`, so blanking them now fails loud at publish, which is the correct behaviour, not a bug.

**Test coverage:** `GenericTableEditor.test.tsx` — loading/empty/error states with a mocked fetch (3 tests, matches CLAUDE.md's "every list has loading/empty/error states" DoD item as actual assertions, not just visual review); `Shell.test.tsx` — one h1 per page. No test exercises the full draft→publish round trip against a real DB (that was verified manually via Playwright screenshots against the live dev stack instead, documented above, and covered edit+publish only, not add-row — narrowing that earlier claim) — flagged as a real coverage gap, not faked as covered.

**Full e2e suite** (`workers: 1`, fresh `db:reset` seed): 72/73 passed — the one failure (`visual.spec.ts:138`, stale "Promise Ledger not yet built" copy assertion) is pre-existing and unrelated, reproduced identically before any change in this slice.
