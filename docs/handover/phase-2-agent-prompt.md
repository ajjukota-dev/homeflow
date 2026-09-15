# Phase 2 agent prompt — copy everything below the line into a new chat

Paste the block from `BEGIN PROMPT` through `END PROMPT` as the first message of a **new** Cursor chat on this repo. Do not add extra goals. When that chat finishes, paste its `## Phase 2 report` back into the planning chat for exit verification.

Phase 1 is **closed**. Four East Crest families (Karthik V110, Meera V111, Ananya V112, Rohan V113) already go through handlers. Do not rewrite them.

---

BEGIN PROMPT

You are implementing **HomeFlow Phase 2 only** (occupant coverage). This is a finished-product handover track, not a new feature brainstorm.

Read first, in this order, before writing code:

1. `CLAUDE.md`
2. `docs/CONTEXT.md`
3. `docs/specs/00-conventions.md`
4. This prompt in full
5. Specs you will actually call: `docs/specs/17-sales-crm-handover.md`, `docs/specs/18-change-requests.md`, `docs/specs/24-sales-inventory-discovery.md`, `docs/specs/04-canonical-model.md`, `docs/specs/26-customer-portal.md` — only Files / Rules you touch
6. Phase 1 pattern to copy (do not replace): `services/api/src/seed/occupants-via-handlers.ts`, `occupants-book.ts`, `occupants-ctx.ts`, `occupants-advance.ts`, `seed-occupants.test.ts`, `seed/users.ts`
7. Handlers (do not reimplement): `createBooking` in `bookings.ts`, `submitHandover` + `acceptHandover` + `returnHandover` in `sales-handover/core.ts`, `createProspect` in `sales/prospects.ts`, `requestHold` + `approveHold` in `sales/holds.ts` (`approveHold` needs SITE), `evaluateUnit` in `changeability/core.ts`, `raiseChangeRequest` / `recordFeasibility` / `putCrItems` / `submitCrForApproval` / `issueQuotation` / `releaseChangeRequest` / `confirmPaymentGate` under `change-requests/`, `createBaseline` + `approveBaseline` under `specification/` if Meadows has no spec baseline
8. Meadows inventory already exists in `services/api/src/seed-canonical.ts` (`p_meadows`, unit_numbers `MV-01` `MV-02` `MP-01` `MP-02` `MT1-201` `MT1-502`). Lookup ids by `unit_number` — `insertUnit` generates ids.
9. Journey stage codes in `seed/journey-standard.ts`. East Crest unsold spare pool: **V101 (`u_v101`), V104 (`u_v104`), V108 (`u_v108`)** — tests call `createBooking` on these. **Do not book them.**

Follow TDD: write a **failing** test that `seed()` does not yet satisfy, then make it pass. Do not commit or push unless I explicitly ask in this chat. Do not deploy. Do not call paid APIs. Do not start Phase 3–5. Do not implement RLS, Queues studio, scheduler, files-port, chatbot, WhatsApp, vendor portal, Google OIDC, or East-Crest-only code branches.

---

## Product (do not invent a second one)

HomeFlow is Pranava’s **post-booking OS** (token → keys → warranty). Spec authority: `docs/Pranava_HomeFlow_2.0_Full_Design_Spec_v8.pdf`. Canonical: Project · Unit · Booking. Local stack: API `:3001` (PGlite), workspace `:5173`, portal `:5174`. Staff `*@demo.pranava` / `Demo@2026`. Reset: **stop the API first**, then `npm run db:reset` in `services/api`.

---

## Why this phase exists

Phase 1 filled four journeys. Desks that the client will click (Packets, Customisation, Sales inventory, Meadows product types) are still empty or inventory-only. Phase 2 seeds **named people and desk rows** through the same handlers the UI uses.

---

## Must-do this chat (Day 2). All required. IDs must appear in the report.

Do **2.1 → 2.5 in that order**, then **2.14** for every accepted booking you added. Then **e2-sql**. Then leftover only if time.

