# 01 — Identity & access

## Purpose
"Project is a universal filter and security dimension" (p6 §4.4). "Role-based visibility … Field-level sensitivity for financial/legal/PII" (p23 §17). "Hard-gate overrides require named authority" (p27 §22). Every role workspace in p20 §13 opens in the user's default Project. Login methods: email/password now, Google later (TODO §7 #1, #12).

## Data
| Table | Columns |
|---|---|
| `user` | `id uuid pk`, `email citext unique`, `display_name`, `password_hash` (argon2id, null for invite-pending or Google-only), `status ∈ {INVITED, ACTIVE, DISABLED}`, `kind ∈ {STAFF, CUSTOMER}`, `default_project_id`, `google_sub` (null), `created_at`, `last_login_at` |
| `session` | `id` (random 256-bit, stored hashed), `user_id`, `created_at`, `expires_at` (30 d sliding, 12 h idle for STAFF **[ours]**), `ip`, `user_agent`, `revoked_at` |
| `invite` | `id`, `user_id`, `token_hash`, `expires_at` (72 h), `used_at`, `invited_by` |
| `password_reset` | same shape as invite, 1 h expiry |
| `role` | `code` (see list), `name`, `description`. Seeded, not editable |
| `user_role` | `user_id`, `role_code` |
| `team` | `id`, `name`, `department ∈ DEPARTMENT enum`, `project_id` (null = central) — p36 §31.1 |
| `project_team_assignment` | `id`, `project_id`, `team_id`, `user_id`, `department`, `role_scope`, `assignment_type ∈ {DEDICATED, SHARED, CENTRAL}`, `is_primary_owner`, `is_backup_owner`, `effective_from`, `effective_to`, `capacity_pct`, `escalation_manager_user_id` — p36 §31.1 |
| `permission_matrix` | `role_code`, `module`, `level ∈ {NONE, READ_STATUS_ONLY, READ_LIMITED, READ, WRITE, ADMIN}`, `effective_from`, `effective_to`, `version` — seed from **[E §1.3]**, editable in Policy Studio |
| `field_sensitivity` | `module`, `field`, `class ∈ {FINANCIAL, PII}`, `min_level` — seed **[E §1.5]** |
| `customer_login` | `user_id`, `customer_id`, `booking_id` (portal identity is booking-bound; one customer may hold several) |

Roles (`role.code`) — PDF §13 workspaces: `SALES`, `CRM`, `ACCOUNTS`, `BANKING`, `LEGAL`, `REGISTRATION`, `SITE`, `QA`, `CUSTOMISATION`, `FM`, `MANAGEMENT`, `SUPER_ADMIN`, `CUSTOMER`. QA is **not** the same authority as Site (p16 §8.8 "independent QA verification") — flagged as an Emergent conflict **[E §1.1]**; we follow the PDF. Departments enum: `SALES, CRM, ACCOUNTS, BANKING, LEGAL, REGISTRATION, PROJECTS, QA, CUSTOMISATION, HANDOVER, FACILITY, MANAGEMENT` **[E §13]**.

## Rules
1. Password login: `email + password` → argon2id verify → new session → `Set-Cookie: hf_session=…; HttpOnly; Secure; SameSite=Lax; Path=/`. 5 failures per email per 15 min → `429 rate_limited` **[ours]**.
2. No self-signup. Staff are created by `SUPER_ADMIN`/`MANAGEMENT` (invite email → set password). Customers are created by CRM from a Booking (`customer_login`), invite mail to the primary applicant's email.
3. Reset: email → single-use token (1 h) → new password; all other sessions revoked.
4. `actor.project_ids`: `MANAGEMENT`, `SUPER_ADMIN` → `'ALL'` **[E §1.6]**; everyone else → distinct `project_id` from `project_team_assignment` where today ∈ [effective_from, effective_to]. Customers → projects of their bookings.
5. `authorize(ctx, module, level)`: highest level across the actor's roles from `permission_matrix` effective today; `NONE` → `forbidden`. A row outside scope → reads `not_found`, writes `forbidden`.
6. Field masking: response serializer nulls fields whose `field_sensitivity.min_level` > actor level for that module. `READ_STATUS_ONLY` hides FINANCIAL; `READ_LIMITED` hides PII **[E §1.2]**. Masking is applied in one place (`mask(ctx, module, row)`), never per handler.
7. Sales/CRM have no WRITE on `unit_progress`, `change_gate_rule`, `snagging`, `handovers` (p44 §33.6 t3; **[E §1.3]** agrees). Tests assert 403.
8. Effective-dated assignments never rewrite history: reports use the assignment valid on the event date (p37 §31.5 t9).
9. Workspace opens in `default_project_id`; a project switcher appears only if `project_ids` has >1 or `'ALL'` (p20 §13).
10. Google sign-in (later): `google_sub` linked on first OIDC login **only if** the verified email matches an existing INVITED/ACTIVE user; never auto-creates.
11. Every auth event is logged: `login_succeeded`, `login_failed`, `logout`, `password_reset_requested/completed`, `invite_sent/accepted`, `session_revoked`, `permission_matrix_changed`, `assignment_changed`.

