"""The one error envelope and the one exception handler (technical/07 §2).

Every failure leaves as `{errors:[{code,message,field?,source_ref?}], meta:{request_id}}`.
A 500 body is always generic: the traceback and the request id go to the log, never the wire.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("homeflow.errors")

STATUS_BY_CODE: dict[str, int] = {
    "VALIDATION": 400,
    "BAD_UUID": 400,
    "REASON_CODE_REQUIRED": 400,
    "UNAUTHENTICATED": 401,
    "FORBIDDEN": 403,
    "CSRF_HEADER_MISSING": 403,
    "NOT_PROVISIONED": 403,
    "WRITE_FENCE": 403,
    "NOT_FOUND": 404,
    "CONFLICT": 409,
    "STALE_VERSION": 409,
    "INVALID_TRANSITION": 409,
    "GATE_FAILED": 409,
    "SOURCE_FIELD_INVALID": 422,
    "LOCKED": 423,
    "RATE_LIMITED": 429,
    "INTERNAL": 500,
}

# Postgres SQLSTATE -> (code, message). 23503 is a write against a row the caller cannot
# see, which is a 404 by the no-existence-leak rule, not a 409.
SQLSTATE_MAP: dict[str, tuple[str, str]] = {
    "23503": ("NOT_FOUND", "Referenced record does not exist."),
    "23505": ("CONFLICT", "That record already exists."),
    "22P02": ("BAD_UUID", "Malformed identifier."),
    "23514": ("VALIDATION", "Value is not allowed for this field."),
    "42501": ("FORBIDDEN", "Not permitted."),
}


class AppError(Exception):
    """Raised by domain/service code. The HTTP status comes from the code."""

    def __init__(
        self,
        code: str,
        message: str | None = None,
        *,
        field: str | None = None,
        source_ref: str | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message or code)
        self.code = code
        self.message = message or code.replace("_", " ").capitalize() + "."
        self.field = field
        self.source_ref = source_ref
        self.extra = extra or {}

    @property
    def status_code(self) -> int:
        return STATUS_BY_CODE.get(self.code, 400)

    def as_error(self) -> dict[str, Any]:
        e: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.field:
            e["field"] = self.field
        if self.source_ref:
            e["source_ref"] = self.source_ref
        e.update(self.extra)
        return e


def envelope(errors: list[dict[str, Any]], request: Request) -> dict[str, Any]:
    return {"errors": errors, "meta": {"request_id": getattr(request.state, "request_id", "")}}


def ok(data: Any, request: Request, **meta: Any) -> dict[str, Any]:
    """The success half of the same wire envelope (technical/07 §1)."""
    return {"data": data, "meta": {"request_id": getattr(request.state, "request_id", ""), **meta}}


def _json(status: int, errors: list[dict[str, Any]], request: Request) -> JSONResponse:
    return JSONResponse(status_code=status, content=envelope(errors, request))


def install(app: FastAPI) -> None:
    """Register the handlers. Order matters: most specific first."""

    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:
        return _json(exc.status_code, [exc.as_error()], request)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {
                "code": "VALIDATION",
                "message": err.get("msg", "Invalid value."),
                "field": ".".join(str(p) for p in err.get("loc", ())[1:]) or None,
            }
            for err in exc.errors()
        ]
        return _json(400, errors, request)

    @app.exception_handler(DBAPIError)
    async def _dbapi(request: Request, exc: DBAPIError) -> JSONResponse:
        sqlstate = getattr(getattr(exc, "orig", None), "sqlstate", None) or getattr(exc, "code", None)
        code, message = SQLSTATE_MAP.get(str(sqlstate), ("INTERNAL", "Something went wrong."))
        if code == "INTERNAL":
            log.exception("db error request_id=%s", getattr(request.state, "request_id", ""))
        return _json(STATUS_BY_CODE[code], [{"code": code, "message": message}], request)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 405: "NOT_FOUND"}.get(
            exc.status_code, "VALIDATION" if exc.status_code < 500 else "INTERNAL"
        )
        message = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return _json(exc.status_code, [{"code": code, "message": message}], request)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled request_id=%s", getattr(request.state, "request_id", ""))
        return _json(500, [{"code": "INTERNAL", "message": "Something went wrong."}], request)
