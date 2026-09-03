# Role · CRM / RM

**Module id:** `crm-rm` · **Depends on:** `foundation`, `sales` · **Build order:** #3

CRM/RM is the **orchestration hub** and the owner of the **Customer Twin**. It accepts the booking from Sales (the first quality gate), instantiates the customer relationship, runs the Promise Ledger and all communication, coordinates every downstream stream (funding, legal, registration, handover), and is the **only approver of what crosses to the customer** (H10). If HomeFlow has a "conductor," this is it.

> Read alongside: [`customer-twin.md`](../../foundation/customer-twin.md), [`handshakes.md`](../../foundation/handshakes.md) (H1, H2, H3, H4, H5, H6, H7, H8, H9, H10, H11, H12 — this role touches nearly all), [`universal-action.md`](../../foundation/universal-action.md), [`customer-transparency.md`](../../foundation/customer-transparency.md).

---

## Part 1 · Flow

### 1.1 What this role does

| Job | Outcome |
|---|---|
| Accept the booking | Run the completeness gate on the Sales file (H2); accept or return with a structured reason. |
| Instantiate the Customer Twin | On acceptance, create/link the Customer Twin and start the journey. |
| Onboard | Premium welcome within 24h, RM introduction, journey map, payment/doc checklist, comms preferences. |
| Own the relationship | All communication, sentiment, experience signals, the RM's daily contact list. |
| Run the Promise Ledger | Capture, approve, and track every Pranava promise + every customer PTP; pre-breach recovery. |
| Manage booked-customer CRs | Raise/track change requests for booked customers (H5) — no physical-state editing. |
| Coordinate streams | Trigger funding (H3), documents (H4); consume registration (H8) and readiness (H9); converge handover. |
| **Approve customer transparency** | Gate every update crossing to My Pranava Home (H10) — the visibility filter's human. |

### 1.2 The one question this role answers
> *"Who needs attention today, why, and what should I do next?"*

Answered by **My Day** ([`universal-action.md`](../../foundation/universal-action.md)) filtered to the RM's customers, ranked by overdue / closing-gate / broken-promise / sentiment.

### 1.3 Gates: reads vs owns

| Gate | This role |
|---|---|
| Completeness gate (H2) | **Owns the decision** — accept or return the Sales file. |
| Changeability gates | **Read only** (to advise booked customers) — never edits physics. |
| Handover hard gates | Owns the finance/legal/registration/commitments **convergence**; does not override safety/physical. |
| H10 visibility filter | **Owns** — approves what the customer sees. |

### 1.4 Hard rules
1. No Customer Twin exists until CRM **accepts** the booking (H2). Acceptance is the birth of the relationship record.
2. CRM may update **PTP signals** but MUST NOT change finance-owned amounts ([`customer-twin.md`](../../foundation/customer-twin.md)).
3. CRM cannot edit unit physical state or technical gates — it *reads* them to advise.
4. Only `visibility = customer_facing`, approved content crosses H10. AI may draft; CRM (or a configured auto-rule) approves; consequential comms never auto-send.
5. Every promise has an owner, due date, and evidence requirement before it can be `active`.

### 1.5 States this role manipulates
- Booking: `submitted → crm_accepted → active` | `returned` (H2).
- Commitment: `draft → approved → active → at_risk → fulfilled | breached | waived_cancelled`.
- Communication: logged with `visibility` + sentiment.
- Customer Health / Booking Readiness scores: derived, surfaced.

---

## Part 2 · Data Flow

### 2.1 Twin surface

| Twin | Layer | Access |
|---|---|---|
| Customer Twin | Profile, consent, bookings, commitments, communications, experience | **write** (owner) |
| Customer Twin | Financial behaviour amounts | **read** (accounts owns); may write PTP signal only |
| Customer Twin | Documents | read (legal owns); can request |
| Unit Twin | Changeability, progress, readiness | **read only** |

### 2.2 Entities owned
- **Customer** master + relationship history ([`data-model.md`](../../foundation/data-model.md) §2.5).
- **Commitment** (Promise Ledger) ([`customer-twin.md`](../../foundation/customer-twin.md) §2.5).
- **Communication** ([`customer-twin.md`](../../foundation/customer-twin.md) §2.6).
- **ExperienceSignal** ([`customer-twin.md`](../../foundation/customer-twin.md) §2.7).
- **ChangeRequest** for booked customers (created here; feasibility/costing owned by `project-site`/design via H5/H6).
- **CustomerUpdateApproval** — the H10 gate record:

