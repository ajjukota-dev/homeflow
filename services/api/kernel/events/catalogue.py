"""The event catalogue: every type in `foundation/event-log.md` §3 (technical/04 §1).

An unknown type never reaches the database — `append()` looks the type up here and a
`KeyError` is a programming error, not a runtime one. Groups mirror the foundation's
headings one for one so the two files stay comparable by eye.

`payload_model` is `None` for now on every entry: the typed Pydantic body arrives with
the slice that first emits the event.
# ponytail: no payload models yet. Add one per event as its slice lands; `append()`
# already validates through `spec.payload_model` when it is not None.
"""
from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel

UNIT = ("unit_id",)
BOOKING = ("booking_id",)
UNIT_BOOKING = ("unit_id", "booking_id")
PROJECT = ("project_id",)
CUSTOMER = ("customer_id",)
CR = ("cr_id",)
DOC = ("document_id",)
ACTION = ("action_id",)


#: Alias for `type[BaseModel]`, needed because `EventSpec.type` shadows the builtin.
PayloadModel = type[BaseModel]


@dataclass(frozen=True)
class EventSpec:
    type: str
    reason_required: bool
    subject_keys: tuple[str, ...]
    # The field named `type` shadows the builtin inside this class body, so the
    # annotation below refers to the aliased import rather than `type[...]`.
    payload_model: PayloadModel | None = None


CATALOGUE: dict[str, EventSpec] = {}

#: foundation/event-log.md §4 — "reason codes mandatory for returns, delays, overrides,
#: waivers, cancellations, escalations". Listed explicitly so adding one is a review.
REASON_REQUIRED = frozenset({
    "booking.revised", "booking.cancelled", "booking.handover.returned",
    "receipt.reversed", "waiver.applied", "forecast.scenario_changed",
    "document.rejected", "document.superseded", "document.revised", "document.archived",
    "deviation.requested", "deviation.rejected", "document.external_revision.reapproved",
    "unit.exception.recorded", "unit.progress.corrected", "unit.gate.reopened_by_correction",
    "cr.rejected", "cr.withdrawn", "cr.cancelled",
    "hold.rejected", "hold.released",
    "snag.reopened", "unit.readiness.reverified",
    "commitment.waived_cancelled", "commitment.breached",
    "handover.blocked",
    "warranty.case.reopened",
    "escalation.created", "escalation.upgraded", "escalation.recovery_plan.created",
    "escalation.closed",
    "journey.baseline.reset", "journey.plan.revised", "journey.template.superseded",
    "gate.waived", "gate.overridden", "delay.reason.recorded", "delay.reason.changed",
    "customer.milestone_date.changed",
})


def _group(subject_keys: tuple[str, ...], types: str) -> None:
    for name in types.split():
        CATALOGUE[name] = EventSpec(
            type=name, reason_required=name in REASON_REQUIRED, subject_keys=subject_keys
        )


# --- Booking & sales ----------------------------------------------------------------
_group(UNIT_BOOKING, """
    booking.created booking.revised booking.cancelled booking.transferred
    booking.handover.submitted booking.handover.returned booking.handover.accepted
""")

# --- Money --------------------------------------------------------------------------
_group(BOOKING, """
    funding.setup.created demand.schedule.generated demand.raised receipt.posted
    receipt.reversed waiver.applied tds.verified
""")
_group(PROJECT, """
    forecast.created forecast.revised forecast.snapshot_locked forecast.probability_changed
    forecast.expected_date_changed forecast.scenario_changed
""")

# --- Team & project -----------------------------------------------------------------
_group(PROJECT, """
    project.team.assigned project.team.reassigned project.team.shared_scope_changed
    project.ownership.effective_dated_changed
""")

