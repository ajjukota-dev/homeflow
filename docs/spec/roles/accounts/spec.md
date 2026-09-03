# Role · Accounts / Collections

**Module id:** `accounts` · **Depends on:** `foundation`, `crm-rm` · **Build order:** #4 (parallel-eligible with `legal`, `qa`)

Accounts owns the money truth: it turns milestones into demands, reconciles receipts, and — critically — **separates "outstanding" into what is genuinely at risk vs merely due vs stuck in a bank vs an empty promise.** Its job is to make *every rupee leak visible* and to forecast project cash honestly, with immutable snapshots. It is the source of every finance-owned amount; CRM may only nudge PTP signals.

> Read alongside: [`customer-twin.md`](../../foundation/customer-twin.md) (financial behaviour), [`handshakes.md`](../../foundation/handshakes.md) (H3, H7), [`customer-transparency.md`](../../foundation/customer-transparency.md) (T2), [`HOMEFLOW-OS.md`](../../HOMEFLOW-OS.md) §8.3/§8.4/§12/§31.

---

## Part 1 · Flow

### 1.1 What this role does

| Job | Outcome |
|---|---|
| Generate demands | Milestone-linked demands on the Booking (from H3 payment plan + construction triggers). |
| Reconcile receipts | Post/verify receipts, TDS, reversals; keep the ledger truth. |
| **Split true risk** | Classify every outstanding rupee: due / overdue / disputed / loan-dependent / PTP / true risk. |
| Manage loans | Track sanction, disbursement readiness, days-to-demand vs days-to-disbursement gaps. |
| Forecast cash | Project cash-flow with immutable month-start snapshots + revisions; actual-vs-forecast variance. |
| Protect margin | Track waivers/leakage; flag reconciliation exceptions. |
| Clear registration | Give financial clearance for pre-registration (H7). |

### 1.2 The one question this role answers
> *"What is due, truly at risk, disputed, or loan-dependent — and what cash is really coming this month?"*

### 1.3 Gates: reads vs owns

| Gate | This role |
|---|---|
| Handover **Financial** hard gate | **Owns the input** — required consideration received, TDS verified, no unapproved dues. |
| Pre-registration financial clearance (H7) | **Owns.** |
| Forecast overrides | **Owns** — with reason, actor, evidence. |

### 1.4 Hard rules
1. Amounts are **finance-owned**. CRM/others may not silently change them; CRM may update a PTP *signal* only.
2. **PTP is never Actual** until a reconciled receipt is posted.
3. **Loan disbursement is one canonical forecast line** — never double-counted with the milestone demand.
4. **Speculative future-sales inflows are never mixed** into the committed post-sales receivable forecast (scenario-only).
5. **Forecast snapshots are immutable.** A revision is a new version; month-start is never overwritten. History is never lost.
6. Every overdue amount carries a **structured reason code**.

### 1.5 States
- Demand: `scheduled → due → overdue → part_paid → settled | disputed | waived`.
- Receipt: `posted → reconciled | reversed`.
- LoanCase: `sanctioned → docs_pending → disbursement_scheduled → part_disbursed → fully_disbursed`.
- Financial Risk (customer/booking, derived): `low → watch → at_risk → disputed → default_legal`.

---

## Part 2 · Data Flow

### 2.1 Twin surface

| Twin | Access |
|---|---|
| Customer Twin · Financial behaviour | **write** (amounts, ageing, loan dependence, risk) |
| Customer Twin · other layers | read |
| Unit Twin | read (milestone events that trigger demands) |

### 2.2 Entities owned

**PaymentPlan** — the milestone schedule template a Booking references (`Booking.payment_plan_id`). Configurable per project/scheme in Policy Studio; the source every `Demand` is generated from.

| field | type | req | notes |
|---|---|---|---|
| `id` | uuid | ✔ | |
| `project_id` | ref<Project> | ✔ | |
| `name` | string | ✔ | e.g. "Construction-linked plan". |
| `basis` | enum{ construction_linked \| time_linked \| custom } | ✔ | |
| `milestones` | ref[]<PaymentPlanMilestone> | ✔ | Ordered. |

**PaymentPlanMilestone**

| field | type | req | notes |
|---|---|---|---|
| `id` | uuid | ✔ | |
| `plan_id` | ref<PaymentPlan> | ✔ | |
| `milestone_key` | string | ✔ | Stable key referenced by `Demand.milestone_key`. |
| `milestone_label` | string | ✔ | Customer-safe label (feeds T2). |
| `construction_trigger_event` | string | | The unit event that makes it due (e.g. `slab_cast`); null for time-linked. |
| `sequence` | int | ✔ | |
| `pct_of_consideration` | decimal | | Or fixed `amount`. |
| `amount` | money | | If not %-based. |
| `due_offset_days` | int | | For time-linked plans. |

