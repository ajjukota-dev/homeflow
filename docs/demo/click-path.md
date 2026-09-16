# Demo click-path (local operator pack — Phase 5)

**URLs (this laptop, after reset):** workspace http://localhost:5173 · portal http://localhost:5174 · API http://localhost:3001 (`GET /health` → `{"ok":true,"db":true}`).

Use **`localhost`**, not `127.0.0.1` — Vite listens on IPv6 `[::1]`. There is no current AWS URL for this `main`. The old App Runner host is R0, not this product.

## Reset (do this first)

1. **Stop the API** on :3001 (reset while it is running does not replace a live PGlite file in use).
2. `cd services/api && npm run db:reset` (deletes `./.data/pglite` only).
3. `npm start` in `services/api` — wait for `HomeFlow API ready`.
4. `npm run dev` in `apps/workspace` (:5173) and `apps/my-pranava-home` (:5174).

A stranger can then follow the roster below. Do **not** book V101 / V104 / V108.

## Empty / error behaviour

Lists show a written empty state (e.g. “No files waiting”, “Nothing in this bucket right now.”). Fetch failures show a message + **Retry**, not a spinner. Loading uses skeletons (`aria-busy`). Masked money is "—". `crm@` is East Crest–assigned: Meadows people (Nisha, Aditi, …) do **not** appear on that login — switch project as `superadmin@` or use `nisha@` on the portal.

## Known gaps

- Forecast column still equals baseline after a plan revision (Karthik / Nisha). Plan ≠ baseline is real.
- Queues may show raw `user_*` owner ids.
- Portal Home may say the timeline is not set up until customer-visible dates are published; staff **View journey** for Karthik is populated.

## Logins
Email/password, one seeded staff user per PDF §13 role plus one customer login, all password `Demo@2026`. Workspace app: `/login`. Portal app (My Pranava Home): `/login`.

| Role | Email | Lands in |
|---|---|---|
| Management | `management@demo.pranava` | Control tower |
| CRM | `crm@demo.pranava` | My Day |
| Accounts | `accounts@demo.pranava` | Accounts |
| Sales | `sales@demo.pranava` | Sales |
| Legal | `legal@demo.pranava` | Legal |
| Registration | `registration@demo.pranava` | Legal |
| Site | `site@demo.pranava` | Project / Site |
| QA | `qa@demo.pranava` | QA / Handover |
| Customisation | `customisation@demo.pranava` | CRM / RM |
| FM | `fm@demo.pranava` | After keys |
| Banking | `banking@demo.pranava` | Accounts |
| Super Admin | `superadmin@demo.pranava` | Project / Site (Admin → Users / Teams & Assignments / Permission matrix) |
| Customer (portal) | `customer@demo.pranava` | Their booking (BK-V112, Ananya Rao, East Crest) |
| Customer (portal) | `karthik@demo.pranava` | Their booking (BK-V110, Karthik Iyer, East Crest) |
| Customer (portal) | `meera@demo.pranava` | Their booking (BK-V111, Meera Krishnan, East Crest) |
| Customer (portal) | `rohan@demo.pranava` | Their booking (BK-V113, Rohan Desai, East Crest) |
| Customer (portal) | `nisha@demo.pranava` | Their booking (BK-MT201, Nisha Verma, Meadows apartment) |
| Customer (portal) | `suresh@demo.pranava` | Their booking (BK-MP01, Suresh Naik, Meadows plot) |
| Customer (portal) | `kavya@demo.pranava` | Their booking (BK-MT502, Kavya Iyer, Meadows apartment) |
| Customer (portal) | `deepak@demo.pranava` | Their booking (BK-MP02, Deepak Nair, Meadows plot) |
| Customer (portal) | `ishaan@demo.pranava` | Their booking (BK-V114, Ishaan Gupta, East Crest) |
| Customer (portal) | `leela@demo.pranava` | Their booking (BK-V115, Leela Fernandes, East Crest) |
| Customer (portal) | `farhanq@demo.pranava` | Their booking (BK-V116, Farhan Qureshi, East Crest) |
| Customer (portal) | `anjali@demo.pranava` | Their booking (BK-V118, Anjali Bhat, East Crest) |
| Customer (portal) | `vivek@demo.pranava` | Their booking (BK-V119, Vivek Sharma, East Crest) |

