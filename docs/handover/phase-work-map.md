# Phases → work → who

Shareable copy of the phase-work-map canvas (2026-09-15). Tick boxes in git if you want; a work tick without an **exit** tick is not done.

Companion: [client-readiness.md](./client-readiness.md) (the handover bar).

**You** in this doc = the person with two working days, then exams (Phases 1–2 grind, Phase 3 interruptible, Phase 5 after exams). **Team** = everyone else during exam week.


| Split                                | Who               |
| ------------------------------------ | ----------------- |
| Phases 1–2 (as far as Day 2 reaches) | You               |
| Phase 3                              | You · exam week   |
| Phase 2 leftover + Phase 4           | Team · exam week  |
| Phase 5                              | You · after exams |


A work tick without an exit tick is not done. Prove exit on a **fresh reset**: stop the API first, then `npm run db:reset` in `services/api`. Never prove on a dirty DB.

**Logins for proof:** staff `crm@` `sales@` `accounts@` `legal@` `registration@` `qa@` `customisation@` `fm@` `management@` `site@` — all `@demo.pranava` / `Demo@2026`. Portal `:5174`: `customer@` (Ananya) plus `karthik@` `meera@` `rohan@` and every Phase 2 accepted login. Workspace `:5173`.

---

## Work

### Phase 1 — Occupant foundation · You · Day 1 — **closed 2026-09-15**

Make the existing four families real. Without this, every later phase tests empty screens. Exit verified: Journey tabs non-empty on `:5173`; `services/api` vitest 800/800.

- [x] **1a** Cut seed off raw INSERT INTO booking / demand / handover / AOS — You · Day 1
- [x] **1b** Karthik V110 via handlers + journey on construction/cash — You · Day 1
- [x] **1c** Meera V111 via handlers + journey on funding/loan + critical snag — You · Day 1
- [x] **1d** Ananya V112 via handlers + journey on pre-handover; keep customer@ login — You · Day 1
- [x] **1e** Rohan V113 via handlers + journey on post-handover + DLP/warranty + passport + 7/30/90 check-ins — You · Day 1
- [x] **1f** Portal logins karthik@ meera@ rohan@ / Demo@2026 — You · Day 1
- [x] **1g** db:reset proof: 360 Journey not empty for all four; four portal sign-ins — You · Day 1 EOD
- [x] **1h** Write the occupant roster (stage, name, unit, done/not) into click-path.md — You · Day 1 EOD



### Phase 2 — Occupant coverage · You Day 2, team finishes the rest

Fill every PDF §34.2 state. Go down the list on Day 2. Team takes whatever you did not reach. **2.14 is standing:** every new accepted booking gets a portal login, not only the Day 1 four.

**Day 2 closed 2026-09-15** (2.1–2.5 + 2.14 + e2-sql/story). Leftover **2.6–2.16** still open. Customisation proof is Meadows via `superadmin@` project switch — `customisation@` stays East Crest–assigned.

- [x] **2.1** Submitted handover packet (not CRM-accepted) — You first; team if leftover · Day 2 → exam week
- [x] **2.2** Returned packet with reason — You first; team if leftover · Day 2 → exam week
- [x] **2.3** One live CR (Awaiting Customer or Released) + Customisation desk row + payment gate before site release — You first; team if leftover · Day 2 → exam week
- [x] **2.4** Named prospect + Change Window Hold (V101 vs V104 gates) — You first; team if leftover · Day 2 → exam week
- [x] **2.5** Meadows: one apartment booking + one plot booking — You first; team if leftover · Day 2 → exam week
- [ ] **2.6** AOS draft occupant (not executed) — Team unless you still have time · Exam week
- [ ] **2.7** Registration slot booked (not completed) — Team unless you still have time · Exam week
- [ ] **2.8** Handover in progress (appointment/checklist, not Rohan) — Team unless you still have time · Exam week
- [ ] **2.9** NRI + loan conditional task occupant — Team · Exam week
- [ ] **2.10** Default/Legal overdue occupant — Team · Exam week
- [ ] **2.11** Cancelled or transferred booking; unit history intact — Team · Exam week
- [ ] **2.12** Plan vs forecast vs actual non-zero on ≥2 occupants — Team (needs Phase 1 journeys) · Exam week
- [ ] **2.13** Pre-registration occupant: blocked on finance/docs with named blockers on the desk (not Karthik-open, not Ananya-done) — Team unless you still have time · Exam week
- [x] **2.14** Portal login Demo@2026 on every accepted booking added in Phase 2 (Meadows, NRI, AOS, etc.) — You first for Day 2 occupants; team for rest · Day 2 → exam week
- [ ] **2.15** Pre-handover occupant blocked on CRITICAL snag; hard gate cannot skip without named override (not Meera-at-funding, not Rohan) — Team · Exam week
- [ ] **2.16** Every overdue demand has reason code + next action (PTP where used) — not only the Default/Legal person — Team · Exam week



