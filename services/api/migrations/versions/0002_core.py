"""0002 core — project, hierarchy, unit, customer, booking, applicant, team.

Columns from foundation/data-model.md §2-3; mechanics (standard block, triggers, RLS,
indexes) from technical/02 §2-3, §5. `customer` is deliberately *not* project-partitioned
(the same family may buy in several projects) so it gets its own staff-or-own policy.
"""
from __future__ import annotations

from migrations.rls import partitioned, set_updated_at
from migrations.sql import sql

revision = "0002_core"
down_revision = "0001_kernel"
branch_labels = None
depends_on = None


def upgrade() -> None:
    _project()
    _hierarchy_and_unit()
    _customer()
    _booking()
    _team()
    _customer_policies()
    _deferred_identity_fks()


def _project() -> None:
    sql(
        """
        CREATE TABLE project (
          id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
          code text UNIQUE NOT NULL,
          name text NOT NULL,
          product_type text NOT NULL
            CHECK (product_type IN ('villa','apartment','plotted','office')),
          legal_entity text NOT NULL,
          jurisdiction text NOT NULL,
          journey_template_version_id uuid,
          calendar_id uuid,
          status text NOT NULL DEFAULT 'planning'
            CHECK (status IN ('planning','active','selling','handover','closed')),
          rera_reg_no text,
          statutory_approvals jsonb NOT NULL DEFAULT '[]',
          escrow_assurance_note text,
          config jsonb NOT NULL DEFAULT '{}',
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now());
        """
    )
    set_updated_at("project")
    # `project` is the partition key itself: the staff policy compares its own id.
    sql("ALTER TABLE project ENABLE ROW LEVEL SECURITY;")
    sql("ALTER TABLE project FORCE ROW LEVEL SECURITY;")
    sql(
        """
        CREATE POLICY staff_project ON project
          USING (
            current_setting('app.realm', true) = 'staff'
            AND ( current_setting('app.all_projects', true) = 'true'
                  OR id = ANY (string_to_array(current_setting('app.project_ids', true), ',')::uuid[]) )
          );
        """
    )


def _hierarchy_and_unit() -> None:
    partitioned(
        "project_hierarchy_node",
        """
          parent_id uuid REFERENCES project_hierarchy_node(id) ON DELETE RESTRICT,
          node_type text NOT NULL
            CHECK (node_type IN ('phase','tower','block','cluster','floor','zone')),
          code text NOT NULL,
          name text NOT NULL,
          sort_order int NOT NULL DEFAULT 0,
          CONSTRAINT project_hierarchy_node_code_uq UNIQUE (project_id, code)
        """,
    )
    partitioned(
        "unit",
        """
          hierarchy_node_id uuid NOT NULL REFERENCES project_hierarchy_node(id) ON DELETE RESTRICT,
          unit_number text NOT NULL,
          unit_type text NOT NULL,
          carpet_area numeric(10,2) NOT NULL,
          built_up_area numeric(10,2) NOT NULL,
          saleable_area numeric(10,2) NOT NULL,
          facing text CHECK (facing IN ('N','S','E','W','NE','NW','SE','SW')),
          parking_count int NOT NULL DEFAULT 0,
          uds_land_share numeric(10,4),
          sale_status text NOT NULL DEFAULT 'available'
            CHECK (sale_status IN ('available','held','booked','registered','handed_over')),
          changeability_score numeric(5,2),
          changeability_score_computed_at timestamptz
        """,
        parent=("project_hierarchy_node", "hierarchy_node_id"),
    )
    sql("CREATE UNIQUE INDEX unit_number_uq ON unit (project_id, unit_number);")
    sql("CREATE INDEX unit_sale_status_idx ON unit (project_id, sale_status);")


