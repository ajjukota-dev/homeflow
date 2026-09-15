# Phase 2 leftover agent prompt — copy everything below the line into a new chat

Paste the block from `BEGIN PROMPT` through `END PROMPT` as the first message of a **new** Cursor chat on this repo. Do not add extra goals. When that chat finishes, paste its `## Phase 2 leftover report` back into the planning chat for exit verification.

Phases 1, 2 Day 2 (2.1–2.5 + 2.14), and 3 are **closed**. This chat is leftover occupant coverage **2.6–2.16** only. Do not start RLS. Do not rewrite scheduler/quiet hours.

---

BEGIN PROMPT

You are implementing **HomeFlow Phase 2 leftover only** (PDF §34.2 states not seeded on Day 2). One working day. This is a finished-product handover track, not a brainstorm.

Read first, in this order, before writing code:

1. `CLAUDE.md`
2. `docs/CONTEXT.md`
3. `docs/specs/00-conventions.md`
4. This prompt in full
5. Specs you actually call: `docs/specs/22-document-factory.md` / `legal-docs.ts` (AOS), `docs/specs/23-registration.md`, `docs/specs/16-handover-gates.md`, `docs/specs/21-loan-management.md`, `docs/specs/19-collections-true-risk.md`, `docs/specs/04-canonical-model.md`
6. Copy pattern: `services/api/src/seed/occupants-phase2.ts`, `occupants-book.ts`, `occupants-via-handlers.ts`, `seed-phase2.test.ts`, `seed/users.ts`
7. Handlers (do not reimplement): `bookAndAccept` / `bookAndSubmit` in `occupants-book.ts`, `generateDocument` in `legal-docs.ts` (legacy AOS — do **not** `approveDocument`+`executeDocument` for 2.6), `bookSlot` in `registration/core.ts` (do not `completeCase`), `confirmAppointment` in `handover/core.ts` (do not `completeHandover` / `completeCase` for 2.8), `createLoanCase` + loan events in `loans/core.ts`, `setCustomerResidency` in `model/customers.ts`, `cancelBooking` / `transferBooking` in `model/bookings.ts`, `createSnag` in `qa/snags.ts`, `overrideGate` in `handover/core.ts` (prove it requires reason), `setOverdueReason` / `recordPtp` in `demands.ts`, `createUnit` in `projects.ts` if you need more inventory
8. Leftover Meadows units already in `seed-canonical.ts`: **MT1-502**, **MP-02**. Already taken: MV-01 Aditi, MV-02 Harish, MT1-201 Nisha, MP-01 Suresh. East Crest spare pool **V101 / V104 / V108 — do not book**.

Follow TDD. Do not commit or push unless I ask. Do not deploy. Do not call paid APIs. Do not start Phase 4 RLS, Queues, chatbot, WhatsApp, vendor portal, Google OIDC, East-Crest-only code branches.

---

## Product

HomeFlow is Pranava’s post-booking OS. Spec: `docs/Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf`. Local: API `:3001`, workspace `:5173`, portal `:5174`. Reset: **stop API first**, `npm run db:reset` in `services/api`.

---

## Why this chat exists

Day 2 filled Packets, Customisation, Sales hold, Meadows apt+plot. Remaining PDF states are still missing people: AOS draft, registration slot, handover-in-progress, NRI+loan, Default/Legal, cancel/transfer, plan-vs-forecast, pre-reg blockers, CRITICAL snag hard-gate, overdue reason+next action on every overdue (including Karthik).

You have **one working day**. Go in ID order. If you cannot finish an ID, **roll it back** (no half-seeded occupant) and list it leftover.

---

## Must-do this chat (stop here if the clock runs out)

Do **2.6 → 2.8**, then **2.16**, then **2.14** for every accepted booking you add. Then continue 2.9–2.15 in order.

| ID | Do this | Done when |
|---|---|---|
| 2.6 | AOS **draft**, not Karthik’s executed AOS | Different booking. `generateDocument(bookingId, "AOS", legalCtx)` only. Status draft. Watermark/locked clauses still enforced by existing factory (do not silently edit LOCKED). Unit: **MT1-502**. Name **Kavya Iyer**, BK-MT502, portal `kavya@demo.pranava`. |
| 2.7 | Registration slot booked, not completed, not Ananya | `bookSlot` (need availability first if the handler requires `confirmAvailability`). Status not completed. Distinct from V112. Unit: **MP-02**. Name **Deepak Nair**, BK-MP02, portal `deepak@demo.pranava`. |
| 2.8 | Handover in progress, not Rohan | `confirmAppointment` + checklist in flight. Do not complete keys. If you need a unit, `createUnit` on East Crest as **V114** (not V101/V104/V108). Name **Ishaan Gupta**, BK-V114, portal `ishaan@demo.pranava`. |
| 2.16 | Every **overdue** demand has reason_code + next_action | Includes Karthik `d_v110_*` overdue and any new Default/Legal person. Use `setOverdueReason` / `recordPtp` — not a blank UPDATE. |
| 2.14 | Portal `Demo@2026` on every **accepted** booking added here | Packets-only may have no login. |

Pinned extra people if you reach them (createUnit as needed; consideration = that unit’s `base_price_inr` or East Crest villa ~1.2 Cr default matching seed villas):