Forgot password → `/reset/:token` (1h link, emailed via the file-mailer adapter locally). Staff/customer invites → `/invite/:token` (72h link) — Admin → Users → Invite user.

## Occupant roster (Phase 1)

Created by the same handlers the UI uses (`createBooking` → `submitHandover` → `acceptHandover` → `completeTaskInstance`), not `INSERT INTO booking`. Copy this pattern for Phase 2. Password for every portal login: `Demo@2026`.

| Stage (current, parallel streams may also be open) | Person | Unit | booking_number | Portal login | Done |
|---|---|---|---|---|---|
| CONSTRUCTION (PAYMENTS_FUNDING still open/at-risk) | Karthik Iyer | V110 | BK-V110 | `karthik@demo.pranava` | yes |
| PAYMENTS_FUNDING / loan (disputed collection, CRITICAL snag) | Meera Krishnan | V111 | BK-V111 | `meera@demo.pranava` | yes |
| READINESS_QA or HANDOVER (pre-keys, not completed) | Ananya Rao | V112 | BK-V112 | `customer@demo.pranava` | yes |
| POST_HANDOVER (keys, DLP, passport, 7/30/90 check-ins) | Rohan Desai | V113 | BK-V113 | `rohan@demo.pranava` | yes |

Staff proof login: `crm@demo.pranava` / `Demo@2026` on workspace `:5173` — lands on **My Day**, then CRM / RM → Karthik Iyer (V110) → **View journey** (not empty). Same desk lists Meera / Ananya / Rohan and leftover East Crest occupants.

## Occupant roster (Phase 2)

Same handler pattern as Phase 1. Password for every portal login: `Demo@2026`. Do not book V101 / V104 / V108 (test spare pool).

| Desk / state | Person | Unit | booking_number | Portal login | Done |
|---|---|---|---|---|---|
| Packets — submitted, not CRM-accepted (no journey) | Aditi Bansal | MV-01 | BK-MV01 | none | yes |
| Packets — returned, resubmittable | Harish Patel | MV-02 | BK-MV02 | none | yes |
| Customisation — CR AWAITING_CUSTOMER + Meadows apartment (accepted, journey) | Nisha Verma | MT1-201 | BK-MT201 | `nisha@demo.pranava` | yes |
| Meadows plot (accepted, journey) | Suresh Naik | MP-01 | BK-MP01 | `suresh@demo.pranava` | yes |
| Sales — prospect + APPROVED kitchen_layout hold on V101 | Tanvi Joshi | interest in V101 (not booked) | n/a | n/a | yes |

Staff proof: `crm@` Packets lists Aditi BK-MV01 + Harish BK-MV02 (plus Phase 1). `sales@` Sales Desk → Prospects (Tanvi Joshi) and Holds (V101 kitchen_layout APPROVED until a future date). `customisation@` is East Crest–assigned, so that desk is empty until the project is Meadows — `superadmin@` → switch to Pranava Meadows → Customisation Desk shows CR-000001 Kitchen island (MT1-201 / BK-MT201, AWAITING_CUSTOMER); Site → View 360 on MT1-201 (APARTMENT, BK-MT201) and MP-01 (PLOT, BK-MP01). Portal `:5174` nisha@ / suresh@ / `Demo@2026`.

## Occupant roster (Phase 2 leftover)

Same handler pattern. Password `Demo@2026`. Do not book V101 / V104 / V108.

