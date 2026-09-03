# Foundation · Owner Transparency Surface

The home-buyer's trust is the product's #1 job. This file defines **what the owner gets to see about their own home** — and proves each view is a *projection of an engine we already build*, not a new subsystem. Nothing here duplicates logic; every feature reads existing entities and crosses to the customer through **[`handshakes.md`](handshakes.md) H10** (the visibility filter).

> **One engine, two views.** The changeability engine, progress engine, collections engine, readiness engine, and document factory each already exist for *internal* roles. This file adds the **customer lens** on the same truth. If the internal number and the customer number ever disagree, the internal engine is the source and the customer view is wrong.

---

## 1. Principle

| Rule | Meaning |
|---|---|
| **Projection, not a copy** | Each customer view is a read-only, filtered projection of a canonical entity. No new source of truth. |
| **Approved-only** | Only `visibility = customer_facing`, approved milestones, and approved forecasts cross H10. Internal notes, vendor prices, staff performance, raw internal % and unapproved forecasts never appear. |
| **Freshness-honest** | If the source is stale past policy, the customer sees a soft "updating" state — never a falsely precise promise. (Mirrors the internal `Verification Required` rule.) |
| **Human-gated** | A human (RM/CRM) or a configured auto-publish rule approves what crosses. AI may draft, never auto-send. |
| **Calm copy** | Customer copy uses warm, plain language — never internal vocabulary (no "gate", "SLA", "twin"). See [`design-language.md`](design-language.md) §6. |

---

## 2. The six transparency features → engine linkage

Each feature below lists: **source engine**, **data model entities read**, **derivation/algorithm**, **approved fields crossing H10**, **hidden fields**, and **producing role**.

### T1 · "Build My Home" progress tracker
*A warm visual stage bar for the buyer's unit, with dated approved site photos.*

| | |
|---|---|
| **Source engine** | Unit progress ([`project-site`](../roles/project-site/spec.md)) → Unit Twin construction layer. |
| **Entities read** | `UnitProgressState`, `ComponentDefinition`, `QAEvidence` (approved photos only). |
| **Algorithm** | Map fine-grained `ComponentDefinition` components → a small set of **customer stages** (config: `Foundation → Structure → MEP & Walls → Finishing → Ready`). A stage is `complete` when its mapped components reach `complete/verified`; `in_progress` if any started. Stage % is **coarse and derived**, never the raw internal component %. |
| **Approved fields (H10)** | `{ stages[{ label, state, reached_at }], current_stage, approved_photos[{ url, caption, taken_at }], next_stage_label }` |
| **Hidden** | Raw component %, internal planned dates, contractor/vendor, snags, cost. |
| **Producing role** | `project-site` publishes; `crm-rm` (or auto-rule) approves photos + captions before they cross. |

New config object: **`CustomerStageMap`** — `{ project_id, stages[{ label, component_ids[], customer_photo_policy }] }`. Lives in Policy Studio. This is the *only* new artifact T1 needs.

### T2 · Milestone-linked payment clarity
*Every demand shows "why now", with receipts and running paid/remaining.*

| | |
|---|---|
| **Source engine** | Collections ([`accounts`](../roles/accounts/spec.md)). |
| **Entities read** | `Demand`, `Receipt`, `PaymentPlan`, and the construction event that triggered the demand. |
| **Algorithm** | Each `Demand` already links to a milestone/construction trigger. Render `why_now` from that link ("Slab cast → this milestone is due"). Running totals = Σ receipts vs `total_consideration`. TDS guidance shown as approved help text. |
| **Approved fields (H10)** | `{ schedule[{ milestone_label, amount, due_date, status, why_now }], paid_total, remaining_total, receipts[{ amount, date, receipt_id }], next_due, secure_pay_link }` |
| **Hidden** | Internal risk scoring, PTP confidence, collections notes, forecast, disputes framing. |
| **Producing role** | `accounts` owns amounts; `crm-rm` approves surfacing. Amounts are finance-owned (never CRM-edited). |

Linkage requirement: **`Demand.trigger`** must carry a customer-safe `milestone_label` (config) so T2 can render "why now" without exposing internal codes.

### T3 · Personalisation window countdown
*"You can still change your kitchen layout until ~March; after that it's an exception."* The buyer-side view of the **same gates** Sales already reads.

| | |
|---|---|
| **Source engine** | Changeability gates ([`gates.md`](gates.md)) — **already built**. |
| **Entities read** | `UnitChangeGate`, `ChangeCategory` (customer_label), `expected_close_at`, `closing_event`. |
| **Algorithm** | For each `ChangeCategory` where `customer_visible = true` ([`gates.md`](gates.md) A.2), project the gate state to a **friendly bucket**: `OPEN/CLOSING → "Open — until ~{expected_close_at}"`, `CONDITIONAL → "Possible with review"`, `EXCEPTION_ONLY/HARD_CLOSED → "Window closed"`. Show remaining window from `expected_close_at`. If `freshness_status ≠ fresh` → "confirming with site". |
| **Approved fields (H10)** | `{ categories[{ customer_label, status_bucket, window_text, can_request: bool }] }` |
| **Hidden** | Internal state names, `ChangeGateRule`, technical reasons, other units' gates, cost of change. |
| **Producing role** | Gate engine derives; `crm-rm`/`sales` config decides which categories are customer-visible; customer portal renders + links to raise a Change Request. |

