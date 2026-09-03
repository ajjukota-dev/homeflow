# Role · Project / Site

**Module id:** `project-site` · **Depends on:** `foundation` · **Build order:** #1 (first role)

Project/Site is the **source of physical truth.** It owns the Unit Twin's construction reality; everything downstream — sales changeability, QA readiness, handover — reads from what this role records. Get this role right and the whole "one truth for the unit" promise holds.

> Read alongside: [`unit-twin.md`](../../foundation/unit-twin.md), [`gates.md`](../../foundation/gates.md), [`handshakes.md`](../../foundation/handshakes.md) (H1, H5, H6), [`data-model.md`](../../foundation/data-model.md).

---

## Part 1 · Flow

### 1.1 What this role does

| Job | Outcome |
|---|---|
| Record physical progress | Update component/trade state per unit — native in HomeFlow, no external system required. |
| Drive changeability | Progress writes trigger the gate rule engine → Sales/CRM see live open/closing/closed. |
| Bulk progress control | Update whole towers/floors/work-packages with a preview of affected units + gate transitions before commit. |
| Unit exceptions | Override bulk state for a specific unit when reality differs, with reason + evidence. |
| Feasibility & holds | Assess CR feasibility (H5), approve/reject Change Window Holds that affect schedule. |
| Release drawings | Publish approved CR revisions to Site/QA/Procurement (H6); lock superseded. |

### 1.2 The one question this role answers
> *"What physical progress changed today, which units/gates are affected, and which holds or exceptions require my decision?"*

### 1.3 Gates: reads vs owns

| Gate | This role |
|---|---|
| Changeability gates | **Owns the inputs** (progress, planned dates) but never edits gate *state* directly — the rule engine derives it. Owns `ChangeGateRule` config (with Design). |
| Hard safety/statutory gates | Owns; never overridable by anyone. |
| Handover Physical gate | Feeds it via progress + utilities readiness. |
| Change Window Hold | **Approves/rejects** when construction is affected. |

### 1.4 States this role manipulates

- `UnitProgressState.state_code`: `not_started → in_progress → complete → verified`
- `ComponentDefinition` taxonomy (config)
- CR feasibility: `Feasible / Feasible-with-conditions / Rejected` (H5)
- Hold: `Requested → Project Review → Approved / Rejected → Active → Expired / Released`

### 1.5 Hard rules
1. Sales/CRM can **never** write progress, gate rules, or hard-gate state (enforced at API + RLS).
2. Progress is **evidence-first** where it feeds QA; component progress feeding gates comes from mapped trade events, never overall %.
3. Every progress write records source + timestamp + actor; stale data past policy flips consumers to `Verification Required`.
4. Reopening a previously closed gate requires an authorized physical correction with reason + audit.
5. Bulk updates must preview affected units/gates **before** commit.

---

## Part 2 · Data Flow

### 2.1 Twin surface

| Twin layer | Access |
|---|---|
| Unit construction / component progress | **write** |
| Unit spec baseline / as-built | write (with Design) |
| Changeability gates | read (derived); owns rule config |
| QA evidence | read (QA writes) |
| Home Passport | write (equipment/finish as installed) |

Writes nothing to Customer Twin.

### 2.2 Entities owned

- `UnitProgressState` ([`unit-twin.md`](../../foundation/unit-twin.md) §2.3)
- `ComponentDefinition` (config taxonomy of buildable components)
- `ChangeGateRule` ([`gates.md`](../../foundation/gates.md) A.2) — co-owned with Design
- `AsBuiltRevision` (release) — co-owned with Design
- `BulkProgressBatch` — a bulk update operation:

| field | type | req | notes |
|---|---|---|---|
| `id` | uuid | ✔ | |
| `project_id` | ref<Project> | ✔ | |
| `scope` | json | ✔ | `{ node_ids[], work_package, component_id }` — tower/floor/zone selection. |
| `target_state` | enum | ✔ | The `state_code` to apply. |
| `preview` | json | ✔ | Affected units + projected gate transitions (computed before commit). |
| `unit_exceptions` | json | | Units excluded/overridden in this batch. |
| `status` | enum{ draft \| previewed \| committed } | ✔ | |
| `committed_by` / `committed_at` | ref/ts | | |
| `reason_code` | string | ✔ | |

### 2.3 APIs (illustrative — follow [`architecture.md`](../../foundation/architecture.md) §4)

```
# Progress
GET  /units/{id}/progress                          → component states + freshness
PUT  /units/{id}/progress/{component_id}            → set state_code (+ evidence)  [project-site only]
POST /units/{id}/progress/exception                 → unit-level override (reason, source, evidence)

# Bulk
POST /projects/{id}/progress/bulk/preview           → returns affected units + gate transitions (no write)
POST /projects/{id}/progress/bulk/commit            → applies batch, re-evaluates gates, publishes H1

# Gate rules (config)
GET/POST/PUT /projects/{id}/change-gate-rules       → ChangeGateRule CRUD  [project-site + design]

# Change requests (H5/H6)
GET  /change-requests?assigned=feasibility          → CR feasibility queue
POST /change-requests/{id}/feasibility              → Feasible|Conditional|Rejected + dependencies
POST /change-requests/{id}/release                   → release AsBuiltRevision to Site/QA/Procurement

# Holds
GET  /change-window-holds?status=project_review     → holds needing my decision
POST /change-window-holds/{id}/approve | /reject     → decision (+ schedule impact)
```

