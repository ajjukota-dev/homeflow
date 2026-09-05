# 08 · Files, documents, notifications, and the H10 filter

---

## 1. Files (`kernel/files/`)

Blobs live in S3 (MinIO locally); metadata in `file_object` ([`02`](02-database.md) §4.4). The API never proxies bytes.

```
POST /files/presign      { entity_type, entity_id, filename, content_type, size_bytes, visibility? }
                         → checks the caller may write that entity (module matrix + RLS read of the parent)
                         → INSERT file_object(status='pending', s3_key = {project_id}/{entity_type}/{entity_id}/{id})
                         → { file_id, upload: { url, method: PUT, headers } }   (presigned PUT, 10 min, content-type + length bound)
PUT  <presigned url>     browser → S3/MinIO directly
POST /files/{id}/confirm → HEAD object (size, etag); sha256 computed by a job for > 5 MB, inline otherwise; status='ready'; event file.attached
GET  /files/{id}         → 302 to presigned GET (5 min) after RLS + visibility check; customers only for visibility='customer_facing'
```

Rules: allowed content types are a list (pdf, jpeg, png, heic, dwg, xlsx, docx, csv); max 50 MB; `pending` rows older than 24 h are pruned with their orphan object by `job.prune`. Bucket: private, versioning on, SSE-S3, lifecycle rule moving non-current versions to IA after 90 days. Evidence for Actions, snags (before/after photos), QA, handover, documents and drawings all use this one path; `evidence_ids` are `file_object` ids.

Local: MinIO with the same `boto3` calls (`endpoint_url` from settings); the presigned URL host is rewritten to `localhost:9000` for the browser. Migration from v1 GridFS is in [`11`](11-migration-runbook.md) §4.

---

## 2. Document Factory (`kernel/documents/`, `roles/legal` §1.3, PDF §32)

Carried from v1's Jinja + WeasyPrint generation; made governed.

**Tables:** `document_template(id, code, family{aos|sale_deed|lease|addendum|variation|cancellation|transfer|kyc_letter…}, project_id?, product_type?, jurisdiction?)`, `document_template_version(id, template_id, version, status{draft|approved|active|retired}, html (Jinja), merge_fields jsonb[MergeField], validation_rules jsonb, clause_slots jsonb, approved_by, effective_from)`, `clause_library(id, code, version, text, applicability jsonb, status)`, `generated_document(id, project_id, booking_id, family, transaction_type, template_version_id, snapshot jsonb, status, current_version int, checksum bytea?, file_id?, customer_visible boolean)`, `document_version(id, document_id, version, file_id, rendered_from jsonb{snapshot_hash, clause_ids, deviation_ids}, created_by, created_at)`, `deviation(id, document_id, clause_id?, proposed_text, reason_code, requested_by, approved_by?, status)`, `execution_record(id, document_id, mode{esign|wet|register}, executed_at, evidence_ids uuid[], sro_reference?, checksum bytea)` (append-only).

**Flow (`POST /documents/generate` → job `doc.generate`):**

1. Resolve the active template version for `(family, project, product_type, jurisdiction)`; none → 409 `NO_ACTIVE_TEMPLATE`.
2. `legal.readiness_check(merge_fields, source)` where `source` is assembled from booking, applicants, unit, project, payment plan, approved deviations. Any error → 422 with `source_ref` (`{ entity, id, field }`) — the UI links to the source record; nothing is generated. Warnings do not block.
3. `snapshot = legal.freeze_snapshot(...)`; INSERT `generated_document(status='generating', snapshot)`; event `document.generation.requested`.
4. Job: `ctx = legal.render_context(snapshot, clauses, deviations)` → Jinja (`autoescape=True`, sandboxed environment, no filesystem access) → HTML → WeasyPrint → PDF. `DRAFT` diagonal watermark until `status ∈ {approved_for_execution, executed, registered}`. Upload via `Files` (entity = the document), `document_version` row, `checksum = sha256(pdf)`.
5. `legal.auto_validate(...)` on the rendered text → `document.validation.failed` with errors, else `document.generated`, status `draft`.
6. Stage decisions (`/approve`): `draft → legal_review → customer_review → approved_for_execution → executed → registered | archived`; every decision emits its event with actor. Deviations require the approval matrix (`project.config.approval_matrix`) and separation of duties (proposer ≠ approver).
7. `/execute` writes `execution_record` (immutable) and re-checksums the final PDF; `registered` triggers H8.

