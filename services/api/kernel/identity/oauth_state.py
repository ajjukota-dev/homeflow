"""The short-lived signed `hf_oauth` cookie that carries state + PKCE verifier + next.

Signed, not encrypted: it holds nothing secret, and the signature is what stops a
forged `state` (technical/03 §1 step 1).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

from settings import settings

TTL_SECONDS = 600


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _sign(body: str) -> str:
    return _b64(hmac.new(settings.SESSION_SECRET.encode(), body.encode(), hashlib.sha256).digest())


def dump(payload: dict[str, Any]) -> str:
    body = _b64(json.dumps({**payload, "iat": int(time.time())}, separators=(",", ":")).encode())
    return f"{body}.{_sign(body)}"


def load(cookie: str | None) -> dict[str, Any] | None:
    if not cookie or "." not in cookie:
        return None
    body, _, signature = cookie.partition(".")
    if not hmac.compare_digest(signature, _sign(body)):
        return None
    try:
        payload = json.loads(_unb64(body))
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or time.time() - payload.get("iat", 0) > TTL_SECONDS:
        return None
    return payload


def safe_next(value: str | None) -> str:
    """Open-redirect guard (technical/03 §10): a same-origin relative path, nothing else."""
    if not value or not value.startswith("/") or value.startswith("//") or "\\" in value:
        return "/"
    return value
