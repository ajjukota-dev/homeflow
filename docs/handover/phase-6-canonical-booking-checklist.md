# Phase 6 checklist — canonical booking shape

Use this page to confirm the data-model fixes landed. A work tick without its **exit** tick is not done. Tick only after a **fresh reset**: stop the API, then `npm run db:reset` in `services/api`, then start the stack.

Companion prompt: [phase-6-agent-prompt.md](./phase-6-agent-prompt.md). Phase map: [phase-work-map.md](./phase-work-map.md).

**Bar:** A newly booked unit, and every seeded occupant, is the artifact booking: customers on applicants, `agreement_value_inr` as contract value, RM as a user id, one human code, NRI/joint captured at write time. Forecast follows a plan revision. Completing keys or registration updates the spec case row.

Phases 1–5 stay closed. Do not reopen RLS, Queues, or the forecast *engine* (recompute on every progress event). Do not book V101 / V104 / V108.

Logins: `*@demo.pranava` / `Demo@2026`. Workspace `:5173`. Portal `:5174`.

**Proved 2026-09-16** after stop API → `npm run db:reset` → SQL pack. API vitest 893 passed / 0 failed. Playwright files this phase touched: 52 passed, then Legal factory scoped to Meera 1 passed.

---

## How to confirm (one pass)

1. Stop API on `:3001`. `cd services/api && npm run db:reset`. Start API + workspace + portal.
2. Run `cd services/api && npm test` (unsandboxed). Real pass/fail counts.
3. Run the Playwright files this phase touched (unsandboxed). Locators on `page.locator("main")`. `{ exact: true }` on Book / Save / Accept / Send.
4. SQL proofs below against the reset DB (psql or a one-shot script through the API db).
5. Walk: `sales@` home is Sales Desk; book a spare unit **other than** V101/V104/V108 if the prompt allows, or use the existing e2e book path; `crm@` Karthik 360; `leela@` portal.

Never tick from a dirty `.data/pglite`.

---

## Work → exit

| Work | Exit | Must-do order |
|---|---|---|
| **6.1** One live booking write path | **e61** | 1 |
| **6.2** Packet residency → customer at accept | **e62** | 2 (same accept as 6.1) |
| **6.3** `agreement_value_inr` is the money | **e63** | 3 |
| **6.4** RM owner is `rm_owner_user_id` | **e64** | after 6.1 |
| **6.5** One human booking id | **e65** | after 6.1 |
| **6.7** Applicant roles = CHECK set | **e67** | after 6.1 |
| **6.6** Forecast revision copies new planned dates | **e66** | after must-do 6.1–6.3 |
| **6.8** One writer per keys / registration case | **e68** | after must-do 6.1–6.3 |
| Suites green, seed not regressed | **e6-tests**, **e6-seed** | last |
| Nothing from Out of all phases | **e6-out** | last |

If **6.1** or **6.3** is no, the day is **not complete**. Do not start 6.6 / 6.8 until 6.1–6.3 are green.

---

### 6.1 / e61 — One write path

**Done when:** Occupant seed and staff booking UI go through `bookFromInventory`. SALES home is Sales Desk. The old wizard is not a live nav target.

**Prove:**

- Grep `services/api/src/seed/` for `createBooking(` — **zero** call sites.
- Grep `apps/workspace/src` for `api.book(` / `BookingWizard` used as a routed view — **zero** live nav. `ROLE_HOME.SALES` is `sales-desk`.
- HTTP: the path the Sales Desk Book button hits is `bookFromInventory` (`routes-sales.ts`), not `POST /api/units/:id/book` → `createBooking`.
- After reset, for Karthik `b_v110`:

```sql
SELECT ba.customer_id IS NOT NULL AS has_customer, c.residency, b.status, b.agreement_value_inr
  FROM booking b
  JOIN booking_applicant ba ON ba.booking_id = b.id AND ba.role = 'primary'
  JOIN customer c ON c.id = ba.customer_id
 WHERE b.id = 'b_v110';
```

  `has_customer` is true. `customer_id` is still `c_karthik`. Journey still exists (accepted occupants only).
