# 07 · API

`/api/v1`, JSON, `snake_case`, FastAPI-generated OpenAPI as the contract. The endpoint lists in the role specs are consolidated here so the whole surface is visible in one place; when a role spec and this file differ in path or shape, this file wins and the role spec is corrected.

---

## 1. Conventions

| | |
|---|---|
| Base | `/api/v1`; both SPAs call the same origin they were served from. |
| Auth | `hf_session` cookie ([`03`](03-identity-and-access.md)). No bearer tokens. Unauthenticated → `401 UNAUTHENTICATED`, always, including for "does it exist" probes. |
| CSRF | `X-Requested-With: HomeFlow` on every non-GET. |
| Envelope | Success `{ "data": …, "meta": { "request_id", "next_cursor"? } }`. Error `{ "errors": [{ "code", "message", "field"?, "source_ref"? }], "meta": { "request_id" } }`. |
| Ids | uuid strings. Never sequential ids on the wire. |
| Dates | `date` as `YYYY-MM-DD`; `timestamptz` as ISO-8601 with `Z`. |
| Money | string decimals (`"1250000.00"`), currency implicit INR. |
| Pagination | `?cursor=&limit=` (default 50, max 200) on every list; `meta.next_cursor` opaque (base64 of the sort key + id). |
| Filtering | explicit query params per endpoint; no generic query language. |
| Idempotency | `Idempotency-Key` header honoured on every `POST` that creates or transitions; stored 24 h in `idempotency_key(key, principal, response_hash, response)`; replay returns the stored response. |
| Concurrency | mutations on versioned rows send `version`; mismatch → `409 STALE_VERSION`. |
| Reads never write | enforced by CI marker (01 §3). |
| Versioning | breaking change → `/api/v2` alongside; additive changes do not bump. |

## 2. Error codes

One handler in `kernel/errors.py`. `AppError(code, **ctx)` carries an HTTP status by code.

| HTTP | code | when |
|---|---|---|
| 400 | `VALIDATION` (field), `BAD_UUID`, `REASON_CODE_REQUIRED` | Pydantic / `22P02` / catalogue rule |
| 401 | `UNAUTHENTICATED` | no or expired session |
| 403 | `FORBIDDEN`, `CSRF_HEADER_MISSING`, `NOT_PROVISIONED`, `WRITE_FENCE` | matrix / CSRF / Google user unknown / role fence (03 §7) |
| 404 | `NOT_FOUND` | no row visible under RLS (an existing row in another project is also 404 — never 403, no existence leak); `23503` on write |
| 409 | `CONFLICT`, `STALE_VERSION`, `INVALID_TRANSITION`, `GATE_FAILED` (with `blockers[]`) | `23505` / version / state machine / handshake gate |
| 422 | `SOURCE_FIELD_INVALID` (with `source_ref`) | Document Factory pre-generation (H4) — "fix at source" |
| 423 | `LOCKED` | OTP attempts exhausted |
| 429 | `RATE_LIMITED` | OTP, presign bursts |
| 500 | `INTERNAL` | anything else; message is generic; `request_id` logged with the traceback. Never HTML, never a path. |

## 3. Endpoint map

Kernel-owned endpoints are in [`03`](03-identity-and-access.md) §1–2 (auth), [`04`](04-events-and-jobs.md) §6 (events), [`05`](05-action-and-journey.md) §6 (actions/journey), [`08`](08-files-documents-notifications.md) §1 (files). Module endpoints below; `[module:level]` is the `require()` guard; `†` = write-fenced to the listed roles only.

### project_site `[project_site]`
```
GET  /units/{id}/progress                                   read
PUT  /units/{id}/progress/{component_id}                    write †site_engineer,design       { state_code, actual_date?, expected_next_at?, planned_next_event?, evidence_ids[] }
POST /units/{id}/progress/exception                         write †site_engineer               { component_id, state_code, reason_code, source, evidence_ids[] }
POST /projects/{id}/progress/bulk/preview                   write †site_engineer               { scope{ node_id | unit_ids[] }, component_id, state_code } → affected units + gate transitions (no write)
POST /projects/{id}/progress/bulk/commit                    write †site_engineer               same + exceptions[{ unit_id, skip|state_code, reason_code }]
GET  /change-requests?assigned=feasibility                  read
POST /change-requests/{id}/feasibility                      write †design,site_engineer        { result, conditions[], dependencies[], cost_estimate?, schedule_impact? }
POST /change-requests/{id}/release                          write †design                      { drawing_file_id } → AsBuiltRevision, H6
GET  /change-window-holds?status=project_review             read
POST /change-window-holds/{id}/approve | /reject            write †site_engineer               { reason_code, schedule_impact? }
```

