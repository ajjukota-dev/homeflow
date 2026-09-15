# Client handover — HomeFlow 2.0

Shareable copy of the client-readiness canvas (2026-09-15).

**Bar:** Pranava can operate this without an engineer in the room. Code existing is not enough. Requirement authority: `Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf`. Tick work on [phase-work-map.md](./phase-work-map.md); this page is what “done” means and what still has to happen.

| | |
|---|---|
| Ready to hand over | **No** |
| Seeded families | 6 accepted (4 East Crest + Nisha apartment + Suresh plot); plus Aditi submitted + Harish returned packets |
| RLS on the live request path | Off |
| Customer portal logins | 6 (`customer@` `karthik@` `meera@` `rohan@` `nisha@` `suresh@`) |

Source: PDF §§24–27, §31.5, §32.11, §33.6, §34.7, Appendix A · main as of 2026-09-15.

**Not ready to hand over.** Modules are written. The product is not finished. Phase 1 journeys now instantiate for the four families. Remaining: Phase 2 desk coverage, Phase 4 RLS on the live path, Phase 5 proof. Do not schedule a handover until that work is true — earliest honest date is after exams, suite green, RLS merged.

---

## Already true — do not rebuild

Keep these. The remaining work is seed, wiring, and proof — not a rewrite of the OS.

| What already works | Do not |
|---|---|
| Canonical Project → Unit → Booking; derived `project_id`; Sales cannot edit Site gates | Do not invent a second domain model |
| My Day, 360 screens, portal shell, AOS factory path, Control Tower, Policy Studio | Do not replace screens; fill them with real occupants |
| No chatbot, no AI auto-send, no East-Crest-only code branches (PDF §27) | Do not add these as extra credit |

---

## What we must do

Every row is required for handover. Order is the phase map. Phase 1 is closed — do not reopen it. If Phase 2 Day 2 (2.1–2.5) slips, leftover goes to the team; do not start RLS.

### 1. Occupant foundation — You, Day 1 (Phase 1) — **done 2026-09-15**

Cut seed off raw `INSERT INTO booking` / demand / handover / AOS. Recreate the four families through the same handlers the UI uses so journeys actually instantiate.

| Do this | Done when | Phase |
|---|---|---|
| Cut seed off raw INSERT INTO booking / demand / handover / AOS | New bookings only exist because a handler created them | 1a |
| Karthik V110 via handlers — construction + overdue cash journey | 360 Journey tab is not empty after db:reset | 1b |
| Meera V111 via handlers — loan + disputed + critical snag journey | 360 Journey tab is not empty after db:reset | 1c |
| Ananya V112 via handlers — pre-handover; keep customer@demo.pranava | 360 Journey tab is not empty; existing portal login still works | 1d |
| Rohan V113 via handlers — keys + DLP/warranty + passport + 7/30/90 check-ins | 360 Journey tab is not empty; passport and check-ins visible to staff and on his portal | 1e |
| Portal logins karthik@ / meera@ / rohan@ password Demo@2026 | Four customer sign-ins on a fresh reset | 1f |
| db:reset proof: 360 Journey not empty for all four; four portal sign-ins | You have walked it on a freshly reset DB | 1g |
| Write the occupant roster into docs/demo/click-path.md | Someone else can copy the handler pattern without asking you | 1h |

### 2. Occupant coverage — You Day 2, team finishes leftover (Phase 2)

One named occupant per PDF §34.2 state (and the extras). Same story on staff 360 and that customer’s portal. Go down the list; do not start a new occupant at end of Day 2. Standing rule **2.14:** every accepted booking added here gets a portal login, not only the Day 1 four.

**Day 2 (2.1–2.5 + 2.14) closed 2026-09-15.** Leftover 2.6–2.16 is still required for handover.

