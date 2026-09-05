"""Event type -> the jobs it enqueues, in the same transaction (technical/04 §2).

The full intended map is below as commented lines, exactly as 04 §2 lists it. A line is
uncommented by the slice that registers its handler — `test_consumers.py` fails if a
consumer names a kind with no `@job` handler, so the map can never point at nothing.

Adding a consumer is one line; there is no other place to add one.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

Args = dict[str, Any]


@dataclass(frozen=True)
class Consumer:
    kind: str
    #: subject + payload -> the job's args. Defaults to passing the subject through.
    args: Callable[[Args, Args], Args] = field(default=lambda subject, payload: dict(subject))
    #: subject -> dedupe key, or None for "always enqueue".
    dedupe: Callable[[Args], str | None] = field(default=lambda subject: None)


def _by_unit(kind: str) -> Consumer:
    return Consumer(
        kind=kind,
        args=lambda subject, payload: {"unit_id": str(subject.get("unit_id"))},
        dedupe=lambda subject: f"{kind}:{subject.get('unit_id')}",
    )


def _by_booking(kind: str) -> Consumer:
    return Consumer(
        kind=kind,
        args=lambda subject, payload: {"booking_id": str(subject.get("booking_id"))},
        dedupe=lambda subject: f"{kind}:{subject.get('booking_id')}",
    )


CONSUMERS: dict[str, tuple[Consumer, ...]] = {
    # --- live now -------------------------------------------------------------------
    # (nothing yet: every job kind in 04 §2 belongs to a later slice. `job.dead`'s own
    #  notify.send consumer lands with the notification outbox, TASKS Amarsh 5.)
    #
    # --- 04 §2, waiting for its handler ---------------------------------------------
    # "unit.progress.updated":            (_by_unit("gate.reevaluate"),),
    # "unit.progress.bulk_applied":       (_by_unit("gate.reevaluate"),),
    # "unit.progress.corrected":          (_by_unit("gate.reevaluate"),),
    # "cr.released":                      (_by_unit("gate.reevaluate"),),
    # "hold.expired":                     (_by_unit("gate.reevaluate"),),
    # "hold.activated":                   (_by_unit("gate.reevaluate"),),
    # "unit.gate.opened":                 (_by_unit("gate.notify_affected"),),
    # "unit.gate.restricted":             (_by_unit("gate.notify_affected"),),
    # "unit.gate.exception_only":         (_by_unit("gate.notify_affected"),),
    # "unit.gate.hard_closed":            (_by_unit("gate.notify_affected"),),
    # "unit.gate.reopened_by_correction": (_by_unit("gate.notify_affected"),),
    # "booking.handover.accepted":        (_by_booking("journey.start"),
    #                                      _by_booking("customer_update.draft")),
    # "demand.raised":                    (_by_booking("collections.recompute"),
    #                                      _by_booking("customer_update.draft")),
    # "receipt.posted":                   (_by_booking("collections.recompute"),
    #                                      _by_booking("customer_update.draft")),
    # "receipt.reversed":                 (_by_booking("collections.recompute"),),
    # "waiver.applied":                   (_by_booking("collections.recompute"),),
    # "snag.created":                     (_by_booking("handover.reevaluate"),),
    # "snag.closed":                      (_by_booking("handover.reevaluate"),),
    # "unit.readiness.component_passed":  (_by_booking("handover.reevaluate"),),
    # "unit.readiness.component_failed":  (_by_booking("handover.reevaluate"),),
    # "registration.completed":           (_by_booking("handover.reevaluate"),),
    # "registration.financial_clearance.evaluated": (_by_booking("handover.reevaluate"),),
    # "commitment.created":               (_by_booking("handover.reevaluate"),),
    # "commitment.breached":              (_by_booking("handover.reevaluate"),),
    # "document.generation.requested":    (Consumer("doc.generate"),),
    # "document.generated":               (Consumer("customer_update.draft"),),
    # "document.registered":              (Consumer("customer_update.draft"),),
    # "document.shared_with_customer":    (Consumer("customer_update.draft"),),
    # "handover.completed":               (_by_booking("post_handover.open"),),
    # "escalation.created":               (Consumer("tower.refresh"), Consumer("notify.send")),
    # "escalation.upgraded":              (Consumer("tower.refresh"), Consumer("notify.send")),
    # "sla.clock.warned":                 (Consumer("notify.send"),),
    # "sla.clock.breached":               (Consumer("notify.send"),),
    # "customer.update.published":        (Consumer("notify.send"),),
    # "config.changed":                   (Consumer("config.reload"),),
    # "journey.plan.revised":             (Consumer("journey.recompute"),),
    # "journey.forecast.revised":         (Consumer("journey.recompute"),),
}
