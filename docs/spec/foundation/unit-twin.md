# Foundation · ★ Unit Digital Twin

The live physical + spec truth of a Unit — **maintained even before the Unit is sold.** This is one of the two headline nouns of HomeFlow. Every role that touches a home reads this twin; only `project-site` and `qa` write to it.

> **The twin is a composed view, not a table.** It is the `Unit` master row ([`data-model.md`](data-model.md) §2.3) plus the sub-entities below. "Reading the Unit Twin" = reading this composition scoped to one `unit_id`.

---

## 1. Twin surface — who writes, who reads

| Layer | Written by | Read by | Never edited by |
|---|---|---|---|
| Identity | admin | all | — |
| Specification baseline | project-site, design | sales, crm-rm, legal, customer | sales, crm-rm |
| Construction / component progress | **project-site** | sales, crm-rm, qa, customer, mgmt | **sales, crm-rm** |
| Live changeability gates | derived (rule engine) | sales, crm-rm, customer, mgmt | **everyone** (rule-derived only) |
| QA/QC evidence | **qa** | project-site, crm-rm, customer, mgmt | sales |
| Snag history | qa, vendor | crm-rm, customer, mgmt | sales |
| Released configuration / as-built | design, project-site | all | sales, crm-rm |
| Handover evidence | qa, crm-rm | customer, mgmt | — |
| Home Passport | qa, project-site | customer, FM | — |

