# Role · Customer — My Pranava Home

**Module id:** `customer` · **Depends on:** `foundation`, `crm-rm`, `accounts`, `legal`, `qa`, `project-site` · **Build order:** #7

My Pranava Home is what the **home-buyer** opens. It is the warm, calm face of everything the internal roles do — a family spending crores should feel *cared for and informed*, never confused or chased. It shows **only approved, customer-facing** information, delivered through the H10 gate. This role **renders**; it never owns source truth.

> Read alongside: [`customer-transparency.md`](../../foundation/customer-transparency.md) (T1–T6 — the contract this role implements), [`handshakes.md`](../../foundation/handshakes.md) (H10), [`design-language.md`](../../foundation/design-language.md) (**customer skin**), [`HOMEFLOW-OS.md`](../../HOMEFLOW-OS.md) §13.

---

## Part 1 · Flow

### 1.1 What the customer does here

| Area | The buyer can |
|---|---|
| Journey | See their home's lifecycle timeline — achieved + next milestone + expected date. |
| My Home | See their unit, approved specs, **live construction progress with photos** (T1). |
| Payments | See schedule + **why each demand exists** (T2), receipts, outstanding, TDS guidance, pay securely. |
| Documents | See required/received/approved docs; download own; eSign. |
| Registration | See readiness, checklist, appointment, final documents. |
| Requests | Ask a question, raise a service request, **submit/approve customisations** (CRs), see quotes/drawings/status. |
| Personalisation | See remaining change windows — "kitchen open till ~March" (T3). |
| Commitments | See what Pranava promised them and current status. |
| Home Passport | After handover: manuals, warranties, product details, service history (T4). |
| Legal safety | RERA no., their registered docs, escrow assurance (T5). |
| Handover | See predicted keys window + their own to-dos (T6); confirm appointment. |

### 1.2 The one question this role answers
> *"What is happening with my home, and what do I need to do?"*

### 1.3 The render flow (functional steps)

```
function renderCustomerHome(customer_id, booking_id):
  # ALL data arrives pre-approved through H10 — this role never reads internal truth directly
  updates = subscribeH10(booking_id)          # only visibility=customer_facing, approved
  home = {
    journey:        approvedMilestones + nextExpected,
    progress:       T1(stages, approved_photos),          # never raw % / vendor / snags
    payments:       T2(schedule, why_now, receipts, paid/remaining, pay_link),
    documents:      ownAcceptedDocs + eSignPending,
    personalisation:T3(categories → friendly window text),
    commitments:    customerFacingCommitmentsOnly,
    passport:       T4(items) if handover_done,
    legal:          T5(rera_no, own_docs, escrow_note),
    handover:       T6(expected_window, my_todos)
  }
  # customer ACTIONS flow back inward as governed requests:
  onRaiseCR      → POST /change-requests (H5, routed to feasibility)
  onServiceReq   → creates Action for crm-rm / post-handover
  onPay          → secure payment link → receipt reconciled by accounts
  onESign        → document execution (legal)
  onApproveQuote → CR customer acceptance (H6)
```

### 1.4 Hard rules
1. **Read-only projection.** The portal never reads internal entities directly — only the approved H10 payload.
2. **Never shows:** internal notes, vendor prices, staff performance, raw internal %, unapproved forecasts, other units/customers, hard-gate blockers.
3. **No internal vocabulary** — no "gate", "SLA", "twin", "leakage". Warm plain language only.
4. Customer actions (CR, service, pay, eSign, approve) are **governed inward flows**, not direct writes to twins.
5. Stale source → soft "updating" state, never a false precise promise.

---

## Part 2 · Data Flow

### 2.1 Twin surface
**Read-only, filtered.** No write to any twin. Customer inputs create governed requests/Actions handled by owning roles.

### 2.2 Entities
This role owns almost no source entities — it owns **view/session state** and **customer-initiated requests** that hand off inward:
- **ServiceRequest** — `id, booking_id, customer_id, type, description, attachments, status, created_at` → becomes an Action for `crm-rm`/post-handover.
- **CustomerActionReceipt** — record of customer approvals (quote acceptance, eSign, appointment confirm) for audit.

All display data is fetched from the approved projections defined in [`customer-transparency.md`](../../foundation/customer-transparency.md).

### 2.3 APIs (customer-scoped; auth = this customer only)

