# 31 — Intelligence layer (rules first; OpenAI for text tasks)

## Purpose
p18 §10: "build intelligence services first, no chatbot"; services — journey risk, next best action, collection risk, commitment risk, sentiment, document intelligence, quality root cause, profitability leakage; copilots last (P2). p8 §6 score contract (14) for **Customer Health** and **Financial Health**. p32 §27: no unexplained scores, no AI auto-send. TODO §7 #9: rules first; LLM (OpenAI via `llm` port) only where rules can't.

## Data
| Table | Columns |
|---|---|
| `score_snapshot` (14) | adds `CUSTOMER_HEALTH`, `FINANCIAL_HEALTH` types |
| `risk_rule` | `service ∈ {JOURNEY_RISK, COLLECTION_RISK, COMMITMENT_RISK, CUSTOMER_HEALTH, FINANCIAL_HEALTH}`, `signal`, `condition`, `weight`, `driver_text`, `effective_from/to`, `version` — Policy Studio |
| `llm_task` | `id`, `kind ∈ {COMMITMENT_DETECTION, COMMUNICATION_SUMMARY, SENTIMENT, DOCUMENT_FIELD_EXTRACTION, DOCUMENT_INCONSISTENCY, SNAG_ROOT_CAUSE_SUGGESTION}`, `input_ref`, `output jsonb`, `confidence`, `model`, `tokens`, `cost_inr`, `reviewed_by`, `accepted bool`, `at` — every LLM output is a **suggestion** until a human accepts |
| `llm_call` (03) | audit of raw calls |

## Rules
1. **Customer Health** (14 contract) = rules over: check-in scores (30), open escalations (12), overdue ₹ and days (19), breached/at-risk commitments (13), unresolved inbound comms (29), pending customer actions age (10), sentiment (if accepted). Drivers name facts, never staff.
2. **Financial Health** (booking/project) = rules over: true-risk share, forecast variance (20), loan gap (21), waiver leakage (19/27), clearance status.
3. **Journey risk** per booking = rules over SLA states, slippage vs baseline (06), dependency chains blocked, gate freshness (08); **Collection risk** per demand = 20 probability inverse + reason category + customer health; **Commitment risk** = 13 confidence inverse. All exposed via `/scores/*` with value/trend/3 drivers/confidence/actions and used by 11 (ranking inputs), 27 (interventions).
4. **Next best action** = deterministic: for a booking, the open action with the highest 11 score plus a rule-based "recommended" from the decision pack options (12); never free-text advice.
5. **LLM tasks** (via `llm` port, OpenAI, JSON-schema outputs, temperature 0):
   - Commitment detection on logged communications (29): proposes {description, category, due_date?, beneficiary} → CRM accepts/edits → 13 DRAFT commitment (p16 §8.11 "AI promise detection" P1).
   - Communication summary & sentiment (29) — stored as suggestions; sentiment feeds Customer Health only after CRM accepts or after 30 d unreviewed? **No** — only accepted values feed scores (explainability).
   - Document intelligence (22): extract fields from uploaded KYC/challans (PAN, name, dates) to prefill validation; flag inconsistencies between generated document data snapshot and source records; never auto-accepts a document.
   - Snag root-cause suggestion (15) from description + photos (text only initially).
   Every call logs tokens/cost; a monthly budget cap (env) stops LLM tasks (features keep working rule-based) — S8 proves the wiring.
6. No chatbot, no copilot until P2 (p32 §27; p29 §24). Copilot scope when it comes: role-specific "explain this screen/next steps" over the same rules — out of scope here.
7. Every score/suggestion in the UI shows "Why" (drivers) and, for LLM outputs, an "AI suggestion — review" badge with accept/reject.

## API
`GET /bookings/:id/scores/customer-health|financial-health|journey-risk` · `GET /demands/:id/risk` · `GET /bookings/:id/next-best-action` · `POST /llm/tasks {kind, input_ref}` · `GET /llm/tasks?kind&status` · `POST /llm/tasks/:id/accept|reject` · `GET /llm/usage` · Studio `GET/PUT /risk-rules`, `/llm-budget`.