| Stage | Who / unit today | What is wrong today | Build this | Phase |
|---|---|---|---|---|
| 0 Pre-sale | Tanvi Joshi · V101 hold, V104 gates differ | Hold expiry does not fire until Phase 3 scheduler | Keep; scheduler is 3.1 | 2.4 |
| 0 Hold | Tanvi / V101 kitchen_layout APPROVED until ~+7d | Nothing expires on a clock yet | Time-boxed hold row exists; auto-expire is Phase 3 | 2.4 |
| 1 Packet submitted | Aditi Bansal MV-01 BK-MV01 | Done (not CRM-accepted, no journey) | Keep | 2.1 |
| 1 Packet returned | Harish Patel MV-02 BK-MV02 | Done (MISSING_DOCUMENTS + note; resubmit path exists) | Keep | 2.2 |
| 2 Funding — loan | Meera V111 | Journey on funding/loan (Phase 1 done) | Keep her on funding/loan | 1c |
| 2 Funding — NRI + loan | Missing | Conditional NRI task never appears. | NRI + DOCS_PENDING loan occupant | 2.9 |
| 3 Agreement | Karthik AOS already executed | No draft-not-executed factory occupant. | AOS draft, watermark, locked clauses not silently edited | 2.6 |
| 4 Construction | Karthik V110 | Journey on construction (Phase 1 done) | Keep construction current, finance still open | 1b |
| 5 Collections | Karthik overdue · Meera disputed | No Default/Legal occupant; not every overdue has next action. | Default/Legal occupant (2.10) and reason + next action / PTP on every overdue (2.16) | 2.10 + 2.16 |
| 6 Pre-registration | Karthik registration open | Blockers not named on a live desk row. | Registration blocked on finance/docs with named blockers | 2.13 |
| 7 Registration | Ananya already registered | No slot-booked-not-completed occupant. | SRO slot booked + day-of checklist, not completed | 2.7 |
| 8 Pre-handover | Ananya V112 | Journey pre-handover; portal works (Phase 1 done). Hard-gate occupant still thin. | Separate occupant blocked on CRITICAL snag; hard gate cannot skip | 1d + 2.15 |
| 9 Handover in progress | Missing (Rohan is finished) | Cannot show appointment/checklist/signature in flight. | Appointment + checklist + real signature file, not Rohan | 2.8 |
| 10 Post-handover | Rohan V113 | Portal + passport/warranty/check-ins (Phase 1 done) | Keep; do not reuse as the in-progress handover (2.8) | 1e + 1f |
| CR in flight | Nisha Verma BK-MT201 Kitchen island AWAITING_CUSTOMER | Visible on Meadows Customisation Desk (`superadmin@`); `customisation@` East Crest default is empty | Keep; payment gate proven unpaid | 2.3 |
| Cancel / transfer | Missing | Cannot prove unit history survives a closed booking. | Closed booking; unit 360 history intact | 2.11 |
| Meadows apt + plot | Nisha MT1-201 APARTMENT · Suresh MP-01 PLOT | Done via handlers + journeys | Keep | 2.5 |
| Plan vs forecast vs actual | Thin / often zero | PDF §34.7 t3–t4 fails if every journey shows variance 0. | Non-zero variance on at least two occupants | 2.12 |
| Portal on every accepted Phase 2 booking | nisha@ · suresh@ (Day 2 accepted) | Leftover occupants (2.6–2.16) still need logins when added | Standing rule for the rest of Phase 2 | 2.14 |

### 3. Exam week — You (Phase 3 only)

Interruptible work. **Not RLS.** RLS is a focused day and will break tests — that is Phase 4 for the team.

| Do this | Done when | Phase |
|---|---|---|
| Wire existing overdue / loan-validity / hold-expiry / forecast-snapshot sweeps to a scheduler; off in tests | Holds expire and SLA/forecast jobs run without curling endpoints | 3.1 |
| Enforce quiet hours + frequency guardrails on the send path (policy is already stored) | A send in quiet hours is blocked or deferred — not silently ignored | 3.2 |
| 15–30 min/day PR review: seed, RLS, Queues | Block raw SQL bookings and chatbots | 3.3 |

### 4. Product holes + hardening — Team, exam week (Phase 4)

Start RLS immediately. It does not touch seed. Do not hand over if 4.1 is unmerged. After Phase 1 is on main, also finish leftover Phase 2 occupants via the handler pattern only.

| Do this | Why handover fails without it | Phase |
|---|---|---|
| RLS on every request (P1b) + policies on tables after 0025 | PDF §4.4 / §22. Today the migration exists and is inert (superuser bypass). Open database. | 4.1 |
| assertProjectScope: out-of-scope read 404, write 403 (Meadows vs East Crest) | Staff can read another project’s rows. | 4.2 |
| Field masking on financials / PII; UI tolerates nulls | Wrong role sees amounts and personal data they must not. | 4.3 |
| Queues.tsx: claim, Management reassign, empty/error states | PDF §20. My Day is not a substitute for departmental queues. | 4.4 |
| Action Types Studio tab actually edits action_type | Config-over-code is a slide until this writes. | 4.5 |
| Seed approval_authority_rule bands; commitments call requiredApprovers() — drop in-code ₹200k fallback | Empty matrix is unusable; silent code fallback is not Policy Studio. | 4.6 |
| Photos, signatures, deeds through the files port (file id, not data-URL) | A handed-over product cannot store evidence in the database as strings. | 4.7 |
| QA: site declaration vs independent verification + exception queue | PDF §8.8. Two snag rows is not evidence-based quality. | 4.8 |
| Document factory: draft v1/v2 + sale families (AOS, Sale Deed, addendum, demand, receipt, handover letter, variation, cancellation) | PDF §32.1. AOS-only is not the factory. Lease templates unassigned unless they lease. | 4.9 |
| Scorers read score_weight from Studio | Weights unwired means readiness numbers are not configurable. | 4.10 |

