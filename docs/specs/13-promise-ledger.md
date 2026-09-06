# 13 — Commitments: the Promise Ledger

## Purpose
p16 §8.11: "Promise, owner, beneficiary, due date, financial impact, approval and evidence"; internal vs customer-facing; pre-breach alerts + recovery plan; broken-promise rate by team and root cause; confidence from dependencies. Appendix A (p41) statuses: **Draft / Approved / Active / At Risk / Fulfilled / Breached / Waived-Cancelled**. P0 roadmap item (p28 §24). Makes the handover "Commitments" gate (16) real again (PR #7 currently reports "Not verified").

## Data
| Table | Columns |
|---|---|
| `commitment` | `id`, `code CMT-`, `project_id`, `booking_id`, `customer_id`, `unit_id`, `category ∈ {MODIFICATION, COMMERCIAL, TIMELINE, COMPLIMENTARY_ITEM, SPECIFICATION_UPGRADE, SERVICE, OTHER}` **[E §9]**, `description`, `committed_by_user_id`, `committed_at`, `source ∈ {SALES_HANDOVER, CRM, MANAGEMENT, COMMUNICATION, CHANGE_REQUEST}`, `beneficiary ∈ {CUSTOMER, INTERNAL}`, `customer_facing bool`, `owner_user_id` (required before ACTIVE), `responsible_department`, `due_date` (required before ACTIVE), `financial_impact_inr`, `approval_required bool`, `approved_by`, `approved_at`, `status`, `at_risk_reason`, `fulfilled_at`, `fulfilled_evidence_file_ids[]`, `customer_confirmed_at`, `breached_at`, `breach_root_cause ∈ {DEPENDENCY, RESOURCE, VENDOR, SCOPE_MISUNDERSTOOD, OVERPROMISED, CUSTOMER, FORCE_MAJEURE}`, `waived_reason`, `recovery_plan text`, `recovery_due_date`, `depends_on jsonb` [{type: ACTION|CHANGE_REQUEST|PROGRESS|DEMAND, id}], `confidence` (derived) |
| `commitment_transition` | `commitment_id`, `from`, `to`, `at`, `actor`, `reason` |

## Rules
1. Lifecycle: `DRAFT → APPROVED` (if `approval_required`, by `MANAGEMENT` or the configured approver role ≠ creator; else auto) `→ ACTIVE` (needs owner + due date) `→ FULFILLED` (evidence required; customer-facing ones additionally need `customer_confirmed_at` or CRM confirmation note) | `→ BREACHED` (system: due date passed, not fulfilled) | `→ WAIVED_CANCELLED` (reason; MANAGEMENT or CRM lead). `AT_RISK` is a derived-then-stored flag on ACTIVE (rule 3). No hard delete **[E conflict fixed]**.
2. Who may approve: default `MANAGEMENT` for `financial_impact_inr ≥ threshold` or category ∈ {COMMERCIAL, TIMELINE}; CRM lead otherwise — approver matrix in Policy Studio (client question #10 in the rules doc: Emergent = Management, our reading of the PDF = configurable).
3. Pre-breach: at `due_date − lead` (default 7 d, then 3 d, then 1 d — config) an action (10) "Commitment at risk" goes to the owner with escalation ladder; status becomes `AT_RISK` when any dependency is OVERDUE/BLOCKED or when within lead with no evidence. `recovery_plan` + `recovery_due_date` required to leave AT_RISK without fulfilling (p16 "recovery plan").
4. Breach is automatic at `due_date` end of day IST if not FULFILLED; owner must set `breach_root_cause` within 2 working days (action). Customer-facing breaches notify CRM for a customer update (26/29), never auto-message the customer.
5. Confidence = f(dependencies' SLA states, owner load, historical fulfilment rate of the department) — exposed with drivers (p8 §6 explainability).
6. Sales handover packet commitments (17) are created as DRAFT with `source = SALES_HANDOVER`; CRM must approve/activate before acceptance completes (p9 §8.1 "commitments made during sales captured").
7. Analytics: broken-promise rate = breached / (fulfilled + breached) by department, category, root cause, month; average days late; ₹ impact — feeds 27 KPIs (p24 §19 "commitment fulfilment %").
8. Open definition for the handover gate (16): any commitment on the booking with status ∈ {ACTIVE, AT_RISK, BREACHED, APPROVED, DRAFT} → gate open with the list as blockers; only FULFILLED/WAIVED pass.

**Build note (2026-09-05, backend merged):** `confidence` is computed at read time, never stored (same "never stored" treatment gates.md gave Emergent's own `overdue` flag). Rule 2's approver resolution is a direct in-code default, not `approvals/matrix.ts`'s `requiredApprovers("COMMITMENT",...)` — that lookup fails closed with zero seeded rows, which would block every approval until Policy Studio is configured; swap it in once a real band exists. Rule 6's SALES_HANDOVER auto-creation has no source yet (17 unbuilt). Rule 5's `depends_on` only resolves ACTION/DEMAND facts for real; CHANGE_REQUEST/PROGRESS score neutral. Rule 7 analytics endpoint deferred (no consumer, 27, built yet). Rule 8's handover gate is real (`handover.ts`/`qa.ts`), and stays **soft** — gates.md §B.2's own hard-gate list doesn't include commitments, despite the code comment it replaced claiming otherwise.

**Build note (2026-09-06, UI landed):** Promise Ledger (project-wide table, deliberately no create button), Customer 360's Commitments section (booking-scoped, owns the one "New commitment" affordance), and the detail drawer with all seven lifecycle actions now exist (`apps/workspace/src/pages/commitments/**`). Widened the backend read path first: added `getCommitment`/`CommitmentDetail` (`commitment_transition` history, a detail-only join like `actions/core.ts`'s `getAction`/`ActionDetail`) since the drawer's timeline needed real transition rows, not just the list-row shape. Real bugs found and fixed during live verification (Playwright MCP against the real dev DB, not just mocks — the mocked component tests had all quietly stubbed the gap away):
1. `Tooltip` crashes without a `TooltipProvider` ancestor — this component's first consumer anywhere in the app; fixed at the app root (`main.tsx`) plus locally in `ConfidenceBadge`.
2. A Card row's `min-w-0 flex-1` title sharing a flex row with two fixed-width badges shrank to ~53px instead of wrapping (flexbox lets a shrinkable item shrink rather than force a wrap) — fixed by switching that row to `flex-col sm:flex-row`, the same pattern `LegalFactory.tsx`'s row already uses. Regression-guarded in `e2e/commitments.spec.ts` by measuring the title/badge geometry directly (not `document.body.scrollWidth`, which `truncate`'s `overflow:hidden` keeps clean even with the bug present — verified by re-introducing the bug and watching the geometry assertion fail at ~84px before reverting).
3. The "At risk" banner stayed visible after a commitment reached FULFILLED, because the backend never clears `at_risk_reason` (it's audit history, not live state) — the drawer now only shows the live banner while `status === "AT_RISK"`; the Timeline section already carries it historically with a timestamp.
4. `Customer360.tsx`'s `canWriteCommitments` incorrectly included MANAGEMENT (matrix grants WRITE to CRM only, per this file's own Authorization note in `commitments/core.ts` — `createCommitment` has no MANAGEMENT override, unlike approve/waive). A MANAGEMENT actor would have seen "New commitment," submitted, and gotten a 403. Fixed to `CRM || SUPER_ADMIN`.
5. `QaHandover.tsx` still had a hardcoded "Commitments · Not verified" chip with a "No Promise Ledger yet" comment, even though `handover.ts`/`qa.ts` had already gone real on 2026-09-05 (rule 8's own comment there says "now real ... TODO.md task 6, closed"). The UI was never updated to match — the gate this spec's Purpose line calls out ("makes the handover 'Commitments' gate real again") was still fake in the one place a user actually sees it, a full day after the backend went real. Removed the special case; the gate now renders through the same generic Open/Passed branch every other hard gate uses. End-to-end acceptance test added in `e2e/commitments.spec.ts` ("handover gate integration: ..."), verified against the real API + UI on a real QA-eligible booking, and mutation-tested (reverted the fix, watched the assertion fail, restored it).

Scope cuts, both matching existing precedent rather than inventing new ones: no file-upload UI exists anywhere in this codebase yet, so Fulfil takes a free-text "Evidence reference(s)" field, honestly labeled, instead of a fake upload flow (`ActionDrawer.tsx`'s own header comment already flagged this gap); no user-lookup endpoint is available to CRM (`/api/admin/users` needs `administration` WRITE, MANAGEMENT/SUPER_ADMIN only), so `owner_user_id` is a free-text input, not a picker, same as `ActionDrawer`/My Day's Team view. Live-verified end to end against the real API: created a real commitment on Rohan Desai / Villa V113 (East Crest) and drove it through APPROVED → ACTIVE → AT_RISK (with a recovery plan) → FULFILLED, all against the real backend, not mocks.

## API
`GET /bookings/:id/commitments` · `POST /commitments` · `POST /commitments/:id/approve|activate|fulfil|waive|set-at-risk|recovery-plan|root-cause` · `GET /commitments?status&owner&department&due_before&project_id` · `GET /commitments/analytics?project_id&from&to`.

## Screens
- **Promise Ledger** (CRM): table with status chips, due, owner, ₹ impact, confidence with drivers tooltip, customer-facing badge; filters; row → detail drawer (timeline, dependencies, evidence upload, recovery plan, root cause).
- Booking 360 / Customer 360 → Commitments tab (same component).
- Management → Broken-promise analytics (bar by department/root cause, trend line, drill to list).
- Portal (26) shows customer-facing commitments only: description, due, status label ("On track / Delayed — new date …"), never root cause or owner.

## Events
`commitment.created`, `commitment.status_changed`, `commitment.at_risk`, `commitment.breached`, `commitment.fulfilled`, `commitment.waived`.

## Config
approver matrix, pre-breach leads, root-cause list, categories, ₹ threshold — Policy Studio.

## Acceptance
p31 §26 "Every customer-facing commitment has owner, due date, status, dependencies and evidence" · Appendix A statuses exact · rule tests 1–8 · handover gate integration: seeded booking with one ACTIVE commitment → gate `commitments` open with blocker text naming the commitment; fulfil → gate passes (replaces PR #7's "Not verified").

## Depends on / Feeds
Depends on 10, 12, 04, 01. Feeds 16 (gate), 17 (packet), 26 (portal), 27 (KPIs), 31 (promise detection later).

## Files
`services/api/src/commitments/**`, `services/api/src/routes-commitments.ts`, `services/api/migrations/0028_commitments.sql`, `services/api/src/handover.ts` (gate input only), `apps/workspace/src/pages/commitments/**` (PromiseLedger, CommitmentDrawer, CommitmentsSection, CreateCommitmentDialog, CommitmentStatusChip, api.ts), `apps/workspace/src/pages/QaHandover.tsx` (renders the real commitments gate chip — no more hardcoded special case), `apps/workspace/e2e/commitments.spec.ts`; no separate analytics page yet (rule 7, deferred above).

## Not in this feature
AI promise detection from communications (31). Customer messaging (29).
