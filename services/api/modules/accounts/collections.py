"""Collections — read-only aggregations over payment_milestones + payments."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict

from kernel.identity.auth_utils import get_current_user
from kernel.identity.auth_scope import (
    get_project_scope, is_all_projects_user, require_customer_access_soft,
    scoped_booking_ids, scoped_customer_ids, require_module_by_method
)
from kernel.mongo import get_db
from kernel.identity.rbac_redact import apply_financial_redactions
from modules.accounts.payments import _milestone_with_computed


router = APIRouter(prefix="/collections", tags=["collections"], dependencies=[Depends(require_module_by_method("collections"))])


def _now_dt() -> datetime:
    return datetime.now(timezone.utc)


def _bucket(days_overdue: int) -> str:
    if days_overdue <= 0:
        return "Current"
    if days_overdue <= 7:
        return "1-7"
    if days_overdue <= 15:
        return "8-15"
    if days_overdue <= 30:
        return "16-30"
    if days_overdue <= 60:
        return "31-60"
    if days_overdue <= 90:
        return "61-90"
    return "90+"


BUCKETS = ["Current", "1-7", "8-15", "16-30", "31-60", "61-90", "90+"]


@router.get("/customer/{customer_id}")
async def customer_snapshot(customer_id: str, current_user: dict = Depends(get_current_user)):
    """§45 financial snapshot: totals + next due milestone + TDS + FC status."""
    db = get_db()
    customer = await db.customers.find_one({"id": customer_id}, {"_id": 0})
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    await require_customer_access_soft(current_user, customer_id)
    bookings = await db.bookings.find({"customer_id": customer_id}, {"_id": 0}).to_list(50)
    # For phase 5 we surface aggregation over all bookings for this customer.
    total_agreement = sum(float(b.get("agreement_value_inr") or 0) for b in bookings)
    booking_ids = [b["id"] for b in bookings]

    milestones = await db.payment_milestones.aggregate([
        {"$lookup": {"from": "payment_schedules", "localField": "payment_schedule_id", "foreignField": "id", "as": "sched"}},
        {"$unwind": "$sched"},
        {"$match": {"sched.booking_id": {"$in": booking_ids}}},
        {"$project": {"_id": 0, "sched": 0}},
    ]).to_list(500)

    computed = [await _milestone_with_computed(db, m) for m in milestones]
    received_verified = sum(m["received_verified_inr"] for m in computed)
    received_pending = sum(m["received_pending_inr"] for m in computed)
    outstanding = sum(m["balance_inr"] for m in computed)
    overdue = sum(m["balance_inr"] for m in computed if m["status"] == "Overdue")
    future = sum(m["balance_inr"] for m in computed if m["status"] in ("Not Due", "Due Soon", "Due"))

    # Next due — earliest milestone that isn't Paid/Waived
    outstanding_ms = [m for m in computed if m["status"] not in ("Paid", "Waived")]
    outstanding_ms.sort(key=lambda x: x.get("due_date") or "")
    next_due = outstanding_ms[0] if outstanding_ms else None

    tds = None
    if bookings:
        tds_docs = await db.tds_records.find({"booking_id": {"$in": booking_ids}}, {"_id": 0}).to_list(20)
        if tds_docs:
            tds = tds_docs[0]  # single-booking case common
    fc = None
    if bookings:
        fc_docs = await db.financial_clearances.find({"booking_id": {"$in": booking_ids}}, {"_id": 0}).to_list(20)
        if fc_docs:
            fc = fc_docs[0]

    return apply_financial_redactions({
        "customer_id": customer_id,
        "agreement_value_inr": round(total_agreement, 2),
        "received_verified_inr": round(received_verified, 2),
        "received_pending_inr": round(received_pending, 2),
        "outstanding_inr": round(outstanding, 2),
        "outstanding_including_pending_inr": round(outstanding - received_pending, 2),
        "overdue_inr": round(overdue, 2),
        "future_receivable_inr": round(future, 2),
        "next_due_milestone": {
            "name": next_due["milestone_name"],
            "due_date": next_due["due_date"],
            "total_due_inr": next_due["total_due_inr"],
            "balance_inr": next_due["balance_inr"],
        } if next_due else None,
        "tds_status": {
            "applicability": (tds or {}).get("applicability"),
            "verification_status": (tds or {}).get("verification_status"),
        },
        "financial_clearance_status": (fc or {}).get("status"),
    }, current_user, module="customer_financials")


@router.get("/dashboard")
async def dashboard(current_user: dict = Depends(get_current_user)):
    """Org-wide totals (scoped for non-admin)."""
    db = get_db()
    milestones = await db.payment_milestones.find({}, {"_id": 0}).to_list(5000)
    # Phase 9 scope
    if not is_all_projects_user(current_user):
        bids = await scoped_booking_ids(current_user) or []
        if not bids:
            return {"total_due_inr": 0, "total_received_inr": 0, "total_outstanding_inr": 0,
                    "total_overdue_inr": 0, "bookings_with_overdue": 0,
                    "tds_pending_verification": 0, "financial_clearances_pending": 0}
        # Filter milestones by schedule → booking_id
        sched_ids = [s["id"] async for s in db.payment_schedules.find({"booking_id": {"$in": bids}}, {"_id": 0, "id": 1})]
        milestones = [m for m in milestones if m.get("payment_schedule_id") in set(sched_ids)]
    computed = [await _milestone_with_computed(db, m) for m in milestones]
    total_due = sum(m.get("total_due_inr") or 0 for m in computed)
    received = sum(m["received_verified_inr"] for m in computed)
    outstanding = sum(m["balance_inr"] for m in computed)
    overdue = sum(m["balance_inr"] for m in computed if m["status"] == "Overdue")
    booking_ids_overdue = set()
    for m in computed:
        if m["status"] == "Overdue":
            sched = await db.payment_schedules.find_one({"id": m["payment_schedule_id"]}, {"_id": 0, "booking_id": 1})
            if sched:
                booking_ids_overdue.add(sched["booking_id"])
    tds_pending = await db.tds_records.count_documents({"applicability": "Applicable", "verification_status": {"$in": ["Pending", "Rejected"]}})
    fc_pending = await db.financial_clearances.count_documents({"status": "Pending"})
    # Scope tds/fc counts for non-admin
    if not is_all_projects_user(current_user):
        bids = await scoped_booking_ids(current_user) or []
        if not bids:
            tds_pending, fc_pending = 0, 0
        else:
            tds_pending = await db.tds_records.count_documents({
                "applicability": "Applicable", "verification_status": {"$in": ["Pending", "Rejected"]},
                "booking_id": {"$in": bids},
            })
            fc_pending = await db.financial_clearances.count_documents({"status": "Pending", "booking_id": {"$in": bids}})

    return apply_financial_redactions({
        "total_due_inr": round(total_due, 2),
        "total_received_inr": round(received, 2),
        "total_outstanding_inr": round(outstanding, 2),
        "total_overdue_inr": round(overdue, 2),
        "bookings_with_overdue": len(booking_ids_overdue),
        "tds_pending_verification": tds_pending,
        "financial_clearances_pending": fc_pending,
    }, current_user, module="collections")


@router.get("/counts/due-this-week")
async def counts_due_this_week(current_user: dict = Depends(get_current_user)):
    db = get_db()
    milestones = await db.payment_milestones.find({}, {"_id": 0}).to_list(5000)
    # Phase 9 scope
    if not is_all_projects_user(current_user):
        bids = await scoped_booking_ids(current_user) or []
        if not bids: return {"count": 0}
        sched_ids = [s["id"] async for s in db.payment_schedules.find({"booking_id": {"$in": bids}}, {"_id": 0, "id": 1})]
        milestones = [m for m in milestones if m.get("payment_schedule_id") in set(sched_ids)]
    n = 0
    for m in milestones:
        c = await _milestone_with_computed(db, m)
        if c["status"] in ("Due Soon", "Due") and c["balance_inr"] > 0:
            n += 1
    return {"count": n}


@router.get("/counts/overdue-30")
async def counts_overdue_30(current_user: dict = Depends(get_current_user)):
    db = get_db()
    milestones = await db.payment_milestones.find({}, {"_id": 0}).to_list(5000)
    # Phase 9 scope
    if not is_all_projects_user(current_user):
        bids = await scoped_booking_ids(current_user) or []
        if not bids: return {"count": 0}
        sched_ids = [s["id"] async for s in db.payment_schedules.find({"booking_id": {"$in": bids}}, {"_id": 0, "id": 1})]
        milestones = [m for m in milestones if m.get("payment_schedule_id") in set(sched_ids)]
    n = 0
    for m in milestones:
        c = await _milestone_with_computed(db, m)
        if c["status"] == "Overdue" and c["days_delta"] >= 30 and c["balance_inr"] > 0:
            n += 1
    return {"count": n}


@router.get("/ageing")
async def ageing(
    project_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """§88 bucketing over all overdue milestones."""
    db = get_db()
    milestones = await db.payment_milestones.find({}, {"_id": 0}).to_list(5000)
    # Phase 9 scope
    scope_bids: set | None = None
    if not is_all_projects_user(current_user):
        bids = await scoped_booking_ids(current_user) or []
        if not bids:
            return {"buckets": {b: {"count": 0, "amount": 0.0} for b in BUCKETS}, "rows": []}
        sched_ids = [s["id"] async for s in db.payment_schedules.find({"booking_id": {"$in": bids}}, {"_id": 0, "id": 1})]
        milestones = [m for m in milestones if m.get("payment_schedule_id") in set(sched_ids)]
        scope_bids = set(bids)
    rows = []
    bucket_counts: dict[str, dict] = {b: {"count": 0, "amount": 0.0} for b in BUCKETS}
    for m in milestones:
        c = await _milestone_with_computed(db, m)
        if c["status"] not in ("Overdue", "Partially Paid", "Due", "Disputed"):
            # only show items that aren't Paid/Waived and are past due or on due date
            if c["balance_inr"] <= 0:
                continue
            if c["status"] in ("Not Due", "Due Soon"):
                continue
        bkt = _bucket(max(0, c["days_delta"]))
        bucket_counts[bkt]["count"] += 1
        bucket_counts[bkt]["amount"] = round(bucket_counts[bkt]["amount"] + c["balance_inr"], 2)

        sched = await db.payment_schedules.find_one({"id": c["payment_schedule_id"]}, {"_id": 0, "booking_id": 1})
        booking = await db.bookings.find_one({"id": (sched or {}).get("booking_id")}, {"_id": 0}) if sched else None
        if not booking:
            continue
        if project_id and booking.get("project_id") != project_id:
            continue
        if status and c["status"] != status:
            continue
        cust = await db.customers.find_one({"id": booking["customer_id"]}, {"_id": 0, "id": 1, "code": 1, "primary_name": 1})
        proj = await db.projects.find_one({"id": booking["project_id"]}, {"_id": 0, "id": 1, "code": 1, "name": 1})
        unit = await db.units.find_one({"id": booking["unit_id"]}, {"_id": 0, "id": 1, "code": 1})
        rows.append({
            "milestone_id": c["id"],
            "milestone_name": c["milestone_name"],
            "due_date": c["due_date"],
            "days_overdue": c["days_delta"],
            "ageing_bucket": bkt,
            "total_due_inr": c["total_due_inr"],
            "balance_inr": c["balance_inr"],
            "status": c["status"],
            "customer": cust,
            "project": proj,
            "unit": unit,
        })
    return apply_financial_redactions({"buckets": bucket_counts, "rows": rows}, current_user, module="collections")
