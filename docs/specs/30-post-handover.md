# 30 — Post-handover: move-in, DLP/warranty, Home Passport, service history, check-ins, advocacy

## Purpose
p17 §8.14: move-in tasks + FM onboarding; warranty/DLP case management; Digital Home Passport (equipment, serials, manuals, warranties); service history on the unit; 7/30/90-day and DLP-closure check-ins; referral/testimonial workflow. Existing `warranty.ts`, DLP windows, passport items, check-ins (score validated PR #4; UI hardcodes 5) are the base.

## Data
| Table | Columns |
|---|---|
| `post_handover_case` | `id`, `booking_id`, `unit_id`, `project_id`, `handover_completed_at`, `move_in_tasks jsonb` {facility_intro_done, maintenance_setup_done, owner_record_transferred, warranties_shared, pending_snag_monitoring, utilities_transferred, association_membership} **[E §10.3 H12]**, `status ∈ {ONBOARDING, IN_DLP, DLP_CLOSED, CLOSED}`, `fm_owner_user_id` |
| `dlp_policy` | `project_id?`, `product_type`, `windows jsonb` [{category, months}] (e.g. structural 60, waterproofing 24, electrical/plumbing 12, fittings 6 — `DEFAULT_UNCONFIRMED`), `response_sla_by_severity` → 06 policies |
| `warranty_case` | `id`, `unit_id`, `booking_id`, `raised_by_kind ∈ {CUSTOMER_PORTAL, FM, CRM}`, `category`, `severity`, `description`, `in_coverage bool` (derived from `dlp_policy` + `handover_completed_at` + passport item warranty), `coverage_basis text`, `status ∈ {OPEN, TRIAGED, ASSIGNED, IN_PROGRESS, RESOLVED, CLOSED, REJECTED}`, `contractor_id`, `quote_inr?` (out-of-coverage → quotation via 18-style quote, customer accepts), `cost_inr`, `root_cause`, `snag_id?` (reuses 15 snag for execution/evidence), `sla_clock_id`, `customer_verified_at` |
| `passport_item` | `unit_id`, `kind ∈ {EQUIPMENT, FINISH, DOCUMENT, WARRANTY, CONTACT}`, `name`, `brand`, `model`, `serial`, `installed_on`, `warranty_until`, `vendor_contact`, `manual_file_id`, `spec_revision_id` (09 as-built link) |
| `service_record` | `unit_id`, `kind ∈ {WARRANTY_FIX, MAINTENANCE, INSPECTION, UPGRADE}`, `date`, `description`, `by`, `cost_inr`, `warranty_case_id?` |
| `advocacy` | `booking_id`, `kind ∈ {REFERRAL, TESTIMONIAL, REVIEW}`, `status ∈ {INVITED, RECEIVED, PUBLISHED, DECLINED}`, `content`, `referred_prospect_id?` (24), `at` |
| check-ins: `customer_check_in` (26) |

## Rules
1. On `handover.completed` (16) a case opens: move-in tasks as actions (10) to FM/CRM; DLP windows start from `handover_completed_at` per policy; passport pre-filled from 09 as-built + project equipment defaults; check-ins scheduled DAY_7/30/90 (26) and DLP_CLOSE.
2. Coverage: `in_coverage` derived (category window not expired, or passport warranty active); out-of-coverage cases get a quote (customer accepts in portal) before work — replaces the ₹1 placeholder; no work without acceptance or FM waiver with reason.
3. Warranty case lifecycle with SLA by severity (06/12); execution and before/after evidence via a linked snag (15); customer verification before CLOSED for customer-raised cases; root cause feeds 15 analytics and 31 (quality root cause).
4. Service history is append-only on the unit and visible in the portal passport (26).
5. Check-ins: prompt + email at day 7/30/90 and DLP close; 1–5 score validated; ≤ 2 → CRM action within 1 working day; scores feed Customer Health (31) and Experience KPIs (27). UI must capture the real score (fix hardcoded 5).
6. Advocacy: after a DAY_90 score ≥ 4, invite referral/testimonial (CRM publishes the invite — no auto-send); referral creates a prospect (24) with source REFERRAL.
7. `DLP_CLOSED` when all windows expire and no open cases; `CLOSED` after DLP-close check-in.

## API
`GET /bookings/:id/post-handover` · `PUT /post-handover/:id/move-in-tasks` · `GET/POST /warranty-cases`, `POST /warranty-cases/:id/triage|assign|quote|accept-quote|start|resolve|verify|close|reject` · `GET/PUT /units/:id/passport` · `GET /units/:id/service-history`, `POST /service-records` · `POST /advocacy/invite`, `PUT /advocacy/:id` · Studio `GET/PUT /dlp-policy`, `/check-in-schedule`.

## Screens
- **Post-handover** (FM/CRM): cases list (onboarding progress, open warranty cases, DLP windows remaining); case view (move-in checklist, DLP windows bar, warranty cases table, passport editor, service history, check-in scores, advocacy).
- Portal (26): Requests → raise service/warranty request (coverage shown after triage), Home Passport, check-in prompts with a real 1–5 control, referral invite.
- Studio: DLP policy, Check-in schedule.

## Events
`warranty.case_opened/case_closed` (Appendix B), `warranty.quote_issued/accepted`, `post_handover.onboarding_completed`, `dlp.window_expired`, `check_in.responded`, `advocacy.invited/received`.

## Config
DLP windows per product/category, SLA by severity, check-in schedule, advocacy thresholds.

## Acceptance
p17 §8.14 bullets each ≥1 test · Appendix B warranty events · rule tests 1–7 · Playwright: portal raise → triage in coverage → fix with evidence → customer verify → passport service history updated; out-of-coverage quote path.

## Depends on / Feeds
Depends on 16, 15, 09, 10, 06, 12, 26, 24. Feeds 26, 27, 31.

## Files
`services/api/src/post-handover/**` (replace `warranty.ts`), `services/api/migrations/0027_post_handover.sql`, `apps/workspace/src/pages/post-handover/**` (replace `PostHandover.tsx`), portal Requests/Passport pages, Studio tabs.

## Not in this feature
FM billing/maintenance fees; association management.