| ID | Name | Unit | Booking | Login |
|---|---|---|---|---|
| 2.9 NRI+loan | Leela Fernandes | V115 (createUnit) | BK-V115 | `leela@demo.pranava` |
| 2.10 Default/Legal | Farhan Qureshi | V116 (createUnit) | BK-V116 | `farhanq@demo.pranava` (not `farhan@` — staff registration is Farhan Ali) |
| 2.11 cancel/transfer | closed booking on V117 | V117 (createUnit) then `cancelBooking` or `transferBooking` | BK-V117 | none after close is OK |
| 2.13 pre-reg blocked | Anjali Bhat | V118 (createUnit) | BK-V118 | `anjali@demo.pranava` |
| 2.15 CRITICAL snag hard-gate | Vivek Sharma | V119 (createUnit) | BK-V119 | `vivek@demo.pranava` |

2.9: `setCustomerResidency(..., "NRI")` so journey T4 (`customer.residency in [NRI,OCI]`) can appear; `createLoanCase` then `DOCS_REQUESTED` → `DOCS_PENDING`. Not Meera relabeled.

2.10: collections Default/Legal — different person from Karthik overdue-cash and Meera disputed. Use real overdue_reason codes already seeded.

2.11: booking closed; unit 360 still shows history; unit not deleted.

2.12: plan vs forecast vs actual non-zero on **≥2** occupants. Prefer real date drift on existing journeys (Karthik/Nisha) via existing plan-revision handlers if they exist (`createPlanRevision`). Do not fake three identical timestamps. If no handler, list under Assumptions and skip rather than SQL-fake variance.

2.13: Registration desk blocked with **named** finance/docs blockers. Not Karthik-open, not Ananya-done.

2.15: Pre-handover (not Meera-at-funding, not Rohan). `createSnag` severity critical. Keys/complete handover **throws** without `overrideGate` + named person + reason.

---

## Invariants

1. Do not rewrite Phase 1 four families or Day 2 Aditi/Harish/Nisha/Suresh/Tanvi.
2. **Do not book `u_v101`, `u_v104`, `u_v108`.**
3. No `INSERT INTO booking` / `journey_instance`. New inventory via `createUnit` / `insertUnit` is allowed.
4. Journeys only via `acceptHandover` (sales submit ≠ crm accept).
5. 2.14 for every accepted add. 2.6 AOS draft occupant is accepted (needs journey + portal) but AOS not executed.
6. Do not invent SOP days/charges.
7. GET 360 must not write a snapshot every load.
8. Do not touch `0025_rls`, scheduler jobs (except you may call `runOnce` in a test), quiet hours.
9. Staff names in `seed/users.ts` STAFF list are taken — do not reuse Priya Nair, Arjun Menon, etc. as occupants.

---

## Allowed files

- New seed helpers under `services/api/src/seed/` (≤200 lines each)
- `occupants-via-handlers.ts` — **call** leftover after Phase 2; do not delete Day 2
- `seed/users.ts` — portal rows
- `seed-phase2.test.ts` or `seed-phase2-leftover.test.ts`
- Handler files only for optional seed ids
- `docs/demo/click-path.md` — append roster
- `TODO.md` — CONTINUE HERE leftover + one Found while building bullet

Out of bounds: RLS, Queues, chatbot, infra, new npm deps. `apps/` only if a locator breaks.

---

## Tests (fail first)

After `initDb`/`seed`:

1. BK-MT502 exists; AOS document draft (not executed); Kavya portal login.
2. BK-MP02 has a registration case with slot booked, status not completed.
3. If 2.8 done: appointment on BK-V114 (or whatever you used), handover not completed, not `b_v113`.
4. Every demand with overdue status/open overdue facts has `reason_code` (or equivalent column) and next action / PTP where used — at least Karthik’s overdue rows.
5. Phase 1 + Day 2 tests still pass (BK-V110–V113, BK-MV01 no journey, BK-MT201 CR, Tanvi hold).
6. No booking on `u_v101`/`u_v104`/`u_v108`.

Run full `npm test` in `services/api` unsandboxed. Real counts in the report.

---

## Forbidden claims

- Do not mark 2.6 done if the only AOS is Karthik executed.
- Do not mark 2.7 done because Ananya is registered.
- Do not mark 2.8 done because Rohan has keys.
- Do not mark 2.16 done if only the new Default/Legal person has reasons and Karthik overdue is still blank.
- Do not start RLS “because you had an hour”.

---

## Your last message MUST be exactly this shape

```
## Phase 2 leftover report

### Accomplished
- 2.6: [yes/no + one sentence]
- 2.7: …
- 2.8: …
- 2.9: …
- 2.10: …
- 2.11: …
- 2.12: …
- 2.13: …
- 2.14: … (emails added)
- 2.15: …
- 2.16: …

### Proof run
- Commands run (verbatim)
- API vitest: N passed / N failed
- Browser walk: done / not done / why

### Assumptions
Numbered. If none: `None.`

### Leftover still for the team
IDs not done.

### Out of scope
RLS, Queues, chatbot.

### Files changed
Paths only.

### Known gaps vs leftover exit
```

If 2.6, 2.7, 2.8, or 2.16 is no, say the day is **not complete** for the must-do set. Later IDs may be no.

END PROMPT
