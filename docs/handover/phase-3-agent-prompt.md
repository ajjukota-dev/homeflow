# Phase 3 agent prompt — copy everything below the line into a new chat

Paste the block from `BEGIN PROMPT` through `END PROMPT` as the first message of a **new** Cursor chat on this repo. Do not add extra goals. When that chat finishes, paste its `## Phase 3 report` back into the planning chat for exit verification.

Phases 1 and 2 Day 2 are **closed**. Do not rewrite occupants. Do not start RLS.

---

BEGIN PROMPT

You are implementing **HomeFlow Phase 3 only** (exam-week interruptible slice: scheduler + quiet hours). This is a finished-product handover track, not a new feature brainstorm.

Read first, in this order, before writing code:

1. `CLAUDE.md`
2. `docs/CONTEXT.md`
3. `docs/specs/00-conventions.md`
4. This prompt in full
5. Specs you will actually touch: `docs/specs/19-collections-true-risk.md` (overdue sweep), `docs/specs/21-loan-management.md` (loan validity sweep), `docs/specs/24-sales-inventory-discovery.md` (hold expiry), `docs/specs/20-cash-forecast.md` (`takeSnapshot`), `docs/specs/29-communications.md` (frequency + quiet hours)
6. Existing callables (do **not** reimplement): `sweepOverdueDemands` in `services/api/src/collections-sweep.ts`, `sweepLoanValidity` in `services/api/src/loans/sweep.ts`, `scanHolds` in `services/api/src/sales/holds.ts`, `takeSnapshot` in `services/api/src/forecast/core.ts` (already accepts `ctx: undefined` for SYSTEM), `checkFrequencyGuardrail` / `getGuardrailStatus` / send path in `services/api/src/communications/core.ts`
7. Schema already has `frequency_guardrail.quiet_hours_start` / `quiet_hours_end` (Studio generic editor). They are **unread** on the send path today — that is 3.2. Notifications already honour per-user quiet hours in `notifications/core.ts`; do not rebuild that. Wire **customer send**.
8. Phase 2 hold to expire: Tanvi Joshi / `u_v101` / `kitchen_layout` / APPROVED with `approved_until` (today+7d at seed). Do not book V101/V104/V108. Do not call `scanHolds` from seed.

Follow TDD: failing test first. Do not commit or push unless I explicitly ask in this chat. Do not deploy. Do not call paid APIs. Do not start Phase 4–5. **Do not implement RLS / GUC threading / `0025_rls` / assertProjectScope / field masking / Queues.tsx.**

---

## Product (do not invent a second one)

HomeFlow is Pranava’s **post-booking OS** (token → keys → warranty). Spec authority: `docs/Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf`. Local stack: API `:3001`, workspace `:5173`, portal `:5174`. Reset: **stop the API first**, then `npm run db:reset` in `services/api`.

---

## Why this phase exists

Sweeps already exist as functions and some HTTP routes. Demo/local still needs an engineer to curl them. Holds do not expire until someone runs `scanHolds`. Forecast snapshots must not be a GET side effect. Quiet hours are stored in Policy Studio and ignored on send (`TODO.md` Found while building, spec 29 UI).

This phase is **interruptible exam-week work**. Keep diffs small. Stop rather than start RLS.

---

## Work items (IDs must appear in the report)

