"""Shared helpers for the Phase 2 Collaboration layer.

* Polymorphic entity validation (entity_type + entity_id) for the trio
  supported in Phase 2 — but designed so future entity_types plug in with
  a single line in ENTITY_RESOLVERS.
* Notification fan-out (single user, multi-user, department).
* Category → verifier department mapping.
* Role/visibility policies.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from kernel.mongo import get_db

# ---------------- Constants ----------------

# entity_type string → (mongo collection, title-generator function).
# Add a new line here to support a new entity_type — no schema change.
ENTITY_RESOLVERS: dict[str, dict[str, Any]] = {
    "customer": {"collection": "customers", "title": lambda d: f"{d.get('code','')} — {d.get('primary_name','')}"},
    "unit": {"collection": "units", "title": lambda d: f"Unit {d.get('code','')}"},
    "booking": {"collection": "bookings", "title": lambda d: f"Booking {d.get('code','')}"},
    "task": {"collection": "tasks", "title": lambda d: f"Task: {d.get('title','')}"},
    "journey": {"collection": "customer_journeys", "title": lambda d: f"Journey {d.get('id','')[:8]}"},
    "journey_stage": {"collection": "journey_stage_instances", "title": lambda d: f"Stage {d.get('id','')[:8]}"},
    "journey_subprocess": {"collection": "journey_subprocess_instances", "title": lambda d: f"Sub-process {d.get('id','')[:8]}"},
    "sales_handover": {"collection": "sales_handovers", "title": lambda d: f"Handover for booking {d.get('booking_id','')[:8]}"},
    "document": {"collection": "documents", "title": lambda d: f"Doc: {d.get('title','')} ({d.get('category','')})"},
    "customer_commitment": {"collection": "customer_commitments", "title": lambda d: f"Commitment {d.get('code','')} — {d.get('category','')}"},
    "payment_schedule": {"collection": "payment_schedules", "title": lambda d: f"Payment schedule for booking {d.get('booking_id','')[:8]}"},
    "payment_milestone": {"collection": "payment_milestones", "title": lambda d: f"Milestone: {d.get('milestone_name','')}"},
    "payment": {"collection": "payments", "title": lambda d: f"Payment ₹{d.get('amount_inr','')} · {d.get('payment_mode','')}"},
    "tds_record": {"collection": "tds_records", "title": lambda d: f"TDS for booking {d.get('booking_id','')[:8]}"},
    "financial_clearance": {"collection": "financial_clearances", "title": lambda d: f"FC for booking {d.get('booking_id','')[:8]}"},
    "loan_case": {"collection": "loan_cases", "title": lambda d: f"Loan · {d.get('bank_name','')} for booking {d.get('booking_id','')[:8]}"},
    "loan_event": {"collection": "loan_events", "title": lambda d: f"Loan event: {d.get('event_type','')}"},
    "legal_record": {"collection": "legal_records", "title": lambda d: f"Legal record for booking {d.get('booking_id','')[:8]}"},
    "registration": {"collection": "registrations", "title": lambda d: f"Registration for booking {d.get('booking_id','')[:8]}"},
    "unit_readiness": {"collection": "unit_readiness", "title": lambda d: f"Unit Readiness for booking {d.get('booking_id','')[:8]}"},
    "snag": {"collection": "snags", "title": lambda d: f"Snag {d.get('code','')} — {d.get('room','')} / {d.get('category','')}"},
    "handover": {"collection": "handovers", "title": lambda d: f"Handover for booking {d.get('booking_id','')[:8]}"},
    "escalation": {"collection": "escalations", "title": lambda d: f"{d.get('code','')} — {d.get('title','')[:60]}"},
    "communication": {"collection": "communications", "title": lambda d: f"{d.get('code','')} — {d.get('subject','')[:60]}"},
}

# Categories that require verification, and which department to notify.
CATEGORY_TO_VERIFIER_DEPT_CODE: dict[str, str] = {
    "TDS": "ACCOUNTS",
    "Loan": "BANKING",
    "Registration": "REGISTRATION",
    "Agreement": "LEGAL",
    "KYC": "CRM",
}

CATEGORY_CHOICES: tuple[str, ...] = (
    "KYC", "Booking", "Cost Sheet", "Agreement", "Sale Deed", "TDS", "Loan",
    "Registration", "POA", "Handover", "Snag", "Other",
)

VISIBILITY_CHOICES: tuple[str, ...] = ("Internal", "Customer Visible")
VERIFICATION_STATUS_CHOICES: tuple[str, ...] = ("Uploaded", "Under Review", "Verified", "Rejected")
COMMENT_STATUS_CHOICES: tuple[str, ...] = ("Active", "Resolved", "Deleted")

# Roles that can post Customer Visible content (super_admin is always allowed via is_super_admin flag).
CUSTOMER_VISIBLE_ROLE_CODES: set[str] = {"MANAGEMENT", "CRM", "LEGAL"}

# Roles allowed to verify uploaded documents.
VERIFY_ROLE_CODES: set[str] = {"MANAGEMENT", "ACCOUNTS", "LEGAL", "REGISTRATION", "QA", "CRM"}

ALLOWED_UPLOAD_EXTENSIONS: set[str] = {".pdf", ".jpg", ".jpeg", ".png", ".docx", ".xlsx", ".csv"}
MAX_UPLOAD_BYTES: int = 25 * 1024 * 1024  # 25 MB

# ---------------- Helpers ----------------

def _uuid() -> str:
    return str(uuid.uuid4())


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_super_admin(user: dict) -> bool:
    return bool(user.get("role", {}).get("is_super_admin"))


def user_role_code(user: dict) -> Optional[str]:
    return user.get("role", {}).get("code")


def can_post_customer_visible(user: dict) -> bool:
    return is_super_admin(user) or user_role_code(user) in CUSTOMER_VISIBLE_ROLE_CODES


def can_verify(user: dict) -> bool:
    return is_super_admin(user) or user_role_code(user) in VERIFY_ROLE_CODES


async def resolve_entity(entity_type: str, entity_id: str) -> Optional[dict]:
    """Return the entity document, or None if entity_type is not supported or the id is missing."""
    spec = ENTITY_RESOLVERS.get(entity_type)
    if not spec:
        return None
    db = get_db()
    return await db[spec["collection"]].find_one({"id": entity_id}, {"_id": 0})


def entity_title(entity_type: str, doc: dict) -> str:
    spec = ENTITY_RESOLVERS.get(entity_type)
    if not spec or not doc:
        return f"{entity_type} #{doc.get('id','')}"
    try:
        return spec["title"](doc)
    except Exception:  # noqa: BLE001
        return f"{entity_type} #{doc.get('id','')}"


# ---------------- Notifications ----------------

async def create_notification(
    *,
    recipient_user_id: str,
    actor_user_id: Optional[str],
    type_: str,
    entity_type: str,
    entity_id: str,
    title: str,
    body: str = "",
    comment_id: Optional[str] = None,
    attachment_id: Optional[str] = None,
) -> Optional[dict]:
    """Insert one notification. Skips if recipient == actor (self-notify guard)."""
    if actor_user_id and recipient_user_id == actor_user_id:
        return None
    db = get_db()
    doc = {
        "id": _uuid(),
        "user_id": recipient_user_id,
        "type": type_,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "comment_id": comment_id,
        "attachment_id": attachment_id,
        "actor_user_id": actor_user_id,
        "title": title,
        "body": body,
        "read_at": None,
        "created_at": _now_iso(),
    }
    await db.notifications.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def notify_users(
    *,
    user_ids: Iterable[str],
    actor_user_id: Optional[str],
    **kwargs,
) -> list[dict]:
    """Fan out one notification per user id."""
    created: list[dict] = []
    seen: set[str] = set()
    for uid in user_ids:
        if not uid or uid in seen:
            continue
        seen.add(uid)
        n = await create_notification(recipient_user_id=uid, actor_user_id=actor_user_id, **kwargs)
        if n:
            created.append(n)
    return created


async def notify_departments(
    *,
    department_ids: Iterable[str],
    actor_user_id: Optional[str],
    **kwargs,
) -> list[dict]:
    """Notify every ACTIVE user in each department."""
    db = get_db()
    user_ids: list[str] = []
    for dept_id in department_ids:
        if not dept_id:
            continue
        async for u in db.users.find({"department_id": dept_id, "active": True}, {"_id": 0, "id": 1}):
            user_ids.append(u["id"])
    return await notify_users(user_ids=user_ids, actor_user_id=actor_user_id, **kwargs)


async def notify_department_by_code(
    *,
    department_code: str,
    actor_user_id: Optional[str],
    **kwargs,
) -> list[dict]:
    db = get_db()
    dept = await db.departments.find_one({"code": department_code}, {"_id": 0, "id": 1})
    if not dept:
        return []
    return await notify_departments(department_ids=[dept["id"]], actor_user_id=actor_user_id, **kwargs)


# ---------------- Mention persistence ----------------

async def persist_mentions(
    *,
    comment_id: str,
    user_ids: Iterable[str],
    department_ids: Iterable[str],
) -> None:
    db = get_db()
    rows: list[dict] = []
    for uid in set(u for u in user_ids if u):
        rows.append({
            "id": _uuid(),
            "comment_id": comment_id,
            "mentioned_user_id": uid,
            "mentioned_department_id": None,
            "created_at": _now_iso(),
            "read_at": None,
        })
    for did in set(d for d in department_ids if d):
        rows.append({
            "id": _uuid(),
            "comment_id": comment_id,
            "mentioned_user_id": None,
            "mentioned_department_id": did,
            "created_at": _now_iso(),
            "read_at": None,
        })
    if rows:
        await db.mentions.insert_many(rows)
