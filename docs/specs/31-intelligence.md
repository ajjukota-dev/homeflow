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

## Build note (2026-09-07, UI landing)

Finished landing the UI whose backend/code was already on `main` (commit `7172207`, an
auto-checkpoint — see `CLAUDE.md`'s own note on that mechanism): `ScoreCard` usage on Booking 360
(Financial Health / Journey Risk, rule 7's drivers+confidence), the `Suggestions` inbox (6 kinds,
role-gated, accept/reject, override text), and two Policy Studio tabs (Risk rules — via the generic
table-editor registry, already fully built, not something this pass had to add; LLM budget & usage
— bespoke read-only dashboard). Two corrections to the prior handoff's own briefing, checked
against the actual code before doing anything: a dedicated `ScoreCard` component did **not** need
building — it already existed (`packages/ui/src/components/ScoreCard.tsx`, built during spec 28)
and was already wired on Booking 360; a Risk Rules Studio tab was **not** missing — it's served by
the generic `registry.ts`/`RowEditor.tsx` table-editor mechanism, with `Shell.test.tsx` already
asserting it. The real remaining gap was verification, a genuine bug fix, and polish, not
component-building.

**One real bug found and fixed — a stale-async-response race in `Suggestions.tsx`:** its
`useEffect(() => { setTasks(null); load(); }, [kind])` had no guard against out-of-order responses.
Switching tabs quickly (SUPER_ADMIN mounts on `visibleKinds[0]` = `COMMITMENT_DETECTION`, then the
"QA suggests a root cause..." e2e test immediately switches to `SNAG_ROOT_CAUSE_SUGGESTION`) let the
initial-mount fetch resolve *after* the tab-switch fetch, silently overwriting the correct rows with
the wrong kind's — reproduced deterministically (`intelligence.spec.ts` line ~127 failed 2/2 runs in
isolation, "element was detached from the DOM, retrying" on the Reject click, because the card had
vanished from state between being asserted visible and being clicked). Fixed with the standard
"latest request wins" pattern — a `useRef` sequence number that discards a response if a newer
request has since been fired — plus a belt-and-suspenders `t.kind === kind` filter on the rendered
list, so a wrong-kind row can never render even if a future refactor reintroduces a race elsewhere.
Same general bug class ("an assertion raced an async fetch") specs 23/29 already document finding
elsewhere in this codebase.

**Two more real bugs, both found during this pass's screenshot/UI review, both fixed:**
- `snag-root-cause.ts` only ever `SELECT`ed the legacy `trade`/`location` columns for its LLM
  prompt. A snag created via the current `room`/`category` shape (which is what the QA flow and its
  own e2e test both use) has `trade`/`location` as `NULL`, so the model prompt read `trade: null;
  location: null` — degraded prompt quality, no error, easy to miss. Fixed to `SELECT` all four
  columns and fall back (`trade ?? category`, `location ?? room`) so either shape produces a usable
  prompt.
- Policy Studio's sidebar showed a "not built" badge on the "LLM budget" tab (`Shell.tsx`) even
  though it renders a real, working dashboard with live month-to-date numbers — the badge condition
  only checked the generic-CRUD-table `built` flag (correctly `false` here, there's no config table
  to CRUD) and had no idea `BESPOKE_TABS` gives this tab real content anyway. Actively misleading:
  a user would see "not built" and reasonably not click it. Fixed the condition to
  `!t.built && !BESPOKE_TABS[t.key]`; verified via screenshot (`studio-llm-usage-desktop.png`) that
  "LLM budget" now shows unbadged next to "Risk rules", both spec 31's tabs.

**A fourth, test-only bug also fixed:** the 3 `suggestions-inbox-@{desktop,tablet,mobile}`
screenshot tests clicked into Suggestions and screenshotted right after the heading appeared,
racing the tab's own data fetch — the saved screenshots were genuinely blank (no skeleton, no empty
state, nothing painted), reproduced deterministically across repeated runs. Not an app bug —
manually reproducing the same navigation in a live browser rendered correctly every time. Fixed by
waiting for `page.waitForLoadState("networkidle")` before screenshotting (an earlier attempt to fix
it by awaiting the specific `waitForResponse` wasn't sufficient — the response settling doesn't
guarantee React has committed and painted before the screenshot's own frame).

**Real verification, from a freshly-reset DB (`npm run db:reset`), read for real, not assumed:**
- `intelligence.spec.ts`: **8/8 passed** in a single clean run (`npx playwright test
  e2e/intelligence.spec.ts`, 11.6s). Also passed as part of a full-suite run (`npx playwright test`,
  185/193 passed, single worker, 6.2m) with zero intelligence-spec failures.
- Full Playwright suite: 185 passed, 7 failed, 1 skipped (193 total). All 7 failures are in files
  this pass never touched (`admin-model.spec.ts`, `communications.spec.ts` ×2,
  `handover-gates.spec.ts` ×2, `post-handover.spec.ts`, `visual.spec.ts`) — consistent with
  `playwright.config.ts`'s own documented `workers: 1` DB-sharing flakiness ("3 identical full-suite
  runs, 2-5 different failures each time, including once on a clean main baseline"), not a
  regression from this pass.
- Backend vitest, full suite: 713 passed, 7 failed, 69 skipped (789 total) on the first (resource-
  contended, 3 dev servers + vitest all running at once) pass; re-running just the 6 failed suite
  files in isolation dropped that to **1 real failure**, confirming the other 6 were resource-
  contention timeouts, not real breakage. The 1 genuine failure — `management.test.ts` rule 6
  (`expected 30000 to be 25000`) — predates this pass entirely (`git log` shows it's spec 27's own
  code, last touched by PR #66, nothing this pass changed); flagged here rather than fixed, out of
  this pass's scope.
- `services/api/src/intelligence/intelligence.test.ts`: 15/15 passed (re-run after the
  `snag-root-cause.ts` edit, to confirm the fallback change didn't break the existing rule-1-7
  coverage).
- `Shell.test.tsx` (frontend): 2/2 passed (re-run after the "not built" badge condition change).

`advisor()` reviewed this pass's diagnosis and fix plan before the `Suggestions.tsx` fix was
written; its main correction — verify the fix under both possible root-cause mechanisms (a stale
duplicate response vs. a genuine remount), not just the one favoured by reasoning — is why the
`t.kind === kind` filter was added alongside the seq-number guard rather than the guard alone.

**Deliberate non-fix, flagged not built:** `risk_rule` has no `wired`/`unconfirmed`-style column
(unlike `escalation_rule.wired` from spec 12 or `dlp_policy`/`snag_sla_policy.unconfirmed` from spec
30) to surface in the Studio UI that editing a row currently affects zero live scores (see this
file's own earlier build note: "no scorer reads it"). Not added — a schema change, and CLAUDE.md's
own boundary is "ask first" on DB schema/migrations; noted here for whoever picks it up.
