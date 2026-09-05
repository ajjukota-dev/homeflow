"""Exec Dashboard router (Phase 8 lean)."""
from __future__ import annotations

from datetime import datetime, timezone
from statistics import median
from typing import Optional

from fastapi import APIRouter, Depends

from kernel.identity.auth_utils import get_current_user
from kernel.identity.auth_scope import (
    get_project_scope, is_all_projects_user, scoped_booking_ids, scoped_customer_ids,
)
from kernel.mongo import get_db
from kernel.action.escalation_rules import OPEN_STATUSES


router = APIRouter(prefix="/exec-dashboard", tags=["exec_dashboard"])


def _now(): return datetime.now(timezone.utc)


def _days_since(iso: str | None) -> int:
    if not iso: return 0
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except Exception:
        return 0
    return (_now() - dt).days


@router.get("/summary")
async def summary(project_id: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    db = get_db()
    now = _now()

    # Phase 9 scope — build effective booking_id/customer_id filters
    all_access = is_all_projects_user(current_user)
    scope = get_project_scope(current_user) or []
    if not all_access and not scope:
        return {
            "active_journeys": 0, "handovers_ready_this_month": 0, "handovers_at_risk_30d": 0,
            "revenue_at_risk_inr": 0, "escalations_open_critical": 0, "escalations_open_high": 0,
            "broken_commitments_overdue": 0, "tds_pending_count": 0, "fc_pending_count": 0,
            "top_5_bottleneck_stages": [],
        }
    effective_scope = None  # None → unlimited
    if not all_access:
        effective_scope = scope[:]
    if project_id:
        if effective_scope is None:
            effective_scope = [project_id]
        else:
            if project_id not in effective_scope:
                return {
                    "active_journeys": 0, "handovers_ready_this_month": 0, "handovers_at_risk_30d": 0,
                    "revenue_at_risk_inr": 0, "escalations_open_critical": 0, "escalations_open_high": 0,
                    "broken_commitments_overdue": 0, "tds_pending_count": 0, "fc_pending_count": 0,
                    "top_5_bottleneck_stages": [],
                }
            effective_scope = [project_id]

    scoped_bids: list[str] | None = None
    scoped_cids: list[str] | None = None
    if effective_scope is not None:
        scoped_bids = [b["id"] async for b in db.bookings.find({"project_id": {"$in": effective_scope}}, {"_id": 0, "id": 1})]
        if not scoped_bids:
            return {
                "active_journeys": 0, "handovers_ready_this_month": 0, "handovers_at_risk_30d": 0,
                "revenue_at_risk_inr": 0, "escalations_open_critical": 0, "escalations_open_high": 0,
                "broken_commitments_overdue": 0, "tds_pending_count": 0, "fc_pending_count": 0,
                "top_5_bottleneck_stages": [],
            }
        scoped_cids = list({b["customer_id"] async for b in db.bookings.find({"id": {"$in": scoped_bids}}, {"_id": 0, "customer_id": 1}) if b.get("customer_id")})

    aj_q: dict = {"status": "Active"}
    if scoped_bids is not None:
        aj_q["booking_id"] = {"$in": scoped_bids}
    active_journeys = await db.customer_journeys.count_documents(aj_q)

    # Handovers this month
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    next_month = (now.replace(day=28) + __import__("datetime").timedelta(days=4)).replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    handover_docs = await db.handovers.find({"scheduled.final_date": {"$gte": month_start, "$lt": next_month}}, {"_id": 0}).to_list(500)
    if scoped_bids is not None:
        handover_docs = [h for h in handover_docs if h.get("booking_id") in set(scoped_bids)]
    from modules.qa.handovers import _readiness_score, _apply_override
    ready_month = 0
    for h in handover_docs:
        r = await _readiness_score(db, h["booking_id"])
        ov = _apply_override(r, h.get("override"))
        if ov["gate_status"] == "Green":
            ready_month += 1

    # At risk in next 30d
    horizon = (now + __import__("datetime").timedelta(days=30)).isoformat()
    at_risk_docs = await db.handovers.find({"scheduled.final_date": {"$gte": now.isoformat(), "$lt": horizon}}, {"_id": 0}).to_list(500)
    if scoped_bids is not None:
        at_risk_docs = [h for h in at_risk_docs if h.get("booking_id") in set(scoped_bids)]
    at_risk_30d = 0
    at_risk_ids: list[str] = []
    for h in at_risk_docs:
        r = await _readiness_score(db, h["booking_id"])
        ov = _apply_override(r, h.get("override"))
        if ov["gate_status"] in {"Amber", "Red"}:
            at_risk_30d += 1
            at_risk_ids.append(h["booking_id"])

    # Revenue at risk
    revenue_at_risk = 0
    risky_journeys = await db.customer_journeys.find(
        {"risk_level": {"$in": ["High", "Critical"]}, "status": "Active", **({"booking_id": {"$in": scoped_bids}} if scoped_bids is not None else {})},
        {"_id": 0, "booking_id": 1},
    ).to_list(500)
    booking_ids_at_risk = list({j["booking_id"] for j in risky_journeys} | set(at_risk_ids))
    if booking_ids_at_risk:
        bookings = await db.bookings.find({"id": {"$in": booking_ids_at_risk}}, {"_id": 0, "agreement_value_inr": 1}).to_list(1000)
        revenue_at_risk = sum(b.get("agreement_value_inr", 0) or 0 for b in bookings)

    # Escalations
    open_q = {"status": {"$in": list(OPEN_STATUSES)}}
    if scoped_cids is not None:
        open_q["customer_id"] = {"$in": scoped_cids}
    esc_critical = await db.escalations.count_documents({**open_q, "severity": "Critical"})
    esc_high = await db.escalations.count_documents({**open_q, "severity": "High"})

    # Broken commitments
    bc_q: dict = {
        "delivery_status": {"$in": ["Awaiting Approval", "In Progress"]},
        "target_date": {"$lt": now.isoformat()},
    }
    if scoped_cids is not None:
        bc_q["customer_id"] = {"$in": scoped_cids}
    broken = await db.customer_commitments.count_documents(bc_q)

    # Pending items
    tds_q: dict = {"status": {"$in": ["Applicable", "Pending"]}}
    fc_q: dict = {"status": {"$ne": "Approved"}}
    if scoped_bids is not None:
        tds_q["booking_id"] = {"$in": scoped_bids}
        fc_q["booking_id"] = {"$in": scoped_bids}
    tds_pending = await db.tds_records.count_documents(tds_q)
    fc_pending = await db.financial_clearances.count_documents(fc_q)

    # Bottleneck stages — median cycle time per stage
    stages = await db.workflow_stages.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(200)
    stage_names = {s["id"]: s["name"] for s in stages}
    inst_q: dict = {"status": "Completed", "started_at": {"$ne": None}, "completed_at": {"$ne": None}}
    if scoped_bids is not None:
        scoped_journey_ids = [j["id"] async for j in db.customer_journeys.find({"booking_id": {"$in": scoped_bids}}, {"_id": 0, "id": 1})]
        if scoped_journey_ids:
            inst_q["journey_id"] = {"$in": scoped_journey_ids}
        else:
            inst_q["journey_id"] = {"$in": []}
    inst = await db.journey_stage_instances.find(
        inst_q,
        {"_id": 0, "stage_id": 1, "started_at": 1, "completed_at": 1},
    ).to_list(5000)
    per_stage: dict[str, list[float]] = {}
    for i in inst:
        try:
            s = datetime.fromisoformat(i["started_at"].replace("Z", "+00:00"))
            c = datetime.fromisoformat(i["completed_at"].replace("Z", "+00:00"))
            days = (c - s).total_seconds() / 86400.0
            per_stage.setdefault(i["stage_id"], []).append(days)
        except Exception:
            continue
    bottlenecks = sorted(
        [{"stage": stage_names.get(sid, "?"), "median_cycle_days": round(median(vals), 2), "n": len(vals)}
         for sid, vals in per_stage.items() if vals],
        key=lambda x: x["median_cycle_days"], reverse=True,
    )[:5]

    return {
        "active_journeys": active_journeys,
        "handovers_ready_this_month": ready_month,
        "handovers_at_risk_30d": at_risk_30d,
        "revenue_at_risk_inr": revenue_at_risk,
        "escalations_open_critical": esc_critical,
        "escalations_open_high": esc_high,
        "broken_commitments_overdue": broken,
        "tds_pending_count": tds_pending,
        "fc_pending_count": fc_pending,
        "top_5_bottleneck_stages": bottlenecks,
    }


@router.get("/exceptions")
async def exceptions(current_user: dict = Depends(get_current_user)):
    """Flat list of items management should see. spec §78."""
    db = get_db()
    now = _now()
    out: list[dict] = []

    # Phase 9 scope
    all_access = is_all_projects_user(current_user)
    scope = get_project_scope(current_user) or []
    if not all_access and not scope:
        return []
    scoped_bids: set | None = None
    scoped_cids: set | None = None
    if not all_access:
        bids = [b["id"] async for b in db.bookings.find({"project_id": {"$in": scope}}, {"_id": 0, "id": 1})]
        if not bids: return []
        scoped_bids = set(bids)
        scoped_cids = set([b["customer_id"] async for b in db.bookings.find({"id": {"$in": bids}, "customer_id": {"$ne": None}}, {"_id": 0, "customer_id": 1})])

    # High/Critical risk journeys
    async for j in db.customer_journeys.find({"risk_level": {"$in": ["High", "Critical"]}, "status": "Active"}, {"_id": 0}):
        if scoped_bids is not None and j.get("booking_id") not in scoped_bids:
            continue
        c = await db.customers.find_one({"id": j["customer_id"]}, {"_id": 0, "code": 1, "primary_name": 1}) if j.get("customer_id") else None
        out.append({
            "type": "journey_high_risk",
            "severity": j["risk_level"],
            "title": f"Journey risk {j['risk_level']} — {(j.get('risk_reasons') or ['n/a'])[0]}",
            "customer_id": j.get("customer_id"),
            "customer_code": (c or {}).get("code"),
            "customer_name": (c or {}).get("primary_name"),
            "related_entity_id": j["id"],
            "age_days": _days_since(j.get("created_at")),
        })

    # Collection overdue > 30d
    async for m in db.payment_milestones.find({"status": "Overdue"}, {"_id": 0}):
        if scoped_cids is not None and m.get("customer_id") and m.get("customer_id") not in scoped_cids:
            continue
        age = _days_since(m.get("due_date") or m.get("planned_date"))
        if age <= 30: continue
        c = await db.customers.find_one({"id": m.get("customer_id")}, {"_id": 0, "code": 1, "primary_name": 1}) if m.get("customer_id") else None
        out.append({
            "type": "collection_overdue_30d",
            "severity": "High",
            "title": f"Payment overdue {age}d — {m.get('name','milestone')}",
            "customer_id": m.get("customer_id"),
            "customer_code": (c or {}).get("code"),
            "customer_name": (c or {}).get("primary_name"),
            "related_entity_id": m["id"],
            "age_days": age,
        })

    # Registrations blocked > 7d
    async for r in db.registrations.find({"status": "Not Started"}, {"_id": 0}):
        if scoped_bids is not None and r.get("booking_id") not in scoped_bids:
            continue
        age = _days_since(r.get("updated_at"))
        if age <= 7: continue
        b = await db.bookings.find_one({"id": r["booking_id"]}, {"_id": 0, "customer_id": 1})
        c = await db.customers.find_one({"id": (b or {}).get("customer_id")}, {"_id": 0, "code": 1, "primary_name": 1}) if b else None
        out.append({
            "type": "registration_blocked",
            "severity": "Medium",
            "title": f"Registration blocked >{age}d (Not Started)",
            "customer_id": (b or {}).get("customer_id"),
            "customer_code": (c or {}).get("code"),
            "customer_name": (c or {}).get("primary_name"),
            "related_entity_id": r["id"],
            "age_days": age,
        })

    # Sanctions expiring in 7d
    async for l in db.loan_cases.find({"sanction_validity_date": {"$ne": None}, "current_stage": {"$ne": "Fully Disbursed"}}, {"_id": 0}):
        if scoped_bids is not None and l.get("booking_id") not in scoped_bids:
            continue
        sv = l.get("sanction_validity_date")
        if not sv: continue
        try:
            days_left = (datetime.fromisoformat(sv.replace("Z", "+00:00")) - now).days
        except Exception:
            continue
        if not (0 <= days_left <= 7): continue
        b = await db.bookings.find_one({"id": l["booking_id"]}, {"_id": 0, "customer_id": 1})
        c = await db.customers.find_one({"id": (b or {}).get("customer_id")}, {"_id": 0, "code": 1, "primary_name": 1}) if b else None
        out.append({
            "type": "sanction_expiring",
            "severity": "High",
            "title": f"Sanction validity expiring in {days_left}d — {l.get('bank_name','Bank')}",
            "customer_id": (b or {}).get("customer_id"),
            "customer_code": (c or {}).get("code"),
            "customer_name": (c or {}).get("primary_name"),
            "related_entity_id": l["id"],
            "age_days": max(0, 7 - days_left),
        })

    # Commitments overdue > 7d
    async for co in db.customer_commitments.find({"delivery_status": {"$in": ["Awaiting Approval", "In Progress"]}}, {"_id": 0}):
        if scoped_cids is not None and co.get("customer_id") not in scoped_cids:
            continue
        age = _days_since(co.get("target_date"))
        if age <= 7: continue
        c = await db.customers.find_one({"id": co.get("customer_id")}, {"_id": 0, "code": 1, "primary_name": 1}) if co.get("customer_id") else None
        out.append({
            "type": "commitment_overdue_7d",
            "severity": "High",
            "title": f"Commitment overdue {age}d — {co.get('title','')[:60]}",
            "customer_id": co.get("customer_id"),
            "customer_code": (c or {}).get("code"),
            "customer_name": (c or {}).get("primary_name"),
            "related_entity_id": co["id"],
            "age_days": age,
        })

    # Critical snags open
    async for sn in db.snags.find({"severity": "Critical", "status": {"$nin": ["Closed"]}}, {"_id": 0}):
        if scoped_bids is not None and sn.get("booking_id") not in scoped_bids:
            continue
        b = await db.bookings.find_one({"id": sn["booking_id"]}, {"_id": 0, "customer_id": 1})
        c = await db.customers.find_one({"id": (b or {}).get("customer_id")}, {"_id": 0, "code": 1, "primary_name": 1}) if b else None
        out.append({
            "type": "critical_snag",
            "severity": "Critical",
            "title": f"Critical snag open — {sn.get('code','')}",
            "customer_id": (b or {}).get("customer_id"),
            "customer_code": (c or {}).get("code"),
            "customer_name": (c or {}).get("primary_name"),
            "related_entity_id": sn["id"],
            "age_days": _days_since(sn.get("created_at")),
        })

    # Escalations SLA breach (>=7d open)
    async for e in db.escalations.find({"status": {"$in": list(OPEN_STATUSES)}}, {"_id": 0}):
        if scoped_cids is not None and e.get("customer_id") and e.get("customer_id") not in scoped_cids:
            continue
        age = _days_since(e.get("created_at"))
        if age < 7: continue
        c = await db.customers.find_one({"id": e.get("customer_id")}, {"_id": 0, "code": 1, "primary_name": 1}) if e.get("customer_id") else None
        out.append({
            "type": "escalation_sla_breach",
            "severity": e.get("severity", "Medium"),
            "title": f"Escalation open {age}d — {e.get('title','')[:60]}",
            "customer_id": e.get("customer_id"),
            "customer_code": (c or {}).get("code"),
            "customer_name": (c or {}).get("primary_name"),
            "related_entity_id": e["id"],
            "age_days": age,
        })

    # Order by severity desc then age desc
    sev_rank = {"Critical": 4, "High": 3, "Medium": 2, "Low": 1}
    out.sort(key=lambda x: (sev_rank.get(x["severity"], 0), x["age_days"]), reverse=True)
    return out
