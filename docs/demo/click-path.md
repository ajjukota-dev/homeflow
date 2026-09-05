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
| Customisation | `customisation@demo.pranava` | Project / Site |
| FM | `fm@demo.pranava` | After keys |
| Banking | `banking@demo.pranava` | Accounts |
| Super Admin | `superadmin@demo.pranava` | Project / Site (Admin → Users / Teams & Assignments / Permission matrix) |
| Customer (portal) | `customer@demo.pranava` | Their booking (BK-V112, Ananya Rao, East Crest) |

Forgot password → `/reset/:token` (1h link, emailed via the file-mailer adapter locally). Staff/customer invites → `/invite/:token` (72h link) — Admin → Users → Invite user.

## Walkthrough
_Nothing on the URL yet._

## Not yet on the URL
Everything — see TODO.md §0.