### sales `[sales]`
```
GET  /units?project_id=&sale_status=&gate.{category_code}=OPEN|...&cursor=       read   inventory with gate chips + score + freshness
GET  /units/{id}/changeability                               read   gates, score decomposition, pitch angle
POST /units/compare                                          read   { unit_ids[] } (≥2, ≤6)
POST /opportunities · GET /opportunities/{id}                write/read
POST /opportunities/{id}/needs                               write  { needs[{ category_id, level: must_have|preferred }] }
POST /opportunities/{id}/match                               read   ranked units with explanations
POST /change-window-holds                                    write  { unit_id, category_id, opportunity_id, duration_hours, reason, construction_impact }
GET  /change-window-holds?opportunity_id=                    read
POST /change-requests                                        write  H5 (opportunity-linked)
POST /bookings                                               write  draft
PATCH /bookings/{id}                                         write  draft only
POST /bookings/{id}/applicants · DELETE …/applicants/{aid}   write  draft only
GET  /bookings/{id}/completeness                             read
POST /bookings/{id}/handover/submit                          write  H2 submit → 409 GATE_FAILED with missing[] if below threshold
```

### crm_rm `[crm_rm]`
```
GET  /bookings/{id}/handover                                 read
POST /bookings/{id}/handover/accept                          write  { rm_owner_id }        H2 accept
POST /bookings/{id}/handover/return                          write  { reason_code, notes } H2 return
GET  /customers?q=                                           read   trigram search
GET  /customers/{id}                                         read   360 (tabs assembled server-side: profile, bookings, financial[read], documents, commitments, communications, experience, journey, events)
PATCH /customers/{id}                                        write  profile / consent / preferences
POST /customers/merge                                        write  { survivor_id, merged_id, reason_code } (audited)
POST /commitments · POST /commitments/{id}/approve|fulfil|waive   write
GET  /commitments?at_risk=true&owner_id=                     read
POST /communications                                         write  { booking_id, channel, direction, visibility, body|template_code+vars }
GET  /customers/{id}/communications                          read
POST /change-requests                                        write  H5 (booking-linked)
POST /change-requests/{id}/quote/present · /accept           write  H6 customer acceptance
GET  /customer-updates?status=pending                        read
POST /customer-updates/{id}/approve | /suppress              write  H10 gate
POST /bookings/{id}/promise-to-pay                           write  { demand_id, expected_date, expected_amount, confidence }   (signal only — amounts stay accounts-owned)
```

### accounts `[accounts]`
```
GET  /bookings/{id}/demands                                  read
POST /bookings/{id}/funding                                  write  H3 receive (called by crm_rm.handshakes; also exposed for edits)
POST /demands/{id}/receipt                                   write  { amount, mode, received_at, tds_amount?, reference }
POST /receipts/{id}/reconcile | /reverse                     write  { reason_code }
POST /demands/{id}/overdue-reason                            write  { reason_code, narrative? }
POST /demands/{id}/waiver                                    write  { amount, reason_code } (authority-gated)
GET  /projects/{id}/collections?view=true_risk               read   buckets from domain/collections
GET  /projects/{id}/collections/heatmap                      read
GET  /bookings/{id}/loan · POST /loan-cases/{id}             read/write
POST /projects/{id}/forecast/snapshot                        write  lock
GET  /projects/{id}/forecast?as_of=&horizon=                 read
POST /forecast-lines/{id}/override                           write  { value, reason_code, evidence_ids[] }
GET  /projects/{id}/forecast/scenarios                       read
GET  /projects/{id}/cashflow?period=                         read
GET  /bookings/{id}/financial-clearance                      read   H7 evaluation (also emitted as event on demand/receipt change)
POST /tds/{receipt_id}/verify                                write
```

