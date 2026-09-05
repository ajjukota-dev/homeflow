# 11 · Migration runbook — v1 Mongo → Postgres, GridFS → S3

Executes [`../foundation/v1-reuse.md`](../foundation/v1-reuse.md) §2 (collection → table mapping) and §5 (order). Scripts live in `services/api/migration/` and are deleted after cutover; the mapping tables in `v1-reuse.md` remain as the record.

Prerequisite: v1 frozen at `7854b05`, the Emergent agent stopped, and a read-only Mongo dump of production (`mongodump --uri … --out dump/`). Nothing here touches the live v1 database.

---

## 1. Scripts

| Script | Does |
|---|---|
| `export_mongo.py` | `mongorestore` the dump into a throwaway local Mongo, then dump each of the 41 collections to `work/<collection>.jsonl` (one document per line, `_id` and ObjectIds stringified, dates ISO). Also exports GridFS file metadata to `work/fs.files.jsonl` and the blobs to `work/blobs/<id>`. |
| `transform/<collection>.py` | One module per collection: reads JSONL, emits one or more `work/out/<table>.csv` with the target columns. Pure functions (`row_in → rows_out`), unit-tested with a sample document per collection taken from the dump. Id mapping: `v1_id → uuid7` kept in `work/idmap.csv` so every FK resolves. |
| `load.py` | `COPY` each CSV into Postgres **as `homeflow_owner`** with triggers disabled, in FK order (project → hierarchy → unit → customer → booking → applicant → …), then re-enables triggers and runs `enforce_project_id` checks as a query. |
| `files.py` | For each GridFS file: upload blob to S3/MinIO under `{project_id}/{entity_type}/{entity_id}/{uuid}`, insert `file_object(status='ready', sha256)`, map `attachment` rows to `file_object` ids. Resumable (skips keys that exist). |
| `derive.py` | Runs the engines over the loaded data through the real kernel: `gate.reevaluate` for every unit, `collections.recompute` per booking, `handover.reevaluate` per booking, `journey.start` for active bookings without a journey (or `journey.import` for v1 journeys, §3), `action` rows for open v1 tasks/snags/escalations. Emits **one** `migration.imported` event per entity instead of replaying history (v1's `audit_logs` are loaded verbatim into `event` as `legacy.audit` with `source = { system: "v1", source_record_id }`). |
| `verify.py` | Counts per collection vs per table; referential integrity; per-booking money totals (Σ receipts, Σ demands) equal v1's computed values; every v1 attachment resolves to a `file_object` with matching size; 20 random bookings compared field by field and printed for eyeballing. Exit non-zero on any mismatch. |

Run everything with `python -m migration.run --dump dump/ --target $DATABASE_URL` — idempotent: it truncates the target's domain tables first (never `event` rows already produced by the new system; the migration runs into an empty database).

---

## 2. Transform notes per area

- **Users / roles** — `users` → `"user"` (email lower-cased, `is_active`), v1 `role` codes → `role.id` via `canonical_role()`; password hashes dropped; `user_role_assignment` and `project_team_assignment` from v1's `authorized_project_ids` + department (`effective_from` = v1 `created_at`).
- **Projects / units** — v1 `projects` + `units` (with tower/floor strings) → `project`, `project_hierarchy_node` (created from distinct tower/floor values), `unit`. `sale_status` derived from the loaded bookings.
- **Bookings / customers** — v1 `bookings` embed customer fields → split into `customer` (deduplicated by phone + PAN, merge audited as `customer.merged` event) and `booking_applicant`. v1 stage → 2.0 stage per `v1-reuse.md` §3.
- **Payments** — v1 `payments`, `tds`, `loans`, `financial_clearances` → `demand`, `receipt`, `tds_record`, `loan_case`, `financial_clearance`; milestone labels assigned from the payment plan seed.
- **Legal** — `documents`, `document_versions`, `registrations` → `generated_document`, `document_version`, `execution_record`, `registration_case`; v1 templates → `document_template_version` v1 `active`.
- **QA / handover** — `unit_readiness` (per-booking manual %) is **not** migrated as truth; component states are set from v1's readiness checklist items where they exist, otherwise `not_started`, and a `unit.verification.requested` Action is created for every unit under construction so site confirms real progress in the first week. `snags`, `handovers` (incl. overrides → `handover_gate.state='overridden'` with the v1 reason) map directly.
- **Commitments / communications / escalations** — direct; v1 escalation rules become `sla_policy` + ladder behaviour, not rows.
- **Workflow** — v1 `journeys`/`stage_instances`/`task_instances` → `journey_instance`/`stage_instance`/`task_instance` under a `journey_template_version` created from v1's templates (`status='superseded'` so no new booking uses it); each open v1 task becomes an Action.
- **Audit** — `audit_logs` → `event(event_type='legacy.audit')`, payload = the v1 document minus PII diffs of masked fields (`rbac_redact` masks applied once, at import).

---

## 3. Order and timing

| Step | Runs | Time (est.) |
|---|---|---|
| 1 | `export_mongo.py` | minutes |
| 2 | `alembic upgrade head` + `seeds.config` on an empty target | seconds |
| 3 | `load.py` | minutes |
| 4 | `files.py` | proportional to blob volume (v1 ≈ GBs) — run first on the rehearsal, incremental on cutover |
| 5 | `derive.py` | minutes (engines over hundreds of units) |
| 6 | `verify.py` | minutes |
| 7 | smoke: sign in as one user per role, open Unit 360 / Customer 360 / My Day, one handshake end to end | 30 min, by hand |

**Rehearsal** (locally, then on staging) at least twice; every discrepancy becomes a transform test. **Cutover**: announce a freeze of v1 (read-only for staff, 2 hours), take the dump, run steps 1–7 against prod RDS, switch DNS, keep v1 readable for 30 days, then archive the dump to the files bucket under `migration/` and delete `services/api/migration/`.

---

## 4. GridFS → S3

Keys follow the `file_object` convention; original filenames and content types are preserved in the row; v1 `attachment` visibility flags map to `visibility`. A `migration.files_verified` event records counts and total bytes. Objects are uploaded with `ContentType` and `Metadata: { v1_id }` so a reverse lookup is possible while v1 is still readable.
