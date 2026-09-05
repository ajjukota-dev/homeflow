# Foundation · Event Log

One append-only, immutable event log underpins audit, handshakes, gate re-evaluation, notifications, and analytics. Every consequential change emits an event. Events are **facts that already happened** — past tense, never mutated, never deleted.

---

## 1. Event envelope

Every event, regardless of type, shares this envelope:

| field | type | req | notes |
|---|---|---|---|
| `event_id` | uuid | ✔ | v7, globally unique. |
| `event_type` | string | ✔ | Dotted, past tense: `booking.handover.accepted`. |
| `occurred_at` | timestamp | ✔ | When the fact happened (UTC). |
| `recorded_at` | timestamp | ✔ | When persisted. |
| `project_id` | ref<Project> | ✔ | Derived; enables project-scoped audit + RLS. |
| `actor` | json | ✔ | `{ type: user\|system\|ai\|connector, id, name }`. |
| `subject` | json | ✔ | Primary entity refs: `{ unit_id?, booking_id?, customer_id?, cr_id?, action_id?, ... }`. |
| `payload` | json | ✔ | Type-specific body (see catalog). |
| `previous_state` / `new_state` | json | | For state transitions. |
| `reason_code` | string | | Required for returns/overrides/waivers/cancellations/delays. |
| `correlation_id` | uuid | | Ties events from one handshake/workflow together. |
| `source` | json | | `{ system, source_record_id }` for imported facts. |

**Storage:** one append-only Postgres table (`event`), indexed by `(project_id, recorded_at)` and `correlation_id`. Consumers are jobs enqueued in the **same transaction** as the append ([`../technical/04-events-and-jobs.md`](../technical/04-events-and-jobs.md)); there is no separate stream. Partition by month only once it passes ~50 M rows. No `UPDATE`/`DELETE` grants on the table.

---

## 2. Consumers

| Consumer | Uses events for |
|---|---|
| **Gate rule engine** | Re-evaluate `UnitChangeGate` on `unit.progress.updated`, procurement, CR events. |
| **Handshake orchestration** | Drive the receiving Action + payload transfer ([`handshakes.md`](handshakes.md)). |
| **Notifications** | Trigger My Day items, pre-breach alerts, customer updates (through H10 visibility filter). |
| **Analytics / KPI** | Roll up by Project → stage → dept → role → owner → unit → booking. |
| **Forecast snapshots** | Reconstruct as-of-date state for actual-vs-forecast variance. |
| **AI engines** | Training + outcome logging (model, version, confidence, action, outcome). |
| **Audit / compliance** | The legal record of who did what, when, why. |

---

## 3. Event catalog (minimum required)

Grouped by domain. Names are canonical; role specs emit these, never invent parallel ones.

### Booking & sales
`booking.created` · `booking.revised` · `booking.cancelled` · `booking.transferred` · `booking.handover.submitted` · `booking.handover.returned` · `booking.handover.accepted`

### Money
`funding.setup.created` · `demand.schedule.generated` · `demand.raised` · `receipt.posted` · `receipt.reversed` · `waiver.applied` · `tds.verified` · `forecast.created` · `forecast.revised` · `forecast.snapshot_locked` · `forecast.probability_changed` · `forecast.expected_date_changed` · `forecast.scenario_changed`

### Team & project
`project.team.assigned` · `project.team.reassigned` · `project.team.shared_scope_changed` · `project.ownership.effective_dated_changed`

### Documents & legal
`document.generation.requested` · `document.requested` · `document.received` · `document.accepted` · `document.rejected` · `document.superseded` · `document.template.created` · `document.template.approved` · `document.template.activated` · `document.template.retired` · `document.generated` · `document.validation.failed` · `document.revised` · `clause.selected` · `deviation.requested` · `deviation.approved` · `deviation.rejected` · `document.shared_with_customer` · `document.customer_commented` · `document.customer_accepted` · `document.approved_for_execution` · `document.esigned` · `document.wet_signed` · `document.registered` · `document.archived` · `document.external_revision.imported` · `document.external_revision.compared` · `document.external_revision.reapproved`

