"""Customer OTP sign-in (technical/03 §2).

No enumeration: an unknown phone gets the same `{sent: true}` and nothing is sent.
The code is never stored — only `sha256(code || SESSION_SECRET)`.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import time
from dataclasses import dataclass
from datetime import timedelta
from typing import NoReturn, cast
from uuid import UUID

from sqlalchemy import text

from kernel.db import Tx
from kernel.errors import AppError
from settings import settings

CODE_DIGITS = 6
TTL = timedelta(minutes=5)
MAX_ATTEMPTS = 5
PER_PHONE = (3, timedelta(minutes=10))
PER_IP = (20, timedelta(hours=1))
DEFAULT_CC = "+91"

#: The booking states that entitle a customer to sign in. technical/03 §2 also lists
#: `registered` and `handed_over`; the `booking.status` CHECK (technical/02, migration
#: 0002) has no such values yet, so the live set is the two that exist.
ACTIVE_BOOKING_STATUS = ("active", "crm_accepted")

_NON_DIGITS = re.compile(r"[^\d+]")


def normalise_phone(raw: str) -> str:
    """E.164, defaulting to +91 (technical/03 §2)."""
    cleaned = _NON_DIGITS.sub("", (raw or "").strip())
    if cleaned.startswith("+"):
        digits = cleaned[1:]
        if digits.isdigit() and 8 <= len(digits) <= 15:
            return "+" + digits
        _reject()
    cleaned = cleaned.removeprefix("00").removeprefix("0")
    if not cleaned.isdigit():
        _reject()
    if len(cleaned) == 12 and cleaned.startswith("91"):
        return "+" + cleaned
    if len(cleaned) == 10:
        return DEFAULT_CC + cleaned
    _reject()


def _reject() -> NoReturn:
    raise AppError("VALIDATION", "That does not look like a mobile number.", field="phone")


def code_hash(code: str) -> bytes:
    return hashlib.sha256((code + settings.SESSION_SECRET).encode()).digest()


def new_code() -> str:
    return f"{secrets.randbelow(10 ** CODE_DIGITS):0{CODE_DIGITS}d}"


# ponytail: per-IP counting is in-process because `otp_challenge` has no `ip` column and
# adding one now would collide with Amarsh's migration 0004. Move it to the table (or a
# shared counter) the moment more than one API task runs.
_ip_hits: dict[str, list[float]] = {}


def check_ip_rate(ip: str) -> None:
    limit, window = PER_IP
    now = time.monotonic()
    hits = [t for t in _ip_hits.get(ip, ()) if now - t < window.total_seconds()]
    if len(hits) >= limit:
        _ip_hits[ip] = hits
        raise AppError("RATE_LIMITED", "Too many codes requested. Try again later.")
    hits.append(now)
    _ip_hits[ip] = hits


async def check_phone_rate(tx: Tx, phone: str) -> None:
    limit, window = PER_PHONE
    n = await tx.conn.scalar(
        text(
            "SELECT count(*) FROM otp_challenge"
            " WHERE phone = :phone AND created_at > now() - cast(:window as interval)"
        ),
        {"phone": phone, "window": window},
    )
    if (n or 0) >= limit:
        raise AppError("RATE_LIMITED", "Too many codes requested. Try again later.")


async def customer_for_phone(tx: Tx, phone: str) -> UUID | None:
    placeholders = ", ".join(f"'{s}'" for s in ACTIVE_BOOKING_STATUS)
    return cast("UUID | None", await tx.conn.scalar(
        text(
            "SELECT c.id FROM customer c"
            " JOIN booking_applicant ba ON ba.customer_id = c.id"
            " JOIN booking b ON b.id = ba.booking_id"
            f" WHERE c.primary_phone = :phone AND b.status IN ({placeholders})"
            " LIMIT 1"
        ),
        {"phone": phone},
    ))


async def issue(tx: Tx, phone: str, customer_id: UUID) -> str:
    code = new_code()
    await tx.conn.execute(
        text(
            "INSERT INTO otp_challenge (phone, customer_id, code_hash, expires_at)"
            " VALUES (:phone, :cid, :hash, now() + cast(:ttl as interval))"
        ),
        {"phone": phone, "cid": customer_id, "hash": code_hash(code), "ttl": TTL},
    )
    return code


@dataclass(frozen=True)
class Challenge:
    id: UUID
    customer_id: UUID
    code_hash: bytes
    attempts: int


async def latest(tx: Tx, phone: str) -> Challenge | None:
    row = (
        await tx.conn.execute(
            text(
                "SELECT id, customer_id, code_hash, attempts FROM otp_challenge"
                " WHERE phone = :phone AND consumed_at IS NULL AND expires_at > now()"
                " ORDER BY created_at DESC LIMIT 1 FOR UPDATE"
            ),
            {"phone": phone},
        )
    ).mappings().first()
    return None if row is None else Challenge(**row)


async def consume(tx: Tx, phone: str, code: str) -> tuple[UUID | None, str | None]:
    """Returns `(customer_id, None)` on success or `(None, error_code)` on failure.

    It returns rather than raises because a wrong code must *commit* its attempt
    counter — raising inside `tx()` would roll the increment back with everything else.
    """
    challenge = await latest(tx, phone)
    if challenge is None:
        return None, "UNAUTHENTICATED"
    if challenge.attempts >= MAX_ATTEMPTS:
        return None, "LOCKED"
    if not hmac.compare_digest(challenge.code_hash, code_hash(code)):
        await tx.conn.execute(
            text("UPDATE otp_challenge SET attempts = attempts + 1 WHERE id = :id"),
            {"id": challenge.id},
        )
        return None, "UNAUTHENTICATED"
    await tx.conn.execute(
        text("UPDATE otp_challenge SET consumed_at = now() WHERE id = :id"), {"id": challenge.id}
    )
    return challenge.customer_id, None


FAILURE_MESSAGE = {
    "UNAUTHENTICATED": "That code is not valid.",
    "LOCKED": "Too many attempts. Request a new code.",
}
