"""`/auth/*` and `/me/session` (technical/03 §1-§3). The only routes with no `require()`."""
from __future__ import annotations

import logging
import secrets
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from starlette.responses import JSONResponse, RedirectResponse, Response

from kernel.db import tx
from kernel.errors import AppError, ok
from kernel.events.append import append
from kernel.identity import google, oauth_state, otp
from kernel.identity import session as session_mod
from kernel.identity.principal import SYSTEM, Principal
from kernel.identity.rbac import principal_of
from kernel.notifications.port import OutboundMessage, notifier
from settings import settings

log = logging.getLogger("homeflow.identity")
router = APIRouter(tags=["auth"])

#: Dev-only mirror of the codes handed out; the database only ever holds the hash.
_DEV_CODES: dict[str, str] = {}

_oidc: google.GoogleOidc | None = None


def oidc() -> google.GoogleOidc:
    """One lazily built client; tests replace it with `set_oidc()`."""
    global _oidc
    if _oidc is None:
        _oidc = google.build()
    return _oidc


def set_oidc(client: google.GoogleOidc) -> None:
    global _oidc
    _oidc = client


def _dev_only() -> None:
    if settings.ENV != "local" or not settings.HOMEFLOW_DEV_LOGIN:
        raise AppError("NOT_FOUND", "Not Found")


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


# --- staff: Google OIDC -------------------------------------------------------------


@router.get("/auth/google/start")
async def google_start(request: Request, next: str = "/") -> Response:
    state = secrets.token_urlsafe(32)
    verifier, challenge = google.pkce_pair()
    response = RedirectResponse(oidc().authorization_url(state=state, challenge=challenge), 302)
    response.set_cookie(
        session_mod.OAUTH_COOKIE,
        oauth_state.dump({"state": state, "verifier": verifier, "next": oauth_state.safe_next(next)}),
        max_age=oauth_state.TTL_SECONDS,
        httponly=True,
        secure=settings.ENV != "local",
        samesite="lax",
        path="/",
    )
    return response


@router.get("/auth/google/callback")
async def google_callback(request: Request, code: str = "", state: str = "") -> Response:
    stored = oauth_state.load(request.cookies.get(session_mod.OAUTH_COOKIE))
    if stored is None or not secrets.compare_digest(str(stored.get("state", "")), state):
        raise AppError("UNAUTHENTICATED", "Sign-in expired. Try again.")
    claims = await oidc().exchange(code, str(stored["verifier"]))
    email = str(claims.get("email", "")).lower()
    async with tx(SYSTEM) as t:
        user = (
            await t.conn.execute(
                text('SELECT id, full_name FROM "user" WHERE email = :e AND is_active'),
                {"e": email},
            )
        ).mappings().first()
        if user is None:
            raise AppError("NOT_PROVISIONED", "No HomeFlow account for that address — ask your admin.")
        await t.conn.execute(
            text(
                'UPDATE "user" SET google_sub = coalesce(google_sub, :sub), last_login_at = now()'
                " WHERE id = :id"
            ),
            {"sub": claims.get("sub"), "id": user["id"]},
        )
        session_id, token = await session_mod.create(
            t, "staff", user_id=user["id"],
            ip=_client_ip(request), user_agent=request.headers.get("user-agent"),
        )
        await append(t, "user.signed_in", subject={"user_id": str(user["id"])},
                     payload={"method": "google", "session_id": str(session_id)},
                     actor={"type": "user", "id": str(user["id"]), "name": user["full_name"]})
    response = RedirectResponse(oauth_state.safe_next(str(stored.get("next"))), 302)
    response.delete_cookie(session_mod.OAUTH_COOKIE, path="/")
    session_mod.set_cookie(response, token, "staff")
    return response


@router.get("/auth/dev-login")
async def dev_login(request: Request, user: str, next: str = "/") -> Response:
    """Local only (technical/03 §1): a session for a seeded user, no Google round trip."""
    _dev_only()
    async with tx(SYSTEM) as t:
        row = (
            await t.conn.execute(
                text('SELECT id FROM "user" WHERE email = :e AND is_active'), {"e": user.lower()}
            )
        ).mappings().first()
        if row is None:
            raise AppError("NOT_PROVISIONED", f"No active user {user}.")
        session_id, token = await session_mod.create(
            t, "staff", user_id=row["id"], ip=_client_ip(request)
        )
        await append(t, "user.signed_in", subject={"user_id": str(row["id"])},
                     payload={"method": "dev_login", "session_id": str(session_id)},
                     actor={"type": "user", "id": str(row["id"]), "name": user})
    response = RedirectResponse(oauth_state.safe_next(next), 302)
    session_mod.set_cookie(response, token, "staff")
    return response


