"""Phase A — Single source of truth for role → module permissions.

Roles are stored in the DB with uppercase codes (SUPER_ADMIN, SALES, ...). This
module normalises them into canonical lowercase snake_case keys via
``ROLE_ALIASES``, and then evaluates per-module permissions against
``PERMISSION_MATRIX``.

Actions:
    - none               → denied
    - read               → GET allowed
    - read_status_only   → GET allowed but financial amount fields are redacted
    - read_limited       → GET allowed but PII fields are redacted (Site Engineer)
    - write              → GET + mutations allowed
    - admin              → GET + mutations + destructive/admin ops allowed

`admin` implies `write` implies `read`. `read_status_only` and `read_limited`
count as `read` for the purpose of gating GET endpoints, but consumers must
apply the paired redactor when returning data.
"""
from __future__ import annotations

from typing import Optional

# Canonical role keys (lowercase snake_case)
SUPER_ADMIN = "super_admin"
MANAGEMENT = "management"
SALES = "sales"
CRM = "crm"
ACCOUNTS = "accounts"
BANKING = "banking"
LEGAL = "legal"
REGISTRATION = "registration"
SITE_ENGINEER = "site_engineer"
FACILITY = "facility"
CUSTOMER = "customer"

CANONICAL_ROLES = {
    SUPER_ADMIN, MANAGEMENT, SALES, CRM, ACCOUNTS, BANKING,
    LEGAL, REGISTRATION, SITE_ENGINEER, FACILITY, CUSTOMER,
}

# ---- Alias map: DB / legacy role identifiers → canonical key ----
# Comparison is case-insensitive; both codes (e.g. "SITE") and legacy long
# forms (e.g. "site_projects", "home_loan") are accepted.
ROLE_ALIASES: dict[str, str] = {
    # Current DB codes
    "super_admin": SUPER_ADMIN,
    "management": MANAGEMENT,
    "sales": SALES,
    "crm": CRM,
    "accounts": ACCOUNTS,
    "banking": BANKING,
    "legal": LEGAL,
    "registration": REGISTRATION,
    "site_engineer": SITE_ENGINEER,
    "customer": CUSTOMER,
    # Consolidated into Site Engineer
    "site": SITE_ENGINEER,
    "site_projects": SITE_ENGINEER,
    "quality": SITE_ENGINEER,
    "qa": SITE_ENGINEER,
    "snagging": SITE_ENGINEER,
    "handover": SITE_ENGINEER,
    # Consolidated into Banking (Loan Team)
    "banking_loan": BANKING,
    "home_loan": BANKING,
    # Facility team — canonical role with its own matrix row (mirrors Site
    # Engineer operational scope: PII-limited, snagging/readiness/handover write).
    "facility": FACILITY,
}


def canonical_role(raw: Optional[str]) -> str:
    """Return the canonical lowercase role key for any role string / code / name."""
    if not raw:
        return "unknown"
    key = str(raw).strip().lower().replace(" ", "_")
    return ROLE_ALIASES.get(key, key)


# ---- Permission matrix ----
# Rows = roles, columns = modules; value = permission level.
# Modules not listed for a role default to "none".
NONE = "none"
READ = "read"
READ_STATUS_ONLY = "read_status_only"
READ_LIMITED = "read_limited"
WRITE = "write"
ADMIN = "admin"

_ALL_MODULES = [
    "dashboard",
    "customer_overview",
    "customer_journey",
    "customer_tasks",
    "customer_documents",
    "customer_financials",
    "customer_loan",
    "customer_legal",
    "customer_registration",
    "customer_unit_readiness",
    "customer_snags",
    "customer_commitments",
    "customer_communications",
    "customer_handover",
    "customer_activity",
    "customer_audit",
    "sales_handover",
    "documents",
    "collections",
    "loans",
    "legal",
    "registrations",
    "unit_readiness",
    "snagging",
    "handovers",
    "commitments",
    "communications",
    "escalations",
    "approvals",
    "notifications",
    "comments",
    "reports",
    "administration",
]