### Phase 3 — Exam week · You

Full old hardening (RLS, project scope) is **not** exam-week work — it is a focused day and will break tests. Phase 3 is only the interruptible slice: scheduler, quiet hours, reviews.

- [ ] **3.1** Scheduler: wire existing overdue / loan-validity / hold-expiry / forecast-snapshot sweeps to a clock; off in tests — You · Exam week
- [ ] **3.2** Quiet hours + frequency guardrails enforced on the send path (policy already stored) — You · Exam week
- [ ] **3.3** PR review only: seed, RLS, Queues — block raw SQL bookings and chatbots — You · Exam week · 15–30 min/day



### Phase 4 — Product completeness + remaining hardening · Team · exam week

Queues, files, QA, documents, matrix, plus RLS and project scope. Team starts RLS immediately (does not touch seed). **Do not hand over if 4.1 is unmerged.**

- [ ] **4.1** RLS on the request path (P1b) + policies on tables after 0025 — Team · Exam week — start immediately
- [ ] **4.2** assertProjectScope: out-of-scope read 404, write 403; Meadows vs East Crest — Team · Exam week — start immediately
- [ ] **4.3** Field masking on financials/PII; UI tolerates nulls — Team · Exam week
- [ ] **4.4** Queues.tsx: claim, Management reassign, empty/error; locators on main — Team · Exam week
- [ ] **4.5** Action Types Studio tab actually edits action_type — Team · Exam week
- [ ] **4.6** Seed approval_authority_rule bands; commitments use requiredApprovers(); drop in-code ₹200k fallback — Team · Exam week
- [ ] **4.7** Photos/signatures through files port (file id, not data-URL) — Team · Exam week
- [ ] **4.8** QA: site declaration vs independent verification + exception queue — Team · Exam week
- [ ] **4.9** Document factory: draft v1/v2 + sale families — Team · Exam week
- [ ] **4.10** Scorers read score_weight from Studio — Team · Exam week



### Phase 5 — Prove and hand over · You after exams

Team may draft tests during the week. You run the gate when you are back.

- [ ] **5.1** Occupant-state unit tests (one per PDF stage) covering §26 / §31.5 / §32.11 / §33.6 / §34.7, Sales-cannot-edit-Site, two projects with different durations — Team drafts; you confirm · Exam week → after exams
- [ ] **5.2** Playwright: sale-to-handover + portal Ananya and Rohan — Team drafts; you confirm · Exam week → after exams
- [ ] **5.3** Fresh db:reset, full suite, click-path walk as staff + two customers — You · After exams
- [ ] **5.4** HANDOFF.md + click-path = operator pack — You · After exams
- [ ] **5.5** Deploy current main only if leads approve AWS spend; else local-first runbook — You + leads · After exams
- [ ] **5.6** Invite a new staff user end-to-end (email/password); they land in My Day — You · After exams



### Out of all phases

Chatbot, WhatsApp runtime, vendor portal, Google OIDC unless leads supply a client, AWS until spend is approved, East-Crest-only code, inventing SOP day counts (those go in Studio).

---



## Phase exit

Tick only after you have done the prove step. **Not done if** is the miss we keep making (empty journeys, raw ids, SQL seed, write-on-read, wrong occupant reused).

If every work item is ticked and exit is not, the phase is **not finished**. Do not start the next phase as “finished behind you.”

### How to prove (all phases)


