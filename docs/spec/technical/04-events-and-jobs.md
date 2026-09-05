# 04 · Events and jobs

The event log is the audit ([`../foundation/event-log.md`](../foundation/event-log.md)); the job table is the queue. They share one transaction, so nothing is emitted without being recorded and nothing recorded is lost. No SQS, no bus, no worker service ([`../foundation/architecture.md`](../foundation/architecture.md) §2.3).

---

## 1. Appending an event

```python
# kernel/events/append.py
async def append(tx: Tx, type: str, *, subject: dict, payload: dict = {}, actor: Actor | None = None,
                 previous_state=None, new_state=None, reason_code=None, correlation_id=None, occurred_at=None) -> UUID:
    spec = CATALOGUE[type]                                   # KeyError → programming error; unknown types never reach the DB
    if spec.reason_required and not reason_code: raise AppError("REASON_CODE_REQUIRED", event_type=type)
    project_id = derive_project_id(tx, subject)              # from unit_id / booking_id / explicit project_id
    row = await tx.insert("event", {... actor=actor or tx.principal.as_actor(), correlation_id=correlation_id or tx.correlation_id})
    for job in CONSUMERS.get(type, ()):                      # fan-out, same transaction
        await jobs.enqueue(tx, job.kind, job.args(subject, payload), dedupe_key=job.dedupe(subject), correlation_id=row.correlation_id)
    return row.id
```

`CATALOGUE` (`kernel/events/catalogue.py`) is the foundation's list, each entry `{ type, reason_required, subject_keys, payload_model }`. A test asserts every type in [`event-log.md`](../foundation/event-log.md) §3 exists and every `append(` call site in the code uses a catalogued type (grep-based).

`tx.correlation_id` defaults to the request id; a handshake sets it to the driving entity id (booking/CR) so a whole workflow reconstructs from `WHERE correlation_id = …`.

---

## 2. Consumers map

Static, in `kernel/events/consumers.py`. Event type → jobs to enqueue.

| Event | Jobs |
|---|---|
| `unit.progress.updated`, `unit.progress.bulk_applied`, `unit.progress.corrected`, `cr.released`, `hold.expired`, `hold.activated` | `gate.reevaluate(unit_id)` (dedupe `gate:{unit_id}`) |
| `unit.gate.*` transitions | `gate.notify_affected(unit_id, category_id, from, to)` → Actions for prospects/CRs; `customer_update.draft(update_type=personalisation_window_changed)` if category is customer-visible |
| `booking.handover.accepted` | `journey.start(booking_id)`, `customer_update.draft(welcome)` |
| `demand.raised`, `receipt.posted`, `receipt.reversed`, `waiver.applied` | `collections.recompute(booking_id)`, `customer_update.draft(payment_due | receipt)` |
| `snag.*`, `unit.readiness.*`, `registration.completed`, `registration.financial_clearance.evaluated`, `commitment.*` | `handover.reevaluate(booking_id)` (dedupe) |
| `document.generation.requested` | `doc.generate(document_id)` |
| `document.generated`, `document.registered`, `document.shared_with_customer` | `customer_update.draft(document_ready)` |
| `handover.completed` | `post_handover.open(booking_id)` → DLP window, passport finalise, 7/30/90 check-in Actions |
| `escalation.created`, `escalation.upgraded` | `tower.refresh(project_id)`, `notify.send(...)` to owner/backup/manager per tier |
| `sla.clock.warned`, `sla.clock.breached` | `notify.send(...)` per ladder level |
| `customer.update.published` | `notify.send(...)` per customer preferred channel (through the H10 filter, 08 §5) |
| `config.changed` | `config.reload`, and `gate.reevaluate` for every unit of the project if a gate rule changed |
| `journey.plan.revised`, `journey.forecast.revised` | `journey.recompute(journey_instance_id)`, `customer_update.draft(handover_window_updated)` if stage is customer-visible |

Everything a role spec calls "auto-generated", "flagged", "scheduled" is a row in this table. Adding a consumer is one line; there is no other place to add one.

---

## 3. Enqueuing and the ticker

```python
# kernel/jobs/enqueue.py
async def enqueue(tx, kind, args, *, run_at=None, dedupe_key=None, correlation_id=None) -> UUID | None:
    # ON CONFLICT (dedupe_key) WHERE status IN ('queued','running') DO NOTHING → returns None when coalesced
```