| field | type | req | notes |
|---|---|---|---|
| `id` | uuid | ✔ | |
| `booking_id` | ref<Booking> | ✔ | |
| `update_type` | enum | ✔ | Per [`customer-transparency.md`](../../foundation/customer-transparency.md) (T1–T6) + milestone/commitment. |
| `proposed_content` | json | ✔ | Draft (may be AI-generated). |
| `approved_content` | json | | After human edit/approval. |
| `approved_by` | ref<User> | | Null until approved. |
| `auto_rule_id` | ref<AutoPublishRule> | | If auto-approved by config. |
| `status` | enum{ pending \| approved \| suppressed } | ✔ | |

**AutoPublishRule** — Policy Studio config that lets low-risk update types cross H10 without manual approval (e.g. site-flagged progress photos, payment receipts). Human approval stays mandatory for anything not matched by a rule.

| field | type | req | notes |
|---|---|---|---|
| `id` | uuid | ✔ | |
| `project_id` | ref<Project> | ✔ | |
| `update_type` | enum | ✔ | Which H10 `update_type` this rule auto-approves. |
| `conditions` | json | | e.g. "photos flagged `customer_shareable` by site", value thresholds. |
| `enabled` | bool | ✔ | |

### 2.3 The H2 acceptance workflow (booking birth)

```
receive H2 payload (from sales)
→ validate completeness_score ≥ project threshold
→ validate mandatory-doc checklist (by project/product/customer type)
→ validate commercial approvals present
   PASS → Booking.status = crm_accepted → active
        → resolve/create Customer(s) (dedup check), link via BookingApplicant
        → instantiate Customer Twin + RelationshipHistory
        → assign rm_owner_id
        → start JourneyInstance (project journey template)
        → auto-generate onboarding Actions:
            welcome (≤24h), KYC collect, payment-schedule share, doc checklist
        → emit funding setup (H3), first document trigger when due (H4)
   FAIL → Booking.status = returned + return_reason_code
        → Action back to sales_owner_id
        → increment first-time-right / repeat-error analytics
```

### 2.4 APIs

```
# Booking acceptance (H2)
GET  /bookings/{id}/handover                         → the submitted file + completeness detail
POST /bookings/{id}/handover/accept                  → accept (births Customer Twin, starts journey)
POST /bookings/{id}/handover/return                  → return + reason code

# Customer Twin
GET  /customers/{id}                                 → 360 (profile, bookings, financial[read], docs, commitments, comms, experience)
PATCH /customers/{id}                                → profile/consent/preferences
POST /customers/merge                                → dedup/merge (audited, history-preserving)

# Promise Ledger
POST /commitments                                    → create (owner, due, evidence req, visibility)
POST /commitments/{id}/approve | /fulfil | /waive    → transitions (+ evidence)
GET  /commitments?at_risk=true                       → pre-breach queue

# Communications
POST /communications                                 → log/send (channel, visibility, template)
GET  /customers/{id}/communications                  → history (internal + customer-facing)

# Booked-customer CR
POST /change-requests                                → H5 (booking-linked)

# Customer transparency approval (H10)
GET  /customer-updates?status=pending                → drafts awaiting approval
POST /customer-updates/{id}/approve | /suppress      → gate content to My Pranava Home

# My Day (shared engine, filtered to RM)
GET  /me/day                                         → ranked Actions + why-now
```

### 2.5 Handshakes

| id | Direction | This role's part |
|---|---|---|
| **H1** | ← project-site | **Consumes** (read-only). Reads live changeability to advise booked customers; receives flags when a booked customer's gate transitions. |
| **H2** | ← sales | **Receives + decides.** Completeness gate → accept (birth twin) or return. |
| **H3** | → accounts | **Emits.** Funding & demand setup on booking activation. |
| **H4** | → legal | **Emits.** Document generation triggers (AOS, addenda, etc.). |
| **H5** | → project-site/design | **Emits.** Booked-customer change requests. |
| **H6** | ← design/project-site | **Receives.** CR quote → presents to customer, captures explicit acceptance, triggers payment gate before release. |
| **H7** | ← accounts | **Receives.** Financial clearance → feeds registration + handover convergence. |
| **H8** | ← legal | **Receives.** Registration completion → updates journey + informs customer (via H10). |
| **H9** | ← qa | **Receives.** Readiness/handover eligibility → converges handover (incl. evaluating the Commitments hard gate locally), books appointment. |
| **H10** | → customer | **Emits + owns the gate.** Approves all customer-facing updates. |
| **H11** | → management | **Emits.** Escalates material exceptions (sentiment, broken promise, at-risk handover). |
| **H12** | → post-handover | **Co-emits** on handover completion (with qa) → warranty/DLP/passport handoff. |