| ID | Do this | Done when |
|---|---|---|
| 2.1 | Submitted handover packet, **not** CRM-accepted | After reset, Packets has a submitted row that is **not** one of BK-V110–V113. No `journey_instance` for that booking. Path: `createBooking` → `submitHandover` → **stop**. Do not `acceptHandover`. |
| 2.2 | Returned packet with reason, resubmittable | A **different** booking: `createBooking` → `submitHandover` → `returnHandover(reasonCode, note)`. Status Returned + reason persisted. Sales can call `submitHandover` again. Not deleted. |
| 2.3 | One live CR at `AWAITING_CUSTOMER` (preferred) or Released + payment gate before site release | Customisation desk has a row. `releaseChangeRequest` **throws** if payment is not confirmed. Portal must not show vendor cost. Drive via handlers (`raiseChangeRequest` → feasibility → items → submit approval → `issueQuotation`). Do not SQL-insert `change_request`. |
| 2.4 | Named prospect + Change Window Hold + V101 vs V104 gates | `createProspect` with a real name. `requestHold` + `approveHold` (SITE) with `approved_until` / expiry date in the future. **Do not fire `scanHolds` as a scheduler** (Phase 3). `evaluateUnit('u_v101')` vs `evaluateUnit('u_v104')` must differ. V101 kitchen_layout is OPEN (all progress `not_started`). V104 has mep+flooring complete → kitchen_layout EXCEPTION_ONLY and structural HARD_CLOSED. Report the actual gate states. Do not invent new `change_gate_rule` rows. **Do not `createBooking` on V101/V104/V108.** |
| 2.5 | Meadows apartment booking + Meadows plot booking | Units already exist (`MT1-201` APARTMENT, `MP-01` PLOT). Both bookings via `bookAndAccept` (or the same three-handler path). Product type visible. Journeys exist because accepted. Not inventory-only. |
| 2.14 | Portal login `Demo@2026` on **every accepted** booking added this phase | Packet-submitted / returned (2.1, 2.2) may have **no** login. Accepted Meadows (2.5) and the CR family if that booking is accepted **must** have logins. Extend `seed/users.ts` PORTALS the same way Phase 1 did. |
| e2-sql | No raw `INSERT INTO booking` for new occupants | Same handler pattern as Phase 1. No “just for Meadows” SQL bookings. |

Pinned people (do not reuse staff names from `seed/users.ts` STAFF list, and do not reuse Karthik/Meera/Ananya/Rohan):

| Role | Display name | Unit | Booking number | Login |
|---|---|---|---|---|
| 2.1 submitted | Aditi Bansal | MV-01 (lookup id) | BK-MV01 | none |
| 2.2 returned | Harish Patel | MV-02 (lookup id) | BK-MV02 | none |
| 2.5 apartment + 2.3 CR | Nisha Verma | MT1-201 (lookup id) | BK-MT201 | `nisha@demo.pranava` |
| 2.5 plot | Suresh Naik | MP-01 (lookup id) | BK-MP01 | `suresh@demo.pranava` |
| 2.4 prospect | Tanvi Joshi | interest in V101; hold on `u_v101` category `kitchen_layout` | n/a | n/a |

Consideration = that unit’s existing `base_price_inr` (MV-01 1.85 Cr, MT1-201 72 L, MP-01 95 L). Do not invent SOP days or East Crest–only charges.

If Meadows APARTMENT has no `specification_baseline`, create+approve one with `createBaseline` / `approveBaseline` so `ensureUnitSpecification` can run on booking.created. That is a handler, not a shortcut INSERT of the booking.

---

## Leftover (only after 2.1–2.5 + 2.14 + tests are green)

Go in order. If you cannot finish an ID, **do not leave a half-seeded occupant** — roll that ID back and list it under leftover.

| ID | Intent | Handler hints |
|---|---|---|
| 2.6 | AOS **draft** occupant, not Karthik’s executed AOS | `generateDocument(..., "AOS")` in `legal-docs.ts`. Do **not** `approveDocument`+`executeDocument`. Use leftover Meadows unit `MT1-502` or `MP-02`, not V110. |
| 2.7 | Registration slot booked, not completed, not Ananya | `bookSlot` in `registration/core.ts`. Do not `completeCase` / `completeRegistration`. |
| 2.8 | Handover in progress, not Rohan | Appointment + checklist in flight. Do not `completeHandover`. |
| 2.9 | NRI + loan with a conditional docs task | Flag NRI on applicant; `createLoanCase` with DOCS_PENDING (or equivalent real status). Not Meera relabeled. |
| 2.10 | Default/Legal overdue occupant | Different person from Karthik overdue-cash and Meera disputed. |
| 2.11 | Cancel or transfer; unit history intact | `cancelBooking` or `transferBooking` in `model/bookings.ts`. Unit row remains. |
| 2.12 | Plan vs forecast vs actual non-zero on ≥2 occupants | Prefer advancing dates so variance is real; do not fake three identical timestamps. |
| 2.13 | Pre-registration blocked with named finance/docs blockers | Not Karthik-open, not Ananya-done. |
| 2.15 | Pre-handover CRITICAL snag hard-gate | Not Meera-at-funding, not Rohan. Override needs named person + reason. |
| 2.16 | Every overdue demand has reason code + next action | Includes Karthik’s existing overdue, not only 2.10. |

---

## Invariants (break these and the phase is failed)

