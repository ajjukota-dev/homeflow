"""Escalations router (Phase 8 lean)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict

from kernel.identity.auth_utils import get_current_user
from kernel.identity.auth_scope import (
    get_project_scope, is_all_projects_user, project_id_of_entity,
    require_customer_access, require_customer_access_soft, scoped_customer_ids, require_module_by_method
)
from kernel.collaboration.collaboration import is_super_admin, user_role_code
from kernel.mongo import get_db, next_sequence, write_audit
from kernel.action.escalation_rules import OPEN_STATUSES, scan_all


router = APIRouter(prefix="", tags=["escalations"], dependencies=[Depends(require_module_by_method("escalations"))])

SEVERITIES = {"Low", "Medium", "High", "Critical"}
STATUSES = {"Open", "Acknowledged", "In Progress", "Resolved", "Closed"}


def _now(): return datetime.now(timezone.utc).isoformat()
def _uid(): return str(uuid.uuid4())


def _can_close(user: dict) -> bool:
    return is_super_admin(user) or user_role_code(user) in {"MANAGEMENT"}


class ManualEscalation(BaseModel):
    model_config = ConfigDict(extra="ignore")
    customer_id: str
    booking_id: Optional[str] = None
    department_id: str
    severity: str
    title: str
    description: Optional[str] = ""
    source_entity_type: Optional[str] = None
    source_entity_id: Optional[str] = None
    due_date: Optional[str] = None


class AssignPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    owner_user_id: str


class ResolvePayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    resolution_notes: str


class ReasonPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reason: str


async def _get_or_404(db, eid: str) -> dict:
    doc = await db.escalations.find_one({"id": eid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Escalation not found")
    return doc


async def _enrich_many(db, docs: list[dict]) -> list[dict]:
    cust_ids = [d["customer_id"] for d in docs if d.get("customer_id")]
    customers = {c["id"]: c async for c in db.customers.find({"id": {"$in": cust_ids}}, {"_id": 0, "id": 1, "code": 1, "primary_name": 1})}
    dept_ids = [d["department_id"] for d in docs if d.get("department_id")]
    depts = {x["id"]: x async for x in db.departments.find({"id": {"$in": dept_ids}}, {"_id": 0, "id": 1, "name": 1, "code": 1})}
    owner_ids = [d["owner_user_id"] for d in docs if d.get("owner_user_id")]
    owners = {u["id"]: u async for u in db.users.find({"id": {"$in": owner_ids}}, {"_id": 0, "id": 1, "name": 1})}
    for d in docs:
        d["_customer"] = customers.get(d.get("customer_id"), {})
        d["_department"] = depts.get(d.get("department_id"), {})
        d["_owner"] = owners.get(d.get("owner_user_id"), {}) if d.get("owner_user_id") else None
    return docs


@router.get("/escalations")
async def list_escalations(
    status: Optional[str] = None,
    severity: Optional[str] = None,
    department_id: Optional[str] = None,
    customer_id: Optional[str] = None,
    overdue: bool = False,
    limit: int = Query(500, ge=1, le=2000),
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    q: dict = {}
    if status:
        if status == "open":
            q["status"] = {"$in": list(OPEN_STATUSES)}
        else:
            q["status"] = status
    if severity: q["severity"] = severity
    if department_id: q["department_id"] = department_id
    if customer_id: q["customer_id"] = customer_id
    if overdue:
        q["due_date"] = {"$lt": _now()}
    # Phase 9 scope
    if not is_all_projects_user(current_user):
        cids = await scoped_customer_ids(current_user) or []
        if not cids: return []
        if "customer_id" in q:
            if q["customer_id"] not in cids: return []
        else:
            q["customer_id"] = {"$in": cids}
    docs = await db.escalations.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return await _enrich_many(db, docs)


@router.get("/escalations/counts")
async def counts(current_user: dict = Depends(get_current_user)):
    db = get_db()
    open_q = {"status": {"$in": list(OPEN_STATUSES)}}
    if not is_all_projects_user(current_user):
        cids = await scoped_customer_ids(current_user) or []
        if not cids:
            return {"open_total": 0, "critical_open": 0, "high_open": 0, "medium_open": 0, "low_open": 0,
                    "by_severity": {"Low": 0, "Medium": 0, "High": 0, "Critical": 0}}
        open_q["customer_id"] = {"$in": cids}
    by_sev = {}
    for sev in ("Low", "Medium", "High", "Critical"):
        by_sev[sev] = await db.escalations.count_documents({**open_q, "severity": sev})
    return {
        "open_total": await db.escalations.count_documents(open_q),
        "critical_open": by_sev["Critical"], "high_open": by_sev["High"],
        "medium_open": by_sev["Medium"], "low_open": by_sev["Low"],
        "by_severity": by_sev,
    }


@router.post("/escalations")
async def create_manual(payload: ManualEscalation, current_user: dict = Depends(get_current_user)):
    if payload.severity not in SEVERITIES:
        raise HTTPException(status_code=400, detail=f"severity must be one of {sorted(SEVERITIES)}")
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="title required")
    db = get_db()
    cust = await db.customers.find_one({"id": payload.customer_id}, {"_id": 0, "id": 1})
    if not cust: raise HTTPException(status_code=400, detail="Invalid customer")
    dept = await db.departments.find_one({"id": payload.department_id}, {"_id": 0, "id": 1})
    if not dept: raise HTTPException(status_code=400, detail="Invalid department")
    # Phase 9 write guard
    await require_customer_access(current_user, payload.customer_id)
    seq = await next_sequence("escalation")
    now = _now()
    doc = {
        "id": _uid(), "code": f"ESC-{seq:06d}", "rule_key": "manual",
        "customer_id": payload.customer_id, "unit_id": None, "booking_id": payload.booking_id,
        "journey_id": None, "department_id": payload.department_id,
        "owner_user_id": None, "severity": payload.severity, "status": "Open",
        "title": payload.title.strip(), "description": (payload.description or "").strip(),
        "source_entity_type": payload.source_entity_type, "source_entity_id": payload.source_entity_id,
        "due_date": payload.due_date, "resolution_notes": None,
        "acknowledged_by": None, "acknowledged_at": None,
        "resolved_by": None, "resolved_at": None,
        "closed_by": None, "closed_at": None,
        "created_at": now, "updated_at": now,
    }
    await db.escalations.insert_one(doc)
    doc.pop("_id", None)
    await write_audit(user_id=current_user["id"], entity_type="escalation", entity_id=doc["id"],
                      action="create", after=doc,
                      parent_entity_type="customer", parent_entity_id=payload.customer_id)
    # Notify department members
    users = await db.users.find({"department_id": payload.department_id, "active": True}, {"_id": 0, "id": 1}).to_list(200)
    if users:
        from kernel.collaboration.collaboration import notify_users as _notify
        await _notify(user_ids=[u["id"] for u in users], actor_user_id=current_user["id"],
                      type_="ESCALATION_CREATED", entity_type="escalation", entity_id=doc["id"],
                      title=doc["title"], body=doc["description"][:200])
    return doc


async def _transition(db, eid: str, new_status: str, actor_id: str, extra: dict, current_user: dict | None = None) -> dict:
    doc = await _get_or_404(db, eid)
    # Phase 9 write guard
    if current_user is not None:
        await require_customer_access(current_user, doc.get("customer_id"))
    before = dict(doc)
    updates = {"status": new_status, "updated_at": _now(), **extra}
    await db.escalations.update_one({"id": eid}, {"$set": updates})
    after = await db.escalations.find_one({"id": eid}, {"_id": 0})
    await write_audit(user_id=actor_id, entity_type="escalation", entity_id=eid,
                      action="update", before=before, after=after,
                      parent_entity_type="customer", parent_entity_id=doc.get("customer_id"))
    return after


@router.post("/escalations/{eid}/acknowledge")
async def acknowledge(eid: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await _get_or_404(db, eid)
    if doc["status"] != "Open":
        raise HTTPException(status_code=400, detail=f"Cannot acknowledge from status {doc['status']}")
    return await _transition(db, eid, "Acknowledged", current_user["id"], {"acknowledged_by": current_user["id"], "acknowledged_at": _now()}, current_user=current_user)


@router.post("/escalations/{eid}/assign")
async def assign(eid: str, payload: AssignPayload, current_user: dict = Depends(get_current_user)):
    db = get_db()
    user = await db.users.find_one({"id": payload.owner_user_id, "active": True}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=400, detail="Invalid owner")
    doc = await _get_or_404(db, eid)
    if doc["status"] not in ("Open", "Acknowledged", "In Progress"):
        raise HTTPException(status_code=400, detail=f"Cannot assign from status {doc['status']}")
    return await _transition(db, eid, doc["status"], current_user["id"], {"owner_user_id": payload.owner_user_id}, current_user=current_user)


@router.post("/escalations/{eid}/start")
async def start(eid: str, current_user: dict = Depends(get_current_user)):
    db = get_db()
    doc = await _get_or_404(db, eid)
    if doc["status"] not in ("Open", "Acknowledged"):
        raise HTTPException(status_code=400, detail=f"Cannot start from status {doc['status']}")
    return await _transition(db, eid, "In Progress", current_user["id"], {}, current_user=current_user)


@router.post("/escalations/{eid}/resolve")
async def resolve(eid: str, payload: ResolvePayload, current_user: dict = Depends(get_current_user)):
    if not payload.resolution_notes.strip():
        raise HTTPException(status_code=400, detail="resolution_notes required")
    db = get_db()
    doc = await _get_or_404(db, eid)
    if doc["status"] not in ("Acknowledged", "In Progress", "Open"):
        raise HTTPException(status_code=400, detail=f"Cannot resolve from status {doc['status']}")
    now = _now()
    return await _transition(db, eid, "Resolved", current_user["id"], {
        "resolution_notes": payload.resolution_notes.strip(),
        "resolved_by": current_user["id"], "resolved_at": now,
    }, current_user=current_user)


@router.post("/escalations/{eid}/close")
async def close(eid: str, current_user: dict = Depends(get_current_user)):
    if not _can_close(current_user):
        raise HTTPException(status_code=403, detail="Only Management / Super Admin can close escalations")
    db = get_db()
    doc = await _get_or_404(db, eid)
    if doc["status"] not in ("Resolved", "In Progress"):
        raise HTTPException(status_code=400, detail=f"Cannot close from status {doc['status']}")
    now = _now()
    return await _transition(db, eid, "Closed", current_user["id"], {
        "closed_by": current_user["id"], "closed_at": now,
    }, current_user=current_user)


@router.post("/escalations/{eid}/reopen")
async def reopen(eid: str, payload: ReasonPayload, current_user: dict = Depends(get_current_user)):
    if not payload.reason.strip():
        raise HTTPException(status_code=400, detail="reason required")
    db = get_db()
    doc = await _get_or_404(db, eid)
    if doc["status"] not in ("Resolved", "Closed"):
        raise HTTPException(status_code=400, detail=f"Cannot reopen from status {doc['status']}")
    return await _transition(db, eid, "Open", current_user["id"], {
        "resolution_notes": f"Reopened: {payload.reason.strip()}",
        "resolved_at": None, "closed_at": None,
    }, current_user=current_user)


@router.post("/escalations/scan")
async def scan(current_user: dict = Depends(get_current_user)):
    if not is_super_admin(current_user) and user_role_code(current_user) != "MANAGEMENT":
        raise HTTPException(status_code=403, detail="Only Management / Super Admin can run escalation scan")
    return await scan_all()
