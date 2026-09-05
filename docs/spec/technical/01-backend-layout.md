# 01 · Backend layout

`services/api/` is v1's FastAPI backend ([`../foundation/v1-reuse.md`](../foundation/v1-reuse.md)) reorganised into **kernel · modules · domain**. One process, one image, one Postgres.

---

## 1. Package layout

```
services/api/
├── app.py                    # FastAPI factory: middleware, routers, lifespan (ticker start/stop), SPA mounts
├── settings.py               # one pydantic-settings class; the only place env is read
├── kernel/                   # shared infrastructure — no business rules
│   ├── db.py                 #   engine, session factory, `tx()` context manager that sets the RLS GUCs
│   ├── ids.py                #   uuid7() (mirrors the SQL function for tests)
│   ├── errors.py             #   AppError hierarchy + the one exception handler (07 §2)
│   ├── identity/             #   sessions, Google OIDC, OTP, principal, RBAC, redaction  (03)
│   ├── events/               #   append(), catalogue, consumers map                       (04)
│   ├── jobs/                 #   enqueue(), ticker, handlers registry, schedules           (04)
│   ├── action/               #   Action CRUD, ranking, SLA ladder, escalation producer    (05)
│   ├── journey/              #   templates, instances, date model, recompute (from v1)    (05)
│   ├── documents/            #   Document Factory: templates, snapshot, render, validate  (08)
│   ├── files/                #   file_object + S3 presign/confirm                         (08)
│   ├── notifications/        #   outbox + adapters (SES, WhatsApp/SMS, console)           (08)
│   ├── aws.py                #   aws_clients() → boto3 clients from settings
│   └── calendar.py           #   working-day arithmetic over working_calendar
├── modules/                  # one folder per role; the only place business workflows live
│   ├── project_site/  sales/  crm_rm/  accounts/  legal/  qa/  post_handover/  customer_portal/  management/
│   └── admin/                #   Policy Studio: config tables, template versions, team assignments
├── domain/                   # pure engines: no I/O, no FastAPI, no SQLAlchemy, no boto3     (06)
│   ├── gates.py  collections.py  clearance.py  readiness.py  handover.py  tower.py  legal.py  ranking.py
│   └── test_*.py
├── migrations/               # Alembic (env.py, versions/)
├── seeds/
│   ├── config/               # always applied: roles, permissions, component taxonomy, standard journey, SLA policies, templates
│   └── demo/                 # HOMEFLOW_DEMO=1: East Crest sample data
├── migration/                # one-off Mongo → Postgres scripts (11); deleted after cutover
├── static/                   # built SPAs copied in at image build: workspace/ · customer/
├── tests/                    # integration + acceptance (12)
├── Dockerfile · pyproject.toml · alembic.ini · pytest.ini
```

Size rule: a file over ~200 lines is split by responsibility (router / service / repo / schemas), not by line count.

---

## 2. The module contract

Every `modules/<role>/` has the same five files. Nothing else imports across modules except through `handshakes.py`.

| File | Contains | May import |
|---|---|---|
| `router.py` | FastAPI routes. Parses input, calls one service function, returns a schema. **No SQL, no rules.** | `schemas`, `service`, `kernel.identity.require` |
| `schemas.py` | Pydantic request/response models. Field names = `data-model.md`. Internal-only fields never appear in a response model. | `pydantic` |
| `service.py` | The workflow: load → call `domain` → write own tables → `events.append` → `jobs.enqueue`, all in one `tx()`. | `repo`, `domain.*`, `kernel.*`, own `handshakes`, **other modules' `handshakes` only** |
| `repo.py` | SQLAlchemy Core queries for this module's tables plus read-only queries of any table. | `kernel.db`, `models` |
| `handshakes.py` | The functions other modules are allowed to call: one per handshake this module **receives** (H1–H12, [`../foundation/handshakes.md`](../foundation/handshakes.md)). Each validates the gate, writes own tables, appends the events, creates the receiving Action. | `service` |