- Packet-only Aditi `b_mv01` (not accepted) **already** has `applicant.customer_id` set (customers exist at book, not only at CRM accept).
- Same booking ids / customer ids / portal emails as click-path (`b_v110`, `c_karthik`, `karthik@`, …).

**Not done if:** Seed still calls `createBooking`. SALES lands on `SalesInventory` + `BookingWizard`. Occupant ids changed. V101/V104/V108 booked. Journeys empty after reset.

`createBooking` may remain as a **deprecated test helper** only if it delegates to `bookFromInventory` and no app/seed calls it. Prefer deleting the HTTP route.

---

### 6.2 / e62 — Residency on the customer twin

**Done when:** NRI/OCI on the packet or on `bookFromInventory` applicants is stored on `customer.residency`. Accept does not leave the default `RESIDENT` when the packet said otherwise.

**Prove:**

- After reset: `SELECT residency FROM customer WHERE id = 'c_leela'` → `NRI`.
- Automated test: submit a packet with `customer_section.residency = 'NRI'`, accept with a different CRM user, `customer.residency` is `NRI`. No `updateCustomerResidency` after the fact required for that test.
- Leftover seed does not need a post-accept `updateCustomerResidency` to make Leela NRI (pass residency at book). If that helper remains, it is for later CRM edits only.
- Document checklist / T4 that keys off customer residency sees NRI for Leela (existing 2.9 coverage still green, or re-instantiate T4 if the journey was built before residency existed — allowed).

**Not done if:** Packet JSON says NRI and `customer.residency` is still `RESIDENT`. Leela is NRI only because leftover extra patched her after accept.

---

### 6.3 / e63 — One contract value

**Done when:** Demands, collections, CRM 360, legal merge fields, portal home, and TDS all use `agreement_value_inr`. Writes set it. `total_consideration` is not a second source of truth.

**Prove:**

- Grep `services/api/src/**/*.ts` (exclude `*.test.ts`) for `total_consideration` in SELECT/INSERT/UPDATE of domain handlers — **none**, or every remaining mention is an explicit `total_consideration = agreement_value_inr` sync on write.
- After reset, Karthik:

```sql
SELECT agreement_value_inr, total_consideration,
       (SELECT SUM(amount) FROM demand WHERE booking_id = 'b_v110') AS demand_sum
  FROM booking WHERE id = 'b_v110';
```

  `agreement_value_inr` = `12000000`. `demand_sum` = `agreement_value_inr` (seeded plan still 100%). If `total_consideration` column still exists, it equals `agreement_value_inr`.
- TDS applicability still keys off `agreement_value_inr` (≥ 50 lakh).
- CRM queue / 360 / portal payment “why due” render Karthik’s ₹1.2 Cr from `agreement_value_inr` (masking still nulls it for roles without financials).

**Not done if:** `setupFunding` still SELECTs `total_consideration` as the amount to split. 360 types expose only `total_consideration`. A discount write updates one column and not the other.

---

### 6.4 / e64 — RM is a user id

**Done when:** Accept assigns `rm_owner_user_id`. UI and events show that user’s display name via join. No new writes to `booking.rm_owner` as a free-text name.

**Prove:**

- Grep `services/api/src` for `SET rm_owner =` / `rm_owner = $` — **zero** (column may remain unread).
- After reset: `SELECT rm_owner_user_id FROM booking WHERE id = 'b_v110'` is `user_crm` (or another CRM team user), not null.
- `sales_handover.accepted` payload does not need a raw name; 360 RM label is a joined `user.display_name`.
- Direct `acceptBooking` (if still reachable) also sets `rm_owner_user_id`.

**Not done if:** Queue/360 still stores or displays `Priya Nair` from `rm_owner` with no user id. Round-robin writes the name and leaves `rm_owner_user_id` null.

---

### 6.5 / e65 — One human booking id

**Done when:** Staff and portal show one code. New bookings mint `code` and set `booking_number = code`. Occupants keep click-path ids (`BK-V110`, …) by setting **both** columns to that same string.