### 2.6 Events emitted
`booking.handover.accepted` · `booking.handover.returned` · `commitment.created` · `commitment.approved` · `commitment.at_risk` · `commitment.fulfilled` · `commitment.breached` · `customer.contact.sent` · `customer.response.received` · `customer.sentiment.changed` · `customer.update.published` · `funding.setup.created` (via H3) · `document.generation.requested` (via H4) · `escalation.created`

### 2.7 AI assists (suggestions only)
- **Promise detection** from logged comms → drafts a `Commitment` for CRM approval.
- **Sentiment/escalation** trend → `ai_recommendation` Action ("negative across 3 interactions — call recommended").
- **Comms drafting** → draft only; CRM approves before send. Never auto-sends consequential content.
- **"Summarize this customer before I call"** copilot over the twin.

---

## Part 3 · UI/UX

Applies [`design-language.md`](../../foundation/design-language.md) — **workspace skin** with a **human, relationship-first** feel (avatars everywhere; this role is about people, not rows).

### 3.1 Screens

**A · My Day** (the RM landing)
- Ranked `ActionCard` list filtered to the RM's customers, each with **why-now** ("Overdue ₹8L · promised Fri · call") and one-click: call · WhatsApp · request doc · approve · escalate · recovery plan.
- Focus modes: by customer / by project / by queue. Daily closure summary + carry-forward.

**B · Booking Acceptance Queue** (H2)
- Submitted files with a **completeness meter** and the mandatory-doc checklist; missing items highlighted.
- Accept → confirmation of what happens (twin created, journey started, onboarding actions). Return → structured reason picker → routes back to Sales.

**C · Customer 360** (the Customer Twin view)
- Warm header: customer name + avatar, their unit **photo**, RM, health `ScoreDial`.
- Tabs: Journey · Payments (read from accounts) · Documents · Commitments · Communications · Experience.
- Every list humanized with `PersonRow`; internal vs customer-facing content clearly separated.

**D · Promise Ledger**
- Timeline of commitments (Pranava→customer and customer→PTP), owner avatars, due dates, status chips, evidence.
- **Pre-breach lane**: at-risk promises surfaced with a recovery-plan action.

**E · Communications**
- Omnichannel thread (call/email/WhatsApp/SMS/meeting/notice) with a hard **internal / customer-facing** divider.
- Templates (approved, versioned); AI summary + open-item extraction; sentiment trend; frequency guardrails.

**F · Customer Transparency Approvals** (H10 gate)
- Queue of drafted updates (progress stage reached, payment due, personalisation window changed, passport item added, document ready, handover window) with a **preview of exactly what the customer will see**.
- Edit → approve → publish, or suppress. Auto-publish rules configurable per update type.

### 3.2 Homely touches
- Customer 360 leads with the **home's photo and the family's name**, not a record id — the RM feels the relationship.
- Warm, plain language in every customer-facing preview; internal jargon confined to internal panes.
- Pre-breach nudges framed as care ("Reach Priya today — her promised payment is Friday and she's had a rough week"), not just red alerts.

### 3.3 Confidentiality enforcement
The H10 approval screen is where **controlled transparency** is enforced by a human: internal notes, vendor prices, staff performance, and unapproved forecasts are structurally excluded from `proposed_content`, and the preview shows precisely the customer's view before it publishes.

---

## Part 4 · Acceptance tests (role-scoped)

1. A booking cannot become `crm_accepted` unless the completeness gate passes; a returned booking carries a structured reason and reopens a Sales action. (Module 8.1, H2)
2. On acceptance, a Customer Twin + journey + onboarding actions are created, and no twin existed before. (H2, #1)
3. Every customer-facing commitment has owner, due date, status, dependencies, evidence. (#6)
4. CRM can update a PTP signal but cannot silently alter a finance-owned amount. (§12)
5. Only `customer_facing`, approved content crosses H10; the approval preview matches exactly what the customer sees; AI never auto-sends. (#14, §13)
6. A customer merge preserves all history and is auditable. (§22)
7. A broken/at-risk promise generates a pre-breach recovery action before the due date. (Module 8.11)
8. My Day ranks the RM's customers with plain-language why-now. (§11)
