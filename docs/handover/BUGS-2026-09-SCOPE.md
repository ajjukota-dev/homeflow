# HomeFlow — bug scope

25 Sep 2026. Scoped from `/Users/lakshmiprajnapenmetsa/Desktop/homeflow-bugs.md.txt` (23 Sep).

**Implement from a chat opened on** `/Users/lakshmiprajnapenmetsa/ExaverAI/HomeFlow`.  
Prompt: [BUGS-2026-09-NEW-CHAT.md](BUGS-2026-09-NEW-CHAT.md).

Owner signed: no more questions. Locked defaults are in the new-chat file and in **Looked up in the repo** below.

**Target window:** all five waves finish by end of day **26 Sep 2026**. One wave at a time. Do not start the next wave until the current wave’s tests are green.

---

## How to read this

| Label | Meaning |
| --- | --- |
| **Must** | Ship before the next real-user / multi-project walk |
| **Should** | Wrong answers or broken ops; do next |
| **Later** | Real gap — do not fake it |
| **Out** | Not this pass |

---

## Do not do in this pass

- Google sign-in, customer OTP
- Unbuilt Studio / dashboard screens
- Customer **Action Required** screen
- Fake AT_RISK or empty actions
- Full forecast-revision product (only plan→forecast in bug 2)
- `cdk deploy` unless the owner says yes

---

## Waves

| Wave | Items | Why |
| --- | --- | --- |
| **A — stop leaks** | 1, 5, 10, 9 | Project isolation, customer fields, CORS, reset throttle |
| **B — stop silent wrongness** | 8, 6, 11 | Scheduler lock, one URL owner, new migration |
| **C — trust the screen** | 2, 7 | Forecast follows plan; queue names |
| **D — engines, only what’s real** | 3, 4 | AT_RISK from data; action auto-close subscriber |
| **E — pipeline** | 12 | CI green; no deploy |

---

## Timeline

Waves A through E all finish by end of day **26 Sep 2026**. Order stays A → B → C → D → E. No per-wave clock.

---

## Wave checklists

The implementing chat does the wave. This chat checks the diff and re-runs the tests. A claim that tests passed is not a pass. A wave is successful only when every box in **Every wave** and that wave’s list is true. Then the next prompt.

### Every wave

- [ ] Diff touches only this wave’s bugs. Later waves are untouched.
- [ ] Tests for this wave exist, were run, and passed. Failures are not explained away.
- [ ] No fake `AT_RISK`, no empty or placeholder actions, no customer Action Required screen.
- [ ] No Google sign-in, no customer OTP, no `cdk deploy`, no spend.
- [ ] Anything that could not be verified is written down, not marked done.

### A — bugs 1, 5, 10, 9

Checked 26 Sep 2026. Re-ran the wave A tests. Not sent through the API on port 3001. Portal Passport was not opened in a browser. Chromium PDF tests were not re-run.

- [x] A user assigned only to Project A gets blocked on Project B read and write, including a guessed id. Management and Super Admin still see all.
- [x] Project-data routes call `assertProjectScope` (or the existing entity-scope helper). Role-only checks are not left on those routes.
- [x] Portal Passport does not return `vendor_contact`. A close name such as `internal_notes_v2` does not return either. A test fails if `vendor_contact` leaks.
- [x] `cors({ origin: true })` is gone. `http://localhost:5173` and `http://localhost:5174` are allowed. An unknown origin gets no credentialed CORS. Production reads `ALLOWED_ORIGINS` and does not fall back to any origin when that env is empty.
- [x] About 5 reset requests per hour per IP+email are allowed; the next is limited. Known and unknown emails get the same response. A normal reset still works. Tokens still expire after 1 hour.

### B — bugs 8, 6, 11

Checked 26 Sep 2026. Re-ran the six wave B test files (61 passed). `0045_post_handover.sql` was not edited. The seven PDF tests in `documents.test.ts` still fail because Chromium is not installed. The on-disk database on port 3001 was not migrated live.

- [x] If `runOnce` is still running, the next scheduler tick skips. It does not start a second copy and it does not queue one.
- [x] Warranty close has one HTTP owner: spec 30 `closeWarrantyCase`. The lifecycle `POST /api/warranty-cases/:id/close` route is deleted. `closeWarranty()` remains for tests that call it directly. The old HTTP close is not registered again.
- [x] Document URLs have one owner. The unused legacy path is folded in or deleted. Existing document and warranty tests pass.
- [x] No migration that already ran was edited. A new migration (or a checksum) makes a fresh database and an existing one the same schema.

### C — bugs 2, 7

Checked 26 Sep 2026. Re-ran the wave C API files (54 passed) and workspace files (18 passed). No live walk on :5173. Playwright queues.spec.ts was not run. On-disk DB was not reset.

- [x] Changing a plan date updates the forecast. The original plan is still stored. Lateness uses the new date.
- [x] No progress/SLA forecast engine and no SOP day counts were added.
- [x] Queues show the person’s display name. A missing name shows “Unknown”, not a raw id like `user_48291`.