### Registration
`registration.readiness.achieved` · `registration.financial_clearance.evaluated` · `registration.slot.booked` · `registration.completed`

### Unit progress & changeability
`unit.progress.updated` · `unit.progress.bulk_applied` · `unit.exception.recorded` · `unit.progress.corrected` · `unit.progress.published` · `unit.freshness.breached` · `unit.verification.requested` · `unit.gate.opened` · `unit.gate.closing_forecast_changed` · `unit.gate.restricted` · `unit.gate.exception_only` · `unit.gate.hard_closed` · `unit.gate.reopened_by_correction`

### Change requests & customisation
`cr.requested` · `cr.feasibility.assessed` · `cr.quoted` · `cr.customer_accepted` · `cr.payment_cleared` · `cr.released` · `cr.execution_started` · `cr.qa_verified` · `cr.as_built_closed` · `cr.rejected` · `cr.withdrawn` · `cr.cancelled`

### Change Window Hold
`hold.requested` · `hold.approved` · `hold.activated` · `hold.expired` · `hold.released` · `hold.rejected`

### Prospect / matching
`prospect.needs.captured` · `prospect.unit_match.generated` · `prospect.unit.compared` · `prospect.unit.selected`

### Quality & readiness
`unit.readiness.component_passed` · `unit.readiness.component_failed` · `unit.readiness.reverified` · `snag.created` · `snag.assigned` · `snag.rectified` · `snag.verified` · `snag.reopened` · `snag.closed`

### Commitments & experience
`commitment.created` · `commitment.approved` · `commitment.at_risk` · `commitment.fulfilled` · `commitment.breached` · `commitment.waived_cancelled` · `customer.contact.sent` · `customer.response.received` · `customer.sentiment.changed` · `customer.update.published`

### Handover & post-handover
`handover.eligibility.reached` · `handover.blocked` · `handover.appointment.booked` · `handover.completed` · `warranty.window.opened` · `warranty.case.opened` · `warranty.case.resolved` · `warranty.case.reopened` · `dlp.window.opened` · `dlp.window.closed` · `checkin.captured` · `referral.requested`

### Escalation & journey/SLA
`escalation.created` · `escalation.upgraded` · `escalation.recovery_plan.created` · `escalation.closed` · `journey.template.created` · `journey.template.approved` · `journey.template.activated` · `journey.template.superseded` · `journey.project_template.inherited` · `journey.project_template.overridden` · `journey.baseline.created` · `journey.baseline.reset` · `journey.plan.revised` · `journey.forecast.revised` · `journey.confidence.changed` · `sla.clock.started` · `sla.clock.paused` · `sla.clock.resumed` · `sla.clock.warned` · `sla.clock.breached` · `sla.clock.completed` · `gate.opened` · `gate.closed` · `gate.waived` · `gate.overridden` · `delay.reason.recorded` · `delay.reason.changed` · `customer.milestone_date.changed`

---

## 4. Rules

| Rule | Requirement |
|---|---|
| **Append-only** | No update/delete. Corrections are new compensating events. |
| **Reason codes mandatory** | For returns, delays, overrides, waivers, cancellations, escalations. |
| **AI logging** | AI-emitted events record model, version, confidence, the user action taken, and eventual outcome. |
| **Correlation** | Handshake-driven events share a `correlation_id` so a workflow can be reconstructed. |
| **No material deletion** | Financial, legal, commitment, and spec history never deleted — superseded/cancelled states + compensating events only. |
| **Snapshot support** | Forecast/state snapshots are derived from the log as-of a date without overwriting prior snapshots. |
| **Access** | Read access is project- + role-scoped; sensitive fields masked per role. |

---

## Key behaviours (acceptance-testable)

1. Critical workflows and edits have a complete audit trail. (#15)
2. Forecast snapshots reconstruct as-of-date state; variance computed without overwriting prior forecasts. (#13)
3. Every gate transition/override event carries timestamp, actor/source, previous state, new state, reason/event. (§35.1)
4. Customer-facing published events never contain internal-only content. (#14)