PERMISSION_MATRIX: dict[str, dict[str, str]] = {
    SUPER_ADMIN: {m: ADMIN for m in _ALL_MODULES},

    MANAGEMENT: {
        "dashboard": READ,
        "customer_overview": READ,
        "customer_journey": READ,
        "customer_tasks": READ,
        "customer_documents": READ,
        "customer_financials": READ,
        "customer_loan": READ,
        "customer_legal": READ,
        "customer_registration": READ,
        "customer_unit_readiness": READ,
        "customer_snags": READ,
        "customer_commitments": READ,
        "customer_communications": READ,
        "customer_handover": READ,
        "customer_activity": READ,
        "customer_audit": READ,
        "sales_handover": READ,
        "documents": READ,
        "collections": READ,
        "loans": READ,
        "legal": READ,
        "registrations": READ,
        "unit_readiness": READ,
        "snagging": READ,
        "handovers": READ,
        "commitments": READ,
        "communications": READ,
        "escalations": READ,
        "approvals": WRITE,        # bumped: management signs off cross-department approvals
        "notifications": READ,
        "comments": WRITE,         # management comments across every entity
        "reports": READ,
        "administration": NONE,
    },

    SALES: {
        "dashboard": READ,
        "customer_overview": READ,
        "customer_journey": READ,
        "customer_tasks": NONE,
        "customer_documents": NONE,
        "customer_financials": NONE,
        "customer_loan": NONE,
        "customer_legal": NONE,
        "customer_registration": NONE,
        "customer_unit_readiness": NONE,
        "customer_snags": NONE,
        "customer_commitments": READ,
        "customer_communications": WRITE,
        "customer_handover": NONE,
        "customer_activity": READ,
        "customer_audit": NONE,
        "sales_handover": WRITE,
        "documents": NONE,
        "collections": NONE,
        "loans": NONE,
        "legal": NONE,
        "registrations": NONE,
        "unit_readiness": NONE,
        "snagging": NONE,
        "handovers": NONE,
        "commitments": READ,
        "communications": WRITE,
        "escalations": READ,
        "approvals": READ,
        "notifications": READ,
        "comments": WRITE,
        "reports": NONE,
        "administration": NONE,
    },

    CRM: {
        "dashboard": READ,
        "customer_overview": WRITE,
        "customer_journey": WRITE,
        "customer_tasks": WRITE,
        "customer_documents": READ,
        "customer_financials": READ,        # bumped from read_status_only: CRM sees actual amounts on Customer 360 financials tab
        "customer_loan": READ,
        "customer_legal": READ,
        "customer_registration": READ,
        "customer_unit_readiness": READ,
        "customer_snags": READ,
        "customer_commitments": WRITE,
        "customer_communications": WRITE,
        "customer_handover": READ,
        "customer_activity": READ,
        "customer_audit": READ,
        "sales_handover": WRITE,
        "documents": READ,
        "collections": READ_STATUS_ONLY,
        "loans": READ,
        "legal": READ,
        "registrations": READ,
        "unit_readiness": READ,
        "snagging": READ,
        "handovers": READ,
        "commitments": WRITE,
        "communications": WRITE,
        "escalations": WRITE,
        "approvals": WRITE,
        "notifications": READ,
        "comments": WRITE,
        "reports": READ,
        "administration": NONE,
    },

    ACCOUNTS: {
        "dashboard": READ,
        "customer_overview": READ,
        "customer_journey": READ,
        "customer_tasks": READ,
        "customer_documents": READ,
        "customer_financials": WRITE,
        "customer_loan": READ,
        "customer_legal": NONE,
        "customer_registration": NONE,
        "customer_unit_readiness": NONE,
        "customer_snags": NONE,
        "customer_commitments": READ,
        "customer_communications": NONE,
        "customer_handover": NONE,
        "customer_activity": READ,
        "customer_audit": READ,
        "sales_handover": NONE,
        "documents": READ,
        "collections": WRITE,
        "loans": READ,
        "legal": NONE,
        "registrations": NONE,
        "unit_readiness": NONE,
        "snagging": NONE,
        "handovers": NONE,
        "commitments": READ,
        "communications": NONE,
        "escalations": READ,
        "approvals": WRITE,
        "notifications": READ,
        "comments": WRITE,
        "reports": READ,
        "administration": NONE,
    },

    BANKING: {
        "dashboard": READ,
        "customer_overview": READ,
        "customer_journey": READ,
        "customer_tasks": READ,
        "customer_documents": READ,
        "customer_financials": READ,
        "customer_loan": WRITE,
        "customer_legal": NONE,
        "customer_registration": NONE,
        "customer_unit_readiness": NONE,
        "customer_snags": NONE,
        "customer_commitments": NONE,
        "customer_communications": NONE,
        "customer_handover": NONE,
        "customer_activity": READ,
        "customer_audit": NONE,
        "sales_handover": NONE,
        "documents": READ,
        "collections": READ,
        "loans": WRITE,
        "legal": NONE,
        "registrations": NONE,
        "unit_readiness": NONE,
        "snagging": NONE,
        "handovers": NONE,
        "commitments": NONE,
        "communications": NONE,
        "escalations": READ,
        "approvals": READ,
        "notifications": READ,
        "comments": WRITE,
        "reports": NONE,
        "administration": NONE,
    },

    LEGAL: {
        "dashboard": READ,
        "customer_overview": READ,
        "customer_journey": READ,
        "customer_tasks": READ,
        "customer_documents": WRITE,
        "customer_financials": READ_STATUS_ONLY,
        "customer_loan": READ,
        "customer_legal": WRITE,
        "customer_registration": WRITE,
        "customer_unit_readiness": NONE,
        "customer_snags": NONE,
        "customer_commitments": READ,
        "customer_communications": NONE,
        "customer_handover": NONE,
        "customer_activity": READ,
        "customer_audit": READ,
        "sales_handover": NONE,
        "documents": WRITE,
        "collections": READ_STATUS_ONLY,
        "loans": READ,
        "legal": WRITE,
        "registrations": WRITE,
        "unit_readiness": NONE,
        "snagging": NONE,
        "handovers": NONE,
        "commitments": READ,
        "communications": NONE,
        "escalations": READ,
        "approvals": WRITE,
        "notifications": READ,
        "comments": WRITE,
        "reports": READ,
        "administration": NONE,
    },

    REGISTRATION: {
        "dashboard": READ,
        "customer_overview": READ,
        "customer_journey": READ,
        "customer_tasks": READ,
        "customer_documents": READ,
        "customer_financials": READ_STATUS_ONLY,
        "customer_loan": READ,
        "customer_legal": READ,
        "customer_registration": WRITE,
        "customer_unit_readiness": NONE,
        "customer_snags": NONE,
        "customer_commitments": READ,
        "customer_communications": NONE,
        "customer_handover": NONE,
        "customer_activity": READ,
        "customer_audit": READ,
        "sales_handover": NONE,
        "documents": READ,
        "collections": NONE,
        "loans": READ,
        "legal": READ,
        "registrations": WRITE,
        "unit_readiness": NONE,
        "snagging": NONE,
        "handovers": NONE,
        "commitments": READ,
        "communications": NONE,
        "escalations": READ,
        "approvals": WRITE,
        "notifications": READ,
        "comments": WRITE,
        "reports": READ,
        "administration": NONE,
    },

    SITE_ENGINEER: {
        "dashboard": READ,
        "customer_overview": READ_LIMITED,
        "customer_journey": NONE,
        "customer_tasks": WRITE,  # constrained to site/QA/handover subprocess tasks (checked in-router)
        "customer_documents": NONE,
        "customer_financials": NONE,
        "customer_loan": NONE,
        "customer_legal": NONE,
        "customer_registration": NONE,
        "customer_unit_readiness": WRITE,
        "customer_snags": WRITE,
        "customer_commitments": NONE,
        "customer_communications": NONE,
        "customer_handover": WRITE,
        "customer_activity": READ,
        "customer_audit": NONE,
        "sales_handover": NONE,
        "documents": NONE,
        "collections": NONE,
        "loans": NONE,
        "legal": NONE,
        "registrations": NONE,
        "unit_readiness": WRITE,
        "snagging": WRITE,
        "handovers": WRITE,
        "commitments": NONE,
        "communications": NONE,
        "escalations": NONE,
        "approvals": WRITE,
        "notifications": READ,
        "comments": WRITE,
        "reports": NONE,
        "administration": NONE,
    },

    FACILITY: {
        "dashboard": READ,
        "customer_overview": READ_LIMITED,
        "customer_journey": NONE,
        "customer_tasks": NONE,
        "customer_documents": NONE,
        "customer_financials": NONE,
        "customer_loan": NONE,
        "customer_legal": NONE,
        "customer_registration": NONE,
        "customer_unit_readiness": WRITE,
        "customer_snags": WRITE,
        "customer_commitments": NONE,
        "customer_communications": NONE,
        "customer_handover": WRITE,
        "customer_activity": READ,
        "customer_audit": NONE,
        "sales_handover": NONE,
        "documents": NONE,
        "collections": NONE,
        "loans": NONE,
        "legal": NONE,
        "registrations": NONE,
        "unit_readiness": WRITE,
        "snagging": WRITE,
        "handovers": WRITE,
        "commitments": NONE,
        "communications": NONE,
        "escalations": NONE,
        "approvals": NONE,
        "notifications": READ,
        "comments": WRITE,
        "reports": NONE,
        "administration": NONE,
    },

    # Customer role is disabled; no module access
    CUSTOMER: {},
}


