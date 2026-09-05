"""Which module owns an `entity_type`, and which table holds its rows (technical/08 §1).

`POST /files/presign` checks the caller may *write* the parent entity: the module's RBAC
level, and — when the parent table already exists — an RLS read of the parent row, so a
file can never be attached to a row the caller cannot see.
"""
from __future__ import annotations

from dataclasses import dataclass

from kernel.errors import AppError


@dataclass(frozen=True)
class Owner:
    module: str
    #: The parent table, or None while the slice that creates it is still to come.
    table: str | None
    #: Files on this entity may be shown to a customer (technical/08 §1, H10).
    customer_facing_allowed: bool = False


#: Every entity that can carry a file today. A new entity type is one line here, added by
#: the slice that introduces its table — never a wildcard.
OWNERS: dict[str, Owner] = {
    "unit": Owner("project_site", "unit"),
    "unit_progress_state": Owner("project_site", "unit_progress_state"),
    "as_built_revision": Owner("project_site", "as_built_revision"),
    "booking": Owner("sales", "booking"),
    "booking_applicant": Owner("sales", "booking_applicant"),
    "customer": Owner("crm_rm", "customer"),
    "project": Owner("admin", "project"),
    "qa_evidence": Owner("qa", "qa_evidence"),
    "snag": Owner("qa", "snag", customer_facing_allowed=True),
    "handover_record": Owner("qa", "handover_record", customer_facing_allowed=True),
    "home_passport_item": Owner("post_handover", "home_passport_item", customer_facing_allowed=True),
    # Tables that arrive with a later migration; the module gate still applies.
    "action": Owner("actions", None),
    "generated_document": Owner("legal", None, customer_facing_allowed=True),
    "receipt": Owner("accounts", None),
}


def owner_of(entity_type: str) -> Owner:
    try:
        return OWNERS[entity_type]
    except KeyError as exc:
        raise AppError(
            "VALIDATION", f"{entity_type} cannot carry files.", field="entity_type"
        ) from exc