| ID | Do this | Done when |
|---|---|---|
| 3.1 | One scheduler process that calls the four existing sweeps | Overdue, loan-validity, hold-expiry, forecast-snapshot run on a clock when the **API server process** is up. Demo does not require curling `/sweep`. |
| e31-tests | Scheduler off or fake-clocked in tests | Vitest never starts `setInterval`. Jobs are functions with injected `asOf`. Suite does not hang on wall-clock. |
| e31-hold | Phase 2 hold actually expires via the job | Test: `scanHolds` / scheduler `runOnce(asOf)` with `asOf` **after** Tanvi’s `approved_until` (or a test-only hold you create). Status EXPIRED without a person clicking Expire. Do **not** shorten the demo hold in seed to 1 day. |
| e31-overdue | Overdue sweep runs from the job | `runOnce` calls `sweepOverdueDemands(asOf)`. Test with injected date, not `sleep`. |
| e31-loan | Loan validity sweep runs from the job | `runOnce` calls `sweepLoanValidity(asOf)`. Not write-on-read of a GET. |
| e31-forecast | Snapshot is a scheduled write | `runOnce` calls `takeSnapshot(projectId, "WEEKLY" or "MONTH_START", undefined, asOf)` for seeded projects (`p_eastcrest`, `p_meadows`). GET forecast / Control Tower must **not** insert a snapshot. Reload twice in a test: snapshot count unchanged. |
| 3.2 | Quiet hours + frequency on the **send** path | `getGuardrailStatus` / `checkFrequencyGuardrail` (and the function `sendCommunicationEmail` actually calls) read `frequency_guardrail.quiet_hours_start`/`end`. A send inside that window is **blocked or deferred** — communication row / error proves it; email must not go out. Frequency: second send inside `window_days` still blocked (already partly built — keep it; add a test if missing). |
| 3.3 | Not a code feature | One grep of seed for `INSERT INTO booking`. Confirm no chatbot added. Write a 5-line “exam-week PR review” checklist into `docs/handover/phase-3-pr-review.md` for the human. Do not watch GitHub all week. |
| e3-not-rls | Do not become RLS | Zero edits to `0025_rls.sql`, GUC `set_config`, `assertProjectScope` (except if you accidentally imported it — don’t). |

---

## How to build 3.1 (do not invent a second clock)

1. New module e.g. `services/api/src/scheduler/jobs.ts` + `start.ts`. Keep files ≤200 lines.
2. `export async function runOnce(asOf?: string): Promise<{ overdue: number; loans: number; holds: string[]; snapshots: string[] }>` — calls the four existing functions. `asOf` defaults to `todayIst()`.
3. `startScheduler()` uses `setInterval` (or equivalent). **No new npm dependency** (no `node-cron` unless I already have it — I do not). Cadence: one interval for local demo is enough (e.g. 60s or 5min from named env `HOMEFLOW_SCHEDULER_MS`, default 60_000). Do not invent East Crest–only hours.
4. Start **only** from `services/api/src/server.ts` after `listen`, and **only** when `HOMEFLOW_SCHEDULER` is not `"0"` / `"false"`. In vitest, `server.ts` is not the entry — still guard: if `process.env.VITEST` or `NODE_ENV === "test"`, do not start the interval.
5. HTTP sweep routes may remain for ops; they are not a substitute for the clock.
6. Forecast: iterate projects that exist (`SELECT id FROM project`). Swallow per-project errors into the return object / log; do not crash the interval.
7. Optional also-run (not required for exit): `scanEscalations`, `sweepExpiredQuotations`, `sweepDlpClosure`, `sweepLoanGapBreach`. If you add them, they must also take `asOf` and stay off in tests. Do not expand scope if 3.1 four jobs are not green.

---

## How to build 3.2

1. Extend `getGuardrailStatus` to return quiet-hours blocked when now (IST clock, `todayIst` / existing `nowIstHm` in notifications if reusable) falls in `[quiet_hours_start, quiet_hours_end)` including overnight windows (21:00–08:00). Reuse or extract `isWithinQuietHours` from `notifications/core.ts` rather than copying a buggy wrap.
2. `checkFrequencyGuardrail` throws a structured `AppError` when quiet (same family as frequency conflict). Override with CRM+reason may apply to frequency; **quiet hours still block outbound EMAIL/WHATSAPP/SMS** unless you find a spec override — default: quiet hours not overrideable by “customer escalated”. Report the choice under Assumptions.
3. Seed: `seed/communications.ts` currently inserts guardrails **without** quiet hours. You may set start/end on those rows to realistic values (e.g. 21:00–08:00) — that is config, not East-Crest-only code. Do not invent SOP rupees.
4. Tests: inject clock (pass `nowHm` or use a test hook). Do not `sleep` until 21:00.

