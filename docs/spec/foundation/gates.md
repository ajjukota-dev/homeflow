# Foundation · Gates

Two gate systems, one principle: **truth derived from evidence, changed only by authority.**

1. **Changeability gates** — per-category, per-unit; govern whether a customisation is still possible. Derived from live unit physics.
2. **Handover gates** — per-booking; govern whether keys can be issued. Hard gates need named-authority override.

Sales/CRM **read** gates. They never edit them.

---

## PART A — Changeability gates

### A.1 The five states

| State | Meaning | Sales/CRM treatment |
|---|---|---|
| `OPEN` | Normally executable without rework if technically feasible. | Show as available; customer may shortlist on this capability. |
| `CLOSING` | Still open, but a known event will close it soon. | Show expected closure date/event + remaining window. |
| `CONDITIONAL` | Possible, but adds technical/procurement/cost/schedule conditions. | Show conditions; no promise until feasibility/quote approved. |
| `EXCEPTION_ONLY` | Normal window closed; needs rework or senior approval. | May be requested; flag as exception with likely cost/time impact. |
| `HARD_CLOSED` | Not permissible — structural, statutory, fire/life-safety, sanctioned-plan. | Do not offer. Explain reason category. **Never** reopened via Sales/CRM/ordinary override. |

Ordering (increasing restriction): `OPEN < CLOSING < CONDITIONAL < EXCEPTION_ONLY < HARD_CLOSED`.

### A.2 Objects

**ChangeCategory** — configurable unit of changeability.

| field | type | req | notes |
|---|---|---|---|
| `id` | uuid | ✔ | |
| `project_applicability` | json | ✔ | Which projects/product types. |
| `room_trade_system` | string | ✔ | e.g. Kitchen / Electrical / Flooring. |
| `customer_label` | string | ✔ | Customer-facing name. |
| `customer_visible` | bool | ✔ | **Canonical flag** (default false). If true, this category's gate is projected to the buyer as a personalisation window ([`customer-transparency.md`](customer-transparency.md) T3). Config in Policy Studio. All references use `ChangeCategory.customer_visible` — never a nested path. |
| `technical_owner_dept` | enum{ project \| design \| procurement } | ✔ | |
| `default_policy` | json | | Default hard/soft, exception authority. |

**ChangeGateRule** — maps a physical/procurement event to a resulting state.

| field | type | req | notes |
|---|---|---|---|
| `id` | uuid | ✔ | |
| `category_id` | ref<ChangeCategory> | ✔ | |
| `trigger_component_id` | ref<ComponentDefinition> | ✔ | The component/event watched. |
| `condition` | json | ✔ | e.g. `state_code >= in_progress`. |
| `resulting_state` | enum{ OPEN\|CLOSING\|CONDITIONAL\|EXCEPTION_ONLY\|HARD_CLOSED } | ✔ | |
| `classification` | enum{ soft \| hard } | ✔ | Hard = safety/statutory, never overridable. |
| `exception_authority_role` | string | | Who may allow an exception. |
| `effective_from` / `effective_to` | date | ✔/– | Effective-dated policy. |

**UnitChangeGate** — the current derived state per unit per category. Schema in [`unit-twin.md`](unit-twin.md) §2.4.

### A.3 Rule engine

The engine re-evaluates `UnitChangeGate` whenever any of these change:

- `UnitProgressState` (component progress)
- planned activity date / `expected_next_at`
- procurement status (PO released, material ordered)
- an approved CR variation
- a `ChangeGateRule` policy edit

**Execution model:**

- **Event-driven** where a source triggers it (progress write, PO event, CR approval).
- **Scheduled reconciliation** otherwise, plus stale-state detection.
- Gates are derived from **mapped component/trade events — never from overall construction %.**
- On any transition, log previous state, new state, source event, `last_evaluated_at`, and the affected prospects/CRs.
- Moving from a less to more restrictive state flags affected active workflows (prospects with that Must-Have, pending CRs, pending quotes).

**Freshness:** if underlying progress is stale beyond the project's policy threshold, the gate's `freshness_status` becomes `verification_required`, and Sales/CRM see **Verification Required** instead of a precise open/closed promise.

### A.4 Illustrative derivations (configurable, not hard-coded)

| Physical/procurement event | Illustrative gate result |
|---|---|
| MEP first-fix not started | Electrical/plumbing relocation = `OPEN` |
| MEP first-fix commenced | Relevant MEP changes = `CLOSING` / `CONDITIONAL` |
| MEP first-fix complete / wall closed | MEP relocation = `EXCEPTION_ONLY` (or `HARD_CLOSED` by policy) |
| Flooring PO not released | Flooring selection = `OPEN` |
| Flooring PO released | Flooring selection = `CONDITIONAL` |
| Flooring installed | Flooring replacement = `EXCEPTION_ONLY` |
| Structural element cast / stage passed | Structural alteration = `HARD_CLOSED` |
| CR approved & released | Affected config becomes current revision; competing rules re-evaluate |