| Logins / commands | Detail                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Staff             | `crm@ sales@ accounts@ legal@ registration@ qa@ customisation@ fm@ management@ site@` — all `@demo.pranava` / `Demo@2026` |
| Portal            | `customer@` (Ananya) plus `karthik@` `meera@` `rohan@` and every Phase 2 accepted login — `Demo@2026` — app `:5174`       |
| Workspace         | `:5173`                                                                                                                   |
| Reset             | Stop the API first. In `services/api`: `npm run db:reset`. Then start API + both UIs. Never prove on a dirty DB.          |


---



### Phase 1 exit — Occupant foundation — **closed 2026-09-15**

If this fails, **stop**. Later phases test empty screens. Do not tick Phase 1 done from the work list alone. Verified: handler seed, visual Journey walk, full API suite.

**Not this phase:** Queues, RLS, Meadows bookings, packets, CRs, scheduler, files port.

- [x] **e1a** 1a — Seed no longer creates the four families with raw SQL  
  - **Prove:** Search `seed.ts`, `seed-lifecycle.ts`, `seed-canonical.ts`. Karthik/Meera/Ananya/Rohan go through handlers (handover accept, demands, AOS). No `INSERT INTO booking` / `sales_handover` / `demand` / `agreement` for those people.  
  - **Not done if:** Any of those INSERTs still create BK-V110–V113.

- [x] **e1b** 1b — Karthik V110 / BK-V110 has a live construction + cash journey  
  - **Prove:** Stop API → `npm run db:reset` in `services/api` → start stack. Login `crm@demo.pranava`. Open V110. Journey tab has stages/tasks. Construction current; overdue/cash still open. Person label is Karthik Iyer.  
  - **Not done if:** Empty Journey; uuid in the heading; booking row with no `journey_instance`.

- [x] **e1c** 1c — Meera V111 / BK-V111 has funding/loan + dispute + critical snag  
  - **Prove:** `crm@` 360 for V111: Journey not empty, loan/funding current, a disputed collection, a CRITICAL snag on the unit.  
  - **Not done if:** Empty Journey, or snag/dispute only in SQL with no UI row.

- [x] **e1d** 1d — Ananya V112 / BK-V112 pre-handover; customer@ still works  
  - **Prove:** `crm@` 360 Journey not empty (pre-handover). Portal `:5174` as `customer@demo.pranava` / `Demo@2026` still opens BK-V112.  
  - **Not done if:** Existing customer login broken, or Journey empty.

- [x] **e1e** 1e — Rohan V113 keys + DLP/warranty + passport + 7/30/90 check-ins  
  - **Prove:** Staff 360: keys issued, DLP/warranty, Home Passport items, 7/30/90 check-ins listed (not a blank after-care tab).  
  - **Not done if:** Passport missing, check-ins missing, or only a keys-issued flag.

- [x] **e1f** 1f — Four portal logins, each sees only their home  
  - **Prove:** Portal login `karthik@demo.pranava`, `meera@demo.pranava`, `rohan@demo.pranava`, `customer@demo.pranava` — all `Demo@2026`. Each landing is that family’s unit. No vendor price, internal note, or unapproved forecast.  
  - **Not done if:** 401, wrong unit, Ananya-only still, or Rohan still staff-only.

- [x] **e1g** 1g — Proved on a freshly reset DB, not a dirty one  
  - **Prove:** The walk in e1b–e1f was after `db:reset` with the API stopped first. You watched reset finish.  
  - **Not done if:** It only worked because leftover rows from a previous run.

- [x] **e1h** 1h — click-path.md is the roster the team will copy  
  - **Prove:** `docs/demo/click-path.md` lists stage, person, unit, booking, login, done/not, and that handlers (not SQL) created them.  
  - **Not done if:** Team has to ask you how to add the next occupant.

- [x] **e1-names** No raw ids on 360 or portal for these four  
  - **Prove:** Headings and lists show Karthik Iyer / V110 / BK-V110, not `user.id` or `unit_id`.  
  - **Not done if:** A uuid or numeric id is the visible name.

- [x] **e1-get** Opening 360 / Journey does not write a new audit/snapshot row every load  
  - **Prove:** Reload Customer 360 twice. Event/snapshot count for that booking does not climb on GET.  
  - **Not done if:** Compute-on-read that inserts on every request.

- [x] **e1-lock** Nobody else rewrote seed during Phase 1  
  - **Prove:** No parallel PR that edits `seed.ts` / `seed-lifecycle` while 1a–1h are in flight.  
  - **Not done if:** Two handler patterns, or SQL put back.

