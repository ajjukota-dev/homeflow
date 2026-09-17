# Phase 6 agent prompt — copy everything below the line into a new chat

Paste the block from `BEGIN PROMPT` through `END PROMPT` as the first message of a **new** Cursor chat on this repo. Do not add extra goals. When that chat finishes, paste its `## Phase 6 report` back into the planning chat for exit verification against `docs/handover/phase-6-canonical-booking-checklist.md`.

Phases 1–5 are **closed**. This chat is **Phase 6 only: canonical booking shape** (data-model dual-write retirement). Do not start a chatbot, AWS, or the full forecast engine.

---

BEGIN PROMPT

You are implementing **HomeFlow Phase 6 only** (canonical booking shape). This is a finished-product handover track, not a brainstorm. Phases 1–5 are closed. Do not reopen RLS, Queues, Action Types, document families, or score_weight.

Read first, in this order, before writing code:

1. `CLAUDE.md`
2. `docs/CONTEXT.md`
3. `docs/specs/00-conventions.md`
4. This prompt in full
5. **`docs/handover/phase-6-canonical-booking-checklist.md`** — this is the exit bar. Every ID has Prove / Not done if. Tick nothing yourself in that file unless the prove step actually ran.
6. Exit boxes `e61`–`e68`, `e6-tests`, `e6-seed`, `e6-out` in `docs/handover/phase-work-map.md` (same IDs as the checklist)
7. Specs you actually touch: `docs/specs/04-canonical-model.md` (booking, applicants, confirm), `docs/specs/24-sales-inventory-discovery.md` (`bookFromInventory`), `docs/specs/17-sales-crm-handover.md` (packet + accept), `docs/specs/19-collections-true-risk.md` (demands from agreement value), `docs/specs/06-timeline-sla-engine.md` (`timeline_forecast_revision` columns only), `docs/specs/16-handover-gates.md` + `docs/specs/23-registration.md` (complete case)
8. Copy, do **not** reimplement: `bookFromInventory` / `confirmInventoryBooking` in `services/api/src/sales/booking.ts`, `acceptHandover` in `sales-handover/core.ts`, `createPlanRevision` in `journey/plan-revision.ts`, `completeCase` in `handover/core.ts` and `registration/core.ts`, Sales Desk `BookUnitDialog.tsx`
9. Do **not** book `u_v101` / `u_v104` / `u_v108`. Keep occupant ids (`b_v110`, `c_karthik`, `a_v110`, portal emails). Roster: `docs/demo/click-path.md`.

Follow TDD: failing test first for 6.1 / 6.2 / 6.3 / 6.6 / 6.8. Do not commit or push unless I ask. Do not deploy. Do not call paid APIs. **Ask me before any AWS or billed service.**

Do not start a chatbot, WhatsApp runtime, vendor portal, Google OIDC, East-Crest-only code, or invent SOP day counts. Do not build the spec-06 forecast engine that recomputes on every progress/SLA event.

---

## Product

HomeFlow is Pranava’s post-booking OS. Spec: `docs/Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf`. Artifact to match: no `booking.customer_id`; buyers via `booking_applicant`; contract value `agreement_value_inr`; RM is a user FK; one human `code`. Local: API `:3001`, workspace `:5173`, portal `:5174`. Reset: **stop API first**, `npm run db:reset` in `services/api`. Logins `*@demo.pranava` / `Demo@2026`.

---

## Why this chat exists

The schema already matches the intended model. The product still **writes the 0000_init booking**: `createBooking` + `BookingWizard` (SALES home) + occupant seed. A second path (`bookFromInventory` + Sales Desk) is the artifact shape. Dual columns (`total_consideration` vs `agreement_value_inr`, `rm_owner` vs `rm_owner_user_id`, `booking_number` vs `code`) mean most screens read the leftover name. Packet NRI never lands on `customer.residency`. `timeline_forecast_revision` is unused. `completeHandover` / `completeRegistration` INSERT as a second producer beside the spec cases.

**Finish the write path.** Do not invent a third booking handler.

---

## Must-do this chat (stop here if the clock runs out)

Do **6.1 → 6.2 → 6.3**. If any of those is no, the day is **not complete**. Then 6.4, 6.5, 6.7. Then bounded 6.6 and 6.8. Then e6-tests on a fresh reset.

| ID | Do this | Done when (checklist has the SQL) |
|---|---|---|
| **6.1** | One live write path: seed + SALES UI = `bookFromInventory` | Occupant seed does not call `createBooking`. `ROLE_HOME.SALES` = `sales-desk`. BookUnitDialog is the book UI. After reset, Karthik primary applicant has `customer_id = c_karthik`. Aditi (packet, not accepted) already has a customer on the applicant. Same booking/customer/portal ids. Extend `bookFromInventory` seed ids (booking_id, code, applicant_id, customer_id, prospect_id) so the roster does not get new UUIDs. Create a prospect per occupant then book — do not raw `INSERT INTO booking`. |
| **6.2** | Copy residency onto `customer` | `bookFromInventory` already writes `customer.residency`. Packet accept must copy `packet.customer_section.residency` onto the customer created/linked at accept (and must not overwrite a more specific value already set at book). Leela is NRI because she was booked as NRI, not because leftover later called `updateCustomerResidency`. Test: packet NRI → accept → `customer.residency = NRI`. |
| **6.3** | `agreement_value_inr` is the money | `setupFunding`, collections, 360, legal merge fields, portal home, TDS read `agreement_value_inr`. Writes set it. If `total_consideration` stays as a column, every write sets it **equal** to `agreement_value_inr`; domain SELECTs do not use it. Karthik demands still sum to 1.2 Cr. |

