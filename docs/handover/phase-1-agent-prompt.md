# Phase 1 agent prompt — copy everything below the line into a new chat

Paste the block from `BEGIN PROMPT` through `END PROMPT` as the first message of a **new** Cursor chat on this repo. Do not add extra goals. When that chat finishes, paste its `## Phase 1 report` back into the planning chat for exit verification.

---

BEGIN PROMPT

You are implementing **HomeFlow Phase 1 only** (occupant foundation). This is a finished-product handover track, not a new feature brainstorm.

Read first, in this order, before writing code:

1. `CLAUDE.md`
2. `docs/CONTEXT.md`
3. `docs/specs/00-conventions.md`
4. This prompt in full
5. `docs/specs/04-canonical-model.md`, `docs/specs/05-journey-templates.md`, `docs/specs/06-timeline-sla-engine.md`, `docs/specs/17-sales-crm-handover.md`, `docs/specs/26-customer-portal.md`, `docs/specs/30-post-handover.md` — only the Files / Rules you will touch
6. Current seed: `services/api/src/seed.ts`, `services/api/src/seed-lifecycle.ts`, `services/api/src/seed/users.ts`
7. Handler entry points (do not reimplement them): `createBooking` in `services/api/src/bookings.ts`, `submitHandover` + `acceptHandover` in `services/api/src/sales-handover/core.ts` (accept already calls `acceptBooking` which emits `sales_handover.accepted`), `completeTaskInstance` in `services/api/src/journey/instances.ts`, `setupFunding` in `services/api/src/demands-schedule.ts`, `openPostHandoverCase` in `services/api/src/post-handover/core.ts`
8. Journey stage **codes** in `services/api/src/seed/journey-standard.ts` (PRESALES, BOOKING, SALES_CRM_HANDOVER, DOCS_KYC, AGREEMENT, PAYMENTS_FUNDING, REGISTRATION, CONSTRUCTION, CUSTOMISATION, READINESS_QA, HANDOVER, POST_HANDOVER). Task codes PT1, T1–T13, PT2–PT6.

Follow TDD: write a **failing** test that `seed()` does not yet satisfy, then make it pass. Do not commit or push unless I explicitly ask in this chat. Do not deploy. Do not call paid APIs. Do not start Phase 2–5.

---

## Product (do not invent a second one)

HomeFlow is Pranava’s **post-booking OS** (token → keys → warranty). Not FMWork. Spec authority: `docs/Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf`. Bounded contexts do not read each other’s tables. Do not hard-code East Crest durations/charges/stage names. Do not build a chatbot, AI auto-send, WhatsApp runtime, vendor portal, Google OIDC, or East-Crest-only code branches.

Canonical: **Project** (site) · **Unit** (physical home) · **Booking** (this family + unit + ownership period). Money/papers/journey attach to Booking.

Local stack: API `:3001` (PGlite), workspace `:5173`, portal `:5174`. Staff `*@demo.pranava` / `Demo@2026`. Reset: **stop the API first**, then `npm run db:reset` in `services/api`.

---

## Why this phase exists

East Crest bookings are created with raw `INSERT INTO booking` (and matching demand / AOS / handover SQL). Journeys instantiate only on `sales_handover.accepted` (`journey/subscribers.ts` → `instantiateJourneyForBooking`). The four families therefore have money and papers and **empty Customer/Booking 360 Journey tabs**. Same class of bug as empty `unit_specification` when seed skipped handlers.

Phase 1 makes the **existing four families real**. If this slips, stop. Do not add Meadows bookings, packets-not-accepted, CRs, prospects, or new occupants.

---

## Work items (all required — IDs must appear in your report)

