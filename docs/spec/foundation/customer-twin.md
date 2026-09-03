# Foundation · ★ Customer Digital Twin

The relationship record for a family / entity — money behaviour, documents, commitments, communication, sentiment, consent. The second headline noun. Written by `crm-rm`; read by the roles that serve the customer.

> **Composed view, not a table.** It is the `Customer` master row ([`data-model.md`](data-model.md) §2.5) plus their Bookings and the sub-entities below, scoped to one `customer_id`.

> **RLS note.** `Customer` is not project-scoped, but every booking-linked sub-entity here (`Commitment`, `Communication`, `ExperienceSignal`, `FinancialBehaviour`) MUST carry a derived `project_id` (from `booking_id`) so it is covered by project row-level security — per the cross-cutting rule in [`data-model.md`](data-model.md) §5. A customer-only record with no booking context is not project-scoped and is masked accordingly.

---

## 1. Twin surface — who writes, who reads

| Layer | Written by | Read by | Never edited by |
|---|---|---|---|
| Profile & consent | crm-rm | all internal | others |
| Bookings (incl. historical/cancelled) | sales (create), crm-rm | accounts, legal, mgmt | — |
| Financial behaviour | **accounts** (amounts), crm-rm (promise signals) | crm-rm, mgmt, customer | crm cannot change finance-owned amounts |
| Documents | legal, crm-rm | customer (own only), mgmt | — |
| Commitments (Promise Ledger) | crm-rm (customer-facing), any owner (internal) | customer (customer-facing only), mgmt | — |
| Communications | all internal (logged) | mgmt; customer sees only customer-facing | — |
| Experience signals | crm-rm, derived | mgmt | — |

**Split rule:** CRM may update **promise signals** (PTP date/confidence) but MUST NOT silently change **finance-owned amounts** — those belong to `accounts`. (§12.)