**Write ownership** is enforced two ways: by review (a module's `repo.py` only `INSERT/UPDATE`s its own tables — listed per module in 02 §6) and by a CI test that greps each module's `repo.py` for writes to foreign tables.

Example — the H2 accept path lives in `modules/crm_rm/handshakes.py`:

```python
async def accept_booking_handover(tx: Tx, p: Principal, booking_id: UUID, rm_owner_id: UUID) -> Booking:
    """H2 accept: completeness gate → status active → Customer Twin → onboarding Actions → journey start."""
    b = await repo.booking_for_update(tx, booking_id)
    gate = domain.completeness.evaluate(b, await repo.mandatory_docs(tx, b))
    if not gate.passed:
        raise AppError("H2_COMPLETENESS_GATE", gate.missing)
    await repo.set_booking_status(tx, b.id, "active", rm_owner_id=rm_owner_id)
    await customer_twin.instantiate(tx, b)                       # crm_rm owns customer twin tables
    for spec in ONBOARDING_ACTIONS: await action.create(tx, p, spec.for_booking(b))
    await journey.start(tx, b)                                   # kernel
    await events.append(tx, "booking.handover.accepted", subject={"booking_id": b.id}, actor=p, correlation_id=b.id)
    return b
```

`modules/sales/service.py` calls `crm_rm.handshakes.accept_booking_handover` — never `crm_rm.repo`.

---

## 3. Request lifecycle

```
ALB → uvicorn → FastAPI
  1. RequestIdMiddleware      X-Request-Id in → correlation_id on the request state and every log line
  2. SessionMiddleware        cookie hf_session → session row → Principal (or anonymous)         (03 §4)
  3. CsrfMiddleware           non-GET without X-Requested-With: HomeFlow → 403                    (03 §5)
  4. Router dependency        require("module", "write") checks the RBAC matrix                  (03 §7)
  5. tx() context             BEGIN; SET LOCAL app.user_id / app.project_ids / app.realm / app.customer_id
  6. service()                domain calls, own-table writes, events.append, jobs.enqueue
  7. COMMIT                   (or ROLLBACK on any exception → the one exception handler → error envelope)
  8. Response                 {data, meta} — redaction applied by response model + rbac_redact   (03 §8)
```

`tx()` is the only way to get a DB connection. It sets the GUCs from the Principal on **every** transaction, so RLS is never accidentally skipped. Reads use the same path (a read-only transaction is still a transaction).

**Reads never write.** A GET handler that needs a derived view either computes it in memory or reads a cache table that a job maintains. CI test: no `INSERT/UPDATE` reachable from a `GET` route (checked by a marker on repo write functions).

---

## 4. Kernel ports (dependency inversion)

Services depend on these Protocols, not on boto3/SES/SQLAlchemy directly. Implementations are chosen once in `app.py` from `settings`.

```python
class Events(Protocol):
    async def append(self, tx: Tx, type: str, *, subject: dict, payload: dict = {}, actor: Actor,
                     previous_state: dict | None = None, new_state: dict | None = None,
                     reason_code: str | None = None, correlation_id: UUID | None = None) -> UUID: ...

class Jobs(Protocol):
    async def enqueue(self, tx: Tx, kind: str, args: dict, *, run_at: datetime | None = None,
                      dedupe_key: str | None = None, correlation_id: UUID | None = None) -> UUID: ...

class Files(Protocol):
    async def presign_upload(self, tx: Tx, p: Principal, meta: FileMeta) -> PresignedUpload: ...
    async def confirm(self, tx: Tx, file_id: UUID) -> FileObject: ...
    def presign_download(self, key: str, ttl: int = 300) -> str: ...

class Notifier(Protocol):
    async def send(self, msg: OutboundMessage) -> ProviderResult: ...   # called only by the notify.send job

class Clock(Protocol):
    def now(self) -> datetime: ...                                       # injectable for SLA tests
```

`domain/` takes plain dataclasses and returns plain results; it never sees these ports.

---

## 5. Settings

One `Settings(BaseSettings)` in `settings.py`, read once. Everything else imports `settings`.

| Key | Local | AWS (task definition) |
|---|---|---|
| `ENV` | `local` | `prod` |
| `DATABASE_URL` | `postgresql+asyncpg://homeflow_app:…@postgres/homeflow` | secret |
| `S3_ENDPOINT_URL` / `S3_BUCKET` / `AWS_REGION` | `http://minio:9000` / `homeflow-files` / `ap-south-1` | unset (real S3) / bucket name / `ap-south-1` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | minio creds | unset (task role) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_ALLOWED_HD` | dev OAuth client / `pranava.in` | secret / `pranava.in` |
| `SESSION_SECRET` | any | secret (used to HMAC session tokens) |
| `WORKSPACE_HOST` / `CUSTOMER_HOST` | `localhost:8001` / `my.localhost:8001` | `homeflow.pranava.in` / `my.pranava.in` |
| `SMTP_HOST` … or `SES_REGION` | `mailpit:1025` | `ap-south-1` |
| `MESSAGING_PROVIDER` / `MESSAGING_API_KEY` | `console` | `msg91` \| `gupshup` / secret |
| `HOMEFLOW_DEV_LOGIN` | `1` | must be unset — startup refuses `ENV=prod` with it set |
| `HOMEFLOW_DEMO` | `1` | `0` |
| `TICKER_ENABLED` | `1` | `1` |
| `LOG_LEVEL` | `DEBUG` | `INFO` |

---

## 6. Allowed backend dependencies

`fastapi`, `uvicorn`, `sqlalchemy[asyncio]`, `asyncpg`, `alembic`, `pydantic`, `pydantic-settings`, `authlib`, `httpx`, `boto3`, `jinja2`, `weasyprint`, `python-multipart`, `orjson`. Dev: `pytest`, `pytest-asyncio`, `schemathesis`, `ruff`, `mypy`, `hypothesis`.

v1's `litellm`, `openai`, `google-genai`, `stripe`, `huggingface_hub`, `tiktoken`, `emergentintegrations`, `pandas`, `numpy`, `motor`, `pymongo`, `bcrypt`, `pyjwt` are removed. Anything else: ask first.

---

## 7. Code rules that CI enforces

- `ruff check` + `mypy --strict` on `domain/` and `kernel/`; `mypy` (non-strict) on `modules/`.
- `domain/` imports nothing from `fastapi`, `sqlalchemy`, `boto3`, `kernel`, `modules` (import-linter contract).
- `modules/<a>/` imports `modules/<b>/` only via `modules/<b>/handshakes.py`.
- No bare `except:`; no `except Exception: pass`.
- Every router function has a `require()` dependency or is explicitly marked `public` (only `/auth/*`, `/health`).
- Every Pydantic response model is declared; no `dict` responses.
