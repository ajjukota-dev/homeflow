# 14 — Readiness scores (Unit · Customer/Booking · Handover) and the score contract

## Purpose
p7–8 §6: five scores, each with "current value, trend, top three drivers, confidence level, and recommended actions"; this spec builds three — **Unit Readiness**, **Customer/Booking Readiness**, **Handover Readiness** — and defines the shared score contract used by Customer Health and Financial Health (19/31). "Readiness separation" is a P0 item (p28 §24). Existing `readiness.ts` (evidence-based) is the base.

## Data
| Table | Columns |
|---|---|
| `score_snapshot` | `id`, `score_type ∈ {UNIT_READINESS, BOOKING_READINESS, HANDOVER_READINESS, CUSTOMER_HEALTH, FINANCIAL_HEALTH}`, `subject_type`, `subject_id`, `project_id`, `computed_at`, `value numeric(5,2)`, `trend ∈ {UP, FLAT, DOWN}`, `drivers jsonb` [{code, label, contribution, fact}] (exactly 3, ordered), `confidence ∈ {HIGH, MEDIUM, LOW}`, `confidence_reason`, `actions jsonb` [{action_type, title, target}], `inputs_hash` |
| `score_weight` | `score_type`, `component`, `weight`, `effective_from/to`, `version` — Policy Studio "score weights/thresholds" |

Score contract (TypeScript `Score` type, shared): `{ value, trend, drivers[3], confidence, actions[] }` — every score endpoint returns exactly this shape (p8 §6).

## Rules
1. **Unit Readiness** = Σ over `component_definition` (07) of weight × component state value, where value = VERIFIED 1.0, COMPLETE (site-declared, not QA-verified) 0.7, IN_PROGRESS by checklist share, NOT_STARTED 0; components flagged `evidence_required` with no verified evidence cap at 0.7 (p16 §8.8 "site declaration and independent QA verification as separate states"). Weights seed **[E §10.2]** 14 components; PLOT uses its own component set. Drivers = three largest (weight × shortfall). Confidence LOW if any input STALE (07) or common-area dependency unknown. Actions = "Verify <component>", "Close <n> snags", "Upload evidence for <component>".
2. **Customer/Booking Readiness** = weighted: documents verified share (17/22), payments (clearance status 19: cleared 1.0 / due ≤ threshold 0.6 / overdue 0), TDS verified, loan state (if applicable), agreement executed, registration done, customer-side actions closed (WAITING_CUSTOMER count). Weights config. Drivers name the blocking item ("TDS challan pending 12 d"). Actions link to the owning module's action.
3. **Handover Readiness** = min-gated composite: if any HARD gate (16) is open → value capped at 69 and driver #1 is that gate; else weighted blend of Unit Readiness, snag position (critical open → cap), documents, commitments (13: −N per open, config), FM/community readiness, customer readiness. Thresholds Green ≥ 90 / Amber ≥ 70 / Red < 70 **[E §10.3]** as config. Predicted handover date + confidence from 06 forecast.
4. Trend = sign of change vs the snapshot 7 days earlier (config window). Snapshots are taken on every relevant event (debounced 1 min) and nightly; history kept for the trend chart and KPIs.
5. Every score is explainable "down to component/blocker level" (p31 §26): `GET …/explain` returns the full contribution table, not just the top 3.
6. No score is typed by a user; there is no manual override of a score value (p32 §27). Overrides exist only on gates (16) with authority.
7. Customer-visible projection (26): value bands only ("On track / Needs attention"), never internal drivers naming employees/vendors (p18 §11).

## API
`GET /units/:id/scores/unit-readiness` · `GET /bookings/:id/scores/booking-readiness` · `GET /bookings/:id/scores/handover-readiness` · `GET …/explain` · `GET /projects/:id/readiness?node_id` (heatmap of unit readiness) · `GET/PUT /score-weights` (Studio) · internal `recompute(scoreType, subjectId)` subscribed to `progress.*`, `snag.*`, `document.*`, `payment.*`, `commitment.*`, `gate.*`.

## Screens
- **ScoreCard** component (reused): dial value + trend arrow, three driver lines with facts, confidence badge with reason, action buttons. Existing `ScoreDial` extended.
- Unit 360 header, Booking 360 header, QA screen, Handover screen use ScoreCard; Project readiness heatmap for Site/Management.
- Studio → Score weights (per score type, product), thresholds.

## Events
`score.recomputed` (type, subject, value, from → to) — used by 27 for portfolio trends.

## Config
`score_weight`, thresholds (90/70), commitment penalty, evidence cap, trend window.

## Acceptance
p31 §26 "Every readiness score is explainable down to component/blocker level" · p8 §6 contract test on all three endpoints (value, trend, 3 drivers, confidence, ≥1 action when < 100) · rule tests 1–7 · regression: seeded unit with flooring COMPLETE but not VERIFIED scores lower than the same unit VERIFIED.

## Depends on / Feeds
Depends on 07, 15, 16, 13, 19, 22 (inputs may be null until those land; the function degrades gracefully with LOW confidence and a driver "Data not yet available: <module>"). Feeds 16, 24, 26, 27, 28.

## Files
`services/api/src/scores/**` (`unit-readiness.ts`, `booking-readiness.ts`, `handover-readiness.ts`, `contract.ts` — pure functions), `services/api/src/readiness.ts` (migrate/retire), `services/api/migrations/0012_scores.sql`, `apps/workspace/src/components/ScoreCard.tsx`, `apps/workspace/src/pages/site/ReadinessHeatmap.tsx`, Studio tab.

## Not in this feature
Customer Health / Financial Health computation (19, 31) — they only reuse the contract. Gate definitions (16).