---



### Phase 2 exit — Occupant coverage

Every 2.x row must be a visible person or desk row after `db:reset`. Leftover items stay unticked on Work until they exist here.

**Not this phase:** RLS, Queues studio polish, document factory families, scheduler (hold expiry fire is Phase 3).

- [x] **e21** 2.1 — Handover Packets has a submitted, not-accepted row  
  - **Prove:** After reset, open Packets as `sales@` or `crm@`. One packet is submitted. CRM has not accepted it into a live booking journey.  
  - **Not done if:** Empty queue, or the only packets are already accepted (the Day 1 four).

- [x] **e22** 2.2 — A returned packet shows reason and can be resubmitted  
  - **Prove:** Queue/360 shows Returned + reason. Sales can resubmit. Not a deleted row.  
  - **Not done if:** Returned with no reason, or no resubmit path.

- [x] **e23** 2.3 — Live CR + payment before site release  
  - **Prove:** Customisation desk has Awaiting Customer or Released. Attempting site/drawing release without payment is blocked. Portal shows customer-facing status only. **Walked 2026-09-15:** CR-000001 Kitchen island on BK-MT201 at AWAITING_CUSTOMER; `releaseChangeRequest` throws unpaid; visible on Meadows Customisation Desk (`superadmin@` project switch). `customisation@` default East Crest is empty.  
  - **Not done if:** Desk empty; drawing released unpaid; vendor cost visible to the customer.

- [x] **e24** 2.4 — Named prospect + V101 vs V104 gates + hold with expiry  
  - **Prove:** Sales desk names a prospect. V101 and V104 show different changeability (OPEN kitchen vs HARD_CLOSED). Hold row has an expiry timestamp (scheduler in Phase 3 actually fires it). **Walked 2026-09-15:** Tanvi Joshi; hold HLD on V101 `kitchen_layout` until 2026-09-22. Actual gates: V101 kitchen_layout OPEN; V104 kitchen_layout EXCEPTION_ONLY, structural HARD_CLOSED. V101/V104/V108 still unbooked.  
  - **Not done if:** Unsold units with no prospect; identical gates; hold with no expiry.

- [x] **e25** 2.5 — Meadows apartment + plot are bookings via handlers  
  - **Prove:** Not units-only. One apartment booking and one plot booking. Product type visible on 360. Journeys exist if accepted.  
  - **Not done if:** MV/MP/MT still inventory-only; villa-only East Crest in practice.

- [ ] **e26** 2.6 — AOS draft occupant, not Karthik’s executed AOS  
  - **Prove:** A different booking shows draft AOS, draft watermark, locked clauses not silently editable.  
  - **Not done if:** Only executed AOS in the product.

- [ ] **e27** 2.7 — Registration slot booked, not completed, not Ananya  
  - **Prove:** Registration desk: SRO slot + day-of checklist, status not completed. Distinct from V112 registered.  
  - **Not done if:** Skipped because Ananya is already registered.

- [ ] **e28** 2.8 — Handover in progress, not Rohan  
  - **Prove:** Appointment + checklist in flight. Distinct from V113 keys-issued.  
  - **Not done if:** Skipped because Rohan exists; or only a completed handover.

- [ ] **e29** 2.9 — NRI + loan shows the conditional task  
  - **Prove:** Occupant is NRI with DOCS_PENDING (or equivalent). My Day or Journey shows the NRI/docs task.  
  - **Not done if:** NRI flag with no task, or a domestic loan relabeled NRI.

- [ ] **e210** 2.10 — Default/Legal overdue occupant is a different person  
  - **Prove:** Collections shows Default/Legal. Not Karthik overdue-cash and not Meera disputed relabeled.  
  - **Not done if:** One person wearing three collection badges.

- [ ] **e211** 2.11 — Cancel/transfer closed the booking; unit history remains  
  - **Prove:** Booking closed. Unit 360 still shows the old ownership/history. Unit was not deleted.  
  - **Not done if:** Unit gone, or history wiped.

- [ ] **e212** 2.12 — Plan vs forecast vs actual is non-zero on ≥2 occupants  
  - **Prove:** Open Journey timeline on two bookings. At least one of plan / forecast / actual differs (PDF §34.7 t3–t4).  
  - **Not done if:** Every journey shows variance 0.