---

## Invariants

1. Do not rewrite Phase 1/2 occupants. Tanvi’s hold stays APPROVED at seed time; expiry is the job.
2. Do not `INSERT INTO booking`.
3. Do not start chatbot, WhatsApp runtime, vendor portal, Google OIDC, AWS spend.
4. GET 360 / forecast / scores must not newly persist snapshots (Phase 1 e1-get still holds).
5. No new npm packages without asking me in this chat.
6. Handlers stay Express-free.

---

## Allowed files

- **New** `services/api/src/scheduler/` (jobs + start + tests)
- `services/api/src/server.ts` — start scheduler after listen only
- `services/api/src/communications/core.ts` + `communications.test.ts`
- `services/api/src/notifications/core.ts` **only** if extracting `isWithinQuietHours` to a tiny shared helper (e.g. `authz/clock.ts` or `communications/quiet-hours.ts`)
- `services/api/src/seed/communications.ts` — quiet hour defaults on existing guardrail rows
- `docs/handover/phase-3-pr-review.md` (new, short)
- `docs/demo/click-path.md` — one paragraph: scheduler runs with API; `HOMEFLOW_SCHEDULER=0` to disable
- `TODO.md` — CONTINUE HERE leftover + one Found while building bullet. Do not rewrite the status-board table.

Out of bounds: `apps/` unless a send-button must show the new error string. No RLS. No Queues. No occupant seed files. No infra/CDK.

---

## Tests you must add (fail first)

1. `runOnce` with a frozen `asOf` calls all four jobs (spy or assert side effects).
2. Importing scheduler module in vitest does **not** start an interval (assert no `setInterval` leak, or that `startScheduler` is not invoked).
3. Hold: create or use Tanvi’s hold; `runOnce(asOfPastExpiry)` → hold `EXPIRED`.
4. Forecast: `getForecast` twice → `forecast_snapshot` count unchanged; `runOnce` increments it.
5. Quiet hours: with guardrail 21:00–08:00 and injected 22:00 IST, send EMAIL is blocked; at 10:00 it is not (frequency permitting).
6. Frequency: two outbound template sends in window → second throws (keep existing behaviour).

Run, real counts in the report:

- `npm test` from `services/api` (unsandboxed if Playwright/pdf SIGSEGVs)
- Do not claim green without reading the output

---

## Forbidden claims

- Do not mark 3.1 done because HTTP `/sweep` still exists.
- Do not mark quiet hours done because Studio can edit the columns.
- Do not mark 3.3 done as “reviewed all PRs this week” — you cannot. Ship the checklist.
- Do not thread `SET LOCAL` role/GUC “while you’re in server.ts”.

---

## Your last message in this chat MUST be exactly this shape

```
## Phase 3 report

### Accomplished
- 3.1: [yes/no + files]
- e31-clock: …
- e31-tests: …
- e31-hold: …
- e31-overdue: …
- e31-loan: …
- e31-forecast: …
- 3.2 / e32-quiet: …
- e32-freq: …
- 3.3 / e33: …
- e3-not-rls: …

### Proof run
- Commands run (verbatim)
- API vitest: N passed / N failed / files
- Scheduler tests: …
- Communications tests: …

### Assumptions
Numbered list. If none: `None.`

### Out of scope (correctly not done)
RLS, Queues, Phase 2 leftover 2.6–2.16, chatbot.

### Files changed
Paths only.

### Known gaps vs Phase 3 exit
Anything in e31-* / e32-* you did not fully prove.
```

If 3.1 (clock + tests + hold expiry) or 3.2 quiet hours is no, the phase is **not complete**. 3.3 may be the checklist only.

END PROMPT
