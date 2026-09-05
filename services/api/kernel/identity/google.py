"""Google OIDC, server-side (technical/03 §1).

Everything that talks to Google lives behind `GoogleOidc` so tests can stub one object
instead of the network. Nothing here touches the database.
"""
from __future__ import annotations

import base64
import hashlib
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx
from authlib.jose import JsonWebKey, jwt

from kernel.errors import AppError
from settings import settings

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
ISSUERS = ("https://accounts.google.com", "accounts.google.com")
JWKS_TTL = 6 * 3600


def pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode()).digest()
    return verifier, base64.urlsafe_b64encode(digest).decode().rstrip("=")


@dataclass
class GoogleOidc:
    """The only code path that reaches accounts.google.com."""

    client_id: str
    client_secret: str
    redirect_uri: str
    allowed_hd: frozenset[str]
    _jwks: Any = None
    _jwks_at: float = 0.0

    def authorization_url(self, *, state: str, challenge: str) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "prompt": "select_account",
        }
        if self.allowed_hd:
            params["hd"] = sorted(self.allowed_hd)[0]
        return f"{AUTH_URL}?{urlencode(params)}"

    async def exchange(self, code: str, verifier: str) -> dict[str, Any]:
        """Code -> verified id_token claims. Raises AppError on anything unexpected."""
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                TOKEN_URL,
                data={
                    "code": code,
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "redirect_uri": self.redirect_uri,
                    "grant_type": "authorization_code",
                    "code_verifier": verifier,
                },
            )
        if resp.status_code != 200 or "id_token" not in resp.json():
            raise AppError("UNAUTHENTICATED", "Google sign-in failed.")
        return self.verify_id_token(resp.json()["id_token"], await self.jwks())

    async def jwks(self) -> Any:
        if self._jwks is None or time.time() - self._jwks_at > JWKS_TTL:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(JWKS_URL)
            self._jwks = JsonWebKey.import_key_set(resp.json())
            self._jwks_at = time.time()
        return self._jwks

    def verify_id_token(self, id_token: str, keys: Any) -> dict[str, Any]:
        """Signature, iss, aud, exp — then the two claims that decide provisioning."""
        try:
            claims = jwt.decode(id_token, keys)
            claims.validate()
        except Exception as exc:  # authlib raises a family of JoseError subclasses
            raise AppError("UNAUTHENTICATED", "Google sign-in failed.") from exc
        return self.check_claims(dict(claims))

    def check_claims(self, claims: dict[str, Any]) -> dict[str, Any]:
        if claims.get("iss") not in ISSUERS or claims.get("aud") != self.client_id:
            raise AppError("UNAUTHENTICATED", "Google sign-in failed.")
        if claims.get("email_verified") is not True:
            raise AppError("NOT_PROVISIONED", "Your Google account has no verified email.")
        # The `hd` request parameter is a UI hint only; the claim is the control.
        if self.allowed_hd and claims.get("hd") not in self.allowed_hd:
            raise AppError("NOT_PROVISIONED", "Sign in with your Pranava Workspace account.")
        return claims


def build() -> GoogleOidc:
    return GoogleOidc(
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        redirect_uri=f"{settings.PUBLIC_BASE_URL}/auth/google/callback",
        allowed_hd=frozenset(h.strip() for h in settings.GOOGLE_ALLOWED_HD.split(",") if h.strip()),
    )