### D — bugs 3, 4

Checked 26 Sep 2026. Re-ran `engine.test.ts`, `at-risk.test.ts`, and `subscribers.test.ts` (34 passed). Live UI and Playwright were not run. `commitment.fulfilled` / `commitment.waived` are subscribed but not separately tested. `payment.received` was proved by appending the event.

- [x] `AT_RISK` is shown only when it is computed from blocked, forecast after plan, or a dependency overdue. A case with none of those is not `AT_RISK`.
- [x] Journey clocks do not say “in progress” unless a task or action says so.
- [x] A subscriber auto-closes an action when its source closes (spec 10 rule 7). Existing in-process `createAction` call sites are not duplicated.
- [x] An event type whose module does not exist creates nothing. No blank action.
- [x] No Action Required page under `apps/my-pranava-home`.

### E — bug 12

Checked 26 Sep 2026. Re-ran `npm run typecheck` (pass), `npm test` (API 944 / workspace 192), `npm run build` and portal build (pass). GitHub Actions on the remote was not run. Nightly postgres-parity was not run. Live `:3001` was not curled. Docker image was not rebuilt in this check.

- [x] On a clean checkout, typecheck, test, and build are green.
- [x] The live commit sha is visible if that was easy to add.
- [x] The workflow does not deploy. `cdk deploy` was not run.

---

## Item by item

### 1. Users can see other projects’ data — **Must**

Routes check role, not project. Use existing `assertProjectScope` (`authz/scope.ts`) on every project-data read/write. Management / Super Admin still see all.

**Done when:** User on Project A cannot view/edit Project B (UI + API + guessed IDs). Super Admin still can.

### 2. Forecast doesn’t update when the plan changes — **Should**

Plan date change must update the forecast. Keep the original plan. Lateness uses the new date.

**Done when:** Change a plan date → refresh forecast → numbers move; original plan still stored.

### 3. Journey rules — **Should (bounded)**

See **Looked up → Q2**. Do not show AT_RISK until `atRisk` is computed. Do not paint “in progress” on journey clocks unless a task/action says so.

### 4. Events → actions — **Should (bounded)**

See **Looked up → Q3**. Add auto-close subscriber (spec 10 rule 7). Do not duplicate in-process `createAction`. No customer Action Required screen.

### 5. Internal data leaks to customers — **Must**

`portal/denylist.ts` is exact-name. `vendor_contact` still reaches the portal Passport. Fix prefixes / allow-list. Test for `vendor_contact`.

### 6. Duplicate document/warranty routes — **Should**

See **Looked up → Q4**. One HTTP owner. Delete dead lifecycle warranty close route. Do not bring it back.

### 7. Queues show raw IDs — **Should**

Show display name. Missing name → “Unknown”, not `user_48291`.

### 8. Scheduler overlap — **Must**

`scheduler/start.ts`: skip the next tick if `runOnce` is still going.

### 9. Password reset rate limit — **Must**

`auth/reset.ts`: ~5 / hour per IP+email. Same response whether the email exists. Tokens still 1 hour.

### 10. CORS wide open — **Must**

See **Looked up → Q1**. Dev: 5173 + 5174. Prod: `ALLOWED_ORIGINS` env.

### 11. Migrations by filename — **Should**

Do not edit a migration that already ran. Add a new one (or checksum) so new and old DBs match.

### 12. CI unreliable — **Should**

Green typecheck/test/build on a clean checkout. Visible commit sha if easy. No deploy.

---

## Looked up in the repo (25 Sep 2026)

### Q1 — CORS

`services/api/src/server.ts`: `cors({ origin: true, credentials: true })`.  
Local: workspace `http://localhost:5173`, portal `http://localhost:5174`, API `http://localhost:3001`. Both Vite apps proxy `/api` → 3001.  
This `main` is not deployed. Ignore `https://we947t2rq2.ap-south-1.awsapprunner.com`.

### Q2 — Journey

`deriveStatus` is live for due/overdue. Callers pass `atRisk: false`. Plan/forecast revisions not built (slip always 0 — bug 2). Entry gates only at create.

### Q3 — Actions

Many `createAction` call sites already exist (journey, handover, demands, collections, commitments, snags, inspections, progress, documents, CRs, interventions, post-handover, loans, comms, portal). Missing: source-closed → auto-close action subscriber. No Action Required page under `apps/my-pranava-home`.

### Q4 — Warranty / documents

`server.ts` comments: documents use `next()` fall-through; warranty close — spec 30 wins, lifecycle HTTP close is dead on purpose. Remove the dead route; keep `closeWarranty()` for unit tests.

---

## Done for the whole pass

All five waves finish by end of day 26 Sep 2026 (see **Timeline**). A and B are required. C if dates/names must be trusted. D only for real data. E when CI must be trusted. No Google / OTP / fake statuses.
