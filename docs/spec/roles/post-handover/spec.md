# Role · Post-Handover / Warranty / Service

**Module id:** `post-handover` · **Depends on:** `foundation`, `qa`, `crm-rm` · **Build order:** #9 (after handover; P2 in the roadmap)

The relationship does not end at keys. Post-Handover owns the home *after* move-in — defect-liability (DLP) and warranty cases, service history that stays on the Unit forever, the Digital Home Passport in the owner's hands, satisfaction check-ins at 7/30/90 days, and referral/advocacy at the right moment. Implements business module §8.14 and journey stage 10, and is the consumer of handshake **H12**.

> Read alongside: [`unit-twin.md`](../../foundation/unit-twin.md) §2.9 (Home Passport), [`handshakes.md`](../../foundation/handshakes.md) (H12), [`customer-transparency.md`](../../foundation/customer-transparency.md) (T4), [`HOMEFLOW-OS.md`](../../HOMEFLOW-OS.md) §8.14.

---

## Part 1 · Flow

### 1.1 What this role does

| Job | Outcome |
|---|---|
| Open DLP/warranty window | On handover completion (H12), start the defect-liability period and warranty coverage. |
| Manage warranty cases | Owner-reported defects during DLP → triage → vendor rectify → verify → close, with root cause. |
| Keep service history | Every service event stays on the **Unit** permanently, across future ownership changes. |
| Finalize Home Passport | Equipment, serials, manuals, warranties, paint/tile codes handed to the owner (feeds T4). |
| Satisfaction check-ins | Structured 7 / 30 / 90-day check-ins and DLP-closure satisfaction. |
| Referral / advocacy | Request referral/testimonial after a positive outcome, at the right emotional moment. |

### 1.2 The one question this role answers
> *"Which homes need service or warranty attention, and which owners are ready to advocate?"*

### 1.3 The post-handover flow (functional steps)

```
function onHandoverCompleted(booking_id, unit_id):        # H12 consumer
  1. openDLP:   create DLP window (dlp_start = handover date, dlp_end = start + policy months)
  2. openWarranties: from passport_items → WarrantyCase seeds (per-item warranty_start/end)
  3. finalizePassport: publish HomePassportItem set to the owner (T4 via H10)
  4. scheduleCheckins: create Actions at +7, +30, +90 days (satisfaction capture)
  5. beginServiceHistory: attach a permanent ServiceHistory ledger to the Unit

function onOwnerRaisesWarranty(unit_id, description, evidence):   # from customer ServiceRequest
  WarrantyCase: Open → Assigned → In Progress → Ready for Verify → (Verified | Reopened) → Closed
  if defect within DLP/warranty coverage → no charge; else → quote (governed)
  capture root_cause_code + vendor; feed QA snag analytics for repeat learning
  every state → ServiceHistory entry on the Unit (permanent)

function onCheckin(booking_id, day):
  capture satisfaction/sentiment → ExperienceSignal (via crm-rm)
  if positive at DLP closure → referral/advocacy Action
```

### 1.4 Gates: reads vs owns

| Gate | This role |
|---|---|
| DLP/warranty coverage | **Owns** — determines chargeable vs covered. |
| Handover hard gates | read (handover already passed to reach here). |

### 1.5 Hard rules
1. Service history is **permanent on the Unit** — survives resale, transfer, cancellation of any future booking. Never deleted.
2. A warranty defect within coverage is **not chargeable**; out-of-coverage work uses the governed quote/payment flow (reuse CR commercial controls).
3. Every warranty state change writes a `ServiceHistory` entry and (if defect) feeds QA snag/root-cause analytics.
4. DLP/warranty durations, check-in cadence, and referral timing are **configurable per project/product** (Policy Studio) — never hard-coded.

### 1.6 States
- WarrantyCase: `Open → Assigned → In Progress → Ready for Verify → Reopened → Verified → Closed`.
- DLP window: `active → closing → closed`.

---

## Part 2 · Data Flow

### 2.1 Twin surface

| Twin layer | Access |
|---|---|
| Unit Twin · Home Passport | **write** (finalize + service history) |
| Unit Twin · Snag/root-cause analytics | contributes (warranty defects) |
| Customer Twin · Experience signals | write (via crm-rm) — satisfaction, referral |
| Customer Twin · other | read |

### 2.2 Entities owned

**WarrantyCase**

