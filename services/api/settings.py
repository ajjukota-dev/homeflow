"""The only place environment is read (technical/01 §5)."""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Every key from technical/01 §5. Local defaults match docker-compose."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    ENV: Literal["local", "staging", "prod"] = "local"
    VERSION: str = "0.1.0"
    LOG_LEVEL: str = "DEBUG"

    # database — the app connects as homeflow_app (RLS applies); Alembic connects as homeflow_owner
    DATABASE_URL: str = "postgresql+asyncpg://homeflow_app:homeflow_app@postgres:5432/homeflow"
    OWNER_DATABASE_URL: str = "postgresql+asyncpg://homeflow_owner:homeflow_owner@postgres:5432/homeflow"

    # files
    S3_ENDPOINT_URL: str | None = "http://minio:9000"
    S3_BUCKET: str = "homeflow-files"
    # Presigned URLs are signed against S3_ENDPOINT_URL (reachable inside compose) and
    # rewritten to this host for the browser. Unset in AWS: real S3 is reachable as signed.
    S3_PUBLIC_ENDPOINT_URL: str | None = "http://localhost:9000"
    AWS_REGION: str = "ap-south-1"
    AWS_ACCESS_KEY_ID: str | None = None
    AWS_SECRET_ACCESS_KEY: str | None = None

    # identity
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_ALLOWED_HD: str = "pranava.in"
    SESSION_SECRET: str = "local-dev-only"
    HOMEFLOW_DEV_LOGIN: bool = False
    # The origin Google redirects back to; also the base for presigned-URL rewriting docs.
    PUBLIC_BASE_URL: str = "http://localhost:8001"

    # hosts
    WORKSPACE_HOST: str = "localhost:8001"
    CUSTOMER_HOST: str = "my.localhost:8001"

    # notifications
    SMTP_HOST: str = "mailpit"
    SMTP_PORT: int = 1025
    SES_REGION: str | None = None
    MESSAGING_PROVIDER: str = "console"
    MESSAGING_API_KEY: str = ""

    # runtime
    HOMEFLOW_DEMO: bool = False
    TICKER_ENABLED: bool = True

    # v1 carry-overs — removed with TASKS Vivek 16 (Mongo cutover) and Vivek 7 (S3 files)
    MONGO_URL: str = "mongodb://mongo:27017"
    DB_NAME: str = "homeflow_v1"
    ATTACHMENT_STORAGE_ROOT: str = "./.data/attachments"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    s = Settings()
    if s.ENV == "prod" and s.HOMEFLOW_DEV_LOGIN:
        raise RuntimeError("HOMEFLOW_DEV_LOGIN must not be set when ENV=prod")
    return s


settings = get_settings()
