# Foundation · ★ Handshakes — single source of truth

Every role-to-role handoff is defined **here, once.** Role files reference these by id; they never redefine the payload. If a role spec and this file disagree, **this file wins.**

A handshake is a controlled transfer of responsibility. Each has: a **trigger**, a **gate** that must pass, a **payload** (the data contract), the **events** emitted, the **receiving action** created, and the **failure/return path**.

---

## Handshake index

| id | From → To | What transfers |
|---|---|---|
| `H1` | project-site → sales/crm-rm | Live unit progress & changeability |
| `H2` | sales → crm-rm | Booking file (sales-to-CRM handover) |
| `H3` | crm-rm → accounts | Funding & demand setup |
| `H4` | crm-rm → legal | Document generation trigger |
| `H5` | crm-rm/sales → project-site/design | Change Request feasibility |
| `H6` | design/project-site → crm-rm | Released CR drawing + quote |
| `H7` | accounts → legal/crm-rm | Financial clearance for registration |
| `H8` | legal → crm-rm | Registration completion |
| `H9` | qa → crm-rm/handover | Unit readiness / handover eligibility |
| `H10` | crm-rm → customer | Approved customer-facing update |
| `H11` | any role → management | Escalation / exception surface |
| `H12` | qa/crm-rm → post-handover | Handover completion → warranty/passport |

General rules for **all** handshakes:
- The payload is transferred by reference to canonical entities (never a copy of twin data).
- Every handshake emits an event to [`event-log.md`](event-log.md) and creates a typed [`Action`](universal-action.md) for the receiver.
- A handshake that fails its gate returns to the sender with a **structured reason code**, never silently.
- `project_id` travels derived, never hand-entered.

---

## H1 · project-site → sales/crm-rm — Live unit truth
**The closed loop that makes changeability real.**

- **Trigger:** `project-site` writes/updates `UnitProgressState` (single or bulk), or a PO/procurement event fires.
- **Gate:** none blocks the *publish*; but if data is stale past policy, consumers see `Verification Required`.
- **Process:** progress write → gate rule engine re-evaluates `UnitChangeGate` ([`gates.md`](gates.md) A.3) → new state visible to Sales/CRM inventory → affected prospects/CRs flagged.
- **Payload (published, read-only to consumers):**
  ```
  { unit_id, project_id, changed_components[], gate_transitions[
      { category_id, previous_state, new_state, source_event,
        expected_close_at?, freshness_status } ],
    updated_by, updated_at }
  ```
