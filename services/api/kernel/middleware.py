"""Request id in, request id out (technical/01 §3 step 1)."""
from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

HEADER = "X-Request-Id"


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Accept an inbound X-Request-Id or mint one; it becomes the correlation id."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = request.headers.get(HEADER) or str(uuid.uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers[HEADER] = request_id
        return response
