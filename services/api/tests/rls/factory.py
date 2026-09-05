"""Insert one row per RLS-enabled table for a given project, as `homeflow_owner`.

Deliberately hand-written rather than schema-introspected: the sweep has to prove the
policies, and a generic row builder would be a second, subtly different model of the
schema to keep in step. Adding a table to a migration adds three lines here.
"""
from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg


async def _one(conn: asyncpg.Connection, sql: str, *args: Any) -> UUID:
    row = await conn.fetchrow(sql + " RETURNING id", *args)
    assert row is not None
    return row["id"]


async def seed_project(conn: asyncpg.Connection, code: str) -> dict[str, UUID]:
    """Create one row in every project-partitioned table for a single project."""
    ids: dict[str, UUID] = {}

    ids["user"] = await _one(
        conn,
        'INSERT INTO "user" (email, full_name) VALUES ($1, $2)',
        f"{code.lower()}@pranava.in",
        f"{code} Owner",
    )
    ids["project"] = await _one(
        conn,
        "INSERT INTO project (code, name, product_type, legal_entity, jurisdiction)"
        " VALUES ($1, $2, 'villa', 'Pranava Estates Pvt Ltd', 'Telangana')",
        code,
        f"{code} Estate",
    )
    ids["project_hierarchy_node"] = await _one(
        conn,
        "INSERT INTO project_hierarchy_node (project_id, node_type, code, name)"
        " VALUES ($1, 'phase', 'P1', 'Phase 1')",
        ids["project"],
    )
    ids["unit"] = await _one(
        conn,
        "INSERT INTO unit (project_id, hierarchy_node_id, unit_number, unit_type,"
        " carpet_area, built_up_area, saleable_area)"
        " VALUES ($1, $2, 'V101', 'Villa-Type-2', 1850.00, 2400.00, 2650.00)",
        ids["project"],
        ids["project_hierarchy_node"],
    )
    ids["customer"] = await _one(
        conn,
        "INSERT INTO customer (customer_type, display_name, primary_phone, primary_email)"
        " VALUES ('individual', $1, $2, $3)",
        f"{code} Family",
        f"+9198{abs(hash(code)) % 100000000:08d}",
        f"{code.lower()}.family@example.com",
    )
    ids["booking"] = await _one(
        conn,
        "INSERT INTO booking (project_id, unit_id, booking_number, booking_date,"
        " total_consideration, sales_owner_id)"
        " VALUES ($1, $2, 'BKG-0001', current_date, 18500000.00, $3)",
        ids["project"],
        ids["unit"],
        ids["user"],
    )
    ids["booking_applicant"] = await _one(
        conn,
        "INSERT INTO booking_applicant (project_id, booking_id, customer_id, role)"
        " VALUES ($1, $2, $3, 'primary')",
        ids["project"],
        ids["booking"],
        ids["customer"],
    )
    ids["team"] = await _one(
        conn,
        "INSERT INTO team (code, name, department) VALUES ($1, $2, 'crm')",
        f"{code}-CRM",
        f"{code} CRM team",
    )
    ids["project_team_assignment"] = await _one(
        conn,
        "INSERT INTO project_team_assignment (project_id, team_id, department,"
        " assignment_type, effective_from) VALUES ($1, $2, 'crm', 'dedicated', current_date)",
        ids["project"],
        ids["team"],
    )
    await _seed_twins(conn, ids, code)
    return ids