- [ ] **e213** 2.13 — Pre-registration blocked with named finance/docs blockers  
  - **Prove:** Registration desk: this occupant is blocked. Blockers are named (which demand, which doc). Not Karthik “registration open” and not Ananya done.  
  - **Not done if:** No named blockers, or reused Karthik/Ananya.

- [x] **e214** 2.14 — Every accepted Phase 2 booking has a portal login  
  - **Prove:** List accepted bookings added this phase (Meadows, NRI, AOS, CR family if accepted, etc.). Each logs into `:5174` with `Demo@2026` and sees that home. Packet-submitted-not-accepted may have no login.  
  - **Not done if:** Accepted booking, no customer user.

- [ ] **e215** 2.15 — Pre-handover CRITICAL snag blocks keys without named override  
  - **Prove:** Occupant is pre-handover (not Meera-at-funding, not Rohan-done). Handover/keys action is blocked. Override requires a named person + reason. Gate does not skip on click.  
  - **Not done if:** Keys issued anyway; or Meera reused as the hard-gate proof.

- [ ] **e216** 2.16 — Every overdue demand has reason + next action  
  - **Prove:** Collections: Karthik, Default/Legal, and any other overdue. No overdue row with blank reason or blank next action (PTP where used).  
  - **Not done if:** Default/Legal exists but Karthik overdue is still unexplained.

- [x] **e2-sql** Still no raw INSERT INTO booking for new occupants  
  - **Prove:** Phase 2 seed uses the same handler pattern as Phase 1. Meadows `plan_meadows` is a copied `payment_plan` (no handler) so `setupFunding` can run — not an `INSERT INTO booking`.  
  - **Not done if:** Shortcut SQL “just for Meadows”.

- [x] **e2-story** Staff 360 and that customer’s portal tell the same stage  
  - **Prove:** For each accepted occupant, pick the portal login and the CRM 360. Stage/money/papers match. Portal still has no internals.  
  - **Not done if:** Staff construction, portal empty or a different story.

- [x] **e2-desks** After reset, no desk that 2.x filled is empty  
  - **Prove:** Walk Packets, Customisation, Sales. Each claimed Day-2 occupant is a visible row. Registration / Collections / Handover desks stay empty until leftover 2.7 / 2.10 / 2.8. **Walked 2026-09-15:** Packets (crm@ unfiltered) Aditi+Harish; Sales Desk Tanvi+V101 hold; Meadows 360 apartment+plot. Customisation is Meadows-scoped (`superadmin@`); crm@ East-Crest-only “awaiting review” does not list Aditi.  
  - **Not done if:** “No items” on a desk this phase said it filled.

---



### Phase 3 exit — Exam week (you)

Interruptible only. A work tick on 3.1 is not enough — the hold must actually expire and tests must stay green.

**Not this phase:** RLS, project scope, field masking, Queues implementation, seed rewrites.

- [ ] **e31-clock** 3.1 — Sweeps run on a clock, not by curling an endpoint  
  - **Prove:** Overdue, loan-validity, hold-expiry, forecast-snapshot are attached to a process timer (or equivalent). Demo/local does not require an engineer to hit `/sweep`.  
  - **Not done if:** Jobs exist as HTTP handlers only.

- [ ] **e31-tests** 3.1 — Scheduler is off or fake-clocked in tests  
  - **Prove:** Backend vitest finishes without waiting on real time. No flaky hold-expiry tests.  
  - **Not done if:** Suite hangs or depends on wall-clock.

- [ ] **e31-hold** 3.1 — The Phase 2 hold actually expires  
  - **Prove:** Seed a short TTL or time-travel. After the sweep, hold is expired without a person clicking Expire.  
  - **Not done if:** Hold sits until someone runs a script.

- [ ] **e31-overdue** 3.1 — Overdue sweep updates work without a click  
  - **Prove:** After clock + reset, My Day / collections actions reflect overdue without a manual sweep POST.  
  - **Not done if:** Stale overdue until a human triggers it.

- [ ] **e31-loan** 3.1 — Loan validity sweep runs  
  - **Prove:** Expired/expiring loan validity is updated by the job, not only on screen load.  
  - **Not done if:** Write-on-read snapshot, or never runs.