> On H3, `accounts` materializes one `Demand` per milestone from the Booking's plan.

**Demand**

| field | type | req | notes |
|---|---|---|---|
| `id` | uuid | ✔ | |
| `booking_id` / `project_id` | ref | ✔ | project derived. |
| `milestone_key` | string | ✔ | Links to payment plan milestone. |
| `milestone_label` | string | ✔ | **Customer-safe label** (feeds T2 "why now"). |
| `construction_trigger_event` | string | | The unit event that made it due (e.g. `slab_cast`). |
| `amount` | money | ✔ | |
| `due_date` | date | ✔ | |
| `status` | enum{ scheduled\|due\|overdue\|part_paid\|settled\|disputed\|waived } | ✔ | |
| `overdue_reason_code` | string | | Mandatory once overdue. |

**Receipt** — `id`, `booking_id`, `demand_id?`, `amount`, `mode`, `received_at`, `tds_amount`, `status{ posted\|reconciled\|reversed }`, `reconciliation_exception?`.

**LoanCase** — `id`, `booking_id`, `lender`, `sanctioned_amount`, `disbursed_amount`, `available_balance`, `next_expected_release_date`, `missing_docs[]`, `days_to_demand`, `days_to_disbursement`, `risk_score`, `status`.

**PromiseToPay** — links to a `Commitment` (customer→pranava) but holds finance fields: `expected_date`, `expected_amount`, `confidence`, `converted_receipt_id?`. (CRM sets the signal; accounts owns conversion.)

**ForecastSnapshot** — `id`, `project_id`, `as_of_date`, `horizon`, `locked` bool, `created_by`, `created_at`. **Immutable once locked.**

**CollectionForecastLine** — the drill-down unit:

| field | type | req | notes |
|---|---|---|---|
| `id` | uuid | ✔ | |
| `snapshot_id` | ref<ForecastSnapshot> | ✔ | |
| `booking_id` / `unit_id` / `project_id` | ref | ✔ | full drill-down. |
| `source_type` | enum{ contractual_due \| overdue_recovery \| promise_to_pay \| loan_disbursement \| registration_final \| approved_reschedule \| manual_override } | ✔ | See §12 source table. |
| `expected_date` | date | ✔ | |
| `expected_amount` | money | ✔ | |
| `probability` | decimal | ✔ | Rule-based (ageing, behaviour, PTP quality, bank stage, docs, dispute, milestone readiness, recent interaction). |
| `owner_id` | ref<User> | | |
| `blocker` | string | | |
| `next_action` | ref<Action> | | |

**ForecastScenario** / **ForecastAssumption** — `Base / Conservative / Stretch` with transparent assumptions; **never overwrite baseline**; future-sales cash only visible in scenario mode.

### 2.3 True-risk classification (the core algorithm)

Every open amount lands in exactly one bucket (§8.3):

```
for each open Demand / expected inflow:
  if disputed              → DISPUTED
  elif loan-dependent      → LOAN_DEPENDENT      (mirror to LoanCase readiness)
  elif has active PTP      → PROMISE_TO_PAY      (expected date + confidence)
  elif past due_date       → OVERDUE             (+ reason code)  → subset flagged TRUE_RISK
  else                     → DUE
TRUE_RISK = overdue where recovery probability < policy threshold AND no active PTP/loan path
```

