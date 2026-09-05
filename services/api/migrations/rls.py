"""Migration helpers: the standard column block, the two triggers, and RLS (technical/02 §2-3).

Every project-partitioned table gets its policies from `rls()` so they are identical
everywhere; a table that skips it shows up in the `tests/rls` sweep.
"""
from __future__ import annotations

from migrations.sql import sql

# The standard block from technical/02 §2. `project_id` is derived on write and
# re-validated by enforce_project_id() on tables that hang off unit/booking.
STANDARD_COLUMNS = """
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  project_id  uuid NOT NULL REFERENCES project(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
"""

_STAFF_POLICY = """
CREATE POLICY staff_project ON {table}
  USING (
    current_setting('app.realm', true) = 'staff'
    AND ( current_setting('app.all_projects', true) = 'true'
          OR project_id = ANY (string_to_array(current_setting('app.project_ids', true), ',')::uuid[]) )
  );
"""

# customer_via names the column that reaches booking_applicant:
#   'id'         the booking table itself
#   'booking_id' a table hanging off booking
#   'unit_id'    a table hanging off unit, reachable through the customer's bookings
_CUSTOMER_PREDICATE = {
    "id": "id IN (SELECT booking_id FROM booking_applicant WHERE customer_id = _hf_customer_id())",
    "booking_id": (
        "booking_id IN (SELECT booking_id FROM booking_applicant WHERE customer_id = _hf_customer_id())"
    ),
    "unit_id": (
        "unit_id IN (SELECT b.unit_id FROM booking b"
        " JOIN booking_applicant ba ON ba.booking_id = b.id"
        " WHERE ba.customer_id = _hf_customer_id())"
    ),
}


def rls(table: str, customer_via: str | None = None) -> None:
    """Enable + FORCE row security and install the standard policies."""
    sql(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
    sql(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")
    sql(_STAFF_POLICY.format(table=table))
    if customer_via is not None:
        predicate = _CUSTOMER_PREDICATE[customer_via]
        sql(
            f"CREATE POLICY customer_own ON {table} USING ("
            f"  current_setting('app.realm', true) = 'customer' AND {predicate});"
        )


def set_updated_at(table: str) -> None:
    sql(
        f"CREATE TRIGGER {table}_set_updated_at BEFORE UPDATE ON {table}"
        f" FOR EACH ROW EXECUTE FUNCTION set_updated_at();"
    )


def enforce_project_id(table: str, parent_table: str, parent_fk: str) -> None:
    """Derive and re-validate project_id from the parent row on INSERT/UPDATE."""
    sql(
        f"CREATE TRIGGER {table}_enforce_project_id BEFORE INSERT OR UPDATE ON {table}"
        f" FOR EACH ROW EXECUTE FUNCTION enforce_project_id('{parent_table}', '{parent_fk}');"
    )


def partitioned(
    table: str,
    body: str,
    *,
    parent: tuple[str, str] | None = None,
    customer_via: str | None = None,
) -> None:
    """Create a project-partitioned table with the standard block, triggers and RLS."""
    sql(f"CREATE TABLE {table} (\n{STANDARD_COLUMNS},\n{body}\n);")
    set_updated_at(table)
    if parent is not None:
        enforce_project_id(table, parent[0], parent[1])
    rls(table, customer_via)