| Desk / state | Person | Unit | booking_number | Portal login | Done |
|---|---|---|---|---|---|
| Legal — AOS draft (not executed) | Kavya Iyer | MT1-502 | BK-MT502 | `kavya@demo.pranava` | yes |
| Registration — slot booked, not completed | Deepak Nair | MP-02 | BK-MP02 | `deepak@demo.pranava` | yes |
| Handover — appointment confirmed, keys not issued | Ishaan Gupta | V114 | BK-V114 | `ishaan@demo.pranava` | yes |
| Loan — NRI, DOCS_PENDING | Leela Fernandes | V115 | BK-V115 | `leela@demo.pranava` | yes |
| Collections — Default/Legal (cheque_bounce, 70d overdue) | Farhan Qureshi | V116 | BK-V116 | `farhanq@demo.pranava` | yes |
| Booking closed (cancelled); unit 360 keeps history | Gita Reddy | V117 | BK-V117 | none | yes |
| Registration — blocked (docs/clearance/AOS) | Anjali Bhat | V118 | BK-V118 | `anjali@demo.pranava` | yes |
| Handover — CRITICAL snag hard-gate | Vivek Sharma | V119 | BK-V119 | `vivek@demo.pranava` | yes |
| Overdue reason + next action on every overdue (incl. Karthik) | — | — | — | — | yes |
| Plan vs forecast vs actual date drift | Karthik Iyer / Nisha Verma | V110 / MT1-201 | BK-V110 / BK-MT201 | `karthik@` / `nisha@` | yes (plan ≠ baseline via `createPlanRevision` + delay_reason catalog; forecast column still original/baseline — no forecast-revision handler) |

Staff proof: `legal@` Kavya BK-MT502 AOS draft; `registration@` Deepak BK-MP02 slot booked (Ananya still completed); `qa@` Ishaan BK-V114 scheduled appointment, Vivek BK-V119 blocked by critical snag; `banking@` Leela BK-V115 DOCS_PENDING; `accounts@` Farhan BK-V116 cheque_bounce plus Karthik overdue reasons. Portal `:5174` kavya@ / deepak@ / ishaan@ / leela@ / farhanq@ / anjali@ / vivek@ / `Demo@2026`.

## Scheduler (Phase 3)

The API process (`:3001`) runs overdue, loan-validity, hold-expiry, and forecast-snapshot jobs on a clock after listen (default every 60s via `HOMEFLOW_SCHEDULER_MS`). Demo does not need to curl `/sweep`. Set `HOMEFLOW_SCHEDULER=0` (or `false`) to disable. Vitest never starts the interval. Tanvi Joshi’s V101 kitchen_layout hold stays APPROVED at seed; it expires when the job runs with `asOf` after `approved_until`.

## Access (Phase 4.1–4.3)

Row-level security is on the live request path (`homeflow_app` + `app.realm` / `app.project_ids` GUCs from the session). An East Crest–assigned login (`crm@demo.pranava`) cannot open a Meadows booking (BK-MT201 / BK-MV01) — GET is 404, write is 403. Portal `customer@` (Ananya, BK-V112) cannot load Karthik’s BK-V110 (or any other customer’s home). Roles without finance see masked `null` amounts, not rupees; screens render "—".

## Phase 4 rest (queues, signatures, QA exceptions, delay catalog)

- **Queues** (`crm@` / `management@`): sidebar Queues. Claim an unassigned CRM row as `crm@`. Bulk reassign as `management@` (CRM / RM tab, checkbox, Reassign). Empty and error are messages + Retry, not a spinner.
- **Exception queue:** QA / Handover → “QA exception queue” is a row list (site declarations are not in it). “Site declaration vs QA verify” are two distinct buttons per component.
- **File signatures:** handover case drawer Save signature PUTs PNG to `/api/files/...` and stores `project/...` (Ishaan BK-V114 already has a file id, not a data-URL).
- **Delay catalog:** Policy Studio delay_reason rows exist; Karthik/Nisha journeys have a plan revision so planned_end ≠ baseline_end.

## Walkthrough (after reset)

1. Workspace `crm@` / `Demo@2026` → My Day → CRM / RM → Karthik → View journey.
2. Portal `customer@demo.pranava` → Hello, Ananya / V112. No vendor price, internal note, or TRUE_RISK.
3. Portal `rohan@demo.pranava` → Hello, Rohan / V113.
4. Portal `nisha@demo.pranava` → Hello, Nisha / MT1-201 (Meadows).
5. Super Admin → Users → Invite user (CRM) → file mail under `services/api/.data/mail` → `/invite/:token` → password → **My Day**.

## Not this product
Chatbot, WhatsApp as a send runtime, vendor portal, Google OIDC without a client, AWS without spend yes. GitHub `ci`/`deploy` red is pre-existing — not a click-path step.