Then:

| ID | Do this | Done when |
|---|---|---|
| **6.4** | RM is `rm_owner_user_id` | Packet accept already round-robins that column — keep it. Stop writing `booking.rm_owner` as a display name (`acceptBooking` / events / labels). 360/queue join `user.display_name`. After reset Karthik `rm_owner_user_id` is a CRM user (typically `user_crm`). |
| **6.5** | One human id | New books: mint `code`, set `booking_number = code`. Occupants: both columns = click-path id (`BK-V110`, …). UI/API list/360/portal display `code`. |
| **6.7** | Applicant roles = CHECK | UI can set PRIMARY / CO_APPLICANT / POA / NOMINEE. Store PRIMARY as `primary`. No co_owner/guarantor writes. Co-applicant gets a customer row. |
| **6.6** | Forecast revision, bounded | Inside `createPlanRevision` only: insert `timeline_forecast_revision` (`source = SYSTEM`, confidence `1`) whose `changes` copy the **new planned** dates, and set stage/task `forecast_*` = new `planned_*`. No SOP days. No subscriber on progress/task-late. After reset, BK-V110 and BK-MT201: `forecast_end = planned_end` and `planned_end ≠ baseline_end`. |
| **6.8** | One writer per case | `qa.ts::completeHandover` calls `handover/core.ts::completeCase` (or shared load-or-create then complete). `legal-docs.ts::completeRegistration` calls `registration/core.ts::completeCase`. Remove the `INSERT … ON CONFLICT (booking_id)` second producer. Ishaan’s `handover_record.id` stays stable through complete. Do not rewrite the keys or registration desks. |

---

## How to build 6.1 (do not invent a third book)

1. Extend `bookFromInventory` so seed can pin `booking_id`, `code`/`booking_number` (same string), per-applicant `customer_id` + `applicant_id`, and `prospect_id`. If a prospect is missing, create one in the occupant helper (handler, not raw booking INSERT).
2. Occupant helper `occupants-book.ts`: prospect → `bookFromInventory` (applicants + residency + `price_inr` = today’s `consideration`) → `submitHandover` → `acceptHandover` for accepted people. Packet-only 2.1/2.2 stop before accept. You may `confirmInventoryBooking` if submitHandover refuses DRAFT — do not keep `createBooking` to dodge that.
3. `acceptBooking` in `bookings-crm.ts` must **not** INSERT a second customer when `applicant.customer_id` is already set (inventory path). Link if null (legacy tests). Copy residency (6.2) in both cases.
4. Nav: SALES home = Sales Desk. Remove `BookingWizard` from `Workspace` routing. Update e2e that opened `SalesInventory`/`BookingWizard` to Sales Desk (`page.locator("main")`).
5. `POST /api/units/:id/book` → `createBooking`: delete, or make it a thin adapter that requires the inventory body and calls `bookFromInventory`. Live UI must not use the old one-applicant JSON.
6. Keep portal `customer_login` seed ids. Accepted occupants still get those logins (2.14).

---

## How to build 6.6 (do not invent SOP)

`createPlanRevision` already writes `timeline_plan_revision` and updates planned dates. After that, in the same transaction: insert `timeline_forecast_revision` and UPDATE the same stages’ `forecast_start` / `forecast_end` (and task forecast columns if the plan change touched them) to the new planned values. Confidence `1`. Source `SYSTEM`. Existing 2.12 tests: add `forecast_end !== baseline_end` and a row in `timeline_forecast_revision`.

---

## How to build 6.8 (do not rewrite desks)

`completeCase` already knows gates and status vocabulary. Legacy `completeHandover` / `completeRegistration` exist for old HTTP shapes and seed. Make them **call** the spec complete (map arguments). Keep emitting `handover.completed` / `registration.completed` if the spec path already does — do not double-append. Test: given an in-progress case id, complete, `SELECT id FROM handover_record WHERE booking_id = $1` returns that same id.

---

## Invariants

1. No `INSERT INTO booking` for occupants. Same as Phase 1.
2. Do not book V101 / V104 / V108.
3. Do not invent SOP days/charges.
4. GET 360 / scores: persist-on-change only.
5. No new npm packages without asking.
6. Handlers stay Express-free. Files ≤200 lines.
7. Playwright: `page.locator("main")`; `{ exact: true }` on Book / Save / Accept / Send / Claim.
8. Do not start a chatbot. Do not generate PDFs via Chromium inside `initDb`.
9. Do not create billed cloud resources.
10. Do not rewrite the TODO.md status-board table.

---

## Allowed files