**Confidentiality rule:** internal notes, staff performance, vendor disputes, and unapproved forecasts are **never** exposed on the customer view. Enforced by a `visibility` field on every customer-linked record. (Foundation acceptance test #14.)

---

## 2. Layers & sub-entities

### 2.1 Profile
From `Customer` master row: type, name, contacts, language, preferred channels, NRI/resident flag, KYC status, consent. See [`data-model.md`](data-model.md) §2.5.

**RelationshipHistory**: chronological relationship events (first contact, RM changes, escalations, milestones) — for the "summarize this customer before I call" copilot.

### 2.2 Bookings
The customer's Booking rows (current + historical/cancelled/transferred) via `BookingApplicant`. Gives the twin its unit relationships without duplicating unit data.

### 2.3 Financial behaviour

**FinancialBehaviour** (derived + event-sourced summary per customer)

| field | type | writes | notes |
|---|---|---|---|
| `customer_id` | ref<Customer> | | |
| `total_demanded` / `total_received` / `total_outstanding` | money | accounts | |
| `overdue_amount` | money | derived | |
| `overdue_history` | json | derived | Ageing buckets over time. |
| `loan_dependence` | enum{ none \| partial \| full } | accounts | |
| `dispute_flags` | json | accounts | |
| `tds_status` | json | accounts | |
| `behaviour_risk` | enum{ low \| watch \| at_risk \| default } | derived | Explainable — drivers attached. |

> Actual amounts here are **owned by `accounts`**; the twin surfaces them read-only to CRM and (approved subset) to the customer.

### 2.4 Documents
KYC, agreements, loan docs, registration docs, missing/discrepant items — as `GeneratedDocument` refs (owned by `legal`, see `roles/legal/spec.md`). The twin shows status per document: `Required → Requested → Received → Validating → Accepted → Rejected → Superseded → Expired`.

### 2.5 Commitments — Promise Ledger

Every promise by Pranava and every customer PTP. Permanent.

**Commitment**

| field | type | req | writes | notes |
|---|---|---|---|---|
| `id` | uuid | ✔ | | |
| `booking_id` | ref<Booking> | ✔ | | Attaches to the Booking (survives ownership change). |
| `customer_id` | ref<Customer> | ✔ | derived | |
| `direction` | enum{ pranava_to_customer \| customer_to_pranava } | ✔ | | PTP = customer_to_pranava. |
| `type` | enum{ delivery \| financial \| documentation \| service \| schedule } | ✔ | | |
| `description` | string | ✔ | crm | |
| `owner_id` | ref<User> | ✔ | | Accountable person. |
| `beneficiary` | string | ✔ | | |
| `due_date` | date | ✔ | | |
| `financial_impact` | money | | | |
| `visibility` | enum{ internal \| customer_facing } | ✔ | | Governs portal exposure. |
| `status` | enum{ draft \| approved \| active \| at_risk \| fulfilled \| breached \| waived_cancelled } | ✔ | | |
| `confidence` | decimal | | derived | Based on dependencies. |
| `evidence_ids` | ref[]<file> | | | Proof of fulfilment. |
| `source_communication_id` | ref<Communication> | | | For AI-detected promises. |

> Pre-breach alerts fire before `due_date` while recovery is possible. Broken-promise rate rolls up by team + root cause. (Module 8.11.)

### 2.6 Communications

**Communication**: `id`, `booking_id`, `customer_id`, `channel` enum{ call \| email \| whatsapp \| sms \| meeting \| notice }, `direction` enum{ inbound \| outbound }, `visibility` enum{ internal \| customer_facing }, `body`, `summary` (AI), `sentiment` enum{ positive \| neutral \| negative }, `extracted_open_items` json, `template_id`, `sent_by`, `sent_at`.

> Strict internal/customer-facing separation. Frequency guardrails prevent spam. Templates require approval + version control. (Module 8.12.)

### 2.7 Experience signals

**ExperienceSignal**: `id`, `customer_id`, `booking_id`, `signal_type` enum{ csat \| nps \| sentiment \| complaint \| escalation \| referral }, `value`, `captured_at`, `trend` (derived). Feeds **Customer Health** score.

### 2.8 Consent
Structured privacy/marketing consent with per-purpose flags + timestamps. Gates outbound comms and data export.

---

## 3. Scores derived from this twin

| Score | Question | Drivers (top-3 shown) |
|---|---|---|
| **Customer / Booking Readiness** | Is the customer side ready? | payments, loan, KYC, legal, registration, commitments, scheduling |
| **Customer Health** | How healthy is the relationship? | sentiment, SLA, commitments, complaints, payment behaviour, comms pattern |
| **Financial Health** | How likely are collections on plan? | overdue, PTP, loan gaps, disputes, ageing, behavioural risk |

All are explainable (value, trend, top-3 drivers, confidence). Never a bare badge. Weights configurable in Policy Studio.

---

## 4. Lifecycle & permanence

| Phase | Twin state |
|---|---|
| **Pre-booking** | No Customer Twin required for a Unit to exist. Prospect personalisation needs may be captured (see `roles/sales`) without a full twin. |
| **Booking** | Sales creates Booking + applicants → on CRM acceptance the Customer Twin is fully instantiated and linked. |
| **Through lifecycle** | Financial behaviour, documents, commitments, comms, sentiment accrete on the twin, attached to the Booking. |
| **Cancellation/transfer** | The **Booking** closes; the Customer Twin retains full history including cancelled/transferred bookings. |
| **Post-handover** | Relationship continues — warranty, service, referral, advocacy. |

**Dedup/merge:** two customer records for the same family can be merged **without losing history** — bookings, comms, commitments re-point; the merge is audited. (§22.)

---

## 5. Key behaviours (acceptance-testable)

1. Every active booking resolves to exactly one current unit and one+ valid applicants/customers. (#1)
2. Customer-facing views never expose internal notes or unapproved assumptions — enforced by `visibility`. (#14)
3. Every customer-facing commitment has owner, due date, status, dependencies, evidence. (#6)
4. CRM can update a PTP signal but cannot silently alter a finance-owned amount. (§12)
5. Customer merge preserves all history and is auditable. (§22)