1. **Do not rewrite Phase 1.** Karthik/Meera/Ananya/Rohan ids, names, portals, and `seed-occupants.test.ts` must still pass.
2. **Do not book `u_v101`, `u_v104`, `u_v108`.** Hold + prospect only. Those villas are the throwaway `createBooking` pool for API tests and Playwright.
3. **Journeys** instantiate only on `sales_handover.accepted`. 2.1 and 2.2 must **not** have `journey_instance`. 2.5 must.
4. **Forbidden:** `INSERT INTO booking` / `journey_instance` / `change_request` / `change_window_hold` / `prospect` as a seed shortcut. Smallest SQL only for a column with **no** handler, listed under Assumptions.
5. **Do not invent SOP numbers.** Reuse unit `base_price_inr`.
6. **e2-story:** For each accepted Phase 2 occupant, staff 360 and that portal login tell the same stage. Portal still has no vendor price / internal note / unapproved forecast.
7. **e2-desks:** After reset, Packets, Customisation, and Sales (prospect/hold) are not empty. Meadows 360 shows apartment + plot bookings.
8. **e1-get still holds:** GET 360/Journey must not insert an audit/snapshot row every load.
9. **Do not** implement hold-expiry scheduler, quiet hours, RLS/GUC, Queues studio.

---

## Allowed files

Touch only what you need from:

- New seed helper under `services/api/src/seed/` (e.g. `occupants-phase2.ts`) — keep files ≤200 lines; split if needed
- `services/api/src/seed/occupants-via-handlers.ts` — **call** the new helper after Phase 1; do not delete Phase 1
- `services/api/src/seed/users.ts` — add portal rows
- `services/api/src/seed-occupants.test.ts` or a sibling `seed-phase2.test.ts`
- Handler files **only** for optional seed-id arguments that default off
- `docs/demo/click-path.md` — append Phase 2 roster
- `TODO.md` — one short **Found while building** bullet in §9 Record, and update `## CONTINUE HERE` leftover. Do not rewrite the status-board table.

Out of bounds: `apps/` unless a locator breaks (fix to unit_number / booking_number, scoped to `main`). No canvas files. No infra. No new npm dependencies. No `0025_rls` threading.

---

## Tests you must add (fail first)

After `initDb`/`seed` (same path as production reset):

1. BK-MV01 exists, handover submitted, **no** `journey_instance`.
2. BK-MV02 exists, handover status returned, reason non-empty.
3. A `change_request` for Nisha / BK-MT201 at `AWAITING_CUSTOMER` (or Released). Assert `releaseChangeRequest` fails without payment if you left it pre-payment.
4. A prospect named Tanvi Joshi; an APPROVED hold on `u_v101` with a future `approved_until`; `evaluateUnit` kitchen_layout OPEN on V101 and not OPEN on V104 (EXCEPTION_ONLY or HARD_CLOSED elsewhere — assert actual).
5. Bookings on Meadows APARTMENT `MT1-201` and PLOT `MP-01`, each with `journey_instance`.
6. `customer_login` for `nisha@demo.pranava` and `suresh@demo.pranava`.
7. Phase 1 occupant tests still pass (BK-V110–V113 journeys).

Run, and put **real counts** in the report:

- `npm test` from `services/api` (full vitest, unsandboxed if Playwright/pdf SIGSEGVs in sandbox)
- After implementation: stop API if running, `npm run db:reset`, re-run the new tests

Known: sandboxed Playwright Chromium can SIGSEGV in pdf tests — rerun unsandboxed; do not “fix” pdf tests unless you broke them.

---

## Proof walk — do this or say you could not

Staff `:5173` as `crm@` / `sales@` / `customisation@`: Packets has 2.1+2.2; Customisation has 2.3; Sales has Tanvi + hold; Meadows 360 shows apartment + plot.

Portal `:5174`: `nisha@` and `suresh@` / `Demo@2026`. Each sees only their home.

If the browser password-fill tool is blocked, say so and still run authenticated API GETs.

---

## Forbidden claims

- Do not mark 2.1 done if the only packets are the accepted Day 1 four.
- Do not mark 2.5 done because Meadows units exist.
- Do not book V101/V104/V108 to “get a fifth East Crest family”.
- Do not mark 2.4 done with a hold that has no expiry timestamp.
- Do not start Phase 3 scheduler so the hold expires in this chat.
- Do not call leftover 2.6–2.16 done unless you seeded and tested them.

---

## Your last message in this chat MUST be exactly this shape

```
## Phase 2 report

### Accomplished
- 2.1: [yes/no + one sentence + files]
- 2.2: …
- 2.3: …
- 2.4: … (include actual V101 vs V104 gate states)
- 2.5: …
- 2.14: … (list accepted bookings + emails)
- e2-sql: …
- e2-story: …
- e2-desks: …
- 2.6–2.16: each yes/no/not started

### Proof run
- Commands run (verbatim)
- API vitest: N passed / N failed / files
- Phase 2 tests: …
- Browser walk: done / not done / why

### Assumptions
Numbered list. If none: `None.`

### Leftover for the team
IDs not done, one line each.

### Out of scope (correctly not done)
Phase 3 scheduler, Phase 4 RLS/Queues, chatbot, etc.

### Files changed
Paths only.

### Known gaps vs Phase 2 Day-2 exit
Anything in 2.1–2.5 / 2.14 / e2-* you did not fully prove.
```

If any of 2.1–2.5, 2.14 (for accepted added), or e2-sql is no, Day 2 is **not complete**. Do not soften that. Leftover 2.6–2.16 may be no.

END PROMPT
