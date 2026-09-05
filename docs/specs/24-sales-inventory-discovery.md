# 24 — Sales: inventory changeability view, personalisation discovery, requirement match, Change Window Hold, booking

## Purpose
p14 §8.7.1 & p43 §33.3: "Sales inventory must expose Construction %, expected possession window, Customisation Flexibility score and the current gate summary"; filters **Highly Customisable, Layout Flexible, Kitchen Changes Open, Electrical Changes Open, Flooring Selection Open, Bathroom Specification Open, Ready-to-Move, Closing soon**; compare ≥3 units; Must Have / Preferred / Not Important → Requirement Compatibility score "with a plain-language explanation … must never imply engineering approval"; Change Window Hold time-bound, Project-approved, auto-expiring (p14; p34 §30.1 objects `ProspectPersonalisationNeed`, `UnitRequirementMatch`, `ChangeWindowHold`). Booking with applicants + commercial approvals (p9 §8.1).

## Data
| Table | Columns |
|---|---|
| `prospect` | `id`, `project_id`, `name`, `phone`, `email`, `source`, `sales_owner_user_id`, `status ∈ {ACTIVE, BOOKED, LOST}`, `customer_id?` (on booking) |
| `prospect_personalisation_need` | `id`, `prospect_id`, `category_code` (08), `importance ∈ {MUST_HAVE, PREFERRED, NOT_IMPORTANT}`, `note`, `captured_by/at` — p34 §30.1 |
| `unit_requirement_match` | `prospect_id`, `unit_id`, `score` (0–100), `explanation jsonb` [{category, importance, gate_state, verdict ∈ {OPEN, CLOSING, CONDITIONAL, NOT_POSSIBLE}, text}], `computed_at`, `freshness` — p34 §30.1 |
| `change_window_hold` | `id`, `unit_id`, `category_code`, `prospect_id`/`booking_id`, `requested_by`, `reason`, `requested_until`, `approved_by` (Projects head), `approved_until`, `status ∈ {REQUESTED, APPROVED, REJECTED, EXPIRED, RELEASED, CONSUMED}`, `policy_id` — p34 §30.1 |
| `hold_policy` | `project_id?`, `max_days`, `max_active_per_project`, `allowed_categories[]`, `approver_role`, `auto_expire bool` — Policy Studio (p27 §21 "Change Window Hold policy") |
| `inventory_view` (query) | per unit: sale_status, construction_pct (07 structure/finishes), expected_possession_window (06 forecast ± confidence), flexibility_score (08 rule 9), gate_summary (08), freshness, price, facing, area, closing_soon flag |

## Rules
1. Inventory filters map to gate states: *Highly Customisable* = flexibility ≥ 70; *Layout Flexible* = LAYOUT_WALLS ∈ {OPEN, CLOSING}; *Kitchen/Electrical/Flooring/Bathroom Open* = that category OPEN or CLOSING; *Ready-to-Move* = Unit Readiness ≥ threshold and handover gates PASSED except CUSTOMER; *Closing soon* = any customer-visible category CLOSING within `closing_lead_days` (p14 filter list; p43 §33.3).
2. Every gate chip shows source timestamp and freshness (07/08) — "Verification Required" is displayed as such, never as Open (p31 §26 "see source timestamp/freshness"; p35 §30.5 t9).
3. Compare view: ≥3 units side by side on price, area, facing, possession window, flexibility with drivers, category states, and (if a prospect is selected) requirement match (p14; p35 §30.5 t6).
4. Requirement match = Σ over needs of weight(importance: MUST 3, PREFERRED 1, NOT 0) × state value (OPEN 1, CLOSING 0.75, CONDITIONAL 0.5, EXCEPTION_ONLY 0.1, HARD_CLOSED 0) / Σ weights × 100; a MUST_HAVE in HARD_CLOSED caps the score at 40 and yields verdict NOT_POSSIBLE. Explanation sentences: "Kitchen changes are open until ~14 Oct (flooring not yet started)" / "Layout changes are closed — walls completed and verified 2 Aug". Always appended: "Compatibility reflects current site status and is not an engineering approval." (p14; p31 §26 bullet; p35 §30.5 t4, t8).
5. Recomputed on gate changes for active prospects; stale (> freshness threshold) marked.
6. Hold: Sales requests for a category on a unit for a prospect with reason; requires approval by `approver_role` (Projects head) within policy (`max_days`, `max_active_per_project`, allowed categories); while APPROVED, 08 keeps the gate from moving to a more closed state **for that unit/category only** — bulk updates preview shows "held" units as exceptions (07 rule 5); auto-expire at `approved_until` (nightly + on read); CONSUMED when the prospect books and raises a CR; RELEASED manually with reason (p14; p31 §26 "time-bound, Project-approved, automatically expires").
7. Sales is read-only on physics: no control in this screen writes to 07/08 (p35 §30.5 t10).
8. Booking from inventory: unit must be AVAILABLE or HELD by this prospect; creates 04 booking DRAFT with applicants (≥1 PRIMARY, residency captured), price/discount, payment plan (19); discount beyond matrix (25) → APPROVAL action; `CONFIRMED` on booking amount receipt (19) or explicit confirm; prospect → BOOKED; needs copied to the booking as context for 18.
9. Lost prospects keep needs for analytics (which requirements lose deals — 27/31).