**Prove:**

- After reset: `SELECT code, booking_number FROM booking WHERE id = 'b_v110'` → both `BK-V110` (or both the same value listed in click-path).
- Book from Sales Desk (test or UI): returned `code` equals `booking.booking_number`; UI heading uses `code`.
- CRM queue, 360, handover packets, portal: the visible id is `booking.code`. Types may keep `booking_number` only as an alias of `code`.

**Not done if:** A new book mints `BKG-000123` and `BK-<uuid slice>` as two different strings. 360 shows one and lists show the other.

---

### 6.7 / e67 — Applicant roles

**Done when:** Stored roles are exactly `primary` | `CO_APPLICANT` | `POA` | `NOMINEE`. UI can add co-applicant / POA / nominee. No `co_owner` / `guarantor`.

**Prove:**

- BookUnitDialog (or Sales Desk book) offers PRIMARY, CO_APPLICANT, POA, NOMINEE. Saving a CO_APPLICANT persists `role = 'CO_APPLICANT'` and a `customer` row.
- Grep for `guarantor` / `co_owner` / `CO_OWNER` in `services/api/src` and `apps/workspace/src` — none in write paths.
- `PRIMARY` still stores as lowercase `primary` (existing CHECK). Reads translate at the boundary.

**Not done if:** Wizard still only one nameless applicant. CHECK violated. Spec vocabulary written without the `primary` alias.

---

### 6.6 / e66 — Forecast follows plan revision (bounded)

**Done when:** `createPlanRevision` also inserts `timeline_forecast_revision` and updates stage/task **forecast** dates to the **new planned** dates. Source `SYSTEM`. Do not invent SOP days. Do not recompute on progress/SLA events.

**Prove:**

- After reset, Karthik BK-V110 **and** Nisha BK-MT201:

```sql
SELECT si.baseline_end, si.planned_end, si.forecast_end
  FROM stage_instance si
  JOIN journey_instance ji ON ji.id = si.journey_id
 WHERE ji.booking_id = 'b_v110'
 LIMIT 5;
```

  At least one stage: `planned_end ≠ baseline_end` **and** `forecast_end = planned_end`.
- `timeline_forecast_revision` has a row for both journeys. `changes` jsonb matches the plan deltas.
- Existing 2.12 tests extended: forecast ≠ baseline on those two bookings (forecast may equal plan).

**Not done if:** Table still empty. Forecast column still equals baseline after a plan revision. A new engine recomputes forecast from invented construction slip days.

---

### 6.8 / e68 — One writer per case table

**Done when:** `completeHandover` (`qa.ts`) and `completeRegistration` (`legal-docs.ts`) update the existing spec case (handover `completeCase` / registration `completeCase`, or shared load-or-create). They do not INSERT a new id on conflict as a second producer.

**Prove:**

- After reset, Ishaan `b_v114` has **one** `handover_record`. Completing keys (test) keeps the same `id`; `status` becomes completed/COMPLETED; unit `handed_over`.
- Completing registration on a booking that already has a `registration_case` keeps that `id`; status completed; `sro_reference` set.
- Grep: `INSERT INTO handover_record` and `INSERT INTO registration_case` with `ON CONFLICT (booking_id) DO UPDATE` in `qa.ts` / `legal-docs.ts` — **gone** (those files call the spec module).
- Ishaan in-progress appointment/checklist still visible until complete (2.8 not regressed).

**Not done if:** Two rows, or complete mints a new UUID and orphaned the appointment (`case_id` PK on the old row). Desks rewritten.

---

### e6-tests — Suites

**Prove:** Full `services/api` vitest after reset, real counts in the Phase 6 report. Playwright for Sales Desk book + any 360/queue/portal files this phase touched. Failures fixed in this chat.

**Not done if:** “Should be green.” Red tests left for later.

---

### e6-seed — Roster intact