| field | type | req | notes |
|---|---|---|---|
| `id` | uuid | ✔ | |
| `unit_id` / `booking_id` / `project_id` | ref | ✔ | project derived. |
| `passport_item_id` | ref<HomePassportItem> | | The covered item, if applicable. |
| `category` / `trade` | string | ✔ | |
| `severity` | enum{ critical \| major \| minor } | ✔ | |
| `description` | string | ✔ | |
| `coverage` | enum{ dlp \| warranty \| out_of_coverage } | ✔ | Drives chargeable. |
| `vendor_id` | ref | | |
| `root_cause_code` | string | | Feeds QA analytics. |
| `before_photos[]` / `after_photos[]` | ref[]<file> | | |
| `status` | enum{ open\|assigned\|in_progress\|ready_for_verify\|reopened\|verified\|closed } | ✔ | |
| `sla_due_at` | timestamp | | By severity. |
| `chargeable_amount` | money | | Only if out_of_coverage. |

**DLPWindow** — `id, unit_id, booking_id, dlp_start, dlp_end, status{ active\|closing\|closed }, policy_id`.

**ServiceHistory** — `id, unit_id` (permanent, unit-scoped), `event_type, warranty_case_id?, description, occurred_at, actor`. **Never deleted.**

**CheckinRecord** — `id, booking_id, day{ 7\|30\|90\|dlp_closure }, satisfaction_score, sentiment, captured_at` → emits `ExperienceSignal` via crm-rm.

### 2.3 APIs

```
GET  /units/{id}/service-history                     → permanent ledger
POST /warranty-cases                                 → owner/staff raises (from ServiceRequest)
POST /warranty-cases/{id}/assign|rectify|verify|reopen|close
GET  /warranty-cases?coverage=out_of_coverage        → chargeable queue
GET  /bookings/{id}/dlp                              → DLP window + coverage
POST /checkins/{id}/capture                          → 7/30/90-day satisfaction
POST /bookings/{id}/referral                         → referral/advocacy request
```

### 2.4 Handshakes

| id | Direction | This role's part |
|---|---|---|
| **H12** | ← qa/crm-rm | **Consumes.** Handover completion → open DLP, seed warranties, finalize passport, schedule check-ins, start service history. |
| (feeds) | → customer via H10 | **T4** Home Passport + warranty status; service-request updates. |
| (feeds) | → qa | Warranty defect root-causes feed snag/vendor analytics. |
| (feeds) | → management H11 | Repeat/critical warranty patterns, satisfaction drops. |

### 2.5 Events emitted
`warranty.window.opened` · `warranty.case.opened` · `warranty.case.resolved` · `warranty.case.reopened` (from [`event-log.md`](../../foundation/event-log.md)). New (added to catalog): `dlp.window.opened` · `dlp.window.closed` · `checkin.captured` · `referral.requested`.

### 2.6 AI (bounded)
Reuses QA's **quality root-cause** engine for warranty patterns (e.g. repeat leak by vendor). Suggests referral timing from sentiment. Never auto-closes a case or auto-sends.

---

## Part 3 · UI/UX

Applies [`design-language.md`](../../foundation/design-language.md) — **workspace skin** for staff; the owner sees this through the **customer skin** (Home Passport + service).

### 3.1 Screens (staff)
- **A · Warranty Board** — Kanban by case state, photo-forward, coverage badge (covered vs chargeable), SLA, repeat flag.
- **B · Unit Service History** — the permanent ledger on Unit 360, timeline of every service event.
- **C · DLP / Warranty windows** — active DLP windows nearing closure; coverage lookups.
- **D · Check-in & Advocacy** — 7/30/90-day queue; satisfaction capture; referral prompts at positive moments.

### 3.2 Owner-facing (customer skin, via T4/H10)
- **Home Passport** — warm cards for appliances/finishes, warranties with dates, downloadable manuals, "raise a service request."
- Service requests tracked with calm status; covered work shown as no-charge; any chargeable work quoted transparently.

### 3.3 Homely touches
This is where the brand relationship lives on — the Passport feels like a real "owner's handbook," check-ins feel like genuine care ("Settling in? Anything need a touch-up?"), and advocacy is asked only after a good experience.

---

## Part 4 · Acceptance tests (role-scoped)

1. Handover completion (H12) opens the DLP window, seeds warranties, finalizes the Passport, and schedules 7/30/90-day check-ins. (§8.14)
2. Service history is permanent on the Unit and survives a future ownership change. (§8.14, #2)
3. A defect within coverage is non-chargeable; out-of-coverage uses the governed quote flow. (§8.14)
4. Warranty root causes feed QA repeat-defect/vendor analytics. (§8.9/§8.14)
5. Satisfaction check-ins capture ExperienceSignals feeding Customer Health. (§8.14)
6. The owner sees the Home Passport (T4) and can raise a service request; no internal data leaks. (T4, #14)
