"""Reports router (Phase 8 lean) — 8 read-only aggregation endpoints with CSV export."""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from statistics import median
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from kernel.identity.auth_utils import get_current_user
from kernel.identity.auth_scope import (
    get_project_scope, is_all_projects_user, scoped_booking_ids, scoped_customer_ids, require_module_by_method
)
from kernel.mongo import get_db
from kernel.action.escalation_rules import OPEN_STATUSES


router = APIRouter(prefix="/reports", tags=["reports"], dependencies=[Depends(require_module_by_method("reports"))])


def _now(): return datetime.now(timezone.utc)


async def _scope_ctx(user: dict) -> tuple[set | None, set | None]:
    """Return (booking_id_set, customer_id_set) or (None, None) for all-access."""
    if is_all_projects_user(user):
        return None, None
    scope = get_project_scope(user) or []
    if not scope:
        return set(), set()
    db = get_db()
    bids = [b["id"] async for b in db.bookings.find({"project_id": {"$in": scope}}, {"_id": 0, "id": 1})]
    if not bids:
        return set(), set()
    cids = list({b["customer_id"] async for b in db.bookings.find({"id": {"$in": bids}, "customer_id": {"$ne": None}}, {"_id": 0, "customer_id": 1})})
    return set(bids), set(cids)


def _days_since(iso: str | None) -> int:
    if not iso: return 0
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except Exception:
        return 0
    return (_now() - dt).days


