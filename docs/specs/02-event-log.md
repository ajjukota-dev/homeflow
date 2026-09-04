# 02 — Event log & audit

## Purpose
"Immutable event/audit log for consequential changes" (p27 §22). "Critical workflows and edits have a complete audit trail" (p31 §26). Appendix B (p42) is the minimum event list. Events are also the propagation mechanism: progress changes re-evaluate gates (p34 §30.3), payments update readiness, etc.

## Data
| Table | Columns |
|---|---|
| `event` | `id bigserial`, `occurred_at timestamptz`, `type text` (Appendix B name, dotted), `project_id`, `entity_type`, `entity_id`, `booking_id`, `unit_id`, `customer_id` (nullable denormalised keys for filtering), `actor_user_id` (null = system), `actor_kind ∈ {USER, SYSTEM, CUSTOMER}`, `payload jsonb` (before/after or the fact), `source_ref` (screen/handler), `correlation_id` |
Append-only: no `UPDATE`/`DELETE` grants on `event` for the app role; a trigger rejects them in dev too.

## Appendix B taxonomy (p42) → `type`
`booking.created` · `sales_handover.submitted / returned / accepted` · `document.requested / received / validated / rejected` · `demand.raised` · `payment.received / reconciled` · `loan.sanction_received / disbursement_received` · `agreement.generated / executed` · `registration.scheduled / completed` · `progress.updated` · `qa.inspection_passed / inspection_failed` · `snag.opened / closed` · `commitment.created / status_changed` · `escalation.raised / resolved` · `handover.scheduled / completed` · `warranty.case_opened / case_closed` · `customer_contact.sent / response_received`. Extend with `action.*`, `change_request.*`, `gate.*`, `hold.*`, `forecast.snapshot_taken`, `template.version_published`, `auth.*`, `access.*`, `policy.changed`. Names are data in `event_type` (name, family, customer_visible bool) so the portal's timeline and notifications can subscribe by family.

## Rules
1. `ctx.events.append(e)` runs in the same DB transaction as the mutation; a failed append fails the mutation.
2. Every handler listed in a spec's **Events** section must emit; tests assert the emitted type and payload keys.
3. `payload` never contains masked fields for the reader — audit views apply `mask()` from 01 on render, not on write.
4. In-process subscribers (`onEvent(type, handler)`) implement propagation (gate re-evaluation, readiness recompute, action creation). Subscribers are idempotent and run after commit; failures are logged to `event_delivery_failure` and retried by a job — never swallowed.
5. Audit views answer: who changed what, when, from where, before/after — for Booking, Unit, Customer, Document, Commitment, Change Request, Gate override.

## API
`GET /audit?entity_type&entity_id&from&to` (paged, masked) · `GET /events/stream?since_id` (internal, for the portal timeline projection).

## Screens
Workspace: an "Activity" tab on Booking 360, Unit 360, Customer 360 (spec 28) rendering events in plain language via `labels.ts`. Filter by family. Empty/loading/error states.

## Acceptance
p31 §26 audit bullet · `Appendix B` coverage test: every type in the list is emitted by at least one handler test (a registry test fails when a name has no emitter once its feature is built) · immutability test: `UPDATE event` throws.

## Depends on / Feeds
Depends on 03. Feeds 06 (SLA clocks), 10 (action creation), 14 (recompute), 26 (portal timeline), 27 (KPIs).

## Files
`services/api/src/events/**`, `services/api/migrations/0002_event.sql`, `apps/workspace/src/components/ActivityFeed.tsx`.

## Not in this feature
Outbox to external systems; event replay tooling.