## API
`POST /auth/login {email,password}` · `POST /auth/logout` · `GET /auth/me → {user, roles, project_ids, default_project_id}` · `POST /auth/reset/request {email}` · `POST /auth/reset/complete {token,password}` · `POST /auth/invite/accept {token,password}` · `POST /admin/users {email,display_name,roles[],kind}` · `PATCH /admin/users/:id` · `GET /admin/users` · `POST /admin/assignments` · `PATCH /admin/assignments/:id` · `GET /admin/permission-matrix` · `PUT /admin/permission-matrix` (new version) · middleware `requireSession` on every non-auth route; `GET /health` public.

## Screens
Workspace: `/login` (email, password, "Forgot password"; error state; no marketing copy) · `/reset/:token` · `/invite/:token` · header project switcher + user menu (logout) · Admin → Users (list, invite, roles, disable), Teams & Assignments (per project, effective dates), Permission matrix (role × module grid, effective date, change log).
Portal: `/login`, `/invite/:token`, `/reset/:token`; after login lands on the customer's booking (chooser if several).

## Events
Appendix B has no auth rows; add `auth.*` and `access.*` families (rule 11).

## Config
`permission_matrix`, `field_sensitivity`, `project_team_assignment` are Policy Studio tables (p26 §21 "Role/permission matrix and field-level sensitivity", "Project Team Assignment matrix").

## Demo accounts (seed)
One staff user per PDF §13 role: `<role>@demo.pranava` (`management@demo.pranava`, `crm@…`, `accounts@…`, `sales@…`, `legal@…`, `registration@…`, `site@…`, `qa@…`, `customisation@…`, `fm@…`, `banking@…`, `superadmin@…`) and one customer login `customer@demo.pranava` bound to the primary seeded booking; password `Demo@2026` for all, documented in `seed/users.ts` and `docs/demo/click-path.md`. Real invites (CEO/CFO in the room) go through the normal invite flow over Gmail SMTP.

## Acceptance
p37 §31.5 t1, t2, t9 · p44 §33.6 t3 · p31 §26 "Internal notes … remain internal" (masking test) · rule tests 1–10 · Playwright: login as each of the 12 staff roles with seeded demo users; a Sales user sees no Site write controls · **Live smoke against the deployed URL:** Admin invites a fresh email → mail arrives via SMTP (file adapter in CI, real Gmail in smoke) → link sets password → lands in Management. This is demoed live; it must be in the pre-demo smoke run.

## Depends on / Feeds
Depends on 03 (db, mailer, migrations). Feeds every other spec (`ctx.actor`).

## Files
`services/api/src/auth/**`, `services/api/src/authz/**`, `services/api/migrations/0001_identity.sql`, `services/api/src/seed/users.ts`, `services/api/src/seed/permissions.ts`, `apps/workspace/src/pages/Login.tsx`, `apps/workspace/src/pages/admin/**`, `apps/workspace/src/auth/**`, `apps/my-pranava-home/src/auth/**`, tests alongside.

## Not in this feature
Google OIDC implementation (add when Pranava supplies the client; the `google_sub` column and rule 10 are ready). MFA. SSO for customers.
