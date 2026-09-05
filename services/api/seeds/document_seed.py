"""Document checklist auto-seeding on journey creation.

Kept in a small module of its own so `workflow_engine` and
`routers.documents` can both import it without a circular dependency.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from kernel.mongo import get_db


def _uuid() -> str:
    return str(uuid.uuid4())


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# Categories that make up the standard checklist. Order matters for UI.
BASE_ROWS: list[dict] = [
    {"category": "PAN", "title": "PAN card", "required": True},
    {"category": "Identity Proof", "title": "Government ID", "required": True},
    {"category": "Address Proof", "title": "Address proof", "required": True},
    {"category": "Booking Form", "title": "Signed booking form", "required": True},
    {"category": "Cost Sheet", "title": "Cost sheet", "required": True},
    {"category": "Agreement", "title": "Sale agreement", "required": True},
]

NRI_ROWS: list[dict] = [
    {"category": "Passport", "title": "Passport", "required": True},
]

OCI_ROWS: list[dict] = [
    {"category": "OCI", "title": "OCI card", "required": True},
]

# These come later but we seed a placeholder row so the checklist is complete-looking.
LATER_STAGE_ROWS: list[dict] = [
    {"category": "Registration Documents", "title": "Registration set", "required": True},
    {"category": "Handover Documents", "title": "Handover pack", "required": True},
]

POA_ROW = {"category": "POA", "title": "Power of Attorney", "required": False, "applicable": False, "status": "Not Applicable", "na_reason": "Default"}


async def seed_document_checklist(*, customer: dict, booking: dict) -> list[str]:
    """Create the standard document checklist for one (customer, booking) pair.

    Idempotent per (customer_id, booking_id, category) — if a row already
    exists for a category on this booking we don't create a duplicate.
    Returns the list of document ids created (or already existing).
    """
    db = get_db()
    now = _now_iso()

    rows: list[dict] = list(BASE_ROWS)
    nri_status = (customer or {}).get("nri_status")
    if nri_status in ("NRI", "OCI"):
        rows.extend(NRI_ROWS)
    if nri_status == "OCI":
        rows.extend(OCI_ROWS)
    rows.extend(LATER_STAGE_ROWS)

    created_ids: list[str] = []
    for r in rows:
        exists = await db.documents.find_one(
            {
                "customer_id": customer["id"],
                "booking_id": booking["id"],
                "category": r["category"],
            },
            {"_id": 0, "id": 1},
        )
        if exists:
            created_ids.append(exists["id"])
            continue
        doc_id = _uuid()
        doc = {
            "id": doc_id,
            "customer_id": customer["id"],
            "booking_id": booking["id"],
            "category": r["category"],
            "title": r["title"],
            "required": bool(r.get("required", True)),
            "applicable": bool(r.get("applicable", True)),
            "na_reason": r.get("na_reason"),
            "status": r.get("status", "Required"),
            "latest_version": 0,
            "latest_attachment_id": None,
            "notes": None,
            "created_at": now,
            "updated_at": now,
        }
        await db.documents.insert_one(doc)
        created_ids.append(doc_id)

    # POA default Not Applicable
    exists_poa = await db.documents.find_one(
        {
            "customer_id": customer["id"],
            "booking_id": booking["id"],
            "category": "POA",
        },
        {"_id": 0, "id": 1},
    )
    if not exists_poa:
        pid = _uuid()
        await db.documents.insert_one({
            "id": pid,
            "customer_id": customer["id"],
            "booking_id": booking["id"],
            "category": "POA",
            "title": POA_ROW["title"],
            "required": POA_ROW["required"],
            "applicable": POA_ROW["applicable"],
            "na_reason": POA_ROW["na_reason"],
            "status": POA_ROW["status"],
            "latest_version": 0,
            "latest_attachment_id": None,
            "notes": None,
            "created_at": now,
            "updated_at": now,
        })
        created_ids.append(pid)

    return created_ids