**Prove:** Click-path people still present with the same ids. Portal logins still work for every accepted occupant. Spare pool `u_v101` / `u_v104` / `u_v108` unbooked. No `INSERT INTO booking` in seed files (handler only, same rule as Phase 1).

**Not done if:** Occupant rewrite dropped journeys, logins, or Meadows people.

---

### e6-out — Out of all phases

**Prove:** No chatbot, WhatsApp runtime, vendor portal, East-Crest-only branches, invented SOP day counts, Google OIDC without a client, AWS without spend yes. No full forecast engine (progress/SLA recompute).

**Not done if:** A §27 item landed as extra credit.

---

## SQL pack (copy after reset)

Run against the reset DB. Every query must match the **Prove** line of its exit.

```sql
-- e61 / e62 customers on applicants
SELECT b.id, ba.role, ba.customer_id, c.residency, c.display_name
  FROM booking b
  JOIN booking_applicant ba ON ba.booking_id = b.id AND ba.role = 'primary'
  LEFT JOIN customer c ON c.id = ba.customer_id
 WHERE b.id IN ('b_v110','b_v111','b_v112','b_v113','b_mv01','b_v115');

-- e63 money
SELECT id, agreement_value_inr, total_consideration FROM booking WHERE id = 'b_v110';
SELECT SUM(amount) FROM demand WHERE booking_id = 'b_v110';

-- e64 RM
SELECT id, rm_owner_user_id, rm_owner FROM booking WHERE id IN ('b_v110','b_v112');

-- e65 codes
SELECT id, code, booking_number FROM booking WHERE id IN ('b_v110','b_mt201');

-- e66 forecast
SELECT ji.booking_id, si.stage_code, si.baseline_end, si.planned_end, si.forecast_end
  FROM stage_instance si
  JOIN journey_instance ji ON ji.id = si.journey_id
 WHERE ji.booking_id IN ('b_v110','b_mt201');
SELECT journey_id, source, confidence FROM timeline_forecast_revision;

-- e68 one case row
SELECT booking_id, id, status FROM handover_record WHERE booking_id = 'b_v114';
SELECT booking_id, COUNT(*) FROM handover_record GROUP BY booking_id HAVING COUNT(*) > 1;
SELECT booking_id, COUNT(*) FROM registration_case GROUP BY booking_id HAVING COUNT(*) > 1;
```

---

## Forbidden claims

- Do not tick e61 because `bookFromInventory` exists. Seed and SALES home must use it.
- Do not tick e62 because Leela’s leftover file still calls `updateCustomerResidency`.
- Do not tick e63 because both money columns happen to be equal in seed. Reads must use `agreement_value_inr`.
- Do not tick e66 because plan ≠ baseline (that is 2.12, already closed). Forecast must move.
- Do not tick e68 because `ON CONFLICT` “sort of updates.” The spec case id must be stable.
- Do not tick e6-tests without pasting real vitest/Playwright counts.
- Do not drop `createBooking` from unit tests in a way that leaves 17 files red and call that “retired.”
- Do not invent SOP days to make forecast interesting.

---

## Verification leftovers (2026-09-16, planning-chat check)

All IDs 6.1–6.8 / e61–e68 / e6-tests / e6-seed / e6-out **pass**. These do **not** reopen the phase:

- `BookingWizard.tsx` remains on disk; `Workspace` does not import it. `api.book` would 404 (`POST /api/units/:id/book` deleted).
- Old **Sales** nav tab still routes to read-only `SalesInventory`. SALES home is Sales Desk, so the “lands on SalesInventory + BookingWizard” fail condition is not met.
- `createBooking` in `bookings.ts` is still a direct `INSERT` test helper, not a delegate to `bookFromInventory`. Seed and live HTTP do not use it.
- Portal does not render the word NRI for Leela (residency is on the customer row).
- Playwright: 52 passed / 1 failed (Legal factory `.first()`), then Meera-scoped AOS 1/0. Concatenated 53/53 on a fresh reset was not re-run.
- Independent re-check: `phase6-canonical.test.ts` + `plan-revision.test.ts` **20/20**. Full 893 not re-run in the planning chat.
