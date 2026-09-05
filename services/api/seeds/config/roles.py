"""`role` and `permission` rows, derived from v1's `rbac_matrix.py` (technical/02 §7).

v1's matrix is the seed, not the runtime: from here on `permission` rows are the matrix
and Policy Studio edits them.
"""
from __future__ import annotations

from typing import Any

from kernel.identity.rbac_matrix import (
    _ALL_MODULES,
    CANONICAL_ROLES,
    CUSTOMER,
    MANAGEMENT,
    SUPER_ADMIN,
    get_permission,
)
from kernel.identity.rbac_redact import (
    _APPLICANT_PII_FIELDS,
    _CUSTOMER_PII_FIELDS,
    _FINANCIAL_AMOUNT_FIELDS,
)

#: technical/02 §4.1 names three staff roles v1 never had; they seed with `none`
#: everywhere and get their rows in Policy Studio as their slices land.
EXTRA_ROLES = ("qa", "design", "procurement")
ROLE_NAMES = {
    "super_admin": "Super Admin", "management": "Management", "sales": "Sales",
    "crm": "CRM / Relationship Manager", "accounts": "Accounts", "banking": "Banking",
    "legal": "Legal", "registration": "Registration", "site_engineer": "Site Engineer",
    "facility": "Facility", "qa": "Quality", "design": "Design", "procurement": "Procurement",
}
ALL_PROJECTS = {SUPER_ADMIN, MANAGEMENT}

#: New-world module -> the v1 modules whose level it inherits (max wins). The kernel
#: surfaces (`actions`, `files`, `events`) are modules too (technical/03 §7).
DERIVED_MODULES: dict[str, tuple[str, ...]] = {
    "project_site": ("unit_readiness",),
    "sales": ("sales_handover",),
    "crm_rm": ("customer_overview", "customer_journey", "customer_tasks"),
    "accounts": ("collections", "loans"),
    "legal": ("legal", "documents", "registrations"),
    "qa": ("snagging", "unit_readiness", "handovers"),
    "post_handover": ("handovers",),
    "customer_portal": ("customer_communications",),
    "management": ("reports", "escalations"),
    "admin": ("administration",),
    "actions": ("customer_tasks", "approvals"),
    "files": ("documents", "customer_documents"),
    "events": ("customer_audit",),
}
# `legal` is the one name in both sets; the derived definition wins, because in the new
# world `modules/legal/` covers v1's legal + documents + registrations surfaces.
MODULES = tuple(dict.fromkeys(tuple(_ALL_MODULES) + tuple(DERIVED_MODULES)))

_ORDER = ["none", "read_status_only", "read_limited", "read", "write", "admin"]
_RANK = {"none": 0, "read_status_only": 1, "read_limited": 1, "read": 1, "write": 2, "admin": 3}

#: Ported from v1's `rbac_redact.py`: the same field sets, now attached to the level that
#: triggered them, as `permission.modifiers` (technical/03 §8).
PII_FIELDS = sorted(_CUSTOMER_PII_FIELDS | _APPLICANT_PII_FIELDS)
MONEY_FIELDS = sorted(_FINANCIAL_AMOUNT_FIELDS)


def roles() -> list[tuple[str, str, bool]]:
    ids = sorted((CANONICAL_ROLES - {CUSTOMER}) | set(EXTRA_ROLES))
    return [(rid, ROLE_NAMES.get(rid, rid.replace("_", " ").title()), rid in ALL_PROJECTS) for rid in ids]


def level_for(role_id: str, module: str) -> str:
    sources = DERIVED_MODULES.get(module)
    if sources is None:
        return get_permission(role_id, module)
    best = "none"
    for src in sources:
        candidate = get_permission(role_id, src)
        if _RANK[candidate] > _RANK[best] or (
            _RANK[candidate] == _RANK[best] and _ORDER.index(candidate) > _ORDER.index(best)
        ):
            best = candidate
    return best


def modifiers_for(level: str) -> dict[str, Any]:
    if level == "read_limited":
        return {"hidden_fields": PII_FIELDS}
    if level == "read_status_only":
        return {"masked_fields": MONEY_FIELDS}
    return {}


def permissions() -> list[tuple[str, str, str, dict[str, Any]]]:
    out: list[tuple[str, str, str, dict[str, Any]]] = []
    for role_id, _, _ in roles():
        for module in MODULES:
            level = level_for(role_id, module)
            out.append((role_id, module, level, modifiers_for(level)))
    return out
