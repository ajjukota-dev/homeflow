# 12 — Escalation ladder, decision packs & notifications

## Purpose
p22 §16: escalation tiers **L0 owner → L1 backup/peer → L2 department head → L3 cross-functional/project head → L4 management**, each with system-generated **decision packs** (what is blocked, since when, impact, options, recommended decision). p17 §8.13 Escalations module. p28 §23 Notifications: in-app default, daily digest, pre-breach alerts, quiet hours, materiality thresholds for management.

## Data
| Table | Columns |
|---|---|
| `escalation_ladder` | `id`, `code`, `steps jsonb` [{tier, after (duration or SLA state), to ∈ {BACKUP_OWNER, DEPT_HEAD, PROJECT_HEAD, MANAGEMENT}, notify_channel}], `effective_from/to` — attached to `sla_policy` (06) |
| `escalation` | `id`, `code ESC-`, `action_id`, `rule_key`, `tier`, `severity ∈ {LOW, MEDIUM, HIGH, CRITICAL}`, `category ∈ {CUSTOMER, CASH, HANDOVER, REPUTATION, MARGIN}` (p21 §14), `owner_user_id` (at this tier), `status ∈ {OPEN, ACKNOWLEDGED, IN_PROGRESS, RESOLVED, CLOSED, REOPENED}` **[E §11]**, `decision_pack jsonb`, `resolution_notes`, `raised_at`, `resolved_at`, `auto_closed bool`, unique `(rule_key, source_entity_id)` while open **[E idempotency]** |
| `escalation_rule` | `rule_key`, `severity`, `department`, `condition` (typed evaluator per source), `threshold_value`, `threshold_unit ∈ {DAYS, HOURS, INR}`, `category`, `effective_from/to` — seed **[E §11.1]** 13 rules (commitment 3d/7d, payment 15d/30d, TDS 5d, loan sanction 15d, sanction validity 7d, legal review 5d, registration slot 3d, critical snag 2d, handover 15d/7d, customer query 48h) + PDF materiality (₹ exposure, customer count) with placeholders marked `ASK_CLIENT` |
| `notification` | `id`, `user_id`, `type`, `title`, `body`, `entity_ref`, `read_at`, `created_at`, `channel ∈ {IN_APP, EMAIL}` |
| `notification_preference` | `user_id`, `digest_time` (default 08:30 IST), `quiet_hours` (21:00–08:00), `email_on ∈ {NONE, PRE_BREACH, ESCALATION, ALL}`, `mentions_email bool` |
| `materiality_threshold` | `scope ∈ {MANAGEMENT_ALERT, CONTROL_TOWER}`, `metric ∈ {INR_EXPOSURE, CUSTOMER_COUNT, DAYS_DELAY}`, `value` — Policy Studio (p28 §23) |

**Build reconciliation (2026-09-05, backend merged):** `escalation`'s `source_entity_id` is denormalized directly onto the table (not derived from `action_id` at read time) so `escalation_open_idx`'s unique-while-open index can key on `(rule_key, source_entity_id)` without a join. `escalation_rule.condition` (a "typed evaluator per source") became `source_module` (matched against `action.source_module`) + the existing `threshold_value`/`threshold_unit`/`decision_options` columns — a full typed-evaluator DSL was out of scope for what's actually reachable today (see below). Added `escalation_rule.wired boolean` (not in the spec's column list) — **all 13 seeded rows are `wired = false`**: exhaustively grepped every `createAction` call site in this codebase (`collections-sweep.ts`, `demands.ts`, `loans/sweep.ts`, `loans/core.ts`, `journey/instances.ts`) and confirmed none set `action.due_at` — the only real deadline anywhere in this codebase is `sla_clock.due_at`, reached via `action.sla_clock_id`, set only by `journey/instances.ts`. So `matchRule` (keyed on `source_module`) can never match any of the 13 named rules — only the generic SLA-ladder path (rule 1, journey-task actions) fires. All 13 rows still seed real `severity`/`category`/`decision_options`/threshold values so Policy Studio has real config to show once a rule's `wired` flips true (needs a `due_at` on the four non-journey call sites above — outside this spec's Files list). Ladder step hours (rule 1) and both materiality values (rule 4) are seeded `UNCONFIRMED`/`ASK_CLIENT` placeholders, same as this table already asks for — p22 gives no real numbers for either.

