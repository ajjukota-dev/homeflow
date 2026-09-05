"""Idempotent seed for Phase 1.

Runs on backend boot. If a given collection has zero *seed-relevant* documents
we insert. Existing data is never overwritten. Sign-in is Google OIDC / customer OTP
(technical/03) — this seed writes no credentials.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from kernel.mongo import get_db, next_sequence

logger = logging.getLogger("seed")


ROLES = [
    {"code": "SUPER_ADMIN", "name": "Super Admin", "description": "Full access to everything", "is_super_admin": True},
    {"code": "MANAGEMENT", "name": "Management", "description": "Leadership visibility"},
    {"code": "SALES", "name": "Sales", "description": "Pre-sales + Sales team"},
    {"code": "CRM", "name": "CRM", "description": "Customer relationship management"},
    {"code": "ACCOUNTS", "name": "Accounts", "description": "Finance / collections"},
    {"code": "BANKING", "name": "Banking", "description": "Loan liaison"},
    {"code": "LEGAL", "name": "Legal", "description": "Legal / agreements"},
    {"code": "REGISTRATION", "name": "Registration", "description": "Sub-registrar coordination"},
    {"code": "SITE", "name": "Site", "description": "On-site projects"},
    {"code": "QA", "name": "QA", "description": "Quality assurance / snagging"},
    {"code": "HANDOVER", "name": "Handover", "description": "Customer handover"},
    {"code": "FACILITY", "name": "Facility", "description": "Post-possession facility"},
]

DEPARTMENTS = [
    {"code": "SALES", "name": "Sales"},
    {"code": "CRM", "name": "CRM"},
    {"code": "ACCOUNTS", "name": "Accounts"},
    {"code": "BANKING", "name": "Banking"},
    {"code": "LEGAL", "name": "Legal"},
    {"code": "REGISTRATION", "name": "Registration"},
    {"code": "PROJECTS", "name": "Projects"},
    {"code": "QA", "name": "QA"},
    {"code": "HANDOVER", "name": "Handover"},
    {"code": "FACILITY", "name": "Facility"},
    {"code": "MANAGEMENT", "name": "Management"},
]

ROLE_TO_DEPT = {
    "SUPER_ADMIN": "MANAGEMENT",
    "MANAGEMENT": "MANAGEMENT",
    "SALES": "SALES",
    "CRM": "CRM",
    "ACCOUNTS": "ACCOUNTS",
    "BANKING": "BANKING",
    "LEGAL": "LEGAL",
    "REGISTRATION": "REGISTRATION",
    "SITE": "PROJECTS",
    "QA": "QA",
    "HANDOVER": "HANDOVER",
    "FACILITY": "FACILITY",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid() -> str:
    return str(uuid.uuid4())


async def seed_all():
    db = get_db()

    # Indexes
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.roles.create_index("code", unique=True)
    await db.departments.create_index("code", unique=True)
    await db.projects.create_index("code", unique=True)
    await db.units.create_index([("project_id", 1), ("code", 1)], unique=True)
    await db.customers.create_index("code", unique=True)
    await db.bookings.create_index("code", unique=True)
    await db.audit_logs.create_index("timestamp")
    # Phase 2 indexes
    await db.comments.create_index([("entity_type", 1), ("entity_id", 1)])
    await db.attachments.create_index([("entity_type", 1), ("entity_id", 1), ("filename", 1)])
    await db.notifications.create_index([("user_id", 1), ("read_at", 1), ("created_at", -1)])
    await db.mentions.create_index("comment_id")
    # Phase 4 indexes
    await db.documents.create_index([("customer_id", 1), ("booking_id", 1), ("category", 1)])
    await db.document_versions.create_index([("document_id", 1), ("version", -1)])
    await db.customer_commitments.create_index("code", unique=True)
    await db.customer_commitments.create_index([("customer_id", 1), ("delivery_status", 1)])
    await db.sales_handovers.create_index("booking_id", unique=True)
    # Phase 5 indexes
    await db.payment_schedules.create_index("booking_id", unique=True)
    await db.payment_milestones.create_index([("payment_schedule_id", 1), ("sequence", 1)])
    await db.payments.create_index([("booking_id", 1), ("payment_date", -1)])
    await db.payments.create_index([("milestone_id", 1), ("verification_status", 1)])
    await db.tds_records.create_index("booking_id", unique=True)
    await db.financial_clearances.create_index("booking_id", unique=True)

    # Phase 6 indexes
    await db.loan_cases.create_index("booking_id", unique=True)
    await db.loan_cases.create_index([("current_stage", 1), ("updated_at", -1)])
    await db.loan_events.create_index([("loan_case_id", 1), ("recorded_at", 1)])
    await db.legal_records.create_index("booking_id", unique=True)
    await db.legal_records.create_index([("status", 1), ("updated_at", -1)])
    await db.legal_versions.create_index([("legal_record_id", 1), ("version", -1)])
    await db.registrations.create_index("booking_id", unique=True)
    await db.registrations.create_index([("status", 1), ("slot_date", 1)])

    # Phase 7 indexes
    await db.unit_readiness.create_index("booking_id", unique=True)
    await db.snags.create_index("code", unique=True)
    await db.snags.create_index([("booking_id", 1), ("severity", 1), ("status", 1)])
    await db.handovers.create_index("booking_id", unique=True)

    # Phase 8 indexes
    await db.escalations.create_index("code", unique=True)
    await db.escalations.create_index([("rule_key", 1), ("source_entity_id", 1), ("status", 1)])
    await db.escalations.create_index([("status", 1), ("severity", 1), ("created_at", -1)])
    await db.communications.create_index("code", unique=True)
    await db.communications.create_index([("customer_id", 1), ("communicated_at", -1)])

    await _seed_roles(db)
    await _seed_departments(db)
    await _seed_users(db)
    await _seed_projects_and_units(db)
    await _seed_customers(db)
    await _seed_bookings(db)
    await _seed_collaboration(db)
    await _seed_workflow_templates(db)
    await _seed_journeys_for_confirmed_bookings(db)
    await _seed_phase4(db)
    await _seed_phase5(db)
    await _seed_phase6(db)
    await _seed_phase7(db)
    await _seed_phase8(db)
    await _phase9_migration(db)
    await _phaseA_role_consolidation(db)
    # Run escalation scan AFTER all seeds (idempotent)
    try:
        from escalation_rules import scan_all as _esc_scan_all
        r = await _esc_scan_all()
        logger.info("Escalation scan on boot: %s", {k: v for k, v in r.items() if k != "by_rule"})
    except Exception as e:
        logger.warning("Escalation scan skipped: %s", e)
    await _write_credentials_md(db)


async def _seed_roles(db):
    for r in ROLES:
        await db.roles.update_one(
            {"code": r["code"]},
            {"$setOnInsert": {"id": _uid(), **r, "is_super_admin": r.get("is_super_admin", False)}},
            upsert=True,
        )


async def _seed_departments(db):
    for d in DEPARTMENTS:
        await db.departments.update_one(
            {"code": d["code"]},
            {
                "$setOnInsert": {
                    "id": _uid(),
                    **d,
                    "active": True,
                    "created_at": _now(),
                    "updated_at": _now(),
                }
            },
            upsert=True,
        )


async def _seed_users(db):
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@pranava.local")
    # ensure the super admin user exists (provisioned, never self-registered)
    role = await db.roles.find_one({"code": "SUPER_ADMIN"})
    dept = await db.departments.find_one({"code": "MANAGEMENT"})
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "id": _uid(),
            "email": admin_email,
            "name": "Super Admin",
            "phone": "+91-9000000000",
            "role_id": role["id"],
            "department_id": dept["id"],
            "manager_id": None,
            "active": True,
            "created_at": _now(),
            "updated_at": _now(),
        })

    # one user per non-super role
    for role_def in ROLES:
        if role_def["code"] == "SUPER_ADMIN":
            continue
        role_doc = await db.roles.find_one({"code": role_def["code"]})
        dept_code = ROLE_TO_DEPT.get(role_def["code"], "MANAGEMENT")
        dept_doc = await db.departments.find_one({"code": dept_code})
        email = f"{role_def['code'].lower()}@pranava.local"
        if await db.users.find_one({"email": email}):
            continue
        await db.users.insert_one({
            "id": _uid(),
            "email": email,
            "name": f"{role_def['name']} User",
            "phone": "+91-9000000001",
            "role_id": role_doc["id"],
            "department_id": dept_doc["id"],
            "manager_id": None,
            "active": True,
            "created_at": _now(),
            "updated_at": _now(),
        })


async def _seed_projects_and_units(db):
    if await db.projects.count_documents({}) > 0:
        return

    p1 = {
        "id": _uid(),
        "code": "GRW",
        "name": "Greenwich Villas",
        "type": "Villa",
        "location": "Hyderabad",
        "status": "Active",
        "created_at": _now(),
    }
    p2 = {
        "id": _uid(),
        "code": "SRH",
        "name": "Serenity Heights",
        "type": "Apartment",
        "location": "Bengaluru",
        "status": "Active",
        "created_at": _now(),
    }
    await db.projects.insert_many([p1, p2])

    statuses = ["Available", "Available", "Available", "Booked", "Booked", "Registered", "Available", "Available", "Available", "Handed Over"]
    unit_seed = []
    # Greenwich Villas: 10 villas
    for i in range(1, 11):
        unit_seed.append({
            "id": _uid(),
            "project_id": p1["id"],
            "code": f"GRW-V{i:03d}",
            "tower": None,
            "floor": "G+1",
            "unit_no": f"V-{i:03d}",
            "unit_type": "4BHK Villa",
            "carpet_area_sqft": 3200 + i * 50,
            "facing": ["East", "West", "North", "South"][i % 4],
            "parking_count": 2,
            "status": statuses[(i - 1) % len(statuses)],
            "base_price_inr": 47500000 + i * 250000,
            "created_at": _now(),
        })
    # Serenity Heights: 10 apartments (Tower A, floors 1-10, unit 01)
    for i in range(1, 11):
        unit_seed.append({
            "id": _uid(),
            "project_id": p2["id"],
            "code": f"SRH-A{i:02d}01",
            "tower": "A",
            "floor": str(i),
            "unit_no": "01",
            "unit_type": "3BHK",
            "carpet_area_sqft": 1450 + i * 10,
            "facing": ["East", "West", "North", "South"][i % 4],
            "parking_count": 1,
            "status": statuses[(i - 1) % len(statuses)],
            "base_price_inr": 12500000 + i * 100000,
            "created_at": _now(),
        })
    await db.units.insert_many(unit_seed)


async def _seed_customers(db):
    if await db.customers.count_documents({}) > 0:
        return

    seeds = [
        {"primary_name": "Arjun Reddy", "email": "arjun.reddy@example.com", "phone": "+91-9812340001", "nri_status": "Resident", "city": "Hyderabad", "state": "Telangana"},
        {"primary_name": "Priya Iyer", "email": "priya.iyer@example.com", "phone": "+91-9812340002", "nri_status": "Resident", "city": "Bengaluru", "state": "Karnataka"},
        {"primary_name": "Rahul Sharma", "email": "rahul.sharma@example.com", "phone": "+91-9812340003", "nri_status": "NRI", "city": "Dubai", "state": "UAE"},
        {"primary_name": "Anjali Menon", "email": "anjali.menon@example.com", "phone": "+91-9812340004", "nri_status": "Resident", "city": "Kochi", "state": "Kerala"},
        {"primary_name": "Vikram Singh", "email": "vikram.singh@example.com", "phone": "+91-9812340005", "nri_status": "Resident", "city": "Delhi", "state": "Delhi"},
        {"primary_name": "Meera Patel", "email": "meera.patel@example.com", "phone": "+91-9812340006", "nri_status": "OCI", "city": "London", "state": "UK"},
        {"primary_name": "Karthik Rao", "email": "karthik.rao@example.com", "phone": "+91-9812340007", "nri_status": "Resident", "city": "Hyderabad", "state": "Telangana"},
        {"primary_name": "Divya Nair", "email": "divya.nair@example.com", "phone": "+91-9812340008", "nri_status": "Resident", "city": "Bengaluru", "state": "Karnataka"},
    ]
    for c in seeds:
        seq = await next_sequence("customer")
        applicants = [{
            "id": _uid(),
            "name": c["primary_name"],
            "relation": "Self",
            "email": c["email"],
            "phone": c["phone"],
            "pan": None,
            "kyc_status": "Received",
        }]
        # add a co-applicant to alternating customers
        if seq % 2 == 0:
            applicants.append({
                "id": _uid(),
                "name": c["primary_name"].split(" ")[0] + " (Spouse)",
                "relation": "Spouse",
                "email": None,
                "phone": None,
                "pan": None,
                "kyc_status": "Pending",
            })
        await db.customers.insert_one({
            "id": _uid(),
            "code": f"CUS-{seq:06d}",
            "primary_name": c["primary_name"],
            "email": c["email"],
            "phone": c["phone"],
            "nri_status": c["nri_status"],
            "communication_pref": "Email",
            "address_line": None,
            "city": c.get("city"),
            "state": c.get("state"),
            "pincode": None,
            "applicants": applicants,
            "created_at": _now(),
        })


async def _seed_bookings(db):
    if await db.bookings.count_documents({}) > 0:
        return

    sales_user = await db.users.find_one({"email": "sales@pranava.local"})
    crm_user = await db.users.find_one({"email": "crm@pranava.local"})
    if not sales_user or not crm_user:
        return

    customers = await db.customers.find({}, {"_id": 0}).to_list(20)
    # Take units that are Booked or Registered from seed for realistic bookings
    booked_units = await db.units.find({"status": {"$in": ["Booked", "Registered", "Handed Over"]}}, {"_id": 0}).to_list(20)

    plan = "Booking amount now, 20% on agreement, 60% on milestones, 20% on possession."

    for i in range(min(5, len(booked_units), len(customers))):
        unit = booked_units[i]
        customer = customers[i]
        seq = await next_sequence("booking")
        status = "Draft" if i % 2 == 0 else "Confirmed"
        await db.bookings.insert_one({
            "id": _uid(),
            "code": f"BKG-{seq:06d}",
            "project_id": unit["project_id"],
            "unit_id": unit["id"],
            "customer_id": customer["id"],
            "sales_owner_id": sales_user["id"],
            "crm_owner_id": crm_user["id"],
            "booking_date": _now(),
            "agreement_value_inr": unit["base_price_inr"],
            "booking_amount_inr": round(unit["base_price_inr"] * 0.10),
            "payment_plan": plan,
            "status": status,
            "cancellation_reason": None,
            "notes": "Seeded booking",
            "created_at": _now(),
        })


async def _write_credentials_md(db):
    role_docs = await db.roles.find({}, {"_id": 0}).to_list(50)
    role_by_id = {r["id"]: r for r in role_docs}
    users = await db.users.find({}, {"_id": 0}).to_list(200)

    lines: list[str] = []
    lines.append("# Pranava HomeFlow — Test Credentials\n")
    lines.append("## Auth\n")
    lines.append("- Type: **session cookie** `hf_session` (technical/03). No passwords.\n")
    lines.append("- Staff: `GET /auth/google/start`, or `GET /auth/dev-login?user=<email>`.\n")
    lines.append("- Customers: `POST /auth/otp/request` then `POST /auth/otp/verify`.\n")
    lines.append("- Every non-GET carries `X-Requested-With: HomeFlow`.\n")
    lines.append("- Current session: `GET /me/session`. Sign out: `POST /auth/logout`.\n\n")

    lines.append("## Seeded users\n\n")
    lines.append("| Role | Email |\n")
    lines.append("| --- | --- |\n")
    for u in sorted(users, key=lambda x: x.get("email", "")):
        role_name = role_by_id.get(u.get("role_id"), {}).get("name", "?")
        lines.append(f"| {role_name} | `{u['email']}` |\n")

    lines.append("\n## Data hints\n")
    lines.append("- 2 projects seeded: `Greenwich Villas` (Villa, Hyderabad), `Serenity Heights` (Apartment, Bengaluru).\n")
    lines.append("- 20 units total across the two projects with mixed statuses.\n")
    lines.append("- 8 customers with codes starting `CUS-000001`.\n")
    lines.append("- 5 bookings starting `BKG-000001`. Bookings alternate Draft / Confirmed.\n")
    lines.append("- Global search: `GET /api/search?q=CUS-000001` (also try booking codes, unit codes, project codes, customer names).\n")
    lines.append("- OpenAPI schema: `GET /api/openapi.json`.\n")
    lines.append("\n## Phase 2 collaboration hints\n")
    lines.append("- Customer `CUS-000001` (Arjun Reddy) has 4 seeded comments (Internal + Customer Visible + a threaded reply that @-mentions the SALES user).\n")
    lines.append("- Booking `BKG-000001` has 2 seeded attachments (one PDF, one PNG) with a mixture of verification statuses.\n")
    lines.append("- `sales@pranava.local` starts with 3 unread notifications (mention + reply + verification_completed).\n")
    lines.append("- Audit read: `GET /api/audit_logs?entity_type=customer&entity_id=<id>` (Super Admin + Management only).\n")

    lines.append("\n## Phase 4 sales handover / documents / commitments hints\n")
    lines.append("- Booking `BKG-000002` (customer `CUS-000002` — Priya Iyer) has a Submitted `sales_handover` waiting for CRM Accept / Return. All 5 sections are filled. T1 is auto-completed by the seed.\n")
    lines.append("- CUS-000002 has 2 seed commitments: one Complimentary Item (In Progress, on-time), one Timeline Promise (In Progress, **Overdue**).\n")
    lines.append("- CUS-000002 has 9 documents seeded (Booking Form is Received v1; others Required; POA is Not Applicable).\n")
    lines.append("- Rule 8: `DELETE /api/commitments/{id}` returns 400 for commitments in {Approved,In Progress,Completed,Customer Confirmed}.\n")
    lines.append("- Rule 10: `POST /api/documents/{id}/verify` with a category-mismatched role returns 403.\n")
    lines.append("- Handover accept/return: submitter cannot accept or return their own handover (403).\n")

    lines.append("\n## Phase 5 payments / TDS / FC / collections hints\n")
    lines.append("- Booking `BKG-000002` has a 30-40-30 payment schedule. Booking amount is **Paid + Verified** (seed override for Phase 6 happy path). Other milestones unpaid.\n")
    lines.append("- Booking `BKG-000004` has a 30-40-30 payment schedule + a **Pending payment on the booking-amount milestone** (NEFT ref `NEFT-2026-04-BKG04-BA`). `POST /api/payments/{id}/verify` as `accounts@pranava.local` will cascade-complete journey task T7.\n")
    lines.append("- BKG-000002 TDS is **Applicable + Verified** (challan `CH-BKG02-2026-001`). BKG-000004 TDS is `Not Determined`.\n")
    lines.append("- BKG-000002 FC = **Approved** (Registration gate open). BKG-000004 FC = Pending.\n")
    lines.append("- Ageing row-click → `/customers/:id?tab=financials` (opens Financials tab directly).\n")
    lines.append("- RBAC: Sales role CAN record payments (Pending only); Accounts + Super Admin verify / dispute; Super Admin only can waive.\n")

    lines.append("\n## Phase 6 loans / legal / registration hints\n")
    lines.append("- **BKG-000002 (happy path §113)**: Loan `HDFC Bank · Partially Disbursed` (70% sanctioned, 50% of that disbursed). Legal `Approved`. Registration `Availability Confirmed`. All Phase 5 gates green. Ready for `POST /api/registrations/{id}/book-slot` → cascades T10.\n")
    lines.append("- **BKG-000004 (blocked §114)**: Loan `SBI · Application` with blocker \"Bank legal query — customer POA\". Legal `Under Review` (1 draft, T5 auto-completed). Registration `Not Started`. `book-slot` is blocked because Legal/TDS/FC all pending.\n")
    lines.append("- Journey engine cascades: T5 (Legal upload-draft first time) · T6 (Legal approve) · T7 (Payment verify booking amount) · T8 (TDS verify) · T9 (Reg confirm-availability) · T10 (Reg book-slot).\n")
    lines.append("- Reverse cascades: `POST /api/legal/{id}/reject` reverses T5+T6 if previously advanced. TDS applicability Applicable ← Not Applicable resets T8 back to Not Started.\n")
    lines.append("- T5/T6/T9/T10 manual `/complete`, `/attach-evidence`, `/verify`, `/submit-for-verification`, `/approve` return 400 with a clear lock message — schema-validation errors also route through this response (fixed 422-before-lock).\n")
    lines.append("- Book-slot preconditions: T6 Completed + (TDS Verified OR Not Applicable OR T8 Completed) + FC Approved + status=Availability Confirmed. Missing any → 400 naming the gate.\n")
    lines.append("- RBAC quick map: Banking/Accounts/Management/Super Admin → loan mutations. Legal/Management/Super Admin → legal approve/reject. CRM/Registration/Management/Super Admin → confirm-availability. Registration/Management/Super Admin → book-slot, mark-executed, upload-registered-deed.\n")

    lines.append("\n## Phase 7 unit-readiness / snags / handovers hints\n")
    lines.append("- **BKG-000002 (Priya Iyer / Confirmed)**: Unit Readiness overall_score ~92%, ready_for_qa=true, 2 seed photos, site_engineer='Ramesh Kulkarni'. T11 auto-completed. 3 snags: 1 Minor Closed, 1 Major In Progress, **1 Critical OPEN** (Electrical DB tripping) — this is the §118 test candidate. Handover record exists; gate_status=Red until critical snag closed.\n")
    lines.append("- **BKG-000004 (Anjali Menon / Confirmed)**: Unit Readiness ~60% (mid-build). ready_for_qa=false. 0 snags. Handover record exists; gate=Red.\n")
    lines.append("- T11 cascade: `POST /api/unit-readiness/{id}/declare-ready-for-qa` after score≥85 + ≥2 photos.\n")
    lines.append("- T12 cascade: engine hook fires when ALL Critical snags for a booking are Closed AND T11 is Completed. Creating/reopening a Critical snag reverse-cascades T12.\n")
    lines.append("- T13 cascade: `POST /api/handovers/{id}/record-acknowledgement` — requires gate_status=Green OR override. On success: journey task T13 completes, handover.status=Executed, unit.status=Handed Over.\n")
    lines.append("- Handover gate weights: Finance 20% + Registration 20% + Unit Readiness 25% + Snagging 15% + Documents 10% + Commitments 10%. Red = any critical gate unmet OR score<70. Green = score≥90 + all mandatory gates pass.\n")
    lines.append("- Override: `POST /api/handovers/{id}/override` (Super Admin / Management) with reason + mandatory_gates_bypassed list. Never forces to Green if score still low — floors at Amber.\n")
    lines.append("- Date revision history: two calls to `POST /api/handovers/{id}/set-final-date` with different final_date values appends both entries with reasons (spec §84/§119).\n")
    lines.append("- T11/T12/T13 manual `/complete`, `/attach-evidence`, `/verify`, `/submit-for-verification`, `/approve` return 400 with domain-specific lock message.\n")

    lines.append("\n## Phase 8 escalations / communications / reports hints\n")
    lines.append("- Boot-time scan runs after all seeds and creates rule-based escalations. Seed hits typically: 1 `critical_snag_open_2d` (Critical, QA) for SNG-000003, plus overdue commitment rules.\n")
    lines.append("- **ESC-000001** is a **manual** escalation on CUS-000004 (Anjali Menon) — 'Customer requested handover advance', target CRM, severity Medium.\n")
    lines.append("- Test the scan: `POST /api/escalations/scan` — first run creates N, second run has created=0 unchanged=N. Close the critical snag → next scan auto-closes ESC-* with resolution_notes='Auto-resolved: condition no longer met'.\n")
    lines.append("- Manual escalation creation: `POST /api/escalations` — rule_key='manual'. Communications: `POST /api/communications` multipart. Sales setting customer_visible=true → 403.\n")
    lines.append("- CSV export: `GET /api/reports/<any>?format=csv` returns text/csv.\n")
    lines.append("- Exec dashboard: `GET /api/exec-dashboard/summary` for Management + Super Admin roles. Other roles → Ops dashboard.\n")
    lines.append("- Sidebar state: **no ComingSoon items remain** — every left-nav item is functional.\n")

    lines.append("\n## Phase 9 project-scoped RBAC hints\n")
    lines.append("- **Super Admin + Management** are all-projects users — bypass every project scope check.\n")
    lines.append("- Every other seeded user (`sales@`, `crm@`, `accounts@`, `banking@`, `legal@`, `registration@`, `site@`, `qa@`, `handover@`, `facility@`) is assigned to BOTH seeded projects (GRW + SRH) by the boot migration.\n")
    lines.append("- **New endpoints**: `GET /api/me/projects` · `POST /api/admin/users/{id}/assign-projects` (Super Admin only).\n")
    lines.append("- **Unit types**: `Apartment` | `Villa` | `Commercial Office`. Server rejects anything else with 400. `Commercial Office` bookings use the **Apartment workflow template** (deliberate reuse — no new template).\n")
    lines.append("- Two Commercial Office seed units on Serenity Heights: **SRH-C001** and **SRH-C002** (Available). Create a booking on one and Confirm → journey's workflow_template.project_type == 'Apartment'.\n")
    lines.append("- Out-of-scope read (GET by id) returns **404** (leak-safe, not 403). Out-of-scope write returns **403** with `\"You do not have access to this project.\"`\n")

    path = Path(os.environ.get("HOMEFLOW_MEMORY_DIR", "./.data/memory")) / "test_credentials.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(lines), encoding="utf-8")
    logger.info("Wrote %s", path)


# ---------------- Phase 2 collaboration seed ----------------

async def _seed_collaboration(db):
    """Seed comments, attachments and notifications so the collaboration panel is not empty."""
    if await db.comments.count_documents({}) > 0:
        return

    # Resolve targets
    customer = await db.customers.find_one({"code": "CUS-000001"})
    booking = await db.bookings.find_one({"code": "BKG-000001"})
    if not customer or not booking:
        return

    admin_user = await db.users.find_one({"email": "admin@pranava.local"})
    sales_user = await db.users.find_one({"email": "sales@pranava.local"})
    crm_user = await db.users.find_one({"email": "crm@pranava.local"})
    legal_user = await db.users.find_one({"email": "legal@pranava.local"})
    accounts_user = await db.users.find_one({"email": "accounts@pranava.local"})
    if not (admin_user and sales_user and crm_user and legal_user and accounts_user):
        return

    legal_dept = await db.departments.find_one({"code": "LEGAL"})

    # ---- Comments on customer CUS-000001 ----
    from datetime import timedelta as _td

    base_ts = datetime.now(timezone.utc) - _td(days=2)

    def iso(offset_hours: float) -> str:
        return (base_ts + _td(hours=offset_hours)).isoformat()

    def _mk(*, i, entity_type, entity_id, user_id, body, visibility="Internal", parent=None, mention_users=None, mention_depts=None, last_activity=None):
        c = {
            "id": _uid(),
            "entity_type": entity_type,
            "entity_id": entity_id,
            "parent_comment_id": parent,
            "thread_root_id": None,
            "user_id": user_id,
            "body": body,
            "visibility": visibility,
            "status": "Active",
            "resolved_by": None,
            "resolved_at": None,
            "created_at": iso(i),
            "edited_at": None,
            "mention_user_ids": list(mention_users or []),
            "mention_department_ids": list(mention_depts or []),
            "attachment_ids": [],
            "last_activity_at": last_activity or iso(i),
        }
        c["thread_root_id"] = parent or c["id"]
        return c

    c1 = _mk(i=0, entity_type="customer", entity_id=customer["id"], user_id=crm_user["id"],
             body="Onboarding call scheduled for Friday. Awaiting PAN copy from co-applicant.",
             visibility="Internal")
    c2 = _mk(i=6, entity_type="customer", entity_id=customer["id"], user_id=admin_user["id"],
             body="Welcome to Pranava. Your booking summary is attached in your login.",
             visibility="Customer Visible")
    # Threaded root + reply that @mentions the sales user
    c3_root = _mk(i=12, entity_type="customer", entity_id=customer["id"], user_id=legal_user["id"],
                  body="Need agreement copy signed by both applicants before 20th.",
                  visibility="Internal",
                  mention_depts=[legal_dept["id"]] if legal_dept else [])
    c3_reply = _mk(i=13.5, entity_type="customer", entity_id=customer["id"], user_id=crm_user["id"],
                   body="Sharing with the customer today. cc @sales for follow-up.",
                   visibility="Internal", parent=c3_root["id"],
                   mention_users=[sales_user["id"]])
    c3_root["last_activity_at"] = c3_reply["created_at"]

    await db.comments.insert_many([c1, c2, c3_root, c3_reply])

    # Mention rows
    mention_rows = []
    for uid in c3_reply["mention_user_ids"]:
        mention_rows.append({
            "id": _uid(),
            "comment_id": c3_reply["id"],
            "mentioned_user_id": uid,
            "mentioned_department_id": None,
            "created_at": c3_reply["created_at"],
            "read_at": None,
        })
    for did in c3_root["mention_department_ids"]:
        mention_rows.append({
            "id": _uid(),
            "comment_id": c3_root["id"],
            "mentioned_user_id": None,
            "mentioned_department_id": did,
            "created_at": c3_root["created_at"],
            "read_at": None,
        })
    if mention_rows:
        await db.mentions.insert_many(mention_rows)

    # ---- Attachments on booking BKG-000001 ----
    from pathlib import Path as _P

    storage_root = _P(os.environ.get("ATTACHMENT_STORAGE_ROOT", "./.data/attachments")) / "booking" / booking["id"]
    storage_root.mkdir(parents=True, exist_ok=True)

    pdf_bytes = (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
        b"trailer<</Root 1 0 R>>\n%%EOF\n"
    )
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0"
        b"\x00\x00\x00\x03\x00\x01\x5b\xcaz\xb5\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    pdf_stored = f"{uuid.uuid4().hex}_agreement.pdf"
    png_stored = f"{uuid.uuid4().hex}_cost_sheet.png"
    (storage_root / pdf_stored).write_bytes(pdf_bytes)
    (storage_root / png_stored).write_bytes(png_bytes)

    a1 = {
        "id": _uid(),
        "entity_type": "booking",
        "entity_id": booking["id"],
        "comment_id": None,
        "filename": "agreement.pdf",
        "storage_path": f"booking/{booking['id']}/{pdf_stored}",
        "mime_type": "application/pdf",
        "size_bytes": len(pdf_bytes),
        "category": "Agreement",
        "version": 1,
        "visibility": "Internal",
        "description": "Draft sale agreement",
        "uploaded_by": crm_user["id"],
        "uploaded_at": iso(24),
        "verification_status": "Verified",
        "verified_by": legal_user["id"],
        "verified_at": iso(28),
        "verification_notes": "All applicant details match KYC.",
        "deleted_at": None,
    }
    a2 = {
        "id": _uid(),
        "entity_type": "booking",
        "entity_id": booking["id"],
        "comment_id": None,
        "filename": "cost_sheet.png",
        "storage_path": f"booking/{booking['id']}/{png_stored}",
        "mime_type": "image/png",
        "size_bytes": len(png_bytes),
        "category": "Cost Sheet",
        "version": 1,
        "visibility": "Internal",
        "description": "Cost sheet snapshot",
        "uploaded_by": sales_user["id"],
        "uploaded_at": iso(30),
        "verification_status": "Under Review",
        "verified_by": None,
        "verified_at": None,
        "verification_notes": None,
        "deleted_at": None,
    }
    await db.attachments.insert_many([a1, a2])

    # ---- Notifications for sales@pranava.local ----
    notif_rows = [
        {
            "id": _uid(),
            "user_id": sales_user["id"],
            "type": "mention",
            "entity_type": "customer",
            "entity_id": customer["id"],
            "comment_id": c3_reply["id"],
            "attachment_id": None,
            "actor_user_id": crm_user["id"],
            "title": f"{crm_user['name']} mentioned you on {customer['code']} — {customer['primary_name']}",
            "body": c3_reply["body"][:180],
            "read_at": None,
            "created_at": c3_reply["created_at"],
        },
        {
            "id": _uid(),
            "user_id": sales_user["id"],
            "type": "reply",
            "entity_type": "customer",
            "entity_id": customer["id"],
            "comment_id": c3_root["id"],
            "attachment_id": None,
            "actor_user_id": legal_user["id"],
            "title": f"{legal_user['name']} started a thread on {customer['code']}",
            "body": c3_root["body"][:180],
            "read_at": None,
            "created_at": c3_root["created_at"],
        },
        {
            "id": _uid(),
            "user_id": sales_user["id"],
            "type": "verification_completed",
            "entity_type": "booking",
            "entity_id": booking["id"],
            "comment_id": None,
            "attachment_id": a1["id"],
            "actor_user_id": legal_user["id"],
            "title": "agreement.pdf was marked Verified",
            "body": f"{legal_user['name']} on Booking {booking['code']}",
            "read_at": None,
            "created_at": iso(28.5),
        },
    ]
    await db.notifications.insert_many(notif_rows)



# ---------------- Phase 3 workflow templates + journeys ----------------

def _build_template_data(project_type: str, apartment_extras: bool = False) -> dict:
    """Return the template hierarchy as a nested dict. Tasks use string keys for prereq wiring."""
    ready_for_qa_checklist = [
        {"key": "civil", "label": "Civil works", "required": True},
        {"key": "electrical", "label": "Electrical", "required": True},
        {"key": "plumbing", "label": "Plumbing", "required": True},
        {"key": "painting", "label": "Painting", "required": True},
        {"key": "cleaning", "label": "Cleaning", "required": True},
    ]
    if apartment_extras:
        ready_for_qa_checklist.extend([
            {"key": "tower_deps", "label": "Tower dependencies", "required": True},
            {"key": "access_card", "label": "Access card", "required": True},
        ])

    return {
        "name": f"{project_type} Post-Sales Workflow",
        "project_type": project_type,
        "version": 1,
        "stages": [
            {
                "name": "Sales Handover", "sequence": 1, "dept_code": "SALES", "weight": 0.05, "mandatory": True,
                "subprocesses": [{
                    "name": "Handover to CRM", "sequence": 1, "owner_dept_code": "SALES",
                    "completion_rule": "all_mandatory_tasks_done",
                    "task_templates": [
                        {"key": "T1", "title": "Submit booking pack to CRM", "task_type": "Mandatory",
                         "execution_type": "Simple", "dept_code": "SALES", "default_owner_role": "SALES",
                         "priority": "High", "sla_days": 2, "sequence": 1, "prereqs": []},
                        {"key": "T2", "title": "CRM accept handover", "task_type": "Mandatory",
                         "execution_type": "Verification", "dept_code": "CRM", "default_owner_role": "SALES",
                         "verification_required": True, "verifier_role": "CRM",
                         "priority": "High", "sla_days": 3, "sequence": 2, "prereqs": ["T1"]},
                    ],
                }],
            },
            {
                "name": "Documentation", "sequence": 2, "dept_code": "CRM", "weight": 0.10, "mandatory": True,
                "subprocesses": [{
                    "name": "Customer KYC", "sequence": 1, "owner_dept_code": "CRM",
                    "completion_rule": "all_mandatory_tasks_done",
                    "task_templates": [
                        {"key": "T3", "title": "Collect PAN + Address proof", "task_type": "Mandatory",
                         "execution_type": "Evidence", "dept_code": "CRM", "default_owner_role": "CRM",
                         "priority": "High", "sla_days": 7, "sequence": 1, "prereqs": ["T2"],
                         "evidence_required": True, "required_document_category": "KYC",
                         "verification_required": True, "verifier_role": "CRM"},
                        {"key": "T4", "title": "NRI declaration", "task_type": "Conditional",
                         "execution_type": "Evidence", "dept_code": "CRM", "default_owner_role": "CRM",
                         "priority": "Medium", "sla_days": 10, "sequence": 2, "prereqs": ["T2"],
                         "evidence_required": True, "required_document_category": "KYC",
                         "verification_required": True, "verifier_role": "CRM",
                         "conditional_rule": "customer.nri_status in ['NRI','OCI']"},
                    ],
                }],
            },
            {
                "name": "Legal", "sequence": 3, "dept_code": "LEGAL", "weight": 0.10, "mandatory": True,
                "subprocesses": [{
                    "name": "Agreement", "sequence": 1, "owner_dept_code": "LEGAL",
                    "completion_rule": "all_mandatory_tasks_done",
                    "task_templates": [
                        {"key": "T5", "title": "Draft agreement", "task_type": "Mandatory",
                         "execution_type": "Simple", "dept_code": "LEGAL", "default_owner_role": "LEGAL",
                         "priority": "High", "sla_days": 5, "sequence": 1, "prereqs": ["T3"]},
                        {"key": "T6", "title": "Legal approval", "task_type": "Mandatory",
                         "execution_type": "Approval", "dept_code": "LEGAL", "default_owner_role": "LEGAL",
                         "approval_required": True, "approver_role": "LEGAL",
                         "priority": "High", "sla_days": 3, "sequence": 2, "prereqs": ["T5"]},
                    ],
                }],
            },
            {
                "name": "Payments", "sequence": 4, "dept_code": "ACCOUNTS", "weight": 0.15, "mandatory": True,
                "subprocesses": [{
                    "name": "Booking Amount", "sequence": 1, "owner_dept_code": "ACCOUNTS",
                    "completion_rule": "all_mandatory_tasks_done",
                    "task_templates": [
                        {"key": "T7", "title": "Booking amount receipt", "task_type": "Mandatory",
                         "execution_type": "Evidence", "dept_code": "ACCOUNTS", "default_owner_role": "ACCOUNTS",
                         "priority": "High", "sla_days": 3, "sequence": 1, "prereqs": ["T2"],
                         "evidence_required": True, "required_document_category": "Booking",
                         "verification_required": True, "verifier_role": "ACCOUNTS"},
                        {"key": "T8", "title": "TDS challan verify", "task_type": "Mandatory",
                         "execution_type": "Evidence", "dept_code": "ACCOUNTS", "default_owner_role": "ACCOUNTS",
                         "priority": "High", "sla_days": 5, "sequence": 2, "prereqs": ["T7"],
                         "evidence_required": True, "required_document_category": "TDS",
                         "verification_required": True, "verifier_role": "ACCOUNTS"},
                    ],
                }],
            },
            {
                "name": "Registration", "sequence": 5, "dept_code": "REGISTRATION", "weight": 0.20, "mandatory": True,
                "subprocesses": [{
                    "name": "SRO Scheduling", "sequence": 1, "owner_dept_code": "REGISTRATION",
                    "completion_rule": "all_mandatory_tasks_done",
                    "task_templates": [
                        {"key": "T9", "title": "Confirm customer availability", "task_type": "Mandatory",
                         "execution_type": "Simple", "dept_code": "REGISTRATION",
                         "default_owner_role": "REGISTRATION",
                         "priority": "Medium", "sla_days": 4, "sequence": 1, "prereqs": ["T6", "T8"],
                         "external_party": "Customer"},
                        {"key": "T10", "title": "Book SRO slot", "task_type": "Mandatory",
                         "execution_type": "Evidence", "dept_code": "REGISTRATION",
                         "default_owner_role": "REGISTRATION",
                         "priority": "High", "sla_days": 3, "sequence": 2, "prereqs": ["T9"],
                         "evidence_required": True, "required_document_category": "Registration",
                         "verification_required": True, "verifier_role": "REGISTRATION",
                         "external_party": "SRO"},
                    ],
                }],
            },
            {
                "name": "Unit Readiness", "sequence": 6, "dept_code": "PROJECTS", "weight": 0.20, "mandatory": True,
                "subprocesses": [{
                    "name": "Final Fit-Out", "sequence": 1, "owner_dept_code": "PROJECTS",
                    "completion_rule": "all_mandatory_tasks_done",
                    "task_templates": [
                        {"key": "T11", "title": "Site declares Ready-for-QA", "task_type": "Mandatory",
                         "execution_type": "Checklist", "dept_code": "PROJECTS",
                         "default_owner_role": "SITE",
                         "priority": "High", "sla_days": 30, "sequence": 1, "prereqs": [],
                         "checklist_items": ready_for_qa_checklist},
                    ],
                }],
            },
            {
                "name": "Snagging", "sequence": 7, "dept_code": "QA", "weight": 0.10, "mandatory": True,
                "subprocesses": [{
                    "name": "Pre-Handover Inspection", "sequence": 1, "owner_dept_code": "QA",
                    "completion_rule": "all_mandatory_tasks_done",
                    "task_templates": [
                        {"key": "T12", "title": "QA inspection sign-off", "task_type": "Mandatory",
                         "execution_type": "Simple", "dept_code": "QA", "default_owner_role": "QA",
                         "priority": "High", "sla_days": 7, "sequence": 1, "prereqs": ["T11"]},
                    ],
                }],
            },
            {
                "name": "Handover", "sequence": 8, "dept_code": "HANDOVER", "weight": 0.10, "mandatory": True,
                "subprocesses": [{
                    "name": "Possession", "sequence": 1, "owner_dept_code": "HANDOVER",
                    "completion_rule": "all_mandatory_tasks_done",
                    "task_templates": [
                        {"key": "T13", "title": "Customer acknowledgement", "task_type": "Mandatory",
                         "execution_type": "Verification", "dept_code": "HANDOVER",
                         "default_owner_role": "HANDOVER",
                         "verification_required": True, "verifier_role": "HANDOVER",
                         "priority": "Critical", "sla_days": 3, "sequence": 1, "prereqs": ["T10", "T12"],
                         "external_party": "Customer"},
                    ],
                }],
            },
        ],
    }


async def _seed_workflow_templates(db):
    if await db.workflow_templates.count_documents({}) > 0:
        return

    admin = await db.users.find_one({"email": "admin@pranava.local"})
    admin_id = admin["id"] if admin else None
    depts_by_code = {d["code"]: d async for d in db.departments.find({}, {"_id": 0})}

    for pt, extras in (("Villa", False), ("Apartment", True)):
        data = _build_template_data(pt, apartment_extras=extras)
        tpl_id = _uid()
        await db.workflow_templates.insert_one({
            "id": tpl_id,
            "name": data["name"],
            "project_type": pt,
            "version": data["version"],
            "active": True,
            "created_by": admin_id,
            "created_at": _now(),
        })

        for stage_data in data["stages"]:
            stage_id = _uid()
            await db.workflow_stages.insert_one({
                "id": stage_id,
                "workflow_template_id": tpl_id,
                "name": stage_data["name"],
                "sequence": stage_data["sequence"],
                "department_id": depts_by_code.get(stage_data["dept_code"], {}).get("id"),
                "weight": stage_data["weight"],
                "mandatory": stage_data["mandatory"],
                "active": True,
            })
            for sub_data in stage_data["subprocesses"]:
                sub_id = _uid()
                await db.workflow_subprocesses.insert_one({
                    "id": sub_id,
                    "stage_id": stage_id,
                    "name": sub_data["name"],
                    "sequence": sub_data["sequence"],
                    "owner_department_id": depts_by_code.get(sub_data["owner_dept_code"], {}).get("id"),
                    "completion_rule": sub_data["completion_rule"],
                    "active": True,
                })
                # Two-pass: create task templates, then wire dependencies by key
                key_to_id: dict[str, str] = {}
                for tpl_task in sub_data["task_templates"]:
                    t_id = _uid()
                    key_to_id[tpl_task["key"]] = t_id
                    await db.workflow_task_templates.insert_one({
                        "id": t_id,
                        "subprocess_id": sub_id,
                        "title": tpl_task["title"],
                        "description": tpl_task.get("description") or "",
                        "task_type": tpl_task["task_type"],
                        "execution_type": tpl_task["execution_type"],
                        "department_id": depts_by_code.get(tpl_task["dept_code"], {}).get("id"),
                        "default_owner_role": tpl_task["default_owner_role"],
                        "priority": tpl_task.get("priority", "Medium"),
                        "sla_days": tpl_task.get("sla_days", 7),
                        "sequence": tpl_task.get("sequence", 1),
                        "conditional_rule": tpl_task.get("conditional_rule"),
                        "evidence_required": tpl_task.get("evidence_required", False),
                        "required_document_category": tpl_task.get("required_document_category"),
                        "verification_required": tpl_task.get("verification_required", False),
                        "verifier_role": tpl_task.get("verifier_role"),
                        "approval_required": tpl_task.get("approval_required", False),
                        "approver_role": tpl_task.get("approver_role"),
                        "external_party": tpl_task.get("external_party"),
                        "customer_visible": tpl_task.get("customer_visible", False),
                        "checklist_items": tpl_task.get("checklist_items") or [],
                        "_key": tpl_task["key"],  # store for cross-subprocess dep wiring
                    })
                # After all templates in this subprocess exist, wire dependencies (may reference other subprocesses in same stage; cross-stage handled below)
                for tpl_task in sub_data["task_templates"]:
                    for prereq_key in tpl_task.get("prereqs", []):
                        # Look up the prereq template by _key across the whole workflow
                        prereq = await db.workflow_task_templates.find_one(
                            {"_key": prereq_key,
                             "subprocess_id": {"$in": await _all_sub_ids(db, tpl_id)}},
                            {"_id": 0, "id": 1},
                        )
                        if not prereq:
                            continue
                        await db.workflow_task_dependencies.insert_one({
                            "id": _uid(),
                            "task_template_id": key_to_id[tpl_task["key"]],
                            "prerequisite_task_template_id": prereq["id"],
                            "dependency_type": "FinishToStart",
                        })


async def _all_sub_ids(db, template_id: str) -> list:
    stage_ids = [s["id"] async for s in db.workflow_stages.find({"workflow_template_id": template_id}, {"_id": 0, "id": 1})]
    return [s["id"] async for s in db.workflow_subprocesses.find({"stage_id": {"$in": stage_ids}}, {"_id": 0, "id": 1})]


async def _seed_journeys_for_confirmed_bookings(db):
    """After templates + bookings are seeded, instantiate journeys for every Confirmed booking that has no journey yet."""
    if await db.customer_journeys.count_documents({}) > 0:
        return
    admin = await db.users.find_one({"email": "admin@pranava.local"})
    admin_id = admin["id"] if admin else None
    from workflow_engine import create_journey_from_template  # local import to avoid startup cycles

    async for booking in db.bookings.find({"status": "Confirmed"}, {"_id": 0}):
        project = await db.projects.find_one({"id": booking["project_id"]}, {"_id": 0})
        if not project:
            continue
        template = await db.workflow_templates.find_one({"project_type": project["type"], "active": True}, {"_id": 0})
        if not template:
            continue
        unit = await db.units.find_one({"id": booking["unit_id"]}, {"_id": 0})
        customer = await db.customers.find_one({"id": booking["customer_id"]}, {"_id": 0})
        await create_journey_from_template(
            booking=booking,
            project=project,
            unit=unit or {},
            customer=customer or {},
            template=template,
            actor_user_id=admin_id,
        )

    # Seed 2-3 comments on one seed task so the CollaborationPanel is not empty
    first_journey = await db.customer_journeys.find_one({}, {"_id": 0})
    if not first_journey:
        return
    first_task = await db.tasks.find_one({"journey_id": first_journey["id"]}, {"_id": 0}, sort=[("created_at", 1)])
    if not first_task:
        return
    crm = await db.users.find_one({"email": "crm@pranava.local"})
    sales = await db.users.find_one({"email": "sales@pranava.local"})
    if not (crm and sales):
        return
    from datetime import timedelta as _td
    base = datetime.now(timezone.utc) - _td(hours=6)
    def iso_off(m: float) -> str:
        return (base + _td(minutes=m)).isoformat()
    docs = [
        {
            "id": _uid(),
            "entity_type": "task",
            "entity_id": first_task["id"],
            "parent_comment_id": None,
            "thread_root_id": None,
            "user_id": crm["id"],
            "body": "Booking pack received. Cross-checking against KYC.",
            "visibility": "Internal",
            "status": "Active",
            "resolved_by": None,
            "resolved_at": None,
            "created_at": iso_off(0),
            "edited_at": None,
            "mention_user_ids": [],
            "mention_department_ids": [],
            "attachment_ids": [],
            "last_activity_at": iso_off(0),
        },
        {
            "id": _uid(),
            "entity_type": "task",
            "entity_id": first_task["id"],
            "parent_comment_id": None,
            "thread_root_id": None,
            "user_id": sales["id"],
            "body": "Please confirm receipt of physical booking pack too.",
            "visibility": "Internal",
            "status": "Active",
            "resolved_by": None,
            "resolved_at": None,
            "created_at": iso_off(30),
            "edited_at": None,
            "mention_user_ids": [crm["id"]],
            "mention_department_ids": [],
            "attachment_ids": [],
            "last_activity_at": iso_off(30),
        },
    ]
    for c in docs:
        c["thread_root_id"] = c["id"]
    await db.comments.insert_many(docs)


# ================= Phase 4 seed =================

async def _seed_phase4(db):
    """Seed:
    - document checklist backfill for every existing journey (idempotent)
    - one Submitted handover on BKG-000002 (visual test target for Accept/Return)
    - one Approved+In Progress and one Overdue commitment on CUS-000002
    - one Booking Form document (status=Received) on CUS-000002
    """
    from document_seed import seed_document_checklist

    # 1) Backfill document checklists for every journey
    async for j in db.customer_journeys.find({}, {"_id": 0}):
        booking = await db.bookings.find_one({"id": j["booking_id"]}, {"_id": 0})
        customer = await db.customers.find_one({"id": j["customer_id"]}, {"_id": 0})
        if not (booking and customer):
            continue
        await seed_document_checklist(customer=customer, booking=booking)

    admin = await db.users.find_one({"email": "admin@pranava.local"})
    sales = await db.users.find_one({"email": "sales@pranava.local"})
    crm = await db.users.find_one({"email": "crm@pranava.local"})
    if not all((admin, sales, crm)):
        return

    # 2) Booking Form Received document on CUS-000002 (BKG-000002 is the first Confirmed booking)
    cust1 = await db.customers.find_one({"code": "CUS-000002"}, {"_id": 0})
    book1 = await db.bookings.find_one({"code": "BKG-000002"}, {"_id": 0}) if cust1 else None
    if cust1 and book1:
        doc = await db.documents.find_one(
            {"customer_id": cust1["id"], "booking_id": book1["id"], "category": "Booking Form"},
            {"_id": 0},
        )
        if doc and doc.get("status") == "Required":
            # Fabricate a small attachment record so the UI shows a version + download row
            att_id = _uid()
            now = _now()
            attachment = {
                "id": att_id,
                "entity_type": "document",
                "entity_id": doc["id"],
                "comment_id": None,
                "filename": "booking_form_signed.pdf",
                "storage_path": None,   # No real file — download will 410 (acceptable seed)
                "mime_type": "application/pdf",
                "size_bytes": 12345,
                "category": "Booking Form",
                "version": 1,
                "visibility": "Internal",
                "description": "Signed customer booking form",
                "uploaded_by": sales["id"],
                "uploaded_at": now,
                "verification_status": "Uploaded",
                "verified_by": None,
                "verified_at": None,
                "verification_notes": None,
                "deleted_at": None,
            }
            await db.attachments.insert_one(attachment)
            await db.document_versions.insert_one({
                "id": _uid(),
                "document_id": doc["id"],
                "version": 1,
                "attachment_id": att_id,
                "uploaded_by": sales["id"],
                "uploaded_at": now,
                "verification_status": "Uploaded",
                "verified_by": None,
                "verified_at": None,
                "comments": None,
            })
            await db.documents.update_one(
                {"id": doc["id"]},
                {"$set": {"status": "Received", "latest_version": 1, "latest_attachment_id": att_id, "updated_at": now}},
            )

    # 3) Two commitments on CUS-000002 (Approved+In Progress, and Overdue)
    if cust1 and book1 and await db.customer_commitments.count_documents({"customer_id": cust1["id"]}) == 0:
        crm_dept = await db.departments.find_one({"code": "CRM"}, {"_id": 0, "id": 1})
        proj_dept = await db.departments.find_one({"code": "PROJECTS"}, {"_id": 0, "id": 1})

        seq1 = await next_sequence("commitments")
        now = _now()
        await db.customer_commitments.insert_one({
            "id": _uid(),
            "code": f"COM-{seq1:06d}",
            "customer_id": cust1["id"],
            "booking_id": book1["id"],
            "unit_id": book1["unit_id"],
            "category": "Complimentary Item",
            "description": "Free modular kitchen upgrade at handover.",
            "committed_by": sales["id"],
            "committed_date": now,
            "responsible_department_id": (crm_dept or {}).get("id"),
            "owner_user_id": crm["id"],
            "target_date": (datetime.now(timezone.utc) + timedelta(days=45)).isoformat(),
            "financial_impact_inr": 150000,
            "approval_required": True,
            "approval_status": "Approved",
            "approver_user_id": admin["id"],
            "approved_at": now,
            "approval_notes": "Approved during handover discussion.",
            "delivery_status": "In Progress",
            "customer_confirmation_required": True,
            "customer_confirmed_at": None,
            "evidence_attachment_ids": [],
            "created_at": now,
            "updated_at": now,
        })

        seq2 = await next_sequence("commitments")
        # Overdue: target_date in the past, delivery_status In Progress
        await db.customer_commitments.insert_one({
            "id": _uid(),
            "code": f"COM-{seq2:06d}",
            "customer_id": cust1["id"],
            "booking_id": book1["id"],
            "unit_id": book1["unit_id"],
            "category": "Timeline Promise",
            "description": "Handover clarification call within 7 days of booking.",
            "committed_by": sales["id"],
            "committed_date": (datetime.now(timezone.utc) - timedelta(days=15)).isoformat(),
            "responsible_department_id": (crm_dept or {}).get("id"),
            "owner_user_id": crm["id"],
            "target_date": (datetime.now(timezone.utc) - timedelta(days=5)).isoformat(),
            "financial_impact_inr": 0,
            "approval_required": False,
            "approval_status": "Not Required",
            "approver_user_id": None,
            "approved_at": None,
            "approval_notes": None,
            "delivery_status": "In Progress",
            "customer_confirmation_required": True,
            "customer_confirmed_at": None,
            "evidence_attachment_ids": [],
            "created_at": (datetime.now(timezone.utc) - timedelta(days=15)).isoformat(),
            "updated_at": _now(),
        })

    # 4) Submitted handover on BKG-000001 (T1 already completed, T2 awaiting-verification)
    if book1 and not await db.sales_handovers.find_one({"booking_id": book1["id"]}, {"_id": 0}):
        unit = await db.units.find_one({"id": book1["unit_id"]}, {"_id": 0}) or {}
        now = _now()
        handover = {
            "id": _uid(),
            "booking_id": book1["id"],
            "customer_id": book1["customer_id"],
            "submitted_by": sales["id"],
            "submitted_at": now,
            "accepted_by": None,
            "accepted_at": None,
            "status": "Submitted",
            "return_reason": None,
            "customer_section": {
                "applicant_details_confirmed": True,
                "contact_verified": True,
                "nri_status_confirmed": True,
                "communication_pref_confirmed": True,
                "notes": "Customer prefers WhatsApp for updates.",
            },
            "commercial_section": {
                "final_price_inr": book1["agreement_value_inr"],
                "discount_inr": 0,
                "payment_plan_ref": book1.get("payment_plan") or "10-20-60-10",
                "booking_amount_inr": book1["booking_amount_inr"],
                "approved_deviations": [],
                "brokerage_percent": 2.0,
                "brokerage_inr": book1["agreement_value_inr"] * 0.02,
                "taxes_summary": "GST 5% inclusive",
                "notes": "Standard commercial terms.",
            },
            "unit_section": {
                "unit_confirmed": True,
                "parking_count": unit.get("parking_count", 1),
                "facing_confirmed": True,
                "specifications_notes": "Standard specifications as per brochure.",
            },
            "documents_section": {
                "booking_form_uploaded": True,
                "cost_sheet_uploaded": True,
                "kyc_complete": True,
                "approval_notes_uploaded": False,
                "linked_document_ids": [],
            },
            "commitments_section": {
                "items": [{
                    "category": "Complimentary Item",
                    "description": "Complimentary interior consultation",
                    "target_date": None,
                    "financial_impact_inr": 25000,
                    "needs_approval": False,
                }],
            },
            "created_at": now,
            "updated_at": now,
        }
        await db.sales_handovers.insert_one(handover)

        # Auto-complete T1 for BKG-000002's journey
        journey = await db.customer_journeys.find_one({"booking_id": book1["id"]}, {"_id": 0})
        if journey:
            t1_tpl = await db.workflow_task_templates.find_one({"_key": "T1"}, {"_id": 0, "id": 1})
            if t1_tpl:
                t1 = await db.tasks.find_one({"journey_id": journey["id"], "task_template_id": t1_tpl["id"]}, {"_id": 0})
                if t1 and t1["status"] != "Completed":
                    await db.tasks.update_one(
                        {"id": t1["id"]},
                        {"$set": {"status": "Completed", "completed_by": sales["id"], "completed_at": now,
                                  "completion_notes": "Handover submitted (seed)", "override_flag": True,
                                  "updated_at": now}},
                    )
                    # Cascade to recompute subprocess/stage
                    from workflow_engine import cascade_from_task
                    await cascade_from_task(t1["id"], actor_user_id=sales["id"])



# ================= Phase 5 seed =================

async def _seed_phase5(db):
    """Seed:
    - BKG-000002: 30-40-30 schedule with an overdue booking-amount milestone (unpaid) — shows in Collections dashboard
    - BKG-000004: 30-40-30 schedule with a Pending booking-amount payment (tester Verifies → cascade T7)
                  + TDS record in Not Determined state; FC in Pending state
    Idempotent: skips if payment_schedules already has any documents.
    """
    if await db.payment_schedules.count_documents({}) > 0:
        return

    admin = await db.users.find_one({"email": "admin@pranava.local"})
    sales = await db.users.find_one({"email": "sales@pranava.local"})
    accounts = await db.users.find_one({"email": "accounts@pranava.local"})
    if not all((admin, sales, accounts)):
        return

    book2 = await db.bookings.find_one({"code": "BKG-000002"}, {"_id": 0})
    book4 = await db.bookings.find_one({"code": "BKG-000004"}, {"_id": 0})

    def _make_schedule_doc(booking, created_by):
        return {
            "id": _uid(),
            "booking_id": booking["id"],
            "template_used": "30-40-30",
            "total_agreement_value_inr": float(booking["agreement_value_inr"] or 0),
            "total_tax_inr": 0,
            "currency": "INR",
            "created_by": created_by,
            "created_at": _now(),
            "updated_at": _now(),
        }

    def _make_milestones(schedule_id, total, booking_dt, day_offsets, names):
        splits = [0.30, 0.40, 0.30]
        out = []
        for i, (pct, off, name) in enumerate(zip(splits, day_offsets, names)):
            demand = round(total * pct, 2)
            out.append({
                "id": _uid(),
                "payment_schedule_id": schedule_id,
                "sequence": i + 1,
                "milestone_name": name,
                "due_date": (booking_dt + timedelta(days=off)).isoformat(),
                "demand_amount_inr": demand,
                "tax_inr": 0,
                "total_due_inr": demand,
                "notes": None,
                "is_booking_amount": i == 0,
                "created_at": _now(),
                "updated_at": _now(),
            })
        return out

    # ---- BKG-000002: overdue booking-amount milestone (unpaid, 45 days past due) ----
    if book2:
        sched2 = _make_schedule_doc(book2, admin["id"])
        await db.payment_schedules.insert_one(sched2)
        anchor2 = datetime.now(timezone.utc) - timedelta(days=45)
        m2 = _make_milestones(
            sched2["id"], sched2["total_agreement_value_inr"], anchor2,
            [0, 120, 300],
            ["Booking Amount", "On Foundation", "On Possession"],
        )
        await db.payment_milestones.insert_many(m2)

        # Auto-create the TDS + FC shells (Not Determined / Pending) so UI shows them
        tds2 = {
            "id": _uid(),
            "booking_id": book2["id"],
            "applicability": "Not Determined",
            "na_reason": None,
            "tds_amount_inr": None,
            "deducted_from_payment_id": None,
            "challan_number": None,
            "challan_date": None,
            "pan_number": None,
            "customer_confirmed": False,
            "uploaded_attachment_id": None,
            "verification_status": "Pending",
            "verified_by": None,
            "verified_at": None,
            "verification_notes": None,
            "notes": None,
            "created_at": _now(),
            "updated_at": _now(),
        }
        await db.tds_records.insert_one(tds2)

        fc2 = {
            "id": _uid(),
            "booking_id": book2["id"],
            "checklist": {
                "ledger_reconciled": False,
                "due_amounts_paid": False,
                "tds_verified": False,
                "bank_disbursement_received": False,
                "bank_disbursement_applicable": False,
                "other_charges_cleared": False,
                "exceptions_approved": True,
            },
            "status": "Pending",
            "approved_by": None,
            "approved_at": None,
            "rejection_reason": None,
            "notes": None,
            "created_at": _now(),
            "updated_at": _now(),
        }
        await db.financial_clearances.insert_one(fc2)

    # ---- BKG-000004: 30-40-30 + Pending payment on booking-amount milestone ----
    if book4:
        sched4 = _make_schedule_doc(book4, admin["id"])
        await db.payment_schedules.insert_one(sched4)
        anchor4 = datetime.now(timezone.utc) - timedelta(days=3)
        m4 = _make_milestones(
            sched4["id"], sched4["total_agreement_value_inr"], anchor4,
            [0, 150, 330],
            ["Booking Amount", "On Foundation", "On Possession"],
        )
        await db.payment_milestones.insert_many(m4)

        # Pending payment on booking-amount milestone (customer paid via NEFT, awaiting Accounts verify)
        booking_amount_milestone = m4[0]
        pay = {
            "id": _uid(),
            "booking_id": book4["id"],
            "milestone_id": booking_amount_milestone["id"],
            "amount_inr": booking_amount_milestone["demand_amount_inr"],
            "tax_inr": 0,
            "payment_mode": "NEFT",
            "reference_no": "NEFT-2026-04-BKG04-BA",
            "payment_date": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
            "received_by_user_id": sales["id"],
            "verification_status": "Pending",
            "verified_by": None,
            "verified_at": None,
            "verification_notes": None,
            "notes": "Customer transferred booking amount via NEFT. Awaiting Accounts verify.",
            "attachment_ids": [],
            "created_at": _now(),
            "updated_at": _now(),
        }
        await db.payments.insert_one(pay)

        # TDS + FC shells (Not Determined + Pending)
        tds4 = {
            "id": _uid(),
            "booking_id": book4["id"],
            "applicability": "Not Determined",
            "na_reason": None,
            "tds_amount_inr": None,
            "deducted_from_payment_id": None,
            "challan_number": None,
            "challan_date": None,
            "pan_number": None,
            "customer_confirmed": False,
            "uploaded_attachment_id": None,
            "verification_status": "Pending",
            "verified_by": None,
            "verified_at": None,
            "verification_notes": None,
            "notes": None,
            "created_at": _now(),
            "updated_at": _now(),
        }
        await db.tds_records.insert_one(tds4)

        fc4 = {
            "id": _uid(),
            "booking_id": book4["id"],
            "checklist": {
                "ledger_reconciled": False,
                "due_amounts_paid": False,
                "tds_verified": False,
                "bank_disbursement_received": False,
                "bank_disbursement_applicable": False,
                "other_charges_cleared": False,
                "exceptions_approved": True,
            },
            "status": "Pending",
            "approved_by": None,
            "approved_at": None,
            "rejection_reason": None,
            "notes": None,
            "created_at": _now(),
            "updated_at": _now(),
        }
        await db.financial_clearances.insert_one(fc4)

    logger.info("Phase 5 seed complete: schedules=%d payments=%d tds=%d fc=%d",
                await db.payment_schedules.count_documents({}),
                await db.payments.count_documents({}),
                await db.tds_records.count_documents({}),
                await db.financial_clearances.count_documents({}))


# ================= Phase 6 seed =================

async def _seed_phase6(db):
    """Seed:
    - BKG-000002 (Priya Iyer): happy path — booking-amount Paid, TDS Verified, Legal Approved,
      Loan Partially Disbursed, FC Approved, Registration Availability Confirmed.
      This is the acceptance §113 fixture. T5, T6, T7, T8, T9 auto-completed via engine.
    - BKG-000004 (Anjali Menon): blocked scenario — Loan in Application with blocker,
      Legal Under Review (T5 done, T6 pending), Registration blocked at Not Started (§114).

    Idempotent: skips if loan_cases already has any documents.
    """
    if await db.loan_cases.count_documents({}) > 0:
        return

    admin = await db.users.find_one({"email": "admin@pranava.local"})
    legal_user = await db.users.find_one({"email": "legal@pranava.local"})
    banking = await db.users.find_one({"email": "banking@pranava.local"})
    accounts = await db.users.find_one({"email": "accounts@pranava.local"})
    reg_user = await db.users.find_one({"email": "registration@pranava.local"})
    if not all((admin, legal_user, banking, accounts, reg_user)):
        return

    from engine_hooks import find_journey_task_by_key, system_complete_task  # local import

    book2 = await db.bookings.find_one({"code": "BKG-000002"}, {"_id": 0})
    book4 = await db.bookings.find_one({"code": "BKG-000004"}, {"_id": 0})

    def _fake_attachment(entity_type, entity_id, category, filename, user_id):
        return {
            "id": _uid(),
            "entity_type": entity_type,
            "entity_id": entity_id,
            "comment_id": None,
            "filename": filename,
            "storage_path": f"{entity_type}/seed/{filename}",
            "mime_type": "application/pdf",
            "size_bytes": 12345,
            "category": category,
            "version": 1,
            "visibility": "Internal",
            "description": "Seeded placeholder",
            "uploaded_by": user_id,
            "uploaded_at": _now(),
            "verification_status": "Uploaded",
            "verified_by": None,
            "verified_at": None,
            "verification_notes": None,
            "deleted_at": None,
        }

    # ---- BKG-000002: full happy path ----
    if book2:
        journey2 = await db.customer_journeys.find_one({"booking_id": book2["id"]}, {"_id": 0})

        # 1. Verified payment on booking-amount milestone → cascade T7
        sched2 = await db.payment_schedules.find_one({"booking_id": book2["id"]}, {"_id": 0})
        if sched2:
            ba = await db.payment_milestones.find_one(
                {"payment_schedule_id": sched2["id"], "is_booking_amount": True}, {"_id": 0}
            )
            if ba:
                pay_doc = {
                    "id": _uid(),
                    "booking_id": book2["id"],
                    "milestone_id": ba["id"],
                    "amount_inr": ba["demand_amount_inr"],
                    "tax_inr": 0,
                    "payment_mode": "RTGS",
                    "reference_no": "RTGS-2026-04-BKG02-BA",
                    "payment_date": (datetime.now(timezone.utc) - timedelta(days=30)).isoformat(),
                    "received_by_user_id": accounts["id"],
                    "verification_status": "Verified",
                    "verified_by": accounts["id"],
                    "verified_at": _now(),
                    "verification_notes": "Seed: RTGS receipt reconciled",
                    "notes": "Customer transferred booking amount via RTGS",
                    "attachment_ids": [],
                    "created_at": _now(),
                    "updated_at": _now(),
                }
                await db.payments.insert_one(pay_doc)
                if journey2:
                    t7 = await find_journey_task_by_key(journey2["id"], "T7")
                    if t7 and t7["status"] != "Completed":
                        await system_complete_task(t7["id"], accounts["id"], note="Seed: booking amount verified")

        # 2. TDS Applicable + Verified → cascade T8
        tds2 = await db.tds_records.find_one({"booking_id": book2["id"]}, {"_id": 0})
        if tds2:
            tds_att = _fake_attachment("tds_record", tds2["id"], "TDS", "tds_challan_seed.pdf", accounts["id"])
            await db.attachments.insert_one(tds_att)
            await db.tds_records.update_one({"id": tds2["id"]}, {"$set": {
                "applicability": "Applicable",
                "tds_amount_inr": round((book2.get("agreement_value_inr") or 0) * 0.01, 2),
                "challan_number": "CH-BKG02-2026-001",
                "challan_date": (datetime.now(timezone.utc) - timedelta(days=25)).isoformat(),
                "pan_number": "ABCDE1234F",
                "customer_confirmed": True,
                "uploaded_attachment_id": tds_att["id"],
                "verification_status": "Verified",
                "verified_by": accounts["id"],
                "verified_at": _now(),
                "verification_notes": "Seed: challan reconciled with Form 26AS",
                "updated_at": _now(),
            }})
            if journey2:
                t8 = await find_journey_task_by_key(journey2["id"], "T8")
                if t8 and t8["status"] != "Completed":
                    await system_complete_task(t8["id"], accounts["id"], note="Seed: TDS verified")

        # 3. Legal Approved → cascade T5 + T6
        legal_id_2 = _uid()
        legal_att_2 = _fake_attachment("legal_record", legal_id_2, "Agreement", "sale_agreement_v1.pdf", legal_user["id"])
        await db.attachments.insert_one(legal_att_2)
        legal_doc_2 = {
            "id": legal_id_2,
            "booking_id": book2["id"],
            "status": "Approved",
            "latest_draft_attachment_id": legal_att_2["id"],
            "deviation_notes": None,
            "reviewed_by": legal_user["id"],
            "reviewed_at": _now(),
            "approved_by": legal_user["id"],
            "approved_at": _now(),
            "approval_notes": "Seed: approved after standard review",
            "rejection_reason": None,
            "created_at": _now(),
            "updated_at": _now(),
        }
        await db.legal_records.insert_one(legal_doc_2)
        legal_ver_2 = {
            "id": _uid(),
            "legal_record_id": legal_id_2,
            "version": 1,
            "attachment_id": legal_att_2["id"],
            "uploaded_by": legal_user["id"],
            "uploaded_at": _now(),
            "comments": None,
        }
        await db.legal_versions.insert_one(legal_ver_2)
        if journey2:
            t5 = await find_journey_task_by_key(journey2["id"], "T5")
            if t5 and t5["status"] != "Completed":
                await system_complete_task(t5["id"], legal_user["id"], note="Seed: draft uploaded")
            t6 = await find_journey_task_by_key(journey2["id"], "T6")
            if t6 and t6["status"] != "Completed":
                await system_complete_task(t6["id"], legal_user["id"], note="Seed: legal approved")

        # 4. Loan Partially Disbursed
        loan_id_2 = _uid()
        sanctioned = round((book2.get("agreement_value_inr") or 0) * 0.70, 2)
        disbursed_1 = round(sanctioned * 0.50, 2)
        loan_doc_2 = {
            "id": loan_id_2,
            "booking_id": book2["id"],
            "bank_name": "HDFC Bank",
            "bank_branch": "Banjara Hills",
            "bank_rm_name": "Meera Nair",
            "bank_rm_contact": "+91 98765 12345",
            "requested_amount_inr": sanctioned,
            "sanctioned_amount_inr": sanctioned,
            "sanction_date": (datetime.now(timezone.utc) - timedelta(days=20)).isoformat(),
            "sanction_validity_date": (datetime.now(timezone.utc) + timedelta(days=160)).isoformat(),
            "current_stage": "Partially Disbursed",
            "sanction_letter_attachment_id": None,
            "blocker": None,
            "notes": "Seed: fixed rate 8.65% for 20 years",
            "created_by": banking["id"],
            "created_at": _now(),
            "updated_at": _now(),
        }
        await db.loan_cases.insert_one(loan_doc_2)
        for i, ev in enumerate([
            {"event_type": "Application Submitted", "amount_inr": sanctioned, "notes": "Seed"},
            {"event_type": "Sanctioned", "amount_inr": sanctioned, "notes": "Seed: sanction letter #HDFC-SL-2026-1234"},
            {"event_type": "Disbursed", "amount_inr": disbursed_1, "reference_no": "DIS-HDFC-2026-11-01", "notes": "Seed: first tranche"},
        ]):
            await db.loan_events.insert_one({
                "id": _uid(),
                "loan_case_id": loan_id_2,
                "event_type": ev["event_type"],
                "event_date": (datetime.now(timezone.utc) - timedelta(days=20 - i * 3)).isoformat(),
                "amount_inr": ev.get("amount_inr"),
                "reference_no": ev.get("reference_no"),
                "attachment_id": None,
                "notes": ev.get("notes"),
                "recorded_by": banking["id"],
                "recorded_at": _now(),
            })

        # 5. FC Approved (all gates green including bank_disbursement_received)
        fc2 = await db.financial_clearances.find_one({"booking_id": book2["id"]}, {"_id": 0})
        if fc2:
            await db.financial_clearances.update_one({"id": fc2["id"]}, {"$set": {
                "checklist": {
                    "ledger_reconciled": True,
                    "due_amounts_paid": True,
                    "tds_verified": True,
                    "bank_disbursement_received": True,
                    "bank_disbursement_applicable": True,
                    "other_charges_cleared": True,
                    "exceptions_approved": True,
                },
                "status": "Approved",
                "approved_by": accounts["id"],
                "approved_at": _now(),
                "rejection_reason": None,
                "notes": "Seed: cleared all financial gates",
                "updated_at": _now(),
            }})

        # 6. Registration Availability Confirmed → cascade T9
        reg_id_2 = _uid()
        reg_doc_2 = {
            "id": reg_id_2,
            "booking_id": book2["id"],
            "sro_office": "SRO Banjara Hills",
            "preferred_dates": [
                (datetime.now(timezone.utc) + timedelta(days=d)).date().isoformat()
                for d in (7, 8, 9)
            ],
            "confirmed_date": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
            "slot_date": None,
            "slot_time": None,
            "slot_reference_no": None,
            "slot_confirmation_attachment_id": None,
            "status": "Availability Confirmed",
            "executed_date": None,
            "registration_document_number": None,
            "registered_sale_deed_attachment_id": None,
            "company_representative": None,
            "customer_attendees": [],
            "outcome_notes": None,
            "created_at": _now(),
            "updated_at": _now(),
        }
        await db.registrations.insert_one(reg_doc_2)
        if journey2:
            t9 = await find_journey_task_by_key(journey2["id"], "T9")
            if t9 and t9["status"] != "Completed":
                await system_complete_task(t9["id"], reg_user["id"], note="Seed: customer availability confirmed")

    # ---- BKG-000004: blocked scenario ----
    if book4:
        journey4 = await db.customer_journeys.find_one({"booking_id": book4["id"]}, {"_id": 0})

        # Loan in Application with blocker
        loan_id_4 = _uid()
        loan_doc_4 = {
            "id": loan_id_4,
            "booking_id": book4["id"],
            "bank_name": "State Bank of India",
            "bank_branch": "Whitefield Main",
            "bank_rm_name": "Rajesh Krishnan",
            "bank_rm_contact": "+91 98123 45678",
            "requested_amount_inr": round((book4.get("agreement_value_inr") or 0) * 0.75, 2),
            "sanctioned_amount_inr": None,
            "sanction_date": None,
            "sanction_validity_date": None,
            "current_stage": "Application",
            "sanction_letter_attachment_id": None,
            "blocker": "Bank legal query — customer POA notarisation pending",
            "notes": None,
            "created_by": banking["id"],
            "created_at": _now(),
            "updated_at": _now(),
        }
        await db.loan_cases.insert_one(loan_doc_4)
        await db.loan_events.insert_one({
            "id": _uid(),
            "loan_case_id": loan_id_4,
            "event_type": "Application Submitted",
            "event_date": _now(),
            "amount_inr": loan_doc_4["requested_amount_inr"],
            "reference_no": None,
            "attachment_id": None,
            "notes": "Seed: initial application",
            "recorded_by": banking["id"],
            "recorded_at": _now(),
        })
        await db.loan_events.insert_one({
            "id": _uid(),
            "loan_case_id": loan_id_4,
            "event_type": "Blocker Recorded",
            "event_date": _now(),
            "amount_inr": None,
            "reference_no": None,
            "attachment_id": None,
            "notes": "Bank legal query — customer POA notarisation pending",
            "recorded_by": banking["id"],
            "recorded_at": _now(),
        })
        # Loan creation flips FC.bank_disbursement_applicable=true
        fc4 = await db.financial_clearances.find_one({"booking_id": book4["id"]}, {"_id": 0})
        if fc4:
            checklist = dict(fc4.get("checklist") or {})
            checklist["bank_disbursement_applicable"] = True
            await db.financial_clearances.update_one({"id": fc4["id"]}, {"$set": {"checklist": checklist, "updated_at": _now()}})

        # Legal Under Review — 1 draft uploaded (cascade T5)
        legal_id_4 = _uid()
        legal_att_4 = _fake_attachment("legal_record", legal_id_4, "Agreement", "sale_agreement_v1.pdf", legal_user["id"])
        await db.attachments.insert_one(legal_att_4)
        legal_doc_4 = {
            "id": legal_id_4,
            "booking_id": book4["id"],
            "status": "Under Review",
            "latest_draft_attachment_id": legal_att_4["id"],
            "deviation_notes": None,
            "reviewed_by": None,
            "reviewed_at": None,
            "approved_by": None,
            "approved_at": None,
            "approval_notes": None,
            "rejection_reason": None,
            "created_at": _now(),
            "updated_at": _now(),
        }
        await db.legal_records.insert_one(legal_doc_4)
        legal_ver_4 = {
            "id": _uid(),
            "legal_record_id": legal_id_4,
            "version": 1,
            "attachment_id": legal_att_4["id"],
            "uploaded_by": legal_user["id"],
            "uploaded_at": _now(),
            "comments": "Seed: initial draft awaiting review",
        }
        await db.legal_versions.insert_one(legal_ver_4)
        if journey4:
            t5_j4 = await find_journey_task_by_key(journey4["id"], "T5")
            if t5_j4 and t5_j4["status"] != "Completed":
                await system_complete_task(t5_j4["id"], legal_user["id"], note="Seed: draft uploaded (blocked scenario)")

    logger.info("Phase 6 seed complete: loans=%d legal=%d registrations=%d",
                await db.loan_cases.count_documents({}),
                await db.legal_records.count_documents({}),
                await db.registrations.count_documents({}))



# ================= Phase 7 seed =================

async def _seed_phase7(db):
    """Seed:
    - BKG-000001 (Ravi Kumar / Villa): Unit Readiness with score ~92, ready_for_qa=true, 2 photos.
      3 snags: 1 Minor Closed, 1 Major In Progress, 1 Critical Open (spec §118 test).
      Handover record auto-created; readiness computed; gate Red because critical open.
    - BKG-000002 (Priya Iyer / Apt): Unit Readiness ~60, ready_for_qa=false. No snags.
      Handover record auto-created; gate Red because unit not ready.
    Idempotent — checks collection membership per booking.
    """
    if await db.unit_readiness.count_documents({}) > 0:
        return

    admin = await db.users.find_one({"email": "admin@pranava.local"})
    site = await db.users.find_one({"email": "site@pranava.local"})
    qa = await db.users.find_one({"email": "qa@pranava.local"})
    if not all((admin, site, qa)):
        return

    book1 = await db.bookings.find_one({"code": "BKG-000002"}, {"_id": 0})
    book2 = await db.bookings.find_one({"code": "BKG-000004"}, {"_id": 0})

    # Phase 7 seed component template (percent set per booking)
    def _components(percents_by_name: dict) -> list:
        return [
            {"name": n, "weight": w, "percent": percents_by_name.get(n, 0), "notes": None}
            for n, w in [
                ("Civil", 0.15), ("Flooring", 0.10), ("Doors", 0.05), ("Windows", 0.05),
                ("Painting", 0.10), ("Electrical", 0.10), ("Plumbing", 0.10), ("Sanitary", 0.05),
                ("Kitchen", 0.10), ("HVAC", 0.05), ("Utilities", 0.05), ("External Works", 0.05),
                ("Cleaning", 0.03), ("Common Area Dependencies", 0.02),
            ]
        ]

    n_created = 0

    if book1:
        # ~92% overall — most components at 90-95
        high_pcts = {
            "Civil": 95, "Flooring": 95, "Doors": 95, "Windows": 92, "Painting": 88,
            "Electrical": 92, "Plumbing": 92, "Sanitary": 90, "Kitchen": 90, "HVAC": 92,
            "Utilities": 90, "External Works": 85, "Cleaning": 90, "Common Area Dependencies": 90,
        }
        # Placeholder small PNG for photos
        png_bytes = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0"
            b"\x00\x00\x00\x03\x00\x01\x5b\xcaz\xb5\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        from pathlib import Path as _P
        ur1_id = _uid()
        photo_ids = []
        for i in range(2):
            att_id = _uid()
            dest_dir = _P(os.environ.get("ATTACHMENT_STORAGE_ROOT", "./.data/attachments")) / "unit_readiness" / ur1_id
            dest_dir.mkdir(parents=True, exist_ok=True)
            stored = f"{uuid.uuid4().hex}_ready_photo_{i}.png"
            (dest_dir / stored).write_bytes(png_bytes)
            await db.attachments.insert_one({
                "id": att_id, "entity_type": "unit_readiness", "entity_id": ur1_id, "comment_id": None,
                "filename": f"ready_photo_{i+1}.png",
                "storage_path": f"unit_readiness/{ur1_id}/{stored}",
                "mime_type": "image/png", "size_bytes": len(png_bytes),
                "category": "Snag", "version": 1, "visibility": "Internal", "description": "site readiness photo",
                "uploaded_by": site["id"], "uploaded_at": _now(),
                "verification_status": "Uploaded", "verified_by": None, "verified_at": None,
                "verification_notes": None, "deleted_at": None,
            })
            photo_ids.append(att_id)
        await db.unit_readiness.insert_one({
            "id": ur1_id, "booking_id": book1["id"],
            "components": _components(high_pcts),
            "site_engineer_user_id": site["id"], "site_engineer_name": "Ramesh Kulkarni",
            "ready_declared_at": _now(), "ready_notes": "Handover-ready. Cleaning + external works pending final walkthrough.",
            "ready_for_qa": True, "photo_attachment_ids": photo_ids,
            "created_at": _now(), "updated_at": _now(),
        })
        n_created += 1

        # Cascade T11 on the journey
        journey = await db.customer_journeys.find_one({"booking_id": book1["id"]}, {"_id": 0, "id": 1})
        if journey:
            from engine_hooks import find_journey_task_by_key, system_complete_task
            t11 = await find_journey_task_by_key(journey["id"], "T11")
            if t11 and t11["status"] != "Completed":
                await system_complete_task(t11["id"], site["id"], note="Seed: site declared Ready-for-QA")

        # Seed 3 snags for BKG-000001
        seq = await next_sequence("snag")
        await db.snags.insert_one({
            "id": _uid(), "code": f"SNG-{seq:06d}", "booking_id": book1["id"], "unit_id": book1["unit_id"],
            "room": "Master Bedroom", "category": "Painting", "severity": "Minor",
            "description": "Touch-up needed on east wall.",
            "before_photo_attachment_id": None, "after_photo_attachment_id": None,
            "owner_user_id": None, "contractor_name": "Rangan Paints",
            "due_date": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(),
            "status": "Closed", "verified_by": qa["id"],
            "closed_date": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
            "reopen_reason": None, "created_by": qa["id"],
            "created_at": (datetime.now(timezone.utc) - timedelta(days=4)).isoformat(),
            "updated_at": _now(),
        })
        seq = await next_sequence("snag")
        await db.snags.insert_one({
            "id": _uid(), "code": f"SNG-{seq:06d}", "booking_id": book1["id"], "unit_id": book1["unit_id"],
            "room": "Kitchen", "category": "Plumbing", "severity": "Major",
            "description": "Sink drain slow — needs re-piping under counter.",
            "before_photo_attachment_id": None, "after_photo_attachment_id": None,
            "owner_user_id": None, "contractor_name": "AquaFlow",
            "due_date": (datetime.now(timezone.utc) + timedelta(days=5)).isoformat(),
            "status": "In Progress", "verified_by": None, "closed_date": None,
            "reopen_reason": None, "created_by": qa["id"],
            "created_at": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat(),
            "updated_at": _now(),
        })
        seq = await next_sequence("snag")
        await db.snags.insert_one({
            "id": _uid(), "code": f"SNG-{seq:06d}", "booking_id": book1["id"], "unit_id": book1["unit_id"],
            "room": "Living", "category": "Electrical", "severity": "Critical",
            "description": "Distribution board tripping on load — safety hazard, blocks handover per §118.",
            "before_photo_attachment_id": None, "after_photo_attachment_id": None,
            "owner_user_id": None, "contractor_name": "Volt Masters",
            "due_date": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
            "status": "Open", "verified_by": None, "closed_date": None,
            "reopen_reason": None, "created_by": qa["id"],
            "created_at": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat(),
            "updated_at": _now(),
        })

        # Auto-create handover for BKG-000001
        await db.handovers.insert_one({
            "id": _uid(), "booking_id": book1["id"], "override": None,
            "scheduled": {"proposed_date": None, "customer_preferred_date": None, "final_date": None, "final_time": None,
                          "location": None, "customer_confirmation": False, "internal_rep_user_id": None},
            "date_revision_history": [],
            "checklist": {
                "property": {"cleaning": False, "electrical": False, "plumbing": False, "fixtures": False, "doors_windows": False, "snag_clearance": False},
                "keys": {"main_door_count": 0, "secondary_count": 0, "utility_count": 0, "other_count": 0, "all_handed_over": False},
                "access": {"access_cards_count": 0, "parking_slot_ids": [], "clubhouse_confirmed": False, "security_briefed": False},
                "utilities": {"electricity_meter_no": None, "electricity_reading": None, "water_meter_no": None, "water_reading": None, "other_notes": None},
                "documents": {"possession_letter": False, "warranties": False, "manuals": False, "registration_copy": False, "maintenance_docs": False, "contact_directory": False},
            },
            "acknowledgement": None,
            "post_handover": {"facility_intro_done": False, "maintenance_setup_done": False, "owner_record_transferred": False,
                              "warranties_shared": False, "pending_snag_monitoring": False, "closure_confirmed_at": None},
            "status": "Not Started",
            "created_at": _now(), "updated_at": _now(),
        })

    if book2:
        # Mid-build ~60%
        mid_pcts = {
            "Civil": 80, "Flooring": 70, "Doors": 50, "Windows": 60, "Painting": 50,
            "Electrical": 65, "Plumbing": 65, "Sanitary": 55, "Kitchen": 55, "HVAC": 55,
            "Utilities": 60, "External Works": 40, "Cleaning": 30, "Common Area Dependencies": 40,
        }
        await db.unit_readiness.insert_one({
            "id": _uid(), "booking_id": book2["id"],
            "components": _components(mid_pcts),
            "site_engineer_user_id": None, "site_engineer_name": None,
            "ready_declared_at": None, "ready_notes": None,
            "ready_for_qa": False, "photo_attachment_ids": [],
            "created_at": _now(), "updated_at": _now(),
        })
        n_created += 1
        await db.handovers.insert_one({
            "id": _uid(), "booking_id": book2["id"], "override": None,
            "scheduled": {"proposed_date": None, "customer_preferred_date": None, "final_date": None, "final_time": None,
                          "location": None, "customer_confirmation": False, "internal_rep_user_id": None},
            "date_revision_history": [],
            "checklist": {
                "property": {"cleaning": False, "electrical": False, "plumbing": False, "fixtures": False, "doors_windows": False, "snag_clearance": False},
                "keys": {"main_door_count": 0, "secondary_count": 0, "utility_count": 0, "other_count": 0, "all_handed_over": False},
                "access": {"access_cards_count": 0, "parking_slot_ids": [], "clubhouse_confirmed": False, "security_briefed": False},
                "utilities": {"electricity_meter_no": None, "electricity_reading": None, "water_meter_no": None, "water_reading": None, "other_notes": None},
                "documents": {"possession_letter": False, "warranties": False, "manuals": False, "registration_copy": False, "maintenance_docs": False, "contact_directory": False},
            },
            "acknowledgement": None,
            "post_handover": {"facility_intro_done": False, "maintenance_setup_done": False, "owner_record_transferred": False,
                              "warranties_shared": False, "pending_snag_monitoring": False, "closure_confirmed_at": None},
            "status": "Not Started",
            "created_at": _now(), "updated_at": _now(),
        })

    logger.info("Phase 7 seed complete: unit_readiness=%d snags=%d handovers=%d", n_created,
                await db.snags.count_documents({}), await db.handovers.count_documents({}))



# ================= Phase 8 seed =================

async def _seed_phase8(db):
    """Seed 2 sample communications (BKG-000001 + BKG-000002) and 1 manual escalation
    (BKG-000004 — "Customer requested handover advance"). Idempotent by collection empty."""
    if await db.communications.count_documents({}) > 0:
        return
    admin = await db.users.find_one({"email": "admin@pranava.local"})
    crm = await db.users.find_one({"email": "crm@pranava.local"})
    if not admin or not crm:
        return

    cust1 = await db.customers.find_one({"code": "CUS-000001"})
    cust2 = await db.customers.find_one({"code": "CUS-000002"})
    cust4 = await db.customers.find_one({"code": "CUS-000004"})
    book1 = await db.bookings.find_one({"code": "BKG-000001"}) if cust1 else None
    book2 = await db.bookings.find_one({"code": "BKG-000002"}) if cust2 else None
    book4 = await db.bookings.find_one({"code": "BKG-000004"}) if cust4 else None

    def _seq_com(n): return f"COM-{n:06d}"

    # Communication 1 — Priya (CUS-000002) inbound phone with follow-up
    if cust2:
        s1 = await next_sequence("communication")
        await db.communications.insert_one({
            "id": _uid(), "code": _seq_com(s1),
            "customer_id": cust2["id"], "booking_id": (book2 or {}).get("id"),
            "channel": "Phone", "direction": "Inbound",
            "subject": "Handover date preference",
            "summary": "Customer asked to schedule final walkthrough for next weekend. Awaiting confirmation from site.",
            "employee_user_id": crm["id"], "department_id": crm.get("department_id"),
            "communicated_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
            "follow_up_required": True,
            "follow_up_date": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
            "follow_up_owner_user_id": crm["id"],
            "customer_visible": False, "attachment_ids": [],
            "created_at": _now(), "updated_at": _now(),
        })

    # Communication 2 — Ravi (CUS-000001) outbound email
    if cust1:
        s2 = await next_sequence("communication")
        await db.communications.insert_one({
            "id": _uid(), "code": _seq_com(s2),
            "customer_id": cust1["id"], "booking_id": (book1 or {}).get("id"),
            "channel": "Email", "direction": "Outbound",
            "subject": "Booking amount receipt shared",
            "summary": "Sent booking-amount receipt + welcome PDF over email. No response needed.",
            "employee_user_id": crm["id"], "department_id": crm.get("department_id"),
            "communicated_at": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat(),
            "follow_up_required": False, "follow_up_date": None, "follow_up_owner_user_id": None,
            "customer_visible": True, "attachment_ids": [],
            "created_at": _now(), "updated_at": _now(),
        })

    # Manual escalation for BKG-000004 (Anjali Menon)
    if cust4:
        crm_dept = await db.departments.find_one({"code": "CRM"})
        if crm_dept:
            seq = await next_sequence("escalation")
            await db.escalations.insert_one({
                "id": _uid(), "code": f"ESC-{seq:06d}", "rule_key": "manual",
                "customer_id": cust4["id"], "unit_id": None, "booking_id": (book4 or {}).get("id"),
                "journey_id": None, "department_id": crm_dept["id"],
                "owner_user_id": None, "severity": "Medium", "status": "Open",
                "title": "Customer requested handover advance",
                "description": "Anjali Menon requested to advance her handover date. Needs CRM to coordinate with Site + Handover for feasibility.",
                "source_entity_type": None, "source_entity_id": None,
                "due_date": (datetime.now(timezone.utc) + timedelta(days=5)).isoformat(),
                "resolution_notes": None,
                "acknowledged_by": None, "acknowledged_at": None,
                "resolved_by": None, "resolved_at": None,
                "closed_by": None, "closed_at": None,
                "created_at": _now(), "updated_at": _now(),
            })

    logger.info("Phase 8 seed complete: communications=%d escalations(pre-scan)=%d",
                await db.communications.count_documents({}),
                await db.escalations.count_documents({}))



# ================= Phase 9 migration =================

async def _phase9_migration(db):
    """Idempotent:
    - Every non-Super-Admin, non-Management user gets assigned to BOTH seeded projects
      if `assigned_project_ids` is empty.
    - Seed 2 Commercial Office units on Serenity Heights.
    """
    # Only assign the CANONICAL seed projects (GRW + SRH) — not tester leftovers.
    grw = await db.projects.find_one({"code": "GRW"}, {"_id": 0, "id": 1})
    srh = await db.projects.find_one({"code": "SRH"}, {"_id": 0, "id": 1})
    canonical_ids = [p["id"] for p in (grw, srh) if p]
    updated = skipped_admin = skipped_set = 0

    roles = {r["id"]: r async for r in db.roles.find({}, {"_id": 0, "id": 1, "code": 1})}
    users = await db.users.find({}, {"_id": 0}).to_list(2000)
    for u in users:
        role_code = (roles.get(u.get("role_id")) or {}).get("code", "")
        if role_code in {"SUPER_ADMIN", "MANAGEMENT"}:
            skipped_admin += 1
            continue
        if u.get("assigned_project_ids"):
            skipped_set += 1
            continue
        await db.users.update_one(
            {"id": u["id"]},
            {"$set": {"assigned_project_ids": canonical_ids, "updated_at": _now()}},
        )
        updated += 1
    logger.info(
        "assigned_project_migration: {updated: %d, skipped_admin_mgmt: %d, skipped_already_set: %d}",
        updated, skipped_admin, skipped_set,
    )

    # Commercial Office units on Serenity Heights (Apartment project) — idempotent
    if await db.units.count_documents({"unit_type": "Commercial Office"}) == 0:
        srh = await db.projects.find_one({"code": "SRH"}, {"_id": 0, "id": 1})
        if srh:
            for i, code in enumerate(["SRH-C001", "SRH-C002"], start=1):
                if await db.units.find_one({"code": code}):
                    continue
                await db.units.insert_one({
                    "id": _uid(),
                    "project_id": srh["id"],
                    "code": code,
                    "tower": "C",
                    "floor": i,
                    "unit_no": code.split("-")[1],
                    "unit_type": "Commercial Office",
                    "carpet_area_sqft": 1200 + 200 * i,
                    "facing": "East",
                    "parking_count": 2,
                    "status": "Available",
                    "base_price_inr": 2_50_00_000 + 25_00_000 * i,
                })
            logger.info("Phase 9 Commercial Office units seeded")


# ================= Phase A migration: Site Engineer consolidation =================

async def _phaseA_role_consolidation(db):
    """Idempotent migration for the RBAC repalette (Feb 2026).

    - Ensures a single canonical `SITE_ENGINEER` role exists.
    - Reassigns every user still pointing at the old `SITE` / `QA` / `HANDOVER`
      role rows onto the new `SITE_ENGINEER` role.
    - Marks the old role rows as inactive but keeps them for alias lookups.
    - Also normalises any users historically stamped `banking_loan` / `home_loan`
      onto the `BANKING` role.
    - Prints per-migration counts at boot.
    """
    now = _now()

    # 1. Ensure SITE_ENGINEER role row exists
    site_eng = await db.roles.find_one({"code": "SITE_ENGINEER"}, {"_id": 0})
    if not site_eng:
        site_eng = {
            "id": _uid(),
            "code": "SITE_ENGINEER",
            "name": "Site Engineer",
            "description": "Consolidated Site / QA / Handover role (Phase A)",
            "is_super_admin": False,
            "active": True,
            "created_at": now,
            "updated_at": now,
        }
        await db.roles.insert_one(site_eng)
        logger.info("phaseA_role: created SITE_ENGINEER role")

    # 2. Reassign users on legacy Site/QA/Handover to SITE_ENGINEER
    legacy_codes = ["SITE", "QA", "HANDOVER"]
    legacy_role_ids = [
        r["id"] async for r in db.roles.find(
            {"code": {"$in": legacy_codes}}, {"_id": 0, "id": 1}
        )
    ]
    reassigned = 0
    if legacy_role_ids:
        res = await db.users.update_many(
            {"role_id": {"$in": legacy_role_ids}},
            {"$set": {"role_id": site_eng["id"], "updated_at": now}},
        )
        reassigned = res.modified_count

    # 3. Mark legacy role rows inactive (keep for aliasing)
    deactivated = 0
    if legacy_role_ids:
        res2 = await db.roles.update_many(
            {"id": {"$in": legacy_role_ids}},
            {"$set": {"active": False, "updated_at": now}},
        )
        deactivated = res2.modified_count

    # 4. Legacy banking codes → canonical BANKING
    banking = await db.roles.find_one({"code": "BANKING"}, {"_id": 0, "id": 1})
    banking_reassigned = 0
    if banking:
        legacy_banking = [
            r["id"] async for r in db.roles.find(
                {"code": {"$in": ["BANKING_LOAN", "HOME_LOAN"]}},
                {"_id": 0, "id": 1},
            )
        ]
        if legacy_banking:
            res3 = await db.users.update_many(
                {"role_id": {"$in": legacy_banking}},
                {"$set": {"role_id": banking["id"], "updated_at": now}},
            )
            banking_reassigned = res3.modified_count

    logger.info(
        "phaseA_role_consolidation: {reassigned_to_site_engineer: %d, legacy_roles_deactivated: %d, banking_reassigned: %d}",
        reassigned, deactivated, banking_reassigned,
    )