### 5. Prove and hand over — You after exams (Phase 5)

Team may draft tests during the week. You run the gate. Deploy current main only if leads approve AWS spend — that costs money; ask first. Otherwise a local-first Postgres 16 runbook.

| Do this | Done when | Phase |
|---|---|---|
| Occupant-state unit tests — one per PDF stage seeded | §26 / §31.5 / §32.11 / §33.6 / §34.7, Sales-cannot-edit-Site, two projects with different durations | 5.1 |
| Playwright: sale-to-handover + portal as Ananya and as Rohan | No empty desks; no console errors on the click-path | 5.2 |
| Fresh db:reset, full backend vitest + Playwright, walk as staff + two customers | You have read the real output. Do not claim green without that. | 5.3 |
| Rewrite HANDOFF.md + click-path as the operator pack | A new operator can follow the roster without you | 5.4 |
| Deploy current main only if leads approve AWS spend; else local-first Postgres 16 runbook | Either hosted this-main or a written runbook. Ask before spend. | 5.5 |
| Invite a new staff user end-to-end (email/password) | They land in My Day without an engineer creating the row by hand | 5.6 |

---

## Do not ship — not a phase

These failed a filter: spec-banned, already substituted, blocked on an external token, or policy-not-code. Do not pick them up “if there is time.”

| Item | Why it stays out |
|---|---|
| Chatbot / AI auto-send / second chat stream / unexplained scores | PDF §27. Shipping is a spec miss. |
| Chart-stuffed executive dashboards | Control Tower stays five interventions. |
| East-Crest-only code; inventing SOP day counts | PDF §34–35. Numbers go in Policy Studio. |
| WhatsApp as a runtime | Log the send. Email + in-app is the shipped channel. |
| Vendor / contractor portal | PDF §24 P2. Contractor master is enough. |
| Google OIDC | Only if leads supply an OAuth client. Email/password is complete. |
| AWS deploy | Costs money. Wait for account, region, and spend approval. |
| Duplicated accounting or construction masters | PDF §27. HomeFlow is not the ledger or CAD. |

## Leads must supply — we do not invent

Studio must accept these. Phases do not hard-code them. Google and AWS stay blocked until the input exists.

| Input | Used for |
|---|---|
| East Crest and Meadows day counts, notices, charges, freeze dates | Journey / SLA / freeze — configuration, not code |
| Mailbox / sending domain | Invites, resets, customer updates, digests |
| Whether Google Workspace login is required | If yes: their OAuth client. If no: skip. |
| AWS account, region, budget | Hosted HTTPS + Postgres + backups — only after spend yes |
| Lease in or out of the live document set | Ship the factory either way; assign lease templates only if they lease |

---

## We hand over when all of these are true

Handover is a **gate, not a date**. Occupant seed does not finish the product by itself — it makes the rest testable. Do not hand over if RLS (Phase 4.1) is unmerged.

| # | Gate |
|---|---|
| 1 | Every occupant in the roster exists, seeded via handlers, with a journey where the stage requires one. |
| 2 | Every PDF §26 bullet has an automated test against those occupants, and it passes. |
| 3 | §31.5, §32.11, §33.6, §34.7 pass — including Sales-cannot-edit-Site and two projects with different durations in the same code. |
| 4 | Customer can sign in as each accepted occupant and never see internal blame, vendor price, or unapproved forecast. |
| 5 | RLS + project scope + field masking are on the live request path, proven with a second project. |
| 6 | Files, signatures, and deeds go through the files port. Holds expire and SLA/forecast jobs run on a scheduler. |
| 7 | Policy Studio can set durations, gates, templates, matrix bands. Empty-matrix fail-closed and in-code ₹200k fallback are gone. |
| 8 | Either: production deploy of this main (HTTPS, Postgres, backups, health, logs, their mailer) after spend approval — or a written local-first Postgres 16 runbook (5.5). Invite a new staff user end-to-end; they land in My Day (5.6). |
| 9 | Click-path names the occupants and is executable without an engineer. No empty desks on a fresh reset. |
