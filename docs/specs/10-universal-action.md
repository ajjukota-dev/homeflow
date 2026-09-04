# 10 — Universal Action

## Purpose
p8 §7: "Every actionable item — task, approval, follow-up, document request, exception, escalation — should normalize into one Action object." Fields (p8): id, type, title, source module, source entity, owner, backup owner, due date, priority, SLA policy, status, blocking reason, dependency, customer visibility, evidence requirement, escalation tier, auto-created vs manual. States (p8, App. A p41): **New, In Progress, Waiting Internal, Waiting Customer, Blocked, Ready for Approval, Closed, Cancelled**. "Evidence required for closure."

## Data
| Table | Columns |
|---|---|
| `action` | `id`, `code ACT-`, `type` (→ `action_type`), `title`, `description`, `project_id`, `source_module`, `source_entity_type`, `source_entity_id`, `booking_id`, `unit_id`, `customer_id`, `owner_user_id`, `owner_role` (fallback queue when no user), `backup_owner_user_id`, `due_at`, `priority ∈ {LOW, MEDIUM, HIGH, CRITICAL}`, `sla_clock_id` (06), `status`, `blocking_reason`, `depends_on_action_id`, `customer_visible bool`, `customer_title`, `evidence_requirement ∈ {NONE, ATTACHMENT, VERIFIED_ATTACHMENT, CHECKLIST, APPROVAL, EXTERNAL_REF}` **[E §2.2 execution types]**, `escalation_tier ∈ {L0..L4}`, `origin ∈ {AUTO, MANUAL}`, `created_by`, `closed_at`, `closed_by`, `close_note`, `impact jsonb` (revenue_inr, customer_count, dependency_count — for ranking, 11) |
| `action_type` | `code`, `family ∈ {TASK, APPROVAL, FOLLOW_UP, DOCUMENT_REQUEST, EXCEPTION, ESCALATION, VERIFICATION}`, `default_owner_role`, `default_priority`, `default_sla_policy_id`, `default_evidence_requirement`, `customer_visible_default`, `label`, `customer_label` — config |
| `action_checklist_item` | `action_id`, `label`, `required`, `checked_at`, `checked_by` |
| `action_evidence` | `action_id`, `file_id`, `kind`, `uploaded_by`, `verification_status ∈ {UPLOADED, VERIFIED, REJECTED}`, `verified_by`, `note` |
| `action_transition` | `action_id`, `from`, `to`, `at`, `actor`, `reason` |
| `departmental_queue` view | actions grouped by `owner_role`/department with counts by status and SLA state |

## Rules
1. Single creation path `createAction(ctx, {type, source, …})` applies `action_type` defaults, derives `project_id`, starts an SLA clock (06) when actionable, emits `action.created`. All handshakes call it (see Sources).
2. Sources (auto-created): task instances (06; the task row references the action), CRM acceptance → onboarding actions (17), demand due/overdue → collections follow-up (19), reason-code missing → "record reason" (19), commitment at risk → owner action (13), snag raised → QA/contractor action (15), gate stale → verify action (07), document requested/rejected → customer document request (22/17), approval needed → approval action (18, 19, 22), intervention → owner action (27), warranty case → FM action (30), escalation → tiered action (12).
3. Transitions: `NEW→IN_PROGRESS` (owner acts), `IN_PROGRESS↔WAITING_INTERNAL|WAITING_CUSTOMER` (reason required; SLA pause if policy allows), `→BLOCKED` (reason + `depends_on_action_id` or blocking entity), `→READY_FOR_APPROVAL` (approval family), `→CLOSED` (evidence rule satisfied), `→CANCELLED` (reason; MANAGEMENT/SUPER_ADMIN or creator while NEW). Every transition logged.
4. Close is refused (`gate_blocked`) unless the evidence requirement is met: `VERIFIED_ATTACHMENT` needs ≥1 evidence with `VERIFIED` by a user ≠ uploader **[E §3.2 "evidence not verified"; self-verify guard keyed on submitter]**; `CHECKLIST` needs all required items; `APPROVAL` needs an approval by `approver_role` ≠ actor **[E self-approve guard]**; `EXTERNAL_REF` needs a reference.
5. Actions with `owner_user_id` null sit in the role queue; first claimer becomes owner (`claim`). Reassign keeps history and is blocked while `READY_FOR_APPROVAL` **[E 🐛 fix: no reassign-then-verify]**.
6. `customer_visible` actions surface in the portal as "Action required from you" with `customer_title` only (p18 §11 "actions required from customer").
7. Closing a source entity (e.g. snag closed, payment received) auto-closes its open actions with `close_note = "Resolved by <event>"` — idempotent subscriber on events (02).
8. Priority never overrides SLA: ranking (11) uses both; a CRITICAL action with no due date gets the type's default SLA.

## API
`GET /actions?owner=me|role|user_id&status&project_id&due_before&type` · `GET /actions/:id` (with transitions, evidence, checklist, source link) · `POST /actions` (manual) · `POST /actions/:id/claim|start|wait|block|unblock|submit-approval|approve|reject|close|cancel|reassign` · `POST /actions/:id/evidence` (presigned) · `POST /actions/:id/evidence/:eid/verify|reject` · `PUT /actions/:id/checklist/:item` · `GET /queues/:role` · `GET/PUT /action-types` (Studio).

## Screens
- **Action detail** drawer (reused everywhere): title, why it exists (source entity link), owner/backup, due + SLA badge, status stepper, evidence panel with verify controls, checklist, blocking reason, history, customer-visible toggle (CRM/Management).
- **Departmental queues**: role tabs, counts by status/SLA, claim button, bulk reassign (Management).
- Actions appear inside every module screen as "Open actions" lists.

## Events
`action.created`, `action.status_changed`, `action.closed`, `action.cancelled`, `action.reassigned`, `action.evidence_verified`.

## Config
`action_type` (defaults), evidence requirement per type, approval roles — Policy Studio.

## Acceptance
p31 §26 "Every actionable record appears in the universal action engine with owner, SLA and evidence requirement" · Appendix A Action states exact · rule tests 1–8 · integration: each Source in rule 2 has a test asserting an action is created when its feature lands (registry test, grows per feature).

## Depends on / Feeds
Depends on 01, 02, 06 (clocks). Feeds 11, 12, 26, 27, every module.

## Files
`services/api/src/actions/**`, `services/api/migrations/0009_actions.sql`, `services/api/src/seed/action-types.ts`, `apps/workspace/src/components/ActionDrawer/**`, `apps/workspace/src/pages/Queues.tsx`, `apps/workspace/src/pages/studio/ActionTypes.tsx`.

## Not in this feature
Ranking (11), escalation ladder and notifications (12).
