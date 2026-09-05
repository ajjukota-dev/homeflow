"""Phase A — Field-level redaction, matrix-driven (Option B, revised).

Both redactors now consult ``rbac_matrix.get_permission(role, module)`` instead
of a hardcoded role set. Callers pass the ``module`` name that governs the
endpoint's data, and the redactor decides based on the current user's matrix
permission on that module:

- ``redact_financial_amounts(payload, user, module)`` → nulls monetary fields
  when ``get_permission(role, module) == READ_STATUS_ONLY``. Otherwise
  passthrough.
- ``redact_customer_pii(payload, user, module)`` → nulls PII fields when
  ``get_permission(role, module) == READ_LIMITED``. Otherwise passthrough.

Public aliases ``apply_financial_redactions`` / ``apply_customer_pii_redactions``
keep the same signatures for callers that prefer the "apply_*" naming.

Both accept a single dict or a list of dicts and return the same shape.
Fields are replaced with ``None`` (never omitted) so the frontend can render
"restricted" placeholders without React `undefined` prop warnings.
"""
from __future__ import annotations

from typing import Any

from kernel.identity.rbac_matrix import (
    canonical_role, get_permission, NONE, READ_LIMITED, READ_STATUS_ONLY,
)

# ---------------- Role extraction helper ----------------

def _extract_role(user_or_role: Any) -> str:
    """Accept either a user dict (with ``role.code`` or ``_role_code`` stamped)
    or a raw role string / code. Returns the raw code — ``canonical_role``
    normalisation is applied inside ``get_permission``."""
    if user_or_role is None:
        return ""
    if isinstance(user_or_role, str):
        return user_or_role
    if isinstance(user_or_role, dict):
        # Prefer the stamped-by-require_module value if present
        stamped = user_or_role.get("_role_code")
        if stamped:
            return stamped
        role = user_or_role.get("role") or {}
        if isinstance(role, dict):
            return role.get("code") or ""
        if isinstance(role, str):
            return role
    return ""


# ---------------- PII redaction ----------------

_CUSTOMER_PII_FIELDS = {
    "phone", "alt_phone", "email", "pan", "aadhaar", "passport",
    "oci", "oci_number", "address", "address_line", "city", "state", "pincode",
    "co_applicants", "nri_status", "communication_preference",
    "communication_pref",
}

# Applicant sub-doc PII
_APPLICANT_PII_FIELDS = {
    "email", "phone", "pan", "aadhaar", "passport", "oci", "oci_number",
    "kyc_documents",
}


def _redact_one_customer(doc: dict) -> dict:
    if not isinstance(doc, dict):
        return doc
    out = dict(doc)
    for f in _CUSTOMER_PII_FIELDS:
        if f in out:
            out[f] = None
    # applicants list
    if isinstance(out.get("applicants"), list):
        out["applicants"] = [
            {k: (None if k in _APPLICANT_PII_FIELDS else v) for k, v in a.items()}
            if isinstance(a, dict) else a
            for a in out["applicants"]
        ]
    return out


def redact_customer_pii(payload: Any, user: Any, module: str = "customer_overview") -> Any:
    """Matrix-driven: redact customer PII when the caller's permission on
    ``module`` is either ``read_limited`` (they can see the record but not PII)
    OR ``none`` (they reached this response via a sibling endpoint that has
    looser gate, so PII must still be scrubbed).

    ``user`` may be a user dict (preferred) or a raw role string / code.
    """
    role = _extract_role(user)
    perm = get_permission(role, module)
    if perm not in (READ_LIMITED, NONE):
        return payload
    if isinstance(payload, list):
        return [_redact_one_customer(x) if isinstance(x, dict) else x for x in payload]
    if isinstance(payload, dict):
        return _redact_one_customer(payload)
    return payload


# ---------------- Financial amount redaction ----------------

# Every field name across payments / bookings / loans / TDS / financial clearances
# that carries a monetary value.
_FINANCIAL_AMOUNT_FIELDS = {
    # booking / commercial
    "agreement_value_inr", "agreement_value", "booking_amount_inr", "booking_amount",
    "base_price_inr", "base_price", "discount", "discount_amount",
    "brokerage", "brokerage_amount",
    # milestones / payments / receipts
    "demand_amount", "demand_amount_inr",
    "amount", "amount_received", "amount_inr", "amount_received_inr",
    "outstanding", "outstanding_inr", "balance_inr", "balance",
    "overdue_inr", "overdue",
    "tax", "tax_amount", "tax_inr", "taxes", "gst", "gst_amount",
    "planned_amount_inr", "planned_amount",
    "total_due_inr", "total_due",
    "total_received_inr", "total_outstanding_inr", "total_overdue_inr",
    "outstanding_including_pending_inr", "future_receivable_inr",
    "received_verified_inr", "received_pending_inr",
    "total_agreement_value_inr", "total_tax_inr",
    # loans
    "sanctioned_amount", "sanctioned_amount_inr", "requested_amount",
    "requested_amount_inr", "own_contribution", "own_contribution_inr",
    "disbursement_amount", "disbursement_amount_inr", "disbursed_amount_inr",
    # TDS
    "tds_amount", "tds_amount_inr", "gross_amount_inr", "gross_amount",
}


def _redact_one_financial(doc: dict) -> dict:
    if not isinstance(doc, dict):
        return doc
    out = dict(doc)
    for f in _FINANCIAL_AMOUNT_FIELDS:
        if f in out:
            out[f] = None
    return out


def redact_financial_amounts(payload: Any, user: Any, module: str = "customer_financials") -> Any:
    """Matrix-driven: null monetary fields when the caller's permission on
    ``module`` is either ``read_status_only`` (see status but not amounts) OR
    ``none`` (they reached the response through a related route with looser
    gate — amounts must still be scrubbed).

    Recurses one level into common nested collections (``milestones``,
    ``payments``, ``events``, ``schedule.milestones``) since those are what
    routers return.
    """
    role = _extract_role(user)
    perm = get_permission(role, module)
    if perm not in (READ_STATUS_ONLY, NONE):
        return payload

    def walk(o: Any) -> Any:
        if isinstance(o, list):
            return [walk(x) for x in o]
        if isinstance(o, dict):
            red = _redact_one_financial(o)
            for k, v in list(red.items()):
                if isinstance(v, (list, dict)):
                    red[k] = walk(v)
            return red
        return o

    return walk(payload)


# ---------------- Convenience aliases (public API) ----------------

# Kept for router callers that prefer the "apply_*" naming; identical behaviour.
apply_customer_pii_redactions = redact_customer_pii
apply_financial_redactions = redact_financial_amounts