### legal `[legal]`
```
POST /documents/generate                                     write  { booking_id, document_family, transaction_type } → 202 { document_id } or 422 SOURCE_FIELD_INVALID[]
GET  /documents/{id} · GET /documents/{id}/validation        read
POST /documents/{id}/deviation · /approve · /reject          write  { stage, decision, reason_code?, clause_ids? }
POST /documents/{id}/compare?from=&to=                       read
POST /documents/{id}/share                                   write  → customer_update(document_ready)
POST /documents/{id}/execute                                 write  { mode: esign|wet|register, evidence_ids[], sro_reference? } → ExecutionRecord
GET  /templates · POST /templates/{id}/versions · /activate  admin  (Policy Studio, legal admin)
GET  /bookings/{id}/registration                             read
POST /registration/{id}/slot · /complete                     write  H8 on complete { registered_copy_file_id, sro_reference, registered_at }
```

### qa `[qa]`
```
GET  /units/{id}/readiness                                   read
POST /units/{id}/qa/{component_id}/verify                    write †qa                 { result, evidence_ids[], is_independent }
GET  /units/{id}/qa/exceptions                               read
POST /snags · POST /snags/{id}/assign|rectify|verify|reopen|close   write  (close requires after_photos)
GET  /projects/{id}/snags/analytics                          read
GET  /bookings/{id}/handover/readiness                       read   domain/handover.evaluate
POST /bookings/{id}/handover/declare-eligible                write †qa                 H9
POST /bookings/{id}/handover/gates/{gate_type}/override      write authority roles     { reason_code, evidence_ids[] } (B.4; safety → 409)
POST /bookings/{id}/handover/appointment                     write  { at, attendees[] }
POST /bookings/{id}/handover/complete                        write  { checklist{ keys, meters[], manuals, warranties, signatures, photos[] } } → H12
```

### post_handover `[post_handover]`
```
GET  /units/{id}/service-history                             read
POST /warranty-cases · POST /warranty-cases/{id}/assign|rectify|verify|reopen|close   write
GET  /warranty-cases?coverage=&status=                       read
GET  /bookings/{id}/dlp                                      read
POST /checkins/{id}/capture                                  write  { satisfaction_score, sentiment, notes }
POST /bookings/{id}/referral                                 write
```

### management `[management]`
```
GET  /projects/{id}/control-tower                            read   five interventions from the `intervention` table (refreshed by job)
GET  /portfolio/control-tower                                read
POST /interventions/{id}/act | /assign | /escalate           write  { decision, owner_id?, note }
GET  /portfolio/kpis?domain=&dimension=&period=              read   kpi_snapshot
POST /overrides                                              write  { target{ type, id }, reason_code, evidence_ids[] } (authority; safety → 409)
GET  /portfolio/cashflow                                     read
```

### customer_portal `[customer_portal]` — customer realm only; every response passes the H10 projection (08 §5)
```
GET  /me                                                     bookings list + selected booking
GET  /me/home                                                T1–T6 assembled
GET  /me/journey · /me/payments · /me/documents · /me/personalisation · /me/commitments · /me/passport · /me/handover
POST /me/payments/{demand_id}/pay                            → payment link (provider adapter; stub locally)
GET  /me/documents/{id}/download                             presigned URL, own docs only
POST /me/change-requests · POST /me/change-requests/{id}/accept
POST /me/service-requests
POST /me/handover/appointment/confirm
PATCH /me/preferences                                        language, channels, consent
```

### admin `[admin]` (Policy Studio)
```
CRUD /projects · /projects/{id}/hierarchy · /projects/{id}/units (master) · /projects/{id}/config
CRUD /users · /users/{id}/roles · /teams · /project-team-assignments (effective-dated)
CRUD /change-categories · /change-gate-rules · /component-definitions · /customer-stage-maps
CRUD /sla-policies · /working-calendars · /journey-templates · /journey-templates/{id}/versions (+ /approve /activate)
CRUD /message-templates · /auto-publish-rules · /payment-plans · /schedules (cadence only)
GET  /permissions · PUT /permissions/{role}/{module}
```
Every admin write emits `config.changed` with previous/new state; effective-dated tables never update in place.

---

## 4. OpenAPI and contract tests

- Tags = module names; every route has `summary`, `response_model`, and documented error codes.
- `schemathesis run http://localhost:8001/api/v1/openapi.json --checks all` in CI against the compose stack with a seeded staff session and a seeded customer session (header injection via a hook). Any 500 fails the build.
- The customer-realm run additionally asserts that no response body key is in the H10 hidden set (08 §5).
- The exported `openapi.json` is committed under `docs/spec/technical/openapi/` on each release and diffed in PRs so breaking changes are visible.