## API
`GET /projects/:id/inventory?filters…&node_id&sort` · `GET /inventory/compare?unit_ids[]&prospect_id?` · `GET/POST /prospects`, `PUT /prospects/:id/needs` · `GET /prospects/:id/matches?unit_ids[]` · `POST /holds`, `POST /holds/:id/approve|reject|release` · `GET /projects/:id/holds` · `POST /prospects/:id/book {unit_id, applicants[], price…}` · Studio `GET/PUT /hold-policy`.

## Screens
- **Sales Inventory**: filter bar (named filters as toggles + node/price/facing), grid/list toggle, unit cards (status, ₹, area, facing, possession window, flexibility dial with 3 drivers, category chips with freshness dot), compare tray (pick up to 4), "Closing soon" ribbon.
- **Compare**: side-by-side columns; requirement match rows when a prospect is chosen with explanation text and the disclaimer line.
- **Prospect discovery**: needs capture (category cards → Must/Preferred/Not), suggested units ranked by match.
- **Holds**: request dialog (category, until, reason), approvals queue (Projects head), list with expiry countdown.
- **Book unit**: applicants (residency), commercial terms, payment plan picker, approvals status; creates the booking and opens 17's packet.
- Mobile 375: cards single column; compare as swipeable.

## Events
`prospect.created`, `need.captured`, `match.computed`, `hold.requested/approved/rejected/expired/released/consumed` (Appendix B "hold.*" extension), `booking.created` (Appendix B).

## Config
filter thresholds, match weights, hold policy, closing lead days.

## Acceptance
p35 §30.5 t4, t6, t8, t9, t10 · p31–32 §26 three Sales bullets · rule tests 1–9 · Playwright: filter → compare 3 → prospect needs → match with disclaimer → hold → approve → book → packet opens.

## Depends on / Feeds
Depends on 04, 07, 08, 06, 14, 19, 25, 10. Feeds 17, 18, 27.

## Files
`services/api/src/sales/**` (replace inventory parts of `bookings.ts`/`readiness` views), `services/api/migrations/0022_sales.sql`, `apps/workspace/src/pages/sales/Inventory*.tsx`, `Compare*.tsx`, `Prospect*.tsx`, `Holds*.tsx`, `BookUnit*.tsx`, Studio tab.

## Not in this feature
CRM handover packet (17), change request (18), pricing engine/cost sheets beyond base price and discount.

## Build note (2026-09-06, backend)
Migration is `0034_sales.sql` (0022 was taken): `prospect`, `prospect_personalisation_need`, `unit_requirement_match`, `hold_policy`, `change_window_hold`, `sales_policy` (filter thresholds, match weights, filter→category mapping); `booking` gains `prospect_id`, `discount_inr`, `approval_action_id`, `personalisation_context`. `inventory_view` is `sales/inventory.ts::listInventory`. Built additively next to `bookings.ts::createBooking` (17 test files depend on its shape) — `sales/booking.ts::bookFromInventory` is the rule-8 path (DRAFT, applicants as `customer` rows with residency, discount approval through 25's matrix, needs copied, holds CONSUMED; CONFIRMED by `confirmInventoryBooking` once the approval is Closed, or by the `payment.received` subscriber). Rule 1: possession window is banded around the nearest planned handover date by construction % (06 has no per-unit forecast — UNCONFIRMED bands); Ready-to-Move uses the unit-scoped gates only (readiness ≥ threshold, QA approved, utilities, no critical snag — an available unit has no booking-scoped gates); named filters come from `sales_policy.filter_categories` over the four real categories (bathroom absent until a category exists). Rule 2: chips carry `display_state` (VERIFICATION_REQUIRED never shown as OPEN), `source_at`, `held_until`. Rule 3: 3–4 units. Rule 4: `sales/match.ts::computeMatch` with the disclaimer always appended. Rule 5: `gate.state_changed` subscriber recomputes stored matches for ACTIVE prospects; STALE past `match_stale_hours`. Rule 6: `hold_policy` (approver SITE = Projects, max 14 d / 5 active, UNCONFIRMED); 08's `evaluateUnit` clamps a held category to its prior state (OPEN baseline when never evaluated); 07's bulk preview flags `held`; expiry on read + `scanHolds(asOf)`. Rule 7: no write to 07/08 from `sales/**`. Rule 9: `markProspectLost` keeps needs; `lostRequirementAnalytics`. No `sales` matrix module → STAFF read, SALES/MANAGEMENT/SUPER_ADMIN write; booking gated on `sales_handover` WRITE like the pre-24 path. Screens and Studio UI deferred.