- [ ] **e31-forecast** 3.1 — Forecast snapshot is a scheduled write, not a GET side effect  
  - **Prove:** Reload Control Tower / forecast twice; snapshot count does not climb per GET. A job writes the snapshot.  
  - **Not done if:** Every dashboard open inserts a snapshot.

- [ ] **e32-quiet** 3.2 — Quiet hours are enforced on send  
  - **Prove:** Policy Studio quiet hours are what the send path reads. A send inside quiet hours is blocked or deferred — check the communication log, not just the UI toggle.  
  - **Not done if:** Policy is stored and ignored; email goes out.

- [ ] **e32-freq** 3.2 — Frequency guardrail blocks a second send  
  - **Prove:** Two sends inside the configured window: second is blocked. Cap comes from stored policy.  
  - **Not done if:** Staff can hammer send.

- [ ] **e33** 3.3 — PRs this week: no raw SQL bookings, no chatbot, no East-Crest-only code  
  - **Prove:** You looked at seed / RLS / Queues PRs (15–30 min/day). Rejected `INSERT INTO booking` and PDF §27 items.  
  - **Not done if:** A merge landed SQL seed or a chatbot “just for demo”.

- [ ] **e3-not-rls** Phase 3 did not quietly become RLS  
  - **Prove:** Your exam-week commits are scheduler, quiet hours, review. RLS is Phase 4.1 on the team.  
  - **Not done if:** Half-threaded GUC on a few routes and a red suite left for later.

---



### Phase 4 exit — Product + hardening (team)

Do not hand over if 4.1 is unmerged. Start RLS immediately; it must not touch seed.

**Not this phase:** Chatbot, WhatsApp API, vendor portal, inventing SOP days, deploying AWS without spend approval.

- [ ] **e41** 4.1 — RLS is on the live request path, not only a migration file  
  - **Prove:** Each API request sets the RLS user/role GUC. Login as customer A; request customer B’s booking → denied. `0025` is not bypassed by a superuser connection on the request path. Tables added after 0025 have policies.  
  - **Not done if:** Migration exists, API still superuser; cross-customer read returns 200.

- [ ] **e42** 4.2 — East Crest cannot read or write Meadows  
  - **Prove:** Session scoped to East Crest. GET Meadows booking id → 404. Write → 403. Reverse also holds.  
  - **Not done if:** Both projects in one list; out-of-scope id still returns a body.

- [ ] **e43** 4.3 — Masking: nulls in UI, no PII/amount leak  
  - **Prove:** A role without finance sees null/hidden amounts; screen does not crash. Portal still has no vendor price, internal note, staff name-as-blame, unapproved forecast.  
  - **Not done if:** Amounts leak; white screen on null.

- [ ] **e44** 4.4 — Queues: claim, Management reassign, empty, error  
  - **Prove:** Department user claims a row. `management@` reassigns. Force empty and error states — not an infinite spinner. Playwright locators are `page.locator("main")` and `{ exact: true }` on Save/Accept/Send.  
  - **Not done if:** My Day is the only queue; tests click the sidebar.

- [ ] **e45** 4.5 — Action Types Studio writes action_type  
  - **Prove:** Change a label or SLA, reload, row in `action_type` matches.  
  - **Not done if:** Tab is chrome; edits do not persist.

- [ ] **e46** 4.6 — Matrix bands in DB; requiredApprovers(); no ₹200k fallback  
  - **Prove:** `approval_authority_rule` has seeded bands. Commitments call `requiredApprovers()`. Search the API for `200000` / `200k` / `2_00_000` in-code fallbacks — none remain.  
  - **Not done if:** Empty matrix fail-closed, or silent code fallback.

- [ ] **e47** 4.7 — Photos, signatures, deeds are file ids  
  - **Prove:** New signature/photo/deed goes through the files port. DB stores a file id. Search seed/UI for `data:image` or huge base64 — gone from new writes. 2.8 in-progress handover uses a file, not a data-URL.  
  - **Not done if:** Evidence lives as a string in the row.

- [ ] **e48** 4.8 — Site declaration vs QA verification + exception queue  
  - **Prove:** QA path has two distinct acts (site declares, QA verifies). Exception queue is a staff path with a row, not a comment.  
  - **Not done if:** One snag list is the whole of QA.