> This is the highest-value/most-unique feature: it turns the existing gate engine into **customer-facing personalisation revenue + trust**, with zero new engine. It also mirrors the **sales pitch-angle logic** (early unit = sell customization scope; near-finished = sell fast possession) — same gates, now shown to the buyer.

### T4 · Home Passport, built live
*Finishes, paint/tile codes, appliances accrue as chosen — visible before handover.*

| | |
|---|---|
| **Source engine** | Unit Twin Home Passport ([`unit-twin.md`](unit-twin.md) §2.9) — already modelled. |
| **Entities read** | `HomePassportItem`, approved `UnitSpecItem.current_value`, approved CR selections. |
| **Algorithm** | Filter `HomePassportItem` + spec items to `customer_facing` and `approved` status; group by room/category. Warranties show once populated. |
| **Approved fields (H10)** | `{ items[{ type, name, brand_model, paint_tile_code, warranty_start, warranty_end, manual_url }], selections[{ room, choice }] }` |
| **Hidden** | Vendor, cost, internal SKU, procurement status. |
| **Producing role** | `project-site`/`qa` populate; `crm-rm` approves pre-handover visibility. |

### T5 · RERA / legal safety corner
*RERA reg no., their registered documents, escrow assurance, approvals.*

| | |
|---|---|
| **Source engine** | Documents/Legal ([`legal`](../roles/legal/spec.md)) + Project master. |
| **Entities read** | `Project` (rera_reg_no, approvals), `GeneratedDocument` (customer's own, `status = accepted/registered`), escrow/account assurance config. |
| **Algorithm** | Surface project-level statutory facts (config) + the customer's own executed/registered documents. Read-only. |
| **Approved fields (H10)** | `{ rera_reg_no, approvals[{ name, authority, status }], my_documents[{ name, status, download_url }], escrow_note }` |
| **Hidden** | Other customers' docs, internal legal deliberations, deviation register, draft docs. |
| **Producing role** | `legal` owns document status; project admin owns statutory facts. |

New `Project` fields: `rera_reg_no`, `statutory_approvals[]`, `escrow_assurance_note` (all config-level, customer-safe).

### T6 · Predicted keys window
*Gentle "expected handover: April–May, on track" with the checklist the buyer owns.*

| | |
|---|---|
| **Source engine** | Handover readiness ([`gates.md`](gates.md) B + [`qa`](../roles/qa/spec.md)). |
| **Entities read** | `HandoverGate` (soft/customer only), Handover Readiness Score, customer-owned commitments/documents. |
| **Algorithm** | Project the predicted handover date to a **window** (month range, not an exact date) with a calm confidence label (`On track / Firming up`). Show only the buyer's *own* to-dos (their pending docs/payments/appointments), never internal blockers. |
| **Approved fields (H10)** | `{ expected_window, confidence_label, my_todos[{ label, status, cta }], appointment? }` |
| **Hidden** | Internal readiness %, QA/snag detail, hard-gate blockers, override history, other-party blockers. |
| **Producing role** | `qa` + `crm-rm` converge; `crm-rm` approves the window before it crosses. |

---

## 3. Where each feature lives in the build

| Feature | New data artifact | Producing role spec | Rendered in |
|---|---|---|---|
| T1 progress | `CustomerStageMap` (config) | `project-site` (publish) | `customer` portal |
| T2 payments | `Demand.milestone_label` | `accounts` | `customer` portal |
| T3 personalisation | `ChangeCategory.customer_visible` bool ([`gates.md`](gates.md) A.2) | gate engine + `sales`/`crm-rm` config | `customer` portal |
| T4 passport | (reuses `HomePassportItem`) | `project-site`/`qa` | `customer` portal |
| T5 legal safety | `Project.rera_reg_no` + statutory fields | `legal` + admin | `customer` portal |
| T6 keys window | (reuses HandoverGate + readiness) | `qa` + `crm-rm` | `customer` portal |

**Sequencing:** T1, T2, T4, T5 ship with their producing roles (low complexity, reuse existing data). **T3 and T6 are fast-follows** — they need the changeability and handover engines mature, but are fully specified here so there is no gap and the data model already supports them.

All six are **rendered** in the [`customer`](../roles/customer/spec.md) role spec (build order #7); this file is the contract they implement.

---

## 4. Delivery through H10

The [`handshakes.md`](handshakes.md) **H10** payload is the single channel. Its `update_type` is extended to include: `progress_stage_reached`, `payment_due`, `personalisation_window_changed`, `passport_item_added`, `document_ready`, `handover_window_updated`. Each carries only the approved-fields subset defined above. The H10 visibility filter strips everything in the "Hidden" rows.

---

## 5. Acceptance tests (transparency-scoped)

1. A customer progress stage advances **only** after the mapped internal components reach `complete/verified` — never from a raw % edit. (T1)
2. A demand shown to the customer always carries a plain-language "why now" tied to a real milestone. (T2)
3. A personalisation category shows "window closed" to the customer the moment its gate reaches `EXCEPTION_ONLY/HARD_CLOSED`, and hides internal state names. (T3)
4. No customer-facing view ever exposes vendor, cost, internal %, or another unit's/customer's data. (all — enforced by H10 + `visibility`)
5. When source data is stale, the customer sees a soft "updating" state, not a precise promise. (T1, T3, T6)
6. The predicted keys view shows a **window** + the buyer's own to-dos only — never internal blockers or exact hard-gate status. (T6)