| ID | Do this | Done when |
|---|---|---|
| 1a | Cut seed off raw `INSERT INTO booking` / `demand` / handover-record / AOS **for these four families** | Karthik/Meera/Ananya/Rohan are created by calling the same handlers the UI uses. A search of seed files must not show those INSERTs creating BK-V110–V113. |
| 1b | Karthik V110 / BK-V110 via handlers | After reset, `crm@demo.pranava` opens V110; Journey is **not empty**; construction current; cash/overdue still open; label is **Karthik Iyer** not an id. Target journey: `CONSTRUCTION` current, `PAYMENTS_FUNDING` still open/at-risk. |
| 1c | Meera V111 / BK-V111 via handlers | Journey not empty; **PAYMENTS_FUNDING** / loan current; disputed collection; **CRITICAL** snag on the unit. Label **Meera Krishnan**. |
| 1d | Ananya V112 / BK-V112 via handlers | Journey not empty; **READINESS_QA** or **HANDOVER** (pre-keys, not completed). `customer@demo.pranava` / `Demo@2026` **still** opens BK-V112. Label **Ananya Rao**. |
| 1e | Rohan V113 / BK-V113 via handlers | Journey on **POST_HANDOVER**; keys issued; DLP/warranty; Home Passport items; **7/30/90 check-ins listed** (task instances PT4/PT5/PT6 and/or check-in rows from post-handover handlers — not a blank after-care tab). Label **Rohan Desai**. |
| 1f | Portal logins | `karthik@demo.pranava`, `meera@demo.pranava`, `rohan@demo.pranava`, existing `customer@demo.pranava` — all `Demo@2026`. Each portal landing is **only that family’s home**. No vendor price, internal note, or unapproved forecast. |
| 1g | Prove on a fresh reset | Stop API → `npm run db:reset` in `services/api` → start API + UIs (or at least API for tests). Repeat 1b–1f. Do not claim done on a dirty DB. |
| 1h | Roster into `docs/demo/click-path.md` | Table: stage, person, unit, booking_number, portal login, done. Note that handlers (not SQL) created them. Someone else can copy the pattern for Phase 2. |

Also required (from Phase 1 exit — not optional polish):

- **e1-names:** 360 and portal show names/unit numbers, never raw `user.id` / `unit_id` as the title.
- **e1-get:** Reloading 360/Journey does **not** insert a new audit/snapshot row every GET.
- **e1-lock:** Do not start a parallel seed rewrite. One handler pattern.

---

## Invariants (break these and the phase is failed)

1. **Units already exist.** Keep `u_v110`, `u_v111`, `u_v112`, `u_v113` on `p_eastcrest`. Do not recreate East Crest as a project.
2. **Human keys stay:** booking_numbers `BK-V110` … `BK-V113`; display names above; Ananya portal user id `user_customer_demo` + `customer@demo.pranava` remain valid.
3. **Surrogate ids:** Today tests hardcode `b_v110`, `c_karthik`, `c_meera`, `c_ananya`, `b_v112`, `b_v113`, demand ids `d_v110_*`, etc. **Preferred:** seed-only optional ids on the handler path so those ids survive. If you cannot, you must grep and update **every** reference and run the **full** API vitest suite. Report the grep hit count in Assumptions.
4. **Journeys:** Instantiate only via `sales_handover.accepted` (use `acceptHandover` with **sales** submitter ≠ **crm** accepter — `user_sales` vs `user_crm`). Advance stages only via `completeTaskInstance` (it already branches to `approveAction` for APPROVAL-family). **Forbidden:** `UPDATE journey_instance` / `stage_instance` / `task_instance` to fake a stage; `INSERT INTO journey_instance`.
5. **Money / papers / keys:** Prefer existing handlers (`setupFunding` already runs inside `acceptBooking`; receipts, dispute, loan, document factory, handover complete, `openPostHandoverCase`). If a specific overdue_reason / dispute / executed-AOS has **no** handler, you may write the **smallest** SQL for that column/row and you **must** list it under Assumptions. You may **not** SQL-create the booking itself.
6. **Customer users:** Staff seed already INSERTs `@demo.pranava` users. Portal bindings may follow `seed/users.ts` (`customer_login` + hashed `Demo@2026`) **after** the booking/customer exist. That is identity seed, not a booking bypass. Keep Ananya’s existing login; add the other three.
7. **Do not invent SOP numbers** (durations, charges, freeze dates). Reuse amounts already in seed for these four villas (Karthik 1.2 Cr, Meera 80 L, Ananya 1 Cr — keep current seed consideration values unless a handler forces otherwise; if forced, record the delta in Assumptions).
8. **Do not** implement RLS/GUC threading, Queues studio, Action Types studio, Meadows bookings, packet-not-accepted occupants, CRs, prospects/holds, scheduler, files-port migration, chatbots.

