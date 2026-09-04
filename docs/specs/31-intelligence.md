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
