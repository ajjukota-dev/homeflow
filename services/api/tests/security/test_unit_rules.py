"""The parts of technical/03 §10 that need no database: redirect, hd, matrix, redaction."""
from __future__ import annotations

from uuid import uuid4

import pytest

from kernel.errors import AppError
from kernel.identity import oauth_state, otp
from kernel.identity.google import GoogleOidc
from kernel.identity.principal import ANONYMOUS, Principal
from kernel.identity.rbac import allows, load_from, require_role_in
from kernel.identity.redact import mask, redact

CRM = Principal(realm="staff", user_id=uuid4(), role_ids=frozenset({"crm"}), display_name="Sneha Reddy")
CUSTOMER = Principal(realm="customer", customer_id=uuid4(), display_name="Kavya Menon")


# --- open redirect (03 §10) ---------------------------------------------------------


@pytest.mark.parametrize(
    "value",
    ["//evil.example.com", "https://evil.example.com", "http://evil", "evil", "", None,
     "/\\evil.example.com", "\\/evil"],
)
def test_next_only_accepts_a_same_origin_relative_path(value: str | None) -> None:
    assert oauth_state.safe_next(value) == "/"


def test_next_keeps_a_real_relative_path() -> None:
    assert oauth_state.safe_next("/units/123?tab=progress") == "/units/123?tab=progress"


def test_oauth_cookie_rejects_a_tampered_signature() -> None:
    cookie = oauth_state.dump({"state": "s", "verifier": "v", "next": "/"})
    body, _, sig = cookie.partition(".")
    assert oauth_state.load(cookie) is not None
    assert oauth_state.load(f"{body}x.{sig}") is None
    assert oauth_state.load(f"{body}.{sig[:-1]}a") is None


# --- Google claims (03 §1 step 3) ---------------------------------------------------


def _oidc() -> GoogleOidc:
    return GoogleOidc(
        client_id="cid", client_secret="secret",
        redirect_uri="http://localhost:8001/auth/google/callback",
        allowed_hd=frozenset({"pranava.in"}),
    )


BASE_CLAIMS = {
    "iss": "https://accounts.google.com", "aud": "cid", "sub": "1234",
    "email": "sneha.reddy@pranava.in", "email_verified": True, "hd": "pranava.in",
}


def test_valid_workspace_claims_pass() -> None:
    assert _oidc().check_claims(dict(BASE_CLAIMS))["email"] == "sneha.reddy@pranava.in"


@pytest.mark.parametrize(
    "override",
    [{"hd": "gmail.com"}, {"hd": None}, {"email_verified": False}, {"email_verified": "true"}],
)
def test_unverified_or_foreign_domain_is_refused(override: dict) -> None:
    with pytest.raises(AppError) as exc:
        _oidc().check_claims({**BASE_CLAIMS, **override})
    assert exc.value.code == "NOT_PROVISIONED"


@pytest.mark.parametrize("override", [{"aud": "someone-else"}, {"iss": "https://evil.example"}])
def test_wrong_audience_or_issuer_is_refused(override: dict) -> None:
    with pytest.raises(AppError) as exc:
        _oidc().check_claims({**BASE_CLAIMS, **override})
    assert exc.value.code == "UNAUTHENTICATED"


# --- phone normalisation (03 §2) ----------------------------------------------------


@pytest.mark.parametrize(
    "raw", ["98765 43210", "+91 98765 43210", "09876543210", "919876543210", "+919876543210"]
)
def test_phone_normalises_to_e164(raw: str) -> None:
    assert otp.normalise_phone(raw) == "+919876543210"


@pytest.mark.parametrize("raw", ["", "abc", "12345", "9876543210987654321"])
def test_unusable_phone_is_a_validation_error(raw: str) -> None:
    with pytest.raises(AppError) as exc:
        otp.normalise_phone(raw)
    assert exc.value.code == "VALIDATION"


def test_otp_code_is_six_digits_and_hashed_with_the_session_secret() -> None:
    code = otp.new_code()
    assert len(code) == 6 and code.isdigit()
    assert otp.code_hash(code) == otp.code_hash(code)
    assert otp.code_hash(code) != otp.code_hash("000000") or code == "000000"
    assert code.encode() not in otp.code_hash(code)


# --- RBAC matrix (03 §7) ------------------------------------------------------------


@pytest.fixture(autouse=True)
def matrix() -> None:
    load_from(
        {
            "crm": {"crm_rm": "write", "accounts": "read_status_only", "customer_portal": "read"},
            "sales": {"sales": "write", "project_site": "none"},
            "super_admin": {"crm_rm": "admin", "project_site": "admin"},
        },
        {"crm": {"accounts": {"masked_fields": ["amount"], "hidden_fields": ["internal_notes"]}}},
    )


def test_matrix_levels_gate_read_and_write() -> None:
    assert allows(CRM, "crm_rm", "read") and allows(CRM, "crm_rm", "write")
    assert not allows(CRM, "crm_rm", "admin")
    assert allows(CRM, "accounts", "read") and not allows(CRM, "accounts", "write")
    assert not allows(CRM, "project_site", "read")


def test_customer_realm_reaches_only_the_portal() -> None:
    assert allows(CUSTOMER, "customer_portal", "read")
    for module in ("crm_rm", "accounts", "project_site", "management", "admin"):
        assert not allows(CUSTOMER, module, "read")


def test_anonymous_is_allowed_nothing() -> None:
    assert not allows(ANONYMOUS, "customer_portal", "read")
    assert not allows(ANONYMOUS, "crm_rm", "read")


async def test_require_role_in_is_a_fence_beyond_the_matrix() -> None:
    class _Req:
        state = type("S", (), {"principal": CRM})()

    dep = require_role_in({"site_engineer", "design"})
    with pytest.raises(AppError) as exc:
        await dep(_Req())  # type: ignore[arg-type]
    assert exc.value.code == "WRITE_FENCE"


# --- redaction (03 §8) --------------------------------------------------------------


def test_masked_fields_keep_only_the_last_four_characters() -> None:
    assert mask("ABCDE1234F") == "XXXXXX234F"
    assert mask(None) is None
    assert mask("12") == "XX"


def test_redaction_hides_and_masks_per_the_modifiers() -> None:
    row = {"amount": "1250000.00", "internal_notes": "chased twice", "milestone": "Plinth"}
    out = redact(row, CRM, "accounts")
    assert "internal_notes" not in out
    assert out["milestone"] == "Plinth"
    assert out["amount"].endswith("0.00") and out["amount"].startswith("X")


def test_a_module_without_modifiers_is_untouched() -> None:
    row = {"amount": "1250000.00", "internal_notes": "chased twice"}
    assert redact(row, CRM, "crm_rm") == row