**Hard rule:** No Sales/CRM API path or UI control may mutate construction progress, QA truth, technical feasibility, or hard changeability gates. Enforced at the API layer and RLS. (Foundation acceptance test #21.)

---

## 2. Layers & sub-entities

### 2.1 Identity
From the `Unit` master row — project, hierarchy, unit number, type, area, facing, parking, UDS. See [`data-model.md`](data-model.md) §2.3.

### 2.2 Specification baseline

The standard finish schedule for this unit type + any approved variations.

**UnitSpecItem**

| field | type | req | writes | notes |
|---|---|---|---|---|
| `id` | uuid | ✔ | | |
| `unit_id` | ref<Unit> | ✔ | | |
| `category` | ref<ChangeCategory> | ✔ | | Kitchen, flooring, electrical… |
| `component` | string | ✔ | | Room/trade/system item. |
| `standard_value` | json | ✔ | design | Brand, model, spec of the standard finish. |
| `current_value` | json | ✔ | derived | Standard + approved CR variations. |
| `drawing_revision_id` | ref<AsBuiltRevision> | | design | Latest released drawing/spec. |
| `is_variation` | bool | ✔ | derived | True if changed from standard via CR. |

### 2.3 Construction state & component progress

The physics that drives changeability. Written **only** by `project-site`.

**UnitProgressState** (one row per component per unit; the atomic progress fact)

| field | type | req | writes | notes |
|---|---|---|---|---|
| `id` | uuid | ✔ | | |
| `unit_id` | ref<Unit> | ✔ | | |
| `component_id` | ref<ComponentDefinition> | ✔ | | Room/trade/system node (e.g. `mep-first-fix`, `flooring`, `structure`). |
| `state_code` | enum{ not_started \| in_progress \| complete \| verified } | ✔ | project-site | |
| `progress_pct` | decimal | | project-site | Optional; evidence-based, not the source of gate truth. |
| `actual_date` | timestamp | | project-site | When this state was reached. |
| `planned_next_event` | string | | project-site | The event that will move it next (drives gate closure forecast). |
| `expected_next_at` | timestamp | | project-site | For gate-expiry forecast. |
| `source_system` | string | ✔ | project-site | `homeflow_native` by default; connector id if imported. |
| `source_record_id` | string | | | For imported data. |
| `updated_by` | ref<User> | ✔ | | |
| `updated_at` | timestamp | ✔ | | |
| `freshness_status` | enum{ fresh \| stale \| verification_required } | ✔ | derived | Past policy age → `verification_required`. |

**ComponentDefinition** — the configurable taxonomy of buildable components (room/trade/system), mapped to change categories. Project-configurable, not hard-coded.

> **Progress ≠ changeability.** Never derive a gate from overall construction %. Gates come from **mapped component/trade events** (see [`gates.md`](gates.md)).

### 2.4 Live changeability gates

Per-category gate state for this unit. **Rule-derived only** — no direct writes. Full mechanics in [`gates.md`](gates.md).

**UnitChangeGate**

| field | type | req | notes |
|---|---|---|---|
| `id` | uuid | ✔ | |
| `unit_id` | ref<Unit> | ✔ | |
| `category_id` | ref<ChangeCategory> | ✔ | |
| `current_state` | enum{ OPEN \| CLOSING \| CONDITIONAL \| EXCEPTION_ONLY \| HARD_CLOSED } | ✔ | |
| `reason_code` | string | ✔ | Why it's in this state. |
| `source_event` | string | | The progress event that set it. |
| `expected_close_at` | timestamp | | For CLOSING gates. |
| `closing_event` | string | | The event that will close/restrict it. |
| `last_evaluated_at` | timestamp | ✔ | |
| `freshness_status` | enum{ fresh \| stale \| verification_required } | ✔ | Inherited from underlying progress. |

**Changeability score** — a derived, explainable 0–100 index per unit for sales inventory. Always decomposable into the underlying gate states. Cached with `computed_at`.

### 2.5 QA/QC evidence

Written by `qa`. Detail (checklists, inspections) in `roles/qa/spec.md`; the twin holds the evidence records.

**QAEvidence**: `id`, `unit_id`, `component_id`, `checklist_id`, `result` enum{ pass \| fail \| na }, `photos[]`, `test_certificates[]`, `inspector_id`, `verified_at`, `is_independent_verification` bool.

### 2.6 Snag history

**Snag**: `id`, `unit_id`, `category`, `severity` enum{ critical \| major \| minor }, `location`, `trade`, `vendor_id`, `root_cause_code`, `status` enum{ open \| assigned \| in_progress \| ready_for_qa \| reopened \| verified \| closed }, `before_photos[]`, `after_photos[]`, `is_repeat` bool, `rectification_cost` money, `sla_due_at`. (Owned by `qa`; full flow in `roles/qa/spec.md`.)

### 2.7 Released configuration & as-built

**AsBuiltRevision** — immutable versioned drawing/spec.

| field | type | req | notes |
|---|---|---|---|
| `id` | uuid | ✔ | |
| `unit_id` | ref<Unit> | ✔ | |
| `revision_number` | int | ✔ | Monotonic. |
| `source_cr_id` | ref<ChangeRequest> | | If produced by an approved CR. |
| `drawing_file_id` | ref<file> | ✔ | |
| `status` | enum{ released \| superseded } | ✔ | Superseded revisions are **locked** and visibly marked. |
| `released_at` | timestamp | ✔ | |
| `released_by` | ref<User> | ✔ | |

> Site, QA, and Procurement consume **only** the current `released` revision. Superseded ones cannot be mistaken for current. (Acceptance test #18.)

### 2.8 Handover evidence

**HandoverRecord**: readiness gate snapshot, meter readings, keys issued, manuals delivered, final photos, signatures, appointment ref. Jointly written by `qa` + `crm-rm`. Detail in `roles/qa/spec.md` + `roles/crm-rm/spec.md`.

### 2.9 Digital Home Passport

Survives forever; visible to the customer after handover.

**HomePassportItem**: `id`, `unit_id`, `item_type` enum{ equipment \| finish \| warranty \| manual }, `name`, `serial_number`, `brand_model`, `paint_tile_code`, `warranty_start`, `warranty_end`, `manual_file_id`, `service_history[]`.

---

## 3. Lifecycle — the twin over time

| Phase | Twin state |
|---|---|
| **Pre-sales (unsold)** | Full Identity + Spec baseline + Progress + Gates maintained by `project-site`, **with no Customer/Booking attached.** Sales reads changeability to sell. |
| **Booked** | Booking links a Customer Twin to this Unit Twin. **Gate state continues unchanged** — booking does not reset physics. |
| **Construction** | `project-site` updates progress; gates re-evaluate by rule; affected prospects/CRs flagged. |
| **Customisation** | Approved CR → new `AsBuiltRevision`; `current_value` updates; competing gates re-evaluate. |
| **QA & handover** | `qa` writes evidence; readiness derives; handover gates converge. |
| **Post-handover** | Home Passport + service history continue on the Unit **forever**, across any future ownership change. |

**Permanence rule:** cancellation, transfer, joint-owner change, and resale close/alter the *Booking* — the Unit Twin's physical history, as-built, snags, and passport are never deleted or reset. (Foundation acceptance test #2.)

---

## 4. Key behaviours (acceptance-testable)

1. Two units in one project at different progress show the **same** change category as `OPEN` for one and `EXCEPTION_ONLY` for the other. (#20, §30)
2. `project-site` marking `mep-first-fix` = `in_progress` moves mapped electrical gates **by rule**, with no Sales edit. (#22, §33)
3. Bulk tower/floor progress update previews affected units + gate transitions before commit, and allows an authorized **unit-level exception**. (#28, §30)
4. Stale progress past policy shows Sales/CRM **Verification Required**, never a precise open/closed promise. (§30)
5. Every gate transition/override logs timestamp, actor/source, previous state, new state, reason/event. (§35.1)
6. Every completed customisation updates the permanent as-built record and preserves variation economics. (#19)