---

## Allowed files

Touch only what you need from:

- `services/api/src/seed.ts`
- `services/api/src/seed-lifecycle.ts`
- `services/api/src/seed/users.ts`
- **New** seed helper under `services/api/src/seed/` (e.g. `occupants-via-handlers.ts`) — keep files ≤200 lines; split if needed
- **New** test next to seed, e.g. `services/api/src/seed-occupants.test.ts`
- Handler files **only** if you add an optional seed-id argument that defaults off and does not change HTTP behavior. Add tests for the production path unchanged.
- `docs/demo/click-path.md` (logins + roster)
- `TODO.md` — one short **Found while building** bullet in §9 Record, and update `## CONTINUE HERE` to say Phase 1 landed / leftover. Do not rewrite the status-board table.

Out of bounds: `apps/` unless a seed-id change breaks an e2e locator (fix locator to unit_number / booking_number, scoped to `main`). No canvas files. No infra. No new npm dependencies.

---

## Tests you must add (fail first)

After `initDb`/`seed` (same path production reset uses):

1. Each of BK-V110, BK-V111, BK-V112, BK-V113 has a `journey_instance` row.
2. Current stage codes match 1b–1e (Karthik `CONSTRUCTION`, Meera `PAYMENTS_FUNDING`, Ananya `READINESS_QA` or `HANDOVER` not completed, Rohan `POST_HANDOVER`). If rollup makes a parallel stream “current” as well, assert with `OR` and document it.
3. Four `customer_login` rows for those bookings; users `karthik@` / `meera@` / `rohan@` / `customer@` all `@demo.pranava`.
4. `sales_handover.accepted` (or `journey.started`) exists in `event` for each of the four booking ids.
5. Meera’s unit has a snag with severity `critical`.
6. Rohan has post-handover case + passport item + evidence of 7/30/90 (task instances PT4/PT5/PT6 and/or check-in rows).

Run, and put **real counts** in the report (do not say “tests passed” without running):

- `npm test` from `services/api` (full vitest)
- `npm test` from repo root if that is the documented combo
- After implementation: stop API if running, `npm run db:reset` in `services/api`, re-run the new occupant tests

If the full suite has **pre-existing** flakes (known: some `registration.test.ts` timeouts), say so and show they exist on an unchanged control **or** that they are unrelated. Do not ignore new failures.

---

## Proof walk (1g) — do this or say you could not

Staff: `crm@demo.pranava` / `Demo@2026` on `:5173`. Confirm Journey not empty for V110–V113.

Portal `:5174`: four emails above. Each sees the right home.

If you cannot open a browser, say so under Assumptions and still run API-level proof (authenticated GET of 360/journey/portal home for those users).

---

## Forbidden claims

- Do not mark 1a done if `INSERT INTO booking` for `b_v110`/`BK-V110` (or the other three) remains in seed.
- Do not mark journeys done because templates exist.
- Do not skip Rohan check-ins.
- Do not break `customer@demo.pranava`.
- Do not “finish” Phase 2 items in this chat.

---

## Your last message in this chat MUST be exactly this shape

```
## Phase 1 report

### Accomplished
- 1a: [yes/no + one sentence + files]
- 1b: …
- 1c: …
- 1d: …
- 1e: …
- 1f: …
- 1g: … (include whether db:reset was actually run)
- 1h: …
- e1-names: …
- e1-get: …

### Proof run
- Commands run (verbatim)
- API vitest: N passed / N failed / files
- Occupant tests: …
- Browser walk: done / not done / why

### Assumptions
Numbered list of every choice not spelled out above (SQL leftovers, id remaps, stage-code OR, skipped browser). If none: `None.`

### Out of scope (correctly not done)
List Phase 2+ items you did not touch.

### Files changed
Paths only.

### Known gaps vs Phase 1 exit
Anything in the work/exit list you did not fully prove.
```

If any of 1a–1h is no, the phase is **not complete**. Do not soften that.

END PROMPT