- `services/api/src/sales/booking.ts` + tests (seed ids, money columns)
- `services/api/src/bookings.ts`, `bookings-crm.ts`, `bookings-types.ts` (retire or adapt live path; accept links existing customer)
- `services/api/src/sales-handover/**` (submit from inventory DRAFT/CONFIRMED if needed; residency on accept)
- `services/api/src/seed/occupants*.ts` (write path + Leela residency at book)
- `services/api/src/demands-schedule.ts`, `collections-view.ts`, `finance.ts`, `customer.ts`, `model/customers.ts`, `documents/source.ts`, `legal-docs-source.ts`, `tds.ts` (read `agreement_value_inr`)
- `services/api/src/model/applicants.ts`, `model/bookings.ts` as needed
- `services/api/src/journey/plan-revision.ts` + tests (6.6 only)
- `services/api/src/qa.ts`, `legal-docs.ts`, `handover/core.ts`, `registration/core.ts` (6.8 glue only)
- `services/api/src/server.ts` / `routes-sales.ts` / `routes-model.ts` if the old book HTTP goes away
- `apps/workspace/src/nav.ts`, `Workspace.tsx`, `pages/BookingWizard.tsx`, `pages/SalesInventory.tsx`, `pages/sales/**`, `pages/CrmQueue.tsx`, `pages/sales-handover/**`, 360/portal display of `code` / RM
- `apps/workspace/src/api.ts`, `pages/sales/api.ts`
- `apps/workspace/e2e/**` that booked via the wizard
- `apps/my-pranava-home/**` if portal types still say `total_consideration` only
- `docs/demo/click-path.md` — Sales Desk is SALES home; codes still BK-V110…
- `docs/handover/phase-6-canonical-booking-checklist.md` — tick only after prove
- `docs/handover/phase-work-map.md`, `docs/handover/client-readiness.md` — Phase 6 rows only after prove
- `TODO.md` — CONTINUE HERE leftover + one Found while building bullet. Do not rewrite the status-board table
- `HANDOFF.md` — one paragraph: canonical book path; forecast follows plan revision

Out of bounds: chatbot, infra/CDK deploy, GitHub Actions AWS credentials, new npm deps, Queues rewrite, RLS rewrite, full forecast engine, occupant *roster* changes (same people; different create handler).

---

## Tests (fail first)

1. 6.1: seed file grep (no `createBooking(` in `seed/`). After `initDb`, Karthik applicant `customer_id = c_karthik`. Aditi has a customer_id. Spare pool unbooked.
2. 6.2: packet NRI → accept → customer.residency NRI. Leela `c_leela` is NRI without relying on a post-accept patch as the only writer.
3. 6.3: `setupFunding` splits `agreement_value_inr`. Handler grep for `total_consideration` in SELECT is clean (or documented sync-only writes).
4. 6.4: accept sets `rm_owner_user_id`; no `SET rm_owner`.
5. 6.5: new book `code === booking_number`. Occupant both equal click-path id.
6. 6.7: co-applicant persists `CO_APPLICANT` + customer row.
7. 6.6: after `createPlanRevision`, `timeline_forecast_revision` row exists; `forecast_end = planned_end ≠ baseline_end` on BK-V110 and BK-MT201.
8. 6.8: complete keeps the same `handover_record.id` / `registration_case.id`.
9. Existing occupant / leftover / sales-handover / handover / registration tests stay green (fix in this chat).

Run `npm test` in `services/api` unsandboxed. Run Playwright you touch unsandboxed. Real counts in the report.

---

## Forbidden claims

- Do not mark 6.1 done because Sales Desk already books. Seed and SALES home must use that path.
- Do not mark 6.2 done because leftover still calls `updateCustomerResidency`.
- Do not mark 6.3 done because seed happens to set both money columns equal.
- Do not mark 6.6 done because 2.12 plan ≠ baseline. Forecast must move.
- Do not mark 6.8 done because `ON CONFLICT DO UPDATE` “is an upsert.” Spec case id must be stable; legacy files must call spec complete.
- Do not mark e6-tests done without reset + pasted counts.
- Do not deploy AWS.
- Do not reopen 4.x or write a progress-driven forecast engine.

---

## Your last message MUST be exactly this shape

```
## Phase 6 report

### Accomplished
- 6.1: [yes/no + one sentence]
- 6.2: …
- 6.3: …
- 6.4: …
- 6.5: …
- 6.6: …
- 6.7: …
- 6.8: …
- e6-tests: …
- e6-seed: …
- e6-out: …

### Proof run
- Commands run (verbatim)
- API vitest: N passed / N failed
- Playwright files run: …
- SQL pack from the checklist: pasted results or “not run”
- Browser walk: done / not done / why (sales@ home + crm@ Karthik + leela@)

### Assumptions
Numbered. If none: `None.`

### Leftover still
IDs that are no.

### Out of scope
Chatbot, WhatsApp, vendor portal, Google OIDC, AWS without spend yes, full forecast engine, Queues raw user ids.

### Files changed
Paths only.

### Known gaps vs Phase 6 checklist
```

If 6.1 or 6.3 is no, say the day is **not complete**. Later IDs may be no.

END PROMPT