def _customer() -> None:
    sql(
        """
        CREATE TABLE customer (
          id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
          customer_type text NOT NULL
            CHECK (customer_type IN ('individual','joint','company','huf','nri')),
          display_name text NOT NULL,
          primary_phone text NOT NULL,
          primary_email text NOT NULL,
          preferred_language text,
          preferred_channels jsonb NOT NULL DEFAULT '[]',
          consent jsonb NOT NULL DEFAULT '{}',
          kyc_status text NOT NULL DEFAULT 'pending'
            CHECK (kyc_status IN ('pending','partial','verified','flagged')),
          merged_into_id uuid REFERENCES customer(id) ON DELETE RESTRICT,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now());
        CREATE INDEX customer_name_trgm_idx ON customer USING gin (display_name gin_trgm_ops);
        CREATE INDEX customer_phone_idx ON customer (primary_phone);
        """
    )
    set_updated_at("customer")
    # Not project-partitioned: any staff member, or the customer themselves (technical/02 §3).
    sql("ALTER TABLE customer ENABLE ROW LEVEL SECURITY;")
    sql("ALTER TABLE customer FORCE ROW LEVEL SECURITY;")
    sql(
        """
        CREATE POLICY staff_all ON customer
          USING (current_setting('app.realm', true) = 'staff');
        CREATE POLICY customer_own ON customer
          USING (current_setting('app.realm', true) = 'customer' AND id = _hf_customer_id());
        """
    )


def _booking() -> None:
    partitioned(
        "booking",
        """
          unit_id uuid NOT NULL REFERENCES unit(id) ON DELETE RESTRICT,
          booking_number text NOT NULL,
          status text NOT NULL DEFAULT 'draft'
            CHECK (status IN ('draft','submitted','crm_accepted','active','cancelled','transferred')),
          booking_date date NOT NULL,
          token_amount numeric(14,2),
          total_consideration numeric(14,2) NOT NULL,
          payment_plan_id uuid,
          sales_owner_id uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
          rm_owner_id uuid REFERENCES "user"(id) ON DELETE RESTRICT,
          source_channel text,
          completeness_score numeric(5,2) NOT NULL DEFAULT 0,
          completeness_score_computed_at timestamptz,
          predecessor_booking_id uuid REFERENCES booking(id) ON DELETE RESTRICT,
          version int NOT NULL DEFAULT 1,
          CONSTRAINT booking_number_uq UNIQUE (project_id, booking_number)
        """,
        parent=("unit", "unit_id"),
    )
    sql("CREATE INDEX booking_status_idx ON booking (project_id, status);")
    # One live booking per unit (technical/02 §5).
    sql(
        "CREATE UNIQUE INDEX booking_unit_live_uq ON booking (unit_id)"
        " WHERE status IN ('active','crm_accepted');"
    )
    partitioned(
        "booking_applicant",
        """
          booking_id uuid NOT NULL REFERENCES booking(id) ON DELETE RESTRICT,
          customer_id uuid NOT NULL REFERENCES customer(id) ON DELETE RESTRICT,
          role text NOT NULL
            CHECK (role IN ('primary','co_applicant','co_owner','nominee','guarantor')),
          ownership_pct numeric(5,2),
          pan text,
          kyc_document_ids uuid[] NOT NULL DEFAULT '{}',
          CONSTRAINT booking_applicant_uq UNIQUE (booking_id, customer_id)
        """,
        parent=("booking", "booking_id"),
    )
    # Exactly one primary applicant per booking (data-model §2.6).
    sql(
        "CREATE UNIQUE INDEX booking_applicant_primary_uq ON booking_applicant (booking_id)"
        " WHERE role = 'primary';"
    )
    sql("CREATE INDEX booking_applicant_customer_idx ON booking_applicant (customer_id);")