async def _seed_twins(conn: asyncpg.Connection, ids: dict[str, UUID], code: str) -> None:
    ids["component_definition"] = await _one(
        conn,
        "INSERT INTO component_definition (code, name, room_trade_system)"
        " VALUES ($1, 'MEP first fix', 'Electrical')",
        f"{code}-mep-first-fix",
    )
    ids["change_category"] = await _one(
        conn,
        "INSERT INTO change_category (code, room_trade_system, customer_label,"
        " technical_owner_dept) VALUES ($1, 'Kitchen', 'Kitchen finishes', 'design')",
        f"{code}-kitchen",
    )
    ids["change_gate_rule"] = await _one(
        conn,
        "INSERT INTO change_gate_rule (category_id, trigger_component_id, condition,"
        " resulting_state, classification, effective_from)"
        " VALUES ($1, $2, '{\"state_code\": \"in_progress\"}', 'CLOSING', 'soft', current_date)",
        ids["change_category"],
        ids["component_definition"],
    )
    ids["unit_spec_item"] = await _one(
        conn,
        "INSERT INTO unit_spec_item (project_id, unit_id, category_id, component,"
        " standard_value, current_value)"
        ' VALUES ($1, $2, $3, \'Worktop\', \'{"brand": "Hettich"}\', \'{"brand": "Hettich"}\')',
        ids["project"],
        ids["unit"],
        ids["change_category"],
    )
    ids["unit_progress_state"] = await _one(
        conn,
        "INSERT INTO unit_progress_state (project_id, unit_id, component_id, state_code,"
        " updated_by) VALUES ($1, $2, $3, 'in_progress', $4)",
        ids["project"],
        ids["unit"],
        ids["component_definition"],
        ids["user"],
    )
    ids["unit_change_gate"] = await _one(
        conn,
        "INSERT INTO unit_change_gate (project_id, unit_id, category_id, current_state,"
        " reason_code) VALUES ($1, $2, $3, 'CLOSING', 'mep_first_fix_started')",
        ids["project"],
        ids["unit"],
        ids["change_category"],
    )
    ids["qa_evidence"] = await _one(
        conn,
        "INSERT INTO qa_evidence (project_id, unit_id, component_id, result, inspector_id)"
        " VALUES ($1, $2, $3, 'pass', $4)",
        ids["project"],
        ids["unit"],
        ids["component_definition"],
        ids["user"],
    )
    ids["snag"] = await _one(
        conn,
        "INSERT INTO snag (project_id, unit_id, category, severity)"
        " VALUES ($1, $2, 'Paint', 'minor')",
        ids["project"],
        ids["unit"],
    )
    ids["file_object"] = await _one(
        conn,
        "INSERT INTO file_object (project_id, entity_type, entity_id, s3_key, filename,"
        " content_type, uploaded_by)"
        " VALUES ($1, 'unit', $2, $3, 'drawing.pdf', 'application/pdf', '{\"type\": \"system\"}')",
        ids["project"],
        ids["unit"],
        f"{ids['project']}/unit/{ids['unit']}/{code}-drawing.pdf",
    )
    ids["event"] = await _one(
        conn,
        "INSERT INTO event (event_type, occurred_at, project_id, actor, subject)"
        " VALUES ('unit.progress.recorded', now(), $1, '{\"type\": \"system\"}',"
        "         jsonb_build_object('unit_id', $2::text))",
        ids["project"],
        str(ids["unit"]),
    )
    ids["as_built_revision"] = await _one(
        conn,
        "INSERT INTO as_built_revision (project_id, unit_id, revision_number,"
        " drawing_file_id, released_by) VALUES ($1, $2, 1, $3, $4)",
        ids["project"],
        ids["unit"],
        ids["file_object"],
        ids["user"],
    )
    ids["home_passport_item"] = await _one(
        conn,
        "INSERT INTO home_passport_item (project_id, unit_id, item_type, name)"
        " VALUES ($1, $2, 'equipment', 'Water heater')",
        ids["project"],
        ids["unit"],
    )
    ids["handover_record"] = await _one(
        conn,
        "INSERT INTO handover_record (project_id, unit_id, booking_id) VALUES ($1, $2, $3)",
        ids["project"],
        ids["unit"],
        ids["booking"],
    )


#: Delete order for a seeded project: children before parents (no cascades anywhere).
CHILD_TABLES = (
    "event",
    "handover_record",
    "home_passport_item",
    "as_built_revision",
    "snag",
    "qa_evidence",
    "unit_change_gate",
    "unit_progress_state",
    "unit_spec_item",
    "file_object",
    "booking_applicant",
    "booking",
    "project_team_assignment",
    "unit",
    "project_hierarchy_node",
)


async def purge(conn: asyncpg.Connection, prefix: str) -> None:
    """Remove every row a `seed_project(code)` created, for codes starting `prefix`.

    Only a test (or a migration) does this: the app role has no DELETE grant on these.
    """
    scope = f"SELECT id FROM project WHERE code LIKE '{prefix}%'"
    for table in CHILD_TABLES:
        await conn.execute(f"DELETE FROM {table} WHERE project_id IN ({scope})")
    await conn.execute(
        "DELETE FROM change_gate_rule WHERE category_id IN"
        f" (SELECT id FROM change_category WHERE code LIKE '{prefix}%')"
    )
    await conn.execute(f"DELETE FROM change_category WHERE code LIKE '{prefix}%'")
    await conn.execute(f"DELETE FROM component_definition WHERE code LIKE '{prefix}%'")
    await conn.execute(f"DELETE FROM team WHERE code LIKE '{prefix}%'")
    await conn.execute(f"DELETE FROM customer WHERE primary_email LIKE '{prefix.lower()}%'")
    await conn.execute(f"DELETE FROM project WHERE code LIKE '{prefix}%'")
    await conn.execute(
        "DELETE FROM user_role_assignment WHERE user_id IN"
        f" (SELECT id FROM \"user\" WHERE email LIKE '{prefix.lower()}%')"
    )
    await conn.execute(f"DELETE FROM \"user\" WHERE email LIKE '{prefix.lower()}%'")