### A.5 Changeability score
Derived 0–100 per unit for sales inventory. **Always** decomposable into the underlying gate states (a Must-Have that is `HARD_CLOSED` materially reduces it, explicitly explained). Cached with `computed_at`; never a source of truth.

### A.6 Change Window Hold

A time-boxed, Project-approved pause that keeps a `CLOSING` gate open for a serious prospect. Full workflow lives in `roles/sales/spec.md`; the invariants:

- Must specify Unit, gate/category, prospect/opportunity, requested duration, construction impact, approver.
- **Auto-expires** and releases. Project approval mandatory if planned execution changes.
- Sales cannot create a binding hold unilaterally.
- Configurable: max duration, concurrent holds, value/role thresholds, blackout activities.
- After expiry it can no longer block progress. (Acceptance test #26, §30.)

### A.7 Authority (who owns what)

| Role | Authority over changeability |
|---|---|
| Project/Construction | Own physical progress + planned dates; approve schedule-impacting holds. |
| Design/Engineering | Own technical rules, hard constraints, feasibility. |
| Procurement | PO/order/material status that restricts changeability. |
| Sales | **Read** only; capture needs, compare units, request holds. |
| CRM/CX | Raise/manage booked-customer CRs, comms. **No physical-state editing.** |
| Commercial/Finance | Variation pricing, waiver authority, payment gate. |
| QA | Inspection/verification states. |
| Management/Named Authority | Configured exception overrides — **cannot** override hard safety/statutory gates. |

**Enforcement:** no Sales/CRM API or UI path may mutate `UnitProgressState`, `ChangeGateRule`, or a hard-gate state. (Acceptance tests #21, #27, §30.)

---

## PART B — Handover gates

A handover is a **gated readiness event**, not an appointment. Keys issue only when physical + customer + hard gates pass. Jointly evaluated by `qa` (physical/QA) and `crm-rm` (finance/legal/registration/commitments).

### B.1 The gates

| Gate | Illustrative mandatory conditions | Override |
|---|---|---|
| **Financial** | Required consideration received; TDS verified; approved waivers posted; no unapproved dues. | Authority-controlled only |
| **Legal** | Executed agreement / required legal approvals complete. | Normally no |
| **Registration** | Registration complete or policy-approved exception. | Authority-controlled |
| **Physical** | Construction readiness threshold met; utilities available. | **No** for safety-critical items |
| **Quality** | QA approved; zero critical snags; minor snags within policy. | Limited |
| **Commitments** | Critical customer commitments closed or explicitly accepted. | Authority-controlled |
| **Customer** | Appointment, identity, nominees/representatives, orientation ready. | Operational |
| **FM/Community** | Access, meters, keys, manuals, emergency contacts, onboarding ready. | Operational |

### B.2 Hard vs soft

- **Hard gates** (financial, legal, registration, critical-snag, safety-physical) block handover. Passing requires all conditions met **or** a named-authority override with recorded reason + evidence.
- **Safety/statutory** conditions are **never** overridable by anyone.
- **Soft gates** (customer, FM) are operational — surfaced, not blocking.

### B.3 HandoverGate object

| field | type | req | notes |
|---|---|---|---|
| `id` | uuid | ✔ | |
| `booking_id` | ref<Booking> | ✔ | |
| `gate_type` | enum{ financial\|legal\|registration\|physical\|quality\|commitments\|customer\|fm } | ✔ | |
| `classification` | enum{ hard \| soft } | ✔ | |
| `state` | enum{ open \| passed \| overridden } | ✔ | |
| `blockers` | json | ✔ | Explainable list of unmet conditions. |
| `override_authority_id` | ref<User> | | Set only on override. |
| `override_reason` | string | | Required if overridden. |
| `override_evidence_ids` | ref[]<file> | | |
| `evaluated_at` | timestamp | ✔ | |

**Handover Readiness Score** = weighted physical readiness + customer readiness + mandatory gate status. Explainable. Predicted handover date + confidence derived from open blockers.

> **Two distinct objects — do not conflate.** `HandoverGate.state` (`open/passed/overridden`) is **per gate** (there are up to 8 per booking). The booking's overall **`Handover` lifecycle status** (`Not Eligible → At Risk → Eligible → Appointment Booked → In Progress → Completed → Reopened`, Appendix A) is **per booking**, derived from all its gates. `qa` transitions the booking-level status ([`roles/qa/spec.md`](../roles/qa/spec.md)); the gate rows here feed it.

### B.4 Override rule
No hard gate passes to `overridden` without `override_authority_id`, `override_reason`, and evidence — all logged immutably. Safety/statutory conditions reject override outright. (Foundation acceptance test #5.)

---

## Key behaviours (acceptance-testable)

1. Same change category is `OPEN` for one unit and `EXCEPTION_ONLY` for another based purely on physics. (§30)
2. A mapped construction event auto-recalculates gates and records the source event. (#22)
3. Stale data → `Verification Required`. (§30)
4. `HARD_CLOSED` cannot be reopened by ordinary override. (#27)
5. A hard handover gate cannot be bypassed without configured authority + audit reason. (#5)
6. A Change Window Hold auto-expires and stops blocking progress. (#26)
