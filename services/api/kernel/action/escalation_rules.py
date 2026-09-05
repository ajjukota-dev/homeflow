"""Phase 8 hardcoded escalation rules.

Each rule scans a specific collection and yields candidate escalation dicts.
`scan_all()` runs the full registry once. Individual event handlers can invoke
`run_rule(key)` for a focused re-check when a mutation happens.

Idempotency: an escalation is uniquely keyed by (rule_key, source_entity_id).
`open` statuses are {Open, Acknowledged, In Progress}. If the underlying
condition clears while an escalation is still open → auto-close it.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Awaitable

from kernel.mongo import get_db, next_sequence


OPEN_STATUSES = {"Open", "Acknowledged", "In Progress"}
_now = lambda: datetime.now(timezone.utc)
_uid = lambda: str(uuid.uuid4())


def _days_ago(iso: str | None) -> int:
    if not iso:
        return 0
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except Exception:
        return 0
    return (_now() - dt).days


async def _dept_id(db, code: str) -> str | None:
    d = await db.departments.find_one({"code": code}, {"_id": 0, "id": 1})
    return (d or {}).get("id")


# =============== Rule detectors ===============

async def _r_commitment_overdue(db, days: int) -> list[dict]:
    docs = await db.customer_commitments.find(
        {"delivery_status": {"$in": ["Awaiting Approval", "In Progress"]}},
        {"_id": 0},
    ).to_list(2000)
    out = []
    for d in docs:
        if not d.get("target_date"): continue
        if _days_ago(d["target_date"]) < days: continue
        out.append({
            "source_entity_type": "commitment",
            "source_entity_id": d["id"],
            "customer_id": d.get("customer_id"),
            "booking_id": d.get("booking_id"),
            "title": f"Commitment overdue >{days}d — {d.get('title', 'Untitled')[:60]}",
            "description": f"Commitment {d.get('title')} target_date={d.get('target_date')}, delivery_status={d.get('delivery_status')}.",
        })
    return out


async def _r_payment_overdue(db, days: int) -> list[dict]:
    docs = await db.payment_milestones.find(
        {"status": "Overdue"}, {"_id": 0},
    ).to_list(2000)
    out = []
    for d in docs:
        due = d.get("due_date") or d.get("planned_date")
        if not due or _days_ago(due) < days: continue
        out.append({
            "source_entity_type": "payment_milestone",
            "source_entity_id": d["id"],
            "customer_id": d.get("customer_id"),
            "booking_id": d.get("booking_id"),
            "title": f"Payment overdue >{days}d — {d.get('name','milestone')}",
            "description": f"Milestone {d.get('name')}: due {due}, status Overdue, amount ₹{d.get('amount_inr',0):,}.",
        })
    return out


async def _r_tds_pending_5d(db) -> list[dict]:
    docs = await db.tds_records.find(
        {"status": {"$in": ["Applicable", "Pending"]}}, {"_id": 0},
    ).to_list(2000)
    out = []
    for d in docs:
        if _days_ago(d.get("created_at")) < 5: continue
        out.append({
            "source_entity_type": "tds_record",
            "source_entity_id": d["id"],
            "customer_id": d.get("customer_id"),
            "booking_id": d.get("booking_id"),
            "title": f"TDS pending verification >5d",
            "description": f"TDS record status={d.get('status')} since {d.get('created_at','')[:10]}.",
        })
    return out


async def _r_loan_sanction_delay_15d(db) -> list[dict]:
    docs = await db.loan_cases.find(
        {"current_stage": {"$in": ["Application", "Sanction Pending"]}}, {"_id": 0},
    ).to_list(2000)
    bookings = {b["id"]: b async for b in db.bookings.find({}, {"_id": 0, "id": 1, "customer_id": 1})}
    out = []
    for d in docs:
        if _days_ago(d.get("created_at")) < 15: continue
        b = bookings.get(d.get("booking_id"), {})
        out.append({
            "source_entity_type": "loan_case",
            "source_entity_id": d["id"],
            "customer_id": b.get("customer_id"),
            "booking_id": d.get("booking_id"),
            "title": f"Loan sanction pending >15d — {d.get('bank_name','Bank')}",
            "description": f"Loan stage={d.get('current_stage')} since {d.get('created_at','')[:10]}. Bank: {d.get('bank_name')}.",
        })
    return out


async def _r_loan_sanction_validity_7d(db) -> list[dict]:
    docs = await db.loan_cases.find(
        {"sanction_validity_date": {"$ne": None}, "current_stage": {"$ne": "Fully Disbursed"}}, {"_id": 0},
    ).to_list(2000)
    bookings = {b["id"]: b async for b in db.bookings.find({}, {"_id": 0, "id": 1, "customer_id": 1})}
    out = []
    for d in docs:
        sv = d.get("sanction_validity_date")
        if not sv: continue
        days_left = -_days_ago(sv)
        if not (0 <= days_left <= 7): continue
        b = bookings.get(d.get("booking_id"), {})
        out.append({
            "source_entity_type": "loan_case",
            "source_entity_id": d["id"],
            "customer_id": b.get("customer_id"),
            "booking_id": d.get("booking_id"),
            "title": f"Loan sanction validity expiring in {days_left}d",
            "description": f"Sanction validity {sv[:10]}. Not fully disbursed.",
        })
    return out


async def _r_legal_pending_5d(db) -> list[dict]:
    docs = await db.legal_records.find(
        {"status": {"$in": ["Under Review", "Deviations Raised"]}}, {"_id": 0},
    ).to_list(2000)
    bookings = {b["id"]: b async for b in db.bookings.find({}, {"_id": 0, "id": 1, "customer_id": 1})}
    out = []
    for d in docs:
        if _days_ago(d.get("updated_at")) < 5: continue
        b = bookings.get(d.get("booking_id"), {})
        out.append({
            "source_entity_type": "legal_record",
            "source_entity_id": d["id"],
            "customer_id": b.get("customer_id"),
            "booking_id": d.get("booking_id"),
            "title": f"Legal review pending >5d",
            "description": f"Legal status={d.get('status')} since {d.get('updated_at','')[:10]}.",
        })
    return out


async def _r_registration_ready_slot_not_booked_3d(db) -> list[dict]:
    docs = await db.registrations.find(
        {"status": "Availability Confirmed", "slot_date": None}, {"_id": 0},
    ).to_list(2000)
    bookings = {b["id"]: b async for b in db.bookings.find({}, {"_id": 0, "id": 1, "customer_id": 1})}
    out = []
    for d in docs:
        if _days_ago(d.get("updated_at")) < 3: continue
        b = bookings.get(d.get("booking_id"), {})
        out.append({
            "source_entity_type": "registration",
            "source_entity_id": d["id"],
            "customer_id": b.get("customer_id"),
            "booking_id": d.get("booking_id"),
            "title": f"Registration ready — slot not booked >3d",
            "description": f"Availability confirmed on {d.get('updated_at','')[:10]}, slot still unbooked.",
        })
    return out


async def _r_critical_snag_open(db, days: int = 2) -> list[dict]:
    docs = await db.snags.find(
        {"severity": "Critical", "status": {"$nin": ["Closed"]}}, {"_id": 0},
    ).to_list(2000)
    bookings = {b["id"]: b async for b in db.bookings.find({}, {"_id": 0, "id": 1, "customer_id": 1})}
    out = []
    for d in docs:
        if _days_ago(d.get("created_at")) < days: continue
        b = bookings.get(d.get("booking_id"), {})
        out.append({
            "source_entity_type": "snag",
            "source_entity_id": d["id"],
            "customer_id": b.get("customer_id"),
            "booking_id": d.get("booking_id"),
            "title": f"Critical snag open >{days}d — {d.get('code','')}",
            "description": f"{d.get('room','')} · {d.get('category','')} · {d.get('description','')[:120]}",
        })
    return out


async def _r_handover_at_risk(db, days: int) -> list[dict]:
    docs = await db.handovers.find({"scheduled.final_date": {"$ne": None}}, {"_id": 0}).to_list(2000)
    bookings = {b["id"]: b async for b in db.bookings.find({}, {"_id": 0, "id": 1, "customer_id": 1})}
    # Import _readiness_score locally to avoid circular
    from modules.qa.handovers import _readiness_score, _apply_override
    out = []
    for d in docs:
        fd = d.get("scheduled", {}).get("final_date")
        if not fd: continue
        days_left = -_days_ago(fd)
        if not (0 <= days_left <= days): continue
        r = await _readiness_score(db, d["booking_id"])
        ov = _apply_override(r, d.get("override"))
        if ov["gate_status"] not in ("Amber", "Red"): continue
        b = bookings.get(d.get("booking_id"), {})
        out.append({
            "source_entity_type": "handover",
            "source_entity_id": d["id"],
            "customer_id": b.get("customer_id"),
            "booking_id": d.get("booking_id"),
            "title": f"Handover at risk (gate={ov['gate_status']}) — final in {days_left}d",
            "description": f"Final date {fd[:10]}. Blockers: {'; '.join(ov['gate_blockers'][:3])}",
        })
    return out


async def _r_customer_query_unresolved_48h(db) -> list[dict]:
    docs = await db.communications.find(
        {"direction": "Inbound", "follow_up_required": True}, {"_id": 0},
    ).to_list(2000)
    out = []
    for d in docs:
        fud = d.get("follow_up_date")
        if not fud or _days_ago(fud) < 2: continue
        out.append({
            "source_entity_type": "communication",
            "source_entity_id": d["id"],
            "customer_id": d.get("customer_id"),
            "booking_id": d.get("booking_id"),
            "title": f"Customer follow-up overdue >48h — {d.get('subject','')[:60]}",
            "description": f"{d.get('channel')} on {(d.get('communicated_at') or '')[:10]}: {d.get('summary','')[:120]}",
        })
    return out


# =============== Rule registry ===============

RULES: dict[str, dict[str, Any]] = {
    "commitment_overdue_3d":              {"sev": "Medium",   "dept_code": "CRM",          "run": lambda db: _r_commitment_overdue(db, 3)},
    "commitment_overdue_7d":              {"sev": "High",     "dept_code": "CRM",          "run": lambda db: _r_commitment_overdue(db, 7)},
    "payment_overdue_15d":                {"sev": "High",     "dept_code": "ACCOUNTS",     "run": lambda db: _r_payment_overdue(db, 15)},
    "payment_overdue_30d":                {"sev": "Critical", "dept_code": "ACCOUNTS",     "run": lambda db: _r_payment_overdue(db, 30)},
    "tds_pending_verification_5d":        {"sev": "Medium",   "dept_code": "ACCOUNTS",     "run": _r_tds_pending_5d},
    "loan_sanction_delay_15d":            {"sev": "High",     "dept_code": "BANKING",      "run": _r_loan_sanction_delay_15d},
    "loan_sanction_validity_expiring_7d": {"sev": "High",     "dept_code": "BANKING",      "run": _r_loan_sanction_validity_7d},
    "legal_review_pending_5d":            {"sev": "Medium",   "dept_code": "LEGAL",        "run": _r_legal_pending_5d},
    "registration_ready_slot_not_booked_3d": {"sev": "High",  "dept_code": "REGISTRATION", "run": _r_registration_ready_slot_not_booked_3d},
    "critical_snag_open_2d":              {"sev": "Critical", "dept_code": "QA",           "run": lambda db: _r_critical_snag_open(db, 2)},
    "handover_at_risk_15d":               {"sev": "High",     "dept_code": "HANDOVER",     "run": lambda db: _r_handover_at_risk(db, 15)},
    "handover_at_risk_7d":                {"sev": "Critical", "dept_code": "HANDOVER",     "run": lambda db: _r_handover_at_risk(db, 7)},
    "customer_query_unresolved_48h":      {"sev": "Medium",   "dept_code": "CRM",          "run": _r_customer_query_unresolved_48h},
}


async def _create_escalation(db, key: str, rule: dict, cand: dict) -> str:
    seq = await next_sequence("escalation")
    dept_id = await _dept_id(db, rule["dept_code"])
    doc = {
        "id": _uid(),
        "code": f"ESC-{seq:06d}",
        "rule_key": key,
        "customer_id": cand.get("customer_id"),
        "unit_id": None,
        "booking_id": cand.get("booking_id"),
        "journey_id": None,
        "department_id": dept_id,
        "owner_user_id": None,
        "severity": rule["sev"],
        "status": "Open",
        "title": cand["title"],
        "description": cand.get("description", ""),
        "source_entity_type": cand.get("source_entity_type"),
        "source_entity_id": cand.get("source_entity_id"),
        "due_date": None,
        "resolution_notes": None,
        "acknowledged_by": None, "acknowledged_at": None,
        "resolved_by": None, "resolved_at": None,
        "closed_by": None, "closed_at": None,
        "created_at": _now().isoformat(),
        "updated_at": _now().isoformat(),
    }
    await db.escalations.insert_one(doc)
    doc.pop("_id", None)
    # Notify department members
    if dept_id:
        users = await db.users.find({"department_id": dept_id, "active": True}, {"_id": 0, "id": 1}).to_list(200)
        if users:
            from kernel.collaboration.collaboration import notify_users as _notify
            await _notify(
                user_ids=[u["id"] for u in users], actor_user_id=None,
                type_="ESCALATION_CREATED", entity_type="escalation", entity_id=doc["id"],
                title=cand["title"], body=cand.get("description", "")[:200],
            )
    return doc["id"]


async def run_rule(key: str) -> dict:
    """Run one rule; create new escalations, auto-close obsolete ones."""
    if key not in RULES:
        return {"created": 0, "auto_closed": 0, "unchanged": 0}
    db = get_db()
    rule = RULES[key]
    candidates = await rule["run"](db)
    active_ids = {c["source_entity_id"] for c in candidates if c.get("source_entity_id")}
    created = unchanged = 0
    for c in candidates:
        if not c.get("source_entity_id"): continue
        existing = await db.escalations.find_one(
            {"rule_key": key, "source_entity_id": c["source_entity_id"], "status": {"$in": list(OPEN_STATUSES)}},
            {"_id": 0, "id": 1},
        )
        if existing:
            unchanged += 1
        else:
            await _create_escalation(db, key, rule, c)
            created += 1

    # Auto-close open escalations that no longer match the source condition
    open_docs = await db.escalations.find(
        {"rule_key": key, "status": {"$in": list(OPEN_STATUSES)}},
        {"_id": 0},
    ).to_list(2000)
    auto_closed = 0
    for e in open_docs:
        if e.get("source_entity_id") not in active_ids:
            now = _now().isoformat()
            await db.escalations.update_one(
                {"id": e["id"]},
                {"$set": {
                    "status": "Closed",
                    "resolution_notes": "Auto-resolved: condition no longer met",
                    "resolved_at": now, "closed_at": now,
                    "updated_at": now,
                }},
            )
            auto_closed += 1
    return {"created": created, "auto_closed": auto_closed, "unchanged": unchanged}


async def scan_all() -> dict:
    """Full registry sweep — used by boot-time seed + POST /escalations/scan."""
    totals = {"created": 0, "auto_closed": 0, "unchanged": 0, "by_rule": {}}
    for key in RULES:
        r = await run_rule(key)
        totals["created"] += r["created"]
        totals["auto_closed"] += r["auto_closed"]
        totals["unchanged"] += r["unchanged"]
        totals["by_rule"][key] = r
    return totals


async def run_event_rules_for_entity(source_entity_type: str) -> dict:
    """Focused re-check for rules attached to a specific source entity type."""
    mapping = {
        "snag": ["critical_snag_open_2d"],
        "commitment": ["commitment_overdue_3d", "commitment_overdue_7d"],
        "payment_milestone": ["payment_overdue_15d", "payment_overdue_30d"],
        "handover": ["handover_at_risk_15d", "handover_at_risk_7d"],
        "loan_case": ["loan_sanction_delay_15d", "loan_sanction_validity_expiring_7d"],
        "legal_record": ["legal_review_pending_5d"],
        "registration": ["registration_ready_slot_not_booked_3d"],
        "tds_record": ["tds_pending_verification_5d"],
        "communication": ["customer_query_unresolved_48h"],
    }
    keys = mapping.get(source_entity_type, [])
    totals = {"created": 0, "auto_closed": 0, "unchanged": 0}
    for k in keys:
        r = await run_rule(k)
        totals["created"] += r["created"]
        totals["auto_closed"] += r["auto_closed"]
        totals["unchanged"] += r["unchanged"]
    return totals