def _csv_response(rows: list[dict], filename: str) -> StreamingResponse:
    if not rows:
        return StreamingResponse(iter([""]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{filename}"'})
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()), extrasaction="ignore")
    writer.writeheader()
    for r in rows: writer.writerow(r)
    csv_text = buf.getvalue()
    return StreamingResponse(iter([csv_text]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


async def _handover_forecast_rows(db, window: int, project_id: Optional[str], scope_bids: set | None = None) -> list[dict]:
    from modules.qa.handovers import _readiness_score, _apply_override
    now = _now()
    cutoff = (now + __import__("datetime").timedelta(days=window)).isoformat()
    handovers = await db.handovers.find({}, {"_id": 0}).to_list(2000)
    if scope_bids is not None:
        handovers = [h for h in handovers if h.get("booking_id") in scope_bids]
    journeys = {j["booking_id"]: j async for j in db.customer_journeys.find({}, {"_id": 0})}
    bookings = {b["id"]: b async for b in db.bookings.find({}, {"_id": 0})}
    cust_ids = list({b.get("customer_id") for b in bookings.values() if b.get("customer_id")})
    customers = {c["id"]: c async for c in db.customers.find({"id": {"$in": cust_ids}}, {"_id": 0})}
    unit_ids = list({b.get("unit_id") for b in bookings.values() if b.get("unit_id")})
    units = {u["id"]: u async for u in db.units.find({"id": {"$in": unit_ids}}, {"_id": 0})}
    proj_ids = list({b.get("project_id") for b in bookings.values() if b.get("project_id")})
    projects = {p["id"]: p async for p in db.projects.find({"id": {"$in": proj_ids}}, {"_id": 0})}
    rows = []
    for h in handovers:
        b = bookings.get(h["booking_id"], {})
        if project_id and b.get("project_id") != project_id: continue
        j = journeys.get(h["booking_id"], {})
        planned = (h.get("scheduled") or {}).get("final_date") or j.get("expected_handover_date")
        if not planned or planned > cutoff: continue
        r = await _readiness_score(db, h["booking_id"])
        ov = _apply_override(r, h.get("override"))
        p = projects.get(b.get("project_id"), {})
        u = units.get(b.get("unit_id"), {})
        c = customers.get(b.get("customer_id"), {})
        rows.append({
            "project": p.get("code", ""),
            "unit": u.get("code", ""),
            "customer_code": c.get("code", ""),
            "customer_name": c.get("primary_name", ""),
            "planned_handover": planned[:10] if planned else "",
            "readiness_score": r["readiness_score"],
            "gate_status": ov["gate_status"],
            "finance_status": r["contributors"]["finance"]["ready"] and "Approved" or "Pending",
            "registration_status": r["contributors"]["registration"].get("status", ""),
            "unit_readiness_pct": r["contributors"]["readiness"]["score"],
            "critical_snags_open": r["contributors"]["snagging"]["critical_open"],
            "documents_verified_pct": r["contributors"]["documents"]["score"],
            "commitments_open": r["contributors"]["commitments"]["open_count"],
            "risk_level": j.get("risk_level", "Low"),
            "blockers_summary": "; ".join(ov["gate_blockers"][:3]) if ov["gate_blockers"] else "None",
        })
    rows.sort(key=lambda r: r["planned_handover"] or "9999")
    return rows


@router.get("/handover-forecast")
async def handover_forecast(
    window: int = Query(30, ge=1, le=365),
    project_id: Optional[str] = None,
    format: str = "json",
    current_user: dict = Depends(get_current_user),
):
    if window not in (30, 60, 90):
        pass  # allow any window value; spec says 30/60/90 but be lenient
    db = get_db()
    bset, _ = await _scope_ctx(current_user)
    if bset is not None and not bset:
        rows = []
    else:
        rows = await _handover_forecast_rows(db, window, project_id, scope_bids=bset)
    if format == "csv":
        return _csv_response(rows, f"handover-forecast-{window}d.csv")
    return rows


async def _registration_pipeline_rows(db, project_id: Optional[str], scope_bids: set | None = None) -> list[dict]:
    regs = await db.registrations.find({}, {"_id": 0}).to_list(2000)
    if scope_bids is not None:
        regs = [r for r in regs if r.get("booking_id") in scope_bids]
    bookings = {b["id"]: b async for b in db.bookings.find({}, {"_id": 0})}
    cust_ids = list({b.get("customer_id") for b in bookings.values()})
    customers = {c["id"]: c async for c in db.customers.find({"id": {"$in": cust_ids}}, {"_id": 0})}
    projects = {p["id"]: p async for p in db.projects.find({}, {"_id": 0})}
    units = {u["id"]: u async for u in db.units.find({}, {"_id": 0})}
    rows = []
    for r in regs:
        b = bookings.get(r["booking_id"], {})
        if project_id and b.get("project_id") != project_id: continue
        c = customers.get(b.get("customer_id"), {})
        u = units.get(b.get("unit_id"), {})
        p = projects.get(b.get("project_id"), {})
        readiness = r.get("readiness", {}) or {}
        days_ac = _days_since(r.get("updated_at")) if r.get("status") == "Availability Confirmed" else 0
        rows.append({
            "customer_code": c.get("code", ""),
            "customer_name": c.get("primary_name", ""),
            "project": p.get("code", ""),
            "unit": u.get("code", ""),
            "status": r.get("status", ""),
            "legal_ready": bool(readiness.get("legal_ready")),
            "tds_ready": bool(readiness.get("tds_ready")),
            "fc_ready": bool(readiness.get("fc_ready")),
            "availability_confirmed": r.get("status") in ("Availability Confirmed", "Slot Booked", "Executed", "Closed"),
            "slot_date": (r.get("slot_date") or "")[:10],
            "days_since_availability_confirmed": days_ac,
        })
    return rows


@router.get("/registration-pipeline")
async def registration_pipeline(project_id: Optional[str] = None, format: str = "json", current_user: dict = Depends(get_current_user)):
    db = get_db()
    bset, _ = await _scope_ctx(current_user)
    if bset is not None and not bset:
        rows = []
    else:
        rows = await _registration_pipeline_rows(db, project_id, scope_bids=bset)
    if format == "csv":
        return _csv_response(rows, "registration-pipeline.csv")
    return rows


async def _collections_ageing_rows(db, project_id: Optional[str], scope_bids: set | None = None) -> list[dict]:
    milestones = await db.payment_milestones.find({"status": "Overdue"}, {"_id": 0}).to_list(2000)
    bookings = {b["id"]: b async for b in db.bookings.find({}, {"_id": 0})}
    if project_id:
        milestones = [m for m in milestones if bookings.get(m.get("booking_id"), {}).get("project_id") == project_id]
    if scope_bids is not None:
        milestones = [m for m in milestones if m.get("booking_id") in scope_bids]
    cust_ids = list({b.get("customer_id") for b in bookings.values()})
    customers = {c["id"]: c async for c in db.customers.find({"id": {"$in": cust_ids}}, {"_id": 0})}
    projects = {p["id"]: p async for p in db.projects.find({}, {"_id": 0})}
    rows = []
    for m in milestones:
        b = bookings.get(m.get("booking_id"), {})
        c = customers.get(b.get("customer_id"), {})
        p = projects.get(b.get("project_id"), {})
        due = m.get("due_date") or m.get("planned_date") or ""
        age = _days_since(due) if due else 0
        if age < 0: age = 0
        rows.append({
            "customer_code": c.get("code", ""),
            "customer_name": c.get("primary_name", ""),
            "project": p.get("code", ""),
            "milestone_name": m.get("name", ""),
            "amount_inr": m.get("amount_inr", 0),
            "due_date": due[:10] if due else "",
            "days_overdue": age,
            "bucket": "0-30" if age <= 30 else "31-60" if age <= 60 else "61-90" if age <= 90 else "91-180" if age <= 180 else "181-365" if age <= 365 else "365+",
        })
    return rows


@router.get("/collections-ageing")
async def collections_ageing(project_id: Optional[str] = None, format: str = "json", current_user: dict = Depends(get_current_user)):
    db = get_db()
    bset, _ = await _scope_ctx(current_user)
    if bset is not None and not bset:
        rows = []
    else:
        rows = await _collections_ageing_rows(db, project_id, scope_bids=bset)
    if format == "csv":
        return _csv_response(rows, "collections-ageing.csv")
    return rows


@router.get("/escalations")
async def escalations_report(
    severity: Optional[str] = None,
    status: Optional[str] = None,
    format: str = "json",
    current_user: dict = Depends(get_current_user),
):
    db = get_db()
    _, cset = await _scope_ctx(current_user)
    q: dict = {}
    if severity: q["severity"] = severity
    if status: q["status"] = status
    if cset is not None:
        if not cset:
            return _csv_response([], "escalations.csv") if format == "csv" else []
        q["customer_id"] = {"$in": list(cset)}
    docs = await db.escalations.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    cust_ids = list({d.get("customer_id") for d in docs if d.get("customer_id")})
    customers = {c["id"]: c async for c in db.customers.find({"id": {"$in": cust_ids}}, {"_id": 0})}
    dept_ids = list({d.get("department_id") for d in docs if d.get("department_id")})
    depts = {x["id"]: x async for x in db.departments.find({"id": {"$in": dept_ids}}, {"_id": 0})}
    rows = []
    for d in docs:
        c = customers.get(d.get("customer_id"), {})
        dep = depts.get(d.get("department_id"), {})
        rows.append({
            "code": d.get("code", ""),
            "rule_key": d.get("rule_key", ""),
            "severity": d.get("severity", ""),
            "status": d.get("status", ""),
            "customer_code": c.get("code", ""),
            "customer_name": c.get("primary_name", ""),
            "department": dep.get("name", ""),
            "source_entity_type": d.get("source_entity_type", ""),
            "title": d.get("title", ""),
            "created_at": (d.get("created_at") or "")[:10],
            "age_days": _days_since(d.get("created_at")),
            "resolved_at": (d.get("resolved_at") or "")[:10] if d.get("resolved_at") else "",
        })
    if format == "csv":
        return _csv_response(rows, "escalations.csv")
    return rows


@router.get("/commitments")
async def commitments_report(status: Optional[str] = None, overdue: bool = False, format: str = "json", current_user: dict = Depends(get_current_user)):
    db = get_db()
    _, cset = await _scope_ctx(current_user)
    q: dict = {}
    if status: q["delivery_status"] = status
    if cset is not None:
        if not cset:
            return _csv_response([], "commitments.csv") if format == "csv" else []
        q["customer_id"] = {"$in": list(cset)}
    docs = await db.customer_commitments.find(q, {"_id": 0}).sort("target_date", 1).to_list(2000)
    cust_ids = list({d.get("customer_id") for d in docs})
    customers = {c["id"]: c async for c in db.customers.find({"id": {"$in": cust_ids}}, {"_id": 0})}
    rows = []
    for d in docs:
        age = _days_since(d.get("target_date")) if d.get("target_date") else 0
        if overdue and age <= 0: continue
        c = customers.get(d.get("customer_id"), {})
        rows.append({
            "code": d.get("code", ""),
            "customer_code": c.get("code", ""),
            "customer_name": c.get("primary_name", ""),
            "title": d.get("title", ""),
            "delivery_status": d.get("delivery_status", ""),
            "target_date": (d.get("target_date") or "")[:10],
            "days_overdue": age if age > 0 else 0,
        })
    if format == "csv":
        return _csv_response(rows, "commitments.csv")
    return rows


@router.get("/department-sla")
async def department_sla(format: str = "json", current_user: dict = Depends(get_current_user)):
    db = get_db()
    depts = await db.departments.find({}, {"_id": 0}).to_list(50)
    rows = []
    for d in depts:
        open_esc = await db.escalations.find(
            {"department_id": d["id"], "status": {"$in": list(OPEN_STATUSES)}}, {"_id": 0, "created_at": 1},
        ).to_list(2000)
        ages = [_days_since(e["created_at"]) for e in open_esc]
        exceeding = sum(1 for a in ages if a >= 7)  # simple SLA = 7 days
        rows.append({
            "department_code": d.get("code", ""),
            "department": d.get("name", ""),
            "open_escalations": len(open_esc),
            "exceeding_sla_7d": exceeding,
            "median_age_days": int(median(ages)) if ages else 0,
        })
    if format == "csv":
        return _csv_response(rows, "department-sla.csv")
    return rows


@router.get("/handover-delay")
async def handover_delay(format: str = "json", current_user: dict = Depends(get_current_user)):
    db = get_db()
    bset, _ = await _scope_ctx(current_user)
    docs = await db.handovers.find({"date_revision_history": {"$exists": True, "$ne": []}}, {"_id": 0}).to_list(2000)
    if bset is not None:
        if not bset:
            return _csv_response([], "handover-delay.csv") if format == "csv" else []
        docs = [d for d in docs if d.get("booking_id") in bset]
    bookings = {b["id"]: b async for b in db.bookings.find({}, {"_id": 0})}
    cust_ids = list({b.get("customer_id") for b in bookings.values()})
    customers = {c["id"]: c async for c in db.customers.find({"id": {"$in": cust_ids}}, {"_id": 0})}
    rows = []
    for h in docs:
        hist = h.get("date_revision_history", [])
        if not hist: continue
        original = next((r["previous_value"] for r in hist if r.get("previous_value")), hist[0].get("new_value"))
        latest = hist[-1].get("new_value")
        slippage = 0
        if original and latest:
            try:
                d1 = datetime.fromisoformat(original.replace("Z", "+00:00"))
                d2 = datetime.fromisoformat(latest.replace("Z", "+00:00"))
                slippage = (d2 - d1).days
            except Exception:
                pass
        b = bookings.get(h["booking_id"], {})
        c = customers.get(b.get("customer_id"), {})
        rows.append({
            "customer_code": c.get("code", ""),
            "customer_name": c.get("primary_name", ""),
            "original_date": (original or "")[:10],
            "latest_date": (latest or "")[:10],
            "total_slippage_days": slippage,
            "revisions": len(hist),
        })
    if format == "csv":
        return _csv_response(rows, "handover-delay.csv")
    return rows


@router.get("/tds-pending")
async def tds_pending(format: str = "json", current_user: dict = Depends(get_current_user)):
    db = get_db()
    bset, _ = await _scope_ctx(current_user)
    q: dict = {"status": {"$in": ["Applicable", "Pending"]}}
    if bset is not None:
        if not bset:
            return _csv_response([], "tds-pending.csv") if format == "csv" else []
        q["booking_id"] = {"$in": list(bset)}
    docs = await db.tds_records.find(q, {"_id": 0}).to_list(2000)
    cust_ids = list({d.get("customer_id") for d in docs if d.get("customer_id")})
    customers = {c["id"]: c async for c in db.customers.find({"id": {"$in": cust_ids}}, {"_id": 0})}
    rows = []
    for d in docs:
        c = customers.get(d.get("customer_id"), {})
        rows.append({
            "customer_code": c.get("code", ""),
            "customer_name": c.get("primary_name", ""),
            "status": d.get("status", ""),
            "amount_inr": d.get("amount_inr", 0),
            "created_at": (d.get("created_at") or "")[:10],
            "days_open": _days_since(d.get("created_at")),
        })
    if format == "csv":
        return _csv_response(rows, "tds-pending.csv")
    return rows