```python
# kernel/jobs/ticker.py — started in app lifespan when TICKER_ENABLED
async def run():
    while not stopping:
        async with engine.begin() as conn:
            if not await conn.scalar(text("SELECT pg_try_advisory_lock(7001)")):   # another task is the ticker
                await asyncio.sleep(5); continue
            await expand_schedules(conn)                                           # due schedule rows → job rows
            claimed = await conn.execute(text("""
                UPDATE job SET status='running', started_at=now(), attempts=attempts+1
                WHERE id IN (SELECT id FROM job WHERE status='queued' AND run_at <= now()
                             ORDER BY run_at LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING *"""))
        for job in claimed: asyncio.create_task(run_one(job))                       # each in its own tx(system principal)
        await asyncio.sleep(2 if claimed else 10)
```

`run_one`: look up `HANDLERS[job.kind]`, run inside `tx(SYSTEM)` with `correlation_id = job.correlation_id`; on success `status='done'`; on exception `status='queued', run_at = now() + 30s × 2^attempts, last_error = str(e)`; after `max_attempts` → `status='dead'` and event `job.dead` (which enqueues `notify.send` to the ops address). A job whose task dies mid-run (`running` for > 10 min) is reset to `queued` by the `job.reap` schedule.

Handlers are idempotent by construction: each re-derives from current state (`gate.reevaluate` recomputes every gate for the unit; `notify.send` checks `outbox.status` before sending). Every handler is a plain async function registered with `@job("gate.reevaluate")` in the kernel or module that owns the work.

The advisory lock means only one task runs the ticker even with two API tasks; when that task dies the lock releases and the other one takes over within 5 s. Session-level lock is held on a dedicated connection for the ticker's lifetime.

---

## 4. Schedules

| kind | cadence | does |
|---|---|---|
| `sla.tick` | every 60 s | ladder evaluation for open Actions (05 §3) |
| `freshness.scan` | every 15 min | `unit_progress_state` older than project policy → `stale` / `verification_required`; emits `unit.freshness.breached` |
| `hold.expire` | every 5 min | `change_window_hold` past `expires_at` → `expired` + event |
| `commitment.prebreach` | every 30 min | commitments due within policy window → `at_risk` + Action |
| `gate.reconcile` | daily 02:00 | `gate.reevaluate` for every unit (catches missed events) |
| `forecast.snapshot` | daily 00:30 | on the 1st of the month: lock `forecast_snapshot` per project |
| `tower.refresh` | every 10 min | rebuild the five interventions per project (management reads a table; GET never writes) |
| `journey.recompute_all` | daily 03:00 | forecast dates + confidence for all active journeys |
| `checkin.due` | daily 09:00 | 7/30/90-day post-handover Actions |
| `digest.daily` | daily 08:00 IST | My Day digest notifications (in-app + opted-in email) |
| `job.prune`, `job.reap` | daily 04:00 / every 5 min | housekeeping |

Schedules are rows (`seeds/config/schedules.py`), editable in Policy Studio (cadence only; the kind must have a handler).

---

## 5. Job catalogue (handlers)

`gate.reevaluate` · `gate.notify_affected` · `handover.reevaluate` · `collections.recompute` · `journey.start` · `journey.recompute` · `doc.generate` · `notify.send` · `customer_update.draft` · `customer_update.publish` · `tower.refresh` · `post_handover.open` · `config.reload` · `forecast.snapshot` · `escalation.decision_pack` · plus the schedule kinds above. Each handler lives next to the tables it writes (module or kernel) and is unit-tested with an in-memory `Tx` fake.

---

## 6. Reading events

- `GET /events?subject.booking_id=&type=&from=&to=` (staff, RLS-scoped, redacted payloads) — the audit tab on every 360 screen.
- `GET /events/{correlation_id}/trace` — the reconstructed workflow for a handshake.
- Analytics roll-ups (management KPIs) read `event` with `date_trunc` queries and cache into `kpi_snapshot` by the `tower.refresh` job.

---

## 7. Guarantees (tested)

1. An `append` inside a transaction that rolls back leaves no event and no job.
2. A consumer job for an event exists in the same transaction as the event (query both by `correlation_id`).
3. `homeflow_app` cannot `UPDATE` or `DELETE` `event` (permission-denied test).
4. Two API tasks never both run the ticker (advisory-lock test with two connections).
5. A job that raises 5 times becomes `dead` with `last_error` set, and a `job.dead` event exists.
6. `dedupe_key` coalesces bursts: 50 progress updates on one unit yield one queued `gate.reevaluate`.