`outstanding` (raw total) is shown **separately** from these buckets — never conflated. (Acceptance #7.)

### 2.4 Project cash-flow math (every period, §31.4)

```
opening_outstanding
+ demands_due_in_period
+ overdue_at_start
→ expected_contractual_collection
+ expected_overdue_recovery
+ expected_loan_disbursement        (one canonical line, no double count)
+ expected_rescheduled_amount
= total_expected_receipts
− actual_receipts
= forecast_variance
→ closing_expected_outstanding  (+ confidence)
```
Project total = Σ its forecast lines. Portfolio total = Σ authorized projects (explicit elimination rules).

### 2.5 APIs

```
# Demands & receipts
GET  /bookings/{id}/demands
POST /demands/{id}/receipt                           → post receipt (+ TDS)
POST /receipts/{id}/reconcile | /reverse

# True-risk & collections
GET  /projects/{id}/collections?view=true_risk       → bucketed outstanding
POST /demands/{id}/overdue-reason                     → structured reason code
GET  /projects/{id}/collections/heatmap              → by RM/ageing/risk

# Loans
GET  /bookings/{id}/loan                              → LoanCase + readiness gaps
POST /loan-cases/{id}/update                          → disbursement/docs status

# Forecast
POST /projects/{id}/forecast/snapshot                → lock immutable month-start snapshot
GET  /projects/{id}/forecast?as_of=&horizon=         → lines + drill-down
POST /forecast-lines/{id}/override                   → manual override (reason, actor, evidence)
GET  /projects/{id}/forecast/scenarios               → Base/Conservative/Stretch
GET  /projects/{id}/cashflow?period=                 → the §31.4 math, actual vs forecast vs revised

# Registration clearance (H7)
GET  /bookings/{id}/financial-clearance              → cleared? + outstanding breakdown
```

### 2.6 Handshakes

| id | Direction | This role's part |
|---|---|---|
| **H3** | ← crm-rm | **Receives.** Funding setup → materialize demand schedule, open LoanCase, seed forecast lines. |
| **H7** | → legal/crm-rm | **Emits.** Financial clearance for registration (cleared? + breakdown). |
| (feeds) | → customer via crm-rm/H10 | Publishes the **T2** approved payment view (schedule, why-now, receipts, paid/remaining). |
| (feeds) | → management H11 | Cash exceptions (true-risk spikes, forecast slippage). |

### 2.7 Events emitted
`demand.raised` · `receipt.posted` · `receipt.reversed` · `waiver.applied` · `tds.verified` · `forecast.created` · `forecast.revised` · `forecast.snapshot_locked` · `forecast.probability_changed` · `forecast.expected_date_changed` · `forecast.scenario_changed` · `registration.financial_clearance.evaluated`

### 2.8 Probability weighting
Rule-based first (ageing, payment behaviour, PTP quality, bank disbursement stage, missing docs, dispute status, milestone readiness, recent interaction). AI may refine later but **cannot hide the drivers**. Finance owns overrides.

---

## Part 3 · UI/UX

Applies [`design-language.md`](../../foundation/design-language.md) — **workspace skin**; money is presented calmly and clearly (warm, not alarming), using `MoneyFigure` (tabular mono, ₹ lakh/crore grouping, risk-tinted).

### 3.1 Screens

**A · Collections Workbench (True-Risk view)**
- Outstanding split into the buckets as distinct warm columns (Due / Overdue / Disputed / Loan-dependent / PTP / **True Risk**) — never one scary number.
- Per row: customer + unit, amount, ageing, reason code, owner, next action. One-click recovery action → creates an Action.
- Portfolio heatmap by project / RM / ageing / risk.

**B · Project Cash-Flow Planner** (§31)
- Project cards + portfolio total; period selector (Prev Month Actual · Current Plan vs Actual-to-Date · Next Month · Next 90 · Quarter · Custom).
- **Five-view compare** for current month: Plan · Month-start Forecast · Latest Forecast · Actual-to-date · Projected EOM.
- Receivables **waterfall**: contractual demands, overdue recoveries, PTP, expected loan disbursements, registration/final, approved reschedules.
- Actual vs Forecast vs Revised with variance + confidence; every figure **drills to Booking/Unit**.

**C · Loans**
- Per booking: sanctioned / disbursed / available / next demand; expected release date + missing docs; **days-to-demand vs days-to-disbursement gap** with a pre-overdue alert.

**D · Forecast Snapshots & Scenarios**
- Locked month-start snapshot (immutable) alongside latest; variance vs both. Scenarios Base/Conservative/Stretch with visible assumptions; future-sales cash clearly quarantined to scenario mode.

### 3.2 Homely touches
- Money framed as clarity and reassurance, not red walls — overdue uses the softened `--hf-at-risk` amber with a clear "why" and a helpful next step, not an aggressive alert.
- The customer-facing T2 preview (approved here, published by CRM) explains each demand in plain, fair language ("Your slab is cast — this milestone is now due").

### 3.3 Confidentiality
Risk scores, PTP confidence, disputes framing, and internal notes never cross to the customer — only the approved T2 subset does, via CRM/H10.

---

## Part 4 · Acceptance tests (role-scoped)

1. Every overdue collection has a structured reason and a next action. (#7)
2. Outstanding is split into due/overdue/disputed/loan-dependent/PTP/true-risk — never one number. (§8.3)
3. A receipt posted against a Booking appears under the correct Project without the user selecting Project. (#... §31)
4. Month-start forecast stays unchanged after a mid-month revision; latest forecast changes; variance computed vs both. (#13, §31)
5. A partially disbursed loan updates expected receipt timing without double-counting the demand. (§31)
6. A PTP changes forecast confidence/date by rule but never becomes Actual until a reconciled receipt. (§31)
7. Future-sales scenario cash is visible only in scenario mode, never mixed into committed forecast. (§31)
8. Every forecast value drills to contributing Booking/Unit with source, expected date, probability, last update. (#12)
9. Financial clearance (H7) correctly gates pre-registration with an explainable outstanding breakdown. (§8.6)