# --- Documents & legal --------------------------------------------------------------
_group(DOC, """
    document.generation.requested document.requested document.received document.accepted
    document.rejected document.superseded document.template.created
    document.template.approved document.template.activated document.template.retired
    document.generated document.validation.failed document.revised clause.selected
    deviation.requested deviation.approved deviation.rejected document.shared_with_customer
    document.customer_commented document.customer_accepted document.approved_for_execution
    document.esigned document.wet_signed document.registered document.archived
    document.external_revision.imported document.external_revision.compared
    document.external_revision.reapproved
""")

# --- Registration -------------------------------------------------------------------
_group(BOOKING, """
    registration.readiness.achieved registration.financial_clearance.evaluated
    registration.slot.booked registration.completed
""")

# --- Unit progress & changeability --------------------------------------------------
_group(UNIT, """
    unit.progress.updated unit.progress.bulk_applied unit.exception.recorded
    unit.progress.corrected unit.progress.published unit.freshness.breached
    unit.verification.requested unit.gate.opened unit.gate.closing_forecast_changed
    unit.gate.restricted unit.gate.exception_only unit.gate.hard_closed
    unit.gate.reopened_by_correction
""")

# --- Change requests & customisation ------------------------------------------------
_group(CR, """
    cr.requested cr.feasibility.assessed cr.quoted cr.customer_accepted cr.payment_cleared
    cr.released cr.execution_started cr.qa_verified cr.as_built_closed cr.rejected
    cr.withdrawn cr.cancelled
""")

# --- Change Window Hold -------------------------------------------------------------
_group(UNIT, """
    hold.requested hold.approved hold.activated hold.expired hold.released hold.rejected
""")

# --- Prospect / matching ------------------------------------------------------------
_group(("opportunity_id",), """
    prospect.needs.captured prospect.unit_match.generated prospect.unit.compared
    prospect.unit.selected
""")

# --- Quality & readiness ------------------------------------------------------------
_group(UNIT, """
    unit.readiness.component_passed unit.readiness.component_failed unit.readiness.reverified
    snag.created snag.assigned snag.rectified snag.verified snag.reopened snag.closed
""")

# --- Commitments & experience -------------------------------------------------------
_group(BOOKING, """
    commitment.created commitment.approved commitment.at_risk commitment.fulfilled
    commitment.breached commitment.waived_cancelled customer.update.published
""")
_group(CUSTOMER, """
    customer.contact.sent customer.response.received customer.sentiment.changed
""")

# --- Handover & post-handover -------------------------------------------------------
_group(UNIT_BOOKING, """
    handover.eligibility.reached handover.blocked handover.appointment.booked
    handover.completed warranty.window.opened warranty.case.opened warranty.case.resolved
    warranty.case.reopened dlp.window.opened dlp.window.closed checkin.captured
    referral.requested
""")

# --- Escalation & journey/SLA -------------------------------------------------------
_group(ACTION, """
    escalation.created escalation.upgraded escalation.recovery_plan.created escalation.closed
    sla.clock.started sla.clock.paused sla.clock.resumed sla.clock.warned sla.clock.breached
    sla.clock.completed
""")
_group(("journey_instance_id",), """
    journey.template.created journey.template.approved journey.template.activated
    journey.template.superseded journey.project_template.inherited
    journey.project_template.overridden journey.baseline.created journey.baseline.reset
    journey.plan.revised journey.forecast.revised journey.confidence.changed
    delay.reason.recorded delay.reason.changed customer.milestone_date.changed
""")
_group(UNIT, "gate.opened gate.closed gate.waived gate.overridden")

# --- Kernel events (technical/03 §9, 04 §3, 08 §1, 11) ------------------------------
_group((), """
    user.provisioned user.deactivated user.signed_in user.signed_out customer.signed_in
    session.revoked permission.changed config.changed job.dead migration.imported
    legacy.audit file.attached
""")


def spec(event_type: str) -> EventSpec:
    """Raises `KeyError` for an uncatalogued type: that is a bug, not a request error."""
    return CATALOGUE[event_type]