- **Events:** `unit.progress.updated`, `unit.gate.changed` (per transition).
- **Receiving action:** for each affected active prospect/CR → `ai_recommendation`/`task` Action ("electrical Must-Have now Conditional on V104 — advise customer").
- **Invariant:** Sales/CRM receive read-only. No return path can mutate progress. (Acceptance #21, §33.)

---

## H2 · sales → crm-rm — Booking file handover
**CRM acceptance is a controlled quality gate.**

- **Trigger:** Sales submits a Booking (`Booking.status: draft → submitted`).
- **Gate:** **Completeness gate** — `Booking.completeness_score` must meet the project threshold; mandatory-document checklist (by project/product/customer type) satisfied; commercial approvals attached.
- **Payload:**
  ```
  { booking_id, unit_id, project_id,
    applicants[{ customer_id?, name, role, pan, kyc_doc_ids }],
    total_consideration, token_amount, payment_plan_id,
    commercial_approvals[], deviations[], source_channel,
    mandatory_docs[{ type, status, file_id }],
    completeness_score, sales_owner_id }
  ```
- **Accept path:** CRM accepts → `Booking.status: submitted → crm_accepted → active`; assign `rm_owner_id`; **instantiate the Customer Twin** ([`customer-twin.md`](customer-twin.md)); auto-generate onboarding Actions (welcome within 24h, KYC, payment schedule, doc checklist); start the Journey Instance.
- **Return path:** CRM returns with a **return reason code** (taxonomy) → `Booking.status → draft`; Action back to `sales_owner_id`; increments first-time-right / repeat-error analytics for that salesperson.
- **Events:** `booking.handover.submitted`, `booking.handover.accepted` | `booking.handover.returned`.
- **Invariant:** no Customer Twin exists until acceptance; the Unit Twin is untouched by this handshake.

---

## H3 · crm-rm → accounts — Funding & demand setup
- **Trigger:** Booking becomes `active` (from H2) or funding route changes.
- **Gate:** payment plan present; applicant financial profile captured.
- **Payload:** `{ booking_id, unit_id, project_id, total_consideration, payment_plan_id, loan_intent{ lender?, sanction_status }, applicants_financial[] }`.
- **Process:** `accounts` materializes the demand schedule (milestone-linked `Demand` rows), opens a `LoanCase` if loan-funded, seeds the collections forecast lines.
- **Events:** `funding.setup.created`, `demand.schedule.generated`.
- **Receiving action:** collections Actions per upcoming demand; loan-coordinator Action if disbursement readiness at risk.
- **Split rule:** amounts are **finance-owned** from here; CRM may only update PTP signals. (§12.)

---

## H4 · crm-rm → legal — Document generation trigger
- **Trigger:** a lifecycle point needs a document (AOS, Sale Deed, addendum, variation agreement, cancellation/transfer).
- **Gate:** **pre-generation validation** — mandatory applicant/commercial/unit fields present + consistent; commercial approval state valid; correct approved template exists for project/property/transaction. Block on configured mandatory failures.
- **Payload:** `{ booking_id, unit_id, project_id, document_family, transaction_type, applicants[], commercial_terms, payment_plan_id, approved_deviations[] }`.
- **Process:** Legal Document Factory freezes a **data snapshot**, generates the draft, runs validation, routes Generate → Validate → Legal approve → Customer approve → eSign → Archive. (Module 8.2 / §32.)
- **Events:** `document.generation.requested`, `document.generated`, `document.validation.failed`.
- **Return path:** validation failure returns with the failing field refs; user navigates to the **source record** to fix (never retype trusted values). (Acceptance #30.)

---

## H5 · crm-rm/sales → project-site/design — Change Request feasibility
- **Trigger:** a CR is raised (prospect pre-booking via Sales, or booked customer via CRM). **Gate state never blocks capture.**
- **Gate:** none on creation; routing depends on the live gate — `OPEN`→normal, `CONDITIONAL`→conditions, `EXCEPTION_ONLY`→exception approval, `HARD_CLOSED`→reject-with-reason (still recorded).
- **Payload:** `{ cr_id, booking_id?, opportunity_id?, unit_id, project_id, line_items[{ room, trade, category_id, intent, drawings[], priority, desired_date }], current_gate_snapshot[] }`.
- **Process:** Design/Project assess feasibility (`Feasible / Feasible-with-conditions / Rejected`) with dependencies (structural, MEP, statutory, waterproofing, fire/life-safety).
- **Events:** `cr.requested`, `cr.feasibility.assessed`.
- **Receiving action:** feasibility Action to design/project owner; on completion → H6.

---

## H6 · design/project-site → crm-rm — Released CR drawing + quote
- **Trigger:** CR feasibility done + costed + internally approved.
- **Gate:** internal approval matrix (by change type, value, margin, schedule impact) passed; **commercial closure before execution**.
- **Payload:** `{ cr_id, feasibility_result, conditions[], customer_quote{ price, tax, inclusions, exclusions, validity_date }, schedule_impact{ lead_time, handover_delay_days }, released_revision_id? }`.
- **Process:** CRM presents quote to customer → explicit acceptance captured → **payment gate** → only then execution released; a new `AsBuiltRevision` is released to Site/QA/Procurement; superseded drawings locked.
- **Events:** `cr.quoted`, `cr.customer_accepted`, `cr.payment_cleared`, `cr.released`, `cr.as_built_closed`.
- **Invariant:** no execution before feasibility + commercial approval + customer acceptance + payment gate. (Acceptance #17.)

---

## H7 · accounts → legal/crm-rm — Financial clearance for registration
- **Trigger:** pre-registration readiness check.
- **Gate:** required consideration received to the registration threshold; TDS verified; no unapproved dues; approved waivers posted.
- **Payload:** `{ booking_id, unit_id, project_id, cleared: bool, outstanding_breakdown{ due, overdue, disputed, loan_pending }, tds_status }`.
- **Events:** `registration.financial_clearance.evaluated`.
- **Feeds:** the Pre-Registration Readiness gate (combines finance + documents + legal/statutory + customer availability).

---

## H8 · legal → crm-rm — Registration completion
- **Trigger:** SRO execution completed.
- **Gate:** registered document received + validated.
- **Payload:** `{ booking_id, unit_id, project_id, sale_deed_doc_id, registered_copy_file_id, sro_reference, registered_at }`.
- **Process:** archived on the Booking; `Unit.sale_status → registered`; feeds Handover Registration gate ([`gates.md`](gates.md) B).
- **Events:** `registration.completed`.

---

## H9 · qa → crm-rm/handover — Unit readiness / handover eligibility
- **Trigger:** QA verification reaches readiness threshold; zero critical snags.
- **Gate:** **Physical + Quality** handover gates ([`gates.md`](gates.md) B) — QA approved, critical snags = 0, minor snags within policy, utilities available.
- **Payload:** `{ unit_id, booking_id, project_id, readiness_score, qa_status, open_snags[{ severity, id }], utilities_ready, evidence_ids[] }`.
- **Process:** contributes to Handover Readiness Score; when all hard gates pass → booking becomes handover-eligible; appointment workflow opens. Hard-gate inputs and their producers: **physical + quality** = `qa` (this handshake); **financial** = `accounts` (H7); **legal + registration** = `legal` (H8); **commitments** = `crm-rm` evaluates locally (it owns both the Promise Ledger and the handover convergence — no separate handshake; critical customer commitments must be `fulfilled` or explicitly accepted).
- **Events:** `unit.readiness.reached`, `handover.eligibility.reached` | `handover.blocked`.
- **Invariant:** eligibility requires **all** hard gates; override only via named authority ([`gates.md`](gates.md) B.4).

---

## H10 · crm-rm → customer — Approved customer-facing update
**The only path to the customer portal / outbound comms.**

- **Trigger:** an event worth surfacing (milestone, demand, document ready, registration, handover appointment, commitment update).
- **Gate:** **visibility filter** — only `visibility = customer_facing`, approved forecasts, approved milestones. Internal notes, vendor prices, staff performance, unapproved forecasts are stripped. Frequency guardrails + quiet hours respected.
- **Payload (to portal / comms):** `{ customer_id, booking_id, update_type, approved_content, milestone?, amount?, document_ref?, appointment?, cta? }`.
- **`update_type` values** (drives the Owner Transparency Surface — see [`customer-transparency.md`](customer-transparency.md)): `progress_stage_reached` (T1) · `payment_due` (T2) · `personalisation_window_changed` (T3) · `passport_item_added` (T4) · `document_ready` (T5) · `handover_window_updated` (T6) · plus generic `milestone`, `commitment_update`. Each carries **only** the approved-fields subset that `customer-transparency.md` defines for that feature; the filter strips every "Hidden" field.
- **Events:** `customer.update.published`, `customer.contact.sent`.
- **Invariant:** AI may draft but never auto-send consequential customer communication. (§13, Acceptance #14.)

---

## H11 · any role → management — Escalation / exception surface
- **Trigger:** SLA ladder L2+ ([`universal-action.md`](universal-action.md) §3), hard-gate override, stale-gate exception, forecast slippage, sentiment breach, high-value CR exception.
- **Gate:** threshold-based — only material exceptions reach management (no noise).
- **Payload = decision pack:** `{ what_happened, current_impact{ customer, rupee, schedule, reputation }, dependencies[], actions_taken[], owner, next_deadline, recommended_decision, evidence_ids[] }`.
- **Process:** surfaces as one of the Control Tower's five ranked interventions (customer/cash/handover/reputation/margin).
- **Events:** `escalation.created`, `escalation.upgraded`, `escalation.recovery_plan.created`, `escalation.closed`.

---

## H12 · qa/crm-rm → post-handover — Completion → warranty/passport
Consumer: the [`post-handover`](../roles/post-handover/spec.md) role (owns `WarrantyCase`, `DLPWindow`, `ServiceHistory`).
- **Trigger:** handover completed (keys issued, docs signed).
- **Gate:** handover checklist complete (keys, meters, manuals, warranties, signatures, photos).
- **Payload:** `{ unit_id, booking_id, project_id, handover_record_id, passport_items[], warranty_cases_seed[], dlp_start, dlp_end }`.
- **Process:** Home Passport finalized on the Unit; DLP/warranty window opens; 7/30/90-day check-in Actions scheduled; service history begins against the Unit **forever**.
- **Events:** `handover.completed`, `warranty.window.opened`.

---

## Handshake ⇄ journey stage map

| Journey stage ([`HOMEFLOW-OS.md`](../../HOMEFLOW-OS.md) §8) | Handshakes |
|---|---|
| 0 Pre-Sales | H1 |
| 1 Booking | H2 |
| 2 Funding | H3 |
| 3 Agreement | H4 |
| 4 Construction | H1, H5, H6 |
| 5 Collections | H3 (ongoing) |
| 6 Pre-Reg | H7 |
| 7 Registration | H8 |
| 8 Pre-Handover | H9 |
| 9 Handover | H9, H12 |
| 10 Post-Handover | H12 |
| (cross-cutting) | H10 (customer), H11 (management) |

---

## Key behaviours (acceptance-testable)

1. A booking cannot move to `crm_accepted` unless the H2 completeness gate passes. (#... , Module 8.1)
2. A returned booking carries a structured reason and re-opens a Sales Action. (Module 8.1)
3. No document generates when H4 mandatory data is missing; the error links to the source record. (#30)
4. No CR releases to Site before H6's feasibility + commercial + customer + payment gates. (#17)
5. Handover eligibility (H9) requires all hard gates; override needs named authority + reason. (#5)
6. Only `customer_facing` content crosses H10; AI never auto-sends. (#14, §13)
