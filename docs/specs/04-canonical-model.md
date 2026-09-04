# 04 — Canonical model: Portfolio → Project → Hierarchy → Unit → Booking → Customer/Applicant

## Purpose
p4–6 §4: seven entities that "must persist independently" — Project/Phase/Tower, Unit, Booking, Customer, Applicant, Lifecycle Event, Action. "Attach it to the Unit if the fact is about the physical asset … to the Customer if about the human … to the Booking wherever the fact belongs to a particular customer-unit ownership relationship." Hierarchy keys mandatory on Unit; `project_id` immutable on Unit (p27 §22); derived `project_id` everywhere downstream, validated against Unit/Booking (p36 §31.1). Products: apartments, villas, plots (TODO §7 #10).

## Data
| Table | Columns |
|---|---|
| `portfolio` | `id`, `name` (single row "Pranava" seeded; kept for p21 §14 portfolio views) |
| `project` | `id`, `code` unique, `name`, `portfolio_id`, `product_type ∈ {APARTMENT, VILLA, PLOT, MIXED}`, `legal_entity`, `jurisdiction`, `rera_reg_no`, `escrow_account_ref`, `location`, `launch_date`, `planned_handover_date`, `status ∈ {PLANNING, ACTIVE, HANDOVER, CLOSED}`, `calendar_id` (06), `journey_template_version_id` (05) |
| `project_hierarchy_node` | `id`, `project_id`, `parent_id`, `kind ∈ {PHASE, TOWER, BLOCK, CLUSTER, FLOOR, STREET}`, `code`, `name`, `sort_order`, `planned_handover_date` — p36 §31.1 |
| `unit` | `id`, `code` unique per project (`UNT-` or user code), `project_id` **immutable** (trigger), `hierarchy_node_id` not null, `product_type`, `unit_type` (2BHK, 3BHK, Villa-A, Plot-30x40 …), `carpet_area_sqft`, `built_up_area_sqft`, `saleable_area_sqft`, `uds_land_share`, `plot_area_sqyd`, `facing ∈ {N,S,E,W,NE,NW,SE,SW}`, `floor_no`, `parking_count`, `base_price_inr` **[E §13]**, `sale_status ∈ {AVAILABLE, HELD, BOOKED, REGISTERED, HANDED_OVER, CANCELLED_RELEASE}`, `specification_baseline_id` (09) |
| `customer` | `id`, `code CUS-`, `primary_name`, `email`, `phone`, `alt_phone`, `pan`, `aadhaar_last4`, `passport_no`, `oci_no`, `residency ∈ {RESIDENT, NRI, OCI}` **[E §8.1]**, `address_*`, `communication_preference`, `language`, `merged_into_customer_id` (null) |
| `booking` | `id`, `code BKG-000001` **[E §13]**, `project_id` (derived from unit), `unit_id`, `customer_id` (primary), `status ∈ {DRAFT, CONFIRMED, SUBMITTED_TO_CRM, RETURNED, CRM_ACCEPTED, ACTIVE, REGISTERED, HANDED_OVER, CANCELLED, TRANSFERRED}`, `booking_date`, `agreement_value_inr`, `booking_amount_inr`, `payment_plan_id` (19), `sales_owner_user_id`, `rm_owner_user_id`, `predecessor_booking_id` (transfer/resale chain), `cancellation_reason`, `cancelled_at` |
| `booking_applicant` | `booking_id`, `customer_id`, `role ∈ {PRIMARY, CO_APPLICANT, POA, NOMINEE}`, `ownership_pct`, `sort_order`; exactly one PRIMARY; max 4 applicants **[E §13]** (config) |
| `unit_history` | append-only view over events: booking created/cancelled/transferred, registered, handed over — the "permanent unit history" (p5 §4.1) |

## Rules
1. `unit.project_id` cannot change (DB trigger + handler test). `hierarchy_node_id` must belong to the same project.
2. Any downstream insert carrying `project_id` must equal the Unit's/Booking's project; mismatch → `validation` (p36 §31.1). Implement once in `deriveProjectId(ctx, {unit_id|booking_id})`.
3. `booking.status` transitions: `DRAFT→CONFIRMED→SUBMITTED_TO_CRM→(RETURNED→SUBMITTED_TO_CRM)|CRM_ACCEPTED→ACTIVE→REGISTERED→HANDED_OVER`; `CANCELLED` from any non-terminal; `TRANSFERRED` from ACTIVE/REGISTERED creates a successor booking with `predecessor_booking_id`. Cancel/transfer require a reason. Unit `sale_status` follows: CONFIRMED→BOOKED, REGISTERED→REGISTERED, HANDED_OVER→HANDED_OVER, CANCELLED→AVAILABLE (history kept).
4. Exactly one PRIMARY applicant; `ownership_pct` sums to 100 when set.
5. Customer dedupe: `POST /customers/:id/merge {into}` marks `merged_into_customer_id`, re-points bookings/applicants, keeps both codes in history (p27 §22 "Deduplication and merge rules that preserve history"). A customer may span projects **[E §1.6]**.
6. `residency` drives conditional documents (17) and TDS defaults (19); changing it after CRM acceptance emits `customer.residency_changed`.
7. Product type: `unit.product_type` defaults from project; `MIXED` projects set per unit. Plots carry `plot_area_sqyd`, no floor/carpet.
8. Every mutation emits: `booking.created`, `booking.status_changed`, `booking.transferred`, `unit.created`, `unit.sale_status_changed`, `customer.created`, `customer.merged`, `applicant.added/removed`.

## API
`GET/POST /projects`, `PATCH /projects/:id` · `GET/POST /projects/:id/hierarchy` · `GET/POST /units`, `PATCH /units/:id` (Site/Admin only for physical fields; Sales may not edit) · `GET/POST /customers`, `POST /customers/:id/merge` · `GET/POST /bookings`, `POST /bookings/:id/confirm|cancel|transfer`, `PUT /bookings/:id/applicants`.

## Screens
Workspace Admin → Projects (master fields, hierarchy tree editor with drag order), Units (table per node, product-aware columns, bulk create from a range e.g. floors 1–12 × units A–D), Customers (search, merge with preview). Booking detail shows applicants with roles and ownership.

## Config
`MAX_APPLICANTS` (4), unit type catalogue per product, facing enum — Policy Studio "Project master + hierarchy".

## Acceptance
p31 §26: "Every active booking resolves to exactly one current unit and one or more valid applicants" · "Unit history remains intact when booking/customer changes" · "traced Portfolio → Project → Unit → Booking/Customer without duplicate manual project tagging" · p37 §31.5 t2 (receipt lands under correct project without manual selection — tested via rule 2) · rule tests 1–7.

## Depends on / Feeds
Depends on 01, 02. Feeds all.

## Files
`services/api/src/model/**` (projects, hierarchy, units, customers, bookings, applicants), `services/api/migrations/0003_canonical.sql` (alter existing tables; keep data), `services/api/src/seed/demo-*.ts`, `apps/workspace/src/pages/admin/Projects*.tsx`, `Units*.tsx`, `Customers*.tsx`.

## Not in this feature
Sales inventory UI (24), handover gate (17), pricing/cost sheets beyond `base_price_inr`.
