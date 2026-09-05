"""Session and CSRF middleware (technical/01 §3 steps 2-3, 03 §3 and §5)."""
from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from kernel.db import tx
from kernel.identity import session as session_mod
from kernel.identity.principal import ANONYMOUS, SYSTEM

log = logging.getLogger("homeflow.identity")

CSRF_HEADER = "X-Requested-With"
CSRF_VALUE = "HomeFlow"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
#: `/auth/google/callback` arrives as a top-level GET from Google, so it is already safe;
#: `/health` is called by the container and the ALB, which send no headers of ours.
CSRF_EXEMPT = frozenset({"/health"})


class SessionMiddleware(BaseHTTPMiddleware):
    """Cookie -> session row -> Principal. No cookie or no row means ANONYMOUS, never 401:
    the 401 is the router's `require()`, so an unguarded route still reads zero rows."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request.state.principal = ANONYMOUS
        token = request.cookies.get(session_mod.COOKIE_NAME)
        if token:
            try:
                async with tx(SYSTEM) as t:
                    request.state.principal = await session_mod.load_principal(t, token)
            except Exception:  # noqa: BLE001 — a broken session must not 500 every route
                log.exception("session lookup failed request_id=%s", getattr(request.state, "request_id", ""))
        return await call_next(request)


class CsrfMiddleware(BaseHTTPMiddleware):
    """`X-Requested-With: HomeFlow` on every non-GET. A browser cannot add it cross-site
    without a CORS preflight, and CORS is not enabled for other origins."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if request.method not in SAFE_METHODS and request.url.path not in CSRF_EXEMPT:
            if request.headers.get(CSRF_HEADER) != CSRF_VALUE:
                return JSONResponse(
                    status_code=403,
                    content={
                        "errors": [
                            {"code": "CSRF_HEADER_MISSING", "message": "Missing X-Requested-With header."}
                        ],
                        "meta": {"request_id": getattr(request.state, "request_id", "")},
                    },
                )
        return await call_next(request)