```
GET  /me/home                                        → assembled T1–T6 approved view
GET  /me/journey                                     → milestone timeline
GET  /me/payments                                    → schedule + why-now + receipts (T2)
POST /me/payments/{demand_id}/pay                    → secure payment link
GET  /me/documents                                   → own docs; download/eSign
GET  /me/personalisation                             → open/closing windows (T3)
POST /me/change-requests                             → raise a CR (H5)
POST /me/change-requests/{id}/accept                 → accept quote (H6)
POST /me/service-requests                            → question / service
GET  /me/commitments                                 → customer-facing commitments
GET  /me/passport                                    → Home Passport (T4, post-handover)
GET  /me/handover                                    → predicted window + my to-dos (T6); confirm appointment
```

RLS: a customer sees **only their own** booking(s) — enforced at the DB, not just UI.

### 2.4 Handshakes

| id | Direction | This role's part |
|---|---|---|
| **H10** | ← crm-rm | **Consumes.** The only inbound channel; all display data is the approved, filtered payload. |
| **H5** | → project-site/design | Customer-raised CR routes to feasibility. |
| **H6** | ← design/crm-rm | Receives the quote; customer acceptance flows back. |

### 2.5 Events emitted
`customer.response.received` (question/service), `cr.requested` (customer origin), `cr.customer_accepted`, `document.customer_accepted`, `customer.contact.sent` (customer→pranava). All customer interactions are logged to the twin (via crm-rm) for the relationship history.

---

## Part 3 · UI/UX

Applies [`design-language.md`](../../foundation/design-language.md) — **customer skin**: Apple-clean and spacious, image-rich, Large-Title "moments", warm-neutral palette, one calm accent, mobile-first, ≤5 nav items. This is a first-class *consumer* app, not a dashboard.

### 3.1 Screens

> **Navigation:** the bottom tab bar has 5 top-level tabs ([`design-language.md`](../../foundation/design-language.md) §6): **Journey · My Home · Payments · Documents · Requests.** The remaining screens nest: **Registration (G)** and **Handover (H)** under *Journey*; **Home Passport (I)** and **Legal safety (J)** under *My Home*. Screen letters below are identifiers, not tab order.

- **A · Home (landing)** — warm hero **photo of their home/project**, family name, a single "where things stand" line, next milestone, and any action they owe.
- **B · Journey** — friendly milestone timeline (booking → keys), current stage highlighted, achieved with dates, next expected as a **window**.
- **C · My Home** — unit details, approved specs, and the **Build-My-Home progress tracker** (T1): stage bar + dated site photos + "what happens next."
- **D · Payments** — schedule where each demand says **why now** (T2), receipts, paid/remaining, TDS help, secure pay button. Calm, fair framing.
- **E · Documents** — required/received/approved, download own, eSign pending.
- **F · Requests & Personalisation** — one place to ask/serve **and** the personalisation windows (T3) with "Request a change" → CR flow → quote → approve → track drawings/status.
- **G · Registration** — readiness, checklist, appointment, final docs.
- **H · Handover** — predicted keys **window** + confidence, the buyer's own to-dos (T6), appointment confirm.
- **I · Home Passport** (post-handover) — manuals, warranties, product/finish details, service history (T4), warranty case raise.
- **J · Legal safety corner** — RERA no., registered docs, escrow assurance (T5).

### 3.2 Homely touches (the whole point)
- Leads with **their actual home in photos**, their name, their RM's face — emotional ownership.
- **Moments that matter** ([`design-language.md`](../../foundation/design-language.md) §5) get Large-Title `MomentCard`s: booking+24h welcome, milestone, 75–80% preview, pre-handover, **handover day** (the one warm celebration, §3.5), 7/30/90-day check-ins.
- Warm illustrated empty states; a real RM to contact, never a faceless bot.
- Every number/date framed reassuringly; nothing internal ever leaks.

### 3.3 Notifications (customer)
Event-driven and value-adding only (milestone reached, payment due, document ready, personalisation window closing, handover window). Respect quiet hours + channel preference. No repetitive status noise. AI may draft, a human approved it upstream (H10) — the portal never auto-generates consequential messages.

---

## Part 4 · Acceptance tests (role-scoped)

1. The portal shows **only** approved, customer-facing data; no internal note/vendor price/raw %/other customer ever appears. (#14, T1–T6)
2. A customer sees only their own booking(s) — enforced by RLS. (§31)
3. Construction progress advances to the customer only after mapped components are verified — never a raw % edit. (T1)
4. Every payment shows a plain-language "why now" tied to a real milestone. (T2)
5. Personalisation windows show friendly buckets; a closed window reads "window closed" without internal state names. (T3)
6. A customer can raise a CR even when a category is conditional/exception — it routes to feasibility, never blocked. (§30)
7. The handover view shows a **window** + the buyer's own to-dos only — never internal blockers. (T6)
8. No internal vocabulary appears anywhere in the customer UI. (§13)