- [ ] **e49** 4.9 — Draft v1/v2 + sale document families  
  - **Prove:** Create draft v1, edit, v2 exists (v1 not silently overwritten). Templates exist for AOS, Sale Deed, addendum, demand, receipt, handover letter, variation, cancellation. Lease templates unassigned unless leads said they lease.  
  - **Not done if:** AOS-only factory; v2 clobbers v1.

- [ ] **e410** 4.10 — score_weight in Studio changes the number  
  - **Prove:** Change a weight, recompute readiness; value moves. Not a hardcoded scorer.  
  - **Not done if:** Studio field is decorative.

- [ ] **e4-tests** RLS/scope tests pass — do not leave them red for Phase 5  
  - **Prove:** Backend suite green with 4.1–4.3 on. Failures fixed in this phase.  
  - **Not done if:** 4.1 merged, suite red, “we’ll fix after exams”.

- [ ] **e4-seed** Team did not put raw SQL bookings back  
  - **Prove:** Phase 4 PRs do not reintroduce `INSERT INTO booking` for occupants.  
  - **Not done if:** Hardening landed, seed regressed.

---



### Phase 5 exit — Prove and hand over

You run this gate. Team may draft tests. Claiming green without reading output fails the phase.

**Not this phase:** New occupants, new engines, §27 extras.

- [ ] **e51** 5.1 — Occupant-state tests vs the seeded people, not empty fixtures  
  - **Prove:** One automated test per seeded PDF stage. Named coverage for §26, §31.5, §32.11, §33.6, §34.7. Sales user cannot PATCH site gates. Two projects, different durations, same code — all passing.  
  - **Not done if:** Tests pass on fixtures that are not the roster.

- [ ] **e52** 5.2 — Playwright sale-to-handover + Ananya portal + Rohan portal  
  - **Prove:** Specs run. Screenshots at 1440 / 768 / 375 reviewed (look professional, design tokens, no console errors). Locators on main; `exact: true` on short verbs.  
  - **Not done if:** Unreviewed screenshots, or tests that pass by clicking the wrong Save.

- [ ] **e53** 5.3 — You ran reset + full suites and read the output  
  - **Prove:** Stop API, `db:reset`, full backend vitest, full Playwright, click-path as staff + Ananya + Rohan (and one Phase 2 customer if accepted). You have the real log, not a guess.  
  - **Not done if:** “Should be green” without running it.

- [ ] **e54** 5.4 — HANDOFF.md + click-path are this product  
  - **Prove:** Operator pack names current logins, occupants, empty/error behaviour. A stranger can follow click-path after reset.  
  - **Not done if:** R0-era handoff; stale emails; empty desks not mentioned.

- [ ] **e55** 5.5 — Deploy this main only after spend yes; else written local runbook  
  - **Prove:** If leads approved AWS: HTTPS, persistent Postgres, backups, health, logs, their mailer — current main, not the R0 App Runner URL. If not: Postgres 16 local-first runbook checked in. Ask before spend.  
  - **Not done if:** Old hosted URL, or billed resources created without a yes.

- [ ] **e56** 5.6 — Invite a staff user through the product  
  - **Prove:** Invite email/password flow. They set a password. They land in My Day. Not an `INSERT INTO users` in seed.  
  - **Not done if:** Only seeded `@demo.pranava` staff can log in.

- [ ] **e5-rls** 4.1 is merged — do not hand over an open database  
  - **Prove:** Phase 4 exit e41 is ticked and on main.  
  - **Not done if:** Occupants look good; RLS still inert.

- [ ] **e5-gates** All nine handover gates on [client-readiness.md](./client-readiness.md) are true  
  - **Prove:** Roster via handlers; §26 tests; §31.5/32.11/33.6/34.7; portal per accepted occupant; RLS+scope+masking; files+scheduler; Studio matrix; deploy-or-runbook; click-path executable.  
  - **Not done if:** Seed-only “handover”.

- [ ] **e5-out** Nothing from Out of all phases shipped  
  - **Prove:** No chatbot, WhatsApp runtime, vendor portal, East-Crest-only branches, invented SOP day counts, Google OIDC without a client, AWS without spend approval.  
  - **Not done if:** A §27 item landed as extra credit.

---



## Notes

Leftover 2.x for the team, PR links, blockers, what failed on an exit walk:

*Add below.*