## Rules
1. Tiering is driven by the action's SLA clock (06): reaching a ladder step re-owns the escalation to the configured role, raises/updates the `escalation` row, creates a tier action (10), and notifies. L0 = SLA `DUE_SOON` pre-breach alert to owner; L1 at `OVERDUE`; L2/L3/L4 per ladder durations.
2. Decision pack (p22 §16) generated from data: `blocked_what` (action + entity), `since` (first SLA breach), `impact` (₹ from demands/commitments, customers affected, dependent actions), `options[]` (from the action type's configured options, e.g. "Waive late fee", "Reschedule with reason", "Escalate to vendor"), `recommended` (rule-based: the option that clears the block with least ₹ leakage), `owner_history`. Rendered in the escalation view and emailed in the digest.
3. Idempotent: an open escalation for the same `(rule_key, source_entity_id)` is updated, never duplicated **[E]**. Auto-close when the condition clears with `resolution_notes = "Auto-resolved: condition no longer met"` **[E]**; emits `escalation.resolved`.
4. Management sees only escalations above `materiality_threshold` (₹ exposure or customer count or days) — everything else stays with department heads (p28 §23 "materiality thresholds for management").
5. Notifications: every `action.created` for me, `action.reassigned` to me, `@mention`, `evidence.verification_requested`, `escalation.raised` to my tier, `commitment.at_risk` I own, `sla.due_soon` → in-app; email only per preference and never inside quiet hours (queued to next window); **daily digest** at `digest_time` via `mailer` summarising My Day counts + escalations + pre-breach items; no self-notify **[E §12]**.
6. Customer notifications are separate (26) and never triggered from here.
7. Never auto-send consequential customer communication from AI (p32 §27).

## API
`GET /escalations?tier&status&category&project_id` · `GET /escalations/:id` (pack) · `POST /escalations/:id/acknowledge|start|resolve|close|reopen` · `POST /escalations/scan` (job; also cron) · `GET /notifications?unread` · `POST /notifications/:id/read` · `GET/PUT /me/notification-preferences` · `GET/PUT /escalation-rules`, `/escalation-ladders`, `/materiality-thresholds` (Studio).

## Screens
- **Escalations** (workspace): list by tier with severity/category chips, age, owner; detail with decision pack (facts first, options as buttons that open the underlying action), resolution notes.
- **Notification bell** + panel; preferences page (digest time, quiet hours, email level).
- Digest email template (plain, brand-neutral, links to the URL).
- Studio tabs: Escalation rules, Ladders, Materiality thresholds.

## Events
`escalation.raised`, `escalation.tier_changed`, `escalation.resolved`, `escalation.closed`, `notification.sent`, `digest.sent`.

## Config
All of the above tables (p26–27 §21 "escalation routing + management thresholds", p28 §23).

## Acceptance
p22 §16 tier ladder + decision pack contents (test: pack has all six keys with values) · p28 §23 digest/pre-breach/quiet hours (clock-injected tests) · rule tests 1–6 · seed test: 13 [E] rules load and one fires on seeded overdue data.

## Depends on / Feeds
Depends on 10, 06, 01, 03 (mailer). Feeds 27 (Control Tower reads material escalations), 13 (pre-breach for commitments).

## Files
`services/api/src/escalations/**`, `services/api/src/notifications/**`, `services/api/migrations/0027_escalations.sql` (spec names `0010_escalations.sql`, renumbered to sort after its real dependencies — 10/06/01/03 plus 19/21/25 for `sla_policy`/RLS/policy-studio compatibility), `services/api/src/seed/escalation-rules.ts`, `apps/workspace/src/pages/Escalations*.tsx`, `apps/workspace/src/components/NotificationBell.tsx`, `apps/workspace/src/pages/Preferences.tsx`, Studio tabs. **Backend merged this segment; the four `apps/workspace` UI files (Escalations pages, NotificationBell, Preferences page) and Studio tabs are deferred**, same reasoning as every other R2/R3 Studio/dashboard UI so far.

## Not in this feature
Customer-facing messages (26, 29). Control Tower ranking (27).

## Build note (2026-09-06) — Policy Studio tabs
`12.escalation_rules`, `12.ladders`, `12.materiality_thresholds` registered against `escalation_rule`/`escalation_ladder`/`materiality_threshold` in the generic draft/publish/history envelope — zero new frontend code, same shape as `10.action_types`. `12.notification_defaults` stays `built: false`: `notification_preference` is keyed per-user, not a global-defaults table a Studio tab could meaningfully CRUD. Full detail (the cross-spec batch this shipped in, plus a real `GenericTableEditor` bug found and fixed while verifying it live) is in `TODO.md` §9 and `docs/demo/run-log.md`'s 2026-09-06 "Studio registry-only batch" entry.