## Screens
ScoreCards (14) on Customer 360 / Booking 360 / Control Tower; "Suggestions" inbox per role (CRM: detected commitments, summaries; Legal/CRM: document extractions and inconsistencies; QA: root-cause suggestions) with accept/reject; Studio: Risk rules, LLM budget/usage.

## Events
`score.recomputed` (14), `llm.suggestion_created/accepted/rejected`, `llm.budget_exhausted`.

## Config
risk rules and weights, LLM model/budget, which tasks are enabled per project.

## Acceptance
p8 §6 contract on all five scores · p18 §10 services exist rule-based (tests per service on seeded data) · p32 §27 negative tests: no endpoint sends customer messages from LLM output; no score without drivers · rule tests 1–7 · S8 proof (one OpenAI call, cost logged) · fake-LLM adapter used in CI.

## Depends on / Feeds
Depends on 14, 10, 11, 12, 13, 19, 20, 21, 22, 29, 30, 03 (llm). Feeds 11, 27, 26 (health bands only).

## Files
`services/api/src/intelligence/**` (`customer-health.ts`, `financial-health.ts`, `journey-risk.ts`, `next-best-action.ts`, `llm-tasks/*.ts`), `services/api/migrations/0028_intelligence.sql`, `apps/workspace/src/pages/Suggestions*.tsx`, Studio tabs.

## Not in this feature
Chatbot/copilots; vendor learning models; ML training.

## Build note (2026-09-06)

Backend built: `intelligence/{customer-health,financial-health,journey-risk,collection-risk,
commitment-risk,next-best-action,shared}.ts`, `intelligence/llm-tasks/{store,commitment-detection,
communication-summary,document-intelligence,snag-root-cause,index}.ts`, `routes-intelligence.ts`,
migration `0046_intelligence.sql` (sequential build-order numbering, not spec-number — same
convention every prior spec used). 15 tests in `intelligence.test.ts` (rules 1-7 + events coverage),
all real seeded fixtures (`c_karthik`/`b_v110`/`d_v110_3`), real seeded `user` ids
(`user_crm`/`user_fm`) for actor FKs. `tsc --noEmit` clean; full suite green except the
pre-existing Windows vitest worker-pool contention flake in `documents.test.ts`/
`registration.test.ts` (both re-verified passing in isolation).

**Two bugs caught by advisor before landing, both fixed:**
- `llm-tasks/store.ts::withinBudget` read `LLM_MONTHLY_BUDGET_INR=0` as "unset" because
  `Number("0")` is falsy — a zero budget (meant to stop all LLM spend) was silently treated as
  unlimited. Fixed to distinguish `undefined`/`""` (unlimited) from any parsed number including 0
  (a real cap). Added a test asserting `"0"` blocks every task.
- `collection-risk.ts::computeCollectionRisk` called `computeCustomerHealth` (which persists a
  `CUSTOMER_HEALTH` snapshot as a side effect via `recordScore`) as part of computing a demand's
  risk — so `GET /demands/:id/risk` was silently writing a snapshot for a different subject
  (the customer) on every read. Same write-on-read class advisor caught at specs 16, 27, and 28.
  Fixed by switching to `explainCustomerHealth` (identical computation, no persistence).
  `financial-health.ts` also collapsed a redundant duplicate `bookingFinance()` call surfaced
  during the same review (harmless, just wasteful).

**Corrections to inherited/prior work, self-caught before writing any test:**
- `journey-risk.ts`'s dependency-blocked driver was first written against
  `GateState === "BLOCKED"` — `GateState` (`changeability/gates.ts`) has no such value
  (`OPEN|CLOSING|CONDITIONAL|EXCEPTION_ONLY|HARD_CLOSED`). The real signal is
  `stage_instance.status = 'BLOCKED'`, a genuine CHECK-constrained value
  (`migrations/0005_journey_instances.sql`) already exposed on `JourneyReadModel.stages[].status`.
  Fixed before running any test.