# ---- Action hierarchy ----
_LEVEL_ORDER = {
    NONE: 0,
    READ_STATUS_ONLY: 1,
    READ_LIMITED: 1,
    READ: 1,
    WRITE: 2,
    ADMIN: 3,
}


def get_permission(role: str, module: str) -> str:
    """Return the raw permission level (with modifiers preserved) for role + module."""
    canon = canonical_role(role)
    row = PERMISSION_MATRIX.get(canon, {})
    return row.get(module, NONE)


def can(role: str, module: str, action: str) -> bool:
    """Coarse allow check. `action` ∈ {read, write, admin}. Modifiers count as read."""
    perm = get_permission(role, module)
    want = _LEVEL_ORDER.get(action, -1)
    have = _LEVEL_ORDER.get(perm, 0)
    return have >= want and want >= 0


def modifiers_for(role: str, module: str) -> dict:
    """Return which redactors apply for role+module (read_status_only → hide amounts,
    read_limited → hide PII)."""
    perm = get_permission(role, module)
    return {
        "read_status_only": perm == READ_STATUS_ONLY,
        "read_limited": perm == READ_LIMITED,
    }


def matrix_for_role(role: str) -> dict[str, str]:
    """Full per-module map for the frontend `/me/permissions` endpoint."""
    canon = canonical_role(role)
    if canon in PERMISSION_MATRIX:
        return {m: PERMISSION_MATRIX[canon].get(m, NONE) for m in _ALL_MODULES}
    return {m: NONE for m in _ALL_MODULES}


# ---------------------------------------------------------------------------
# Journey stage visibility
# ---------------------------------------------------------------------------
# Which stage identifiers (code OR name — case-insensitive substring match on
# the frontend) each role is allowed to see in the Customer Journey rail.
# Missing key means "show all stages" (default).
#
# NOTE on seeded workflow templates: today's Villa/Apartment templates do NOT
# have a dedicated "Home Loan" stage. Home-loan-related activity lives inside
# the "Payments" stage. The Banking-visible set therefore includes both the
# generic aliases (in case a future workflow template ships a proper Home Loan
# stage) AND "Payments" as the operational match against current data.
JOURNEY_STAGE_VISIBILITY = {
    "banking": ["Home Loan", "HomeLoan", "HOME_LOAN", "Loan", "LOAN", "Payments"],
}


def visible_journey_stages(role: str):
    """Return a list of stage identifiers this role may see, or None to mean
    "show every stage" (the default). Frontend does a case-insensitive
    substring match against stage.code and stage.name."""
    canon = canonical_role(role)
    return JOURNEY_STAGE_VISIBILITY.get(canon)
