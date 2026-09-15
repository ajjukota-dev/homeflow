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

## Walkthrough
_Nothing on the URL yet._

## Not yet on the URL
Everything — see TODO.md §0.
