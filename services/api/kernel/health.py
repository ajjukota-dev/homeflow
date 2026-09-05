"""GET /health — the one route the container healthcheck and the ALB use."""
from __future__ import annotations

import logging
from typing import Literal

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool

from kernel.db import engine
from settings import settings

log = logging.getLogger("homeflow.health")
router = APIRouter(tags=["health"])

Check = Literal["ok", "error"]


class Health(BaseModel):
    db: Check
    s3: Check
    version: str
    #: {holder, last_tick_at} — which task owns the advisory lock (technical/04 §3).
    ticker: dict[str, object]


def s3_client() -> object:
    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL,
        region_name=settings.AWS_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        config=Config(connect_timeout=2, read_timeout=2, retries={"max_attempts": 1}),
    )


async def _db_ok() -> Check:
    try:
        async with engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
        return "ok"
    except Exception:  # noqa: BLE001 — health must report, not raise
        log.exception("health: db check failed")
        return "error"


async def _s3_ok() -> Check:
    try:
        await run_in_threadpool(s3_client().head_bucket, Bucket=settings.S3_BUCKET)  # type: ignore[attr-defined]
        return "ok"
    except (BotoCoreError, ClientError, ValueError):
        log.exception("health: s3 check failed")
        return "error"


@router.get("/health", response_model=Health)
async def health() -> Health:
    from kernel.jobs.ticker import STATE

    return Health(
        db=await _db_ok(), s3=await _s3_ok(), version=settings.VERSION, ticker=STATE.as_dict()
    )
