# Demo click-path (reflects what is DEPLOYED — updated on every deploy)

**URL:** not deployed yet

## Logins
Email/password, one seeded staff user per PDF §13 role plus one customer login, all password `Demo@2026`. Workspace app: `/login`. Portal app (My Pranava Home): `/login`.

| Role | Email | Lands in |
|---|---|---|
| Management | `management@demo.pranava` | Control tower |
| CRM | `crm@demo.pranava` | CRM / RM |
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

Forgot password → `/reset/:token` (1h link, emailed via the file-mailer adapter locally). Staff/customer invites → `/invite/:token` (72h link) — Admin → Users → Invite user.

## Occupant roster (Phase 1)

Created by the same handlers the UI uses (`createBooking` → `submitHandover` → `acceptHandover` → `completeTaskInstance`), not `INSERT INTO booking`. Copy this pattern for Phase 2. Password for every portal login: `Demo@2026`.

| Stage (current, parallel streams may also be open) | Person | Unit | booking_number | Portal login | Done |
|---|---|---|---|---|---|
| CONSTRUCTION (PAYMENTS_FUNDING still open/at-risk) | Karthik Iyer | V110 | BK-V110 | `karthik@demo.pranava` | yes |
| PAYMENTS_FUNDING / loan (disputed collection, CRITICAL snag) | Meera Krishnan | V111 | BK-V111 | `meera@demo.pranava` | yes |
| READINESS_QA or HANDOVER (pre-keys, not completed) | Ananya Rao | V112 | BK-V112 | `customer@demo.pranava` | yes |
| POST_HANDOVER (keys, DLP, passport, 7/30/90 check-ins) | Rohan Desai | V113 | BK-V113 | `rohan@demo.pranava` | yes |

Staff proof login: `crm@demo.pranava` / `Demo@2026` on workspace `:5173` — open V110–V113; Journey tab is not empty.

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

## Scheduler (Phase 3)

The API process (`:3001`) runs overdue, loan-validity, hold-expiry, and forecast-snapshot jobs on a clock after listen (default every 60s via `HOMEFLOW_SCHEDULER_MS`). Demo does not need to curl `/sweep`. Set `HOMEFLOW_SCHEDULER=0` (or `false`) to disable. Vitest never starts the interval. Tanvi Joshi’s V101 kitchen_layout hold stays APPROVED at seed; it expires when the job runs with `asOf` after `approved_until`.

## Walkthrough
_Nothing on the URL yet._

## Not yet on the URL
Everything — see TODO.md §0.
