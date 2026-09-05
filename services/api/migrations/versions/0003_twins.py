"""0003 twins — component taxonomy, gates, spec, progress, QA, snags, as-built, passport.

Columns from foundation/unit-twin.md §2 and gates.md A.2; mechanics from technical/02 §2-3, §5.
`component_definition`, `change_category` and `change_gate_rule` are config: readable by all
staff, written only through modules/admin, so they get the staff policy with no project filter.
"""
from __future__ import annotations

from migrations.rls import partitioned, set_updated_at
from migrations.sql import sql

revision = "0003_twins"
down_revision = "0002_core"
branch_labels = None
depends_on = None

_CONFIG_TABLES = ("component_definition", "change_category", "change_gate_rule")
_GATE_STATES = "'OPEN','CLOSING','CONDITIONAL','EXCEPTION_ONLY','HARD_CLOSED'"
_FRESHNESS = "'fresh','stale','verification_required'"


def upgrade() -> None:
    _config()
    _spec_and_progress()
    _gates()
    _qa_and_snags()
    _as_built_and_passport()
    _handover()
    _file_object_customer_policy()


def _config() -> None:
    sql(
        f"""
        CREATE TABLE component_definition (
          id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
          code text UNIQUE NOT NULL,
          name text NOT NULL,
          room_trade_system text NOT NULL,
          sort_order int NOT NULL DEFAULT 0,
          readiness_weight numeric(5,2) NOT NULL DEFAULT 1,
          project_applicability jsonb NOT NULL DEFAULT '{{}}',
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now());

        CREATE TABLE change_category (
          id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
          code text UNIQUE NOT NULL,
          project_applicability jsonb NOT NULL DEFAULT '{{}}',
          room_trade_system text NOT NULL,
          customer_label text NOT NULL,
          customer_visible boolean NOT NULL DEFAULT false,
          technical_owner_dept text NOT NULL
            CHECK (technical_owner_dept IN ('project','design','procurement')),
          default_policy jsonb NOT NULL DEFAULT '{{}}',
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now());

        CREATE TABLE change_gate_rule (
          id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
          category_id uuid NOT NULL REFERENCES change_category(id) ON DELETE RESTRICT,
          trigger_component_id uuid NOT NULL REFERENCES component_definition(id) ON DELETE RESTRICT,
          condition jsonb NOT NULL,
          resulting_state text NOT NULL CHECK (resulting_state IN ({_GATE_STATES})),
          classification text NOT NULL CHECK (classification IN ('soft','hard')),
          exception_authority_role text REFERENCES role(id) ON DELETE RESTRICT,
          effective_from date NOT NULL,
          effective_to date,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now());
        CREATE INDEX change_gate_rule_category_idx
          ON change_gate_rule (category_id, effective_from);
        """
    )
    for table in _CONFIG_TABLES:
        set_updated_at(table)
        sql(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        sql(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;")
        sql(
            f"CREATE POLICY staff_all ON {table}"
            " USING (current_setting('app.realm', true) = 'staff');"
        )


def _spec_and_progress() -> None:
    partitioned(
        "unit_spec_item",
        """
          unit_id uuid NOT NULL REFERENCES unit(id) ON DELETE RESTRICT,
          category_id uuid NOT NULL REFERENCES change_category(id) ON DELETE RESTRICT,
          component text NOT NULL,
          standard_value jsonb NOT NULL,
          current_value jsonb NOT NULL,
          drawing_revision_id uuid,
          is_variation boolean NOT NULL DEFAULT false,
          CONSTRAINT unit_spec_item_uq UNIQUE (unit_id, category_id, component)
        """,
        parent=("unit", "unit_id"),
        customer_via="unit_id",
    )
    partitioned(
        "unit_progress_state",
        f"""
          unit_id uuid NOT NULL REFERENCES unit(id) ON DELETE RESTRICT,
          component_id uuid NOT NULL REFERENCES component_definition(id) ON DELETE RESTRICT,
          state_code text NOT NULL
            CHECK (state_code IN ('not_started','in_progress','complete','verified')),
          progress_pct numeric(5,2),
          actual_date timestamptz,
          planned_next_event text,
          expected_next_at timestamptz,
          source_system text NOT NULL DEFAULT 'homeflow_native',
          source_record_id text,
          updated_by uuid REFERENCES "user"(id) ON DELETE RESTRICT,
          freshness_status text NOT NULL DEFAULT 'fresh'
            CHECK (freshness_status IN ({_FRESHNESS}))
        """,
        parent=("unit", "unit_id"),
    )
    sql(
        "CREATE UNIQUE INDEX unit_progress_state_uq ON unit_progress_state (unit_id, component_id);"
    )
    sql(
        "CREATE INDEX unit_progress_state_freshness_idx"
        " ON unit_progress_state (project_id, updated_at);"
    )


def _gates() -> None:
    # Rule-derived only: no module writes this table, the gate.reevaluate job does.
    partitioned(
        "unit_change_gate",
        f"""
          unit_id uuid NOT NULL REFERENCES unit(id) ON DELETE RESTRICT,
          category_id uuid NOT NULL REFERENCES change_category(id) ON DELETE RESTRICT,
          current_state text NOT NULL CHECK (current_state IN ({_GATE_STATES})),
          reason_code text NOT NULL,
          source_event text,
          expected_close_at timestamptz,
          closing_event text,
          last_evaluated_at timestamptz NOT NULL DEFAULT now(),
          freshness_status text NOT NULL DEFAULT 'fresh'
            CHECK (freshness_status IN ({_FRESHNESS}))
        """,
        parent=("unit", "unit_id"),
        customer_via="unit_id",
    )
    sql("CREATE UNIQUE INDEX unit_change_gate_uq ON unit_change_gate (unit_id, category_id);")
    sql(
        "CREATE INDEX unit_change_gate_state_idx ON unit_change_gate (project_id, current_state);"
    )


def _qa_and_snags() -> None:
    partitioned(
        "qa_evidence",
        """
          unit_id uuid NOT NULL REFERENCES unit(id) ON DELETE RESTRICT,
          component_id uuid NOT NULL REFERENCES component_definition(id) ON DELETE RESTRICT,
          checklist_id uuid,
          result text NOT NULL CHECK (result IN ('pass','fail','na')),
          photo_ids uuid[] NOT NULL DEFAULT '{}',
          test_certificate_ids uuid[] NOT NULL DEFAULT '{}',
          inspector_id uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
          verified_at timestamptz,
          is_independent_verification boolean NOT NULL DEFAULT false
        """,
        parent=("unit", "unit_id"),
    )
    sql("CREATE INDEX qa_evidence_unit_idx ON qa_evidence (unit_id, component_id);")

    partitioned(
        "snag",
        """
          unit_id uuid NOT NULL REFERENCES unit(id) ON DELETE RESTRICT,
          category text NOT NULL,
          severity text NOT NULL CHECK (severity IN ('critical','major','minor')),
          location text,
          trade text,
          vendor_id uuid,
          root_cause_code text,
          status text NOT NULL DEFAULT 'open' CHECK (status IN
            ('open','assigned','in_progress','ready_for_qa','reopened','verified','closed')),
          before_photo_ids uuid[] NOT NULL DEFAULT '{}',
          after_photo_ids uuid[] NOT NULL DEFAULT '{}',
          is_repeat boolean NOT NULL DEFAULT false,
          rectification_cost numeric(14,2),
          sla_due_at timestamptz
        """,
        parent=("unit", "unit_id"),
    )
    sql("CREATE INDEX snag_unit_status_idx ON snag (unit_id, status);")
    sql("CREATE INDEX snag_severity_idx ON snag (project_id, severity, status);")


def _as_built_and_passport() -> None:
    partitioned(
        "as_built_revision",
        """
          unit_id uuid NOT NULL REFERENCES unit(id) ON DELETE RESTRICT,
          revision_number int NOT NULL,
          source_cr_id uuid,
          drawing_file_id uuid NOT NULL REFERENCES file_object(id) ON DELETE RESTRICT,
          status text NOT NULL DEFAULT 'released' CHECK (status IN ('released','superseded')),
          released_at timestamptz NOT NULL DEFAULT now(),
          released_by uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
          CONSTRAINT as_built_revision_uq UNIQUE (unit_id, revision_number)
        """,
        parent=("unit", "unit_id"),
    )
    # Only one released revision per unit — superseded ones can never be mistaken for current.
    sql(
        "CREATE UNIQUE INDEX as_built_revision_current_uq ON as_built_revision (unit_id)"
        " WHERE status = 'released';"
    )
    sql(
        "ALTER TABLE unit_spec_item ADD CONSTRAINT fk_unit_spec_item_drawing_revision_id"
        " FOREIGN KEY (drawing_revision_id) REFERENCES as_built_revision(id) ON DELETE RESTRICT;"
    )

    partitioned(
        "home_passport_item",
        """
          unit_id uuid NOT NULL REFERENCES unit(id) ON DELETE RESTRICT,
          item_type text NOT NULL CHECK (item_type IN ('equipment','finish','warranty','manual')),
          name text NOT NULL,
          serial_number text,
          brand_model text,
          paint_tile_code text,
          warranty_start date,
          warranty_end date,
          manual_file_id uuid REFERENCES file_object(id) ON DELETE RESTRICT
        """,
        parent=("unit", "unit_id"),
        customer_via="unit_id",
    )
    sql("CREATE INDEX home_passport_item_unit_idx ON home_passport_item (unit_id, item_type);")


def _handover() -> None:
    partitioned(
        "handover_record",
        """
          unit_id uuid NOT NULL REFERENCES unit(id) ON DELETE RESTRICT,
          booking_id uuid NOT NULL REFERENCES booking(id) ON DELETE RESTRICT,
          readiness_snapshot jsonb NOT NULL DEFAULT '{}',
          meter_readings jsonb NOT NULL DEFAULT '{}',
          keys_issued jsonb NOT NULL DEFAULT '{}',
          manuals_delivered boolean NOT NULL DEFAULT false,
          final_photo_ids uuid[] NOT NULL DEFAULT '{}',
          signature_file_ids uuid[] NOT NULL DEFAULT '{}',
          appointment_at timestamptz,
          status text NOT NULL DEFAULT 'scheduled'
            CHECK (status IN ('scheduled','completed','cancelled')),
          completed_at timestamptz,
          CONSTRAINT handover_record_booking_uq UNIQUE (booking_id)
        """,
        parent=("booking", "booking_id"),
        customer_via="booking_id",
    )


def _file_object_customer_policy() -> None:
    """Customers see `customer_facing` files in their own projects (technical/08 §1).

    `file_object` is created in 0001, before `booking_applicant` exists, so its customer
    policy lands here.
    # ponytail: project-scoped, like every other customer policy in 0002. It does not
    # narrow to the customer's own unit/booking rows within that project; the service
    # layer's visibility check is the second gate. Tighten to per-entity ownership with
    # the customer portal slice (TASKS Vivek 15), which owns what a customer may see.
    """
    sql(
        """
        CREATE POLICY customer_own ON file_object
          USING (
            current_setting('app.realm', true) = 'customer'
            AND visibility = 'customer_facing'
            AND project_id IN (SELECT b.project_id FROM booking b
                               JOIN booking_applicant ba ON ba.booking_id = b.id
                               WHERE ba.customer_id = _hf_customer_id())
          );
        """
    )


def downgrade() -> None:
    sql("DROP POLICY IF EXISTS customer_own ON file_object;")
    sql(
        "ALTER TABLE unit_spec_item DROP CONSTRAINT IF EXISTS fk_unit_spec_item_drawing_revision_id;"
    )
    sql(
        "DROP TABLE IF EXISTS handover_record, home_passport_item, as_built_revision, snag,"
        " qa_evidence, unit_change_gate, unit_progress_state, unit_spec_item,"
        " change_gate_rule, change_category, component_definition CASCADE;"
    )