### 2.4 Handshakes

| id | Direction | This role's part |
|---|---|---|
| **H1** | → sales/crm-rm | **Emits.** Progress write / bulk commit re-evaluates gates and publishes read-only changeability. Emits `unit.progress.updated`, `unit.gate.changed`. |
| **H5** | ← sales/crm-rm | **Receives.** CR feasibility request → assess with dependencies. |
| **H6** | → crm-rm | **Emits.** Released CR drawing + schedule impact; publishes `AsBuiltRevision`; locks superseded. |
| Hold approval | ← sales | **Receives.** Approve/reject holds affecting planned activity. |

### 2.5 Events emitted
`unit.progress.updated` · `unit.progress.bulk_applied` · `unit.exception.recorded` · `unit.progress.corrected` · `unit.progress.published` · `unit.freshness.breached` · `unit.gate.*` (via engine) · `cr.feasibility.assessed` · `cr.released` · `hold.approved` · `hold.rejected`

### 2.6 Rule-engine interaction
On every progress commit, the gate engine ([`gates.md`](../../foundation/gates.md) A.3) recomputes affected `UnitChangeGate` rows and flags affected prospects/CRs. Project/Site does **not** compute gates itself — it produces the inputs and consumes the preview.

### 2.7 Customer-facing progress projection (feeds T1)
Progress written here also feeds the **owner "Build My Home" tracker** ([`customer-transparency.md`](../../foundation/customer-transparency.md) T1). Project/Site does not build the customer view — it just keeps `UnitProgressState` accurate and marks which milestone photos are share-worthy. The mapping from fine-grained components → coarse **customer stages** (`Foundation → Structure → MEP & Walls → Finishing → Ready`) is config (`CustomerStageMap` in Policy Studio); a stage advances to the customer **only** when its mapped components reach `complete/verified`, and only `crm-rm`-approved photos/captions cross H10. Raw component %, planned dates, vendor, cost, and snags never reach the customer.

**Photo publish field:** `UnitProgressState`/`QAEvidence` photos carry `customer_shareable: bool` (default false) so Site can flag which milestone images are candidates for the customer tracker; final approval is `crm-rm`'s via H10.

---

## Part 3 · UI/UX

Applies [`design-language.md`](../../foundation/design-language.md) — **workspace skin** (dense but warm). Left rail = site queues; main = work area; right = the unit/twin in context.

### 3.1 Screens

**A · Unit Progress Control** (the primary screen — spec §30 "Project > Unit Progress Control")
- Hierarchy tree filter: Project → Phase/Tower/Block → Floor/Zone → Unit.
- Grid of units with component progress chips (warm status colors + icons).
- **Bulk update flow:** select scope → choose component + target state → **preview panel** shows affected units and projected gate transitions (OPEN→CONDITIONAL etc. as `GateChip` diffs) → commit with reason. Nothing writes before preview.
- Per-unit **exception** action: override one unit, capture reason + evidence photo, source/timestamp auto-stamped.
- Freshness indicator per unit; stale units visibly flagged.

**B · Unit 360 · Construction tab**
- Component/trade progress with actual dates, next planned event, evidence photos.
- Read-only changeability matrix (mirrors what Sales sees) so site understands downstream impact of their update.
- As-built revision history; released vs superseded clearly marked.

**C · CR Feasibility Queue** (H5)
- `ActionCard` list of CRs awaiting feasibility, ranked by desired date + schedule risk.
- Feasibility form: Feasible / Feasible-with-conditions / Rejected + dependency checklist (structural, MEP, statutory, waterproofing, fire/life-safety) + schedule impact.
- On approve → release drawing action (H6).

**D · Change Window Holds** (approval)
- Pending holds with planned-activity conflict highlighted; approve/reject with schedule impact; auto-expiry visible.

**E · Gate Rule Studio** (config, co-owned with Design)
- Map component/trade events → gate states; hard/soft classification; customer-facing explanation; effective dates. (Feeds Policy Studio.)

### 3.2 Homely touches (not decoration)
- Progress is **photo-forward** — the site's own milestone photos sit next to the status, so an update feels like "look what we built," not a form.
- Warm empty states ("No units need your attention today — everything's on track 🌱").
- Bulk preview uses gentle motion to show gates shifting, making consequence tangible before commit.

### 3.3 Key interactions
- One component update = one visible downstream effect (Sales sees it) — no duplicate entry. (§33 test)
- Bulk 40-unit update always previews + allows unit exception. (§30 test)
- Site can never see or edit customer/financial data — RLS + UI hide it entirely.

---

## Part 4 · Acceptance tests (role-scoped)

1. A single component update on one unit is visible on Sales & CRM views with no duplicate entry. (§33)
2. Marking `mep-first-fix = in_progress` moves mapped electrical gates by rule, no Sales edit. (#22)
3. Bulk update of 40 units previews affected units/gates and allows an authorized unit-level exception. (#28)
4. Two units at different progress show the same category `OPEN` vs `EXCEPTION_ONLY`. (#20)
5. Stale progress flips Sales/CRM to `Verification Required`. (§30)
6. Every progress correction records actor, timestamp, prior value, new value, reason. (§33)
7. Sales/CRM cannot edit progress or technical gates through any path. (#21)
8. A `HARD_CLOSED` structural gate cannot be reopened by ordinary override. (#27)
9. Released CR revision reaches Site/QA/Procurement; superseded is locked. (#18)