Templates are HTML in the DB (Policy Studio edits, versioned, approved). v1's `doc_templates/` files seed version 1. A template change never re-renders existing documents; regenerating creates a new `document_version` from a **new snapshot** and supersedes the old one visibly.

---

## 3. Notifications (`kernel/notifications/`)

Three adapters behind `Notifier`: `SesEmail` (SES, `ap-south-1`), `Messaging` (MSG91 or Gupshup — WhatsApp template messages with SMS fallback; the provider is chosen by `MESSAGING_PROVIDER`), `Console` (local: logs and writes to the outbox viewer at `/dev/outbox`). Locally email goes to Mailpit.

Every send is an `outbox` row created by a job or handshake and delivered by the `notify.send` job:

```
notify.send(outbox_id):
  row = SELECT … FOR UPDATE; if status != 'queued': return                       # idempotent
  guardrails (customer rows only): consent for the channel; quiet hours (project.config.quiet_hours, IST);
     frequency cap (≤ N customer-facing messages per booking per day, config) → status='suppressed', reason
  template = message_template(code, channel, status='approved') → render vars (Jinja, autoescape)
  result = adapter.send(...) → status='sent', provider_message_id | raise → retry by the job runner
  event customer.contact.sent (customer rows) / notification.sent (staff rows)
```

Staff notifications default to **in-app** (an `notification` row read by the bell + My Day) and go to email/WhatsApp only for L2+ escalations or opted-in categories (PDF §"Employee action"). Templates are versioned and approved in Policy Studio; an unapproved template cannot be sent.

Inbound (customer replies, delivery receipts) arrive at `POST /webhooks/messaging/{provider}` (signature-verified, public route) and become `communication(direction='inbound')` rows plus `customer.response.received` events.

---

## 4. Customer updates — the H10 record

`customer_update` is the single record of anything that crosses to the customer ([`../foundation/handshakes.md`](../foundation/handshakes.md) H10). Created by the `customer_update.draft` job from a source event, holding `update_type` and `approved_content` produced by the projection (§5). Status `draft → approved → published | suppressed`.

- `auto_publish_rule` (Policy Studio) approves low-risk types automatically (`payment_received`, `progress_stage_reached` with site-flagged photos); everything else waits in `GET /customer-updates?status=pending` for an RM.
- Publishing = `customer_update.publish` job: status `published`, event `customer.update.published`, outbox rows per preferred channel, and the portal reads published rows.
- AI may fill `draft` content; it can never set `approved` (no code path; the job that approves checks `actor.type != 'ai'`).

---

## 5. The H10 projection (`modules/customer_portal/projection.py`)

Pure functions, one per transparency feature ([`../foundation/customer-transparency.md`](../foundation/customer-transparency.md)), each returning a Pydantic model that **only has the approved fields**. Hidden fields cannot leak because the model has no attribute for them.

```python
def build_progress(stage_map: CustomerStageMap, progress: Sequence[ComponentProgress], photos: Sequence[FileObject]) -> T1Progress
def build_payments(demands, receipts, plan, milestone_labels) -> T2Payments          # why_now from domain/collections.why_now (customer phrase)
def build_personalisation(gates: Sequence[GateResult], categories) -> T3Personalisation   # bucket mapping; freshness ≠ fresh → "confirming with site"
def build_passport(items, spec_items, selections) -> T4Passport
def build_legal_corner(project, documents) -> T5LegalCorner
def build_keys_window(handover: HandoverEval, my_todos) -> T6KeysWindow             # window + confidence label only; never blockers
```

Invariants tested in `modules/customer_portal/test_projection.py`: the serialised output of every builder contains none of the keys in `HIDDEN = {"progress_pct","vendor","cost","current_state","reason_code","blockers","override","true_risk","ptp_confidence","internal_notes","staff",…}` under any input (hypothesis); stale inputs produce the soft state; T3 shows "window closed" the moment a gate is `EXCEPTION_ONLY`/`HARD_CLOSED` (transparency acceptance 1–6).

`GET /me/home` assembles the six builders for the selected booking and merges the latest `customer_update` rows (what was communicated, when). Customer copy strings come from `seeds/config/customer_copy.py` (Policy Studio "stage-level customer visibility" wording), never from internal enum names.
