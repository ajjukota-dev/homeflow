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
01 Permission matrix, Field sensitivity, Teams & assignments · 04 Project master, Hierarchy, Unit types, Applicant limits · 05 Journey Template Studio · 06 SLA policies, Calendars, Delay reasons · 07 Progress components, Freshness thresholds · 08 Change categories, Change Gate Rule Studio, Gate-expiry sources · 09 Specification baselines, Variation catalogue · 10 Action types · 11 Ranking weights · 12 Escalation rules, Ladders, Materiality thresholds, Notification defaults · 13 Commitment approvers/leads · 14 Score weights & thresholds · 15 QA checklist templates, Snag SLA, Contractors · 16 Handover gate configuration, Handover checklist · 17 Sales handover checklist rules, Return reasons · 18 Customisation policy · 19 Payment plans, Overdue reasons, Clearance checklist/threshold · 20 Probability rules, Cash targets, Period calendar · 22 Templates, Clauses, Selection rules, Merge fields, Document checklist rules · 23 Registration checklists, SRO offices · 24 Hold policy, Filter thresholds · 25 Approval authority matrix, Config export/import · 26 Customer visibility & wording · 29 Communication templates, Frequency guardrails · 30 DLP/warranty policy, Check-in schedule.

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