def _team() -> None:
    sql(
        """
        CREATE TABLE team (
          id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
          code text UNIQUE NOT NULL,
          name text NOT NULL,
          department text NOT NULL CHECK (department IN
            ('sales','crm','accounts','legal','project','qa','post_handover','management')),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now());
        """
    )
    set_updated_at("team")
    sql("ALTER TABLE team ENABLE ROW LEVEL SECURITY;")
    sql("ALTER TABLE team FORCE ROW LEVEL SECURITY;")
    sql("CREATE POLICY staff_all ON team USING (current_setting('app.realm', true) = 'staff');")

    sql("CREATE EXTENSION IF NOT EXISTS btree_gist;")
    partitioned(
        "project_team_assignment",
        """
          team_id uuid NOT NULL REFERENCES team(id) ON DELETE RESTRICT,
          department text NOT NULL CHECK (department IN
            ('sales','crm','accounts','legal','project','qa','post_handover','management')),
          assignment_type text NOT NULL CHECK (assignment_type IN ('dedicated','shared','central')),
          primary_owner_id uuid REFERENCES "user"(id) ON DELETE RESTRICT,
          backup_owner_id uuid REFERENCES "user"(id) ON DELETE RESTRICT,
          escalation_manager_id uuid REFERENCES "user"(id) ON DELETE RESTRICT,
          effective_from date NOT NULL,
          effective_to date,
          capacity_weight numeric(5,2),
          permissions jsonb NOT NULL DEFAULT '{}',
          CONSTRAINT project_team_assignment_no_overlap EXCLUDE USING gist (
            project_id WITH =, team_id WITH =, department WITH =,
            daterange(effective_from, effective_to, '[)') WITH &&
          )
        """,
    )
    sql(
        "CREATE INDEX project_team_assignment_active_idx"
        " ON project_team_assignment (project_id, department, effective_from);"
    )


def _customer_policies() -> None:
    """Every customer policy joins through booking_applicant, so they are created last —
    a policy cannot reference a table that does not exist yet (technical/02 §3)."""
    sql(
        """
        CREATE POLICY customer_own ON project
          USING (
            current_setting('app.realm', true) = 'customer'
            AND id IN (SELECT b.project_id FROM booking b
                       JOIN booking_applicant ba ON ba.booking_id = b.id
                       WHERE ba.customer_id = _hf_customer_id())
          );
        CREATE POLICY customer_own ON unit
          USING (
            current_setting('app.realm', true) = 'customer'
            AND id IN (SELECT b.unit_id FROM booking b
                       JOIN booking_applicant ba ON ba.booking_id = b.id
                       WHERE ba.customer_id = _hf_customer_id())
          );
        CREATE POLICY customer_own ON booking
          USING (
            current_setting('app.realm', true) = 'customer'
            AND id IN (SELECT booking_id FROM booking_applicant
                       WHERE customer_id = _hf_customer_id())
          );
        -- booking_applicant matches on customer_id directly: a policy that joined back to
        -- booking_applicant would recurse into itself, and every other customer policy
        -- reaches the customer's bookings through this one.
        CREATE POLICY customer_own ON booking_applicant
          USING (
            current_setting('app.realm', true) = 'customer'
            AND customer_id = _hf_customer_id()
          );
        """
    )


def _deferred_identity_fks() -> None:
    """0001 created these columns; `customer` only exists now (technical/02 §4.1)."""
    sql(
        "ALTER TABLE session ADD CONSTRAINT fk_session_customer_id"
        " FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE RESTRICT;"
    )
    sql(
        "ALTER TABLE otp_challenge ADD CONSTRAINT fk_otp_challenge_customer_id"
        " FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE RESTRICT;"
    )
    for table in ("event", "job", "file_object"):
        sql(
            f"ALTER TABLE {table} ADD CONSTRAINT fk_{table}_project_id"
            " FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE RESTRICT;"
        )


def downgrade() -> None:
    sql("ALTER TABLE session DROP CONSTRAINT IF EXISTS fk_session_customer_id;")
    sql("ALTER TABLE otp_challenge DROP CONSTRAINT IF EXISTS fk_otp_challenge_customer_id;")
    for table in ("event", "job", "file_object"):
        sql(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS fk_{table}_project_id;")
    sql(
        "DROP TABLE IF EXISTS project_team_assignment, team, booking_applicant, booking,"
        " customer, unit, project_hierarchy_node, project CASCADE;"
    )
