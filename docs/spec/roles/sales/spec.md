# Role · Sales

**Module id:** `sales` · **Depends on:** `foundation`, `project-site` · **Build order:** #2

Sales turns the Unit Twin's live physical truth into the right pitch and a clean booking. Its whole advantage is **honest changeability**: Sales can see which villas can still change a kitchen and which cannot — and sells accordingly. Sales **reads** the truth `project-site` owns; it never edits it.

> Read alongside: [`gates.md`](../../foundation/gates.md), [`unit-twin.md`](../../foundation/unit-twin.md), [`handshakes.md`](../../foundation/handshakes.md) (H1, H2, H5), [`customer-transparency.md`](../../foundation/customer-transparency.md) (T3), [`data-model.md`](../../foundation/data-model.md).

---

## Part 1 · Flow

### 1.1 What this role does

| Job | Outcome |
|---|---|
| Read live inventory | See every available unit with construction state, changeability score, and open/closing gates. |
| **Pitch by physics** | Match the unit's stage to the buyer: near-finished → *fast possession*; early-stage → *customization scope*. |
| Match needs to units | Capture a prospect's Must-Have / Preferred needs; rank units by live compatibility. |
| Protect a closing option | Request a Change Window Hold (Project-approved) to keep a gate open for a serious prospect. |
| Raise early CRs | For a prospect, capture a desired change → routes to feasibility (H5). Never a site instruction. |
| Book & hand off | Create the Booking, capture applicants + token + commercials, pass the completeness gate, submit to CRM (H2). |

### 1.2 The one question this role answers
> *"Which available units best fit this prospect, which customisation gates are open/closing, and when do those windows expire?"*

### 1.3 The pitch-angle logic (core Sales intelligence)

The **same gate engine** that internal roles use drives how Sales sells. Derived per unit from its live changeability, never manually set:

| Unit changeability profile | Auto-suggested pitch angle | What Sales tells the buyer |
|---|---|---|
| High score, most gates `OPEN` (early construction) | **Personalise** | "This villa is early — you can still shape the kitchen, electrical, flooring to your taste." |
| Mixed, several `CLOSING` | **Personalise soon** | "Great fit, but the window for layout changes closes ~{date} — decide while it's open." |
| Low score, most `EXCEPTION_ONLY / HARD_CLOSED` (near completion) | **Fast possession** | "Nearly ready — move in soon; customization is limited to finishes." |
| `Ready-to-Move` | **Move-in ready** | "Complete and ready — quickest path to your keys." |

The UI surfaces this as a **suggested angle chip** on each unit, always explainable by the underlying gates. It is guidance, not a promise — Sales still cannot commit a change that isn't `OPEN`.

### 1.4 Gates: reads vs owns

| Gate | This role |
|---|---|
| Changeability gates | **Read only.** Never edits state, rules, or physics. |
| Change Window Hold | **Requests** — cannot bind unilaterally; `project-site` approves if construction is affected. |
| Completeness gate (H2) | **Owns the input** — must reach the project threshold before submitting to CRM. |

### 1.5 Hard rules
1. Sales can **never** mutate `UnitProgressState`, `ChangeGateRule`, or hard-gate state (API + RLS block it).
2. Sales must not promise a change that is not `OPEN` — `CONDITIONAL`/`EXCEPTION_ONLY` require the feasibility/exception workflow first.
3. If gate data is stale past policy, Sales sees **Verification Required** — must not quote a precise open/closed promise.
4. A Change Window Hold is time-boxed, auto-expires, and needs Project approval when planned execution changes.
5. Booking cannot be submitted to CRM until the completeness gate passes (H2).

### 1.6 States