- Spec 30's own landed `post-handover/warranty.ts` header comment claims `snag` "has no room
  field, incompatible category enums" as the reason `warranty_case.snag_id` is left unwired.
  Checked against `qa/snags.ts::insertSnag` and `migrations/0032_qa.sql`: **this is false** —
  `snag.room`, `snag.category`, and `snag.root_cause` all exist as real columns (added by 15's own
  migration), and `warranty_case.category` (from `0000_init.sql`) has no CHECK constraint at all
  (freeform text). Both stated reasons are unfounded. Did not reopen spec 30's merged PR #50 to fix
  a comment (surgical scope discipline) — instead wrote 31's own `snag-root-cause.ts` to correctly
  write `snag.root_cause` on accept, and record this finding here for the record. The
  `warranty_case.snag_id` linkage itself remains unwired — that's still open follow-up, just not
  for the reason spec 30's comment gives.

**Spec-document gap fixed, not code:** `studio/registry.test.ts`'s "no invented tabs" test parses
`25-policy-studio.md`'s own master "## Tabs" line as the authoritative tab list; that line had
never been updated past spec 30, even though 31's own Screens section explicitly names "Studio:
Risk rules, LLM budget/usage." Appended `· 31 Risk rules, LLM budget.` to `25-policy-studio.md`
line 23 — a spec-document correction (spec is authoritative; it had a real omission), not an
invented tab.

**Deliberate deviations/gaps, all flagged in code:**
- `GET /api/commitments/:id/risk` added — the spec's API section shorthand list only names
  customer-health/financial-health/journey-risk plus `/demands/:id/risk`, but rule 3 says
  commitment risk is "All exposed via `/scores/*`"; added symmetric with the demand-risk route.
- `DOCUMENT_FIELD_EXTRACTION` is close to unusable as shipped: the `llm` port's `LlmCompleteInput`
  is text-only (no image/file field) and `customer_document.file_keys` are opaque object-store keys
  with no OCR anywhere in the codebase, so this kind can only pass category/filename metadata to
  the LLM (confidence defaults to 0.1). "6 LLM task kinds built" should not be read as "6 working" —
  this one needs real OCR/vision before it's useful. `DOCUMENT_INCONSISTENCY` has no such gap (a
  genuine text/JSON comparison of `doc_factory_document.data_snapshot` against source records).
- `risk_rule` is seeded (19 rows, `seed/intelligence.ts`) for Policy Studio visibility only — no
  scorer reads it; the in-code weight constants in each `*-health.ts`/`*-risk.ts` file are
  authoritative, same precedent as 14's own `score_weight` table. Don't expect editing a
  `risk_rule` row to change a score.
- `journey-risk` scores 0/LOW for the demo seed's `b_v110` because no `journey_instance` exists for
  it — the only journey-risk test coverage exercises the "no instance" branch, not the MEDIUM-
  confidence scoring math itself (SLA-state/slippage/blocked-gate/stale-gate weights). That branch
  is implemented but untested against real data in this seed.
- All weight constants (BASELINE=80 for Customer Health; the 5 Financial Health weights; the 4
  Journey Risk weights; PROBABILITY_WEIGHT/CUSTOMER_HEALTH_WEIGHT for Collection Risk) are
  UNCONFIRMED placeholders — no PDF number given, same convention as 14's own score weights.

**Fake-LLM-adapter design constraint:** `llm/fake-adapter.ts` returns `{fake: true, echo: ...}` for
any `json_schema` call under test, never a realistic structured output. Every "accept" flow
therefore requires the human's own explicit edited/override fields (matching rule 5's literal "CRM
accepts/edits" wording) rather than trusting raw LLM JSON — sidesteps the fake adapter entirely
rather than fighting it in tests.
