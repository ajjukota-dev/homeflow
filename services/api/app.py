"""Pranava HomeFlow — Phase 1 FastAPI entry point."""
from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# Import after load_dotenv so env vars are available
from fastapi import APIRouter, FastAPI, Request  # noqa: E402
from starlette.middleware.cors import CORSMiddleware  # noqa: E402
from starlette.responses import FileResponse  # noqa: E402

from kernel import errors as kernel_errors  # noqa: E402
from kernel.collaboration.comments import router as comments_router  # noqa: E402
from kernel.db import dispose_engine  # noqa: E402
from kernel.errors import AppError  # noqa: E402
from kernel.events.audit import router as audit_router  # noqa: E402
from kernel.events.router import router as events_router  # noqa: E402
from kernel.files import handlers as file_handlers  # noqa: E402,F401
from kernel.files.attachments import router as attachments_router  # noqa: E402
from kernel.files.router import router as files_router  # noqa: E402
from kernel.health import router as health_router  # noqa: E402
from kernel.identity.middleware import CsrfMiddleware, SessionMiddleware  # noqa: E402
from kernel.identity.rbac import reload as reload_rbac  # noqa: E402
from kernel.identity.router import router as identity_router  # noqa: E402
from kernel.jobs import handlers as job_handlers  # noqa: E402,F401
from kernel.jobs import ticker  # noqa: E402
from kernel.journey.workflow import router as workflow_router  # noqa: E402
from kernel.middleware import RequestIdMiddleware  # noqa: E402
from kernel.mongo import close_db, init_db  # noqa: E402
from kernel.notifications.notifications import router as notifications_router  # noqa: E402
from kernel.search.search import router as search_router  # noqa: E402
from modules.accounts.collections import router as collections_router  # noqa: E402
from modules.accounts.financial_clearance import router as financial_clearance_router  # noqa: E402
from modules.accounts.loans import router as loans_router  # noqa: E402
from modules.accounts.payments import router as payments_router  # noqa: E402
from modules.accounts.tds import router as tds_router  # noqa: E402
from modules.admin.master import router as master_router  # noqa: E402
from modules.crm_rm.commitments import router as commitments_router  # noqa: E402
from modules.crm_rm.communications import router as communications_router  # noqa: E402
from modules.crm_rm.customers import router as customers_router  # noqa: E402
from modules.crm_rm.sales_handovers import router as sales_handovers_router  # noqa: E402
from modules.crm_rm.tasks import router as tasks_router  # noqa: E402
from modules.legal.document_generation import router as document_generation_router  # noqa: E402
from modules.legal.documents import router as documents_router  # noqa: E402
from modules.legal.legal import router as legal_router  # noqa: E402
from modules.legal.registrations import router as registrations_router  # noqa: E402
from modules.management.escalations import router as escalations_router  # noqa: E402
from modules.management.exec_dashboard import router as exec_dashboard_router  # noqa: E402
from modules.management.reports import router as reports_router  # noqa: E402
from modules.qa.handovers import router as handovers_router  # noqa: E402
from modules.qa.snags import router as snags_router  # noqa: E402
from modules.qa.unit_readiness import router as unit_readiness_router  # noqa: E402
from modules.sales.bookings import router as bookings_router  # noqa: E402
from seeds.backfill import backfill_parent_links  # noqa: E402
from seeds.seed import seed_all  # noqa: E402
from settings import settings  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("pranava")


app = FastAPI(
    title="Pranava HomeFlow — Phase 1",
    description="Internal Post-Sales Customer Journey OS. Phase 1: auth, RBAC, master data.",
    version="0.1.0",
    openapi_url="/api/openapi.json",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)


api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"service": "pranava-homeflow", "phase": 1, "status": "ok"}


@api_router.get("/health")
async def health():
    return {"status": "ok"}


# Wire feature routers
api_router.include_router(master_router)
api_router.include_router(customers_router)
api_router.include_router(bookings_router)
api_router.include_router(search_router)
api_router.include_router(comments_router)
api_router.include_router(attachments_router)
api_router.include_router(notifications_router)
api_router.include_router(audit_router)
api_router.include_router(workflow_router)
api_router.include_router(tasks_router)
api_router.include_router(documents_router)
api_router.include_router(document_generation_router)
api_router.include_router(commitments_router)
api_router.include_router(sales_handovers_router)
api_router.include_router(payments_router)
api_router.include_router(tds_router)
api_router.include_router(financial_clearance_router)
api_router.include_router(collections_router)
api_router.include_router(loans_router)
api_router.include_router(legal_router)
api_router.include_router(registrations_router)
api_router.include_router(unit_readiness_router)
api_router.include_router(snags_router)
api_router.include_router(handovers_router)
api_router.include_router(escalations_router)
api_router.include_router(communications_router)
api_router.include_router(reports_router)
api_router.include_router(exec_dashboard_router)