- Opportunity/prospect: `lead → qualified → matched → holding? → booking → handed_off | lost`
- Booking (this role's part): `draft → submitted` (then CRM owns `crm_accepted/active` or `returned`).
- Hold: `Requested → Project Review → Approved/Rejected → Active → Expired/Released`.

---

## Part 2 · Data Flow

### 2.1 Twin surface

| Twin layer | Access |
|---|---|
| Unit changeability / progress / spec | **read only** |
| Unit changeability score + gate chips | read |
| Customer Twin | **does not exist yet** at this stage — Sales captures prospect data, then *creates* the Booking + applicants which instantiate it on CRM acceptance. |

Sales writes to **Booking** (on creation) and to prospect/opportunity objects — never to the Unit Twin.

### 2.2 Entities owned

- `Opportunity` — the prospect/sales pursuit.

| field | type | req | notes |
|---|---|---|---|
| `id` | uuid | ✔ | |
| `project_id` | ref<Project> | ✔ | |
| `prospect` | json | ✔ | name, contacts, budget, timeline. |
| `stage` | enum{ lead\|qualified\|matched\|holding\|booking\|handed_off\|lost } | ✔ | |
| `sales_owner_id` | ref<User> | ✔ | |
| `lost_reason_code` | string | | Structured taxonomy. |

- `ProspectPersonalisationNeed` ([`HOMEFLOW-OS.md`](../../HOMEFLOW-OS.md) §30) — `id`, `opportunity_id`, `requirement`, `importance` enum{ must_have \| preferred }, `category_id` (maps to `ChangeCategory`), `notes`.
- `UnitRequirementMatch` — `id`, `opportunity_id`, `unit_id`, `compatibility_score`, `matched_items[]`, `conditional_items[]`, `closed_items[]`, `generated_at`.
- `ChangeWindowHold` ([`gates.md`](../../foundation/gates.md) A.6) — full ownership of request lifecycle; approval belongs to `project-site`.
- `Booking` (create + submit only) — see [`data-model.md`](../../foundation/data-model.md) §2.4. Sales writes unit, consideration, token, payment plan, applicants, commercial approvals, source channel; computes `completeness_score`.
- **`ChangeRequest`** — the governed customisation entity. Created by Sales (prospect, `opportunity_id`) **or** CRM (booked customer, `booking_id`); feasibility/costing owned by `project-site`/design (H5/H6); commercial controls by finance. One CR, many line items. Full engine: [`gates.md`](../../foundation/gates.md) + [`HOMEFLOW-OS.md`](../../HOMEFLOW-OS.md) §9.

| field | type | req | writes | notes |
|---|---|---|---|---|
| `id` | uuid | ✔ | system | The single CR ID. |
| `project_id` | ref<Project> | ✔ | derived | From unit/booking. |
| `unit_id` | ref<Unit> | ✔ | creator | Affected unit. |
| `booking_id` | ref<Booking> | | crm | Set for booked-customer CRs. |
| `opportunity_id` | ref<Opportunity> | | sales | Set for prospect CRs. |
| `origin` | enum{ sales_prospect \| crm_booked \| customer_portal } | ✔ | creator | |
| `status` | enum{ draft\|requested\|feasibility_review\|costing\|awaiting_approval\|awaiting_customer\|awaiting_payment\|approved\|released\|in_progress\|ready_for_qa\|qa_verified\|customer_accepted\|as_built_closed\|rejected\|withdrawn\|cancelled } | ✔ | workflow | Appendix A (15 states + side states). |
| `priority` | enum{ low\|normal\|high } | | creator | |
| `desired_date` | date | | creator | |
| `feasibility_result` | enum{ feasible \| feasible_with_conditions \| rejected } | | project-site/design | Set at H5. |
| `feasibility_conditions` | json | | design | Structural/MEP/statutory dependencies. |
| `customer_quote` | json | | finance/crm | `{ price, tax, inclusions, exclusions, validity_date }` (H6). |
| `schedule_impact` | json | | project-site | `{ lead_time_days, handover_delay_days }`. |
| `internal_cost` | money | | finance | Vendor+internal incremental (never customer-visible). |
| `contribution` | money | | finance | Margin after cost/tax/discount. |
| `payment_gate_status` | enum{ not_required\|pending\|cleared } | ✔ | finance | Release blocked until cleared. |
| `released_revision_id` | ref<AsBuiltRevision> | | design | The drawing released to Site/QA (H6). |
| `created_by` / `created_at` | ref/ts | ✔ | system | |

**`ChangeRequestLineItem`** — `id, cr_id, room, trade, category_id (ref<ChangeCategory>), intent, drawings[], catalogue_ref? (standard vs bespoke), line_status, line_cost`.

> Governance invariants ([`handshakes.md`](../../foundation/handshakes.md) H5/H6): capture is **never** blocked by gate state; execution releases **only** after feasibility + commercial approval + customer acceptance + payment gate; a completed CR updates the permanent as-built ([`unit-twin.md`](../../foundation/unit-twin.md)) and Home Passport. `data-model.md` §6 indexes this entity here.

### 2.3 Requirement-to-unit matching algorithm

For a prospect's needs vs available units (sales guidance, **not** engineering approval):

```
for each available unit in project:
  for each ProspectPersonalisationNeed:
    gate = UnitChangeGate(unit, need.category_id)
    classify:
      OPEN/CLOSING      → matched (CLOSING adds an expiry note)
      CONDITIONAL       → conditional
      EXCEPTION/HARD    → closed  (if need.importance = must_have → heavy penalty)
  compatibility_score = weighted( matched, conditional, closed,
                                  must_have weighted >> preferred )
rank units by compatibility_score; each item explains WHY (which gate).
```

A **Must-Have that is `HARD_CLOSED`** materially drops the score and is explicitly explained (never silently hidden).

### 2.4 APIs (follow [`architecture.md`](../../foundation/architecture.md) §4)

```
# Inventory & changeability (read-only projections of the Unit Twin)
GET  /units?project_id=&status=available&filter=kitchen_open,electrical_open
GET  /units/{id}/changeability                     → gate chips + score + pitch angle + freshness
POST /units/compare                                → side-by-side (≥3 units) by changeability

# Personalisation discovery / match
POST /opportunities/{id}/needs                      → capture Must-Have/Preferred
POST /opportunities/{id}/match                      → ranked UnitRequirementMatch w/ explanations

# Change Window Hold
POST /change-window-holds                            → request (unit, gate, duration, reason, impact)
GET  /change-window-holds?opportunity_id=            → status

# Early Change Request (prospect)
POST /change-requests                                → H5 (opportunity-linked; never blocks capture)

# Booking + handoff
POST /bookings                                       → create (draft)
GET  /bookings/{id}/completeness                     → completeness score + missing items
POST /bookings/{id}/handover/submit                  → H2 submit to CRM
```

### 2.5 Handshakes

| id | Direction | This role's part |
|---|---|---|
| **H1** | ← project-site | **Consumes** live changeability (read-only). Receives flags when a prospect's Must-Have gate transitions. |
| **H2** | → crm-rm | **Emits.** Submits the completed Booking file through the completeness gate. Handles `returned` (reason code → fix → resubmit). |
| **H5** | → project-site/design | **Emits.** Prospect change request → feasibility. Gate state never blocks capture. |
| Hold request | → project-site | **Emits.** Requests a Change Window Hold; Project approves/rejects. |

### 2.6 Events emitted
`prospect.needs.captured` · `prospect.unit_match.generated` · `prospect.unit.compared` · `prospect.unit.selected` · `hold.requested` · `cr.requested` · `booking.created` · `booking.handover.submitted`

---

## Part 3 · UI/UX

Applies [`design-language.md`](../../foundation/design-language.md) — **workspace skin**, but this role is image-forward (units are homes, not rows). Photo-rich cards, warm gate chips.

### 3.1 Screens

**A · Inventory & Changeability View** (§"Sales Inventory Changeability View")
- Grid/gallery of available units — each card: **unit photo**, type/facing, construction %, **changeability `ScoreDial`**, gate chips (Kitchen · Electrical · Flooring…), expected-possession window, and the **suggested pitch-angle chip** (Personalise / Fast possession / Move-in ready).
- Filters: `Highly Customisable · Layout Flexible · Kitchen Changes Open · Electrical Open · Flooring Open · Bathroom Open · Ready-to-Move`.
- **Freshness badge**; stale units show `Verification Required` instead of gate chips.
- **Compare** tray: pick ≥3 units → side-by-side changeability matrix.

**B · Personalisation Discovery & Unit Match** (§"Personalisation Discovery")
- Capture the prospect's Must-Have / Preferred needs (chips mapped to change categories).
- **Ranked unit results** with a plain explanation per unit ("V101: kitchen + electrical open — great personalise fit; V104: kitchen closed — better for fast possession").
- One click → Compare, Hold, or start Booking.

**C · Change Window Hold request**
- Select unit + gate/category, requested duration, prospect, reason, construction impact → submit for Project approval. Shows auto-expiry and status; never a binding promise until approved.

**D · Booking Wizard**
- Steps: Unit → Applicants (add customers/co-owners, PAN, KYC docs) → Commercials (consideration, token, payment plan, approvals/deviations) → Review.
- **Live completeness meter** (the H2 gate) shows exactly what's missing before submit.
- Submit → handoff to CRM; if returned, the **return reason** is shown inline with a fix path.

### 3.2 Homely touches
- Units presented as *homes* with real imagery, not spreadsheet rows.
- Gate chips read warmly ("Kitchen — open till ~Mar") not as codes.
- The pitch angle is framed as help ("Best sold as: a home to personalise"), building the salesperson's confidence and honesty.
- Warm empty states ("No units match every Must-Have yet — here are the 3 closest, and why").

### 3.3 Customer-facing linkage (T3)
Whether a change category is shown to the *buyer* (personalisation countdown, [`customer-transparency.md`](../../foundation/customer-transparency.md) T3) is governed by the `ChangeCategory.customer_visible` flag. Sales/CRM config sets it; the Sales pitch view and the customer countdown read the **same** gate — guaranteeing they never contradict.

---

## Part 4 · Acceptance tests (role-scoped)

1. Sales can filter inventory to `Kitchen Layout + Electrical Open` and compare ≥3 units side by side. (§30)
2. A prospect's Must-Have / Preferred needs are compared with available units **without** implying technical approval; a `HARD_CLOSED` Must-Have materially lowers the match and is explained. (#24, §30)
3. Closing gates show an expected expiry date/event; stale forecasts show `Verification Required`. (#23, #25)
4. Sales cannot edit any physical progress or technical gate through any path. (#21)
5. A Change Window Hold is time-bound, Project-approved when construction is affected, auto-expires, and is fully audited. (#26)
6. A prospect Change Request can be created even when a gate is `CONDITIONAL/EXCEPTION` — capture is never blocked; it routes to feasibility/exception. (§30)
7. A Booking cannot be submitted to CRM until the completeness gate passes; a returned booking carries a structured reason and reopens the Sales action. (Module 8.1, H2)
8. The suggested pitch angle for a unit always matches its live gate profile and is explainable. (role-specific)