# --- customer: OTP ------------------------------------------------------------------


class OtpRequest(BaseModel):
    phone: str = Field(min_length=6, max_length=20)


class OtpVerify(OtpRequest):
    code: str = Field(min_length=4, max_length=8)


@router.post("/auth/otp/request")
async def otp_request(request: Request, body: OtpRequest) -> dict[str, Any]:
    phone = otp.normalise_phone(body.phone)
    otp.check_ip_rate(_client_ip(request))
    async with tx(SYSTEM) as t:
        await otp.check_phone_rate(t, phone)
        customer_id = await otp.customer_for_phone(t, phone)
        if customer_id is None:
            return ok({"sent": True}, request)  # no enumeration
        code = await otp.issue(t, phone, customer_id)
        if settings.ENV == "local" and settings.HOMEFLOW_DEV_LOGIN:
            _DEV_CODES[phone] = code
    await notifier.send(
        OutboundMessage(channel="whatsapp", to_address=phone, template_code="otp_login",
                        vars={"code": code})
    )
    return ok({"sent": True}, request)


@router.post("/auth/otp/verify")
async def otp_verify(request: Request, body: OtpVerify) -> Response:
    phone = otp.normalise_phone(body.phone)
    async with tx(SYSTEM) as t:
        customer_id, failure = await otp.consume(t, phone, body.code)
        if customer_id is not None:
            session_id, token = await session_mod.create(
                t, "customer", customer_id=customer_id,
                ip=_client_ip(request), user_agent=request.headers.get("user-agent"),
            )
            await append(t, "customer.signed_in", subject={"customer_id": str(customer_id)},
                         payload={"method": "otp", "session_id": str(session_id)},
                         actor={"type": "customer", "id": str(customer_id), "name": ""})
    if failure is not None:  # raised after commit so the attempt counter survives
        raise AppError(failure, otp.FAILURE_MESSAGE[failure])
    response = JSONResponse(ok({"signed_in": True}, request))
    session_mod.set_cookie(response, token, "customer")
    return response


@router.get("/auth/dev-otp")
async def dev_otp(request: Request, phone: str) -> dict[str, Any]:
    """Local only: the last unconsumed code, so the OTP flow is testable end to end."""
    _dev_only()
    async with tx(SYSTEM) as t:
        row = (
            await t.conn.execute(
                text(
                    "SELECT id FROM otp_challenge WHERE phone = :p AND consumed_at IS NULL"
                    "   AND expires_at > now() ORDER BY created_at DESC LIMIT 1"
                ),
                {"p": otp.normalise_phone(phone)},
            )
        ).mappings().first()
    if row is None:
        raise AppError("NOT_FOUND", "No live code for that number.")
    return ok({"code": _DEV_CODES.get(otp.normalise_phone(phone))}, request)


# --- session ------------------------------------------------------------------------


@router.post("/auth/logout")
async def logout(request: Request) -> Response:
    p: Principal = request.state.principal
    response = Response(status_code=204)
    if p.session_id is not None:
        async with tx(SYSTEM) as t:
            await session_mod.revoke(t, p.session_id)
            await append(
                t,
                "user.signed_out" if p.realm == "staff" else "session.revoked",
                subject={"user_id": str(p.user_id), "customer_id": str(p.customer_id)},
                payload={"session_id": str(p.session_id)},
                actor=p.as_actor(),
            )
    session_mod.clear_cookie(response)
    return response


@router.get("/me/session")
async def me_session(request: Request) -> dict[str, Any]:
    p = principal_of(request)
    return ok(
        {
            "realm": p.realm,
            "display_name": p.display_name,
            "role_ids": sorted(p.role_ids),
            "project_ids": sorted(str(i) for i in p.project_ids),
            "all_projects": p.all_projects,
        },
        request,
    )