app.include_router(api_router)

# --- HomeFlow 2.0 kernel (technical/01 §3, 03, 07 §1-2) ----------------------------
app.include_router(health_router)
app.include_router(identity_router)                       # /auth/*, /me/session
app.include_router(events_router)                         # /api/v1/events
app.include_router(files_router)                          # /api/v1/files
app.include_router(identity_router, prefix="/api/v1")     # same routes under the API base
# Starlette runs the last-added middleware first, so this is: request id -> session -> CSRF.
app.add_middleware(CsrfMiddleware)
app.add_middleware(SessionMiddleware)
app.add_middleware(RequestIdMiddleware)
kernel_errors.install(app)
logger.info("HomeFlow kernel wired: env=%s version=%s", settings.ENV, settings.VERSION)


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Single-page apps, served by Host (technical/09 §7, 10 §1) ---------------
# The Dockerfile's `web` stage builds both frontends into ./static. Locally the
# directories are absent (each app runs on its own Vite port and proxies here),
# so nothing below is mounted and every path keeps its current behaviour.
STATIC_ROOT = ROOT_DIR / "static"
SPA_DIRS = {
    settings.WORKSPACE_HOST.split(":")[0]: STATIC_ROOT / "workspace",
    settings.CUSTOMER_HOST.split(":")[0]: STATIC_ROOT / "customer",
}
# Paths the API owns; a miss under these is a JSON 404, never an index.html.
API_PREFIXES = ("api", "auth", "health", "openapi.json", "docs", "redoc")


def _spa_dir(request: Request) -> Path:
    """Pick the app by Host; the workspace is the default for anything else."""
    hostname = (request.headers.get("host") or "").split(":")[0].lower()
    return SPA_DIRS.get(hostname, STATIC_ROOT / "workspace")


def _mount_spas(application: FastAPI) -> None:
    if not any(d.is_dir() for d in SPA_DIRS.values()):
        logger.info("No ./static build present - SPAs are served by Vite in dev.")
        return

    @application.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str, request: Request):  # noqa: ANN202
        head = full_path.split("/", 1)[0]
        if head in API_PREFIXES:
            raise AppError("NOT_FOUND", "Not Found")
        root = _spa_dir(request)
        candidate = (root / full_path).resolve()
        # Path traversal guard: never serve anything outside the app's own dist.
        if full_path and root.resolve() in candidate.parents and candidate.is_file():
            # Vite fingerprints every asset filename, so they can be cached forever.
            return FileResponse(candidate, headers={"Cache-Control": "public, max-age=31536000, immutable"})
        index = root / "index.html"
        if not index.is_file():
            raise AppError("NOT_FOUND", "Not Found")
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    logger.info("SPA hosts: %s -> workspace, %s -> customer", settings.WORKSPACE_HOST, settings.CUSTOMER_HOST)


_mount_spas(app)


V1_MONGO = os.environ.get("HOMEFLOW_V1_MONGO", "0") == "1"


@app.on_event("startup")
async def on_startup():
    await reload_rbac()
    logger.info("RBAC matrix loaded from `permission`.")
    if settings.TICKER_ENABLED:
        await ticker.start()
        logger.info("Job ticker started (advisory lock %d).", ticker.LOCK_ID)
    if not V1_MONGO:
        logger.info("HOMEFLOW_V1_MONGO unset - skipping the v1 Mongo seed; v1 routers stay mounted.")
        return
    init_db()
    try:
        await seed_all()
        logger.info("Seed complete.")
    except Exception as exc:  # noqa: BLE001
        logger.exception("Seed failed: %s", exc)
    try:
        stats = await backfill_parent_links()
        logger.info("Audit backfill: %s", stats)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Audit backfill failed: %s", exc)


@app.on_event("shutdown")
async def on_shutdown():
    await ticker.stop()
    if V1_MONGO:
        close_db()
    await dispose_engine()
